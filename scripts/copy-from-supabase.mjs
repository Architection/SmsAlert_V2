// Kopierer SMS Alerts data fra Supabase (Postgres) til Turso (SQLite):
//
//   npm run copy-from-supabase [-- --target file:C:/sti/kopi.db]
//
// Kilden er SUPABASE_DB_URL (Supabases pooler, kun læsning i én transaktion med et fast
// øjebliksbillede). Målet er TURSO_DATABASE_URL og TURSO_AUTH_TOKEN, eller --target.
//
// Kopien kan køres igen lige før skiftet: den tømmer målets tabeller og kopierer det hele på ny.
// Den nægter at køre, når nogen har logget ind på den nye database (en række i "session"), for så
// er skiftet sket, og en ny kopi ville slette det, der er skrevet siden.
//
// Hvad der kopieres (beslutning 2 i FLYTNING-FRA-SUPABASE.md): begge brugere med id og bcrypt-
// adgangskode, alle ordrer (også slettede), indstillingerne og hele SMS-arkivet. Ikke sessionerne
// (alle logger ind igen én gang). Hver tabel kontrolleres bagefter: samme antal rækker og samme
// indhold (en kontrolsum over hver værdi i begge ender). En ny kolonne i Postgres stopper kopien.
//
// Skrives om efter MadAssistents kopi (scripts/copy-from-supabase.ts i 10fda35). Slettes ved
// oprydningen efter flytningen.
import { createHash, randomUUID } from 'node:crypto'

import { createClient } from '@libsql/client'
import pg from 'pg'

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const SOURCE = process.env.SUPABASE_DB_URL
const TARGET = option('--target') ?? process.env.TURSO_DATABASE_URL
const TARGET_TOKEN = option('--target') ? undefined : process.env.TURSO_AUTH_TOKEN

if (!SOURCE || !TARGET) {
  console.error('Mangler SUPABASE_DB_URL eller TURSO_DATABASE_URL (eller --target).')
  process.exit(1)
}

/** Rækker pr. insert-sætning og højst så mange bytes pr. batch. */
const ROWS_PER_INSERT = 100
const MAX_BATCH_BYTES = 900_000
/** Rækker hentet ad gangen fra Postgres. */
const FETCH = 2000

/** Tabellerne. Ingen fremmednøgler mellem dem, så rækkefølgen er fri. */
const TABLES = ['settings', 'orders', 'sms_archive']

// ---- Værdier -----------------------------------------------------------------------------------

function kindOf(dataType) {
  switch (dataType) {
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return 'time'
    case 'smallint':
    case 'integer':
    case 'bigint':
      return 'int'
    case 'text':
    case 'uuid':
    case 'character varying':
      return 'text'
    default:
      throw new Error(`Ukendt kolonnetype: ${dataType}`)
  }
}

/** Udtrykket, der læser kolonnen i den form, SQLite skal have. Tider som ISO med millisekunder. */
function selectExpr(column, kind) {
  const c = `"${column}"`
  if (kind === 'time') return `to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ${c}`
  return `${c}::text as ${c}`
}

function normal(raw, kind) {
  if (raw === null || raw === undefined) return null
  const text = String(raw)
  if (kind === 'int') {
    const n = Number(text)
    if (!Number.isSafeInteger(n)) throw new Error(`Heltal uden for rækkevidde: ${text}`)
    return n
  }
  return text
}

/** En rækkes bidrag til tabellens kontrolsum (uafhængig af rækkefølgen). */
function rowHash(values) {
  const digest = createHash('sha256')
    .update(JSON.stringify(values.map((v) => (typeof v === 'number' ? `n:${v}` : v))))
    .digest()
  return digest.readBigUInt64BE(0)
}

const MASK = (1n << 64n) - 1n

// ---- Turso -------------------------------------------------------------------------------------

/**
 * Turso lukker en stille forbindelse, mens vi venter på Postgres, og næste kald fejler med "fetch
 * failed: other side closed". Kaldet nåede ikke frem, så det prøves én gang til.
 */
async function retry(work) {
  try {
    return await work()
  } catch (error) {
    const message = String(error?.message ?? error)
    if (!/other side closed|fetch failed|ECONNRESET|socket hang up/i.test(message)) throw error
    await new Promise((r) => setTimeout(r, 1000))
    return work()
  }
}

class Writer {
  constructor(turso) {
    this.turso = turso
    this.statements = []
    this.bytes = 0
  }

