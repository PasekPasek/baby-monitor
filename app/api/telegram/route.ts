/**
 * Telegram Bot webhook handler
 * Telegram sends a POST with a JSON Update object for every incoming message.
 * Must always respond with HTTP 200 — otherwise Telegram retries indefinitely.
 *
 * Security: X-Telegram-Bot-Api-Secret-Token header verified against TELEGRAM_WEBHOOK_SECRET env var.
 * Chat validation: only messages from TELEGRAM_CHAT_ID (or auto-discovered group) are processed.
 *
 * Query handling: AI-devs tool-calling loop pattern — agent decides what data to fetch,
 * uses think() for internal reasoning, then responds in natural Polish.
 */
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { events, notifications, settings } from "@/lib/schema"
import { getOrCreateBaby, getBabyAge } from "@/lib/baby"
import { classifySMS } from "@/lib/sms-agent"
import { sendTelegramMessage } from "@/lib/telegram"
import { openrouter, DEFAULT_MODEL } from "@/lib/openrouter"
import { getFeedingNorms } from "@/lib/feeding-norms"
import { eq, and, desc, gte } from "drizzle-orm"
import type { Baby } from "@/lib/schema"
import type OpenAI from "openai"

function ok() {
  return new NextResponse("OK", { status: 200 })
}

export async function POST(req: NextRequest) {
  // 1. Verify webhook secret
  const secret = req.headers.get("x-telegram-bot-api-secret-token")
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.warn("[Telegram] Webhook secret mismatch — ignoring update")
    return ok()
  }

  // 2. Parse Update object
  let update: TelegramUpdate
  try {
    update = await req.json()
  } catch {
    console.error("[Telegram] Failed to parse update body")
    return ok()
  }

  const message = update.message
  if (!message?.text) {
    return ok()
  }

  const chatId = String(message.chat.id)
  const text = message.text.trim()
  const senderName = message.from?.first_name ?? "rodzic"

  // 3. Validate chat — only process messages from the configured group
  const expectedChatId = process.env.TELEGRAM_CHAT_ID ?? null
  if (expectedChatId && chatId !== expectedChatId) {
    console.warn(`[Telegram] Odrzucono wiadomość z nieznanego chatu: ${chatId}`)
    return ok()
  }

  // 4. Auto-save chat_id to settings on every message (upsert)
  try {
    await db
      .insert(settings)
      .values({ key: "telegram_chat_id", value: chatId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: chatId, updatedAt: new Date() },
      })
  } catch (err) {
    console.error("[Telegram] Failed to save chat_id:", err)
  }

  // 5. Classify the message using the existing agent
  const baby = await getOrCreateBaby()
  const classified = await classifySMS(text, senderName, baby.name)

  if (!classified) {
    await sendTelegramMessage(
      chatId,
      "Nie rozumiem. Spróbuj: 'karmienie 60ml', 'kąpiel', 'waga 3.5kg'"
    )
    return ok()
  }

  // 6. Handle queries — run query agent with tools, don't save as event
  if (classified.type === "query") {
    const queryData = classified.data as { queryType: string; question: string }
    const answer = await handleQuery(queryData.question || queryData.queryType, baby)
    await sendTelegramMessage(chatId, answer)
    return ok()
  }

  // 7. Save event to DB
  await db.insert(events).values({
    id: crypto.randomUUID(),
    babyId: baby.id,
    type: classified.type as typeof events.$inferInsert["type"],
    data: classified.data,
    occurredAt: classified.occurredAt,
    source: "telegram",
  })

  // 8. Log notification
  await db.insert(notifications).values({
    id: crypto.randomUUID(),
    babyId: baby.id,
    type: `telegram_incoming_${classified.type}`,
    channel: "telegram",
    message: text,
    sentTo: chatId,
    triggeredBy: "incoming_sms",
  })

  // 9. Confirmation — for feedings use cluster-aware AI, for others use classified message
  let confirmMsg: string
  if (classified.type === "feeding") {
    confirmMsg = await generateFeedingConfirmation(classified.data, baby, classified.confirmationMessage)
  } else {
    confirmMsg = classified.confirmationMessage
  }
  await sendTelegramMessage(chatId, confirmMsg)

  return ok()
}

// ─── Feeding confirmation with cluster context (single-shot AI) ──────────────

