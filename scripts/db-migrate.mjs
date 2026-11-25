// Bringer databasen op til dato med db/migrations: `npm run db:migrate`.
// Bruger TURSO_DATABASE_URL og TURSO_AUTH_TOKEN fra .env eller miljøet. En lokal fil skrives som
// file:C:/sti/til/fil.db.
import { createClient } from '@libsql/client'

import { migrate } from '../db/migrate.js'

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('TURSO_DATABASE_URL mangler. Sæt den i .env, eller foran kommandoen.')
  process.exit(1)
}

const token = process.env.TURSO_AUTH_TOKEN
const client = createClient({ url, ...(token ? { authToken: token } : {}) })
try {
  const applied = await migrate(client)
  console.log(applied.length ? `Kørt: ${applied.join(', ')}` : 'Databasen er opdateret.')
} finally {
  client.close()
}
