"use client"

import { useState, useCallback, useEffect, useRef } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType =
  | "feeding"
  | "diaper"
  | "sleep"
  | "bath"
  | "weight"
  | "health"
  | "milestone"
  | "note"

interface QuickButton {
  type: EventType
  label: string
  icon: string
}

// ─── Quick action grid ────────────────────────────────────────────────────────

const quickButtons: QuickButton[] = [
  { type: "feeding", label: "Karmienie", icon: "🍼" },
  { type: "diaper", label: "Pielucha", icon: "🧷" },
  { type: "sleep", label: "Sen", icon: "😴" },
  { type: "bath", label: "Kąpiel", icon: "🛁" },
  { type: "weight", label: "Waga", icon: "⚖️" },
  { type: "health", label: "Temperatura", icon: "🌡️" },
  { type: "milestone", label: "Kamień milowy", icon: "⭐" },
  { type: "note", label: "Notatka", icon: "📝" },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function postEvent(type: string, data: Record<string, unknown>, occurredAt: string) {
  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data, occurredAt: new Date(occurredAt).toISOString() }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error ?? "Błąd serwera")
  }
  return res.json()
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastState {
  message: string
  type: "success" | "error"
  id: number
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [toast.id, onClose])

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all duration-300 max-w-[calc(100vw-2rem)] text-center ${
        toast.type === "success" ? "bg-green-500" : "bg-red-500"
      }`}
      role="alert"
    >
      {toast.message}
    </div>
  )
}

// ─── Bottom Sheet ─────────────────────────────────────────────────────────────

interface BottomSheetProps {
  title: string
  onClose: () => void
  children: React.ReactNode
}

function BottomSheet({ title, onClose, children }: BottomSheetProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Close on backdrop click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [])

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md bg-white rounded-t-2xl shadow-xl overflow-hidden">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Zamknij"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 pb-8 max-h-[80vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── Form fields ──────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1.5">
      {children}
    </label>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent placeholder:text-gray-400 ${props.className ?? ""}`}
    />
  )
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      rows={3}
      className={`w-full border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent placeholder:text-gray-400 resize-none ${props.className ?? ""}`}
    />
  )
}

interface RadioGroupProps {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  name: string
}

