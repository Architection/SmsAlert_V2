import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import sendSmsHandler from '../api/send-sms.js'
import { renderTemplate, sendSms, toMsisdn } from '../api/_lib/sms.js'
import { createOrder } from '../api/_lib/store.js'
import { addSupabaseUser, call, freshDb, loginCookie } from './helpers.js'

let db

beforeEach(async () => {
  db = await freshDb()
})
afterEach(() => db.cleanup())

describe('ingen SMS fra test eller lokal kørsel', () => {
  it('et kald til GatewayAPI, som testen ikke selv har erstattet, fejler', async () => {
    process.env.GATEWAYAPI_TOKEN = 'falsk'
    await expect(sendSms({ to: '40184636', message: 'hej' })).rejects.toThrow('rigtig SMS')
    delete process.env.GATEWAYAPI_TOKEN
  })

  it('tør kørsel sender intet lokalt', async () => {
    process.env.SMS_DRY_RUN = '1'
    const r = await sendSms({ to: '40184636', message: 'hej' })
    expect(r).toEqual({ msisdn: 4540184636, providerIds: [], dryRun: true })
  })

  it('tør kørsel virker aldrig på Vercel', async () => {
    process.env.SMS_DRY_RUN = '1'
    process.env.VERCEL = '1'
    process.env.GATEWAYAPI_TOKEN = 'falsk'
    const fake = vi.fn(async () => new Response(JSON.stringify({ ids: [42] }), { status: 200 }))
    vi.stubGlobal('fetch', fake)
    const r = await sendSms({ to: '40184636', message: 'hej', sender: 'Pizzaria' })
    expect(r).toEqual({ msisdn: 4540184636, providerIds: [42] })
    expect(fake).toHaveBeenCalledOnce()
    const [url, init] = fake.mock.calls[0]
    expect(url).toBe('https://gatewayapi.com/rest/mtsms')
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from('falsk:').toString('base64'))
    expect(JSON.parse(init.body)).toEqual({
      sender: 'Pizzaria',
      message: 'hej',
      recipients: [{ msisdn: 4540184636 }],
    })
    delete process.env.GATEWAYAPI_TOKEN
  })
})

describe('/api/send-sms', () => {
  it('sender (tørt), og ordren bliver markeret som sendt med teksten', async () => {
    process.env.SMS_DRY_RUN = '1'
    await addSupabaseUser(db.client, 'butik@eksempel.dk', 'hemmelig1')
    const cookie = await loginCookie('butik@eksempel.dk', 'hemmelig1')
    await db.client.execute(
      `update settings set sms_template = 'Ordre {ordreno} klar kl. {tid} om {minutter} min. {navn}', sender_name = 'Pizzaria', next_order_no = 4478`,
    )
    const o = await createOrder({ phone: '40184636', name: null, leadMinutes: 3, readyAt: '2026-11-25T17:30:00.000Z' })

    const res = await call(sendSmsHandler, { method: 'POST', url: '/api/send-sms', cookie, body: { orderId: o.id } })
    expect(res.statusCode).toBe(200)
    expect(res.body.message).toBe('Ordre 4478 klar kl. 18.30 om 3 min.')
    expect(res.body.order).toMatchObject({ id: o.id, status: 'sent', sms_body: 'Ordre 4478 klar kl. 18.30 om 3 min.' })
    expect(res.body.order.sms_sent_at).toMatch(/Z$/)
    expect(res.body.dryRun).toBe(true)
  })

  it('kræver login og en ordre, der findes', async () => {
    expect((await call(sendSmsHandler, { method: 'POST', url: '/api/send-sms', body: { orderId: 'x' } })).statusCode).toBe(401)
    await addSupabaseUser(db.client, 'butik@eksempel.dk', 'hemmelig1')
    const cookie = await loginCookie('butik@eksempel.dk', 'hemmelig1')
    const res = await call(sendSmsHandler, { method: 'POST', url: '/api/send-sms', cookie, body: { orderId: 'findes-ikke' } })
    expect(res.statusCode).toBe(404)
  })
})

describe('numre og skabelon (uændret)', () => {
  it('toMsisdn', () => {
    expect(toMsisdn('40 18 46 36')).toBe(4540184636)
    expect(toMsisdn('+46 70 123 45 67')).toBe(46701234567)
    expect(toMsisdn('0046701234567')).toBe(46701234567)
    expect(() => toMsisdn('123')).toThrow()
  })

  it('renderTemplate', () => {
    expect(
      renderTemplate('Hej {navn} – kl. {tid} ({minutter} min.) nr. {ordreno}', {
        leadMinutes: 10,
        readyAt: '2026-07-03T16:30:00.000Z',
        name: '',
        orderNo: 12,
      }),
    ).toBe('Hej – kl. 18.30 (10 min.) nr. 12')
  })
})
