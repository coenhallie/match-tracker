/**
 * The opt-in console banner: a pitch in box-drawing characters with the
 * version under it, printed once per page, and only when a host asks.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import pkg from '../package.json'

/** The banner module afresh, so each test starts with nothing printed. */
async function load() {
  vi.resetModules()
  return import('../src/banner')
}

let log: MockInstance<typeof console.log>

beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('matchTrackerBanner', () => {
  it('ends with the version, in the title line', async () => {
    const { matchTrackerBanner } = await load()
    const lines = matchTrackerBanner().split('\n')
    expect(lines.at(-1)?.trim()).toBe(`MATCH TRACKER  ·  v${pkg.version}`)
    expect(lines.length).toBeGreaterThanOrEqual(8)
    expect(lines.length).toBeLessThanOrEqual(9)
  })

  it('has every line the same width, about 32 columns', async () => {
    const { matchTrackerBanner } = await load()
    const widths = matchTrackerBanner()
      .split('\n')
      .map((line) => [...line].length)
    expect(new Set(widths).size).toBe(1)
    expect(widths[0]).toBeGreaterThanOrEqual(30)
    expect(widths[0]).toBeLessThanOrEqual(34)
  })

  it('uses only characters one column wide: box drawing, ASCII, the ball and the middle dot', async () => {
    const { matchTrackerBanner } = await load()
    const odd = [...matchTrackerBanner().replaceAll('\n', '')].filter(
      (ch) => !/[ -~─-╿•·]/u.test(ch),
    )
    expect(odd).toEqual([])
  })

  it('draws players on both sides and a ball', async () => {
    const { matchTrackerBanner } = await load()
    const pitch = matchTrackerBanner().split('\n').slice(0, -1)
    const halfway = pitch[0]!.indexOf('┬')
    const players = pitch.flatMap((row) => [...row].flatMap((ch, x) => (ch === 'o' ? [x] : [])))
    expect(players.filter((x) => x < halfway).length).toBeGreaterThanOrEqual(2)
    expect(players.filter((x) => x > halfway).length).toBeGreaterThanOrEqual(2)
    expect(pitch.join('').split('•')).toHaveLength(2)
  })
})

describe('logMatchTrackerBanner', () => {
  it('prints once, however many times it is called', async () => {
    const { logMatchTrackerBanner } = await load()
    logMatchTrackerBanner()
    logMatchTrackerBanner()
    logMatchTrackerBanner()
    expect(log).toHaveBeenCalledOnce()
  })

  it('prints the art, styled, with as many styles as %c segments', async () => {
    const { logMatchTrackerBanner, matchTrackerBanner } = await load()
    logMatchTrackerBanner()
    const [format, ...styles] = log.mock.calls[0] as [string, ...string[]]
    expect(format.match(/%c/g)).toHaveLength(styles.length)
    expect(format.replaceAll('%c', '')).toBe(matchTrackerBanner())
    expect(styles.every((style) => typeof style === 'string' && style.length > 0)).toBe(true)
    // The teams in their colours, and a bold version line.
    expect(styles).toContain('color:#e51a1a;font-weight:bold')
    expect(styles).toContain('color:#184fe7;font-weight:bold')
    expect(styles.at(-1)).toContain('font-weight:bold')
    expect(format.slice(format.lastIndexOf('%c'))).toContain(`v${pkg.version}`)
  })

  it('does nothing without a console, and prints once one is there', async () => {
    const { logMatchTrackerBanner } = await load()
    vi.stubGlobal('console', undefined)
    expect(() => logMatchTrackerBanner()).not.toThrow()
    vi.unstubAllGlobals()
    expect(log).not.toHaveBeenCalled()
    logMatchTrackerBanner()
    expect(log).toHaveBeenCalledOnce()
  })

  it('does nothing without a document, as when rendered on a server', async () => {
    const { logMatchTrackerBanner } = await load()
    vi.stubGlobal('document', undefined)
    logMatchTrackerBanner()
    expect(log).not.toHaveBeenCalled()
  })

  it('is the one the main entry and /vue export', async () => {
    vi.resetModules()
    const main = await import('../src/index')
    const vue = await import('../src/vue')
    expect(vue.logMatchTrackerBanner).toBe(main.logMatchTrackerBanner)
    expect(vue.matchTrackerBanner).toBe(main.matchTrackerBanner)
  })
})

describe('the /banner entry', () => {
  it('prints once, however many times it is called', async () => {
    vi.resetModules()
    const entry = await import('../src/banner')
    entry.logMatchTrackerBanner()
    entry.logMatchTrackerBanner()
    expect(log).toHaveBeenCalledOnce()
  })

  it('prints once on a page that loads the banner entry and the main entry', async () => {
    vi.resetModules()
    const entry = await import('../src/banner')
    const main = await import('../src/index')
    entry.logMatchTrackerBanner()
    main.logMatchTrackerBanner()
    entry.logMatchTrackerBanner()
    expect(log).toHaveBeenCalledOnce()
  })

  it('prints once on a page that loads the main entry, /vue and the banner entry, in any order', async () => {
    vi.resetModules()
    const vue = await import('../src/vue')
    const entry = await import('../src/banner')
    const main = await import('../src/index')
    vue.logMatchTrackerBanner()
    main.logMatchTrackerBanner()
    entry.logMatchTrackerBanner()
    expect(log).toHaveBeenCalledOnce()
  })

  it('is the banner the main entry exports, so both read one guard', async () => {
    vi.resetModules()
    const entry = await import('../src/banner')
    const main = await import('../src/index')
    expect(main.logMatchTrackerBanner).toBe(entry.logMatchTrackerBanner)
    expect(main.matchTrackerBanner).toBe(entry.matchTrackerBanner)
  })

  it('imports only the version and the palette', async () => {
    const source = readFileSync(resolve(process.cwd(), 'src/banner.ts'), 'utf8')
    const imports = [...source.matchAll(/^import .* from '(.+)'$/gm)].map((match) => match[1])
    expect(imports.sort()).toEqual(['./palette.js', './version.js'])
  })
})
