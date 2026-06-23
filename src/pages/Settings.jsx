import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { renderTemplate } from '../lib/template.js'

const PLACEHOLDERS = [
  { tag: '{minutter}', desc: 'antal minutter før færdig' },
  { tag: '{tid}', desc: 'aftalt færdig-tidspunkt (kl.)' },
  { tag: '{navn}', desc: 'navn/note på ordren' },
  { tag: '{ordreno}', desc: 'ordrens fortløbende nummer' },
]

export default function Settings() {
  const [template, setTemplate] = useState('')
  const [sender, setSender] = useState('')
  const [nextOrderNo, setNextOrderNo] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setTemplate(s.sms_template)
        setSender(s.sender_name)
        setNextOrderNo(s.next_order_no ?? 1)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const preview = useMemo(
    () =>
      renderTemplate(template, {
        leadMinutes: 10,
        readyAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        name: 'Anna',
        orderNo: nextOrderNo || 1,
      }),
    [template, nextOrderNo],
  )

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.saveSettings({
        sms_template: template,
        sender_name: sender,
        next_order_no: Number(nextOrderNo),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e2) {
      setError(e2.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="muted">Indlæser…</p>

  return (
    <div className="stack">
      <h1 className="page-title">Indstillinger</h1>

      <form className="card" onSubmit={save}>
        <label className="field">
          <span>Afsendernavn (vises på SMS, max 11 tegn)</span>
          <input
            type="text"
            maxLength={11}
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>SMS-tekst</span>
          <textarea
            rows={4}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Næste ordrenummer</span>
          <input
            type="number"
            min="1"
            step="1"
            value={nextOrderNo}
            onChange={(e) => setNextOrderNo(e.target.value)}
            required
          />
          <span className="muted">Nummeret den næste nye ordre får. Tæller automatisk én op for hver ordre.</span>
        </label>

        <div className="placeholder-help">
          <span className="muted">Pladsholdere du kan bruge:</span>
          <ul>
            {PLACEHOLDERS.map((p) => (
              <li key={p.tag}>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setTemplate((t) => t + p.tag)}
                >
                  {p.tag}
                </button>
                <span className="muted">{p.desc}</span>
              </li>
            ))}
          </ul>
        </div>

        <h3 className="subhead">Forhåndsvisning</h3>
        <div className="sms-preview">{preview || <em className="muted">(tom)</em>}</div>

        {error && <p className="error-banner">⚠️ {error}</p>}

        <div className="row-end">
          {saved && <span className="saved-flash">✓ Gemt</span>}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Gemmer…' : 'Gem indstillinger'}
          </button>
        </div>
      </form>
    </div>
  )
}
