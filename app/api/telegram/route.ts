/**
 * Telegram Bot webhook handler
 * Telegram sends a POST with a JSON Update object for every incoming message.
 * Must always respond with HTTP 200 — otherwise Telegram retries indefinitely.
 *
 * Security: X-Telegram-Bot-Api-Secret-Token header verified against TELEGRAM_WEBHOOK_SECRET env var.
 * Chat validation: only messages from TELEGRAM_CHAT_ID (or auto-discovered group) are processed.
 */
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { events, notifications, settings } from "@/lib/schema"
import { getOrCreateBaby } from "@/lib/baby"
import { classifySMS } from "@/lib/sms-agent"
import { sendTelegramMessage } from "@/lib/telegram"
import { eq, and, desc } from "drizzle-orm"
import type { Baby } from "@/lib/schema"

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

  // 6. Handle queries separately — look up DB and respond, don't save as event
  if (classified.type === "query") {
    const queryData = classified.data as { queryType: string; question: string }
    const answer = await handleQuery(queryData.queryType, baby)
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

  // 9. Send confirmation back to the group
  await sendTelegramMessage(chatId, classified.confirmationMessage)

  return ok()
}

// ─── Query handler ──────────────────────────────────────────────────────────

async function handleQuery(queryType: string, baby: Baby): Promise<string> {
  const fmt = (d: Date) =>
    d.toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" })

  const minutesAgo = (d: Date) => {
    const m = Math.floor((Date.now() - d.getTime()) / 60000)
    if (m < 60) return `${m} min temu`
    const h = Math.floor(m / 60)
    const rest = m % 60
    return rest > 0 ? `${h}h ${rest}min temu` : `${h}h temu`
  }

  switch (queryType) {
    case "last_feeding": {
      const last = await db.query.events.findFirst({
        where: and(eq(events.babyId, baby.id), eq(events.type, "feeding")),
        orderBy: [desc(events.occurredAt)],
      })
      if (!last) return "Brak danych o karmieniu."
      const d = last.data as { type?: string; amountMl?: number; durationMin?: number; side?: string }
      const details = d.type === "bottle"
        ? `butelka ${d.amountMl ?? "?"}ml`
        : `pierś${d.side ? ` (${d.side})` : ""}${d.durationMin ? ` ${d.durationMin}min` : ""}`
      return `🍼 Ostatnie karmienie: ${details}\n⏰ ${fmt(last.occurredAt)} (${minutesAgo(last.occurredAt)})`
    }

    case "last_weight": {
      const last = await db.query.events.findFirst({
        where: and(eq(events.babyId, baby.id), eq(events.type, "weight")),
        orderBy: [desc(events.occurredAt)],
      })
      if (!last) return "Brak danych o wadze."
      const d = last.data as { grams: number }
      return `⚖️ Ostatnia waga: ${(d.grams / 1000).toFixed(3)} kg\n📅 ${fmt(last.occurredAt)} (${minutesAgo(last.occurredAt)})`
    }

    case "last_bath": {
      const last = await db.query.events.findFirst({
        where: and(eq(events.babyId, baby.id), eq(events.type, "bath")),
        orderBy: [desc(events.occurredAt)],
      })
      if (!last) return "Brak danych o kąpieli."
      return `🛁 Ostatnia kąpiel: ${fmt(last.occurredAt)} (${minutesAgo(last.occurredAt)})`
    }

    case "last_sleep": {
      const last = await db.query.events.findFirst({
        where: and(eq(events.babyId, baby.id), eq(events.type, "sleep")),
        orderBy: [desc(events.occurredAt)],
      })
      if (!last) return "Brak danych o śnie."
      return `😴 Ostatni sen: ${fmt(last.occurredAt)} (${minutesAgo(last.occurredAt)})`
    }

    case "summary": {
      const since = new Date(Date.now() - 24 * 3600 * 1000)
      const recent = await db.query.events.findMany({
        where: and(eq(events.babyId, baby.id)),
        orderBy: [desc(events.occurredAt)],
        limit: 20,
      })
      const last24 = recent.filter((e) => e.occurredAt >= since)
      const feedings = last24.filter((e) => e.type === "feeding")
      const lastFeeding = recent.find((e) => e.type === "feeding")
      const lastWeight = recent.find((e) => e.type === "weight")

      const weightInfo = lastWeight
        ? `⚖️ Waga: ${((lastWeight.data as { grams: number }).grams / 1000).toFixed(3)} kg`
        : "⚖️ Brak pomiaru wagi"
      const feedInfo = lastFeeding
        ? `🍼 Ostatnie karmienie: ${minutesAgo(lastFeeding.occurredAt)}`
        : "🍼 Brak danych o karmieniu"

      return `📊 ${baby.name} — ostatnie 24h:\n${feedInfo}\nKarmień dziś: ${feedings.length}\n${weightInfo}`
    }

    default:
      return "Nie rozumiem pytania. Spróbuj: 'kiedy karmienie?', 'ile waży?', 'kiedy kąpiel?'"
  }
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
