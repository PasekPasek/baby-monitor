"use client"

import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns"
import { pl } from "date-fns/locale"
import EventIcon from "./EventIcon"
import type { Event } from "@/lib/schema"

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

function formatEventData(type: string, data: unknown): string {
  if (!data || typeof data !== "object") return ""
  const d = data as Record<string, unknown>

  switch (type) {
    case "feeding": {
      if (d.type === "breast") {
        const side = d.side ? ` ${d.side}` : ""
        const duration = d.durationMin ? ` ${d.durationMin}min` : ""
        return `Pierś${side}${duration}`
      }
      if (d.type === "bottle") {
        const amount = d.amountMl ? ` ${d.amountMl}ml` : ""
        return `Butelka${amount}`
      }
      return ""
    }
    case "weight": {
      const grams = Number(d.grams)
      if (!grams) return ""
      return `${grams}g (${(grams / 1000).toFixed(2).replace(/\.?0+$/, "")}kg)`
    }
    case "height": {
      return d.cm ? `${d.cm} cm` : ""
    }
    case "head_circumference": {
      return d.cm ? `${d.cm} cm` : ""
    }
    case "diaper": {
      const diaperMap: Record<string, string> = {
        wet: "Mokra",
        dirty: "Brudna",
        both: "Obie",
      }
      return diaperMap[String(d.type)] ?? String(d.type)
    }
    case "health": {
      const subtype = d.subtype ? String(d.subtype) : ""
      const value = d.value != null ? ` ${d.value}${d.unit ? d.unit : ""}` : ""
      return `${subtype}${value}`.trim()
    }
    case "sleep": {
      if (d.startTime && d.endTime) {
        const start = new Date(String(d.startTime))
        const end = new Date(String(d.endTime))
        const diffMs = end.getTime() - start.getTime()
        const totalMin = Math.round(diffMs / 60000)
        const h = Math.floor(totalMin / 60)
        const m = totalMin % 60
        if (h > 0 && m > 0) return `${h}h ${m}min`
        if (h > 0) return `${h}h`
        return `${m}min`
      }
      if (d.startTime && !d.endTime) return "Śpi..."
      return ""
    }
    case "milestone": {
      return d.description ? String(d.description) : ""
    }
    case "note": {
      return d.text ? String(d.text) : ""
    }
    case "bath": {
      return d.notes ? String(d.notes) : ""
    }
    default: {
      return JSON.stringify(data)
    }
  }
}

function formatTimeAgo(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true, locale: pl })
}

function getDayLabel(date: Date): string {
  if (isToday(date)) return "Dzisiaj"
  if (isYesterday(date)) return "Wczoraj"
  return format(date, "EEEE, d MMMM", { locale: pl })
}

function groupEventsByDay(events: Event[]): Map<string, Event[]> {
  const groups = new Map<string, Event[]>()
  for (const event of events) {
    const dateKey = format(new Date(event.occurredAt), "yyyy-MM-dd")
    const existing = groups.get(dateKey) ?? []
    existing.push(event)
    groups.set(dateKey, existing)
  }
  return groups
}

interface EventFeedProps {
  events: Event[]
  onDelete?: (id: string) => void
}

export default function EventFeed({ events, onDelete }: EventFeedProps) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-gray-400">
        <span className="text-4xl">📋</span>
        <p className="text-sm">Brak zdarzeń do wyświetlenia</p>
      </div>
    )
  }

  const grouped = groupEventsByDay(events)

  return (
    <div className="flex flex-col gap-4">
      {Array.from(grouped.entries()).map(([dateKey, dayEvents]) => {
        const dayDate = new Date(dateKey + "T12:00:00")
        return (
          <section key={dateKey}>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
              {getDayLabel(dayDate)}
            </h3>
            <ul className="flex flex-col gap-2">
              {dayEvents.map((event) => {
                const summary = formatEventData(event.type, event.data)
                const occurredAt = new Date(event.occurredAt)
                return (
                  <li
                    key={event.id}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 flex items-center gap-3"
                  >
                    {/* Icon */}
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
                      <EventIcon type={event.type} className="text-xl" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-800">
                          {typeLabels[event.type] ?? event.type}
                        </span>
                        <span className="text-xs text-gray-400 flex-shrink-0">
                          {format(occurredAt, "HH:mm")}
                        </span>
                      </div>
                      {summary && (
                        <p className="text-sm text-gray-500 truncate mt-0.5">
                          {summary}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatTimeAgo(occurredAt)}
                      </p>
                    </div>

                    {/* Delete button */}
                    {onDelete && (
                      <button
                        onClick={() => onDelete(event.id)}
                        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-red-300"
                        aria-label="Usuń zdarzenie"
                        title="Usuń"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                        </svg>
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
