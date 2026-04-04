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

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  return (
    <>
      {/* Desktop: fixed top horizontal nav */}
      <nav className="hidden md:flex fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 h-14 items-center px-6 gap-2">
        <div className="flex items-center gap-2 mr-6">
          <span className="text-xl" aria-hidden="true">👶</span>
          <span className="font-semibold text-gray-800 text-sm">Baby Monitor</span>
        </div>
        {tabs.map((tab) => {
          const active = isActive(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-600"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <span aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </Link>
          )
        })}
      </nav>

      {/* Mobile: fixed bottom tab bar */}
      <nav className="flex md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200">
        <div className="flex items-stretch w-full">
          {tabs.map((tab) => {
            const active = isActive(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 px-1 text-center transition-colors duration-150 min-h-[60px] ${
                  active ? "text-blue-500" : "text-gray-400 hover:text-gray-600"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className="text-xl leading-none" aria-hidden="true">
                  {tab.icon}
                </span>
                <span className={`text-[11px] font-medium leading-none ${active ? "text-blue-500" : "text-gray-500"}`}>
                  {tab.label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
