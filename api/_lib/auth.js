// Login-håndtering på serveren: Better Auth (api/_lib/auth-engine.js) med brugerne i Turso.
// Sessionen ligger i HttpOnly-cookies, som Better Auth sætter og læser, så browserens JavaScript
// aldrig ser den. Browseren kalder kun /api/auth?action=login|logout|me (api/auth.js).
//
// Der er ingen RLS bag det her: hver fil i api/ skal selv kalde requireUser, før den rører data
// (tjekkes af test/guards.test.js).
import { fromNodeHeaders } from 'better-auth/node'

import { authEngine, hashPassword, isBcrypt } from './auth-engine.js'
import { getDb, now } from './db.js'
import { httpError } from './http.js'

const WRONG = 'Forkert e-mail eller adgangskode'
const TOO_MANY = 'For mange forsøg lige nu. Prøv igen om et par minutter.'

// Cookies fra Supabase-udgaven (før november 2026). De ryddes væk, når de ses.
const OLD_COOKIES = ['sb-access', 'sb-refresh']
const SECURE = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

export function parseCookies(req) {
  const out = {}
  const header = req.headers?.cookie
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name) out[name] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

function appendCookie(res, value) {
  const prev = res.getHeader('Set-Cookie')
  const list = prev == null ? [] : Array.isArray(prev) ? [...prev] : [prev]
  list.push(value)
  res.setHeader('Set-Cookie', list)
}

/** Sender Better Auths cookies videre til svaret. */
function forwardCookies(headers, res) {
  for (const cookie of headers?.getSetCookie?.() ?? []) appendCookie(res, cookie)
}

function clearOldCookies(req, res) {
  const cookies = parseCookies(req)
  for (const name of OLD_COOKIES) {
    if (cookies[name] === undefined) continue
    appendCookie(
      res,
      `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE ? '; Secure' : ''}`,
    )
  }
}

async function engineOrFail() {
  const engine = await authEngine()
  if (!engine) {
    throw httpError(500, 'Login er ikke sat op. Sæt TURSO_DATABASE_URL og BETTER_AUTH_SECRET i .env')
  }
  return engine
}

/* ------------------------------------------------------------------ */
/* Grænser for forsøg                                                  */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  signInPerEmail: { max: 10, minutes: 15 },
  signInPerIp: { max: 30, minutes: 15 },
}

// Det længste vindue ovenfor og lidt til. Derefter tæller et forsøg ingen steder.
const KEEP_MINUTES = 30

/**
 * Tæller ét forsøg for hver nøgle, medmindre en af dem allerede er ved sin grænse. True, når
 * forsøget må gå videre. Én sætning tjekker alle grænser og skriver alle nøgler i en skrivende
 * transaktion, så forsøg på samme tid ikke kan smutte forbi en grænse. Hentet fra MadAssistent.
 */
export async function allowAttempt(db, attempts) {
  if (attempts.length === 0) return true
  const since = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()
  const underLimits = attempts
    .map(() => '(select count(*) from login_attempts where key = ? and created_at >= ?) < ?')
    .join(' and ')
  const args = [
    JSON.stringify(attempts.map((a) => a.key)),
    ...attempts.flatMap(({ key, limit }) => [key, since(limit.minutes), limit.max]),
  ]
  const [, inserted] = await db.batch(
    [
      { sql: 'delete from login_attempts where created_at < ?', args: [since(KEEP_MINUTES)] },
      {
        sql: `insert into login_attempts (key) select value from json_each(?) where ${underLimits}`,
        args,
      },
    ],
    'write',
  )
  return (inserted?.rowsAffected ?? 0) > 0
}

/** Den besøgendes IP-adresse. Vercel sætter selv x-real-ip og overskriver det, klienten sender. */
function clientIp(req) {
  const real = req.headers?.['x-real-ip']
  return (Array.isArray(real) ? real[0] : real) || req.socket?.remoteAddress || 'unknown'
}

/* ------------------------------------------------------------------ */
/* Log ind, log ud, hvem er logget ind                                 */
/* ------------------------------------------------------------------ */

/**
 * Efter et login skrives en gammel bcrypt-adgangskode om til Better Auths egen slags, nu hvor den er
 * tjekket og kendt. Går det galt, er brugeren logget ind alligevel.
 */
async function upgradePassword(db, userId, password) {
  try {
    const account = await db.execute({
      sql: `select id, password from "account" where "userId" = ? and "providerId" = 'credential'`,
      args: [userId],
    })
    const hash = account.rows[0]?.password
    if (typeof hash !== 'string' || !isBcrypt(hash)) return
    await db.execute({
      sql: `update "account" set password = ?, "updatedAt" = ? where id = ?`,
      args: [await hashPassword(password), now(), String(account.rows[0].id)],
    })
  } catch (error) {
    console.error('[auth] Adgangskoden kunne ikke skrives om', error)
  }
}

const statusOf = (error) => (typeof error?.statusCode === 'number' ? error.statusCode : undefined)

/** Log ind og sæt session-cookien. Returnerer brugeren, eller kaster 401/429. */
export async function signInWithPassword(req, res, email, password) {
  const engine = await engineOrFail()
  const db = await getDb()
  const address = String(email).trim().toLowerCase()
  const allowed = await allowAttempt(db, [
    { key: `password:${address}`, limit: LIMITS.signInPerEmail },
    { key: `password-ip:${clientIp(req)}`, limit: LIMITS.signInPerIp },
  ])
  if (!allowed) throw httpError(429, TOO_MANY)
  let result
  try {
    result = await engine.api.signInEmail({
      body: { email: address, password },
      headers: fromNodeHeaders(req.headers),
      returnHeaders: true,
    })
  } catch (error) {
    const status = statusOf(error)
    if (status !== undefined && status < 500) throw httpError(401, WRONG)
    throw error
  }
  forwardCookies(result.headers, res)
  clearOldCookies(req, res)
  const user = result.response.user
  await upgradePassword(db, user.id, password)
  return { id: user.id, email: user.email }
}

/** Den bruger, der er logget ind, eller null (kaster ikke for en udlogget besøgende). */
export async function getAuthedUser(req, res) {
  const engine = await engineOrFail()
  clearOldCookies(req, res)
  const result = await engine.api.getSession({
    headers: fromNodeHeaders(req.headers),
    returnHeaders: true,
  })
  forwardCookies(result.headers, res)
  const user = result.response?.user
  return user ? { id: user.id, email: user.email } : null
}

/** Sletter sessionen og cookien. Kan ikke mislykkes for brugeren: cookien er væk bagefter. */
export async function signOut(req, res) {
  clearOldCookies(req, res)
  const engine = await authEngine()
  if (!engine) return
  try {
    const result = await engine.api.signOut({
      headers: fromNodeHeaders(req.headers),
      returnHeaders: true,
    })
    forwardCookies(result.headers, res)
  } catch (error) {
    // Uden en session er der intet at slette; Better Auth svarer med en fejl.
    if ((statusOf(error) ?? 500) >= 500) console.error('[auth] Log ud gik galt', error)
  }
}

/** Vagten til beskyttede endpoints. */
export async function requireUser(req, res) {
  const user = await getAuthedUser(req, res)
  if (!user) throw httpError(401, 'Ikke logget ind')
  return user
}
