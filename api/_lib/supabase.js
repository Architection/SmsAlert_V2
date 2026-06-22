import { createClient } from '@supabase/supabase-js'
import { httpError } from './http.js'

let client

// Server-side Supabase-klient med service_role nøglen.
// Oprettes dovent så manglende env kun fejler når DB faktisk bruges.
export function getSupabase() {
  if (client) return client

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw httpError(
      500,
      'Supabase er ikke konfigureret. Sæt SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY i .env',
    )
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}
