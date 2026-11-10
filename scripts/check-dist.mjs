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
//  - Every file index.js loads by `new URL(..., import.meta.url)` is in dist
//    beside it, and every font in dist is one it loads.
//  - The declarations are only those the entries reach
//    (scripts/prune-declarations.mjs), and they type-check, strictly and with
//    Vue's checked too, under each module resolution the README promises.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { declarationProgram, ENTRY_DECLARATIONS, errorsOf, reachedFiles, RESOLUTIONS } from './declarations.mjs'

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

const loaded = new Set([...index.matchAll(/new URL\((["'`])([^"'`]+)\1,\s*import\.meta\.url\)/g)].map((m) => m[2]))
for (const file of loaded) {
  if (!existsSync(join(dist, file))) problems.push(`index.js loads a file dist does not hold: ${file}`)
}
for (const font of fonts) {
  if (!loaded.has(basename(font))) problems.push(`a font index.js never loads: ${relative(dist, font)}`)
}

for (const file of ENTRY_DECLARATIONS) {
  if (!existsSync(join(dist, file))) problems.push(`no ${file}`)
}
const declarations = files
  .filter((entry) => entry.name.endsWith('.d.ts'))
  .map((entry) => resolve(entry.parentPath, entry.name))
for (const resolution of Object.keys(RESOLUTIONS)) {
  const program = declarationProgram(dist, resolution)
  for (const error of errorsOf(program)) problems.push(`declarations under ${resolution} resolution: ${error}`)
  const reached = reachedFiles(program, dist)
  for (const file of declarations) {
    if (!reached.has(file)) problems.push(`a declaration no entry reaches under ${resolution} resolution: ${relative(dist, file)}`)
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`dist: ${problem}`)
  process.exit(1)
}
console.log(
  `dist: ${ENTRIES.join(', ')}, vue only in vue.js, banner.js alone; ` +
    `${declarations.length} declarations, all reached, type-checking under ${Object.keys(RESOLUTIONS).join(', ')}; ` +
    (fonts.length > 0
      ? `${fonts.length} font files, with ${LICENCES.join(' and ')} beside them`
      : 'no fonts bundled, so no licences needed beside them'),
)
