import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { formatClock, formatDateTime } from '../lib/time.js'

const STATUS_LABEL = {
  sent: { text: 'SMS sendt', cls: 'tag-sent' },
  done: { text: 'Færdig', cls: 'tag-done' },
  cancelled: { text: 'Annulleret', cls: 'tag-cancelled' },
  active: { text: 'Aktiv', cls: 'tag-active' },
}

const TABS = [
  { key: 'today', label: 'I dag' },
  { key: 'deleted', label: 'Slettet' },
]

export default function History() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'deleted' ? 'deleted' : 'today'

  const [today, setToday] = useState({ list: [], loading: true, error: null, loaded: false })
  const [deleted, setDeleted] = useState({ list: [], loading: false, error: null, loaded: false })

  // Dagens historik hentes med det samme.
  useEffect(() => {
    api
      .historyOrders()
      .then((list) => setToday({ list, loading: false, error: null, loaded: true }))
      .catch((e) => setToday({ list: [], loading: false, error: e.message, loaded: true }))
  }, [])

  // Slettede ordrer hentes først når fanen åbnes.
  useEffect(() => {
    if (tab !== 'deleted' || deleted.loaded) return
    setDeleted((d) => ({ ...d, loading: true }))
    api
      .deletedOrders()
      .then((list) => setDeleted({ list, loading: false, error: null, loaded: true }))
      .catch((e) => setDeleted({ list: [], loading: false, error: e.message, loaded: true }))
  }, [tab, deleted.loaded])

  const current = tab === 'deleted' ? deleted : today

  return (
    <div className="stack">
      <h1 className="page-title">Historik</h1>

      <div className="subtabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`subtab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => setParams(t.key === 'today' ? {} : { tab: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {current.error && <p className="error-banner">⚠️ {current.error}</p>}
      {current.loading && <p className="muted">Indlæser…</p>}
      {!current.loading && current.list.length === 0 && !current.error && (
        <p className="empty">
          {tab === 'deleted' ? 'Ingen slettede ordrer.' : 'Ingen tidligere ordrer i dag endnu.'}
        </p>
      )}

      <div className="order-list">
        {current.list.map((o) => {
          const tag =
            tab === 'deleted'
              ? { text: 'Slettet', cls: 'tag-deleted' }
              : STATUS_LABEL[o.status] || STATUS_LABEL.done
          return (
            <Link key={o.id} to={`/ordre/${o.id}`} className="card history-row">
              <div className="order-info">
                <div className="order-name">
                  {o.order_no != null && <span className="order-no">#{o.order_no} </span>}
                  {o.name || 'Ordre'}
                </div>
                <div className="order-phone">{o.phone}</div>
                <div className="order-meta">
                  {tab === 'deleted' ? (
                    <>Slettet {formatDateTime(o.deleted_at)}</>
                  ) : (
                    <>
                      Klar kl. {formatClock(o.ready_at)}
                      {o.sms_sent_at && <> · SMS sendt kl. {formatClock(o.sms_sent_at)}</>}
                    </>
                  )}
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