  async add(statement, size) {
    if (this.bytes + size > MAX_BATCH_BYTES) await this.flush()
    this.statements.push(statement)
    this.bytes += size
  }

  async flush() {
    if (this.statements.length === 0) return
    const batch = this.statements
    this.statements = []
    this.bytes = 0
    await retry(() => this.turso.batch(batch, 'write'))
  }
}

// ---- Kopien ------------------------------------------------------------------------------------

/** Kolonnerne, der kopieres: SQLite's, og hver af dem skal findes i Postgres og omvendt. */
async function plan(source, turso, table) {
  const pgCols = (
    await source.query(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = $1 order by ordinal_position`,
      [table],
    )
  ).rows
  const liteCols = (
    await turso.execute({ sql: 'select name from pragma_table_info(?)', args: [table] })
  ).rows.map((r) => String(r.name))
  const byName = new Map(pgCols.map((c) => [c.column_name, c]))
  const missing = liteCols.filter((c) => !byName.has(c))
  if (missing.length) throw new Error(`${table}: Postgres mangler ${missing.join(', ')}`)
  const extra = pgCols.map((c) => c.column_name).filter((c) => !liteCols.includes(c))
  if (extra.length) throw new Error(`${table}: ny kolonne i Postgres: ${extra.join(', ')}`)
  return liteCols.map((name) => ({ name, kind: kindOf(byName.get(name).data_type) }))
}

async function copyRows(source, writer, table, columns) {
  let count = 0
  let sum = 0n
  const select = `select ${columns.map((c) => selectExpr(c.name, c.kind)).join(', ')}
                  from public."${table}" order by ctid`
  const cursor = `kopi_${table}`
  await source.query(`declare ${cursor} no scroll cursor for ${select}`)
  const head = `insert into "${table}" (${columns.map((c) => `"${c.name}"`).join(', ')}) values `
  for (;;) {
    const page = await source.query(`fetch ${FETCH} from ${cursor}`)
    if (page.rows.length === 0) break
    for (let i = 0; i < page.rows.length; i += ROWS_PER_INSERT) {
      const chunk = page.rows.slice(i, i + ROWS_PER_INSERT)
      const sqlArgs = []
      const tuples = []
      let size = head.length
      for (const raw of chunk) {
        const values = columns.map((c) => normal(raw[c.name], c.kind))
        sum = (sum + rowHash(values)) & MASK
        // Heltal i SQL-teksten, tekst som parametre.
        const tuple = `(${values
          .map((v) => {
            if (v === null) return 'null'
            if (typeof v === 'number') return String(v)
            sqlArgs.push(v)
            return '?'
          })
          .join(', ')})`
        tuples.push(tuple)
        size += tuple.length + values.reduce((n, v) => n + (typeof v === 'string' ? v.length : 0), 0)
      }
      count += chunk.length
      await writer.add({ sql: head + tuples.join(', '), args: sqlArgs }, size)
    }
  }
  await source.query(`close ${cursor}`)
  return { count, sum }
}

/** Kontrolsummen over målets rækker, læst i samme form. */
async function targetSum(turso, table, columns) {
  let count = 0
  let sum = 0n
  let after = -9007199254740991
  const page = 5000
  for (;;) {
    // Efter rowid frem for "offset", så hver række kun læses én gang (Turso tager betaling pr. læst række).
    const r = await retry(() =>
      turso.execute({
        sql: `select rowid as _rowid, ${columns.map((c) => `"${c.name}"`).join(', ')} from "${table}"
              where rowid > ? order by rowid limit ${page}`,
        args: [after],
      }),
    )
    for (const row of r.rows) {
      after = Number(row._rowid)
      const values = columns.map((c) => {
        const v = row[c.name]
        if (v === null || v === undefined) return null
        if (typeof v === 'bigint') return Number(v)
        return v
      })
      sum = (sum + rowHash(values)) & MASK
    }
    count += r.rows.length
    if (r.rows.length < page) break
  }
  return { count, sum }
}

async function copyUsers(source, turso, writer) {
  const users = await source.query(
    `select u.id::text as id, lower(u.email) as email,
            split_part(lower(u.email), '@', 1) as name,
            u.email_confirmed_at is not null as verified,
            to_char(u.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
            to_char(coalesce(u.updated_at, u.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
            nullif(u.encrypted_password, '') as password
     from auth.users u
     where u.deleted_at is null
     order by u.created_at`,
  )
  for (const u of users.rows) {
    await writer.add(
      {
        sql: `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
              values (?, ?, ?, ?, ?, ?)`,
        args: [u.id, u.name, u.email, u.verified ? 1 : 0, u.created_at, u.updated_at],
      },
      500,
    )
    if (u.password) {
      await writer.add(
        {
          sql: `insert into "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
                values (?, ?, 'credential', ?, ?, ?, ?)`,
          args: [randomUUID(), u.id, u.id, u.password, u.created_at, u.updated_at],
        },
        500,
      )
    }
  }
  await writer.flush()
  const check = await turso.execute(
    `select count(*) as users, (select count(*) from "account") as accounts from "user"`,
  )
  const withPassword = users.rows.filter((u) => u.password).length
  if (Number(check.rows[0].users) !== users.rows.length || Number(check.rows[0].accounts) !== withPassword) {
    throw new Error('Brugerne blev ikke kopieret rigtigt.')
  }
  return { users: users.rows.length, withPassword }
}

async function main() {
  const turso = createClient({ url: TARGET, ...(TARGET_TOKEN ? { authToken: TARGET_TOKEN } : {}) })
  // Supabases pooler bruger et certifikat fra Supabases egen rod; kun læsning går over forbindelsen.
  const source = new pg.Client({ connectionString: SOURCE, ssl: { rejectUnauthorized: false } })
  await source.connect()
  try {
    // Har nogen logget ind på den nye database, er skiftet sket.
    const sessions = await turso.execute(`select count(*) as n from "session"`)
    if (Number(sessions.rows[0].n) > 0) {
      throw new Error('Der er sessioner i målet: skiftet er sket, og kopien kører ikke igen.')
    }
    const migrations = await turso.execute('select count(*) as n from _migrations')
    if (Number(migrations.rows[0].n) < 2) throw new Error('Målet mangler migrationerne.')

    // Ét fast øjebliksbillede af hele Postgres, kun læsning.
    await source.query('set session characteristics as transaction read only')
    await source.query('begin transaction isolation level repeatable read read only')
    const before = (
      await source.query(
        `select (select max(last_sign_in_at)::text from auth.users) as last_sign_in,
                (select max(created_at)::text from public.orders) as last_order,
                (select max(greatest(sms_sent_at, deleted_at))::text from public.orders) as last_change,
                (select next_order_no from public.settings where id = 1) as next_order_no`,
      )
    ).rows[0]
    console.log(
      `Kilde: sidste login ${before.last_sign_in} | sidste ordre ${before.last_order} | sidste SMS/sletning ${before.last_change} | næste ordrenummer ${before.next_order_no}`,
    )

    console.log('Tømmer målet …')
    await retry(() =>
      turso.batch(
        [
          ...[...TABLES].reverse().map((t) => `delete from "${t}"`),
          `delete from sqlite_sequence where name = 'sms_archive'`,
          `delete from "account"`,
          `delete from "verification"`,
          `delete from "user"`,
          `delete from login_attempts`,
        ],
        'write',
      ),
    )

    const writer = new Writer(turso)
    const started = Date.now()
    const u = await copyUsers(source, turso, writer)
    console.log(`Brugere: ${u.users} (${u.withPassword} med adgangskode)`)

    let total = 0
    for (const table of TABLES) {
      const t0 = Date.now()
      const columns = await plan(source, turso, table)
      const copied = await copyRows(source, writer, table, columns)
      await writer.flush()
      const check = await targetSum(turso, table, columns)
      const ok = check.count === copied.count && check.sum === copied.sum
      const seconds = Math.round((Date.now() - t0) / 100) / 10
      console.log(`${ok ? 'ens    ' : 'FORSKEL'}  ${table.padEnd(12)} ${String(copied.count).padStart(7)} rækker  ${seconds} s`)
      if (!ok) throw new Error(`${table}: målet har ${check.count} rækker / anden kontrolsum.`)
      total += copied.count
    }

    const next = await turso.execute('select next_order_no from settings where id = 1')
    if (Number(next.rows[0]?.next_order_no) !== Number(before.next_order_no)) {
      throw new Error('Næste ordrenummer passer ikke.')
    }

    await source.query('rollback')
    console.log(`Færdig: ${total} rækker i ${Math.round((Date.now() - started) / 1000)} s, alle tabeller ens.`)
  } finally {
    await source.end().catch(() => undefined)
    turso.close()
  }
}

main().catch((error) => {
  const message = String(error instanceof Error ? error.message : error).replace(/postgres(ql)?:\/\/\S+/g, '[url]')
  console.error('Kopien stoppede:', message)
  process.exit(1)
})
