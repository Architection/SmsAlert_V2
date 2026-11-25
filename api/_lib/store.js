// Datafunktionerne bag api/: ordrer, indstillinger og SMS-arkivet (Kampagne), som SQL mod Turso.
// De svarer med de samme felter som Supabase gjorde, så siderne i src/ ikke skal ændres.
// Tider er ISO 8601 i UTC med millisekunder (se db/migrations/0002_app.sql).
//
// De tre Postgres-funktioner fra schema.sql er her som kode: next_order_number (createOrder),
// campaign_summary (campaignSummary) og campaign_numbers (campaignNumbers).
import { batch, now, row, rows, run } from './db.js'
import { toMsisdn } from './sms.js'
import { copenhagenDayStartISO } from './time.js'

/* ------------------------------------------------------------------ */
/* Ordrer                                                              */
/* ------------------------------------------------------------------ */

export const ORDER_STATUSES = ['active', 'sent', 'done', 'cancelled']

export async function getOrder(id) {
  return row('select * from orders where id = ?', [id])
}

/**
 * En af listerne: 'active' (aktive, ikke slettede), 'history' (dagens afsluttede, ikke slettede)
 * eller 'deleted' (slettede fra alle dage, højst 500). Postgres sorterede null først ved "desc";
 * det gør "nulls first" også her.
 */
export async function listOrders(view = 'active', at = new Date()) {
  if (view === 'history') {
    return rows(
      `select * from orders
       where created_at >= ? and status <> 'active' and deleted_at is null
       order by order_no desc nulls first`,
      [copenhagenDayStartISO(at)],
    )
  }
  if (view === 'deleted') {
    return rows(
      `select * from orders where deleted_at is not null
       order by deleted_at desc nulls first limit 500`,
    )
  }
  return rows(
    `select * from orders where status = 'active' and deleted_at is null
     order by order_no desc nulls first`,
  )
}

/**
 * Opretter en ordre med det næste ordrenummer. Tælleren rulles én frem og ordren indsættes i samme
 * transaktion (som next_order_number() i Postgres), så to ordrer på samme tid aldrig får samme
 * nummer. Mangler indstillingsrækken, får ordren intet nummer, som før.
 */
export async function createOrder({ phone, name, leadMinutes, readyAt }) {
  const [, inserted] = await batch([
    { sql: 'update settings set next_order_no = next_order_no + 1 where id = 1', args: [] },
    {
      sql: `insert into orders (id, order_no, phone, name, lead_minutes, ready_at)
            values (?, (select next_order_no - 1 from settings where id = 1), ?, ?, ?, ?)
            returning *`,
      args: [crypto.randomUUID(), phone, name, leadMinutes, readyAt],
    },
  ])
  return inserted.rows[0]
}

const ORDER_COLUMNS = new Set([
  'status',
  'name',
  'phone',
  'lead_minutes',
  'ready_at',
  'deleted_at',
  'sms_sent_at',
  'sms_body',
])

/** Retter de givne felter og svarer med ordren, eller null når den ikke findes. */
export async function updateOrder(id, patch) {
  const columns = Object.keys(patch).filter((k) => patch[k] !== undefined)
  for (const c of columns) if (!ORDER_COLUMNS.has(c)) throw new Error(`Ukendt felt: ${c}`)
  if (columns.length === 0) return getOrder(id)
  return row(
    `update orders set ${columns.map((c) => `"${c}" = ?`).join(', ')} where id = ? returning *`,
    [...columns.map((c) => patch[c]), id],
  )
}

/** Blød sletning: rækken bliver, men markeres som slettet. Intet sker, hvis den ikke findes. */
export async function softDeleteOrder(id) {
  await run('update orders set deleted_at = ? where id = ?', [now(), id])
}

/* ------------------------------------------------------------------ */
/* Indstillinger                                                       */
/* ------------------------------------------------------------------ */

export async function getSettings() {
  return row('select * from settings where id = 1')
}

const SETTINGS_COLUMNS = new Set([
  'sms_template',
  'sender_name',
  'next_order_no',
  'archive_last_sync_at',
  'updated_at',
])

