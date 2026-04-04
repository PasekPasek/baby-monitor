interface EventIconProps {
  type: string
  className?: string
}

const iconMap: Record<string, string> = {
  feeding: "🍼",
  sleep: "😴",
  weight: "⚖️",
  height: "📏",
  head_circumference: "📐",
  bath: "🛁",
  diaper: "🧷",
  milestone: "⭐",
  health: "🌡️",
  note: "📝",
}

export default function EventIcon({ type, className = "" }: EventIconProps) {
  const icon = iconMap[type] ?? "📋"
  return (
    <span
      className={className}
      role="img"
      aria-label={type}
    >
      {icon}
    </span>
  )
}
