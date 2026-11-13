/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { stripStylesComments } from './scripts/stripStylesComments.ts'

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

/**
 * The shadow root's stylesheet ships without its comments
 * (scripts/stripStylesComments.ts). Not only in the build: the tests import
 * the stylesheet through this too, so they check what ships.
 */
function stylesWithoutComments(): Plugin {
  return {
    name: 'match-tracker:styles-without-comments',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/widget/styles.ts')) return null
      return { code: stripStylesComments(code), map: null }
    },
  }
}

export default defineConfig({
  // Relative, so the bundled fonts resolve next to dist/index.js wherever the
  // package is installed, rather than from the root of the host's site.
  base: './',
  plugins: [stylesWithoutComments(), fontLicences()],
  define: {
    __MATCH_TRACKER_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // ES2022, in syntax and in the APIs the code may use. A target only lowers
    // syntax; it never adds a missing API, so none newer than ES2022 is used.
    // The oldest browsers are set by the platform APIs (README.md, "Browsers").
    target: 'es2022',
    lib: {
      // The framework-free widget, the Vue component over it, which imports it from ./index.js,
      // and the console banner, which both import from ./banner.js and which a host can
      // import alone, without the widget.
      entry: { index: 'src/index.ts', vue: 'src/vue.ts', banner: 'src/banner.ts' },
      formats: ['es'],
    },
    rolldownOptions: {
      // Vue is the host's, an optional peer: only dist/vue.js imports it (scripts/check-dist.mjs).
      external: ['vue'],
      preserveEntrySignatures: 'allow-extension',
      output: {
        // Minified in full. Vite keeps the whitespace of an ES library so that a
        // host's bundler still sees its /* @__PURE__ */ annotations, but this
        // code has none, so nothing is lost. test/dist checks the minified
        // widget draws exactly what the source does.
        minify: true,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    restoreMocks: true,
    // Lets go of what a test's DOM kept, between tests (see the file).
    setupFiles: ['test/helpers/setup.ts'],
    projects: [
      // `npm test`: everything but test/dist, against the source. The widget's flashback tests play up to
      // 30 s of a 25 Hz stream through a live widget: under 1 s each on their own, but 3 to 5 s in a full
      // run with every worker busy, and up to 9 s on a busy machine, so the 5 s default is too tight.
      { extends: true, test: { name: 'src', include: ['test/**/*.test.ts'], exclude: ['test/dist/**'], testTimeout: 30_000 } },
      // `npm run test:dist`, the last step of `npm run build`: the built dist against the source.
      // Each test plays real match data through two widgets and compares every draw: about
      // 3 s here and over 6 s on a CI runner for the longest, so the 5 s default is too tight.
      { extends: true, test: { name: 'dist', include: ['test/dist/**/*.test.ts'], testTimeout: 30_000 } },
    ],
  },
})