async function generateFeedingConfirmation(data: unknown, baby: Baby, fallback: string): Promise<string> {
  try {
    const windowStart = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const recentFeedings = await db.query.events.findMany({
      where: and(
        eq(events.babyId, baby.id),
        eq(events.type, "feeding"),
        gte(events.occurredAt, windowStart)
      ),
      orderBy: [desc(events.occurredAt)],
      limit: 15,
    })

    const clusterTotalMl = recentFeedings.reduce((sum, e) => {
      const d = e.data as { amountMl?: number }
      return sum + (d.amountMl ?? 0)
    }, 0)

    const age = getBabyAge(baby.birthDate)
    const norms = getFeedingNorms(age.weeks)

    const res = await openrouter.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content: `Wygeneruj krótkie (1-2 zdania) potwierdzenie karmienia po polsku.
Normy dla wieku ${age.label}: ${norms.minMlPerCluster}-${norms.maxMlPerCluster}ml na klaster (okno 3h).
Zasada KLASTER: karmienia w 3h to jeden posiłek — oceniaj sumę, NIE pojedyncze karmienie.
Jeśli suma klastra jest w normie: potwierdź pozytywnie, nawet jeśli jedno karmienie było małe.
Jeśli suma klastra poniżej normy: ostrzeż, ale zaznacz że chodzi o sumę klastra.`,
        },
        {
          role: "user",
          content: `Nowe karmienie: ${JSON.stringify(data)}
Klaster ostatnie 3h: ${recentFeedings.length} karmień, łącznie ${clusterTotalMl}ml
Norma: ${norms.minMlPerCluster}-${norms.maxMlPerCluster}ml na klaster`,
        },
      ],
      temperature: 0.3,
    })

    return res.choices[0]?.message?.content?.trim() ?? fallback
  } catch (err) {
    console.error("[Telegram] generateFeedingConfirmation failed:", err)
    return fallback
  }
}

// ─── Query agent (AI-devs tool-calling loop pattern) ─────────────────────────

