/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  // Relative, so the bundled fonts resolve next to dist/index.js wherever the
  // package is installed, rather than from the root of the host's site.
  base: './',
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
