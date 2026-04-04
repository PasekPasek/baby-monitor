# Baby Monitor

Aplikacja do monitorowania noworodka z AI agentem wysyłającym przypomnienia SMS. Zbudowana w ramach projektu kursu AI-devs.

## Stack

| Warstwa | Technologia |
|---------|------------|
| Framework | Next.js 16 App Router (TypeScript) |
| Baza danych | Neon PostgreSQL (serverless) + Drizzle ORM |
| Autentykacja | NextAuth v5 + Google OAuth (whitelist emaili) |
| AI | OpenRouter → Gemini 2.5 Flash / Claude Sonnet 4.5 |
| SMS | SMSAPI.pl (outgoing + incoming webhook) |
| Hosting | Vercel (Hobby) |
| Cron | cron-job.org (darmowy, co 30 min) |

---

## Architektura

```
┌─────────────────────────────────────────────────────────────────┐
│                        UŻYTKOWNICY                              │
│   Rodzic 1 (app)    Rodzic 2 (app)    SMS ← → SMSAPI.pl        │
└────────┬───────────────────┬──────────────────┬────────────────┘
         │                   │                  │
         ▼                   ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js App (Vercel)                         │
│                                                                 │
│  Dashboard (/):        Ostatnie karmienie, feed zdarzeń        │
│  Log (/log):           Formularz zdarzeń (8 typów)             │
│  Raporty (/reports):   Wykresy, WHO centyle, historia SMS       │
│  Ustawienia (/settings): Profil dziecka, telefony rodziców     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    API Routes                           │   │
│  │  POST /api/heartbeat  ← cron-job.org (co 30 min)       │   │
│  │  POST /api/sms/incoming ← SMSAPI.pl webhook            │   │
│  │  GET/POST /api/events  ← UI                            │   │
│  │  GET /api/notifications ← historia SMS                 │   │
│  │  GET /api/agent-runs   ← logi agenta                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         │                   │
         ▼                   ▼
┌──────────────────┐  ┌──────────────────────────────────────────┐
│ Neon PostgreSQL  │  │              OpenRouter AI               │
│                  │  │                                          │
│  babies          │  │  DEFAULT_MODEL: gemini-2.5-flash         │
│  events          │  │  → heartbeat (regularne sprawdzenia)     │
│  notifications   │  │  → SMS classification (incoming)        │
│  agent_memory    │  │                                          │
│  agent_runs      │  │  SMART_MODEL: claude-sonnet-4-5          │
│  settings        │  │  → heartbeat (cotygodniowe podsumowanie) │
│  users + NextAuth│  └──────────────────────────────────────────┘
└──────────────────┘
```

---

## Agenci AI

### 1. Heartbeat Agent (`lib/heartbeat-agent.ts`)

Pattern z kursu AI-devs: **tool-calling agent loop** (03_02_events).

Uruchamiany co 30 minut przez cron-job.org via `POST /api/heartbeat`.

**Pętla agenta:**

```
1. Buduj system prompt (wiek dziecka, czas, reguły biznesowe)
2. Wyślij do LLM: "Wykonaj swoje zadania"
3. LLM decyduje które narzędzia wywołać
4. Wywołaj wszystkie tool_calls równolegle (Promise.all)
5. Dodaj wyniki do historii wiadomości
6. Powtarzaj (max 15 kroków) aż finish_reason === "stop"
7. Zapisz wyniki do agent_runs (decision log)
```

**Narzędzia agenta:**

| Narzędzie | Opis |
|-----------|------|
| `get_last_event(type)` | Ostatnie zdarzenie danego typu + minuty temu |
| `get_events_summary(hours, type?)` | Lista zdarzeń z ostatnich N godzin |
| `get_baby_info()` | Wiek dziecka, data urodzenia |
| `check_notification_sent(type, minutes)` | Czy SMS tego typu był wysłany (deduplication) |
| `send_sms(message, notificationType)` | Wyślij SMS do obu rodziców + zapisz w DB |
| `get_weekly_stats()` | Statystyki 7-dniowe (waga, karmienia, sen) |
| `read_memory()` | Odczytaj zapamiętane obserwacje z poprzednich uruchomień |
| `write_memory(type, content, days?)` | Zapisz obserwację/wzorzec/decyzję do pamięci |

