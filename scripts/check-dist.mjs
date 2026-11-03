// Run after the build, failing it (exit 1) when dist is not what the package
// promises:
//
//  - Wherever dist holds a bundled font, both font licences sit beside it, as
//    the SIL Open Font License asks.
//  - The code is three files: index.js, the framework-free widget, vue.js,
//    the component over it, and banner.js, the console banner, which a host
//    can import alone (`@coenhallie/match-tracker/banner`). No other shared
//    chunk: banner.js is the one module the banner's once-per-page guard
//    lives in, so index.js imports it rather than holding a copy.
//  - banner.js imports nothing and holds no widget code, so importing it
//    from a host's entry loads nothing else.
//  - index.js never imports Vue, which is an optional peer; vue.js imports
//    it, rather than bundling it, and takes the widget from ./index.js.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const LICENCES = ['Montserrat-OFL.txt', 'Inter-OFL.txt']
const ENTRIES = ['index.js', 'vue.js', 'banner.js']
/** Names that only the widget's own code uses: none may appear in dist/banner.js. */
const WIDGET_MARKERS = ['createMatchTracker', 'attachShadow', 'getContext', 'requestAnimationFrame', 'addEventListener', 'FontFace']
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const problems = []

const files = readdirSync(dist, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
const fonts = files.filter((entry) => entry.name.endsWith('.woff2')).map((entry) => join(entry.parentPath, entry.name))

for (const dir of new Set(fonts.map((font) => dirname(font)))) {
  for (const licence of LICENCES) {
    const path = relative(dist, join(dir, licence))
    if (!existsSync(join(dist, path))) problems.push(`fonts ship without their licence: ${path}`)
  }
}

const code = files
  .filter((entry) => entry.name.endsWith('.js'))
  .map((entry) => relative(dist, join(entry.parentPath, entry.name)))
const extra = code.filter((file) => !ENTRIES.includes(file))
if (extra.length > 0) problems.push(`code outside index.js, vue.js and banner.js: ${extra.join(', ')}`)

/** Whether `source` imports `specifier`, statically or dynamically, in any quoting. */
function imports(source, specifier) {
  const s = specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*)(["'\`])${s}\\1`).test(source)
}

const index = readFileSync(join(dist, 'index.js'), 'utf8')
const vue = readFileSync(join(dist, 'vue.js'), 'utf8')
const banner = readFileSync(join(dist, 'banner.js'), 'utf8')
if (imports(index, 'vue')) problems.push('index.js imports vue')
if (!imports(vue, 'vue')) problems.push('vue.js does not import vue: is it bundled?')
if (!imports(vue, './index.js')) problems.push('vue.js does not take the widget from ./index.js')
if (!imports(index, './banner.js')) problems.push('index.js does not take the banner from ./banner.js: is it bundled twice?')
if (/\b(?:import|export)\b[^;]*?\bfrom\b|\bimport\s*\(/.test(banner)) problems.push('banner.js imports another module')
for (const marker of WIDGET_MARKERS) {
  if (banner.includes(marker)) problems.push(`banner.js holds widget code: ${marker}`)
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`dist: ${problem}`)
  process.exit(1)
}
console.log(
  `dist: ${ENTRIES.join(', ')}, vue only in vue.js, banner.js alone; ` +
    (fonts.length > 0
      ? `${fonts.length} font files, with ${LICENCES.join(' and ')} beside them`
      : 'no fonts bundled, so no licences needed beside them'),
)
