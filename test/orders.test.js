import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import orders from '../api/orders.js'
import settings from '../api/settings.js'
import { copenhagenDayStartISO } from '../api/_lib/time.js'
import { createOrder, getSettings, listOrders, softDeleteOrder, updateOrder } from '../api/_lib/store.js'
import { addSupabaseUser, call, freshDb, loginCookie } from './helpers.js'

let db
let cookie

beforeEach(async () => {
  db = await freshDb()
  await addSupabaseUser(db.client, 'butik@eksempel.dk', 'hemmelig1')
  cookie = await loginCookie('butik@eksempel.dk', 'hemmelig1')
})
afterEach(() => db.cleanup())

const order = (extra = {}) => ({
  phone: '40184636',
  name: null,
  leadMinutes: 3,
  readyAt: '2026-11-25T17:30:00.000Z',
  ...extra,
})

/** Sætter en ordre ind med faste værdier (til lister med kendte tider). */
async function put(o) {
  await db.client.execute({
    sql: `insert into orders (id, order_no, phone, name, lead_minutes, ready_at, status, sms_sent_at, sms_body, deleted_at, created_at)
          values (?, ?, '40184636', null, 3, '2026-11-25T17:30:00.000Z', ?, null, null, ?, ?)`,
    args: [o.id, o.order_no ?? null, o.status ?? 'active', o.deleted_at ?? null, o.created_at],
  })
}

