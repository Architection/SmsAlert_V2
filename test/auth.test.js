import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import auth from '../api/auth.js'
import orders from '../api/orders.js'
import { authEngine } from '../api/_lib/auth-engine.js'
import { addSupabaseUser, call, cookieFrom, freshDb } from './helpers.js'

let db

beforeEach(async () => {
  db = await freshDb()
})
afterEach(() => db.cleanup())

const login = (email, password) =>
  call(auth, { method: 'POST', url: '/api/auth?action=login', body: { email, password } })

describe('login med en bruger fra Supabase', () => {
  it('logger ind med den gamle bcrypt-adgangskode og skriver den om', async () => {
    const id = await addSupabaseUser(db.client, 'butik@eksempel.dk', 'hemmelig1')

    const res = await login('Butik@Eksempel.dk ', 'hemmelig1')
    expect(res.statusCode).toBe(200)
    expect(res.body.user).toEqual({ id, email: 'butik@eksempel.dk' })
    expect(res.cookies().some((c) => c.startsWith('smsalert.session_token='))).toBe(true)

    const account = await db.client.execute(`select password from "account" where "userId" = ?`, [id])
    expect(String(account.rows[0].password)).not.toMatch(/^\$2[aby]\$/)

    // Den nye hash virker også.
    const again = await login('butik@eksempel.dk', 'hemmelig1')
    expect(again.statusCode).toBe(200)
  })

  it('afviser en forkert adgangskode og en ukendt bruger med 401', async () => {
    await addSupabaseUser(db.client, 'butik@eksempel.dk', 'hemmelig1')
    expect((await login('butik@eksempel.dk', 'forkert12')).statusCode).toBe(401)
    expect((await login('ukendt@eksempel.dk', 'hemmelig1')).statusCode).toBe(401)
    expect((await login('butik@eksempel.dk', 'forkert12')).body.error).toBe(
      'Forkert e-mail eller adgangskode',
    )
  })

  it('kræver mindst 6 tegn og en e-mail, som før', async () => {
    expect((await login('butik@eksempel.dk', '12345')).statusCode).toBe(400)
    expect((await login('ikke-en-mail', 'hemmelig1')).statusCode).toBe(400)
  })

  it('stopper efter 10 forsøg på samme e-mail inden for 15 minutter', async () => {
    await addSupabaseUser(db.client, 'butik@eksempel.dk', 'hemmelig1')
    for (let i = 0; i < 10; i++) {
      expect((await login('butik@eksempel.dk', 'forkert12')).statusCode).toBe(401)
    }
    const blocked = await login('butik@eksempel.dk', 'hemmelig1')
    expect(blocked.statusCode).toBe(429)
  })
})

describe('sessionen', () => {
  it('me, beskyttede kald og log ud', async () => {
    const id = await addSupabaseUser(db.client, 'butik@eksempel.dk', 'hemmelig1')
    const cookie = cookieFrom(await login('butik@eksempel.dk', 'hemmelig1'))

    const me = await call(auth, { url: '/api/auth?action=me', cookie })
    expect(me.body.user).toEqual({ id, email: 'butik@eksempel.dk' })

    expect((await call(orders, { url: '/api/orders', cookie })).statusCode).toBe(200)
    expect((await call(orders, { url: '/api/orders' })).statusCode).toBe(401)

    const out = await call(auth, { method: 'POST', url: '/api/auth?action=logout', cookie })
    expect(out.statusCode).toBe(200)
    const sessions = await db.client.execute('select count(*) as n from "session"')
    expect(Number(sessions.rows[0].n)).toBe(0)
  })

  it('me uden session svarer null, og gamle Supabase-cookies ryddes', async () => {
    const res = await call(auth, { url: '/api/auth?action=me', cookie: 'sb-access=x; sb-refresh=y' })
    expect(res.statusCode).toBe(200)
    expect(res.body.user).toBeNull()
    expect(res.cookies()).toEqual(expect.arrayContaining(['sb-access=', 'sb-refresh=']))
  })

  it('en falsk session-cookie giver ingen adgang', async () => {
    const res = await call(orders, { url: '/api/orders', cookie: 'smsalert.session_token=falsk' })
    expect(res.statusCode).toBe(401)
  })

  it('logger ud uden session uden fejl', async () => {
    const res = await call(auth, { method: 'POST', url: '/api/auth?action=logout' })
    expect(res.statusCode).toBe(200)
  })
})

describe('ingen kan oprette sig selv', () => {
  it('Better Auths tilmelding er slået fra', async () => {
    const engine = await authEngine()
    await expect(
      engine.api.signUpEmail({
        body: { name: 'x', email: 'ny@eksempel.dk', password: 'hemmelig1' },
      }),
    ).rejects.toThrow()
    const users = await db.client.execute('select count(*) as n from "user"')
    expect(Number(users.rows[0].n)).toBe(0)
  })

  it('der findes ingen tilmeldings-handling i /api/auth', async () => {
    const res = await call(auth, {
      method: 'POST',
      url: '/api/auth?action=signup',
      body: { email: 'ny@eksempel.dk', password: 'hemmelig1' },
    })
    expect(res.statusCode).toBe(404)
  })
})