const queryTools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "think",
      description: "Wewnętrzne rozumowanie — zaplanuj co sprawdzić i dlaczego. Nie zwraca danych, tylko potwierdza OK.",
      parameters: {
        type: "object",
        properties: {
          reasoning: { type: "string", description: "Twoje przemyślenia przed pobraniem danych" },
        },
        required: ["reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_feedings",
      description: "Karmienia z ostatnich N godzin. Grupuje automatycznie w klastry (okno 3h) i podaje sumy ml.",
      parameters: {
        type: "object",
        properties: {
          hours: { type: "number", description: "Ile ostatnich godzin sprawdzić (np. 24, 48, 168 dla tygodnia)" },
        },
        required: ["hours"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_events",
      description: "Zdarzenia danego typu z ostatnich N godzin.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["sleep", "weight", "bath", "diaper", "milestone", "health", "note"],
            description: "Typ zdarzenia",
          },
          hours: { type: "number", description: "Ile ostatnich godzin" },
        },
        required: ["type", "hours"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_baby_info",
      description: "Wiek, imię i podstawowe informacje o dziecku.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weight_trend",
      description: "Pomiary wagi z ostatnich N dni z trendem.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Ile ostatnich dni" },
        },
        required: ["days"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_feeding_norms",
      description: "Normy karmienia AAP/WHO dla aktualnego wieku dziecka. Wywołaj gdy oceniasz czy karmienie jest prawidłowe.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
]

async function handleQueryTool(name: string, args: Record<string, unknown>, baby: Baby): Promise<unknown> {
  switch (name) {
    case "think":
      return { ok: true }

    case "get_baby_info": {
      const age = getBabyAge(baby.birthDate)
      return { name: baby.name, birthDate: baby.birthDate, age }
    }

    case "get_feedings": {
      const hours = (args.hours as number) || 24
      const since = new Date(Date.now() - hours * 3600 * 1000)
      const allFeedings = await db.query.events.findMany({
        where: and(
          eq(events.babyId, baby.id),
          eq(events.type, "feeding"),
          gte(events.occurredAt, since)
        ),
        orderBy: [desc(events.occurredAt)],
        limit: 200,
      })

      // Group into 3h clusters (process in ascending order)
      const CLUSTER_MS = 3 * 60 * 60 * 1000
      type Cluster = { feedingsCount: number; totalMl: number; start: Date; end: Date }
      const clusters: Cluster[] = []

      for (const f of [...allFeedings].reverse()) {
        const d = f.data as { amountMl?: number }
        const last = clusters[clusters.length - 1]
        if (last && f.occurredAt.getTime() - last.end.getTime() <= CLUSTER_MS) {
          last.feedingsCount++
          last.totalMl += d.amountMl ?? 0
          last.end = f.occurredAt
        } else {
          clusters.push({
            feedingsCount: 1,
            totalMl: d.amountMl ?? 0,
            start: f.occurredAt,
            end: f.occurredAt,
          })
        }
      }

      return {
        total: allFeedings.length,
        clusters: clusters.reverse().map((c) => ({
          feedingsCount: c.feedingsCount,
          totalMl: c.totalMl,
          start: c.start,
          end: c.end,
          lastFeedingMinutesAgo: Math.floor((Date.now() - c.end.getTime()) / 60000),
        })),
        rawRecent: allFeedings.slice(0, 5).map((e) => ({
          occurredAt: e.occurredAt,
          data: e.data,
          minutesAgo: Math.floor((Date.now() - e.occurredAt.getTime()) / 60000),
        })),
      }
    }

    case "get_events": {
      const type = args.type as string
      const hours = (args.hours as number) || 24
      const since = new Date(Date.now() - hours * 3600 * 1000)
      const rows = await db.query.events.findMany({
        where: and(
          eq(events.babyId, baby.id),
          eq(events.type, type as typeof events.$inferSelect["type"]),
          gte(events.occurredAt, since)
        ),
        orderBy: [desc(events.occurredAt)],
        limit: 20,
      })
      return rows.map((e) => ({
        occurredAt: e.occurredAt,
        data: e.data,
        minutesAgo: Math.floor((Date.now() - e.occurredAt.getTime()) / 60000),
      }))
    }

    case "get_weight_trend": {
      const days = (args.days as number) || 7
      const since = new Date(Date.now() - days * 24 * 3600 * 1000)
      const weights = await db.query.events.findMany({
        where: and(
          eq(events.babyId, baby.id),
          eq(events.type, "weight"),
          gte(events.occurredAt, since)
        ),
        orderBy: [desc(events.occurredAt)],
        limit: 20,
      })
      return weights.map((w) => ({
        date: w.occurredAt,
        grams: (w.data as { grams: number }).grams,
        kg: ((w.data as { grams: number }).grams / 1000).toFixed(3),
      }))
    }

    case "get_feeding_norms": {
      const age = getBabyAge(baby.birthDate)
      return getFeedingNorms(age.weeks)
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

async function handleQuery(question: string, baby: Baby): Promise<string> {
  const age = getBabyAge(baby.birthDate)
  const now = new Date()

  const systemPrompt = `Jesteś troskliwym asystentem rodziców noworodka ${baby.name} (wiek: ${age.label}).
Teraz jest: ${now.toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}

Odpowiadasz na pytania rodziców po polsku, ciepło i konkretnie.
Masz narzędzia do pobierania danych — używaj ich żeby odpowiedzieć dokładnie.
Zawsze najpierw wywołaj think() żeby zaplanować co sprawdzić, potem pobierz dane, potem odpowiedz.
Odpowiedź: naturalna narracja po polsku, jak troskliwy pediatra — nie lista danych.
Krótkie pytania (kiedy, ile): max 2-3 zdania. Podsumowania dnia: max 5-6 zdań. Tygodniowe: max 8-10 zdań.`

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: question },
  ]

  for (let step = 0; step < 8; step++) {
    const response = await openrouter.chat.completions.create({
      model: DEFAULT_MODEL,
      messages,
      tools: queryTools,
      tool_choice: "auto",
      temperature: 0.3,
    })

    const choice = response.choices[0]
    messages.push(choice.message)

    if (choice.finish_reason === "stop" || !choice.message.tool_calls?.length) {
      return choice.message.content ?? "Przepraszam, coś poszło nie tak."
    }

    const toolResults = await Promise.all(
      choice.message.tool_calls.map(async (tc) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn = (tc as any).function as { name: string; arguments: string }
        const toolArgs = JSON.parse(fn.arguments || "{}")
        const result = await handleQueryTool(fn.name, toolArgs, baby)
        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        }
      })
    )
    messages.push(...toolResults)
  }

  return "Przepraszam, nie udało mi się zebrać danych."
}

// ─── Telegram Update types ──────────────────────────────────────────────────

type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; first_name: string; username?: string }
    chat: { id: number; type: string; title?: string }
    date: number
    text?: string
  }
}
