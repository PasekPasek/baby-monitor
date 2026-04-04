import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { babies } from "@/lib/schema"
import { getOrCreateBaby } from "@/lib/baby"
import { eq } from "drizzle-orm"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const baby = await getOrCreateBaby()
  return NextResponse.json(baby)
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const baby = await getOrCreateBaby()
  const body = await req.json()

  const updates: Partial<typeof babies.$inferInsert> = {}

  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim()
  }
  if (typeof body.birthDate === "string" && body.birthDate) {
    updates.birthDate = new Date(body.birthDate)
  }
  if (body.gender === "M" || body.gender === "F") {
    updates.gender = body.gender
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Brak danych do aktualizacji" }, { status: 400 })
  }

  const [updated] = await db
    .update(babies)
    .set(updates)
    .where(eq(babies.id, baby.id))
    .returning()

  return NextResponse.json(updated)
}
