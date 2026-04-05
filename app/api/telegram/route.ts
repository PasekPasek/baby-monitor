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
import { eq } from "drizzle-orm"

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

  // 6. Save event to DB
  await db.insert(events).values({
    id: crypto.randomUUID(),
    babyId: baby.id,
    type: classified.type as typeof events.$inferInsert["type"],
    data: classified.data,
    occurredAt: classified.occurredAt,
    source: "telegram",
  })

  // 7. Log notification
  await db.insert(notifications).values({
    id: crypto.randomUUID(),
    babyId: baby.id,
    type: `telegram_incoming_${classified.type}`,
    channel: "telegram",
    message: text,
    sentTo: chatId,
    triggeredBy: "incoming_sms",
  })

  // 8. Send confirmation back to the group
  await sendTelegramMessage(chatId, classified.confirmationMessage)

  return ok()
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
