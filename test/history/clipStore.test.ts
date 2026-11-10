import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, it, expect, beforeEach } from 'vitest'
import { HISTORY_S, deriveAt, windowAt } from '../../src/analysis/derive'
import {
  CLIP_CAP,
  CLIP_EXPIRY_S,
  CLIP_LEAD_S,
  CLIP_TAIL_S,
  ClipStore,
  slimRecord,
} from '../../src/history/clipStore'
import type { FlashbackKind } from '../../src/model/flashback'
import { parseRecord } from '../../src/model/parseRecord'
import type { RecordValidity, TrackerRecord } from '../../src/model/types'
import { createRenderer } from '../../src/render/renderer'
import { fakeCanvas, stubOffscreenCanvas } from '../helpers/recordingCtx'

const fixture = (name: string): TrackerRecord[] =>
  gunzipSync(readFileSync(resolve(process.cwd(), 'test/fixtures', name)))
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const record = parseRecord(line)
      if (!record) throw new Error(`${name} line parseRecord rejects`)
      return record
    })

const staging = fixture('staging-validity.jsonl.gz')
const HZ = 25
const valid: RecordValidity = { invalid: false, nextInvalidInS: null, nextValidInS: 0 }
const invalid = (nextValidInS: number | null): RecordValidity => ({ invalid: true, nextInvalidInS: 0, nextValidInS })

let frameCount = 0
/** A real staging frame, put at time `t`, with a fresh frame number. */
function rec(t: number, validity?: RecordValidity): TrackerRecord {
  const source = staging[Math.round(t * HZ) % staging.length]!
  const record: TrackerRecord = { t, frameCount: frameCount++, frame: source.frame }
  if (validity) record.validity = validity
  return record
}

/** Feed records from `from` to `to` at 25 Hz, each with `validity(t)`. */
function feed(store: ClipStore, from: number, to: number, validity?: (t: number) => RecordValidity | undefined) {
  for (let i = 0; from + i / HZ <= to + 1e-9; i++) {
    const t = from + i / HZ
    store.add(rec(t, validity?.(t)))
  }
}

/** Add the record at `at`, then note the moment, as the widget does. */
function moment(store: ClipStore, kind: FlashbackKind, at: number) {
  const record = rec(at)
  store.add(record)
  store.note({ kind, at, frameCount: record.frameCount })
}

let store: ClipStore
beforeEach(() => {
  store = new ClipStore()
  frameCount = 0
})

describe('slimRecord', () => {
  it('slims a record without changing what is drawn', () => {
    const stubs = stubOffscreenCanvas()
    try {
      for (const record of staging.slice(100, 150)) {
        const full = fakeCanvas()
        createRenderer(full.canvas).renderFrame(record.frame)
        const slim = fakeCanvas()
        createRenderer(slim.canvas).renderFrame(slimRecord(record).frame)
        expect(slim.ops).toEqual(full.ops)
      }
    } finally {
      stubs.restore()
    }
  })

  it('keeps what is read and leaves out the rest', () => {
    const slim = slimRecord(staging[400]!)
    expect(slim.t).toBe(staging[400]!.t)
    expect(slim.frameCount).toBe(staging[400]!.frameCount)
    const player = slim.frame.teams[0]!.players[0]!
    expect(Object.keys(player).sort()).toEqual(['person_type', 'player_number', 'projected_coordinates', 'track_id'])
    const carrier = staging.flatMap((r) => r.frame.teams.flatMap((t) => t.players)).find((p) => p.in_possession)!
    expect(slimRecord({ t: 0, frameCount: 0, frame: { teams: [{ team_id: 0, players: [carrier] }] } }).frame.teams[0]!.players[0]!.in_possession).toBe(true)
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(staging[400]).length)
  })
})

