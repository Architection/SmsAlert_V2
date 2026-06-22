// Klient-side tids-hjælpere (dansk tid).

const TZ = 'Europe/Copenhagen'

export function formatClock(iso) {
  if (!iso) return '–'
  return new Intl.DateTimeFormat('da-DK', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(new Date(iso))
}

export function formatDateTime(iso) {
  if (!iso) return '–'
  return new Intl.DateTimeFormat('da-DK', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(new Date(iso))
}

// Tidspunktet hvor SMS'en bør sendes = færdig-tid minus minutter-før.
export function sendAtMs(order) {
  return new Date(order.ready_at).getTime() - (order.lead_minutes || 0) * 60_000
}

// Formatér en varighed i millisekunder som "mm:ss" eller "t:mm:ss".
export function formatDuration(ms) {
  const neg = ms < 0
  let total = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(total / 3600)
  total -= h * 3600
  const m = Math.floor(total / 60)
  const s = total - m * 60
  const pad = (n) => String(n).padStart(2, '0')
  const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
  return (neg ? '−' : '') + body
}

// Konvertér et "HH:MM" tidspunkt til et ISO-tidsstempel i dag (enhedens lokale tid).
export function clockToIsoToday(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

// "HH:MM" for nu + et antal minutter (til hurtig-knapper).
export function clockFromNowPlus(minutes) {
  const d = new Date(Date.now() + minutes * 60_000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
