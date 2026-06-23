// Genererer app-ikoner (PNG) fra SVG-kilderne i /assets til /public.
// Kør med: node scripts/gen-icons.mjs
import sharp from 'sharp'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pub = resolve(root, 'public')
mkdirSync(pub, { recursive: true })

const anySvg = readFileSync(resolve(root, 'assets/icon-any.svg'))
const maskSvg = readFileSync(resolve(root, 'assets/icon-maskable.svg'))

// density=384 ≈ 512px ved 96 DPI-basis → skarp opskalering uden artefakter.
function render(svg, size, out, { background } = {}) {
  let img = sharp(svg, { density: 384 }).resize(size, size, {
    fit: 'contain',
    background: background || { r: 0, g: 0, b: 0, alpha: 0 },
  })
  if (background) img = img.flatten({ background })
  return img.png().toFile(resolve(pub, out)).then(() => console.log('✓', out, size + 'px'))
}

await Promise.all([
  // Almindelige ikoner (gennemsigtige hjørner)
  render(anySvg, 192, 'icon-192.png'),
  render(anySvg, 512, 'icon-512.png'),
  // Maskable (fuldt udfald)
  render(maskSvg, 192, 'icon-maskable-192.png'),
  render(maskSvg, 512, 'icon-maskable-512.png'),
  // Apple touch-ikon: opakt, fuldt udfald (iOS afrunder selv hjørnerne)
  render(maskSvg, 180, 'apple-touch-icon.png', { background: '#2563eb' }),
  // Favicon-fallback i PNG
  render(anySvg, 32, 'favicon-32.png'),
])

console.log('Alle ikoner genereret.')
