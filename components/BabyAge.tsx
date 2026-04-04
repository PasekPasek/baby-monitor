"use client"

import { differenceInDays, differenceInWeeks, differenceInMonths, differenceInYears } from "date-fns"

interface BabyAgeProps {
  birthDate: Date
  name: string
}

function formatAge(birthDate: Date): string {
  const now = new Date()
  const days = differenceInDays(now, birthDate)
  const weeks = differenceInWeeks(now, birthDate)
  const months = differenceInMonths(now, birthDate)
  const years = differenceInYears(now, birthDate)

  if (days < 7) {
    if (days === 0) return "noworodek"
    if (days === 1) return "1 dzień"
    return `${days} dni`
  }

  if (weeks < 8) {
    const remainingDays = days - weeks * 7
    const weeksLabel =
      weeks === 1
        ? "tydzień"
        : weeks < 5
          ? "tygodnie"
          : "tygodni"
    if (remainingDays === 0) return `${weeks} ${weeksLabel}`
    const daysLabel = remainingDays === 1 ? "dzień" : "dni"
    return `${weeks} ${weeksLabel} ${remainingDays} ${daysLabel}`
  }

  if (months < 24) {
    const monthsLabel =
      months === 1
        ? "miesiąc"
        : months < 5
          ? "miesiące"
          : "miesięcy"
    return `${months} ${monthsLabel}`
  }

  const yearsLabel =
    years === 1 ? "rok" : years < 5 ? "lata" : "lat"
  return `${years} ${yearsLabel}`
}

export default function BabyAge({ birthDate, name }: BabyAgeProps) {
  const ageLabel = formatAge(new Date(birthDate))

  return (
    <div className="flex flex-col items-center gap-1 py-4">
      <span className="text-5xl" role="img" aria-label="baby">
        👶
      </span>
      <div className="text-center mt-1">
        <p className="text-lg font-semibold text-gray-800">
          {name}{" "}
          <span className="text-gray-400 font-normal">•</span>{" "}
          <span className="text-blue-500">{ageLabel}</span>
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          ur.{" "}
          {new Date(birthDate).toLocaleDateString("pl-PL", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>
    </div>
  )
}
