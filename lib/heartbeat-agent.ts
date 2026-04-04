/**
 * Heartbeat AI Agent — runs every 30 minutes via cron-job.org
 * Checks baby data and sends SMS reminders when needed.
 * Pattern from AI-devs course: tool-calling agent loop.
 *
 * Improvements:
 * - Propozycja 3: Agent memory (read_memory / write_memory tools)
 * - Propozycja 4: SMART_MODEL for weekly summary, DEFAULT_MODEL for regular checks
 * - Propozycja 5: Decision log saved to agent_runs table after each run
 */
import { openrouter, DEFAULT_MODEL, SMART_MODEL } from "./openrouter"
import { db } from "./db"
import { events, notifications, agentMemory, agentRuns } from "./schema"
import { getOrCreateBaby, getBabyAge } from "./baby"
import { sendToAllParents } from "./sms"
import { desc, eq, and, gte, or, isNull } from "drizzle-orm"
import type OpenAI from "openai"

const MAX_STEPS = 15

// ─── Tool definitions ──────────────────────────────────────────────────────

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_last_event",
      description: "Pobiera ostatnie zdarzenie danego typu. Zwraca czas i dane lub null.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["feeding", "sleep", "weight", "height", "bath", "diaper", "milestone", "health", "note"],
            description: "Typ zdarzenia",
          },
        },
        required: ["type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_events_summary",
      description: "Zwraca podsumowanie zdarzeń z ostatnich N godzin.",
      parameters: {
        type: "object",
        properties: {
          hours: { type: "number", description: "Ile ostatnich godzin" },
          type: { type: "string", description: "Opcjonalny filtr na typ zdarzenia" },
        },
        required: ["hours"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_baby_info",
      description: "Zwraca wiek dziecka i podstawowe informacje.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_notification_sent",
      description: "Sprawdza czy dane powiadomienie było już wysłane w ciągu ostatnich N minut. Zwraca true/false.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "Typ powiadomienia" },
          withinMinutes: { type: "number", description: "Sprawdź w ciągu ilu minut" },
        },
        required: ["type", "withinMinutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_sms",
      description: "Wysyła SMS do obu rodziców. Używaj tylko gdy naprawdę potrzebne.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Treść SMS (max 160 znaków)" },
          notificationType: { type: "string", description: "Typ powiadomienia do logowania (np. 'feeding_reminder')" },
        },
        required: ["message", "notificationType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weekly_stats",
      description: "Zwraca statystyki z ostatnich 7 dni: waga, karmienia, sen, kąpiele. Używaj do cotygodniowego podsumowania.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  // ─── Propozycja 3: Agent memory tools ───────────────────────────────────
  {
    type: "function",
    function: {
      name: "read_memory",
      description: "Odczytuje zapamiętane obserwacje i wzorce z poprzednich uruchomień agenta. Używaj na początku każdego uruchomienia.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_memory",
      description: "Zapisuje nową obserwację, wzorzec lub decyzję do długoterminowej pamięci agenta. Używaj gdy zauważysz coś ważnego.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["observation", "pattern", "decision"],
            description: "observation=jednorazowa obserwacja, pattern=powtarzający się wzorzec, decision=podjęta decyzja i jej uzasadnienie",
          },
          content: {
            type: "string",
            description: "Treść po polsku, max 200 znaków. Np. 'Zuzia regularnie robi 4h przerwy nocne od 7 dni'",
          },
          relevantDays: {
            type: "number",
            description: "Przez ile dni ta obserwacja jest istotna. Domyślnie 30.",
          },
        },
        required: ["type", "content"],
      },
    },
  },
]

