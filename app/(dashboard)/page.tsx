import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getOrCreateBaby } from "@/lib/baby"
import { events } from "@/lib/schema"
import { desc, eq } from "drizzle-orm"
import BabyAge from "@/components/BabyAge"
import EventFeed from "@/components/EventFeed"
import type { Event } from "@/lib/schema"

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} godz.`
  return `${hours} godz. ${minutes} min`
}

function getLastFeedingInfo(recentEvents: Event[]): {
  label: string
  urgency: "green" | "yellow" | "red" | "none"
} {
  const lastFeeding = recentEvents.find((e) => e.type === "feeding")
  if (!lastFeeding) {
    return { label: "Brak danych o karmieniu", urgency: "none" }
  }

  const diffMs = Date.now() - new Date(lastFeeding.occurredAt).getTime()
  const label = `${formatDuration(diffMs)} temu`
  const hours = diffMs / 3600000

  let urgency: "green" | "yellow" | "red"
  if (hours < 2) urgency = "green"
  else if (hours < 3) urgency = "yellow"
  else urgency = "red"

  return { label, urgency }
}

const urgencyStyles = {
  green: {
    card: "bg-green-50 border-green-200",
    dot: "bg-green-500",
    text: "text-green-700",
    label: "text-green-600",
  },
  yellow: {
    card: "bg-yellow-50 border-yellow-200",
    dot: "bg-yellow-500",
    text: "text-yellow-700",
    label: "text-yellow-600",
  },
  red: {
    card: "bg-red-50 border-red-200",
    dot: "bg-red-500 animate-pulse",
    text: "text-red-700",
    label: "text-red-600",
  },
  none: {
    card: "bg-gray-50 border-gray-200",
    dot: "bg-gray-400",
    text: "text-gray-600",
    label: "text-gray-500",
  },
}

export default async function DashboardPage() {
  const [, baby] = await Promise.all([auth(), getOrCreateBaby()])

  const recentEvents = await db.query.events.findMany({
    where: eq(events.babyId, baby.id),
    orderBy: [desc(events.occurredAt)],
    limit: 20,
  })

  const { label: feedingLabel, urgency } = getLastFeedingInfo(recentEvents)
  const styles = urgencyStyles[urgency]

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-5">
      {/* Baby age header */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4">
        <BabyAge birthDate={baby.birthDate} name={baby.name} />
      </div>

      {/* Last feeding card */}
      <div className={`rounded-2xl border px-4 py-3.5 flex items-center gap-3 ${styles.card}`}>
        <div className="flex-shrink-0">
          <span className="text-2xl" aria-hidden="true">🍼</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium uppercase tracking-wide ${styles.label}`}>
            Ostatnie karmienie
          </p>
          <p className={`text-base font-semibold mt-0.5 ${styles.text}`}>
            {feedingLabel}
          </p>
        </div>
        <div
          className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${styles.dot}`}
          aria-hidden="true"
        />
      </div>

      {/* Event feed */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">
          Ostatnie zdarzenia
        </h2>
        <EventFeed events={recentEvents} />
      </section>
    </div>
  )
}
