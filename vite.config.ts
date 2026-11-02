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
    lib: {
      // The framework-free widget, and the Vue component over it, which imports it from ./index.js.
      entry: { index: 'src/index.ts', vue: 'src/vue.ts' },
      formats: ['es'],
    },
    rolldownOptions: {
      // Vue is the host's, an optional peer: only dist/vue.js imports it (scripts/check-dist.mjs).
      external: ['vue'],
      preserveEntrySignatures: 'allow-extension',
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
  },
})
