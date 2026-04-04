"use client"

import { useState, useEffect, useCallback } from "react"
import { format, subDays, subMonths, startOfDay, endOfDay } from "date-fns"
import { pl } from "date-fns/locale"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
  Legend,
} from "recharts"
import EventFeed from "@/components/EventFeed"
import type { Event, FeedingData, WeightData, SleepData } from "@/lib/schema"
import jsPDF from "jspdf"

// WHO growth reference percentiles for girls (approximate, 0-12 weeks)
// Values in grams: [weekAge, P3, P15, P50, P85, P97]
const WHO_GIRL_PERCENTILES = [
  { week: 0, P3: 2400, P15: 2800, P50: 3300, P85: 3800, P97: 4200 },
  { week: 2, P3: 2700, P15: 3100, P50: 3700, P85: 4300, P97: 4800 },
  { week: 4, P3: 3200, P15: 3700, P50: 4500, P85: 5200, P97: 5800 },
  { week: 8, P3: 4000, P15: 4700, P50: 5700, P85: 6600, P97: 7300 },
  { week: 12, P3: 4700, P15: 5500, P50: 6600, P85: 7700, P97: 8500 },
]

// WHO growth reference percentiles for boys (approximate, 0-12 weeks)
const WHO_BOY_PERCENTILES = [
  { week: 0, P3: 2500, P15: 2900, P50: 3400, P85: 3900, P97: 4300 },
  { week: 2, P3: 2900, P15: 3300, P50: 4000, P85: 4700, P97: 5200 },
  { week: 4, P3: 3500, P15: 4100, P50: 5000, P85: 5800, P97: 6400 },
  { week: 8, P3: 4400, P15: 5200, P50: 6200, P85: 7200, P97: 8000 },
  { week: 12, P3: 5200, P15: 6100, P50: 7200, P85: 8300, P97: 9200 },
]

type TabId = "waga" | "karmienia" | "sen" | "historia"
type RangeId = "7d" | "30d" | "3m"

const TABS: { id: TabId; label: string }[] = [
  { id: "waga", label: "Waga" },
  { id: "karmienia", label: "Karmienia" },
  { id: "sen", label: "Sen" },
  { id: "historia", label: "Historia" },
]

const RANGES: { id: RangeId; label: string }[] = [
  { id: "7d", label: "Ostatnie 7 dni" },
  { id: "30d", label: "Ostatnie 30 dni" },
  { id: "3m", label: "Ostatnie 3 miesiące" },
]

