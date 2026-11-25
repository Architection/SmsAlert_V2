import { readJson, sendJson, withErrors, httpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { renderTemplate, sendSms } from './_lib/sms.js'
import { getOrder, getSettings, updateOrder } from './_lib/store.js'
import { now } from './_lib/db.js'

// POST { orderId } – henter ordre + indstillinger, sender SMS via GatewayAPI,
// og markerer ordren som sendt. Skabelon/nummer læses server-side, ikke fra klienten.
export default withErrors(async (req, res) => {
  await requireUser(req, res)
  if (req.method !== 'POST') throw httpError(405, `Metode ${req.method} ikke tilladt`)

  const { orderId } = await readJson(req)
  if (!orderId) throw httpError(400, 'Mangler orderId')

  const order = await getOrder(orderId)
  if (!order) throw httpError(404, 'Ordre blev ikke fundet')

  const settings = await getSettings()
  if (!settings) throw httpError(500, 'Kunne ikke hente indstillinger')

  const message = renderTemplate(settings.sms_template, {
    leadMinutes: order.lead_minutes,
    readyAt: order.ready_at,
    name: order.name,
    orderNo: order.order_no,
  })

  const result = await sendSms({
    to: order.phone,
    message,
    sender: settings.sender_name,
  })

  let updated
  try {
    updated = await updateOrder(orderId, { status: 'sent', sms_sent_at: now(), sms_body: message })
  } catch (err) {
    throw httpError(500, 'SMS sendt, men ordren kunne ikke opdateres: ' + err.message)
  }
  if (!updated) throw httpError(500, 'SMS sendt, men ordren kunne ikke opdateres')

  return sendJson(res, 200, { order: updated, message, ...result })
})
