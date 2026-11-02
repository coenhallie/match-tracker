import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
import { deriveAt, windowAt } from '../../src/analysis/derive'
import { LiveHistory } from '../../src/history/liveHistory'
import { parseRecord } from '../../src/model/parseRecord'
import type { TrackerRecord } from '../../src/model/types'

const text = gunzipSync(readFileSync(resolve(process.cwd(), 'test/fixtures/excerpt.jsonl.gz'))).toString('utf8')
const all: TrackerRecord[] = text
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => {
    const record = parseRecord(line)
    if (!record) throw new Error('excerpt line parseRecord rejects')
    return record
  })

describe('the excerpt', () => {
  it('holds the records the tests below depend on', () => {
    expect(all).toHaveLength(893)
    // Time never runs backwards, no frameCount repeats, and 26 records share the t of the one before.
    expect(all.filter((r, i) => i > 0 && all[i - 1]!.t > r.t)).toHaveLength(0)
    expect(new Set(all.map((r) => r.frameCount)).size).toBe(all.length)
    expect(all.filter((r, i) => i > 0 && all[i - 1]!.t === r.t)).toHaveLength(26)
  })
})

describe('LiveHistory against the replay window', () => {
  it('derives the same at every record, one by one', () => {
    const history = new LiveHistory()
    for (const [i, r] of all.entries()) {
      expect(history.add(r)).toBe(true)
      const latest = history.latest()!
      expect(latest).toBe(r)
      expect(history.window()).toEqual(windowAt(all.slice(0, i + 1), r))
      expect(deriveAt(history.window(), latest)).toEqual(deriveAt(windowAt(all, r), r))
    }
  })

  it('derives the same at the end of every burst of 20', () => {
    const history = new LiveHistory()
    for (let i = 0; i < all.length; i += 20) {
      const burst = all.slice(i, i + 20)
      for (const r of burst) history.add(r)
      const last = burst.at(-1)!
      const latest = history.latest()!
      expect(latest).toBe(last)
      expect(history.window()).toEqual(windowAt(all.slice(0, i + burst.length), last))
      expect(deriveAt(history.window(), latest)).toEqual(deriveAt(windowAt(all, last), last))
    }
  })

  it('derives the same when a burst is read back after every message in it', () => {
    const history = new LiveHistory()
    for (let i = 0; i < all.length; i += 20) {
      for (const r of all.slice(i, i + 20)) {
        history.add(r)
        expect(deriveAt(history.window(), history.latest()!)).toEqual(deriveAt(windowAt(all, r), r))
      }
    }
  })
})
