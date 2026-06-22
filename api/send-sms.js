import { getSupabase } from './_lib/supabase.js'
import { readJson, sendJson, withErrors, httpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { renderTemplate, sendSms } from './_lib/sms.js'

// POST { orderId } – henter ordre + indstillinger, sender SMS via GatewayAPI,
// og markerer ordren som sendt. Skabelon/nummer læses server-side, ikke fra klienten.
export default withErrors(async (req, res) => {
  await requireUser(req, res)
  if (req.method !== 'POST') throw httpError(405, `Metode ${req.method} ikke tilladt`)

  const { orderId } = await readJson(req)
  if (!orderId) throw httpError(400, 'Mangler orderId')

  const sb = getSupabase()
  const { data: order, error: oErr } = await sb
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single()
  if (oErr || !order) throw httpError(404, 'Ordre blev ikke fundet')

  const { data: settings, error: sErr } = await sb
    .from('settings')
    .select('*')
    .eq('id', 1)
    .single()
  if (sErr) throw httpError(500, 'Kunne ikke hente indstillinger')

  const message = renderTemplate(settings.sms_template, {
    leadMinutes: order.lead_minutes,
    readyAt: order.ready_at,
    name: order.name,
  })

  const result = await sendSms({
    to: order.phone,
    message,
    sender: settings.sender_name,
  })

  const { data: updated, error: uErr } = await sb
    .from('orders')
    .update({ status: 'sent', sms_sent_at: new Date().toISOString(), sms_body: message })
    .eq('id', orderId)
    .select()
    .single()
  if (uErr) throw httpError(500, 'SMS sendt, men ordren kunne ikke opdateres: ' + uErr.message)

  return sendJson(res, 200, { order: updated, message, ...result })
})
