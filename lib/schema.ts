import {
  pgTable,
  text,
  timestamp,
  jsonb,
  pgEnum,
  integer,
  boolean,
} from "drizzle-orm/pg-core"

// NextAuth required tables
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  phoneNumber: text("phone_number"),
  role: text("role", { enum: ["admin", "parent"] }).default("parent"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
})

export const accounts = pgTable("accounts", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
})

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
})

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
})

// Baby profile
export const babies = pgTable("babies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  birthDate: timestamp("birth_date", { mode: "date" }).notNull(),
  gender: text("gender", { enum: ["M", "F"] }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
})

// Event type enum
export const eventTypeEnum = pgEnum("event_type", [
  "feeding",
  "sleep",
  "weight",
  "height",
  "head_circumference",
  "bath",
  "diaper",
  "milestone",
  "health",
  "note",
])

// All baby events
export const events = pgTable("events", {
  id: text("id").primaryKey(),
  babyId: text("baby_id")
    .notNull()
    .references(() => babies.id, { onDelete: "cascade" }),
  createdBy: text("created_by").references(() => users.id),
  type: eventTypeEnum("type").notNull(),
  data: jsonb("data").notNull().default({}),
  occurredAt: timestamp("occurred_at", { mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  source: text("source", { enum: ["ui", "sms", "agent"] }).default("ui"),
})

// Notification log (prevents duplicates)
export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  babyId: text("baby_id")
    .notNull()
    .references(() => babies.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  channel: text("channel", { enum: ["sms", "email"] }).notNull(),
  message: text("message").notNull(),
  sentTo: text("sent_to"),
  sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
  triggeredBy: text("triggered_by", { enum: ["heartbeat", "incoming_sms", "manual"] }).default("heartbeat"),
})

// App settings (key-value store)
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
})

// Types for event data (for TypeScript safety)
export type FeedingData = {
  type: "breast" | "bottle"
  side?: "L" | "R"
  durationMin?: number
  amountMl?: number
}

export type SleepData = {
  startTime?: string
  endTime?: string
}

export type WeightData = {
  grams: number
}

export type HeightData = {
  cm: number
}

export type HeadCircumferenceData = {
  cm: number
}

export type BathData = {
  notes?: string
}

export type DiaperData = {
  type: "wet" | "dirty" | "both"
  color?: string
}

export type MilestoneData = {
  description: string
  category?: string
}

export type HealthData = {
  subtype: "temperature" | "medication" | "vaccine" | "test_result" | "doctor_visit"
  value?: number
  unit?: string
  notes: string
}

export type NoteData = {
  text: string
}

export type EventData =
  | FeedingData
  | SleepData
  | WeightData
  | HeightData
  | HeadCircumferenceData
  | BathData
  | DiaperData
  | MilestoneData
  | HealthData
  | NoteData

export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type User = typeof users.$inferSelect
export type Baby = typeof babies.$inferSelect
export type Notification = typeof notifications.$inferSelect
