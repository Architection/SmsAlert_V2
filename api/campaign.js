import { getSupabase } from './_lib/supabase.js'
import { sendJson, withErrors, httpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { toMsisdn } from './_lib/sms.js'

function query(req) {
  return new URL(req.url, 'http://x').searchParams
}

// Nøgletal + top-numre + hvornår der sidst blev hentet.
async function summary(req, res) {
  const sb = getSupabase()
  const { data, error } = await sb.rpc('campaign_summary')
  if (error) throw httpError(500, error.message)
  const { data: s } = await sb.from('settings').select('archive_last_sync_at').eq('id', 1).single()
  return sendJson(res, 200, { ...data, last_sync_at: s?.archive_last_sync_at ?? null })
}

// Unikke numre, aggregeret, med valgfri filtre. Bruges til både visning og CSV-eksport.
async function numbers(req, res) {
  const q = query(req)
  const from = q.get('from') || null
  const to = q.get('to') || null
  const minOrders = q.get('minOrders') ? parseInt(q.get('minOrders'), 10) : 1
  const search = (q.get('q') || '').replace(/\D/g, '') || null // kun cifre i søgning
  const limit = q.get('limit') ? Math.min(parseInt(q.get('limit'), 10) || 1000, 200000) : 1000

  const { data, error } = await getSupabase().rpc('campaign_numbers', {
    p_from: from,
    p_to: to,
    p_min_orders: Number.isFinite(minOrders) ? minOrders : 1,
    p_q: search,
    p_limit: limit,
  })
  if (error) throw httpError(500, error.message)
  return sendJson(res, 200, data)
}

// Træk numre fra live-ordrer ind i arkivet (idempotent via unik (phone, ordered_at)).
async function sync(req, res) {
  const sb = getSupabase()

  // Vandmærke: seneste bestillingstidspunkt vi allerede har hentet fra ordrer.
  const { data: wm } = await sb
    .from('sms_archive')
    .select('ordered_at')
    .eq('source', 'orders')
    .order('ordered_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const watermark = wm?.ordered_at || null

  let qb = sb.from('orders').select('phone,created_at').order('created_at', { ascending: true })
  if (watermark) qb = qb.gt('created_at', watermark)
  const { data: ords, error } = await qb
  if (error) throw httpError(500, error.message)

  const rows = []
  let skipped = 0
  for (const o of ords || []) {
    let phone
    try {
      phone = String(toMsisdn(o.phone))
    } catch {
      skipped++
      continue
    }
    rows.push({ phone, ordered_at: o.created_at, source: 'orders' })
  }

  let inserted = 0
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000)
    const { error: e2, count } = await sb
      .from('sms_archive')
      .upsert(chunk, { onConflict: 'phone,ordered_at', ignoreDuplicates: true, count: 'exact' })
    if (e2) throw httpError(500, e2.message)
    inserted += count ?? 0
  }

  const lastSyncAt = new Date().toISOString()
  await sb.from('settings').update({ archive_last_sync_at: lastSyncAt }).eq('id', 1)

  return sendJson(res, 200, {
    inserted,
    scanned: rows.length,
    skipped,
    last_sync_at: lastSyncAt,
  })
}

export default withErrors(async (req, res) => {
  await requireUser(req, res)
  switch (req.method) {
    case 'GET':
      return query(req).get('action') === 'numbers' ? numbers(req, res) : summary(req, res)
    case 'POST':
      return sync(req, res)
    default:
      throw httpError(405, `Metode ${req.method} ikke tilladt`)
  }
})
