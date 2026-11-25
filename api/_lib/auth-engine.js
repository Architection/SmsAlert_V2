// Better Auth med brugerne i appens egen database (db/migrations/0001_auth.sql). Kun log ind og
// log ud: ingen kan oprette sig selv, og der sendes ingen mails. Brugere og nye adgangskoder laves
// med `npm run user` (scripts/user.mjs). Hentet fra MadAssistent og Rutinee.
//
// Kun api/_lib/auth.js bruger den. Better Auths egne web-adresser er ikke sat op nogen steder, så
// ingen kan nå dem udefra.
import bcrypt from 'bcryptjs'
import { betterAuth } from 'better-auth'
import { hashPassword, verifyPassword } from 'better-auth/crypto'

import { database, readEnv } from './db.js'
import { LibsqlDialect } from './kysely-libsql.js'

/** Så længe en session holder uden at blive brugt. Den fornyes, når den bruges. */
export const SESSION_DAYS = 180

/** Som appen har krævet hidtil (api/auth.js). */
export const MIN_PASSWORD_LENGTH = 6

/**
 * Brugerne fra Supabase har en bcrypt-hash ("$2a$..."). Den holder, til brugeren logger ind næste
 * gang; så skriver auth.js den om til Better Auths egen slags.
 */
export const isBcrypt = (hash) => /^\$2[aby]\$/.test(hash)

export async function checkPassword({ hash, password }) {
  return isBcrypt(hash) ? bcrypt.compare(password, hash) : verifyPassword({ hash, password })
}

export { hashPassword }

/** Sitets egen adresse: domænet i produktion, udgaven på Vercel, ellers Vites lokale server. */
export function siteURL() {
  if (readEnv('VERCEL_ENV') === 'production') return 'https://www.smsalert.dk'
  const vercel = readEnv('VERCEL_URL')
  return vercel ? `https://${vercel}` : 'http://localhost:5173'
}

export function createAuthEngine({ db, secret, baseURL, secureCookies = true }) {
  return betterAuth({
    appName: 'SMS Alert',
    baseURL,
    secret,
    trustedOrigins: [baseURL, 'https://www.smsalert.dk', 'https://smsalert.dk'],
    database: { dialect: new LibsqlDialect(db), type: 'sqlite' },
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      // Ingen kan oprette sig selv (som i dag, hvor tilmeldingen er fjernet).
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: checkPassword },
    },
    session: {
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      // Sessionen huskes i en signeret cookie i 5 minutter, så skærmen, der spørger hvert
      // 8. sekund, ikke slår sessionen op i databasen hver gang.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      cookiePrefix: 'smsalert',
      useSecureCookies: secureCookies,
      // UUID'er, som brugerne fra Supabase har.
      database: { generateId: () => crypto.randomUUID() },
    },
  })
}

let engine

/** Better Auth, eller null uden database eller BETTER_AUTH_SECRET: så kan ingen logge ind. */
export async function authEngine() {
  if (engine === undefined) {
    engine = (async () => {
      const db = await database()
      const secret = readEnv('BETTER_AUTH_SECRET')
      if (!db || !secret) return null
      return createAuthEngine({
        db,
        secret,
        baseURL: siteURL(),
        // Almindelig http på localhost under udvikling; https alle andre steder.
        secureCookies: process.env.VERCEL === '1',
      })
    })()
  }
  return engine
}

/** Kun til tests: en anden motor end miljøets. */
export function setAuthEngine(next) {
  engine = Promise.resolve(next)
}
