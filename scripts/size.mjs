// `npm run size`, after `npm run build`: the gzipped size of the code in
// dist, and the size of the bundled fonts. Exits 1 when dist/index.js, the
// whole framework-free widget (scripts/check-dist.mjs keeps it one file), is
// over its budget.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

/** The spec's budget for the code, fonts aside: 60 kB gzipped (1 kB = 1000 bytes, as Vite reports). */
const BUDGET = 60_000
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const kB = (bytes) => `${(bytes / 1000).toFixed(2)} kB`

function gzipped(file) {
  const source = readFileSync(join(dist, file))
  return { raw: source.length, gzip: gzipSync(source, { level: 9 }).length }
}

const index = gzipped('index.js')
const vue = gzipped('vue.js')
const fonts = readdirSync(dist).filter((name) => name.endsWith('.woff2'))
const fontBytes = fonts.reduce((sum, name) => sum + statSync(join(dist, name)).size, 0)

console.log(`dist/index.js  ${kB(index.raw)}, ${kB(index.gzip)} gzipped (budget ${kB(BUDGET)})`)
console.log(`dist/vue.js    ${kB(vue.raw)}, ${kB(vue.gzip)} gzipped`)
console.log(`fonts          ${kB(fontBytes)} in ${fonts.length} woff2 files (already compressed)`)

if (index.gzip > BUDGET) {
  console.error(`dist/index.js is ${kB(index.gzip - BUDGET)} over its ${kB(BUDGET)} gzipped budget`)
  process.exit(1)
}
