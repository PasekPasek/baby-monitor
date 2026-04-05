"use client"

import { useState } from "react"
import EventFeed from "./EventFeed"
import type { Event } from "@/lib/schema"

export default function DashboardClient({ initialEvents }: { initialEvents: Event[] }) {
  const [events, setEvents] = useState(initialEvents)

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/events/${id}`, { method: "DELETE" })
    if (res.ok) {
      setEvents((prev) => prev.filter((e) => e.id !== id))
    }
  }

  return <EventFeed events={events} onDelete={handleDelete} />
}
