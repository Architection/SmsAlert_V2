// Anvender schema.sql mod databasen. schema.sql er fuldt idempotent
// (if not exists / create or replace / on conflict do nothing), så det er
// sikkert at køre ved hvert deploy.
//
// Kør lokalt:        npm run migrate           (læser SUPABASE_DB_URL fra .env)
// På Vercel:         sættes som "vercel-build" – kører kun mod produktion.
//
// Bruger node-postgres' SIMPLE query-protokol (plain string uden parametre),
// så hele filen kan køres i ét kald uden at ramme poolerens prepared-statement-
// begrænsninger. Kræver derfor IKKE supabase CLI-login.
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

// På Vercel: rør kun prod-skemaet. Preview-builds skal ikke migrere.
if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production') {
  console.log('migrate: springer over (Vercel preview-build).')
  process.exit(0)
}

const url = process.env.SUPABASE_DB_URL
if (!url) {
  // Fejl ikke et build der ikke er sat op til migration – spring blot over.
  console.warn('migrate: SUPABASE_DB_URL mangler – migration sprunget over.')
  process.exit(0)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sql = readFileSync(resolve(root, 'schema.sql'), 'utf8')

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(sql) // simpel protokol → flere statements i ét kald
  console.log('migrate: schema.sql anvendt.')
} finally {
  await client.end()
}