**Reguły biznesowe (system prompt):**
- Karmienie: interwały zależne od ilości (1.5h dla <30ml, 2h dla 30-60ml, 3h dla 60-90ml, 3.5h dla >90ml)
- Waga: alert jeśli brak pomiaru >2 dni, max 1 SMS/dzień
- Kąpiel: alert jeśli brak >3 dni
- Gorączka: alert jeśli temperatura >37.5°C
- Cotygodniowe podsumowanie: niedziela 19:00-21:00 (Claude Sonnet)

**Model selection (Propozycja 4):**
- Regularne sprawdzenia → `gemini-2.5-flash` (szybki, tani)
- Cotygodniowe podsumowanie → `claude-sonnet-4-5` (lepsza jakość analizy)

**Agent memory (Propozycja 3):**
- Każde uruchomienie zaczyna od `read_memory()` — sprawdzenie wzorców z przeszłości
- Istotne obserwacje zapisywane przez `write_memory()` (np. "Zuzia robi 4h przerwy nocne")
- Wzorce wpływają na decyzje — agent nie wysyła alertu o nocnej przerwie jeśli to normalny wzorzec

---

### 2. SMS Classification Agent (`lib/sms-agent.ts`)

Pattern: **structured output / single-shot** (01_01_structured).

Uruchamiany przez `POST /api/sms/incoming` (webhook SMSAPI.pl).

**Przepływ:**
```
SMS od rodzica → weryfikacja nadawcy → classifySMS() → zapis do DB → SMS potwierdzający
```

**Klasyfikuje SMS na zdarzenia:**
- `karmienie 60ml` → `{ type: "feeding", data: { type: "bottle", amountMl: 60 } }`
- `butelka 80ml 14:00` → zdarzenie z godziną z SMS-a (nie z czasu odbioru)
- `waga 3.5kg` → `{ type: "weight", data: { grams: 3500 } }`
- `kapiel` / `temperatura 37.2` / `spac` / `wstala` itp.

**Ostrzeżenia:**
- Butelka <30ml → "⚠️ Mało (norma: 60-90ml)"
- Temperatura >37.5°C → "⚠️ Gorączka!"
- Temperatura >38.5°C → "🚨 Wysoka gorączka! Zadzwoń do lekarza"

---

## Schemat bazy danych

```
babies            — profil dziecka (imię, data urodzenia, płeć)
events            — zdarzenia (feeding/sleep/weight/bath/diaper/health/milestone/note)
  └── data: JSONB — elastyczne dane per typ zdarzenia
notifications     — log wysłanych SMS-ów (deduplication + historia)
agent_memory      — długoterminowa pamięć agenta (obserwacje, wzorce, decyzje)
agent_runs        — decision log każdego uruchomienia heartbeat
settings          — klucz-wartość (ustawienia aplikacji)
users + NextAuth  — konta rodziców (Google OAuth)
```

---

## Zmienne środowiskowe

Skopiuj `.env.example` do `.env.local` i uzupełnij wartości.

### Baza danych

| Zmienna | Opis |
|---------|------|
| `DATABASE_URL` | Connection string Neon PostgreSQL. Format: `postgresql://user:pass@host/db?sslmode=require` |

### Autentykacja (NextAuth)

| Zmienna | Opis |
|---------|------|
| `AUTH_SECRET` | Losowy sekret do podpisywania sesji. Generuj: `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | Client ID z Google Cloud Console (OAuth 2.0) |
| `AUTH_GOOGLE_SECRET` | Client Secret z Google Cloud Console |
| `ALLOWED_EMAILS` | Lista emaili z dostępem, oddzielona przecinkami **bez spacji**. Np. `mama@gmail.com,tata@gmail.com` |

### SMS (SMSAPI.pl)

| Zmienna | Opis |
|---------|------|
| `SMSAPI_TOKEN` | Bearer token OAuth z panelu SMSAPI → API → OAuth → Dodaj token |
| `SMSAPI_SENDER` | Nazwa nadawcy SMS (max 11 znaków). `Test` działa bez rejestracji. Własna nazwa wymaga rejestracji w SMSAPI |
| `PARENT1_PHONE` | Numer telefonu rodzica 1. Format: `+48XXXXXXXXX` |
| `PARENT2_PHONE` | Numer telefonu rodzica 2. Format: `+48XXXXXXXXX`. Może być taki sam jak PARENT1 |

### AI (OpenRouter)

| Zmienna | Opis |
|---------|------|
| `OPENROUTER_API_KEY` | Klucz API z openrouter.ai. Używany do Gemini Flash i Claude Sonnet |

Modele używane (konfiguracja w `lib/openrouter.ts`):
- `DEFAULT_MODEL = "google/gemini-2.5-flash"` — heartbeat (regularne), SMS classification
- `SMART_MODEL = "anthropic/claude-sonnet-4-5"` — heartbeat (cotygodniowe podsumowanie)

### Cron i aplikacja

| Zmienna | Opis |
|---------|------|
| `CRON_SECRET` | Sekret weryfikujący żądania od cron-job.org. Dowolny losowy string. Ustaw ten sam w nagłówku `x-cron-secret` w cron-job.org |
| `NEXT_PUBLIC_APP_URL` | Publiczny URL aplikacji. Np. `https://baby-monitor.vercel.app`. Używany jako HTTP-Referer w OpenRouter |

