import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { settings } from "@/lib/schema"
import { eq } from "drizzle-orm"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rows = await db.select().from(settings)
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }

  return NextResponse.json(result)
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()

  if (typeof body !== "object" || Array.isArray(body) || body === null) {
    return NextResponse.json({ error: "Nieprawidłowe dane" }, { status: 400 })
  }

  const entries = Object.entries(body) as [string, string][]

  for (const [key, value] of entries) {
    if (typeof key !== "string" || typeof value !== "string") continue

    await db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      })
  }

  return NextResponse.json({ ok: true })
}
