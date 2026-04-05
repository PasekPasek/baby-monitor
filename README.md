# Baby Monitor

Aplikacja do monitorowania noworodka z AI agentem wysyłającym przypomnienia przez Telegram. Zbudowana w ramach projektu kursu AI-devs.

## Stack

| Warstwa | Technologia |
|---------|------------|
| Framework | Next.js 16 App Router (TypeScript) |
| Baza danych | Neon PostgreSQL (serverless) + Drizzle ORM |
| Autentykacja | NextAuth v5 + Google OAuth (whitelist emaili) |
| AI | OpenRouter → Gemini 2.5 Flash / Claude Sonnet 4.5 |
| Komunikacja | Telegram Bot API (wspólna grupa rodziców) |
| Hosting | Vercel (Hobby) |
| Cron | cron-job.org (darmowy, co 30 min) |

---

## Architektura

```
┌─────────────────────────────────────────────────────────────────┐
│                        UŻYTKOWNICY                              │
│   Rodzic 1 (app)    Rodzic 2 (app)    Telegram (grupa "Zuzia") │
└────────┬───────────────────┬──────────────────┬────────────────┘
         │                   │                  │
         ▼                   ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js App (Vercel)                         │
│                                                                 │
│  Dashboard (/):        Ostatnie karmienie, feed zdarzeń        │
│  Log (/log):           Formularz zdarzeń (8 typów)             │
│  Raporty (/reports):   Wykresy, WHO centyle, historia agenta   │
│  Ustawienia (/settings): Profil dziecka, ustawienia            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    API Routes                           │   │
│  │  POST /api/heartbeat  ← cron-job.org (co 30 min)       │   │
│  │  POST /api/telegram   ← Telegram webhook               │   │
│  │  GET/POST /api/events ← UI                             │   │
│  │  GET /api/notifications ← historia powiadomień         │   │
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
│  notifications   │  │  → klasyfikacja wiadomości Telegram      │
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
| `get_last_event(type)` | Ostatnie zdarzenie + dla karmienia: suma sesji 90 min (cluster feeding) |
| `get_events_summary(hours, type?)` | Lista zdarzeń z ostatnich N godzin |
| `get_baby_info()` | Wiek dziecka, data urodzenia |
| `check_notification_sent(type, minutes)` | Czy powiadomienie tego typu było wysłane (deduplication) |
| `send_telegram(message, notificationType)` | Wyślij wiadomość Telegram do grupy + zapisz w DB |
| `get_weekly_stats()` | Statystyki 7-dniowe (waga, karmienia, sen) |
| `read_memory()` | Odczytaj zapamiętane obserwacje z poprzednich uruchomień |
| `write_memory(type, content, days?)` | Zapisz obserwację/wzorzec/decyzję do pamięci |

**Reguły biznesowe (system prompt, źródło: AAP/WHO):**
- Karmienie: sesja 90 min (cluster feeding sumowany), interwały wg ilości:
  - <30ml → 1.5h + ostrzeżenie, 30-60ml → 2h, 60-90ml → 3h, >90ml → 3.5h
- Alert bezwzględny: >4h bez karmienia (0-6 tyg), >5h (6-12 tyg)
- Normy wiekowe: 0-2 tyg (30-90ml), 2-6 tyg (60-120ml), 6-12 tyg (120-180ml)
- Waga: alert jeśli brak pomiaru >2 dni, max 1 wiadomość/dzień
- Kąpiel: alert jeśli brak >3 dni
- Gorączka: alert jeśli temperatura >37.5°C
- Cotygodniowe podsumowanie: niedziela 19:00-21:00 (Claude Sonnet)

---

### 2. Message Classifier (`lib/sms-agent.ts`)

Pattern: **structured output / single-shot** (01_01_structured).

Uruchamiany przez `POST /api/telegram` (Telegram webhook).

**Przepływ:**
```
Wiadomość Telegram → classifySMS() → [query? → odpowiedź z DB] [event? → zapis + potwierdzenie]
```

**Obsługuje dwa rodzaje wiadomości:**

Zdarzenia (zapisuje do DB):
- `karmienie 60ml` → `{ type: "feeding", data: { type: "bottle", amountMl: 60 } }`
- `butelka 80ml 14:00` → zdarzenie z godziną z wiadomości
- `waga 3.5kg`, `kąpiel`, `temperatura 37.2`, `spać`, `wstała` itp.

Zapytania (odpowiada z danych, NIE zapisuje):
- `kiedy jadła?` → ostatnie karmienie + czas temu
- `ile waży?` → ostatnia waga
- `kiedy kąpiel?` → ostatnia kąpiel
- `jak idzie?` → podsumowanie 24h

---

## Schemat bazy danych

```
babies            — profil dziecka (imię, data urodzenia, płeć)
events            — zdarzenia (feeding/sleep/weight/bath/diaper/health/milestone/note)
  └── data: JSONB — elastyczne dane per typ zdarzenia
  └── source      — "ui" | "sms" | "agent" | "telegram"
