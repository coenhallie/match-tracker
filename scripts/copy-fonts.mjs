// Copies the bundled fonts' woff2 files, and their licences, from the
// @fontsource devDependencies into src/assets/fonts/. The copies are
// committed, so the build does not depend on this script: run it with
// `npm run copy-fonts` after changing a @fontsource version, and commit the
// result. Latin subsets only.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'fonts')

/** Each package, the files to take from its files/ folder, and the name its licence is copied as. */
const FONTS = [
  {
    pkg: '@fontsource/montserrat',
    files: [
      'montserrat-latin-400-normal.woff2',
      'montserrat-latin-600-normal.woff2',
      'montserrat-latin-700-normal.woff2',
    ],
    licence: 'Montserrat-OFL.txt',
  },
  {
    pkg: '@fontsource/inter',
    files: ['inter-latin-900-italic.woff2', 'inter-latin-900-normal.woff2', 'inter-latin-600-normal.woff2', 'inter-latin-400-normal.woff2'],
    licence: 'Inter-OFL.txt',
  },
]

mkdirSync(out, { recursive: true })
for (const { pkg, files, licence } of FONTS) {
  const root = dirname(require.resolve(`${pkg}/package.json`))
  for (const file of files) copyFileSync(join(root, 'files', file), join(out, file))
  copyFileSync(join(root, 'LICENSE'), join(out, licence))
  console.log(`${pkg}: ${files.join(', ')}, ${licence}`)
}
