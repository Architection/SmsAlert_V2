import { useEffect, useState } from 'react'
import { api } from '../api.js'
import {
  formatClock,
  formatDuration,
  sendAtMs,
  clockToIsoToday,
  clockFromNowPlus,
} from '../lib/time.js'
import { renderTemplate } from '../lib/template.js'
import Modal from '../components/Modal.jsx'

const POLL_MS = 8000

export default function ActiveOrders() {
  const [orders, setOrders] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [formOpen, setFormOpen] = useState(false)

  // Tikker for nedtælling + periodisk genindlæsning.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  async function load() {
    try {
      const data = await api.activeOrders()
      setOrders(data)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    api.settings().then(setSettings).catch(() => {})
    const poll = setInterval(load, POLL_MS)
    return () => clearInterval(poll)
  }, [])

  return (
    <div className="stack">
      <section>
        <div className="page-head">
          <h1 className="page-title">
            Ordre {orders.length > 0 && <span className="badge">{orders.length}</span>}
          </h1>
          <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
            + Ny ordre
          </button>
        </div>

        {error && <p className="error-banner">⚠️ {error}</p>}
        {loading && <p className="muted">Indlæser…</p>}
        {!loading && orders.length === 0 && !error && (
          <p className="empty">Ingen aktive ordrer lige nu.</p>
        )}

        <div className="order-list">
          {orders.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              now={now}
              template={settings?.sms_template}
              onChanged={load}
            />
          ))}
        </div>
      </section>

      <NewOrderModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={(o) => {
          setOrders((cur) => sortOrders([o, ...cur]))
          setFormOpen(false)
        }}
      />
    </div>
  )
}

function sortOrders(list) {
  return [...list].sort((a, b) => new Date(a.ready_at) - new Date(b.ready_at))
}

function NewOrderModal({ open, onClose, onCreated }) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [lead, setLead] = useState(10)
  const [readyTime, setReadyTime] = useState(() => clockFromNowPlus(30))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  // Nulstil felterne hver gang dialogen åbnes.
  useEffect(() => {
    if (!open) return
    setPhone('')
    setName('')
    setLead(10)
    setReadyTime(clockFromNowPlus(30))
    setErr(null)
  }, [open])

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    setSaving(true)
    try {
      const order = await api.createOrder({
        phone,
        name,
        lead_minutes: lead,
        ready_at: clockToIsoToday(readyTime),
      })
      onCreated(order)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Ny ordre"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Fortryd
          </button>
          <button type="submit" form="new-order-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Tilføjer…' : 'Tilføj ordre'}
          </button>
        </>
      }
    >
      <form id="new-order-form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span>Mobilnummer</span>
            <input
              autoFocus
              type="tel"
              inputMode="tel"
              placeholder="12 34 56 78"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Navn / note (valgfri)</span>
            <input
              type="text"
              placeholder="fx Burger-menu, Anna"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="field">
            <span>SMS sendes (min. før færdig)</span>
            <input
              type="number"
              min="0"
              max="180"
              value={lead}
              onChange={(e) => setLead(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Færdig ca. kl.</span>
            <input
              type="time"
              value={readyTime}
              onChange={(e) => setReadyTime(e.target.value)}
              required
            />
            <div className="quick-row">
              {[15, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  className="chip"
                  onClick={() => setReadyTime(clockFromNowPlus(m))}
                >
                  +{m} min
                </button>
              ))}
            </div>
          </label>
        </div>

        {err && <p className="error-banner">⚠️ {err}</p>}
      </form>
    </Modal>
  )
}

function OrderRow({ order, now, template, onChanged }) {
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const sendAt = sendAtMs(order)
  const remaining = sendAt - now
  const overdue = remaining <= 0
  const soon = !overdue && remaining <= 5 * 60_000
  const state = overdue ? 'urgent' : soon ? 'soon' : 'ok'

  const preview = renderTemplate(template, {
    leadMinutes: order.lead_minutes,
    readyAt: order.ready_at,
    name: order.name,
    orderNo: order.order_no,
  })

  async function doSend() {
    setSending(true)
    setErr(null)
    try {
      await api.sendSms(order.id)
      setConfirm(false)
      onChanged()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSending(false)
    }
  }

  async function cancel() {
    if (!window.confirm('Annullér denne ordre?')) return
    setBusy(true)
    try {
      await api.updateOrder(order.id, { status: 'cancelled' })
      onChanged()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className={`card order-row state-${state}`}>
      <div className="order-info">
        <div className="order-name">
          {order.order_no != null && <span className="order-no">#{order.order_no}</span>}
          {order.name || 'Ordre'}
        </div>
        <div className="order-phone">{order.phone}</div>
        <div className="order-meta">
          Klar kl. <strong>{formatClock(order.ready_at)}</strong> · SMS {order.lead_minutes} min før
        </div>
      </div>

      <div className="order-countdown">
        {overdue ? (
          <>
            <span className="cd-label">Send nu!</span>
            <span className="cd-sub">{formatDuration(remaining)}</span>
          </>
        ) : (
          <>
            <span className="cd-value">{formatDuration(remaining)}</span>
            <span className="cd-sub">til SMS</span>
          </>
        )}
      </div>

      <div className="order-actions">
        <button className="btn btn-primary" onClick={() => setConfirm(true)}>
          Send SMS
        </button>
        <button className="btn btn-ghost btn-sm" onClick={cancel} disabled={busy}>
          Annullér
        </button>
      </div>

      <Modal
        open={confirm}
        onClose={() => !sending && setConfirm(false)}
        title="Send SMS?"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)} disabled={sending}>
              Fortryd
            </button>
            <button className="btn btn-primary" onClick={doSend} disabled={sending}>
              {sending ? 'Sender…' : 'Ja, send SMS'}
            </button>
          </>
        }
      >
        <p className="confirm-to">
          Til <strong>{order.phone}</strong>
        </p>
        <div className="sms-preview">{preview || <em className="muted">(tom besked)</em>}</div>
        {err && <p className="error-banner">⚠️ {err}</p>}
      </Modal>
    </div>
  )
}
