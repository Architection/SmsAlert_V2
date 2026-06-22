import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

// Mounter /api/* handlers i Vite-dev-serveren, så `npm run dev` virker uden Vercel CLI.
// I produktion (Vercel) bliver de samme filer automatisk til serverless functions.
function devApi(env) {
  return {
    name: 'dev-api',
    configureServer(server) {
      // Gør server-side hemmeligheder tilgængelige for handlers via process.env.
      for (const [k, v] of Object.entries(env)) {
        if (!k.startsWith('VITE_') && process.env[k] === undefined) process.env[k] = v
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        const name = req.url.split('?')[0].slice('/api/'.length).replace(/\/+$/, '')
        const file = resolve(server.config.root, 'api', name + '.js')
        if (!name || !existsSync(file)) return next()
        try {
          const mod = await server.ssrLoadModule(file)
          await mod.default(req, res)
        } catch (err) {
          server.ssrFixStacktrace(err)
          console.error('[dev-api]', err)
          if (!res.writableEnded) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message }))
          }
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), devApi(env)],
  }
})
