/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
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

/**
 * The demo's data, served by the dev server only: the test fixtures, decoded
 * here in Node as the tests decode them, so the page fetches plain JSON.
 *
 *  - `/demo/fixtures/excerpt.json`: test/fixtures/excerpt.jsonl.gz, a real
 *    stretch of match as the websocket sent it, one raw message per entry.
 *  - `/demo/fixtures/goal.json`: the records of the golden goal recording
 *    (test/fixtures/goldens/goal.json.br), a synthetic attack ending in a
 *    GOAL label, with the team names it was recorded with.
 *
 * `/` redirects to the demo page.
 */
const FIXTURES = fileURLToPath(new URL('./test/fixtures', import.meta.url))

function excerpt(): string {
  const text = gunzipSync(readFileSync(resolve(FIXTURES, 'excerpt.jsonl.gz'))).toString('utf8')
  return JSON.stringify(text.split('\n').filter((line) => line.trim()))
}

function goal(): string {
  const golden = JSON.parse(
    brotliDecompressSync(readFileSync(resolve(FIXTURES, 'goldens/goal.json.br'))).toString('utf8'),
  ) as { records: unknown[]; teamNames: [string, string] }
  return JSON.stringify({ records: golden.records, teamNames: golden.teamNames })
}

const SOURCES: Record<string, () => string> = { 'excerpt.json': excerpt, 'goal.json': goal }

function demoFixtures(): Plugin {
  const cache = new Map<string, string>()
  return {
    name: 'match-tracker:demo-fixtures',
    // The dev server only: not the library build, and not Vitest, which also serves.
    apply: (_config, env) => env.command === 'serve' && !process.env.VITEST,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url === '/') {
          res.writeHead(302, { Location: '/demo/' })
          res.end()
          return
        }
        const name = url?.startsWith('/demo/fixtures/') ? url.slice('/demo/fixtures/'.length) : null
        const source = name ? SOURCES[name] : undefined
        if (!name || !source) {
          next()
          return
        }
        let body = cache.get(name)
        if (body === undefined) {
          body = source()
          cache.set(name, body)
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(body)
      })
    },
  }
}

export default defineConfig({
  // Relative, so the bundled fonts resolve next to dist/index.js wherever the
  // package is installed, rather than from the root of the host's site.
  base: './',
  plugins: [fontLicences(), demoFixtures()],
  // `npm run dev`: the demo page (demo/index.html), at / and /demo/. Not 5173, which other apps here use.
  server: { port: 5180 },
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
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
  },
})
