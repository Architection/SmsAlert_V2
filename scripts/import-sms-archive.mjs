// Engangs-import af det gamle systems eksport ind i public.sms_archive.
// Eksporten har formen { "Orders": [ { phone: 40184636, CreatedDate: "2020-10-04T19:23:16.117" }, ... ] }.
// phone er et 8-cifret dansk tal, CreatedDate er lokal (Europe/Copenhagen) vægur-tid uden tidszone.
//
// Kør med:  node scripts/import-sms-archive.mjs            (læser C:\Web\sms.json)
//      ell.  node scripts/import-sms-archive.mjs <sti.json>
//
// Kræver SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY i .env (samme som /api).
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { toMsisdn } from '../api/_lib/sms.js'

const FILE = process.argv[2] || 'C:\\Web\\sms.json'
const CHUNK = 1000

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Mangler SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i .env')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

// Lokal Copenhagen-vægur-tid → UTC ISO. Finder offset (sommer/vinter) robust for hver dato.
function cphLocalToISO(s) {
  if (!s) return null
  const guess = new Date(s + 'Z') // tolk som UTC først
  if (isNaN(guess.getTime())) return null
  const local = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }))
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offsetMs = local.getTime() - utc.getTime() // Copenhagen − UTC ved dette tidspunkt
  return new Date(guess.getTime() - offsetMs).toISOString()
}

console.log('Læser', FILE, '…')
// Eksporten er wrappet ved fast bredde med CRLF – nogle gange midt i et tal
// (fx "phone":4267690<CRLF>4,...). Fjern alle linjeskift så tokens samles igen.
// JSON har ingen legitime rå linjeskift inde i værdier, så det er sikkert.
const raw = readFileSync(FILE, 'utf8')
  .replace(/^﻿/, '') // strip BOM
  .replace(/[\r\n]+/g, '')
const parsed = JSON.parse(raw)
const src = parsed.Orders || parsed.orders || []
console.log(`Fandt ${src.length} rækker i eksporten.`)

// Normalisér + dedupér i hukommelsen (samme nummer+tidspunkt = samme bestilling).
const seen = new Set()
const rows = []
let badPhone = 0
let badDate = 0
let dupes = 0
for (const o of src) {
  let phone
  try {
    phone = String(toMsisdn(o.phone))
  } catch {
    badPhone++
    continue
  }
  const ordered_at = cphLocalToISO(o.CreatedDate || o.createdDate)
  if (!ordered_at) {
    badDate++
    continue
  }
  const k = phone + '|' + ordered_at
  if (seen.has(k)) {
    dupes++
    continue
  }
  seen.add(k)
  rows.push({ phone, ordered_at, source: 'import' })
}

console.log(
  `Klar til indsættelse: ${rows.length} unikke ` +
    `(sprunget over: ${badPhone} ugyldigt nr., ${badDate} ugyldig dato, ${dupes} dubletter i fil).`,
)

let inserted = 0
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK)
  const { error, count } = await sb
    .from('sms_archive')
    .upsert(chunk, { onConflict: 'phone,ordered_at', ignoreDuplicates: true, count: 'exact' })
  if (error) {
    console.error('Fejl ved indsættelse omkring række', i, '-', error.message)
    process.exit(1)
  }
  inserted += count ?? 0
  process.stdout.write(`\r  Indsat ${Math.min(i + CHUNK, rows.length)}/${rows.length} …`)
}
process.stdout.write('\n')

console.log(`Færdig. ${inserted} nye rækker i sms_archive (resten fandtes allerede).`)
