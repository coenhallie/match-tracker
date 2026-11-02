// Run after the build: wherever dist holds a bundled font, both font
// licences must sit beside it, as the SIL Open Font License asks. Exits 1,
// failing the build, if any is missing.
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const LICENCES = ['Montserrat-OFL.txt', 'Inter-OFL.txt']
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const fonts = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.woff2'))
  .map((entry) => join(entry.parentPath, entry.name))

const missing = [...new Set(fonts.map((font) => dirname(font)))].flatMap((dir) =>
  LICENCES.filter((licence) => !existsSync(join(dir, licence))).map((licence) => relative(dist, join(dir, licence))),
)

if (missing.length > 0) {
  console.error(`dist ships fonts without their licences: ${missing.join(', ')}`)
  process.exit(1)
}
console.log(
  fonts.length > 0
    ? `dist: ${fonts.length} font files, with ${LICENCES.join(' and ')} beside them`
    : 'dist: no fonts bundled, so no licences needed beside them',
)
