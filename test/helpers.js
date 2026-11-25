// En frisk SQLite-fil med migrationerne til hver test, og små hjælpere til at kalde api/-filerne
// som Vercel gør (req/res).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@libsql/client'

import { migrate } from '../db/migrate.js'
import { setDatabase } from '../api/_lib/db.js'
import { createAuthEngine, setAuthEngine } from '../api/_lib/auth-engine.js'

/** En ny database i en midlertidig fil (transaktioner kræver en fil, ikke :memory:). */
export async function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'smsalert-test-'))
  const url = 'file:' + join(dir, 'test.db').replaceAll('\\', '/')
  const client = createClient({ url })
  await migrate(client)
  setDatabase(client)
  setAuthEngine(
    createAuthEngine({ db: client, secret: 'test-secret-'.padEnd(40, 'x'), baseURL: 'http://localhost:5173', secureCookies: false }),
  )
  return {
    client,
    cleanup() {
      client.close()
      // Windows kan holde filen låst et øjeblik efter close; mappen ligger i tmp og ryddes senere.
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        /* ingen grund til at fejle en test på oprydning */
      }
    },
  }
}

/** Et svar-objekt som Nodes ServerResponse, nok til api/_lib/http.js. */
export function fakeRes() {
  const headers = {}
  return {
    statusCode: 200,
    body: undefined,
    writableEnded: false,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value
    },
    getHeader(name) {
      return headers[name.toLowerCase()]
    },
    end(text) {
      this.body = text === undefined ? undefined : JSON.parse(text)
      this.writableEnded = true
    },
    headers,
    /** Cookies sat i svaret som "navn=værdi" (uden attributterne). */
    cookies() {
      const list = headers['set-cookie']
      return (Array.isArray(list) ? list : list ? [list] : []).map((c) => c.split(';')[0])
    },
  }
}

/** Kalder en api/-fil med en forespørgsel, som Vercel ville. */
export async function call(handler, { method = 'GET', url = '/', body, cookie } = {}) {
  const req = {
    method,
    url,
    body,
    headers: {
      host: 'localhost:5173',
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const res = fakeRes()
  await handler(req, res)
  return res
}

/** Cookie-header ud fra et svars Set-Cookie (til næste kald). */
export const cookieFrom = (res) => res.cookies().filter((c) => !c.endsWith('=')).join('; ')

/**
 * En bruger, som kopien fra Supabase laver den: samme slags id og en bcrypt-hash med "$2a$"
 * (bcryptjs skriver "$2b$", som er samme algoritme).
 */
export async function addSupabaseUser(client, email, password) {
  const bcrypt = (await import('bcryptjs')).default
  const id = crypto.randomUUID()
  const hash = (await bcrypt.hash(password, 4)).replace(/^\$2b\$/, '$2a$')
  const t = '2026-06-22T18:16:23.665Z'
  await client.batch(
    [
      {
        sql: `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values (?, ?, ?, 1, ?, ?)`,
        args: [id, email.split('@')[0], email, t, t],
      },
      {
        sql: `insert into "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
              values (?, ?, 'credential', ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), id, id, hash, t, t],
      },
    ],
    'write',
  )
  return id
}

/** Logger ind gennem /api/auth og svarer med cookie-headeren til de næste kald. */
export async function loginCookie(email, password) {
  const auth = (await import('../api/auth.js')).default
  const res = await call(auth, {
    method: 'POST',
    url: '/api/auth?action=login',
    body: { email, password },
  })
  if (res.statusCode !== 200) throw new Error(`Login fejlede: ${res.statusCode} ${JSON.stringify(res.body)}`)
  return cookieFrom(res)
}
