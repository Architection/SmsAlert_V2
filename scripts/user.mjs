// Opretter en bruger eller giver en eksisterende bruger en ny adgangskode:
//
//   npm run user -- navn@eksempel.dk
//
// Adgangskoden læses fra tastaturet (eller stdin), så den aldrig står i kommandolinjen. Findes
// brugeren, får den den nye adgangskode, og alle dens enheder logges ud. Findes den ikke, oprettes
// den. Bruger TURSO_DATABASE_URL og TURSO_AUTH_TOKEN fra .env eller miljøet.
//
// Erstatter Supabases dashboard, hvor brugerne blev lavet før november 2026.
import { createInterface } from 'node:readline/promises'

import { createClient } from '@libsql/client'
import { hashPassword } from 'better-auth/crypto'

import { MIN_PASSWORD_LENGTH } from '../api/_lib/auth-engine.js'

const email = String(process.argv[2] || '').trim().toLowerCase()
if (!email.includes('@')) {
  console.error('Brug: npm run user -- navn@eksempel.dk')
  process.exit(1)
}
const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('TURSO_DATABASE_URL mangler. Sæt den i .env, eller foran kommandoen.')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
const password = (await rl.question('Ny adgangskode: ')).trim()
rl.close()
if (password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
  console.error(`Adgangskoden skal være ${MIN_PASSWORD_LENGTH}-128 tegn.`)
  process.exit(1)
}

const token = process.env.TURSO_AUTH_TOKEN
const db = createClient({ url, ...(token ? { authToken: token } : {}) })
try {
  const hash = await hashPassword(password)
  const now = new Date().toISOString()
  const found = await db.execute({ sql: 'select id from "user" where email = ?', args: [email] })
  if (found.rows.length) {
    const userId = String(found.rows[0].id)
    const [, changed] = await db.batch(
      [
        {
          sql: `insert into "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
                select ?, ?, 'credential', ?, ?, ?, ?
                where not exists (select 1 from "account" where "userId" = ? and "providerId" = 'credential')`,
          args: [crypto.randomUUID(), userId, userId, hash, now, now, userId],
        },
        {
          sql: `update "account" set password = ?, "updatedAt" = ? where "userId" = ? and "providerId" = 'credential'`,
          args: [hash, now, userId],
        },
        { sql: 'delete from "session" where "userId" = ?', args: [userId] },
      ],
      'write',
    )
    console.log(changed.rowsAffected ? `Ny adgangskode sat for ${email}. Alle enheder er logget ud.` : 'Intet ændret.')
  } else {
    const userId = crypto.randomUUID()
    await db.batch(
      [
        {
          sql: `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values (?, ?, ?, 1, ?, ?)`,
          args: [userId, email.split('@')[0], email, now, now],
        },
        {
          sql: `insert into "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
                values (?, ?, 'credential', ?, ?, ?, ?)`,
          args: [crypto.randomUUID(), userId, userId, hash, now, now],
        },
      ],
      'write',
    )
    console.log(`Bruger oprettet: ${email}`)
  }
} finally {
  db.close()
}
