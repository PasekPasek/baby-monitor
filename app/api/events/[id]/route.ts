import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { events } from "@/lib/schema"
import { eq } from "drizzle-orm"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  await db.delete(events).where(eq(events.id, id))
  return NextResponse.json({ ok: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()

  const [updated] = await db.update(events)
    .set({
      data: body.data,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
    })
    .where(eq(events.id, id))
    .returning()

  return NextResponse.json(updated)
}
