// Fælles for alle tests: ingen test kan sende en rigtig SMS. Et kald til GatewayAPI, som en test
// ikke selv har erstattet, fejler med det samme. Testene kører heller aldrig mod Turso.
import { afterEach, beforeEach, vi } from 'vitest'

const realFetch = globalThis.fetch

beforeEach(() => {
  delete process.env.SMS_DRY_RUN
  delete process.env.VERCEL
  delete process.env.TURSO_DATABASE_URL
  delete process.env.TURSO_AUTH_TOKEN
  vi.stubGlobal('fetch', async (input, init) => {
    const url = String(input?.url ?? input)
    if (/gatewayapi\.com/i.test(url)) throw new Error('En test prøvede at sende en rigtig SMS.')
    return realFetch(input, init)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
