import { getSupabase } from './_lib/supabase.js'
import { readJson, sendJson, withErrors, httpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { copenhagenDayStartISO } from './_lib/time.js'
import { toMsisdn } from './_lib/sms.js'

function query(req) {
  return new URL(req.url, 'http://x').searchParams
}

async function list(req, res) {
  const q = query(req)
  const id = q.get('id')
  const sb = getSupabase()

  if (id) {
    const { data, error } = await sb.from('orders').select('*').eq('id', id).single()
    if (error) throw httpError(404, 'Ordre blev ikke fundet')
    return sendJson(res, 200, data)
  }

  const view = q.get('view') || 'active'
  let builder = sb.from('orders').select('*')

  if (view === 'history') {
    // Dagens ordrer der ikke længere er aktive.
    builder = builder
      .gte('created_at', copenhagenDayStartISO())
      .neq('status', 'active')
      .order('created_at', { ascending: false })
  } else {
    // Aktive ordrer – dem der skal sendes snarest øverst.
    builder = builder.eq('status', 'active').order('ready_at', { ascending: true })
  }

  const { data, error } = await builder
  if (error) throw httpError(500, error.message)
  return sendJson(res, 200, data)
}

async function create(req, res) {
  const body = await readJson(req)
  const phone = (body.phone || '').trim()
  const readyAt = body.ready_at
  const leadMinutes = Number(body.lead_minutes)

  if (!phone) throw httpError(400, 'Mobilnummer er påkrævet')
  toMsisdn(phone) // valider tidligt
  if (!readyAt || isNaN(new Date(readyAt).getTime()))
    throw httpError(400, 'Ugyldigt færdig-tidspunkt')
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0)
    throw httpError(400, 'Ugyldigt antal minutter')

  const { data, error } = await getSupabase()
    .from('orders')
    .insert({
      phone,
      name: (body.name || '').trim() || null,
      lead_minutes: Math.round(leadMinutes),
      ready_at: new Date(readyAt).toISOString(),
    })
    .select()
    .single()

  if (error) throw httpError(500, error.message)
  return sendJson(res, 201, data)
}

async function update(req, res) {
  const id = query(req).get('id')
  if (!id) throw httpError(400, 'Mangler ordre-id')
  const body = await readJson(req)

  const patch = {}
  if (body.status !== undefined) {
    if (!['active', 'sent', 'done', 'cancelled'].includes(body.status))
      throw httpError(400, 'Ugyldig status')
    patch.status = body.status
  }
  if (body.name !== undefined) patch.name = (body.name || '').trim() || null
  if (body.phone !== undefined) {
    toMsisdn(body.phone)
    patch.phone = String(body.phone).trim()
  }
  if (body.lead_minutes !== undefined) patch.lead_minutes = Math.round(Number(body.lead_minutes))
  if (body.ready_at !== undefined) patch.ready_at = new Date(body.ready_at).toISOString()
  if (Object.keys(patch).length === 0) throw httpError(400, 'Ingen felter at opdatere')

  const { data, error } = await getSupabase()
    .from('orders')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw httpError(500, error.message)
  return sendJson(res, 200, data)
}

async function remove(req, res) {
  const id = query(req).get('id')
  if (!id) throw httpError(400, 'Mangler ordre-id')
  const { error } = await getSupabase().from('orders').delete().eq('id', id)
  if (error) throw httpError(500, error.message)
  return sendJson(res, 200, { ok: true })
}

export default withErrors(async (req, res) => {
  await requireUser(req, res)
  switch (req.method) {
    case 'GET':
      return list(req, res)
    case 'POST':
      return create(req, res)
    case 'PATCH':
      return update(req, res)
    case 'DELETE':
      return remove(req, res)
    default:
      throw httpError(405, `Metode ${req.method} ikke tilladt`)
  }
})