const TYPE_LABELS: Record<string, string> = {
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

const ALL_EVENT_TYPES = Object.keys(TYPE_LABELS)

function getRangeFrom(rangeId: RangeId): Date {
  const now = new Date()
  if (rangeId === "7d") return subDays(now, 7)
  if (rangeId === "30d") return subDays(now, 30)
  return subMonths(now, 3)
}

function formatEventDetails(type: string, data: unknown): string {
  if (!data || typeof data !== "object") return ""
  const d = data as Record<string, unknown>
  switch (type) {
    case "feeding": {
      const fd = d as FeedingData
      if (fd.type === "breast") {
        return `Pierś${fd.side ? ` ${fd.side}` : ""}${fd.durationMin ? ` ${fd.durationMin}min` : ""}`
      }
      return `Butelka${fd.amountMl ? ` ${fd.amountMl}ml` : ""}`
    }
    case "weight":
      return `${(d as WeightData).grams}g`
    case "sleep": {
      const sd = d as SleepData
      if (sd.startTime && sd.endTime) {
        const diffMin = Math.round(
          (new Date(sd.endTime).getTime() - new Date(sd.startTime).getTime()) / 60000
        )
        const h = Math.floor(diffMin / 60)
        const m = diffMin % 60
        return h > 0 ? `${h}h ${m}min` : `${m}min`
      }
      return sd.startTime ? "W trakcie" : ""
    }
    case "health": {
      const val = d.value != null ? ` ${d.value}${d.unit ?? ""}` : ""
      return `${d.subtype ?? ""}${val}`
    }
    case "note":
      return String(d.text ?? "")
    case "diaper": {
      const map: Record<string, string> = { wet: "Mokra", dirty: "Brudna", both: "Obie" }
      return map[String(d.type)] ?? String(d.type)
    }
    case "milestone":
      return String(d.description ?? "")
    default:
      return ""
  }
}

// Group events by calendar day
function groupByDay<T extends { occurredAt: Date | string }>(
  items: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = format(new Date(item.occurredAt), "yyyy-MM-dd")
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  return map
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("waga")
  const [range, setRange] = useState<RangeId>("30d")
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [babyName, setBabyName] = useState("Dziecko")
  const [historyFilters, setHistoryFilters] = useState<Set<string>>(
    new Set(ALL_EVENT_TYPES)
  )

  const fromDate = getRangeFrom(range)
  const toDate = endOfDay(new Date())

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const from = startOfDay(getRangeFrom(range)).toISOString()
      const to = toDate.toISOString()
      const res = await fetch(`/api/events?from=${from}&to=${to}&limit=500`)
      if (res.ok) {
        const data: Event[] = await res.json()
        setAllEvents(data)
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [range]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  useEffect(() => {
    fetch("/api/baby")
      .then((r) => r.json())
      .then((b) => { if (b?.name) setBabyName(b.name) })
      .catch(() => {})
  }, [])

  // Filtered event sets
  const weightEvents = allEvents.filter((e) => e.type === "weight")
  const feedingEvents = allEvents.filter((e) => e.type === "feeding")
  const sleepEvents = allEvents.filter((e) => e.type === "sleep")

  // Weight chart data
  const weightChartData = [...weightEvents]
    .reverse()
    .map((e) => ({
      date: format(new Date(e.occurredAt), "dd.MM"),
      grams: (e.data as WeightData).grams,
      fullDate: format(new Date(e.occurredAt), "d MMM yyyy", { locale: pl }),
    }))

  // Feedings per day
  const feedingsByDay = groupByDay(feedingEvents)
  const feedingChartData = Array.from(feedingsByDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, evts]) => ({
      date: format(new Date(dateKey + "T12:00:00"), "dd.MM"),
      ilosc: evts.length,
      mlTotal: evts.reduce((sum, e) => {
        const fd = e.data as FeedingData
        return sum + (fd.amountMl ?? 0)
      }, 0),
    }))

  const avgFeedingsPerDay =
    feedingChartData.length > 0
      ? (
          feedingChartData.reduce((s, d) => s + d.ilosc, 0) /
          feedingChartData.length
        ).toFixed(1)
      : "0"

  const last10Feedings = feedingEvents.slice(0, 10)

  // Sleep chart data
  const sleepByDay = groupByDay(sleepEvents)
  const sleepChartData = Array.from(sleepByDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, evts]) => {
      const totalMin = evts.reduce((sum, e) => {
        const sd = e.data as SleepData
        if (sd.startTime && sd.endTime) {
          return (
            sum +
            Math.round(
              (new Date(sd.endTime).getTime() -
                new Date(sd.startTime).getTime()) /
                60000
            )
          )
        }
        return sum
      }, 0)
      return {
        date: format(new Date(dateKey + "T12:00:00"), "dd.MM"),
        godziny: Math.round((totalMin / 60) * 10) / 10,
      }
    })

  // History filtered
  const historyEvents = allEvents.filter((e) => historyFilters.has(e.type))

  // CSV download
  const handleDownloadCSV = async () => {
    const from = startOfDay(fromDate).toISOString()
    const to = toDate.toISOString()
    const url = `/api/reports/export?type=all&from=${from}&to=${to}`
    const res = await fetch(url)
    if (!res.ok) return
    const blob = await res.blob()
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = `baby-report-${format(new Date(), "yyyy-MM-dd")}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  // PDF download
  const handleDownloadPDF = () => {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    let y = 20

    const addLine = (text: string, size = 11, bold = false) => {
      doc.setFontSize(size)
      doc.setFont("helvetica", bold ? "bold" : "normal")
      const lines = doc.splitTextToSize(text, pageWidth - 20) as string[]
      for (const line of lines) {
        if (y > 270) {
          doc.addPage()
          y = 20
        }
        doc.text(line, 10, y)
        y += size * 0.5 + 2
      }
    }

    // Title
    addLine(`Raport Baby Monitor - ${babyName}`, 18, true)
    y += 4

    // Date range
    addLine(
      `Okres: ${format(fromDate, "dd.MM.yyyy")} - ${format(toDate, "dd.MM.yyyy")}`,
      11
    )
    addLine(`Wygenerowano: ${format(new Date(), "dd.MM.yyyy HH:mm")}`, 10)
    y += 6

    // Summary stats
    addLine("Podsumowanie", 14, true)
    y += 2
    addLine(`Liczba karmien: ${feedingEvents.length}`)
    addLine(`Srednia karmien/dzien: ${avgFeedingsPerDay}`)
    if (weightEvents.length > 0) {
      const lastWeight = weightEvents[0]
      addLine(
        `Ostatnia waga: ${(lastWeight.data as WeightData).grams}g (${format(
          new Date(lastWeight.occurredAt),
          "dd.MM.yyyy"
        )})`
      )
    }
    addLine(`Liczba drzemek/snow: ${sleepEvents.length}`)
    y += 6

    // Events table
    addLine("Lista zdarzen", 14, true)
    y += 2

    // Table header
    doc.setFontSize(9)
    doc.setFont("helvetica", "bold")
    doc.text("Data", 10, y)
    doc.text("Godzina", 40, y)
    doc.text("Typ", 65, y)
    doc.text("Szczegoly", 110, y)
    y += 5
    doc.setLineWidth(0.3)
    doc.line(10, y, pageWidth - 10, y)
    y += 3

    doc.setFont("helvetica", "normal")
    for (const ev of allEvents.slice(0, 200)) {
      if (y > 270) {
        doc.addPage()
        y = 20
      }
      const d = new Date(ev.occurredAt)
      const details = formatEventDetails(ev.type, ev.data)
      doc.setFontSize(8)
      doc.text(format(d, "dd.MM.yyyy"), 10, y)
      doc.text(format(d, "HH:mm"), 40, y)
      doc.text(TYPE_LABELS[ev.type] ?? ev.type, 65, y)
      const detailText = doc.splitTextToSize(details, 80) as string[]
      doc.text(detailText[0] ?? "", 110, y)
      y += 5
    }

    doc.save(`baby-report-${format(new Date(), "yyyy-MM-dd")}.pdf`)
  }

  const toggleHistoryFilter = (type: string) => {
    setHistoryFilters((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">Raporty</h1>
        <div className="flex gap-2">
          <button
            onClick={handleDownloadCSV}
            className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg px-3 py-1.5 font-medium active:bg-green-100 transition-colors"
          >
            Pobierz CSV
          </button>
          <button
            onClick={handleDownloadPDF}
            className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5 font-medium active:bg-blue-100 transition-colors"
          >
            Pobierz PDF
          </button>
        </div>
      </div>

      {/* Date range selector */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={`flex-shrink-0 text-xs rounded-full px-3 py-1.5 font-medium border transition-colors ${
              range === r.id
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-white text-gray-600 border-gray-200 active:bg-gray-50"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4 -mx-4 px-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* WAGA TAB */}
          {activeTab === "waga" && (
            <div className="flex flex-col gap-4">
              {weightChartData.length === 0 ? (
                <EmptyState message="Brak danych o wadze w wybranym okresie" />
              ) : (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">
                    Wzrost wagi (WHO P3–P97)
                  </h2>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={weightChartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v: number) =>
                          v >= 1000 ? `${(v / 1000).toFixed(1)}kg` : `${v}g`
                        }
                      />
                      <Tooltip
                        formatter={(value) => [
                          `${value}g (${(Number(value) / 1000).toFixed(3).replace(/\.?0+$/, "")}kg)`,
                          "Waga",
                        ]}
                        labelFormatter={(label) => {
                          const found = weightChartData.find((d) => d.date === label)
                          return found?.fullDate ?? label
                        }}
                      />
                      {/* WHO reference lines */}
                      <ReferenceLine y={WHO_GIRL_PERCENTILES[0].P3} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "P3", position: "right", fontSize: 9, fill: "#ef4444" }} />
                      <ReferenceLine y={WHO_GIRL_PERCENTILES[0].P15} stroke="#f97316" strokeDasharray="4 2" label={{ value: "P15", position: "right", fontSize: 9, fill: "#f97316" }} />
                      <ReferenceLine y={WHO_GIRL_PERCENTILES[0].P50} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "P50", position: "right", fontSize: 9, fill: "#22c55e" }} />
                      <ReferenceLine y={WHO_GIRL_PERCENTILES[0].P85} stroke="#f97316" strokeDasharray="4 2" label={{ value: "P85", position: "right", fontSize: 9, fill: "#f97316" }} />
                      <ReferenceLine y={WHO_GIRL_PERCENTILES[0].P97} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "P97", position: "right", fontSize: 9, fill: "#ef4444" }} />
                      <Line
                        type="monotone"
                        dataKey="grams"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 5, fill: "#3b82f6", cursor: "pointer" }}
                        activeDot={{ r: 7 }}
                        name="Waga"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-gray-400 mt-2 text-center">
                    Linie referencyjne WHO dla noworodkow (0 tyg.)
                  </p>
                </div>
              )}

              {/* Weight list */}
              {weightEvents.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">Pomiary wagi</h2>
                  <ul className="flex flex-col gap-2">
                    {weightEvents.slice(0, 10).map((e) => {
                      const grams = (e.data as WeightData).grams
                      return (
                        <li key={e.id} className="flex justify-between text-sm">
                          <span className="text-gray-500">
                            {format(new Date(e.occurredAt), "d MMM yyyy, HH:mm", { locale: pl })}
                          </span>
                          <span className="font-semibold text-gray-800">
                            {grams}g
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* KARMIENIA TAB */}
          {activeTab === "karmienia" && (
            <div className="flex flex-col gap-4">
              {/* Stats card */}
              <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-blue-600 font-medium">Srednia dziennie</p>
                  <p className="text-3xl font-bold text-blue-700">{avgFeedingsPerDay}</p>
                  <p className="text-xs text-blue-500">karmien</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-blue-600 font-medium">Lacznie</p>
                  <p className="text-2xl font-bold text-blue-700">{feedingEvents.length}</p>
                  <p className="text-xs text-blue-500">w tym okresie</p>
                </div>
              </div>

              {/* Bar chart */}
              {feedingChartData.length > 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">
                    Karmienia per dzien
                  </h2>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={feedingChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(value) => [value, "Karmienia"]}
                      />
                      <Bar dataKey="ilosc" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState message="Brak danych o karmieniach w wybranym okresie" />
              )}

              {/* Last 10 feedings */}
              {last10Feedings.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">
                    Ostatnie 10 karmien
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {last10Feedings.map((e) => {
                      const fd = e.data as FeedingData
                      const isBreast = fd.type === "breast"
                      return (
                        <li
                          key={e.id}
                          className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">{isBreast ? "🤱" : "🍼"}</span>
                            <div>
                              <p className="text-gray-700 font-medium">
                                {isBreast
                                  ? `Pierś${fd.side ? ` ${fd.side}` : ""}${fd.durationMin ? ` · ${fd.durationMin}min` : ""}`
                                  : `Butelka${fd.amountMl ? ` · ${fd.amountMl}ml` : ""}`}
                              </p>
                              <p className="text-xs text-gray-400">
                                {format(new Date(e.occurredAt), "d MMM, HH:mm", { locale: pl })}
                              </p>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* SEN TAB */}
          {activeTab === "sen" && (
            <div className="flex flex-col gap-4">
              {sleepChartData.length === 0 ? (
                <EmptyState message="Brak danych o snie w wybranym okresie" />
              ) : (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">
                    Godziny snu per dzien
                  </h2>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={sleepChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} unit="h" />
                      <Tooltip
                        formatter={(value) => [`${value}h`, "Sen"]}
                      />
                      <Bar dataKey="godziny" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Sleep list */}
              {sleepEvents.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">
                    Okresy snu
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {sleepEvents.slice(0, 15).map((e) => {
                      const sd = e.data as SleepData
                      const hasDuration = sd.startTime && sd.endTime
                      let durationLabel = "—"
                      if (hasDuration) {
                        const diffMin = Math.round(
                          (new Date(sd.endTime!).getTime() -
                            new Date(sd.startTime!).getTime()) /
                            60000
                        )
                        const h = Math.floor(diffMin / 60)
                        const m = diffMin % 60
                        durationLabel = h > 0 ? `${h}h ${m}min` : `${m}min`
                      } else if (sd.startTime) {
                        durationLabel = "W trakcie..."
                      }
                      return (
                        <li
                          key={e.id}
                          className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">😴</span>
                            <p className="text-xs text-gray-400">
                              {format(new Date(e.occurredAt), "d MMM, HH:mm", { locale: pl })}
                            </p>
                          </div>
                          <span className="font-semibold text-purple-600 text-sm">
                            {durationLabel}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* HISTORIA TAB */}
          {activeTab === "historia" && (
            <div className="flex flex-col gap-4">
              {/* Type filters */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">
                  Filtruj typy
                </h2>
                <div className="flex flex-wrap gap-2">
                  {ALL_EVENT_TYPES.map((type) => (
                    <label key={type} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={historyFilters.has(type)}
                        onChange={() => toggleHistoryFilter(type)}
                        className="w-3.5 h-3.5 accent-blue-500"
                      />
                      <span className="text-xs text-gray-600">
                        {TYPE_LABELS[type]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <EventFeed events={historyEvents} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-gray-400">
      <span className="text-4xl">📊</span>
      <p className="text-sm text-center">{message}</p>
    </div>
  )
}