// ─── Tool handlers ─────────────────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, unknown>) {
  const baby = await getOrCreateBaby()

  switch (name) {
    case "get_baby_info": {
      const age = getBabyAge(baby.birthDate)
      return { name: baby.name, birthDate: baby.birthDate, age }
    }

    case "get_last_event": {
      const type = args.type as string
      const last = await db.query.events.findFirst({
        where: and(
          eq(events.babyId, baby.id),
          eq(events.type, type as typeof events.$inferSelect["type"])
        ),
        orderBy: [desc(events.occurredAt)],
      })
      if (!last) return null
      return {
        id: last.id,
        occurredAt: last.occurredAt,
        data: last.data,
        minutesAgo: Math.floor((Date.now() - last.occurredAt.getTime()) / 60000),
      }
    }

    case "get_events_summary": {
      const hours = (args.hours as number) || 24
      const since = new Date(Date.now() - hours * 3600 * 1000)
      const conditions = [eq(events.babyId, baby.id), gte(events.occurredAt, since)]
      if (args.type) {
        conditions.push(eq(events.type, args.type as typeof events.$inferSelect["type"]))
      }
      const rows = await db.query.events.findMany({
        where: and(...conditions),
        orderBy: [desc(events.occurredAt)],
        limit: 50,
      })
      return rows.map((e) => ({ type: e.type, occurredAt: e.occurredAt, data: e.data }))
    }

    case "check_notification_sent": {
      const type = args.type as string
      const minutes = (args.withinMinutes as number) || 30
      const since = new Date(Date.now() - minutes * 60000)
      const last = await db.query.notifications.findFirst({
        where: and(
          eq(notifications.babyId, baby.id),
          eq(notifications.type, type),
          gte(notifications.sentAt, since)
        ),
        orderBy: [desc(notifications.sentAt)],
      })
      return { alreadySent: !!last, lastSentAt: last?.sentAt ?? null }
    }

    case "send_sms": {
      const message = args.message as string
      const notType = args.notificationType as string
      await sendToAllParents(message)
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        babyId: baby.id,
        type: notType,
        channel: "sms",
        message,
        triggeredBy: "heartbeat",
      })
      return { sent: true }
    }

    case "get_weekly_stats": {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000)
      const allEvents = await db.query.events.findMany({
        where: and(eq(events.babyId, baby.id), gte(events.occurredAt, since)),
        orderBy: [desc(events.occurredAt)],
        limit: 200,
      })
      const feedings = allEvents.filter((e) => e.type === "feeding")
      const weights = allEvents.filter((e) => e.type === "weight")
      const baths = allEvents.filter((e) => e.type === "bath")
      const milestones = allEvents.filter((e) => e.type === "milestone")
      const health = allEvents.filter((e) => e.type === "health")

      return {
        feedings: {
          count: feedings.length,
          perDay: Math.round((feedings.length / 7) * 10) / 10,
          events: feedings.slice(0, 5),
        },
        weights: weights.map((w) => ({ date: w.occurredAt, data: w.data })),
        baths: { count: baths.length },
        milestones: milestones.map((m) => ({ date: m.occurredAt, data: m.data })),
        healthEvents: health.map((h) => ({ date: h.occurredAt, data: h.data })),
      }
    }

    // ─── Propozycja 3: Memory handlers ──────────────────────────────────

    case "read_memory": {
      const now = new Date()
      const memories = await db.query.agentMemory.findMany({
        where: and(
          eq(agentMemory.babyId, baby.id),
          or(
            isNull(agentMemory.relevantUntil),
            gte(agentMemory.relevantUntil, now)
          )
        ),
        orderBy: [desc(agentMemory.createdAt)],
        limit: 20,
      })
      if (memories.length === 0) return { memories: [], note: "Brak zapamiętanych obserwacji." }
      return {
        memories: memories.map((m) => ({
          type: m.type,
          content: m.content,
          createdAt: m.createdAt,
        })),
      }
    }

    case "write_memory": {
      const type = args.type as "observation" | "pattern" | "decision"
      const content = args.content as string
      const days = (args.relevantDays as number) || 30
      const relevantUntil = new Date(Date.now() + days * 24 * 3600 * 1000)

      await db.insert(agentMemory).values({
        id: crypto.randomUUID(),
        babyId: baby.id,
        type,
        content: content.slice(0, 500),
        relevantUntil,
      })
      return { saved: true }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ─── Agent loop ────────────────────────────────────────────────────────────

export async function runHeartbeatAgent(): Promise<{ actionsPerformed: string[] }> {
  const baby = await getOrCreateBaby()
  const age = getBabyAge(baby.birthDate)
  const now = new Date()
  const isWeeklySummaryDay = now.getDay() === 0 && now.getHours() >= 19 && now.getHours() <= 21

  // Propozycja 4: Use SMART_MODEL for weekly summary (better quality reasoning)
  const model = isWeeklySummaryDay ? SMART_MODEL : DEFAULT_MODEL

  const systemPrompt = `Jesteś troskliwym asystentem monitorującym noworodka ${baby.name} (wiek: ${age.label}, urodzony ${baby.birthDate.toLocaleDateString("pl-PL")}).

Teraz jest: ${now.toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}

ZAWSZE zaczynaj od wywołania read_memory() — sprawdź co zapamiętałeś z poprzednich uruchomień.

Twoje zadania w tej chwili:
1. Sprawdź kiedy było ostatnie karmienie i czy należy wysłać przypomnienie
2. Sprawdź czy kąpiel była w ciągu ostatnich 3 dni
3. Sprawdź czy waga była mierzona w ciągu ostatnich 2 dni
4. Sprawdź czy temperatura > 37.5°C (ostatnie zdarzenie health)
${isWeeklySummaryDay ? "5. ⭐ DZISIAJ jest niedziela wieczór — wygeneruj COTYGODNIOWE PODSUMOWANIE z zaleceniami i wyślij SMS" : ""}

ZASADY WAGI:
- jeśli ostatni pomiar wagi > 2 dni temu → wyślij SMS "⚖️ Czas zważyć ${baby.name}! Ostatnie ważenie było ponad 2 dni temu."
- wyślij max 1 taki SMS dziennie (sprawdź check_notification_sent typ: 'weight_reminder', 1440 minut)

ZASADY KARMIENIA dla noworodka (ilość → kiedy przypomnieć):
- < 30ml lub < 10 min pierś → 1.5h, SMS z ostrzeżeniem "mało"
- 30-60ml lub 10-20 min pierś → 2h
- 60-90ml lub 20-30 min pierś → 3h
- > 90ml lub > 30 min pierś → 3.5h

PAMIĘĆ:
- Po każdym uruchomieniu zapisz istotne obserwacje (write_memory)
- Jeśli widzisz powtarzający się wzorzec (np. Zuzia je mniej w nocy) — zapisz jako "pattern"
- Jeśli podejmujesz niestandardową decyzję — zapisz jako "decision" z uzasadnieniem
- Jeśli zapamiętany wzorzec tłumaczy brak alertu (np. nocna przerwa w jedzeniu to norma) — nie wysyłaj SMS

WAŻNE:
- Zawsze najpierw sprawdź check_notification_sent przed wysłaniem SMS (unikaj duplikatów)
- SMS max 160 znaków
- Cotygodniowe podsumowanie może być dłuższe (użyj dwóch SMS jeśli potrzeba)
- Zakończ po wykonaniu wszystkich sprawdzeń

COTYGODNIOWE PODSUMOWANIE FORMAT:
"📊 Tydzień ${baby.name}: [dane wagi], karmień/dzień: X, kąpieli: Y. [Zalecenia]. ⚕️ To nie jest porada medyczna."`

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: "Wykonaj swoje zadania." },
  ]

  const actionsPerformed: string[] = []
  let stepsCount = 0

  for (let step = 0; step < MAX_STEPS; step++) {
    stepsCount++
    const response = await openrouter.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.2,
    })

    const choice = response.choices[0]
    messages.push(choice.message)

    if (choice.finish_reason === "stop" || !choice.message.tool_calls?.length) {
      break
    }

    // Execute all tool calls in parallel (AI-devs pattern)
    const toolResults = await Promise.all(
      choice.message.tool_calls.map(async (tc) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn = (tc as any).function as { name: string; arguments: string }
        const args = JSON.parse(fn.arguments || "{}")
        const result = await handleTool(fn.name, args)
        if (fn.name === "send_sms") {
          actionsPerformed.push(`SMS: ${args.message}`)
        }
        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        }
      })
    )

    messages.push(...toolResults)
  }

  // Propozycja 5: Save decision log to agent_runs table
  try {
    await db.insert(agentRuns).values({
      id: crypto.randomUUID(),
      babyId: baby.id,
      actionsPerformed,
      stepsCount,
      model,
      triggeredBy: "cron",
    })
  } catch {
    // Don't fail the run if logging fails
  }

  return { actionsPerformed }
}