describe('ClipStore', () => {
  it('makes a clip from 8 s before to 4 s after, ready once the after part is in', () => {
    feed(store, 80, 100)
    moment(store, 'goal', 100.04)
    const [clip] = store.clips()
    expect(clip).toMatchObject({ kind: 'goal', at: 100.04, from: 100.04 - CLIP_LEAD_S, ready: false })
    expect(store.next()).toBeNull()
    feed(store, 100.08, 103.9)
    expect(store.next()).toBeNull()
    feed(store, 103.92, 104.2)
    expect(store.next()).toMatchObject({ id: clip!.id, ready: true, to: 100.04 + CLIP_TAIL_S })
    const times = store.records(clip!.id).map((r) => r.t)
    expect(times[0]).toBeGreaterThanOrEqual(clip!.from - HISTORY_S)
    expect(times[0]).toBeLessThan(clip!.from - HISTORY_S + 0.1)
    expect(Math.max(...times)).toBeLessThanOrEqual(clip!.to)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('starts the clip at its first record when the stream began within the lead', () => {
    feed(store, 100, 102.96, () => valid)
    moment(store, 'goal', 103)
    expect(store.clips()[0]!.from).toBe(100)
  })

  it('starts the clip after invalid records before the moment, and ends it at the first invalid one after', () => {
    feed(store, 80, 94.96)
    feed(store, 95, 97, () => invalid(null))
    feed(store, 97.04, 100, () => valid)
    moment(store, 'shot', 100.04)
    const clip = store.clips()[0]!
    expect(clip.from).toBeCloseTo(97.04, 6)
    feed(store, 100.08, 101.96, () => valid)
    feed(store, 102, 104, () => invalid(null))
    const ready = store.next()!
    expect(ready.ready).toBe(true)
    expect(ready.to).toBeCloseTo(101.96, 6)
    const times = store.records(ready.id).map((r) => r.t)
    expect(times.some((t) => t >= 95 && t <= 97)).toBe(false)
  })

  it('keeps no record a carried validity calls invalid', () => {
    feed(store, 10, 10.96)
    store.add(rec(11, invalid(3)))
    const before = store.bytes()
    feed(store, 11.04, 12.96)
    expect(store.bytes()).toBe(before)
    // The countdown runs out at 14, and the state then carried is valid.
    feed(store, 13, 14.96)
    expect(store.bytes()).toBeGreaterThan(before)
  })

  it('keeps the more important of two moments in one window', () => {
    feed(store, 90, 99.96)
    moment(store, 'attack', 100)
    feed(store, 100.04, 102.96)
    moment(store, 'goal', 103)
    expect(store.clips().map((c) => c.kind)).toEqual(['goal'])

    const other = new ClipStore()
    for (let t = 90; t < 99.99; t += 1 / HZ) other.add(rec(t))
    const goal = rec(100)
    other.add(goal)
    other.note({ kind: 'goal', at: 100, frameCount: goal.frameCount })
    feed(other, 100.04, 102.96)
    const attack = rec(103)
    other.add(attack)
    other.note({ kind: 'attack', at: 103, frameCount: attack.frameCount })
    expect(other.clips().map((c) => c.kind)).toEqual(['goal'])
  })

  it('keeps the earlier of two moments of one kind in one window', () => {
    feed(store, 90, 99.96)
    moment(store, 'shot', 100)
    feed(store, 100.04, 101.96)
    moment(store, 'shot', 102)
    expect(store.clips().map((c) => c.at)).toEqual([100])
  })

  it('keeps 8 clips, dropping the least important then the oldest', () => {
    const kinds: FlashbackKind[] = ['attack', 'attack', 'shot', 'goal', 'corner', 'attack', 'shot', 'goal']
    kinds.forEach((kind, i) => {
      feed(store, 100 + i * 20 + 0.04, 100 + i * 20 + 19.96)
      moment(store, kind, 100 + (i + 1) * 20)
    })
    expect(store.clips()).toHaveLength(CLIP_CAP)
    moment(store, 'goal', 400)
    expect(store.clips()).toHaveLength(CLIP_CAP)
    const attacks = () => store.clips().filter((c) => c.kind === 'attack').map((c) => c.at)
    // The least important goes, and of those the oldest.
    expect(attacks()).toEqual([140, 220])
    feed(store, 400.04, 419.96)
    moment(store, 'attack', 420)
    expect(attacks()).toEqual([220, 420])
    feed(store, 420.04, 439.96)
    moment(store, 'goal', 440)
    expect(attacks()).toEqual([420])
    expect(store.clips()).toHaveLength(CLIP_CAP)
  })

  it('drops a clip 900 s after its moment', () => {
    feed(store, 90, 99.96)
    moment(store, 'goal', 100)
    feed(store, 100.04, 105)
    expect(store.clips()).toHaveLength(1)
    store.add(rec(100 + CLIP_EXPIRY_S))
    expect(store.clips()).toHaveLength(1)
    store.add(rec(100 + CLIP_EXPIRY_S + 0.04))
    expect(store.clips()).toHaveLength(0)
  })

  it('keeps clips over a forward gap, drops them all when the stream restarts', () => {
    feed(store, 90, 99.96)
    moment(store, 'goal', 100)
    feed(store, 100.04, 105)
    store.add(rec(300))
    expect(store.clips()).toHaveLength(1)
    expect(store.records(store.clips()[0]!.id).length).toBeGreaterThan(0)
    store.add(rec(300 - HISTORY_S - 1))
    expect(store.clips()).toHaveLength(0)
    expect(store.bytes()).toBeGreaterThan(0)
    expect(store.bytes()).toBeLessThan(10_000)
  })

  it('takes a clip once: next never gives it again', () => {
    feed(store, 90, 99.96)
    moment(store, 'goal', 100)
    feed(store, 100.04, 105)
    const clip = store.next()!
    store.take(clip.id)
    expect(store.next()).toBeNull()
    expect(store.records(clip.id)).toEqual([])
  })

  it('gives the most important ready clip, the newest of its kind', () => {
    feed(store, 90, 99.96)
    moment(store, 'attack', 100)
    feed(store, 100.04, 119.96)
    moment(store, 'shot', 120)
    feed(store, 120.04, 139.96)
    moment(store, 'shot', 140)
    feed(store, 140.04, 159.96)
    moment(store, 'corner', 160)
    // The corner is not ready yet.
    expect(store.next()).toMatchObject({ kind: 'shot', at: 140 })
    feed(store, 160.04, 165)
    expect(store.next()).toMatchObject({ kind: 'corner', at: 160 })
  })

  it('stays under 20 MB at its cap', () => {
    // The worst case: 8 clips that do not overlap, each with a lookback of its own, 30 s apart, all
    // left unplayed through a long stretch of valid play after the last.
    const gap = 30
    let peak = 0
    const watch = (from: number, to: number) => {
      for (let i = 0; from + i / HZ <= to + 1e-9; i++) {
        store.add(rec(from + i / HZ))
        peak = Math.max(peak, store.bytes())
      }
    }
    for (let i = 0; i < CLIP_CAP; i++) {
      const at = 100 + i * gap
      watch(i === 0 ? 80 : at - gap + 0.04, at - 0.04)
      moment(store, 'goal', at)
      peak = Math.max(peak, store.bytes())
    }
    watch(100 + 7 * gap + 0.04, 100 + 7 * gap + 60)
    expect(store.clips()).toHaveLength(CLIP_CAP)
    expect(store.clips().every((c) => c.ready)).toBe(true)
    expect(peak).toBeLessThan(20_000_000)
  })

  it('thins lookback records without changing phase or trail', () => {
    // The staging capture is valid again from about t 1589; take real consecutive records.
    const live = staging.filter((r) => r.t >= 1590)
    const slim = live.map(slimRecord)
    const moment0 = live.find((r) => r.t >= 1630)!
    for (const r of live) {
      store.add(r)
      if (r === moment0) store.note({ kind: 'goal', at: r.t, frameCount: r.frameCount })
    }
    const clip = store.next()!
    expect(clip).not.toBeNull()
    const stored = store.records(clip.id)
    const lookback = stored.filter((r) => r.t < clip.from)
    expect(lookback.length).toBeGreaterThan(50)
    const fullSize = (r: TrackerRecord) => JSON.stringify(slim.find((x) => x.frameCount === r.frameCount)).length
    expect(lookback.every((r) => JSON.stringify(r).length < fullSize(r) / 2)).toBe(true)
    const shown = stored.filter((r) => r.t >= clip.from)
    expect(shown.length).toBeGreaterThan(30)
    for (const r of shown) {
      const fullWindow = slim.filter((x) => x.t >= clip.from - HISTORY_S && x.t <= clip.to)
      const full = slim.find((x) => x.frameCount === r.frameCount)!
      expect(deriveAt(windowAt(stored, r), r)).toEqual(deriveAt(windowAt(fullWindow, full), full))
    }
  })

  it("frees an expired clip's records at once", () => {
    feed(store, 90, 99.96)
    moment(store, 'goal', 100)
    feed(store, 100.04, 105)
    store.add(rec(999.9))
    expect(store.clips()).toHaveLength(1)
    store.add(rec(1000.2))
    expect(store.clips()).toHaveLength(0)
    expect(store.bytes()).toBeLessThan(3 * 6_000)
  })

  it('keeps only the records kept clips and the next moment need', () => {
    feed(store, 90, 99.96)
    moment(store, 'goal', 100)
    feed(store, 100.04, 105)
    const during = store.bytes()
    store.take(store.next()!.id)
    feed(store, 105.04, 165)
    const perSecond = during / 15
    expect(store.bytes()).toBeLessThanOrEqual(perSecond * (CLIP_LEAD_S + HISTORY_S) * 1.15)
    expect(store.bytes()).toBeGreaterThan(0)
  })
})
