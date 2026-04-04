/**
 * SMSAPI.pl integration
 * Docs: https://www.smsapi.com/docs/#sms-single
 * Auth: Bearer token (OAuth2)
 * Send endpoint: POST https://api.smsapi.com/sms.do (form-encoded params)
 * Phone format: 48XXXXXXXXX (no +, no leading 0)
 */

const SMSAPI_BASE_URL = "https://api.smsapi.pl"

function normalizePhone(phone: string): string {
  // Convert +48XXXXXXXXX → 48XXXXXXXXX (SMSAPI format)
  return phone.replace(/^\+/, "")
}

export async function sendSMS(to: string, message: string): Promise<boolean> {
  const token = process.env.SMSAPI_TOKEN
  const from = process.env.SMSAPI_SENDER || "Test"

  if (!token) {
    console.error("[SMS] SMSAPI_TOKEN not configured")
    return false
  }

  const params = new URLSearchParams({
    to: normalizePhone(to),
    message,
    from,
    format: "json",
  })

  try {
    const res = await fetch(`${SMSAPI_BASE_URL}/sms.do`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    })

    const data = await res.json()

    if (!res.ok || data.error) {
      console.error("[SMS] SMSAPI error:", data)
      return false
    }

    const status = data.list?.[0]?.status
    console.log(`[SMS] Sent to ${to}, status: ${status}`)
    return true
  } catch (err) {
    console.error("[SMS] Failed to send to", to, err)
    return false
  }
}

export async function sendToAllParents(message: string): Promise<void> {
  const phones = [
    process.env.PARENT1_PHONE,
    process.env.PARENT2_PHONE,
  ].filter(Boolean) as string[]

  await Promise.all(phones.map((phone) => sendSMS(phone, message)))
}
