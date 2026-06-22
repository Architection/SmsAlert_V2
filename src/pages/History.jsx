import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { formatClock } from '../lib/time.js'

const STATUS_LABEL = {
  sent: { text: 'SMS sendt', cls: 'tag-sent' },
  done: { text: 'Færdig', cls: 'tag-done' },
  cancelled: { text: 'Annulleret', cls: 'tag-cancelled' },
  active: { text: 'Aktiv', cls: 'tag-active' },
}

export default function History() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .historyOrders()
      .then(setOrders)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="stack">
      <h1 className="page-title">Dagens historik</h1>
      {error && <p className="error-banner">⚠️ {error}</p>}
      {loading && <p className="muted">Indlæser…</p>}
      {!loading && orders.length === 0 && !error && (
        <p className="empty">Ingen tidligere ordrer i dag endnu.</p>
      )}

      <div className="order-list">
        {orders.map((o) => {
          const tag = STATUS_LABEL[o.status] || STATUS_LABEL.done
          return (
            <Link key={o.id} to={`/ordre/${o.id}`} className="card history-row">
              <div className="order-info">
                <div className="order-name">{o.name || 'Ordre'}</div>
                <div className="order-phone">{o.phone}</div>
                <div className="order-meta">
                  Klar kl. {formatClock(o.ready_at)}
                  {o.sms_sent_at && <> · SMS sendt kl. {formatClock(o.sms_sent_at)}</>}
                </div>
              </div>
              <div className="history-right">
                <span className={`tag ${tag.cls}`}>{tag.text}</span>
                <span className="chevron" aria-hidden="true">
                  ›
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