notifications     — log wysłanych powiadomień (deduplication + historia)
  └── channel     — "sms" | "email" | "telegram"
agent_memory      — długoterminowa pamięć agenta (obserwacje, wzorce, decyzje)
agent_runs        — decision log każdego uruchomienia heartbeat
settings          — klucz-wartość (ustawienia, telegram_chat_id)
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

### Telegram Bot

| Zmienna | Opis |
|---------|------|
| `TELEGRAM_BOT_TOKEN` | Token bota od @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Losowy sekret weryfikujący webhook. Generuj: `openssl rand -hex 16` |
| `TELEGRAM_CHAT_ID` | ID grupy Telegram (ujemna liczba). Auto-wykrywany z pierwszej wiadomości lub ustaw ręcznie |

### AI (OpenRouter)

| Zmienna | Opis |
|---------|------|
| `OPENROUTER_API_KEY` | Klucz API z openrouter.ai |

Modele używane (konfiguracja w `lib/openrouter.ts`):
- `DEFAULT_MODEL = "google/gemini-2.5-flash"` — heartbeat (regularne), klasyfikacja wiadomości
- `SMART_MODEL = "anthropic/claude-sonnet-4-5"` — heartbeat (cotygodniowe podsumowanie)

### Cron i aplikacja

| Zmienna | Opis |
|---------|------|
| `CRON_SECRET` | Sekret weryfikujący żądania od cron-job.org. Dowolny losowy string |
| `NEXT_PUBLIC_APP_URL` | Publiczny URL aplikacji. Np. `https://baby-monitor.vercel.app` |

### Dane dziecka

| Zmienna | Opis |
|---------|------|
| `BABY_NAME` | Imię dziecka |
| `BABY_BIRTH_DATE` | Data urodzenia w formacie `YYYY-MM-DD` |
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

**Testowanie Telegram webhook (symulacja):**
```bash
curl -X POST http://localhost:3000/api/telegram \
  -H "Content-Type: application/json" \
  -H "x-telegram-bot-api-secret-token: TWOJ_WEBHOOK_SECRET" \
  -d '{"update_id":1,"message":{"message_id":1,"from":{"id":123,"first_name":"Test"},"chat":{"id":-5045185449,"type":"group"},"date":1234567890,"text":"karmienie 60ml"}}'
```

---

## Konfiguracja Telegram

1. Utwórz bota przez @BotFather: `/newbot`
2. Wyłącz tryb prywatności: `/setprivacy` → Disable
3. Stwórz prywatną grupę, dodaj oboje rodziców i bota
4. Pobierz ID grupy: `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"`
5. Zarejestruj webhook (jednorazowo po deploy):

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://TWOJA_DOMENA/api/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message"]
  }'
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
    page.tsx             — dashboard (ostatnie karmienie, feed zdarzeń z usuwaniem)
    log/page.tsx         — formularz dodawania zdarzeń (8 typów)
    reports/page.tsx     — wykresy, WHO centyle, historia agenta
    settings/page.tsx    — profil dziecka, ustawienia
  api/
    heartbeat/           — trigger agenta (POST z x-cron-secret)
    telegram/            — Telegram webhook (incoming messages + outgoing replies)
    events/              — CRUD zdarzeń
    notifications/       — historia powiadomień
    agent-runs/          — logi uruchomień agenta
    baby/                — profil dziecka
    settings/            — ustawienia key-value

lib/
  heartbeat-agent.ts     — główny agent AI (tool-calling loop)
  sms-agent.ts           — klasyfikator wiadomości (structured output)
  telegram.ts            — klient Telegram Bot API
  who-data.ts            — normy WHO (P3-P97, dziewczynki i chłopcy, tyg. 0-52)
  schema.ts              — schemat bazy danych (Drizzle)
  db.ts                  — klient Neon PostgreSQL
  auth.ts                — NextAuth konfiguracja
  baby.ts                — helper getBabyAge(), getOrCreateBaby()
  openrouter.ts          — klient OpenRouter (modele DEFAULT + SMART)

components/
  Navigation.tsx         — responsywna nawigacja (bottom mobile, top desktop)
  BabyAge.tsx            — komponent wieku dziecka
  EventFeed.tsx          — lista zdarzeń z modalem potwierdzenia usunięcia
  DashboardClient.tsx    — client wrapper dla dashboardu (delete state)
  ui/                    — shadcn/ui komponenty
```