/** Retter de givne felter og svarer med rækken, eller null når den ikke findes. */
export async function updateSettings(patch) {
  const columns = Object.keys(patch).filter((k) => patch[k] !== undefined)
  for (const c of columns) if (!SETTINGS_COLUMNS.has(c)) throw new Error(`Ukendt felt: ${c}`)
  if (columns.length === 0) return getSettings()
  return row(
    `update settings set ${columns.map((c) => `"${c}" = ?`).join(', ')} where id = 1 returning *`,
    columns.map((c) => patch[c]),
  )
}

/* ------------------------------------------------------------------ */
/* SMS-arkivet (Kampagne)                                              */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000

/** Nøgletal + top 10 + hvornår der sidst blev hentet, som campaign_summary() + settings. */
export async function campaignSummary(at = new Date()) {
  const since = (days) => new Date(at.getTime() - days * DAY_MS).toISOString()
  const [totals, top, settings] = await batch(
    [
      {
        sql: `select
                (select count(*) from sms_archive) as total_rows,
                (select count(distinct phone) from sms_archive) as unique_numbers,
                (select count(*) from sms_archive where ordered_at >= ?) as last_7_days,
                (select count(*) from sms_archive where ordered_at >= ?) as last_30_days,
                (select min(ordered_at) from sms_archive) as first_order,
                (select max(ordered_at) from sms_archive) as last_order`,
        args: [since(7), since(30)],
      },
      {
        sql: `select phone, count(*) as orders, max(ordered_at) as last_order
              from sms_archive
              group by phone
              order by count(*) desc, max(ordered_at) desc
              limit 10`,
        args: [],
      },
      { sql: 'select archive_last_sync_at from settings where id = 1', args: [] },
    ],
    'read',
  )
  return {
    ...totals.rows[0],
    top_numbers: top.rows,
    last_sync_at: settings.rows[0]?.archive_last_sync_at ?? null,
  }
}

/**
 * Unikke numre med antal bestillinger, første og seneste, som campaign_numbers(). Filtrene kan
 * udelades (null). `from` og `to` er ISO-tider i UTC; `q` er cifre, der skal stå i nummeret.
 */
export async function campaignNumbers({ from = null, to = null, minOrders = 1, q = null, limit = 1000 }) {
  return rows(
    `select phone,
            count(*)        as orders,
            min(ordered_at) as first_order,
            max(ordered_at) as last_order
     from sms_archive
     where (?1 is null or ordered_at >= ?1)
       and (?2 is null or ordered_at <= ?2)
       and (?3 is null or phone like '%' || ?3 || '%')
     group by phone
     having count(*) >= coalesce(?4, 1)
     order by orders desc, last_order desc
     limit coalesce(?5, 1000)`,
    [from, to, q, minOrders, limit],
  )
}

/**
 * "Hent seneste ordrer": numrene fra ordrer, der er oprettet efter den seneste, arkivet har fra
 * ordrerne, kommer i arkivet. To gange giver ingen dubletter (unik på nummer + tidspunkt).
 * Supabase gav højst 1.000 ordrer pr. klik; her hentes alle på én gang.
 */
export async function syncArchive() {
  const mark = await row(
    `select max(ordered_at) as watermark from sms_archive where source = 'orders'`,
  )
  const watermark = mark?.watermark ?? null
  const orders = await rows(
    `select phone, created_at from orders
     where (?1 is null or created_at > ?1)
     order by created_at asc`,
    [watermark],
  )

  const found = []
  let skipped = 0
  for (const o of orders) {
    try {
      found.push([String(toMsisdn(o.phone)), o.created_at])
    } catch {
      skipped++
    }
  }

  const statements = []
  for (let i = 0; i < found.length; i += 100) {
    const chunk = found.slice(i, i + 100)
    statements.push({
      sql: `insert into sms_archive (phone, ordered_at, source)
            values ${chunk.map(() => "(?, ?, 'orders')").join(', ')}
            on conflict (phone, ordered_at) do nothing`,
      args: chunk.flat(),
    })
  }
  const lastSyncAt = now()
  statements.push({
    sql: 'update settings set archive_last_sync_at = ? where id = 1',
    args: [lastSyncAt],
  })
  const results = await batch(statements)
  const inserted = results.slice(0, -1).reduce((n, r) => n + r.rowsAffected, 0)

  return { inserted, scanned: found.length, skipped, last_sync_at: lastSyncAt }
}
