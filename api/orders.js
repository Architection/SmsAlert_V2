import { readJson, sendJson, withErrors, httpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { toMsisdn } from './_lib/sms.js'
import {
  ORDER_STATUSES,
  createOrder,
  getOrder,
  listOrders,
  softDeleteOrder,
  updateOrder,
} from './_lib/store.js'

function query(req) {
  return new URL(req.url, 'http://x').searchParams
}

function isoOrFail(value, message) {
  const t = new Date(value)
  if (!value || Number.isNaN(t.getTime())) throw httpError(400, message)
  return t.toISOString()
}

async function list(req, res) {
  const q = query(req)
  const id = q.get('id')

  if (id) {
    const order = await getOrder(id)
    if (!order) throw httpError(404, 'Ordre blev ikke fundet')
    return sendJson(res, 200, order)
  }

  // active (standard) | history (dagens afsluttede) | deleted (slettede)
  return sendJson(res, 200, await listOrders(q.get('view') || 'active'))
}

async function create(req, res) {
  const body = await readJson(req)
  const phone = (body.phone || '').trim()
  const leadMinutes = Number(body.lead_minutes)

  if (!phone) throw httpError(400, 'Mobilnummer er påkrævet')
  toMsisdn(phone) // valider tidligt
  const readyAt = isoOrFail(body.ready_at, 'Ugyldigt færdig-tidspunkt')
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0)
    throw httpError(400, 'Ugyldigt antal minutter')

  const order = await createOrder({
    phone,
    name: (body.name || '').trim() || null,
    leadMinutes: Math.round(leadMinutes),
    readyAt,
  })
  return sendJson(res, 201, order)
}

async function update(req, res) {
  const id = query(req).get('id')
  if (!id) throw httpError(400, 'Mangler ordre-id')
  const body = await readJson(req)

  const patch = {}
  if (body.restore === true) patch.deleted_at = null // gendan en slettet ordre
  if (body.status !== undefined) {
    if (!ORDER_STATUSES.includes(body.status)) throw httpError(400, 'Ugyldig status')
    patch.status = body.status
  }
  if (body.name !== undefined) patch.name = (body.name || '').trim() || null
  if (body.phone !== undefined) {
    toMsisdn(body.phone)
    patch.phone = String(body.phone).trim()
  }
  if (body.lead_minutes !== undefined) {
    const n = Math.round(Number(body.lead_minutes))
    if (!Number.isFinite(n)) throw httpError(400, 'Ugyldigt antal minutter')
    patch.lead_minutes = n
  }
  if (body.ready_at !== undefined)
    patch.ready_at = isoOrFail(body.ready_at, 'Ugyldigt færdig-tidspunkt')
  if (Object.keys(patch).length === 0) throw httpError(400, 'Ingen felter at opdatere')

  const order = await updateOrder(id, patch)
  if (!order) throw httpError(404, 'Ordre blev ikke fundet')
  return sendJson(res, 200, order)
}

async function remove(req, res) {
  const id = query(req).get('id')
  if (!id) throw httpError(400, 'Mangler ordre-id')
  // Blød sletning: behold rækken, men markér som slettet, så ordren stadig
  // kan findes under Historik → Slettet (og evt. gendannes).
  await softDeleteOrder(id)
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
