// Databasen: SQLite hos Turso (db/migrations), som serveren når over HTTPS med sin nøgle.
//
// Forespørgslerne er almindelig SQL med "?". Rækkerne kommer tilbage som almindelige objekter.
// Der er ingen RLS: den, der har databasen, ser alt. Kun filerne i api/ bruger den, og hver af dem
// tjekker selv, at nogen er logget ind (requireUser i api/_lib/auth.js).
//
// Lokalt (npm run dev, tests og scripts) kan TURSO_DATABASE_URL være en fil (file:C:/sti/fil.db);
// den åbnes med Node-klienten. På Vercel er det altid Turso med web-klienten, som ikke har et
// modul, der skal bygges med.
import { createClient as createWebClient } from '@libsql/client/web'

import { httpError } from './http.js'

/** Tåler værdier, der er sat ind med anførselstegn om. */
export const readEnv = (key) =>
  process.env[key]?.trim().replace(/^(['"])([\s\S]*)\1$/, '$2') || undefined

// undefined = ikke åbnet endnu.
let opened

async function open(url, authToken) {
  if (url.startsWith('file:') || url === ':memory:') {
    if (process.env.VERCEL === '1') throw new Error('En lokal databasefil kan ikke bruges på Vercel.')
    // Navnet i en variabel, så Vercels bygning ikke tager Node-klienten og dens modul med.
    const nodeClient = '@libsql/client'
    const { createClient } = await import(/* @vite-ignore */ nodeClient)
    return createClient({ url })
  }
  return createWebClient({ url, ...(authToken ? { authToken } : {}) })
}

/** Databasen, eller null når TURSO_DATABASE_URL mangler. */
export async function database() {
  if (opened === undefined) {
    const url = readEnv('TURSO_DATABASE_URL')
    opened = url ? open(url, readEnv('TURSO_AUTH_TOKEN')) : Promise.resolve(null)
  }
  return opened
}

/** Databasen, eller en fejl, som /api svarer med. */
export async function getDb() {
  const db = await database()
  if (!db) throw httpError(500, 'Databasen er ikke sat op. Sæt TURSO_DATABASE_URL i .env')
  return db
}

/** Kun til tests og scripts: en anden database end miljøets. */
export function setDatabase(client) {
  opened = Promise.resolve(client)
}

/** En række fra libsql som et almindeligt objekt. */
function toObject(row, columns) {
  const object = {}
  for (const column of columns) {
    const v = row[column]
    object[column] = v === undefined ? null : typeof v === 'bigint' ? Number(v) : v
  }
  return object
}

/** Alle rækker, en forespørgsel giver. `on` kan være en anden klient (tests). */
export async function rows(sql, args = [], on) {
  const r = await (on ?? (await getDb())).execute({ sql, args })
  return r.rows.map((row) => toObject(row, r.columns))
}

/** Den første række, en forespørgsel giver, eller null. */
export async function row(sql, args = [], on) {
  return (await rows(sql, args, on))[0] ?? null
}

/** Kører en sætning, der skriver, og svarer med antallet af ændrede rækker. */
export async function run(sql, args = [], on) {
  return (await (on ?? (await getDb())).execute({ sql, args })).rowsAffected
}

/**
 * Flere sætninger i ét kald og én transaktion: alt eller intet, og ingen andre kan skrive midt i.
 * Svarer med hver sætnings rækker som objekter og antallet af ændrede rækker.
 */
export async function batch(statements, mode = 'write', on) {
  if (statements.length === 0) return []
  const results = await (on ?? (await getDb())).batch(statements, mode)
  return results.map((r) => ({
    rows: r.rows.map((row) => toObject(row, r.columns)),
    rowsAffected: r.rowsAffected,
  }))
}

/** Nu i databasens form: ISO 8601 i UTC med millisekunder. */
export const now = () => new Date().toISOString()

/**
 * Et tidspunkt fra browseren eller en URL i databasens form, læst som Postgres læste det:
 * uden tidszone er det UTC ("2026-01-31" og "2026-01-31T23:59:59" er UTC). Null ved noget ugyldigt.
 */
export function toUtcIso(value) {
  if (value === null || value === undefined || value === '') return null
  let s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z'
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = s.replace(' ', 'T') + 'Z'
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}
