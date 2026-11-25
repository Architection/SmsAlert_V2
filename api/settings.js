import { readJson, sendJson, withErrors, httpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { getSettings, updateSettings } from './_lib/store.js'
import { now } from './_lib/db.js'

async function get(req, res) {
  const settings = await getSettings()
  if (!settings) throw httpError(500, 'Kunne ikke hente indstillinger')
  return sendJson(res, 200, settings)
}

async function put(req, res) {
  const body = await readJson(req)
  const patch = { updated_at: now() }
  if (body.sms_template !== undefined) {
    if (!String(body.sms_template).trim()) throw httpError(400, 'SMS-teksten må ikke være tom')
    patch.sms_template = String(body.sms_template)
  }
  if (body.sender_name !== undefined) {
    const s = String(body.sender_name).trim()
    if (!s) throw httpError(400, 'Afsendernavn må ikke være tomt')
    if (s.length > 11) throw httpError(400, 'Afsendernavn må højst være 11 tegn')
    patch.sender_name = s
  }
  if (body.next_order_no !== undefined) {
    const n = Number(body.next_order_no)
    if (!Number.isInteger(n) || n < 1) throw httpError(400, 'Næste ordrenummer skal være et helt tal på mindst 1')
    patch.next_order_no = n
  }

  const settings = await updateSettings(patch)
  if (!settings) throw httpError(500, 'Kunne ikke gemme indstillinger')
  return sendJson(res, 200, settings)
}

export default withErrors(async (req, res) => {
  await requireUser(req, res)
  switch (req.method) {
    case 'GET':
      return get(req, res)
    case 'PUT':
    case 'PATCH':
      return put(req, res)
    default:
      throw httpError(405, `Metode ${req.method} ikke tilladt`)
  }
})