describe('ordrenumre (next_order_number)', () => {
  it('giver det næste nummer og ruller tælleren frem', async () => {
    await db.client.execute('update settings set next_order_no = 4478 where id = 1')
    const a = await createOrder(order())
    const b = await createOrder(order())
    expect([a.order_no, b.order_no]).toEqual([4478, 4479])
    expect((await getSettings()).next_order_no).toBe(4480)
  })

  it('to ordrer på samme tid får hver sit nummer', async () => {
    const made = await Promise.all(Array.from({ length: 8 }, () => createOrder(order())))
    const numbers = made.map((o) => o.order_no).sort((x, y) => x - y)
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('uden indstillingsrækken får ordren intet nummer, som i Postgres', async () => {
    await db.client.execute('delete from settings')
    const o = await createOrder(order())
    expect(o.order_no).toBeNull()
  })

  it('en ny ordre har samme felter som fra Supabase', async () => {
    const o = await createOrder(order({ name: 'Bord 4' }))
    expect(Object.keys(o).sort()).toEqual(
      [
        'id', 'order_no', 'phone', 'name', 'lead_minutes', 'ready_at', 'status',
        'sms_sent_at', 'sms_body', 'deleted_at', 'created_at',
      ].sort(),
    )
    expect(o.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(o.status).toBe('active')
    expect(o.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

describe('listerne', () => {
  it('aktive: kun aktive og ikke slettede, højeste nummer først', async () => {
    await put({ id: 'a', order_no: 1, created_at: '2026-11-24T10:00:00.000Z' })
    await put({ id: 'b', order_no: 3, created_at: '2026-11-25T10:00:00.000Z' })
    await put({ id: 'c', order_no: 2, status: 'sent', created_at: '2026-11-25T10:00:00.000Z' })
    await put({ id: 'd', order_no: 4, deleted_at: '2026-11-25T11:00:00.000Z', created_at: '2026-11-25T10:00:00.000Z' })
    expect((await listOrders('active')).map((o) => o.id)).toEqual(['b', 'a'])
  })

  it('historik: dagens ikke-aktive i dansk tid, uden slettede', async () => {
    const at = new Date('2026-11-25T19:00:00.000Z') // 20.00 i København
    // Midnat i København er 23.00 UTC dagen før (vintertid).
    expect(copenhagenDayStartISO(at)).toBe('2026-11-24T23:00:00.000Z')
    await put({ id: 'før', order_no: 1, status: 'sent', created_at: '2026-11-24T22:59:59.999Z' })
    await put({ id: 'midnat', order_no: 2, status: 'sent', created_at: '2026-11-24T23:00:00.000Z' })
    await put({ id: 'senere', order_no: 5, status: 'cancelled', created_at: '2026-11-25T18:00:00.000Z' })
    await put({ id: 'aktiv', order_no: 6, created_at: '2026-11-25T18:00:00.000Z' })
    await put({ id: 'slettet', order_no: 7, status: 'sent', deleted_at: '2026-11-25T18:30:00.000Z', created_at: '2026-11-25T18:00:00.000Z' })
    expect((await listOrders('history', at)).map((o) => o.id)).toEqual(['senere', 'midnat'])
  })

  it('historik i sommertid starter 22.00 UTC', () => {
    expect(copenhagenDayStartISO(new Date('2026-07-03T18:00:00.000Z'))).toBe('2026-07-02T22:00:00.000Z')
  })

  it('slettede: fra alle dage, senest slettet først, højst 500', async () => {
    await put({ id: 'x', order_no: 1, deleted_at: '2026-07-03T19:31:05.457Z', created_at: '2026-07-03T19:00:00.000Z' })
    await put({ id: 'y', order_no: 2, deleted_at: '2026-11-25T15:18:20.708Z', created_at: '2026-11-25T15:00:00.000Z' })
    await put({ id: 'z', order_no: 3, created_at: '2026-11-25T15:00:00.000Z' })
    expect((await listOrders('deleted')).map((o) => o.id)).toEqual(['y', 'x'])
    for (let i = 0; i < 510; i++) {
      await put({ id: `m${i}`, order_no: 100 + i, deleted_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z' })
    }
    expect(await listOrders('deleted')).toHaveLength(500)
  })

  it('ordrer uden nummer står først, som Postgres sorterede null ved "desc"', async () => {
    await put({ id: 'med', order_no: 9, created_at: '2026-11-25T10:00:00.000Z' })
    await put({ id: 'uden', order_no: null, created_at: '2026-11-25T10:00:00.000Z' })
    expect((await listOrders('active')).map((o) => o.id)).toEqual(['uden', 'med'])
  })
})

describe('/api/orders', () => {
  it('opretter, henter, retter, sletter og gendanner', async () => {
    const created = await call(orders, {
      method: 'POST',
      url: '/api/orders',
      cookie,
      body: { phone: ' 40 18 46 36 ', name: ' Bord 4 ', lead_minutes: 3.4, ready_at: '2026-11-25T17:30:00Z' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.body).toMatchObject({ phone: '40 18 46 36', name: 'Bord 4', lead_minutes: 3, ready_at: '2026-11-25T17:30:00.000Z', order_no: 1 })
    const id = created.body.id

    const one = await call(orders, { url: `/api/orders?id=${id}`, cookie })
    expect(one.body.id).toBe(id)

    const patched = await call(orders, {
      method: 'PATCH',
      url: `/api/orders?id=${id}`,
      cookie,
      body: { status: 'cancelled', name: '', lead_minutes: '5' },
    })
    expect(patched.body).toMatchObject({ status: 'cancelled', name: null, lead_minutes: 5 })

    const del = await call(orders, { method: 'DELETE', url: `/api/orders?id=${id}`, cookie })
    expect(del.body).toEqual({ ok: true })
    const deleted = await call(orders, { url: '/api/orders?view=deleted', cookie })
    expect(deleted.body.map((o) => o.id)).toEqual([id])

    const restored = await call(orders, { method: 'PATCH', url: `/api/orders?id=${id}`, cookie, body: { restore: true } })
    expect(restored.body.deleted_at).toBeNull()
  })

  it('afviser forkerte værdier som før', async () => {
    const bad = (body) => call(orders, { method: 'POST', url: '/api/orders', cookie, body })
    expect((await bad({ phone: '', lead_minutes: 3, ready_at: '2026-11-25T17:30:00Z' })).statusCode).toBe(400)
    expect((await bad({ phone: '123', lead_minutes: 3, ready_at: '2026-11-25T17:30:00Z' })).statusCode).toBe(400)
    expect((await bad({ phone: '40184636', lead_minutes: 3, ready_at: 'ikke en tid' })).statusCode).toBe(400)
    expect((await bad({ phone: '40184636', lead_minutes: -1, ready_at: '2026-11-25T17:30:00Z' })).statusCode).toBe(400)

    const o = await createOrder(order())
    const patch = (body) => call(orders, { method: 'PATCH', url: `/api/orders?id=${o.id}`, cookie, body })
    expect((await patch({ status: 'ukendt' })).statusCode).toBe(400)
    expect((await patch({})).statusCode).toBe(400)
    expect((await call(orders, { method: 'PATCH', url: '/api/orders?id=findes-ikke', cookie, body: { status: 'sent' } })).statusCode).toBe(404)
    expect((await call(orders, { url: '/api/orders?id=findes-ikke', cookie })).statusCode).toBe(404)
  })

  it('sletning af en ordre, der ikke findes, svarer ok som før', async () => {
    await softDeleteOrder('findes-ikke')
    const res = await call(orders, { method: 'DELETE', url: '/api/orders?id=findes-ikke', cookie })
    expect(res.body).toEqual({ ok: true })
  })

  it('updateOrder tager kun kendte felter', async () => {
    const o = await createOrder(order())
    await expect(updateOrder(o.id, { id: 'nyt' })).rejects.toThrow('Ukendt felt')
  })
})

describe('/api/settings', () => {
  it('henter og gemmer som før', async () => {
    const got = await call(settings, { url: '/api/settings', cookie })
    expect(got.body).toMatchObject({ id: 1, sender_name: 'Restaurant', next_order_no: 1, archive_last_sync_at: null })

    const saved = await call(settings, {
      method: 'PUT',
      url: '/api/settings',
      cookie,
      body: { sms_template: 'Klar kl. {tid}', sender_name: ' Pizzaria ', next_order_no: 4478 },
    })
    expect(saved.body).toMatchObject({ sms_template: 'Klar kl. {tid}', sender_name: 'Pizzaria', next_order_no: 4478 })
    expect(saved.body.updated_at).not.toBe(got.body.updated_at)
  })

  it('afviser tom tekst, for langt afsendernavn og forkert ordrenummer', async () => {
    const put = (body) => call(settings, { method: 'PUT', url: '/api/settings', cookie, body })
    expect((await put({ sms_template: '  ' })).statusCode).toBe(400)
    expect((await put({ sender_name: 'Alt for langt navn' })).statusCode).toBe(400)
    expect((await put({ next_order_no: 0 })).statusCode).toBe(400)
    expect((await put({ next_order_no: 2.5 })).statusCode).toBe(400)
  })
})
