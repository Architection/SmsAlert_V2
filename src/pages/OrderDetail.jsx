import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api.js'
import { formatClock, formatDateTime } from '../lib/time.js'

const STATUS_TEXT = {
  active: 'Aktiv',
  sent: 'SMS sendt',
  done: 'Færdig',
  cancelled: 'Annulleret',
}

export default function OrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .order(id)
      .then(setOrder)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  async function remove() {
    if (!window.confirm('Slet denne ordre permanent?')) return
    try {
      await api.deleteOrder(id)
      navigate('/historik')
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) return <p className="muted">Indlæser…</p>
  if (error) return <p className="error-banner">⚠️ {error}</p>
  if (!order) return null

  return (
    <div className="stack detail">
      <Link to="/historik" className="back-link">
        ‹ Tilbage til historik
      </Link>

      <div className="card">
        <div className="detail-head">
          <h1 className="page-title">{order.name || 'Ordre'}</h1>
          <span className="tag">{STATUS_TEXT[order.status] || order.status}</span>
        </div>

        <dl className="detail-grid">
          {order.order_no != null && (
            <div>
              <dt>Ordrenummer</dt>
              <dd>#{order.order_no}</dd>
            </div>
          )}
          <div>
            <dt>Mobilnummer</dt>
            <dd>{order.phone}</dd>
          </div>
          <div>
            <dt>Færdig ca. kl.</dt>
            <dd>{formatClock(order.ready_at)}</dd>
          </div>
          <div>
            <dt>SMS før færdig</dt>
            <dd>{order.lead_minutes} min</dd>
          </div>
          <div>
            <dt>Oprettet</dt>
            <dd>{formatDateTime(order.created_at)}</dd>
          </div>
          <div>
            <dt>SMS sendt</dt>
            <dd>{order.sms_sent_at ? formatDateTime(order.sms_sent_at) : 'Ikke sendt'}</dd>
          </div>
        </dl>

        {order.sms_body && (
          <>
            <h3 className="subhead">Sendt besked</h3>
            <div className="sms-preview">{order.sms_body}</div>
          </>
        )}
      </div>

      <button className="btn btn-ghost btn-sm danger" onClick={remove}>
        Slet ordre
      </button>
    </div>
  )
}
