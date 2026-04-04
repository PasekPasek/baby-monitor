import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { notifications } from "@/lib/schema"
import { getOrCreateBaby } from "@/lib/baby"
import { desc, eq, gte } from "drizzle-orm"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500)
  const days = Number(searchParams.get("days") ?? "90")

  const baby = await getOrCreateBaby()
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)

  const rows = await db.query.notifications.findMany({
    where: (t, { and }) =>
      and(eq(t.babyId, baby.id), gte(t.sentAt, since)),
    orderBy: [desc(notifications.sentAt)],
    limit,
  })

  return NextResponse.json(rows)
}
