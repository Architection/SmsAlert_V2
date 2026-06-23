import { httpError } from './http.js'

// Normaliser et indtastet nummer til GatewayAPI's "msisdn" (kun cifre, med landekode).
export function toMsisdn(input, countryCode = process.env.DEFAULT_COUNTRY_CODE || '45') {
  if (!input) throw httpError(400, 'Mangler telefonnummer')
  let s = String(input).trim()
  const hadPlus = s.startsWith('+')
  s = s.replace(/\D/g, '') // kun cifre
  if (!hadPlus && s.startsWith('00')) s = s.slice(2) // 00 = international præfiks
  if (!hadPlus && !s.startsWith('00') && s.length === 8) s = countryCode + s // lokalt DK-nummer
  if (s.length < 8) throw httpError(400, `Ugyldigt telefonnummer: ${input}`)
  return Number(s)
}

// Indsæt værdier i SMS-skabelonen. Pladsholdere: {minutter} {tid} {navn} {ordreno}
export function renderTemplate(template, { leadMinutes, readyAt, name, orderNo } = {}) {
  const tid = readyAt
    ? new Intl.DateTimeFormat('da-DK', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Copenhagen',
      }).format(new Date(readyAt))
    : ''
  return template
    .replace(/\{minutter\}/g, leadMinutes ?? '')
    .replace(/\{tid\}/g, tid)
    .replace(/\{navn\}/g, name || '')
    .replace(/\{ordreno\}/g, orderNo ?? '')
    .replace(/\s{2,}/g, ' ') // ryd op hvis {navn} var tomt
    .trim()
}

// Send via GatewayAPI REST (https://gatewayapi.com/docs/apis/rest/).
export async function sendSms({ to, message, sender }) {
  const token = process.env.GATEWAYAPI_TOKEN
  if (!token) throw httpError(500, 'GATEWAYAPI_TOKEN mangler i .env')

  const msisdn = toMsisdn(to)
  const senderName = (sender || process.env.GATEWAYAPI_SENDER || 'SMS').slice(0, 11)

  const res = await fetch('https://gatewayapi.com/rest/mtsms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // GatewayAPI: token som Basic-brugernavn, tomt password.
      Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64'),
    },
    body: JSON.stringify({
      sender: senderName,
      message,
      recipients: [{ msisdn }],
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw httpError(res.status === 401 ? 401 : 502, `GatewayAPI-fejl (${res.status}): ${text}`)
  }
  let data = {}
  try {
    data = JSON.parse(text)
  } catch {
    /* GatewayAPI svarer normalt med JSON; ignorér hvis ikke */
  }
  return { msisdn, providerIds: data.ids || [] }
}
