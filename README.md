# SMS Alert

Internt SMS-system til en restaurant. Personalet tager imod en ordre over telefonen,
og systemet hjælper med at sende kunden en SMS et aftalt antal minutter før ordren er klar.

## Sådan virker det

Når et opkald kommer ind, opretter personalet en ordre med:

- **Mobilnummer**
- **Minutter før færdig** der ønskes en SMS (fx 10)
- **Aftalt færdig-tidspunkt** (fx kl. 18.30)

På forsiden vises alle aktive ordrer med en **live nedtælling** til det tidspunkt, SMS'en
bør sendes — altså _færdig-tid minus minutter-før_. Når nedtællingen rammer nul, lyser
rækken rødt med **"Send nu!"**. Personalet trykker **Send SMS**, bekræfter teksten, og
beskeden afsendes via GatewayAPI.

- **Aktive ordrer** (`/`) – opret ordre + liste med nedtælling og send-knap
- **Historik** (`/historik`) – dagens afsluttede ordrer, klik for detaljer
- **Ordre-detalje** (`/ordre/:id`) – fuld info + den sendte SMS-tekst
- **Indstillinger** (`/indstillinger`) – den generelle SMS-tekst og afsendernavn

## Teknik

- **Frontend:** Vite + React 19 + React Router (SPA)
- **Backend:** Serverless functions i `/api` (kører som Vercel Functions i prod, og
  mountes lokalt af en lille Vite-plugin så `npm run dev` "bare virker")
- **Database:** SQLite hos [Turso](https://turso.tech) (Irland), oprettet gennem Vercel.
  Tabellerne står i [`db/migrations`](db/migrations) og oprettes med `npm run db:migrate`.
  Serveren taler med Turso over HTTPS (`api/_lib/db.js`); datafunktionerne ligger i
  `api/_lib/store.js`.
- **Login:** [Better Auth](https://better-auth.com) med e-mail og adgangskode
  (`api/_lib/auth-engine.js` og `api/_lib/auth.js`). Ingen kan oprette sig selv; brugere og nye
  adgangskoder laves med `npm run user -- navn@eksempel.dk`. Sessionen ligger i en HttpOnly-cookie.
- **Adgang:** Der er ingen RLS: hver fil i `/api` (undtagen login) kalder `requireUser` først.
  `test/guards.test.js` tjekker det.
- **SMS:** [GatewayAPI](https://gatewayapi.com)

Databasens nøgle, `BETTER_AUTH_SECRET` og GatewayAPI-token bruges **kun server-side** i `/api`
og når aldrig browseren.

Indtil november 2026 lå databasen og login hos Supabase (`schema.sql` er det gamle skema).

## Opsætning

### 1. Database og login

1. I produktion sætter Vercels Turso-integration `TURSO_DATABASE_URL` og `TURSO_AUTH_TOKEN`.
   Lokalt kan `TURSO_DATABASE_URL` være en fil (`file:C:/sti/smsalert.db`).
2. Opret tabellerne: `npm run db:migrate`.
3. Sæt `BETTER_AUTH_SECRET` til en lang tilfældig værdi.
4. Opret en bruger: `npm run user -- navn@eksempel.dk` (adgangskoden skrives bagefter, mindst 6 tegn).
   Samme kommando giver en eksisterende bruger en ny adgangskode og logger dens enheder ud.

### 2. GatewayAPI

1. Opret en konto på [gatewayapi.com](https://gatewayapi.com) og læg lidt kredit på.
2. Opret en **API-token** → `GATEWAYAPI_TOKEN`.
3. Vælg et afsendernavn (max 11 bogstaver) → `GATEWAYAPI_SENDER` (kan også ændres i Indstillinger).

### 3. Miljøvariabler

```bash
cp .env.example .env
# udfyld værdierne i .env
```

### 4. Kør lokalt

```bash
npm install
npm run dev
# åbn http://localhost:5173
```

Sæt `SMS_DRY_RUN=1` i `.env` lokalt, så "Send SMS" aldrig sender en rigtig SMS (det virker aldrig
på Vercel). Testene (`npm test`) kan heller ikke sende SMS.

## Deploy til Vercel

1. Projektet `smsalert` udrulles af sig selv fra `main` (domænet er `www.smsalert.dk`).
   **Et push til `main` er en ny udgave i produktion: kun efter butikken er lukket.**
2. Miljøvariabler under **Settings → Environment Variables**: `TURSO_DATABASE_URL` og
   `TURSO_AUTH_TOKEN` (fra Turso-integrationen), `BETTER_AUTH_SECRET`, `GATEWAYAPI_TOKEN`,
   `GATEWAYAPI_SENDER` og `DEFAULT_COUNTRY_CODE`.
3. Funktionerne kører i `dub1` (Irland) ved siden af databasen: `regions` i
   [`vercel.json`](vercel.json) og projektets standardregion. [`vercel.json`](vercel.json) sørger
   også for, at klient-ruter (fx `/historik`) virker ved direkte besøg.
4. CI (`.github/workflows/ci.yml`) kører lint, test og build ved hvert push.

## SMS-skabelon

Teksten redigeres under **Indstillinger**. Følgende pladsholdere erstattes ved afsendelse:

| Pladsholder  | Bliver til                          |
| ------------ | ----------------------------------- |
| `{minutter}` | antal minutter før færdig           |
| `{tid}`      | aftalt færdig-tidspunkt (fx `18.30`) |
| `{navn}`     | navn/note på ordren                 |

Standard: _"Hej! Din ordre er snart klar – ca. kl. {tid} (om {minutter} min.). Vi glæder os til at se dig!"_
