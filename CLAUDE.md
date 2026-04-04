@AGENTS.md

# Baby Monitor — kontekst dla AI asystenta

## Czym jest ten projekt

Aplikacja do monitorowania noworodka z AI agentem (tool-calling loop, pattern z kursu AI-devs).
Zbudowana w Next.js 16 App Router + Neon PostgreSQL + SMSAPI.pl + OpenRouter.

## Kluczowe pliki — co gdzie jest

| Plik | Rola |
|------|------|
| `lib/heartbeat-agent.ts` | Główny agent AI — pętla tool-calling, 8 narzędzi, pamięć, decision log |
| `lib/sms-agent.ts` | Klasyfikator SMS (structured output, single-shot) |
| `lib/schema.ts` | Schemat Drizzle — tabele: babies, events, notifications, agent_memory, agent_runs, settings |
| `lib/openrouter.ts` | `DEFAULT_MODEL = gemini-2.5-flash`, `SMART_MODEL = claude-sonnet-4-5` |
| `lib/sms.ts` | SMSAPI.pl — endpoint `.pl` (nie `.com`!), Bearer token, format telefonu bez `+` |
| `lib/who-data.ts` | Normy WHO P3-P97, dziewczynki i chłopcy, tygodnie 0-52, z interpolacją |
| `lib/baby.ts` | `getOrCreateBaby()` czyta z DB lub tworzy z env vars; `getBabyAge()` |
| `middleware.ts` | Wyklucza `/api/heartbeat` i `/api/sms` z auth — nie usuwać! |

## Baza danych

Drizzle ORM + Neon PostgreSQL. Aby zaktualizować schemat:
```bash
npx drizzle-kit push
```

Nowe tabele muszą być eksportowane z `lib/schema.ts` — `lib/db.ts` robi `import * as schema`.

## Agent — jak działa pętla

```
POST /api/heartbeat (x-cron-secret header)
  → runHeartbeatAgent()
    → read_memory()                    # zawsze pierwsze narzędzie
    → [tool calls równolegle]          # Promise.all na wszystkich tool_calls
    → [kolejne kroki aż stop / max 15]
    → db.insert(agentRuns)             # decision log każdego uruchomienia
```

Model: `DEFAULT_MODEL` (regularne sprawdzenia), `SMART_MODEL` (niedziela 19-21, cotygodniowe podsumowanie).

## SMS — ważne szczegóły

- Endpoint SMSAPI: `https://api.smsapi.pl` (koniecznie `.pl`, nie `.com` — konta polskie!)
- Format telefonu wychodzącego: `48XXXXXXXXX` (bez `+`)
- Incoming webhook: form-encoded POST z polami `sms_from`, `sms_text`
- Odpowiedź webhook: plain text `"OK"` (nie JSON, nie XML)

## Autentykacja

NextAuth v5 + Google OAuth. Whitelist emaili w `ALLOWED_EMAILS` env (przecinki, bez spacji).
Callback URL Google: `https://DOMENA/api/auth/callback/google`.

## Deploy

```bash
# Zmiana env var na Vercel (--force nadpisuje istniejącą):
printf '%s' "wartość" | npx vercel env add NAZWA production --force

# Deploy na produkcję:
npx vercel --prod
```

## Czego NIE zmieniać bez przemyślenia

- `middleware.ts` — wykluczenia `/api/heartbeat` i `/api/sms` są krytyczne
- `lib/sms.ts` — endpoint musi być `.pl`
- `notifications` table — używana do deduplication SMS przez `check_notification_sent` tool
