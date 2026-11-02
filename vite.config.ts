/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * The bundled fonts are under the SIL Open Font License, which goes with
 * them wherever they are redistributed. Built, the fonts sit at the root of
 * dist (see src/assets/fonts.ts), so their licences are written there too, on
 * every build: scripts/check-dist.mjs fails the build if fonts ever ship
 * without them.
 */
const FONT_LICENCES = ['Montserrat-OFL.txt', 'Inter-OFL.txt']

function fontLicences(): Plugin {
  return {
    name: 'match-tracker:font-licences',
    apply: 'build',
    generateBundle() {
      for (const fileName of FONT_LICENCES) {
        const source = readFileSync(new URL(`./src/assets/fonts/${fileName}`, import.meta.url))
        this.emitFile({ type: 'asset', fileName, source })
      }
    },
  }
}

export default defineConfig({
  // Relative, so the bundled fonts resolve next to dist/index.js wherever the
  // package is installed, rather than from the root of the host's site.
  base: './',
  plugins: [fontLicences()],
  define: {
    __MATCH_TRACKER_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    // Only the framework-free entry is built for now. The ./vue entry arrives with its own task.
    lib: {
      entry: { index: 'src/index.ts' },
      formats: ['es'],
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
  },
})
