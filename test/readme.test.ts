/**
 * The README promises a few things that must stay true as the code moves:
 * pinned here, so a change to one is a change to the docs too.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8')
const section = (heading: string) => {
  const start = readme.indexOf(`\n${heading}\n`)
  if (start < 0) return ''
  const level = heading.split(' ')[0]!
  const rest = readme.slice(start + heading.length + 2)
  const next = rest.search(new RegExp(`\\n#{1,${level.length}} `))
  return next < 0 ? rest : rest.slice(0, next)
}

describe('the README', () => {
  it('says the storage key is fixed at mount', () => {
    const row = readme.split('\n').find((line) => line.startsWith('| `layersStorageKey` |')) ?? ''
    expect(row).toMatch(/fixed at mount/i)
  })

  it('has the changelog committed before npm version makes its commit and tag', () => {
    const steps = section('## Versioning and releases')
    const commit = steps.search(/commit the changelog/i)
    const version = steps.indexOf('`npm version')
    expect(commit).toBeGreaterThan(-1)
    expect(version).toBeGreaterThan(commit)
  })

  it('says what a Content Security Policy has to allow', () => {
    const csp = section('### Content Security Policy')
    expect(csp).toContain('img-src')
    expect(csp).toContain('data:')
    expect(csp).toContain('font-src')
    expect(csp).toMatch(/style-src/)
  })

  it('says how a host keeps its own controls in the overlay from stopping moments', () => {
    const row = readme.split('\n').find((line) => line.startsWith('| `overlay` |')) ?? ''
    expect(row).toContain('data-match-tracker-keep')
    expect(section('### Replay')).toContain('data-match-tracker-keep')
  })

  it('tells Vite apps to keep the package out of dependency pre-bundling', () => {
    const bundlers = section('### Bundlers')
    expect(bundlers).toContain('optimizeDeps')
    expect(bundlers).toContain("exclude: ['@coenhallie/match-tracker']")
  })
})
