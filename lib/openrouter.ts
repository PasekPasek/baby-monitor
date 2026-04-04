import OpenAI from "openai"

export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    "X-Title": "Baby Monitor",
  },
})

export const DEFAULT_MODEL = "google/gemini-2.5-flash"
export const SMART_MODEL = "anthropic/claude-sonnet-4-5"
