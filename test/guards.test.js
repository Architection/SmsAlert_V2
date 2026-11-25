// Læser koden og tjekker vagterne: der er ingen RLS længere, så hver fil i api/ (undtagen login)
// skal tjekke, at nogen er logget ind, før den gør noget. Tåler CRLF (Windows-checkout).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')

const endpoints = readdirSync(join(root, 'api')).filter((f) => f.endsWith('.js'))

describe('vagterne', () => {
  it('der er de forventede endpoints', () => {
    expect(endpoints.sort()).toEqual(['auth.js', 'campaign.js', 'orders.js', 'send-sms.js', 'settings.js'])
  })

  for (const file of endpoints.filter((f) => f !== 'auth.js')) {
    it(`api/${file} kalder requireUser som det første`, () => {
      const code = read(`api/${file}`)
      expect(code).toMatch(/export default withErrors\(async \(req, res\) => \{\n\s*await requireUser\(req, res\)\n/)
    })
  }

  it('api/auth.js giver kun login, logout og me', () => {
    const code = read('api/auth.js')
    const actions = [...code.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1])
    expect(actions).toEqual(['login', 'logout', 'me'])
  })

  it('Better Auths tilmelding er slået fra', () => {
    expect(read('api/_lib/auth-engine.js')).toMatch(/disableSignUp: true/)
  })

  it('browserens kode importerer aldrig serverkode og nævner ikke Supabase', () => {
    const walk = (dir) =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      )
    for (const file of walk('src').filter((f) => /\.(js|jsx)$/.test(f))) {
      const code = read(file)
      expect(code, file).not.toMatch(/from ['"][./]*api\//)
      expect(code, file).not.toMatch(/supabase/i)
    }
  })

  it('ingen kode bruger Supabase-pakken længere', () => {
    for (const dir of ['api', 'api/_lib', 'scripts']) {
      for (const f of readdirSync(join(root, dir)).filter((x) => /\.m?js$/.test(x))) {
        if (f === 'copy-from-supabase.mjs') continue
        expect(read(`${dir}/${f}`), `${dir}/${f}`).not.toMatch(/@supabase\//)
      }
    }
  })
})
