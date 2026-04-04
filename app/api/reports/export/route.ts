import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { events } from "@/lib/schema"
import { getOrCreateBaby } from "@/lib/baby"
import { desc, eq, and, gte, lte } from "drizzle-orm"
import { format } from "date-fns"

function formatDetailsPolish(type: string, data: unknown): string {
  if (!data || typeof data !== "object") return ""
  const d = data as Record<string, unknown>

  switch (type) {
    case "feeding": {
      if (d.type === "breast") {
        const side = d.side ? ` strona ${d.side}` : ""
        const duration = d.durationMin ? ` ${d.durationMin} min` : ""
        return `Karmienie piersią${side}${duration}`
      }
      if (d.type === "bottle") {
        const amount = d.amountMl ? ` ${d.amountMl} ml` : ""
        return `Butelka${amount}`
      }
      return "Karmienie"
    }
    case "sleep": {
      if (d.startTime && d.endTime) {
        const start = new Date(String(d.startTime))
        const end = new Date(String(d.endTime))
        const totalMin = Math.round((end.getTime() - start.getTime()) / 60000)
        const h = Math.floor(totalMin / 60)
        const m = totalMin % 60
        const duration = h > 0 ? `${h}h ${m}min` : `${m}min`
        return `Sen ${duration}`
      }
      if (d.startTime && !d.endTime) return "Sen (w trakcie)"
      return "Sen"
    }
    case "weight": {
      const grams = Number(d.grams)
      if (!grams) return "Waga"
      return `Waga ${grams}g (${(grams / 1000).toFixed(3).replace(/\.?0+$/, "")}kg)`
    }
    case "height": {
      return d.cm ? `Wzrost ${d.cm} cm` : "Wzrost"
    }
    case "head_circumference": {
      return d.cm ? `Obwód głowy ${d.cm} cm` : "Obwód głowy"
    }
    case "bath": {
      return d.notes ? `Kąpiel - ${d.notes}` : "Kąpiel"
    }
    case "diaper": {
      const typeMap: Record<string, string> = {
        wet: "Mokra",
        dirty: "Brudna",
        both: "Mokra i brudna",
      }
      const label = typeMap[String(d.type)] ?? String(d.type)
      return `Pielucha - ${label}${d.color ? ` (${d.color})` : ""}`
    }
    case "milestone": {
      return d.description
        ? `Kamień milowy: ${d.description}${d.category ? ` [${d.category}]` : ""}`
        : "Kamień milowy"
    }
    case "health": {
      const subtypeMap: Record<string, string> = {
        temperature: "Temperatura",
        medication: "Lek",
        vaccine: "Szczepienie",
        test_result: "Wynik badania",
        doctor_visit: "Wizyta u lekarza",
      }
      const subtype = subtypeMap[String(d.subtype)] ?? String(d.subtype)
      const value = d.value != null ? ` ${d.value}${d.unit ?? ""}` : ""
      const notes = d.notes ? ` - ${d.notes}` : ""
      return `${subtype}${value}${notes}`
    }
    case "note": {
      return d.text ? `Notatka: ${d.text}` : "Notatka"
    }
    default:
      return JSON.stringify(data)
  }
}

const typeLabels: Record<string, string> = {
  feeding: "Karmienie",
  sleep: "Sen",
  weight: "Waga",
  height: "Wzrost",
  head_circumference: "Obwód głowy",
  bath: "Kąpiel",
  diaper: "Pielucha",
  milestone: "Kamień milowy",
  health: "Zdrowie",
  note: "Notatka",
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type") ?? "all"
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  const baby = await getOrCreateBaby()

  const conditions = [eq(events.babyId, baby.id)]

  if (type !== "all") {
    const typeMap: Record<string, string> = {
      feeding: "feeding",
      weight: "weight",
      sleep: "sleep",
    }
    const mappedType = typeMap[type]
    if (mappedType) {
      conditions.push(
        eq(events.type, mappedType as typeof events.$inferSelect["type"])
      )
    }
  }

  if (from) conditions.push(gte(events.occurredAt, new Date(from)))
  if (to) conditions.push(lte(events.occurredAt, new Date(to)))

  const rows = await db.query.events.findMany({
    where: and(...conditions),
    orderBy: [desc(events.occurredAt)],
    limit: 2000,
  })

  const csvRows: string[] = [
    ["data", "godzina", "typ", "szczegoly"].join(";"),
  ]

  for (const row of rows) {
    const occurredAt = new Date(row.occurredAt)
    const date = format(occurredAt, "dd.MM.yyyy")
    const time = format(occurredAt, "HH:mm")
    const typLabel = typeLabels[row.type] ?? row.type
    const details = formatDetailsPolish(row.type, row.data)

    const escapeCsv = (val: string) => {
      if (val.includes(";") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`
      }
      return val
    }

    csvRows.push(
      [date, time, typLabel, details].map(escapeCsv).join(";")
    )
  }

  const csv = csvRows.join("\n")
  const filename = `baby-report-${format(new Date(), "yyyy-MM-dd")}.csv`

  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
