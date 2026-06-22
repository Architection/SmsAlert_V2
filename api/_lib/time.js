// Start på "i dag" i dansk tid, som et UTC-tidspunkt (ISO-streng).
// Bruger toLocaleString-tricket til at finde Europe/Copenhagen-offset robust mht. sommertid.
export function copenhagenDayStartISO(now = new Date()) {
  const tz = 'Europe/Copenhagen'
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }))
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offsetMs = local.getTime() - utc.getTime() // Copenhagen − UTC
  const midnightUtc = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()) - offsetMs
  return new Date(midnightUtc).toISOString()
}
