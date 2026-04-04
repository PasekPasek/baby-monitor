"use client"

import { useState, useEffect } from "react"
import { useSession, signOut } from "next-auth/react"
import { format } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type BabyData = {
  id: string
  name: string
  birthDate: string
  gender: "M" | "F" | null
}

type SettingsData = {
  parent1Phone?: string
  parent2Phone?: string
  feedingReminderIntervalHours?: string
}

const FEEDING_INTERVALS = [
  { value: "1.5", label: "Co 1.5 godziny" },
  { value: "2", label: "Co 2 godziny" },
  { value: "2.5", label: "Co 2.5 godziny" },
  { value: "3", label: "Co 3 godziny" },
  { value: "3.5", label: "Co 3.5 godziny" },
]

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  )
}

export default function SettingsPage() {
  const { data: session } = useSession()

  // Baby state
  const [babyName, setBabyName] = useState("")
  const [birthDate, setBirthDate] = useState("")
  const [gender, setGender] = useState<"M" | "F" | "">("")
  const [babySaving, setBabySaving] = useState(false)
  const [babySaved, setBabySaved] = useState(false)
  const [babyError, setBabyError] = useState("")

  // Settings state
  const [parent1Phone, setParent1Phone] = useState("")
  const [parent2Phone, setParent2Phone] = useState("")
  const [feedingInterval, setFeedingInterval] = useState("3")
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsError, setSettingsError] = useState("")

  useEffect(() => {
    fetch("/api/baby")
      .then((r) => r.json())
      .then((data: BabyData) => {
        if (data?.name) setBabyName(data.name)
        if (data?.birthDate) setBirthDate(format(new Date(data.birthDate), "yyyy-MM-dd"))
        if (data?.gender) setGender(data.gender)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: SettingsData) => {
        if (data?.parent1Phone) setParent1Phone(data.parent1Phone)
        if (data?.parent2Phone) setParent2Phone(data.parent2Phone)
        if (data?.feedingReminderIntervalHours) setFeedingInterval(data.feedingReminderIntervalHours)
      })
      .catch(() => {})
  }, [])

  const inputClass = "w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"

  const handleSaveBaby = async () => {
    setBabySaving(true)
    setBabyError("")
    setBabySaved(false)
    try {
      const res = await fetch("/api/baby", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: babyName, birthDate: birthDate || undefined, gender: gender || undefined }),
      })
      if (!res.ok) {
        const err = await res.json()
        setBabyError(err?.error ?? "Błąd zapisu")
      } else {
        setBabySaved(true)
        setTimeout(() => setBabySaved(false), 3000)
      }
    } catch {
      setBabyError("Błąd połączenia")
    } finally {
      setBabySaving(false)
    }
  }

  const handleSaveSettings = async () => {
    setSettingsSaving(true)
    setSettingsError("")
    setSettingsSaved(false)
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent1Phone, parent2Phone, feedingReminderIntervalHours: feedingInterval }),
      })
      if (!res.ok) {
        const err = await res.json()
        setSettingsError(err?.error ?? "Błąd zapisu")
      } else {
        setSettingsSaved(true)
        setTimeout(() => setSettingsSaved(false), 3000)
      }
    } catch {
      setSettingsError("Błąd połączenia")
    } finally {
      setSettingsSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-8 flex flex-col gap-4">
      <h1 className="text-xl font-bold text-gray-800">Ustawienia</h1>

      {/* User info */}
      {session?.user && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              {session.user.image && (
                <img src={session.user.image} alt="Avatar" className="w-10 h-10 rounded-full" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">
                  {session.user.name ?? "Użytkownik"}
                </p>
                <p className="text-xs text-gray-400 truncate">{session.user.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Profil dziecka */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Profil dziecka</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FieldRow label="Imię">
            <input
              type="text"
              value={babyName}
              onChange={(e) => setBabyName(e.target.value)}
              placeholder="Imię dziecka"
              className={inputClass}
            />
          </FieldRow>

          <FieldRow label="Data urodzenia">
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className={inputClass}
            />
          </FieldRow>

          <FieldRow label="Płeć">
            <div className="flex gap-4">
              {[
                { value: "M", label: "Chłopiec", accent: "accent-blue-500" },
                { value: "F", label: "Dziewczynka", accent: "accent-pink-500" },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="gender"
                    value={opt.value}
                    checked={gender === opt.value}
                    onChange={() => setGender(opt.value as "M" | "F")}
                    className={opt.accent}
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </FieldRow>

          {babyError && <p className="text-xs text-red-500">{babyError}</p>}

          <Button
            onClick={handleSaveBaby}
            disabled={babySaving}
            className={babySaved ? "bg-green-500 hover:bg-green-500" : ""}
          >
            {babySaving ? "Zapisywanie..." : babySaved ? "Zapisano!" : "Zapisz profil"}
          </Button>
        </CardContent>
      </Card>

      {/* Powiadomienia SMS */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Powiadomienia SMS</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FieldRow label="Telefon rodzica 1">
            <input
              type="tel"
              value={parent1Phone}
              onChange={(e) => setParent1Phone(e.target.value)}
              placeholder="+48123456789"
              className={inputClass}
            />
          </FieldRow>

          <FieldRow label="Telefon rodzica 2">
            <input
              type="tel"
              value={parent2Phone}
              onChange={(e) => setParent2Phone(e.target.value)}
              placeholder="+48123456789"
              className={inputClass}
            />
          </FieldRow>

          <FieldRow label="Przypomnienie o karmieniu">
            <select
              value={feedingInterval}
              onChange={(e) => setFeedingInterval(e.target.value)}
              className={inputClass}
            >
              {FEEDING_INTERVALS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </FieldRow>

          {settingsError && <p className="text-xs text-red-500">{settingsError}</p>}

          <Button
            onClick={handleSaveSettings}
            disabled={settingsSaving}
            className={settingsSaved ? "bg-green-500 hover:bg-green-500" : ""}
          >
            {settingsSaving ? "Zapisywanie..." : settingsSaved ? "Zapisano!" : "Zapisz ustawienia"}
          </Button>
        </CardContent>
      </Card>

      {/* Informacje */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Informacje</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Wersja aplikacji</span>
            <span className="font-medium text-gray-700">1.0.0</span>
          </div>

          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs font-semibold text-gray-600 mb-2">Jak logować przez SMS:</p>
            <ul className="flex flex-col gap-1.5">
              {["karmienie 60ml", "butelka 80ml 14:00", "kapiel", "waga 3.5kg", "temperatura 37.2", "spac / wstala"].map((example) => (
                <li key={example} className="flex items-start gap-2">
                  <span className="text-gray-400 text-xs mt-0.5 select-none">•</span>
                  <code className="text-xs text-gray-700 bg-white border border-gray-200 rounded px-1.5 py-0.5 font-mono">
                    {example}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Sign out */}
      <Button
        variant="outline"
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
      >
        Wyloguj się
      </Button>
    </div>
  )
}
