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
  BarChart,
  Bar,
} from "recharts"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import EventFeed from "@/components/EventFeed"
import type { Event, FeedingData, WeightData, SleepData, Notification, AgentRun } from "@/lib/schema"
import { getWHOCentiles, getPercentileLabel } from "@/lib/who-data"
import jsPDF from "jspdf"

type RangeId = "7d" | "30d" | "3m"

const RANGES: { id: RangeId; label: string }[] = [
  { id: "7d", label: "7 dni" },
  { id: "30d", label: "30 dni" },
  { id: "3m", label: "3 miesiące" },
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

function groupByDay<T extends { occurredAt: Date | string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = format(new Date(item.occurredAt), "yyyy-MM-dd")
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  return map
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-gray-400">
      <span className="text-4xl">📊</span>
      <p className="text-sm text-center">{message}</p>
    </div>
  )
}

export default function ReportsPage() {
  const [range, setRange] = useState<RangeId>("30d")
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [babyName, setBabyName] = useState("Dziecko")
  const [birthDate, setBirthDate] = useState<Date | null>(null)
  const [gender, setGender] = useState<"M" | "F" | null>(null)
  const [historyFilters, setHistoryFilters] = useState<Set<string>>(new Set(ALL_EVENT_TYPES))
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([])

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
      .then((b) => {
        if (b?.name) setBabyName(b.name)
        if (b?.birthDate) setBirthDate(new Date(b.birthDate))
        if (b?.gender) setGender(b.gender)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch("/api/notifications?days=90&limit=200")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setNotifications(data) })
      .catch(() => {})
    fetch("/api/agent-runs?days=30&limit=50")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setAgentRuns(data) })
      .catch(() => {})
  }, [])

  // Filtered event sets
  const weightEvents = allEvents.filter((e) => e.type === "weight")
  const feedingEvents = allEvents.filter((e) => e.type === "feeding")
  const sleepEvents = allEvents.filter((e) => e.type === "sleep")

  // Weight chart data — dynamic WHO centile curves based on baby's actual age
  const weightChartData = [...weightEvents].reverse().map((e) => {
    const date = new Date(e.occurredAt)
    const grams = (e.data as WeightData).grams
    const weekAge = birthDate
      ? Math.floor((date.getTime() - birthDate.getTime()) / (7 * 24 * 3600 * 1000))
      : 0
    const who = getWHOCentiles(weekAge, gender)
    return {
      date: format(date, "dd.MM"),
      grams,
      fullDate: format(date, "d MMM yyyy", { locale: pl }),
      weekAge,
      p3: who.p3,
      p15: who.p15,
      p50: who.p50,
      p85: who.p85,
      p97: who.p97,
    }
  })

  // Current WHO centiles for baby's age now
  const currentWeekAge = birthDate
    ? Math.floor((Date.now() - birthDate.getTime()) / (7 * 24 * 3600 * 1000))
    : 0
  const currentWHO = getWHOCentiles(currentWeekAge, gender)
  const lastWeight = weightEvents[0]
  const lastWeightGrams = lastWeight ? (lastWeight.data as WeightData).grams : null
  const percentileLabel = lastWeightGrams ? getPercentileLabel(lastWeightGrams, currentWHO) : null

  // Feedings per day
  const feedingsByDay = groupByDay(feedingEvents)
  const feedingChartData = Array.from(feedingsByDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, evts]) => ({
      date: format(new Date(dateKey + "T12:00:00"), "dd.MM"),
      ilosc: evts.length,
    }))

  const avgFeedingsPerDay =
    feedingChartData.length > 0
      ? (feedingChartData.reduce((s, d) => s + d.ilosc, 0) / feedingChartData.length).toFixed(1)
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
          return sum + Math.round(
            (new Date(sd.endTime).getTime() - new Date(sd.startTime).getTime()) / 60000
          )
        }
        return sum
      }, 0)
      return {
        date: format(new Date(dateKey + "T12:00:00"), "dd.MM"),
        godziny: Math.round((totalMin / 60) * 10) / 10,
      }
    })

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
        if (y > 270) { doc.addPage(); y = 20 }
        doc.text(line, 10, y)
        y += size * 0.5 + 2
      }
    }

    addLine(`Raport Baby Monitor - ${babyName}`, 18, true)
    y += 4
    addLine(`Okres: ${format(fromDate, "dd.MM.yyyy")} - ${format(toDate, "dd.MM.yyyy")}`, 11)
    addLine(`Wygenerowano: ${format(new Date(), "dd.MM.yyyy HH:mm")}`, 10)
    y += 6
    addLine("Podsumowanie", 14, true)
    y += 2
    addLine(`Liczba karmien: ${feedingEvents.length}`)
    addLine(`Srednia karmien/dzien: ${avgFeedingsPerDay}`)
    if (lastWeightGrams) {
      addLine(`Ostatnia waga: ${lastWeightGrams}g — ${percentileLabel ?? ""}`)
    }
    addLine(`Liczba drzemek/snow: ${sleepEvents.length}`)
    y += 6
    addLine("Lista zdarzen", 14, true)
    y += 2
    doc.setFontSize(9)
    doc.setFont("helvetica", "bold")
    doc.text("Data", 10, y); doc.text("Godzina", 40, y)
    doc.text("Typ", 65, y); doc.text("Szczegoly", 110, y)
    y += 5
    doc.setLineWidth(0.3)
    doc.line(10, y, pageWidth - 10, y)
    y += 3
    doc.setFont("helvetica", "normal")
    for (const ev of allEvents.slice(0, 200)) {
      if (y > 270) { doc.addPage(); y = 20 }
      const d = new Date(ev.occurredAt)
      const details = formatEventDetails(ev.type, ev.data)
      doc.setFontSize(8)
      doc.text(format(d, "dd.MM.yyyy"), 10, y)
      doc.text(format(d, "HH:mm"), 40, y)
      doc.text(TYPE_LABELS[ev.type] ?? ev.type, 65, y)
      doc.text((doc.splitTextToSize(details, 80) as string[])[0] ?? "", 110, y)
      y += 5
    }
    doc.save(`baby-report-${format(new Date(), "yyyy-MM-dd")}.pdf`)
  }

  const toggleHistoryFilter = (type: string) => {
    setHistoryFilters((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  return (
    <div className="max-w-5xl mx-auto px-4 pt-6 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">Raporty</h1>
        <div className="flex gap-2">
          <button
            onClick={handleDownloadCSV}
            className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg px-3 py-1.5 font-medium hover:bg-green-100 transition-colors"
          >
            Pobierz CSV
          </button>
          <button
            onClick={handleDownloadPDF}
            className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5 font-medium hover:bg-blue-100 transition-colors"
          >
            Pobierz PDF
          </button>
        </div>
      </div>

      {/* Date range selector */}
      <div className="flex gap-2 mb-5">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={`text-xs rounded-full px-4 py-1.5 font-medium border transition-colors ${
              range === r.id
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <Tabs defaultValue="waga">
          <TabsList className="mb-5 w-full justify-start flex-wrap">
            <TabsTrigger value="waga">Waga</TabsTrigger>
            <TabsTrigger value="karmienia">Karmienia</TabsTrigger>
            <TabsTrigger value="sen">Sen</TabsTrigger>
            <TabsTrigger value="historia">Historia</TabsTrigger>
            <TabsTrigger value="sms">SMS</TabsTrigger>
          </TabsList>

          {/* WAGA TAB */}
          <TabsContent value="waga" className="flex flex-col gap-4">
            {/* WHO info card */}
            {birthDate && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                <p className="text-xs font-semibold text-blue-700 mb-2">
                  Normy WHO ({gender === "M" ? "chłopiec" : "dziewczynka"}, tydzień {currentWeekAge})
                </p>
                <div className="grid grid-cols-5 gap-1 text-center text-xs">
                  {[
                    { label: "P3", value: currentWHO.p3, color: "text-red-600" },
                    { label: "P15", value: currentWHO.p15, color: "text-orange-500" },
                    { label: "P50", value: currentWHO.p50, color: "text-green-600" },
                    { label: "P85", value: currentWHO.p85, color: "text-orange-500" },
                    { label: "P97", value: currentWHO.p97, color: "text-red-600" },
                  ].map((p) => (
                    <div key={p.label}>
                      <p className={`font-bold ${p.color}`}>{p.label}</p>
                      <p className="text-gray-600">{(p.value / 1000).toFixed(2)}kg</p>
                    </div>
                  ))}
                </div>
                {lastWeightGrams && (
                  <p className="text-xs text-blue-600 mt-2 text-center">
                    Ostatnia waga: <strong>{(lastWeightGrams / 1000).toFixed(3)}kg</strong> → <strong>{percentileLabel}</strong>
                  </p>
                )}
              </div>
            )}

            {weightChartData.length === 0 ? (
              <EmptyState message="Brak danych o wadze w wybranym okresie" />
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">
                  Wzrost wagi z krzywymi centylowymi WHO
                </h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={weightChartData} margin={{ top: 8, right: 24, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `${(v / 1000).toFixed(1)}kg` : `${v}g`
                      }
                    />
                    <Tooltip
                      formatter={(value, name) => {
                        const kg = (Number(value) / 1000).toFixed(3).replace(/\.?0+$/, "")
                        if (name === "grams") return [`${value}g (${kg}kg)`, "Waga"]
                        const labels: Record<string, string> = { p3: "P3", p15: "P15", p50: "P50 (mediana)", p85: "P85", p97: "P97" }
                        return [`${value}g (${kg}kg)`, labels[name as string] ?? name]
                      }}
                      labelFormatter={(label) => {
                        const found = weightChartData.find((d) => d.date === label)
                        return found ? `${found.fullDate} (tydzień ${found.weekAge})` : label
                      }}
                    />
                    {/* WHO centile lines */}
                    <Line type="monotone" dataKey="p97" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" dot={false} name="p97" />
                    <Line type="monotone" dataKey="p85" stroke="#f97316" strokeWidth={1} strokeDasharray="4 2" dot={false} name="p85" />
                    <Line type="monotone" dataKey="p50" stroke="#22c55e" strokeWidth={1} strokeDasharray="4 2" dot={false} name="p50" />
                    <Line type="monotone" dataKey="p15" stroke="#f97316" strokeWidth={1} strokeDasharray="4 2" dot={false} name="p15" />
                    <Line type="monotone" dataKey="p3" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" dot={false} name="p3" />
                    {/* Actual weight */}
                    <Line
                      type="monotone"
                      dataKey="grams"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      dot={{ r: 5, fill: "#3b82f6" }}
                      activeDot={{ r: 7 }}
                      name="grams"
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 mt-2 text-center">
                  Krzywe WHO dopasowane do wieku dziecka w dniu każdego pomiaru
                </p>
              </div>
            )}

            {/* Weight list */}
            {weightEvents.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Pomiary wagi</h2>
                <ul className="flex flex-col gap-2">
                  {weightEvents.slice(0, 10).map((e) => {
                    const g = (e.data as WeightData).grams
                    const date = new Date(e.occurredAt)
                    const wk = birthDate
                      ? Math.floor((date.getTime() - birthDate.getTime()) / (7 * 24 * 3600 * 1000))
                      : null
                    const who = wk !== null ? getWHOCentiles(wk, gender) : null
                    const pLabel = who ? getPercentileLabel(g, who) : null
                    return (
                      <li key={e.id} className="flex justify-between items-center text-sm">
                        <div>
                          <span className="text-gray-500">
                            {format(date, "d MMM yyyy, HH:mm", { locale: pl })}
                          </span>
                          {wk !== null && (
                            <span className="text-xs text-gray-400 ml-1">tydzień {wk}</span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="font-semibold text-gray-800">{g}g</span>
                          {pLabel && (
                            <span className="text-xs text-blue-500 ml-1.5">{pLabel}</span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </TabsContent>

          {/* KARMIENIA TAB */}
          <TabsContent value="karmienia" className="flex flex-col gap-4">
            <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-blue-600 font-medium">Średnia dziennie</p>
                <p className="text-3xl font-bold text-blue-700">{avgFeedingsPerDay}</p>
                <p className="text-xs text-blue-500">karmień</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-blue-600 font-medium">Łącznie</p>
                <p className="text-2xl font-bold text-blue-700">{feedingEvents.length}</p>
                <p className="text-xs text-blue-500">w tym okresie</p>
              </div>
            </div>

            {feedingChartData.length > 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Karmienia per dzień</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={feedingChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={(value) => [value, "Karmienia"]} />
                    <Bar dataKey="ilosc" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState message="Brak danych o karmieniach w wybranym okresie" />
            )}

            {last10Feedings.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Ostatnie 10 karmień</h2>
                <ul className="flex flex-col gap-2">
                  {last10Feedings.map((e) => {
                    const fd = e.data as FeedingData
                    const isBreast = fd.type === "breast"
                    return (
                      <li key={e.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
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
          </TabsContent>

          {/* SEN TAB */}
          <TabsContent value="sen" className="flex flex-col gap-4">
            {sleepChartData.length === 0 ? (
              <EmptyState message="Brak danych o śnie w wybranym okresie" />
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Godziny snu per dzień</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={sleepChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} unit="h" />
                    <Tooltip formatter={(value) => [`${value}h`, "Sen"]} />
                    <Bar dataKey="godziny" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {sleepEvents.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Okresy snu</h2>
                <ul className="flex flex-col gap-2">
                  {sleepEvents.slice(0, 15).map((e) => {
                    const sd = e.data as SleepData
                    const hasDuration = sd.startTime && sd.endTime
                    let durationLabel = "—"
                    if (hasDuration) {
                      const diffMin = Math.round(
                        (new Date(sd.endTime!).getTime() - new Date(sd.startTime!).getTime()) / 60000
                      )
                      const h = Math.floor(diffMin / 60)
                      const m = diffMin % 60
                      durationLabel = h > 0 ? `${h}h ${m}min` : `${m}min`
                    } else if (sd.startTime) {
                      durationLabel = "W trakcie..."
                    }
                    return (
                      <li key={e.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base">😴</span>
                          <p className="text-xs text-gray-400">
                            {format(new Date(e.occurredAt), "d MMM, HH:mm", { locale: pl })}
                          </p>
                        </div>
                        <span className="font-semibold text-purple-600 text-sm">{durationLabel}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </TabsContent>

          {/* HISTORIA TAB */}
          <TabsContent value="historia" className="flex flex-col gap-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Filtruj typy</h2>
              <div className="flex flex-wrap gap-2">
                {ALL_EVENT_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={historyFilters.has(type)}
                      onChange={() => toggleHistoryFilter(type)}
                      className="w-3.5 h-3.5 accent-blue-500"
                    />
                    <span className="text-xs text-gray-600">{TYPE_LABELS[type]}</span>
                  </label>
                ))}
              </div>
            </div>

            <EventFeed events={historyEvents} />
          </TabsContent>

          {/* SMS TAB */}
          <TabsContent value="sms" className="flex flex-col gap-4">
            {notifications.length === 0 ? (
              <EmptyState message="Brak wysłanych powiadomień w ciągu ostatnich 90 dni" />
            ) : (
              <>
                {/* Weekly reports */}
                {notifications.some((n) => n.type.includes("weekly")) && (
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3">
                      Raporty tygodniowe
                    </h2>
                    <ul className="flex flex-col gap-3">
                      {notifications
                        .filter((n) => n.type.includes("weekly"))
                        .map((n) => (
                          <li key={n.id} className="flex flex-col gap-1 p-3 bg-blue-50 rounded-xl border border-blue-100">
                            <p className="text-xs text-blue-500 font-medium">
                              {format(new Date(n.sentAt), "d MMM yyyy, HH:mm", { locale: pl })}
                            </p>
                            <p className="text-sm text-gray-800 leading-relaxed">{n.message}</p>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {/* Agent run log */}
                {agentRuns.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3">
                      Logi agenta — ostatnie 30 dni ({agentRuns.length} uruchomień)
                    </h2>
                    <ul className="flex flex-col divide-y divide-gray-50">
                      {agentRuns.map((run) => {
                        const actions = Array.isArray(run.actionsPerformed) ? run.actionsPerformed as string[] : []
                        const modelShort = typeof run.model === "string"
                          ? run.model.split("/").pop() ?? run.model
                          : "—"
                        return (
                          <li key={run.id} className="py-2.5 flex flex-col gap-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-gray-400">
                                {format(new Date(run.ranAt), "d MMM, HH:mm", { locale: pl })}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-300">{run.stepsCount} kroków</span>
                                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">
                                  {modelShort}
                                </span>
                              </div>
                            </div>
                            {actions.length > 0 ? (
                              <ul className="flex flex-col gap-0.5">
                                {actions.map((a, i) => (
                                  <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                                    <span className="text-green-500 mt-0.5">✓</span>
                                    <span>{a}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-xs text-gray-300 italic">Brak akcji — wszystko OK</p>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {/* All SMS history */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">
                    Wszystkie powiadomienia SMS ({notifications.length})
                  </h2>
                  <ul className="flex flex-col divide-y divide-gray-50">
                    {notifications.map((n) => {
                      const isWeekly = n.type.includes("weekly")
                      const typeLabel: Record<string, string> = {
                        feeding_reminder: "Karmienie",
                        weight_reminder: "Waga",
                        bath_reminder: "Kąpiel",
                        temperature_alert: "Temperatura",
                        weekly_summary: "Raport tygodniowy",
                      }
                      const label = typeLabel[n.type] ?? n.type
                      return (
                        <li key={n.id} className="py-3 flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              isWeekly
                                ? "bg-blue-100 text-blue-600"
                                : "bg-gray-100 text-gray-500"
                            }`}>
                              {label}
                            </span>
                            <span className="text-xs text-gray-400 shrink-0">
                              {format(new Date(n.sentAt), "d MMM, HH:mm", { locale: pl })}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 leading-relaxed">{n.message}</p>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
