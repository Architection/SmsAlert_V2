import { formatClock } from './time.js'

// Spejler server-side renderTemplate, så vi kan vise et eksakt forhåndsvisning
// af SMS'en før afsendelse. Pladsholdere: {minutter} {tid} {navn} {ordreno}
export function renderTemplate(template, { leadMinutes, readyAt, name, orderNo } = {}) {
  if (!template) return ''
  return template
    .replace(/\{minutter\}/g, leadMinutes ?? '')
    .replace(/\{tid\}/g, readyAt ? formatClock(readyAt) : '')
    .replace(/\{navn\}/g, name || '')
    .replace(/\{ordreno\}/g, orderNo ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
