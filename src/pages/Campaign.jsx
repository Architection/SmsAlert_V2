import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatDate, formatDateTime } from '../lib/time.js'

const DISPLAY_LIMIT = 1000 // antal numre der vises i tabellen (eksport henter alle)
const EXPORT_LIMIT = 200000

const PRESETS = [
  { label: 'Seneste uge', days: 7 },
  { label: 'Seneste måned', days: 30 },
  { label: 'Seneste 3 mdr.', days: 90 },
  { label: 'Seneste år', days: 365 },
  { label: 'Alle', days: null },
]

// Lokal dato som "YYYY-MM-DD" (til <input type=date> og presets).
function isoDate(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return z.toISOString().slice(0, 10)
}

// Vis msisdn pænt: 4540184636 → "40 18 46 36".
function formatPhone(msisdn) {
  const s = String(msisdn)
  const local = s.startsWith('45') && s.length === 10 ? s.slice(2) : s
  return local.replace(/(\d{2})(?=\d)/g, '$1 ').trim()
}

// Byg filter-parametre til API'et ud fra felternes værdier.
function buildParams(f) {
  const p = {}
  if (f.from) p.from = f.from
  if (f.to) p.to = f.to + 'T23:59:59'
  if (f.minOrders && Number(f.minOrders) > 1) p.minOrders = f.minOrders
  if (f.q) p.q = f.q
  return p
}

export default function Campaign() {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)

  const [filters, setFilters] = useState({ from: '', to: '', minOrders: '', q: '' })
  const [rows, setRows] = useState([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  function loadSummary() {
    return api.campaign
      .summary()
      .then(setSummary)
      .catch((e) => setError(e.message))
  }

  async function loadRows(f = filters) {
    setRowsLoading(true)
    try {
      const data = await api.campaign.numbers({ ...buildParams(f), limit: DISPLAY_LIMIT })
      setRows(data)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setRowsLoading(false)
    }
  }

  useEffect(() => {
    loadSummary()
    loadRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const r = await api.campaign.sync()
      setSyncMsg(
        r.inserted > 0
          ? `Hentede ${r.inserted} ${r.inserted === 1 ? 'nyt nummer' : 'nye numre'} ind i arkivet.`
          : 'Arkivet er allerede opdateret – ingen nye numre.',
      )
      await Promise.all([loadSummary(), loadRows()])
    } catch (e) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  function applyPreset(days) {
    const to = isoDate(new Date())
    const from = days == null ? '' : isoDate(new Date(Date.now() - days * 86_400_000))
    const next = { ...filters, from, to: days == null ? '' : to }
    setFilters(next)
    loadRows(next)
  }

  function onSubmitFilter(e) {
    e.preventDefault()
    loadRows()
  }

  async function exportCsv() {
    setExporting(true)
    try {
      const data = await api.campaign.numbers({ ...buildParams(filters), limit: EXPORT_LIMIT })
      const header = ['phone', 'orders', 'first_order', 'last_order']
      const lines = [header.join(',')]
      for (const r of data) {
        lines.push([r.phone, r.orders, r.first_order, r.last_order].join(','))
      }
      const blob = new Blob(['﻿' + lines.join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `sms-arkiv-${isoDate(new Date())}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }

  const empty = summary && summary.total_rows === 0
  const capped = rows.length >= DISPLAY_LIMIT

  return (
    <div className="stack">
      <section>
        <div className="page-head">
          <h1 className="page-title">Kampagne</h1>
          <div className="sync-box">
            <button className="btn btn-primary" onClick={runSync} disabled={syncing}>
              {syncing ? 'Henter…' : '↻ Hent seneste ordrer'}
            </button>
            <span className="muted sync-when">
              Sidst hentet: {summary?.last_sync_at ? formatDateTime(summary.last_sync_at) : 'aldrig'}
            </span>
          </div>
        </div>
        {error && <p className="error-banner">⚠️ {error}</p>}
        {syncMsg && <p className="saved-flash">✓ {syncMsg}</p>}
      </section>

      {/* Nøgletal */}
      <section className="stat-grid">
        <Stat label="Unikke numre" value={summary?.unique_numbers} />
        <Stat label="Bestillinger i alt" value={summary?.total_rows} />
        <Stat label="Seneste 7 dage" value={summary?.last_7_days} />
        <Stat label="Seneste 30 dage" value={summary?.last_30_days} />
      </section>

      {empty && (
        <p className="empty">
          Arkivet er tomt. Kør engangs-importen, eller tryk “Hent seneste ordrer”.
        </p>
      )}

      {/* Top-numre */}
      {summary?.top_numbers?.length > 0 && (
        <section>
          <h2 className="section-title">Bestiller mest</h2>
          <div className="card table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nummer</th>
                  <th className="num">Bestillinger</th>
                  <th>Sidst</th>
                </tr>
              </thead>
              <tbody>
                {summary.top_numbers.map((n) => (
                  <tr key={n.phone}>
                    <td className="mono">{formatPhone(n.phone)}</td>
                    <td className="num">{n.orders}</td>
                    <td>{formatDate(n.last_order)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Filtrér + eksportér */}
      <section>
        <div className="page-head">
          <h2 className="section-title">SMS-arkiv</h2>
          <button className="btn" onClick={exportCsv} disabled={exporting || rows.length === 0}>
            {exporting ? 'Eksporterer…' : '⬇ Eksportér CSV'}
          </button>
        </div>

        <form className="card filter-card" onSubmit={onSubmitFilter}>
          <div className="quick-row">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="chip"
                onClick={() => applyPreset(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="filter-grid">
            <label className="field">
              <span>Fra dato</span>
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Til dato</span>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Min. bestillinger</span>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="1"
                value={filters.minOrders}
                onChange={(e) => setFilters((f) => ({ ...f, minOrders: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Søg nummer</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="fx 4018"
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              />
            </label>
          </div>

          <div className="row-end">
            <button type="submit" className="btn btn-primary" disabled={rowsLoading}>
              {rowsLoading ? 'Filtrerer…' : 'Anvend filter'}
            </button>
          </div>
        </form>

        <p className="muted result-count">
          {rowsLoading
            ? 'Indlæser…'
            : capped
              ? `Viser de første ${DISPLAY_LIMIT.toLocaleString('da-DK')} numre – eksportér for at få alle.`
              : `${rows.length.toLocaleString('da-DK')} ${rows.length === 1 ? 'nummer' : 'numre'}`}
        </p>

        {rows.length > 0 && (
          <div className="card table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nummer</th>
                  <th className="num">Bestillinger</th>
                  <th>Første</th>
                  <th>Seneste</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.phone}>
                    <td className="mono">{formatPhone(r.phone)}</td>
                    <td className="num">{r.orders}</td>
                    <td>{formatDate(r.first_order)}</td>
                    <td>{formatDate(r.last_order)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="card stat">
      <div className="stat-value">{value == null ? '–' : value.toLocaleString('da-DK')}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
