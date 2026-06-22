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
- **Database:** Supabase (Postgres)
- **SMS:** [GatewayAPI](https://gatewayapi.com)

Supabase service-nøgle og GatewayAPI-token bruges **kun server-side** i `/api` og når
aldrig browseren.

## Opsætning

### 1. Supabase

1. Opret et projekt på [supabase.com](https://supabase.com).
2. Åbn **SQL Editor** og kør indholdet af [`schema.sql`](schema.sql).
3. Find under **Project Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `service_role`-nøglen (hemmelig) → `SUPABASE_SERVICE_ROLE_KEY`

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

## Deploy til Vercel

1. Importér projektet i Vercel (framework registreres som Vite automatisk).
2. Tilføj de samme miljøvariabler under **Settings → Environment Variables**:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GATEWAYAPI_TOKEN`, `GATEWAYAPI_SENDER`,
   `DEFAULT_COUNTRY_CODE`.
3. Deploy. Filerne i `/api` bliver automatisk til serverless functions, og
   [`vercel.json`](vercel.json) sørger for at klient-ruter (fx `/historik`) virker ved direkte besøg.

## SMS-skabelon

Teksten redigeres under **Indstillinger**. Følgende pladsholdere erstattes ved afsendelse:

| Pladsholder  | Bliver til                          |
| ------------ | ----------------------------------- |
| `{minutter}` | antal minutter før færdig           |
| `{tid}`      | aftalt færdig-tidspunkt (fx `18.30`) |
| `{navn}`     | navn/note på ordren                 |

Standard: _"Hej! Din ordre er snart klar – ca. kl. {tid} (om {minutter} min.). Vi glæder os til at se dig!"_