function RadioGroup({ options, value, onChange, name }: RadioGroupProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 min-w-[80px] py-3 px-3 rounded-xl border text-sm font-medium transition-colors ${
            value === opt.value
              ? "bg-blue-500 border-blue-500 text-white"
              : "bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-500"
          }`}
          aria-pressed={value === opt.value}
          name={name}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function SubmitButton({
  loading,
  children,
}: {
  loading: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full py-3.5 rounded-xl bg-blue-500 text-white font-semibold text-base hover:bg-blue-600 active:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-2 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
    >
      {loading ? "Zapisywanie..." : children}
    </button>
  )
}

// ─── Individual forms ─────────────────────────────────────────────────────────

function FeedingForm({ onSave }: { onSave: (data: Record<string, unknown>, t: string) => Promise<void> }) {
  const [feedType, setFeedType] = useState<"breast" | "bottle">("breast")
  const [side, setSide] = useState<"L" | "R">("L")
  const [duration, setDuration] = useState("")
  const [amount, setAmount] = useState("")
  const [time, setTime] = useState(toLocalDateTimeString(new Date()))
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const data: Record<string, unknown> = { type: feedType }
    if (feedType === "breast") {
      data.side = side
      if (duration) data.durationMin = Number(duration)
    } else {
      if (amount) data.amountMl = Number(amount)
    }
    await onSave(data, time)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label>Sposób karmienia</Label>
        <RadioGroup
          name="feedType"
          value={feedType}
          onChange={(v) => setFeedType(v as "breast" | "bottle")}
          options={[
            { value: "breast", label: "Pierś" },
            { value: "bottle", label: "Butelka" },
          ]}
        />
      </div>

      {feedType === "breast" ? (
        <>
          <div>
            <Label>Strona</Label>
            <RadioGroup
              name="side"
              value={side}
              onChange={(v) => setSide(v as "L" | "R")}
              options={[
                { value: "L", label: "Lewa (L)" },
                { value: "R", label: "Prawa (R)" },
              ]}
            />
          </div>
          <div>
            <Label>Czas karmienia (minuty)</Label>
            <Input
              type="number"
              placeholder="np. 15"
              min="1"
              max="120"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        </>
      ) : (
        <div>
          <Label>Ilość (ml)</Label>
          <Input
            type="number"
            placeholder="np. 60"
            min="1"
            max="500"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      )}

      <div>
        <Label>Godzina</Label>
        <Input
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </div>

      <SubmitButton loading={loading}>Zapisz karmienie</SubmitButton>
    </form>
  )
}

function DiaperForm({ onSave }: { onSave: (data: Record<string, unknown>, t: string) => Promise<void> }) {
  const [diaperType, setDiaperType] = useState<"wet" | "dirty" | "both">("wet")
  const [time, setTime] = useState(toLocalDateTimeString(new Date()))
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await onSave({ type: diaperType }, time)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label>Typ pieluszki</Label>
        <RadioGroup
          name="diaperType"
          value={diaperType}
          onChange={(v) => setDiaperType(v as "wet" | "dirty" | "both")}
          options={[
            { value: "wet", label: "Mokra" },
            { value: "dirty", label: "Brudna" },
            { value: "both", label: "Obie" },
          ]}
        />
      </div>

      <div>
        <Label>Godzina</Label>
        <Input
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </div>

      <SubmitButton loading={loading}>Zapisz pieluchę</SubmitButton>
    </form>
  )
}

function SleepForm({
  onSave,
  activeSleep,
}: {
  onSave: (data: Record<string, unknown>, t: string) => Promise<void>
  activeSleep: { id: string; startTime: string } | null
}) {
  const [time, setTime] = useState(toLocalDateTimeString(new Date()))
  const [loading, setLoading] = useState(false)

  const isSleeping = activeSleep !== null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    if (isSleeping) {
      // End sleep — update via separate call or just log end
      await onSave(
        { startTime: activeSleep!.startTime, endTime: new Date(time).toISOString() },
        time
      )
    } else {
      await onSave({ startTime: new Date(time).toISOString() }, time)
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="text-center py-2">
        <span className="text-5xl">{isSleeping ? "☀️" : "🌙"}</span>
        <p className="text-sm text-gray-500 mt-2">
          {isSleeping
            ? "Dziecko śpi od " + new Date(activeSleep!.startTime).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
            : "Dziecko nie śpi"}
        </p>
      </div>

      <div>
        <Label>{isSleeping ? "Godzina wstania" : "Godzina zaśnięcia"}</Label>
        <Input
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className={`w-full py-4 rounded-xl font-semibold text-base text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 ${
          isSleeping
            ? "bg-yellow-500 hover:bg-yellow-600 focus:ring-yellow-400"
            : "bg-blue-500 hover:bg-blue-600 focus:ring-blue-400"
        }`}
      >
        {loading ? "Zapisywanie..." : isSleeping ? "Wstała 🌞" : "Zasnęła 🌙"}
      </button>
    </form>
  )
}

function BathForm({ onSave }: { onSave: (data: Record<string, unknown>, t: string) => Promise<void> }) {
  const [notes, setNotes] = useState("")
  const [time, setTime] = useState(toLocalDateTimeString(new Date()))
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await onSave({ notes: notes.trim() || undefined }, time)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label>Notatki (opcjonalne)</Label>
        <Textarea
          placeholder="np. kąpiel wieczorna, szampon..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div>
        <Label>Godzina</Label>
        <Input
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </div>

      <SubmitButton loading={loading}>Zapisz kąpiel</SubmitButton>
    </form>
  )
}

function WeightForm({ onSave }: { onSave: (data: Record<string, unknown>, t: string) => Promise<void> }) {
  const [unit, setUnit] = useState<"g" | "kg">("g")
  const [value, setValue] = useState("")
  const [time, setTime] = useState(toLocalDateTimeString(new Date()))
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const grams = unit === "kg" ? Math.round(Number(value) * 1000) : Number(value)
    await onSave({ grams }, time)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label>Jednostka</Label>
        <RadioGroup
          name="unit"
          value={unit}
          onChange={(v) => setUnit(v as "g" | "kg")}
          options={[
            { value: "g", label: "Gramy (g)" },
            { value: "kg", label: "Kilogramy (kg)" },
          ]}
        />
      </div>

      <div>
        <Label>Waga ({unit})</Label>
        <Input
          type="number"
          placeholder={unit === "g" ? "np. 3500" : "np. 3.5"}
          step={unit === "kg" ? "0.001" : "1"}
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
      </div>

      <div>
        <Label>Godzina</Label>
        <Input
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </div>

      <SubmitButton loading={loading}>Zapisz wagę</SubmitButton>
    </form>
  )
}

function HealthForm({ onSave }: { onSave: (data: Record<string, unknown>, t: string) => Promise<void> }) {
  const [tempValue, setTempValue] = useState("")
  const [notes, setNotes] = useState("")
  const [time, setTime] = useState(toLocalDateTimeString(new Date()))
  const [loading, setLoading] = useState(false)

  const temp = Number(tempValue)
  const isFever = tempValue !== "" && temp > 37.5

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await onSave(
      {
        subtype: "temperature",
        value: temp,
        unit: "°C",
        notes: notes.trim() || "",
      },
      time
    )
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label>Temperatura (°C)</Label>
        <Input
          type="number"
          placeholder="np. 36.6"
          step="0.1"
          min="35"
          max="42"
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          required
          className={isFever ? "border-red-400 focus:ring-red-400" : ""}
        />
        {isFever && (
          <p className="text-red-500 text-sm mt-1.5 flex items-center gap-1.5">
            <span aria-hidden="true">⚠️</span>
            Gorączka! Temperatura powyżej 37.5°C — skontaktuj się z lekarzem.
          </p>
        )}
      </div>

      <div>
        <Label>Notatki</Label>
        <Textarea
          placeholder="np. podano lek, dziecko marudne..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div>
        <Label>Godzina</Label>
        <Input
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </div>

      <SubmitButton loading={loading}>Zapisz temperaturę</SubmitButton>
    </form>
  )
}

function MilestoneForm({ onSave }: { onSave: (data: Record<string, unknown>, t: string) => Promise<void> }) {
  const [description, setDescription] = useState("")
  const [time, setTime] = useState(toLocalDateTimeString(new Date()))
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await onSave({ description: description.trim() }, time)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label>Opis kamienia milowego</Label>
        <Input
          type="text"
          placeholder="np. Pierwsze uśmiechy, Uniosła główkę..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>

      <div>
        <Label>Godzina</Label>
        <Input
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </div>

      <SubmitButton loading={loading}>Zapisz kamień milowy</SubmitButton>
    </form>
  )
}

function NoteForm({ onSave }: { onSave: (data: Record<string, unknown>, t: string) => Promise<void> }) {
  const [text, setText] = useState("")
  const [time, setTime] = useState(toLocalDateTimeString(new Date()))
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await onSave({ text: text.trim() }, time)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label>Treść notatki</Label>
        <Textarea
          placeholder="Wpisz notatkę..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
        />
      </div>

      <div>
        <Label>Godzina</Label>
        <Input
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </div>

      <SubmitButton loading={loading}>Zapisz notatkę</SubmitButton>
    </form>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LogPage() {
  const [activeSheet, setActiveSheet] = useState<EventType | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [activeSleep, setActiveSleep] = useState<{ id: string; startTime: string } | null>(null)
  const toastIdRef = useRef(0)

  const showToast = useCallback((message: string, type: "success" | "error") => {
    toastIdRef.current += 1
    setToast({ message, type, id: toastIdRef.current })
  }, [])

  const closeSheet = useCallback(() => setActiveSheet(null), [])

  const handleSave = useCallback(
    async (type: EventType, data: Record<string, unknown>, occurredAt: string) => {
      try {
        const saved = await postEvent(type, data, occurredAt)
        showToast("Zapisano!", "success")
        // Track active sleep
        if (type === "sleep") {
          if (data.endTime) {
            setActiveSleep(null)
          } else if (data.startTime) {
            setActiveSleep({ id: saved.id, startTime: String(data.startTime) })
          }
        }
        closeSheet()
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Błąd zapisu", "error")
      }
    },
    [showToast, closeSheet]
  )

  const sheetTitle: Record<EventType, string> = {
    feeding: "🍼 Karmienie",
    diaper: "🧷 Pielucha",
    sleep: activeSleep ? "☀️ Wstała" : "🌙 Zasnęła",
    bath: "🛁 Kąpiel",
    weight: "⚖️ Waga",
    health: "🌡️ Temperatura",
    milestone: "⭐ Kamień milowy",
    note: "📝 Notatka",
  }

  return (
    <div className="max-w-md mx-auto px-4 py-5">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">Szybki wpis</h1>
        <p className="text-sm text-gray-400 mt-0.5">Naciśnij by dodać zdarzenie</p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-3">
        {quickButtons.map((btn) => {
          const isSleepActive = btn.type === "sleep" && activeSleep
          return (
            <button
              key={btn.type}
              onClick={() => setActiveSheet(btn.type)}
              className={`flex flex-col items-center justify-center gap-2.5 min-h-[100px] rounded-2xl border font-medium text-sm transition-all duration-150 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 shadow-sm ${
                isSleepActive
                  ? "bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100"
                  : "bg-white border-gray-100 text-gray-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600"
              }`}
              aria-label={btn.label}
            >
              <span className="text-3xl leading-none" aria-hidden="true">
                {isSleepActive ? "☀️" : btn.icon}
              </span>
              <span className="text-center leading-tight px-2">
                {isSleepActive ? "Wstała" : btn.label}
              </span>
              {isSleepActive && (
                <span className="text-xs text-yellow-500 font-normal">
                  Śpi...
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Bottom sheets */}
      {activeSheet && (
        <BottomSheet title={sheetTitle[activeSheet]} onClose={closeSheet}>
          {activeSheet === "feeding" && (
            <FeedingForm onSave={(d, t) => handleSave("feeding", d, t)} />
          )}
          {activeSheet === "diaper" && (
            <DiaperForm onSave={(d, t) => handleSave("diaper", d, t)} />
          )}
          {activeSheet === "sleep" && (
            <SleepForm
              onSave={(d, t) => handleSave("sleep", d, t)}
              activeSleep={activeSleep}
            />
          )}
          {activeSheet === "bath" && (
            <BathForm onSave={(d, t) => handleSave("bath", d, t)} />
          )}
          {activeSheet === "weight" && (
            <WeightForm onSave={(d, t) => handleSave("weight", d, t)} />
          )}
          {activeSheet === "health" && (
            <HealthForm onSave={(d, t) => handleSave("health", d, t)} />
          )}
          {activeSheet === "milestone" && (
            <MilestoneForm onSave={(d, t) => handleSave("milestone", d, t)} />
          )}
          {activeSheet === "note" && (
            <NoteForm onSave={(d, t) => handleSave("note", d, t)} />
          )}
        </BottomSheet>
      )}

      {/* Toast */}
      {toast && (
        <Toast toast={toast} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
