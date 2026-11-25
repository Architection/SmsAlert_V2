import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import campaign from '../api/campaign.js'
import { toUtcIso } from '../api/_lib/db.js'
import { campaignNumbers, campaignSummary, syncArchive } from '../api/_lib/store.js'
import { addSupabaseUser, call, freshDb, loginCookie } from './helpers.js'

let db

beforeEach(async () => {
  db = await freshDb()
})
afterEach(() => db.cleanup())

async function archive(list) {
  for (const [phone, ordered_at, source = 'import'] of list) {
    await db.client.execute({
      sql: 'insert into sms_archive (phone, ordered_at, source) values (?, ?, ?)',
      args: [phone, ordered_at, source],
    })
  }
}

const AT = new Date('2026-11-25T12:00:00.000Z')

const SAMPLE = [
  ['4511111111', '2020-04-14T15:24:42.940Z'],
  ['4511111111', '2026-11-20T10:00:00.000Z'],
  ['4511111111', '2026-11-24T10:00:00.000Z'],
  ['4522222222', '2026-11-01T10:00:00.000Z'],
  ['4522222222', '2026-11-18T12:00:00.000Z'], // præcis 7 dage før AT
  ['4533333333', '2026-10-01T10:00:00.000Z'],
]

describe('campaign_summary', () => {
  it('tæller som Postgres-funktionen', async () => {
    await archive(SAMPLE)
    await db.client.execute(`update settings set archive_last_sync_at = '2026-07-31T12:48:08.143Z'`)
    const s = await campaignSummary(AT)
    expect(s).toEqual({
      total_rows: 6,
      unique_numbers: 3,
      last_7_days: 3, // >= 18/11 12:00: 20/11, 24/11 og 18/11 12:00
      last_30_days: 4, // >= 26/10 12:00: alle undtagen 2020 og 1/10
      first_order: '2020-04-14T15:24:42.940Z',
      last_order: '2026-11-24T10:00:00.000Z',
      top_numbers: [
        { phone: '4511111111', orders: 3, last_order: '2026-11-24T10:00:00.000Z' },
        { phone: '4522222222', orders: 2, last_order: '2026-11-18T12:00:00.000Z' },
        { phone: '4533333333', orders: 1, last_order: '2026-10-01T10:00:00.000Z' },
      ],
      last_sync_at: '2026-07-31T12:48:08.143Z',
    })
  })

  it('tomt arkiv', async () => {
    const s = await campaignSummary(AT)
    expect(s).toMatchObject({ total_rows: 0, unique_numbers: 0, first_order: null, last_order: null, top_numbers: [] })
  })
})

