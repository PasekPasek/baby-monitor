"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const tabs = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/log", label: "Loguj", icon: "➕" },
  { href: "/reports", label: "Raporty", icon: "📊" },
  { href: "/settings", label: "Ustawienia", icon: "⚙️" },
]

export default function Navigation() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 safe-area-inset-bottom">
      <div className="flex items-stretch max-w-md mx-auto">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href)

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 px-1 text-center transition-colors duration-150 min-h-[60px] ${
                isActive
                  ? "text-blue-500"
                  : "text-gray-400 hover:text-gray-600 active:text-gray-700"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="text-xl leading-none" aria-hidden="true">
                {tab.icon}
              </span>
              <span
                className={`text-[11px] font-medium leading-none ${
                  isActive ? "text-blue-500" : "text-gray-500"
                }`}
              >
                {tab.label}
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
