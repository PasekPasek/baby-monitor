/**
 * SMS classification agent — parses incoming SMS from parents
 * and converts to structured event data.
 */
import { openrouter, DEFAULT_MODEL } from "./openrouter"
import type { EventData } from "./schema"

type ClassifiedEvent = {
  type: string
  data: EventData
  occurredAt: Date
  confirmationMessage: string
}

const SYSTEM_PROMPT = `Jesteś asystentem monitorowania noworodka. Klasyfikujesz wiadomości od rodziców na dwa rodzaje: ZDARZENIA (wpisy danych) i ZAPYTANIA (pytania o dane).

Zwróć JSON z polami:
- type: jedna z wartości: feeding, sleep, weight, height, head_circumference, bath, diaper, milestone, health, note, query
- data: obiekt z danymi (zgodnie ze schematem poniżej)
- occurredAt: data/czas zdarzenia (ISO 8601) - wyciągnij z wiadomości lub użyj "now"
- confirmationMessage: krótkie potwierdzenie po polsku (max 100 znaków) + ostrzeżenie jeśli wartości są niepokojące

SCHEMATY DATA:
feeding: {type:"breast"|"bottle", side?:"L"|"R", durationMin?:number, amountMl?:number}
sleep: {startTime?:string, endTime?:string}
weight: {grams:number}
height: {cm:number}
head_circumference: {cm:number}
bath: {notes?:string}
diaper: {type:"wet"|"dirty"|"both", color?:string}
milestone: {description:string, category?:string}
health: {subtype:"temperature"|"medication"|"vaccine"|"test_result"|"doctor_visit", value?:number, unit?:string, notes:string}
note: {text:string}
query: {queryType:"last_feeding"|"last_weight"|"last_bath"|"last_sleep"|"summary"|"weekly", question:string}

ROZPOZNAWANIE ZAPYTAŃ (type="query") — PRIORYTET przed innymi typami:
Jeśli wiadomość to PYTANIE lub PROŚBA O INFORMACJĘ — zawsze type=query, NIE note.
Przykłady zapytań:
- "kiedy jadła?", "kiedy karmienie?", "ostatnie karmienie", "ile zjadła?"
- "kiedy kąpiel?", "kiedy była ważona?", "ile waży?"
- "jak idzie?", "co słychać?", "podsumowanie", "raport"
- "czy jadła?", "czy spała?", "co ostatnio?"
- każde zdanie kończące się "?"
- każde zdanie zaczynające się od: kiedy, ile, czy, co, jak, która, skąd, gdzie
queryType: "last_feeding" dla pytań o karmienie, "last_weight" o wagę, "last_bath" o kąpiel, "last_sleep" o sen, "summary" dla ogólnych pytań o dzień, "weekly" dla pytań o tydzień (podsumowanie tygodnia, jak idzie tydzień, tygodniowy raport)

UWAGA: type=note TYLKO gdy rodzic CELOWO dodaje notatkę tekstową (np. "notatka: ...", "zanotuj że..."). Pytania to ZAWSZE query.

OSTRZEŻENIA (dla zdarzeń, nie zapytań):
- karmienie butelką < 30ml → dodaj "⚠️ Mało (norma: 60-90ml)"
- temperatura > 37.5 → dodaj "⚠️ Gorączka! Obserwuj dziecko"
- temperatura > 38.5 → dodaj "🚨 Wysoka gorączka! Zadzwoń do lekarza"

PARSOWANIE CZASU:
- "15:00", "15.00", "o 15" → dzisiaj 15:00
- "wczoraj 23:30" → wczoraj 23:30
- brak czasu → "now"

Odpowiedź TYLKO w formacie JSON, bez markdown, bez komentarzy.`

export async function classifySMS(
  message: string,
  senderPhone: string,
  babyName: string
): Promise<ClassifiedEvent | null> {
  try {
    const now = new Date().toISOString()
    const userPrompt = `Teraz jest: ${now}\nWiadomość od rodzica (${senderPhone}):\n"${message}"\n\nDziecko: ${babyName}`

    const response = await openrouter.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    })

    const content = response.choices[0]?.message?.content
    if (!content) return null

    const parsed = JSON.parse(content)
    const occurredAt =
      parsed.occurredAt === "now" || !parsed.occurredAt
        ? new Date()
        : new Date(parsed.occurredAt)

    return {
      type: parsed.type,
      data: parsed.data,
      occurredAt,
      confirmationMessage: parsed.confirmationMessage,
    }
  } catch (err) {
    console.error("[SMS Agent] Classification failed:", err)
    return null
  }
}
