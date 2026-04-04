import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { events } from "@/lib/schema"
import { getOrCreateBaby } from "@/lib/baby"
import { desc, eq, and, gte, lte } from "drizzle-orm"
import { z } from "zod"

const createEventSchema = z.object({
  type: z.enum(["feeding", "sleep", "weight", "height", "head_circumference", "bath", "diaper", "milestone", "health", "note"]),
  data: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime().optional(),
})

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type")
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500)

  const baby = await getOrCreateBaby()

  const conditions = [eq(events.babyId, baby.id)]
  if (type) conditions.push(eq(events.type, type as typeof events.$inferSelect["type"]))
  if (from) conditions.push(gte(events.occurredAt, new Date(from)))
  if (to) conditions.push(lte(events.occurredAt, new Date(to)))

  const rows = await db.query.events.findMany({
    where: and(...conditions),
    orderBy: [desc(events.occurredAt)],
    limit,
  })

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const parsed = createEventSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const baby = await getOrCreateBaby()
  const { type, data, occurredAt } = parsed.data

  const [event] = await db.insert(events).values({
    id: crypto.randomUUID(),
    babyId: baby.id,
    createdBy: session.user.id,
    type,
    data,
    occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    source: "ui",
  }).returning()

  return NextResponse.json(event, { status: 201 })
}