### Dane dziecka

| Zmienna | Opis |
|---------|------|
| `BABY_NAME` | Imię dziecka. Używane w system prompt agenta i SMS-ach |
| `BABY_BIRTH_DATE` | Data urodzenia w formacie `YYYY-MM-DD`. Np. `2026-03-27` |
| `BABY_GENDER` | Płeć: `M` (chłopiec) lub `F` (dziewczynka). Wpływa na normy WHO w wykresach |

---

## Uruchomienie lokalne

```bash
# Instalacja zależności
npm install

# Skopiuj i uzupełnij zmienne środowiskowe
cp .env.example .env.local

# Utwórz tabele w bazie danych
npx drizzle-kit push

# Uruchom serwer developerski
npm run dev
```

Aplikacja dostępna pod `http://localhost:3000`.

**Testowanie heartbeat lokalnie:**
```bash
curl -X POST http://localhost:3000/api/heartbeat \
  -H "x-cron-secret: TWOJ_CRON_SECRET"
```

**Testowanie SMS (symulacja):**
```bash
curl -X POST http://localhost:3000/api/sms/incoming \
  -d "sms_from=48883116472&sms_text=karmienie+60ml"
```

---

## Konfiguracja cron-job.org

1. Utwórz konto na cron-job.org (darmowe)
2. Nowe zadanie:
   - URL: `https://TWOJA-DOMENA.vercel.app/api/heartbeat`
   - Metoda: `POST`
   - Harmonogram: co 30 minut
   - Nagłówki: `x-cron-secret: TWOJ_CRON_SECRET`

---

## Struktura plików

```
app/
  (auth)/login/          — strona logowania (Google OAuth)
  (dashboard)/
    page.tsx             — dashboard (ostatnie karmienie, feed zdarzeń)
    log/page.tsx         — formularz dodawania zdarzeń (8 typów)
    reports/page.tsx     — wykresy, WHO centyle, historia SMS/agent
    settings/page.tsx    — profil dziecka, telefony, ustawienia
  api/
    heartbeat/           — trigger agenta (POST z x-cron-secret)
    sms/incoming/        — webhook SMSAPI.pl (incoming SMS)
    events/              — CRUD zdarzeń
    notifications/       — historia SMS
    agent-runs/          — logi uruchomień agenta
    baby/                — profil dziecka
    settings/            — ustawienia key-value

lib/
  heartbeat-agent.ts     — główny agent AI (tool-calling loop)
  sms-agent.ts           — klasyfikator SMS (structured output)
  who-data.ts            — normy WHO (P3-P97, dziewczynki i chłopcy, tyg. 0-52)
  schema.ts              — schemat bazy danych (Drizzle)
  db.ts                  — klient Neon PostgreSQL
  auth.ts                — NextAuth konfiguracja
  baby.ts                — helper getBabyAge(), getOrCreateBaby()
  sms.ts                 — klient SMSAPI.pl
  openrouter.ts          — klient OpenRouter (modele DEFAULT + SMART)

components/
  Navigation.tsx         — responsywna nawigacja (bottom mobile, top desktop)
  BabyAge.tsx            — komponent wieku dziecka
  EventFeed.tsx          — lista zdarzeń
  ui/                    — shadcn/ui komponenty
```
