import { getSupabase } from './_lib/supabase.js'
import { readJson, sendJson, withErrors, httpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'

async function get(req, res) {
  const { data, error } = await getSupabase()
    .from('settings')
    .select('*')
    .eq('id', 1)
    .single()
  if (error) throw httpError(500, error.message)
  return sendJson(res, 200, data)
}

async function put(req, res) {
  const body = await readJson(req)
  const patch = { updated_at: new Date().toISOString() }
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

  const { data, error } = await getSupabase()
    .from('settings')
    .update(patch)
    .eq('id', 1)
    .select()
    .single()
  if (error) throw httpError(500, error.message)
  return sendJson(res, 200, data)
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
