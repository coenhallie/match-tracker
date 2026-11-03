import { describe, it, expect } from 'vitest'
import { HISTORY_S, windowAt } from '../../src/analysis/derive'
import { LiveHistory } from '../../src/history/liveHistory'
import { parseRecord } from '../../src/model/parseRecord'
import type { Frame, TrackerRecord } from '../../src/model/types'
import messages from '../fixtures/pipeline-messages.json'

const HZ = 25
const DT = 1 / HZ

function record(frameCount: number, t = 1000 + frameCount * DT): TrackerRecord {
  return { t, frameCount, frame: { teams: [], balls: [] } as unknown as Frame }
}

describe('LiveHistory', () => {
  it('is empty to begin with', () => {
    const history = new LiveHistory()
    expect(history.latest()).toBeNull()
    expect(history.window()).toEqual([])
  })

  it('holds a frameCount once, however often it is sent', () => {
    const message = messages[0]
    const history = new LiveHistory()
    const results = Array.from({ length: 9 }, () => history.add(parseRecord(message)!))
    expect(results).toEqual([true, ...Array<boolean>(8).fill(false)])
    expect(history.window()).toHaveLength(1)
    expect(history.window()[0]?.frameCount).toBe(55149)
  })

  it('holds the three fixture messages that share a frame once', () => {
    const records = messages.slice(0, 3).map((m) => parseRecord(m)!)
    expect(new Set(records.map((r) => r.frameCount)).size).toBe(1)
    const history = new LiveHistory()
    expect(records.map((r) => history.add(r))).toEqual([true, false, false])
  })

  it('keeps the first copy of a frameCount', () => {
    const first = record(1)
    const history = new LiveHistory()
    history.add(first)
    history.add({ ...record(1), t: first.t + 0.001 })
    expect(history.latest()).toBe(first)
  })

  it('stays bounded over 90 minutes at 25 Hz', () => {
    const history = new LiveHistory()
    const bound = Math.ceil(HISTORY_S * HZ) + 1
    let most = 0
    for (let i = 0; i < 90 * 60 * HZ; i++) {
      history.add(record(i))
      most = Math.max(most, history.window().length)
    }
    expect(most).toBeLessThanOrEqual(bound)
    expect(history.window().length).toBeGreaterThan(bound - 3)
    expect(history.latest()?.frameCount).toBe(90 * 60 * HZ - 1)
  })

  it('never holds a record older than the newest minus HISTORY_S', () => {
    const history = new LiveHistory()
    const newest = record(10_000)
    history.add(record(0))
    history.add(newest)
    expect(history.window().map((r) => r.frameCount)).toEqual([10_000])
    expect(history.add(record(2, newest.t - HISTORY_S))).toBe(true)
    expect(history.window().map((r) => r.frameCount)).toEqual([2, 10_000])
  })

  it('takes a jump back of more than HISTORY_S as a new stream: it starts afresh from that record', () => {
    const history = new LiveHistory()
    for (let i = 0; i < 50; i++) history.add(record(i, 2700 + i * DT))
    expect(history.breaks).toBe(0)
    // The pipeline restarted with the socket open: its stream-relative t starts again near 0.
    const restart = record(7, 0.04)
    expect(history.add(restart)).toBe(true)
    expect(history.breaks).toBe(1)
    expect(history.latest()).toBe(restart)
    expect(history.window()).toEqual([restart])
    // It goes on from there, frame counts the old stream held included.
    for (let i = 8; i < 20; i++) expect(history.add(record(i, 0.04 + (i - 7) * DT))).toBe(true)
    expect(history.latest()?.frameCount).toBe(19)
    expect(history.window()).toHaveLength(13)
    expect(history.breaks).toBe(1)
  })

  it('takes a record from just over HISTORY_S back as a new stream too, not as one to drop', () => {
    const history = new LiveHistory()
    const newest = record(10_000)
    history.add(newest)
    const old = record(1, newest.t - HISTORY_S - 0.001)
    expect(history.add(old)).toBe(true)
    expect(history.breaks).toBe(1)
    expect(history.latest()).toBe(old)
  })

  it('never freezes after a jump forward: what follows is a new stream, and is held', () => {
    const history = new LiveHistory()
    for (let i = 0; i < 10; i++) history.add(record(i))
    // A corrupt t far ahead: everything after it looks far in the past.
    const far = record(10, 1e300)
    expect(history.add(far)).toBe(true)
    expect(history.window()).toEqual([far])
    expect(history.add(record(11))).toBe(true)
    expect(history.latest()?.frameCount).toBe(11)
    expect(history.breaks).toBe(1)
    expect(history.add(record(12))).toBe(true)
    expect(history.window().map((r) => r.frameCount)).toEqual([11, 12])
  })

  it('holds nothing with a t that is not finite', () => {
    const history = new LiveHistory()
    history.add(record(1))
    for (const t of [Infinity, -Infinity, NaN]) expect(history.add(record(2, t))).toBe(false)
    expect(history.latest()?.frameCount).toBe(1)
    expect(history.add(record(2))).toBe(true)
  })

  it('inserts an out-of-order record in order, without making it the latest', () => {
    const history = new LiveHistory()
    const [r0, r1, r2, r3] = [record(0), record(1), record(2), record(3)] as [
      TrackerRecord,
      TrackerRecord,
      TrackerRecord,
      TrackerRecord,
    ]
    for (const r of [r0, r1, r3]) history.add(r)
    expect(history.add(r2)).toBe(true)
    expect(history.latest()).toBe(r3)
    expect(history.window()).toEqual([r0, r1, r2, r3])
  })

  it('makes a record sharing the latest t the latest, and puts the old latest after it in the window', () => {
    const history = new LiveHistory()
    const a = record(1)
    const b = { ...record(2), t: a.t }
    history.add(a)
    history.add(b)
    expect(history.latest()).toBe(b)
    expect(history.window()).toEqual(windowAt([a, b], b))
    expect(history.window().map((r) => r.frameCount)).toEqual([2, 1])
  })

  it('gives the window windowAt gives over the records as they arrived', () => {
    const arrived = [record(0), record(1), record(3), record(2), record(4)]
    const history = new LiveHistory()
    for (const r of arrived) history.add(r)
    expect(history.window()).toEqual(windowAt(arrived, history.latest()!))
  })

  it('is emptied by clear()', () => {
    const history = new LiveHistory()
    history.add(record(1))
    history.clear()
    expect(history.latest()).toBeNull()
    expect(history.window()).toEqual([])
    expect(history.add(record(1))).toBe(true)
  })
})
