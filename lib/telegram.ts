/**
 * Telegram Bot API integration
 * Docs: https://core.telegram.org/bots/api#sendmessage
 * Auth: Bot token in URL path
 * Send endpoint: POST https://api.telegram.org/bot<token>/sendMessage
 */

const TELEGRAM_API_BASE = "https://api.telegram.org"

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN

  if (!token) {
    console.error("[Telegram] TELEGRAM_BOT_TOKEN not configured")
    return false
  }

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    })

    const data = await res.json()

    if (!res.ok || !data.ok) {
      console.error("[Telegram] API error:", data)
      return false
    }

    console.log(`[Telegram] Sent to chat ${chatId}`)
    return true
  } catch (err) {
    console.error("[Telegram] Failed to send:", err)
    return false
  }
}

/**
 * Sends a message to the configured group.
 * Resolves chat ID in order:
 * 1. TELEGRAM_CHAT_ID env var (static config, fastest path)
 * 2. settings table key "telegram_chat_id" (auto-populated by webhook on first message)
 */
export async function sendToGroup(text: string): Promise<void> {
  let chatId = process.env.TELEGRAM_CHAT_ID ?? null

  if (!chatId) {
    try {
      const { db } = await import("./db")
      const { settings } = await import("./schema")
      const { eq } = await import("drizzle-orm")
      const row = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "telegram_chat_id"))
        .limit(1)
      chatId = row[0]?.value ?? null
    } catch (err) {
      console.error("[Telegram] Failed to look up chat_id from DB:", err)
    }
  }

  if (!chatId) {
    console.error("[Telegram] Brak chat_id — ustaw TELEGRAM_CHAT_ID lub wyślij wiadomość do bota")
    return
  }

  await sendTelegramMessage(chatId, text)
}
