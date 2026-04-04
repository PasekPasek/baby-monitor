import { db } from "./db"
import { babies } from "./schema"

let cachedBaby: typeof babies.$inferSelect | null = null

export async function getOrCreateBaby() {
  if (cachedBaby) return cachedBaby

  const existing = await db.query.babies.findFirst()
  if (existing) {
    cachedBaby = existing
    return existing
  }

  // Auto-create from env vars on first run
  const name = process.env.BABY_NAME || "Dziecko"
  const birthDateStr = process.env.BABY_BIRTH_DATE || new Date().toISOString().split("T")[0]
  const gender = (process.env.BABY_GENDER as "M" | "F") || "F"

  const [baby] = await db.insert(babies).values({
    id: crypto.randomUUID(),
    name,
    birthDate: new Date(birthDateStr),
    gender,
  }).returning()

  cachedBaby = baby
  return baby
}

export function getBabyAge(birthDate: Date): {
  days: number
  weeks: number
  months: number
  years: number
  label: string
} {
  const now = new Date()
  const diffMs = now.getTime() - birthDate.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30.44)
  const years = Math.floor(days / 365.25)

  let label: string
  if (days < 7) {
    label = `${days} ${days === 1 ? "dzień" : "dni"}`
  } else if (weeks < 8) {
    label = `${weeks} ${weeks === 1 ? "tydzień" : weeks < 5 ? "tygodnie" : "tygodni"}`
  } else if (months < 24) {
    label = `${months} ${months === 1 ? "miesiąc" : months < 5 ? "miesiące" : "miesięcy"}`
  } else {
    label = `${years} ${years === 1 ? "rok" : years < 5 ? "lata" : "lat"}`
  }

  return { days, weeks, months, years, label }
}
