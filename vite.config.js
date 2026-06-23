import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
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
    plugins: [
      react(),
      devApi(env),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
        manifest: {
          name: 'SMS Alert',
          short_name: 'SMS Alert',
          description: 'Påmind kunder med SMS når deres ordre er klar.',
          lang: 'da',
          start_url: '/',
          scope: '/',
          display: 'fullscreen',
          display_override: ['fullscreen', 'standalone', 'minimal-ui'],
          orientation: 'any',
          background_color: '#0e1117',
          theme_color: '#0e1117',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
        },
        // SW kun i produktion, så dev-API-middleware ikke forstyrres.
        devOptions: { enabled: false },
      }),
    ],
  }
})
