// Bringer en database op til dato med SQL-filerne i db/migrations: hver fil kører én gang, i
// navnets rækkefølge, og databasen husker i _migrations, hvilke der er kørt. Bruges af
// `npm run db:migrate` (scripts/db-migrate.mjs) og af testene. Hentet fra MadAssistent og Rutinee.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/** Alle filer i db/migrations som { name, sql }. */
export function loadMigrations(dir = DIR) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}

const quote = (text) => `'${text.replaceAll("'", "''")}'`

/** Navnene på de filer, den kørte, i rækkefølge. */
export async function migrate(client, migrations = loadMigrations()) {
  await client.execute(
    'create table if not exists _migrations (name text primary key, applied_at text not null)',
  )
  const done = new Set(
    (await client.execute('select name from _migrations')).rows.map((row) => String(row.name)),
  )
  const applied = []
  const pending = migrations
    .filter((m) => !done.has(m.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const { name, sql } of pending) {
    // Én transaktion pr. fil, så en fil, der fejler, ikke efterlader noget.
    await client.executeMultiple(
      [
        'begin;',
        sql,
        `;insert into _migrations (name, applied_at) values (${quote(name)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`,
        'commit;',
      ].join('\n'),
    )
    applied.push(name)
  }
  return applied
}
