# Instrukcja deployu Baby Monitor

## Krok 1: Neon PostgreSQL (baza danych)

1. Wejdź na https://console.neon.tech i utwórz konto
2. Kliknij "New Project" → nazwa: `baby-monitor`
3. Region: **Europe (Frankfurt)**
4. Po utworzeniu skopiuj **Connection string** (wygląda jak `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`)
5. Wklej do `.env.local` jako `DATABASE_URL=...`

## Krok 2: Migracja bazy danych

Po ustawieniu DATABASE_URL:
```bash
npm run db:push
```

Spowoduje to utworzenie wszystkich tabel w Neon.

## Krok 3: Google OAuth

1. Wejdź na https://console.cloud.google.com
2. Utwórz nowy projekt lub wybierz istniejący
3. Menu: "APIs & Services" → "Credentials" → "Create Credentials" → "OAuth client ID"
4. Application type: **Web application**
5. Authorized redirect URIs dodaj:
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://TWOJA-DOMENA.vercel.app/api/auth/callback/google` (prod)
6. Skopiuj Client ID → `AUTH_GOOGLE_ID`
7. Skopiuj Client Secret → `AUTH_GOOGLE_SECRET`
8. `AUTH_SECRET`: wygeneruj komendą `openssl rand -base64 32`

## Krok 4: SMSAPI.pl

### Rejestracja
1. Wejdź na **https://ssl.smsapi.com/signup** i utwórz konto
2. Potwierdź email → zaloguj się do panelu
3. Doładuj konto (minimum ~10 PLN, koszt SMS ~0.09-0.15 PLN)

### Token API (OAuth)
1. Panel → **API** → **OAuth** → **Dodaj token**
2. Nadaj nazwę (np. "baby-monitor") → **Zapisz**
3. Skopiuj wygenerowany token → wklej jako `SMSAPI_TOKEN`

### Nazwa nadawcy (wyświetla się zamiast numeru)
- Na start użyj `SMSAPI_SENDER=Test` — działa od razu bez rejestracji
- Docelowo: Panel → **Ustawienia** → **Nazwy nadawców** → **Dodaj** → wpisz np. `BabyMon` (max 11 znaków) → czekaj na akceptację (zwykle 24h)

### Numery telefonów rodziców
W `.env.local`:
```
PARENT1_PHONE=+48XXXXXXXXX   # Twój numer
PARENT2_PHONE=+48XXXXXXXXX   # Numer żony
```

### Odbieranie SMS od rodziców (2-way, opcjonalne)
> Pozwala logować zdarzenia przez SMS np. "karmienie 60ml"

1. Napisz na support SMSAPI (support@smsapi.com): *"Proszę o aktywację 2-way SMS i przydzielenie wirtualnego numeru"*
2. Po aktywacji: Panel → **Ustawienia** → **Callbacki MO (odbiór SMS)** → ustaw URL:
   `https://TWOJA-DOMENA.vercel.app/api/sms/incoming`
3. Wpisz numer jako `SMSAPI_TWOWAY_NUMBER` w `.env.local`

> ⚠️ Bez 2-way number możesz wysyłać powiadomienia do rodziców, ale nie możesz logować przez SMS. Aplikacja działa normalnie przez UI.

## Krok 5: OpenRouter

1. Wejdź na https://openrouter.ai i utwórz konto
2. Settings → Keys → "Create Key"
3. Wklej jako `OPENROUTER_API_KEY`
4. Doładuj konto kilkoma dolarami (koszty: ~$0.01 za wywołanie heartbeatu)

## Krok 6: Uzupełnij dane dziecka

W `.env.local` ustaw:
```
BABY_NAME=Zuzia          # Imię dziecka
BABY_BIRTH_DATE=2025-01-15  # Data urodzenia (YYYY-MM-DD)
BABY_GENDER=F            # M lub F
ALLOWED_EMAILS=twoj@gmail.com,zona@gmail.com
CRON_SECRET=wpisz-dowolny-tajny-string
```

## Krok 7: Deploy na Vercel

### Opcja A: przez CLI
```bash
npm i -g vercel
vercel login
vercel --prod
```

### Opcja B: przez GitHub
1. Utwórz repo na GitHub: `git init && git add . && git commit -m "init" && git remote add origin URL && git push`
2. Wejdź na https://vercel.com → Import Project → wybierz repo
3. Dodaj wszystkie zmienne środowiskowe z `.env.local` w panelu Vercel
4. Deploy!

### Zmienne środowiskowe na Vercel:
Skopiuj wszystkie wartości z `.env.local` do Vercel Dashboard → Settings → Environment Variables.
**WAŻNE**: `NEXT_PUBLIC_APP_URL` ustaw na `https://TWOJA-DOMENA.vercel.app`

## Krok 8: cron-job.org (heartbeat co 30 minut)

1. Wejdź na https://cron-job.org i utwórz konto (DARMOWE)
2. Dashboard → "Create cronjob"
3. URL: `https://TWOJA-DOMENA.vercel.app/api/heartbeat`
4. Execution schedule: `*/30 * * * *` (co 30 minut)
5. HTTP Method: **POST**
6. Headers: dodaj `x-cron-secret: TWÓJ_CRON_SECRET`
7. Save!

## Krok 9: Test po deployu

1. Otwórz aplikację, zaloguj się przez Google
2. Idź do Settings i sprawdź czy dane dziecka są poprawne
3. Zaloguj pierwsze zdarzenie przez UI
4. Wyślij testowy SMS: `"karmienie 60ml"` na numer 2-way SMSAPI (jeśli aktywowany)
5. Sprawdź czy SMS wrócił z potwierdzeniem
6. Ręczny test heartbeatu:
   ```
   curl -X POST https://TWOJA-DOMENA.vercel.app/api/heartbeat \
     -H "x-cron-secret: TWÓJ_CRON_SECRET"
   ```

## Koszty miesięczne (szacunkowe)

| Serwis | Koszt |
|--------|-------|
| Vercel Hobby | **GRATIS** |
| Neon PostgreSQL | **GRATIS** (0.5GB) |
| cron-job.org | **GRATIS** |
| OpenRouter (AI) | ~$1-3/miesiąc (~4-12 PLN) |
| SMSAPI.pl (~20 SMS/dzień × 0.12 PLN) | ~70-80 PLN/miesiąc |
| **RAZEM** | **~75-95 PLN/miesiąc** |

## Troubleshooting

**Błąd logowania Google**: Sprawdź czy redirect URI w Google Console odpowiada dokładnie domenie Vercel.

**SMS nie dochodzi**: Panel SMSAPI → **Historia wysyłek** → sprawdź status wiadomości. Kod błędu 14 = niezarejestrowana nazwa nadawcy (zmień `SMSAPI_SENDER=Test`).

**Heartbeat nie działa**: Sprawdź Vercel Functions → Logs oraz cron-job.org → History.

**Baza danych**: Sprawdź czy `DATABASE_URL` jest poprawne i uruchom `npm run db:push` ponownie.
