// Små helpers så /api-handlers virker ens på Vercel (req.body forparset)
// og i Vite-dev-serveren (rå Node-stream).

export async function readJson(req) {
  // Vercel forparser body; Vite gør ikke.
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  return raw ? JSON.parse(raw) : {}
}

export function sendJson(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

// Wrap en handler så uventede fejl bliver til pæn JSON i stedet for at vælte serveren.
export function withErrors(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (err) {
      console.error('[api]', req.method, req.url, err)
      if (!res.writableEnded) {
        sendJson(res, err.status || 500, { error: err.message || 'Serverfejl' })
      }
    }
  }
}

export function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}
