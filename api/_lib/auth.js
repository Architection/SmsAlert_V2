import { createClient } from '@supabase/supabase-js'
import { httpError } from './http.js'

// Login-håndtering server-side: Supabase Auth tilgås kun her, og sessionen
// gemmes i HttpOnly-cookies. Hverken nøgler eller tokens når browserens JS.

const ACCESS_COOKIE = 'sb-access'
const REFRESH_COOKIE = 'sb-refresh'
const ACCESS_MAX_AGE = 60 * 60 // 1 time (Supabase access-token levetid)
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30 // 30 dage
const SECURE = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

// Frisk klient pr. kald, så sessioner aldrig deles på tværs af samtidige requests.
function authClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw httpError(
      500,
      'Supabase er ikke konfigureret. Sæt SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY i .env',
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

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

function buildCookie(name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (SECURE) parts.push('Secure')
  return parts.join('; ')
}

function setSessionCookies(res, session) {
  appendCookie(res, buildCookie(ACCESS_COOKIE, session.access_token, ACCESS_MAX_AGE))
  appendCookie(res, buildCookie(REFRESH_COOKIE, session.refresh_token, REFRESH_MAX_AGE))
}

export function clearSessionCookies(res) {
  appendCookie(res, buildCookie(ACCESS_COOKIE, '', 0))
  appendCookie(res, buildCookie(REFRESH_COOKIE, '', 0))
}

// Log ind og gem sessionen i cookies. Returnerer brugeren.
export async function signInWithPassword(res, email, password) {
  const { data, error } = await authClient().auth.signInWithPassword({ email, password })
  if (error || !data?.session) throw httpError(401, 'Forkert e-mail eller adgangskode')
  setSessionCookies(res, data.session)
  return data.user
}

// Opret en straks-bekræftet bruger via service-role admin-API'et (ingen e-mailbekræftelse nødvendig).
export async function createUser(email, password) {
  const { data, error } = await authClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) {
    const dup = /already|exist|registered/i.test(error.message)
    throw httpError(dup ? 409 : 400, dup ? 'Der findes allerede en bruger med denne e-mail' : error.message)
  }
  return data.user
}

export async function hasAnyUser() {
  const { data, error } = await authClient().auth.admin.listUsers({ page: 1, perPage: 1 })
  if (error) throw httpError(500, error.message)
  return data.users.length > 0
}

// Slår den aktuelle bruger op ud fra cookies. Forsøger refresh hvis access-token er udløbet.
// Returnerer null hvis ikke logget ind (kaster ikke).
export async function getAuthedUser(req, res) {
  const cookies = parseCookies(req)
  const client = authClient()

  const accessToken = cookies[ACCESS_COOKIE]
  if (accessToken) {
    const { data, error } = await client.auth.getUser(accessToken)
    if (!error && data?.user) return data.user
  }

  const refreshToken = cookies[REFRESH_COOKIE]
  if (refreshToken) {
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken })
    if (!error && data?.session && data?.user) {
      setSessionCookies(res, data.session)
      return data.user
    }
    clearSessionCookies(res) // ugyldigt refresh-token – ryd op
  }

  return null
}

// Guard til beskyttede endpoints.
export async function requireUser(req, res) {
  const user = await getAuthedUser(req, res)
  if (!user) throw httpError(401, 'Ikke logget ind')
  return user
}