describe('campaign_numbers', () => {
  it('grupperer, filtrerer og sorterer som Postgres-funktionen', async () => {
    await archive(SAMPLE)
    const all = await campaignNumbers({})
    expect(all.map((r) => [r.phone, r.orders])).toEqual([
      ['4511111111', 3],
      ['4522222222', 2],
      ['4533333333', 1],
    ])
    expect(all[0]).toEqual({
      phone: '4511111111',
      orders: 3,
      first_order: '2020-04-14T15:24:42.940Z',
      last_order: '2026-11-24T10:00:00.000Z',
    })

    const nov = await campaignNumbers({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-20T23:59:59.000Z' })
    expect(nov.map((r) => [r.phone, r.orders])).toEqual([
      ['4522222222', 2],
      ['4511111111', 1],
    ])

    expect((await campaignNumbers({ minOrders: 2 })).map((r) => r.phone)).toEqual(['4511111111', '4522222222'])
    expect((await campaignNumbers({ q: '3333' })).map((r) => r.phone)).toEqual(['4533333333'])
    expect(await campaignNumbers({ limit: 1 })).toHaveLength(1)
  })

  it('giver mere end 1.000 numre, når der bedes om det (Supabase stoppede ved 1.000)', async () => {
    const statements = []
    for (let i = 0; i < 1500; i++) {
      statements.push({
        sql: 'insert into sms_archive (phone, ordered_at, source) values (?, ?, ?)',
        args: [`45${String(20000000 + i)}`, '2026-01-01T00:00:00.000Z', 'import'],
      })
    }
    await db.client.batch(statements, 'write')
    expect(await campaignNumbers({ limit: 200000 })).toHaveLength(1500)
    expect(await campaignNumbers({})).toHaveLength(1000)
  })
})

describe('datoerne fra filteret læses som UTC, som Postgres gjorde', () => {
  it('toUtcIso', () => {
    expect(toUtcIso('2026-01-31')).toBe('2026-01-31T00:00:00.000Z')
    expect(toUtcIso('2026-01-31T23:59:59')).toBe('2026-01-31T23:59:59.000Z')
    expect(toUtcIso('2026-07-01T23:59:59')).toBe('2026-07-01T23:59:59.000Z')
    expect(toUtcIso('2026-01-31T23:59:59+01:00')).toBe('2026-01-31T22:59:59.000Z')
    expect(toUtcIso('noget')).toBeNull()
    expect(toUtcIso('')).toBeNull()
  })
})

describe('Hent seneste ordrer (sync)', () => {
  async function orderAt(phone, created_at) {
    await db.client.execute({
      sql: `insert into orders (id, order_no, phone, lead_minutes, ready_at, status, created_at)
            values (?, 1, ?, 3, ?, 'sent', ?)`,
      args: [crypto.randomUUID(), phone, created_at, created_at],
    })
  }

  it('henter ordrer efter vandmærket, springer ugyldige numre over, og to gange giver ingen dubletter', async () => {
    await archive([['4540184636', '2026-07-30T15:38:39.628Z', 'orders']])
    await orderAt('40184636', '2026-07-30T15:38:39.628Z') // = vandmærket: allerede hentet
    await orderAt('40 18 46 36', '2026-08-01T10:00:00.000Z')
    await orderAt('+46 70 123 45 67', '2026-08-02T10:00:00.000Z')
    await orderAt('123', '2026-08-03T10:00:00.000Z') // ugyldigt

    const first = await syncArchive()
    expect(first).toMatchObject({ inserted: 2, scanned: 2, skipped: 1 })
    expect(first.last_sync_at).toMatch(/Z$/)

    const second = await syncArchive()
    expect(second).toMatchObject({ inserted: 0, scanned: 0, skipped: 1 })

    const phones = await db.client.execute(`select phone from sms_archive where source = 'orders' order by ordered_at`)
    expect(phones.rows.map((r) => r.phone)).toEqual(['4540184636', '4540184636', '46701234567'])
    const s = await db.client.execute('select archive_last_sync_at from settings')
    expect(s.rows[0].archive_last_sync_at).toBe(second.last_sync_at)
  })

  it('henter alle på én gang, også over 1.000', async () => {
    const statements = []
    for (let i = 0; i < 1234; i++) {
      const t = new Date(Date.UTC(2026, 7, 1) + i * 60000).toISOString()
      statements.push({
        sql: `insert into orders (id, order_no, phone, lead_minutes, ready_at, created_at) values (?, ?, ?, 3, ?, ?)`,
        args: [crypto.randomUUID(), i, String(20000000 + i), t, t],
      })
    }
    await db.client.batch(statements, 'write')
    expect(await syncArchive()).toMatchObject({ inserted: 1234, scanned: 1234, skipped: 0 })
  })
})

describe('/api/campaign', () => {
  it('kræver login og svarer med de samme felter som før', async () => {
    expect((await call(campaign, { url: '/api/campaign?action=summary' })).statusCode).toBe(401)
    await addSupabaseUser(db.client, 'butik@eksempel.dk', 'hemmelig1')
    const cookie = await loginCookie('butik@eksempel.dk', 'hemmelig1')
    await archive(SAMPLE)

    const summary = await call(campaign, { url: '/api/campaign?action=summary', cookie })
    expect(Object.keys(summary.body).sort()).toEqual(
      ['first_order', 'last_30_days', 'last_7_days', 'last_order', 'last_sync_at', 'top_numbers', 'total_rows', 'unique_numbers'],
    )

    const nums = await call(campaign, {
      url: '/api/campaign?action=numbers&from=2026-11-01&to=2026-11-20T23:59:59&minOrders=1&q=45-11&limit=1000',
      cookie,
    })
    expect(nums.body.map((r) => [r.phone, r.orders])).toEqual([['4511111111', 1]])

    const bad = await call(campaign, { url: '/api/campaign?action=numbers&from=ikke-en-dato', cookie })
    expect(bad.statusCode).toBe(400)

    const sync = await call(campaign, { method: 'POST', url: '/api/campaign', cookie, body: {} })
    expect(sync.body).toMatchObject({ inserted: 0, scanned: 0, skipped: 0 })
  })
})
