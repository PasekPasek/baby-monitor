/**
 * SMSAPI.pl incoming SMS webhook (MO - Mobile Originated)
 * Docs: https://www.smsapi.com/blog/receiving-sms-online-developer-guide/
 *
 * SMSAPI sends form-encoded POST with:
 *   sms_from  — sender phone (format: 48XXXXXXXXX)
 *   sms_to    — your 2-way number
 *   sms_text  — message body
 *   sms_date  — unix timestamp
 *   MsgId     — message ID
 *
 * Must respond with plain text "OK" to acknowledge receipt.
 */
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { events, notifications } from "@/lib/schema"
import { getOrCreateBaby } from "@/lib/baby"
import { classifySMS } from "@/lib/sms-agent"
import { sendSMS } from "@/lib/sms"

const allowedPhones = [
  process.env.PARENT1_PHONE,
  process.env.PARENT2_PHONE,
].filter(Boolean) as string[]

function normalizeForComparison(phone: string): string {
  // Strip +, spaces, leading zeros for comparison
  return phone.replace(/[\s+]/g, "").replace(/^0+/, "")
}

export async function POST(req: NextRequest) {
  // SMSAPI sends form-encoded body
  const formData = await req.formData()
  const smsFrom = formData.get("sms_from") as string   // e.g. "48501234567"
  const smsText = formData.get("sms_text") as string
  const msgId   = formData.get("MsgId") as string | null

  if (!smsFrom || !smsText) {
    return new NextResponse("OK", { status: 200 })
  }

  // Verify sender is a known parent
  const isAllowed = allowedPhones.some(
    (p) => normalizeForComparison(p) === normalizeForComparison(smsFrom)
  )

  if (!isAllowed) {
    console.warn("[SMS] Rejected message from unknown number:", smsFrom)
    // Still return OK so SMSAPI doesn't retry
    return new NextResponse("OK", { status: 200 })
  }

  const baby = await getOrCreateBaby()
  const classified = await classifySMS(smsText, smsFrom, baby.name)

  if (!classified) {
    // Send error response via separate API call
    const fromPhone = `+${smsFrom}`
    await sendSMS(
      fromPhone,
      "Nie rozumiem. Spróbuj: 'karmienie 60ml', 'kąpiel', 'waga 3.5kg'"
    )
    return new NextResponse("OK", { status: 200 })
  }

  // Save event to DB
  await db.insert(events).values({
    id: crypto.randomUUID(),
    babyId: baby.id,
    type: classified.type as typeof events.$inferInsert["type"],
    data: classified.data,
    occurredAt: classified.occurredAt,
    source: "sms",
  })

  // Log notification
  await db.insert(notifications).values({
    id: crypto.randomUUID(),
    babyId: baby.id,
    type: `sms_incoming_${classified.type}`,
    channel: "sms",
    message: smsText,
    sentTo: smsFrom,
    triggeredBy: "incoming_sms",
  })

  // Send confirmation back to parent
  await sendSMS(`+${smsFrom}`, classified.confirmationMessage)

  // SMSAPI requires "OK" response to acknowledge receipt
  return new NextResponse("OK", { status: 200 })
}
