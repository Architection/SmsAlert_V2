import { readJson, sendJson, withErrors, httpError } from './_lib/http.js'
import {
  signInWithPassword,
  createUser,
  hasAnyUser,
  getAuthedUser,
  clearSessionCookies,
} from './_lib/auth.js'

function publicUser(user) {
  return user ? { id: user.id, email: user.email } : null
}

function readCredentials(body) {
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!email || !email.includes('@')) throw httpError(400, 'Ugyldig e-mail')
  if (password.length < 6) throw httpError(400, 'Adgangskoden skal være mindst 6 tegn')
  return { email, password }
}

async function login(req, res) {
  const { email, password } = readCredentials(await readJson(req))
  const user = await signInWithPassword(res, email, password)
  return sendJson(res, 200, { user: publicUser(user) })
}

async function signup(req, res) {
  const { email, password } = readCredentials(await readJson(req))

  // Åben oprettelse kun når der endnu ikke findes nogen bruger (bootstrap af første konto).
  // Derefter kræves en aktiv login – en bruger opretter en kollega.
  const requester = await getAuthedUser(req, res)
  if (!requester && (await hasAnyUser())) {
    throw httpError(403, 'Log ind for at oprette nye brugere')
  }

  const user = await createUser(email, password)
  return sendJson(res, 201, { user: publicUser(user) })
}

async function me(req, res) {
  const user = await getAuthedUser(req, res)
  return sendJson(res, 200, { user: publicUser(user) })
}

async function logout(req, res) {
  clearSessionCookies(res)
  return sendJson(res, 200, { ok: true })
}

function requirePost(req) {
  if (req.method !== 'POST') throw httpError(405, `Metode ${req.method} ikke tilladt`)
}

export default withErrors(async (req, res) => {
  const action = new URL(req.url, 'http://x').searchParams.get('action')
  switch (action) {
    case 'login':
      requirePost(req)
      return login(req, res)
    case 'signup':
      requirePost(req)
      return signup(req, res)
    case 'logout':
      requirePost(req)
      return logout(req, res)
    case 'me':
      return me(req, res)
    default:
      throw httpError(404, 'Ukendt handling')
  }
})
