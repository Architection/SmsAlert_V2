import { sendJson, withErrors, httpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { toUtcIso } from './_lib/db.js'
import { campaignNumbers, campaignSummary, syncArchive } from './_lib/store.js'

function query(req) {
  return new URL(req.url, 'http://x').searchParams
}

// Nøgletal + top-numre + hvornår der sidst blev hentet.
async function summary(req, res) {
  return sendJson(res, 200, await campaignSummary())
}

// En dato fra filteret som UTC, som Postgres læste den. Ugyldig dato → 400.
function filterTime(value, label) {
  if (!value) return null
  const iso = toUtcIso(value)
  if (!iso) throw httpError(400, `Ugyldig ${label}`)
  return iso
}

// Unikke numre, aggregeret, med valgfri filtre. Bruges til både visning og CSV-eksport.
async function numbers(req, res) {
  const q = query(req)
  const from = filterTime(q.get('from'), 'fra-dato')
  const to = filterTime(q.get('to'), 'til-dato')
  const minOrders = q.get('minOrders') ? parseInt(q.get('minOrders'), 10) : 1
  const search = (q.get('q') || '').replace(/\D/g, '') || null // kun cifre i søgning
  const limit = q.get('limit') ? Math.min(parseInt(q.get('limit'), 10) || 1000, 200000) : 1000

  const data = await campaignNumbers({
    from,
    to,
    minOrders: Number.isFinite(minOrders) ? minOrders : 1,
    q: search,
    limit,
  })
  return sendJson(res, 200, data)
}

// Træk numre fra ordrerne ind i arkivet (idempotent via unik (phone, ordered_at)).
async function sync(req, res) {
  return sendJson(res, 200, await syncArchive())
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
