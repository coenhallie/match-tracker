// `npm run size`, after `npm run build`: the gzipped size of the code in
// dist, and the size of the bundled fonts. Exits 1 when dist/index.js, the
// whole framework-free widget bar the banner, is over its budget, or when
// dist/banner.js, which hosts import at their entry, is over its own.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

/** The spec's budget for the code, fonts aside: 65 kB gzipped (1 kB = 1000 bytes, as Vite reports). */
const BUDGET = 65_000
/** The banner entry is imported at a host's app entry, so it stays tiny: 2 kB gzipped. */
const BANNER_BUDGET = 2_000
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const kB = (bytes) => `${(bytes / 1000).toFixed(2)} kB`

function gzipped(file) {
  const source = readFileSync(join(dist, file))
  return { raw: source.length, gzip: gzipSync(source, { level: 9 }).length }
}

const index = gzipped('index.js')
const vue = gzipped('vue.js')
const banner = gzipped('banner.js')
const fonts = readdirSync(dist).filter((name) => name.endsWith('.woff2'))
const fontBytes = fonts.reduce((sum, name) => sum + statSync(join(dist, name)).size, 0)

console.log(`dist/index.js  ${kB(index.raw)}, ${kB(index.gzip)} gzipped (budget ${kB(BUDGET)})`)
console.log(`dist/vue.js    ${kB(vue.raw)}, ${kB(vue.gzip)} gzipped`)
console.log(`dist/banner.js ${kB(banner.raw)}, ${kB(banner.gzip)} gzipped (budget ${kB(BANNER_BUDGET)})`)
console.log(`fonts          ${kB(fontBytes)} in ${fonts.length} woff2 files (already compressed)`)

let failed = false
if (index.gzip > BUDGET) {
  console.error(`dist/index.js is ${kB(index.gzip - BUDGET)} over its ${kB(BUDGET)} gzipped budget`)
  failed = true
}
if (banner.gzip > BANNER_BUDGET) {
  console.error(`dist/banner.js is ${kB(banner.gzip - BANNER_BUDGET)} over its ${kB(BANNER_BUDGET)} gzipped budget`)
  failed = true
}
if (failed) process.exit(1)
