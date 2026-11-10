import { describe, it, expect, beforeEach } from 'vitest'
import {
  FIT_MIN_AFTER_S,
  FIT_MIN_BEFORE_S,
  FLASHBACK_MIN_RUN_S,
  Flashback,
  fitClip,
  type FlashbackFrame,
  type FlashbackLive,
} from '../../src/director/flashback'
import { MERGE_GAP_S } from '../../src/director/playerLoss'
import { ClipStore } from '../../src/history/clipStore'
import type { RecordValidity, TrackerRecord } from '../../src/model/types'
import { ATTACK_IN_MS, ATTACK_OUT_MS } from '../../src/render/attackIndicator'

const HZ = 25
const STEP_MS = 40
/** The lookahead's horizon as the staging stream sends it: never exactly 10. */
const HORIZON = 9.999999999990905

const valid = (nextInvalidInS: number | null = null): RecordValidity => ({ invalid: false, nextInvalidInS, nextValidInS: 0 })
const invalid = (nextValidInS: number | null, horizonS?: number): RecordValidity => {
  const v: RecordValidity = { invalid: true, nextInvalidInS: 0, nextValidInS }
  if (horizonS !== undefined) v.horizonS = horizonS
  return v
}
/** A run of 10 s or more: a null countdown with the horizon set. */
const longRun = (): RecordValidity => invalid(null, HORIZON)

let frameCount = 0
function rec(t: number, validity?: RecordValidity): TrackerRecord {
  const record: TrackerRecord = { t, frameCount: frameCount++, frame: { teams: [] } }
  if (validity) record.validity = validity
  return record
}

/**
 * A store holding a ready clip at each of `ats`: valid records at 25 Hz from 20 s before the first
 * to 5 s after the last, each moment noted on its record as the widget does.
 */
function storeWith(...ats: number[]): { store: ClipStore; frameOf: Map<number, number> } {
  const store = new ClipStore()
  const frameOf = new Map<number, number>()
  const first = Math.round((Math.min(...ats) - 20) * HZ)
  const last = Math.round((Math.max(...ats) + 5) * HZ)
  for (let k = first; k <= last; k++) {
    const t = k / HZ
    const record = rec(t, valid())
    store.add(record)
    if (ats.includes(t)) {
      store.note({ kind: 'attack', at: t, frameCount: record.frameCount })
      frameOf.set(t, record.frameCount)
    }
  }
  return { store, frameOf }
}

/** Steps the controller at 40 ms a step, as an animation frame does. */
class Driver {
  nowMs = 1000
  frames: FlashbackFrame[] = []
  constructor(readonly fb: Flashback) {}

  step(newest: TrackerRecord | null, live: Partial<Omit<FlashbackLive, 'newest'>> = {}): FlashbackFrame {
    this.nowMs += STEP_MS
    const frame = this.fb.step(this.nowMs, { newest, labelMoment: false, layerOn: true, ...live })
    this.frames.push(frame)
    return frame
  }

  /** Live records from `from` for `seconds`, one a step, each with `validity(t)`. */
  run(
    from: number,
    seconds: number,
    validity: (t: number, i: number) => RecordValidity | undefined,
    live: Partial<Omit<FlashbackLive, 'newest'>> = {},
  ): FlashbackFrame[] {
    const out: FlashbackFrame[] = []
    const n = Math.round((seconds * 1000) / STEP_MS)
    for (let i = 0; i < n; i++) {
      const t = from + (i * STEP_MS) / 1000
      out.push(this.step(rec(t, validity(t, i)), live))
    }
    return out
  }

  events(phase?: 'start' | 'end'): Array<{ phase: 'start' | 'end'; at: number }> {
    return this.frames.flatMap((f) => f.events).filter((e) => phase === undefined || e.phase === phase)
  }
}

let reduced = false
beforeEach(() => {
  frameCount = 0
  reduced = false
})
const make = (store: ClipStore): Driver => new Driver(new Flashback(store, () => reduced))

describe('fitClip', () => {
  it('keeps the clip whole when it fits or the time left is unknown', () => {
    expect(fitClip(8, 4, null)).toEqual({ beforeS: 8, afterS: 4 })
    expect(fitClip(8, 4, 12)).toEqual({ beforeS: 8, afterS: 4 })
    expect(fitClip(8, 4, Infinity)).toEqual({ beforeS: 8, afterS: 4 })
  })

  it('trims the before-part first, keeping 2 s after and 1 s before the moment', () => {
    const fit = fitClip(8, 4, 5.3)
    expect(fit.beforeS).toBeCloseTo(3.3, 9)
    expect(fit.afterS).toBeCloseTo(2, 9)
    expect(fitClip(8, 4, 3)).toEqual({ beforeS: FIT_MIN_BEFORE_S, afterS: FIT_MIN_AFTER_S })
    expect(fitClip(0.5, 4, 3)).toEqual({ beforeS: 0.5, afterS: 2.5 })
  })
})

describe('Flashback', () => {
  it('starts on an invalid record with 5 s or more to go, not under', () => {
    const d = make(storeWith(100).store)
    const under = d.step(rec(200, invalid(4.96)))
    expect(under.shot).toBeNull()
    expect(under.events).toEqual([])
    expect(d.fb.active).toBe(false)
    const at = d.step(rec(200.04, invalid(FLASHBACK_MIN_RUN_S)))
    expect(at.events).toEqual([{ phase: 'start', at: 100 }])
    expect(at.shot?.clip.at).toBe(100)
    expect(d.fb.active).toBe(true)
  })

  it('starts on a null countdown only with a horizon', () => {
    const d = make(storeWith(100).store)
    expect(d.step(rec(200, invalid(null))).events).toEqual([])
    expect(d.step(rec(200.04, invalid(null, HORIZON))).events).toEqual([{ phase: 'start', at: 100 }])
  })

  it('never starts on a carried guess', () => {
    const { store } = storeWith(100)
    const d = make(store)
    d.step(rec(200, { invalid: false, nextInvalidInS: 0.3, nextValidInS: 0, horizonS: 10 }))
    // The countdown runs out after 0.3 s: the carried state flips to invalid, with no horizon.
    d.run(200.04, 1, () => undefined)
    expect(d.events('start')).toEqual([])
    expect(d.frames.every((f) => f.shot === null)).toBe(true)
    expect(store.next()).not.toBeNull()
  })

  it('does not start without a ready clip, with the layer off, or while a live label moment shows', () => {
    // No clip at all.
    expect(make(new ClipStore()).step(rec(200, longRun())).events).toEqual([])
    // A clip the stream has not moved past yet is not ready.
    const notReady = new ClipStore()
    for (let k = 80 * HZ; k <= 102 * HZ; k++) {
      const record = rec(k / HZ, valid())
      notReady.add(record)
      if (k === 100 * HZ) notReady.note({ kind: 'attack', at: 100, frameCount: record.frameCount })
    }
    expect(notReady.clips()).toHaveLength(1)
    expect(make(notReady).step(rec(200, longRun())).events).toEqual([])

    const { store } = storeWith(100)
    const d = make(store)
    expect(d.step(rec(200, longRun()), { layerOn: false }).events).toEqual([])
    expect(d.step(rec(200.04, longRun()), { labelMoment: true }).events).toEqual([])
    expect(store.next()).not.toBeNull()
    expect(d.step(rec(200.08, longRun())).events).toEqual([{ phase: 'start', at: 100 }])
    expect(store.next()).toBeNull()
  })

  it('plays a 5.3 s run with its moment inside it', () => {
    const { store, frameOf } = storeWith(100)
    const d = make(store)
    const end = 205.3
    const frames = d.run(200, 6, (t) => (t < end - 1e-9 ? invalid(end - t) : valid()))
    const shots = frames.flatMap((f) => (f.shot ? [f.shot] : []))
    expect(shots.length).toBeGreaterThan(100)
    expect(shots[0]!.record.t).toBeCloseTo(96.7, 1)
    expect(shots[0]!.record.t).toBeGreaterThanOrEqual(96.7)
    expect(shots.at(-1)!.record.t).toBeCloseTo(102, 1)
    expect(shots.at(-1)!.record.t).toBeLessThanOrEqual(102)
    expect(shots.some((s) => s.record.frameCount === frameOf.get(100))).toBe(true)
    expect(shots.every((s) => s.event.frameCount === frameOf.get(100) && s.event.t === 100)).toBe(true)
    // The clip's records hold the lookback before it, for the phase and the trail.
    expect(shots[0]!.records[0]!.t).toBeLessThan(96.7)
    // The share of the clip left runs from 1 to 0.
    expect(shots[0]!.leftShare).toBe(1)
    expect(shots.at(-1)!.leftShare).toBeLessThan(0.02)
    for (let i = 1; i < shots.length; i++) expect(shots[i]!.leftShare).toBeLessThanOrEqual(shots[i - 1]!.leftShare)
    expect(d.events()).toEqual([
      { phase: 'start', at: 100 },
      { phase: 'end', at: 100 },
    ])
  })

  it('chains to the next unused clip while the run goes on', () => {
    const d = make(storeWith(100, 130).store)
    d.run(200, 30, () => longRun())
    expect(d.events()).toEqual([
      // The newest of a kind first.
      { phase: 'start', at: 130 },
      { phase: 'start', at: 100 },
      { phase: 'end', at: 100 },
    ])
    const starts = d.frames.flatMap((f, i) => (f.events.some((e) => e.phase === 'start') ? [i] : []))
    const end = d.frames.findIndex((f) => f.events.some((e) => e.phase === 'end'))
    const inSteps = Math.ceil(ATTACK_IN_MS / STEP_MS)
    for (let i = starts[0]! + inSteps; i <= end; i++) expect(d.frames[i]!.alpha).toBe(1)
    // The second clip is shown from its own first record on the step it starts.
    const second = d.frames[starts[1]!]!.shot!
    expect(second.clip.at).toBe(100)
    expect(second.record.t).toBeCloseTo(92, 9)
    expect(second.leftShare).toBe(1)
  })

  it('falls back to live when no clip is left', () => {
    const d = make(storeWith(100).store)
    d.run(200, 14, () => longRun())
    const end = d.frames.findIndex((f) => f.events.some((e) => e.phase === 'end'))
    expect(end).toBeGreaterThan(0)
    expect(d.events('end')).toHaveLength(1)
    expect(d.fb.active).toBe(false)
    const after = d.frames.slice(end)
    expect(after.every((f) => f.shot === null)).toBe(true)
    // It fades out over ATTACK_OUT_MS from the end, naming the clip while the tab still shows.
    const outSteps = ATTACK_OUT_MS / STEP_MS
    expect(after[0]!.alpha).toBe(1)
    for (let i = 1; i < outSteps; i++) {
      expect(after[i]!.alpha).toBeLessThan(after[i - 1]!.alpha)
      expect(after[i]!.alpha).toBeGreaterThan(0)
      expect(after[i]!.agoS).not.toBeNull()
    }
    expect(after[outSteps]!.alpha).toBe(0)
    expect(after[outSteps]!.agoS).toBeNull()
    expect(after.slice(outSteps).every((f) => f.alpha === 0 && f.agoS === null)).toBe(true)
    expect(d.fb.animating).toBe(false)
  })

  it('cuts on a valid record', () => {
    const d = make(storeWith(100).store)
    d.run(200, 2, () => longRun())
    expect(d.fb.active).toBe(true)
    const cut = d.step(rec(202, valid()))
    expect(cut.shot).toBeNull()
    expect(cut.events).toEqual([{ phase: 'end', at: 100 }])
    expect(d.fb.active).toBe(false)
  })

  it('cuts on a live label moment, the layer going off, or cut()', () => {
    const cases: Array<(d: Driver) => FlashbackFrame> = [
      (d) => d.step(rec(202, longRun()), { labelMoment: true }),
      (d) => d.step(rec(202, longRun()), { layerOn: false }),
      (d) => {
        d.fb.cut(d.nowMs)
        expect(d.fb.active).toBe(false)
        // Nothing to start in the next step, for the store has no clip left.
        return d.step(rec(202, longRun()))
      },
    ]
    for (const cutBy of cases) {
      const d = make(storeWith(100).store)
      d.run(200, 2, () => longRun())
      expect(d.fb.active).toBe(true)
      const frame = cutBy(d)
      expect(frame.shot).toBeNull()
      expect(frame.events).toEqual([{ phase: 'end', at: 100 }])
      expect(d.events('end')).toHaveLength(1)
    }
  })

  it('holds off after a cut until the run ends', () => {
    const { store } = storeWith(100, 130)
    const d = make(store)
    d.run(200, 2, () => longRun())
    d.fb.cut(d.nowMs)
    // The rest of the run: someone wants the live frame, so nothing starts, though a clip is ready.
    const rest = d.run(202, 5, () => longRun())
    expect(rest[0]!.events).toEqual([{ phase: 'end', at: 130 }])
    expect(rest.every((f) => f.shot === null)).toBe(true)
    expect(d.events('start')).toEqual([{ phase: 'start', at: 130 }])
    expect(store.next()?.at).toBe(100)
    // The run ends, and a new one of 5 s or more starts the next clip.
    d.step(rec(207, valid()))
    expect(d.step(rec(207.04, invalid(FLASHBACK_MIN_RUN_S))).events).toEqual([{ phase: 'start', at: 100 }])
  })

  it('a short valid gap does not end the hold-off', () => {
    const d = make(storeWith(100, 130).store)
    d.run(200, 2, () => longRun())
    d.fb.cut(d.nowMs)
    d.step(rec(202, valid(0.28)))
    d.run(202.04, 1, () => longRun())
    d.step(rec(203.04, valid(MERGE_GAP_S - 0.01)))
    d.run(203.08, 1, () => longRun())
    expect(d.events('start')).toHaveLength(1)
    // A valid record with 1.5 s or more to the next invalid one ends the run.
    d.step(rec(204.08, valid(MERGE_GAP_S)))
    expect(d.step(rec(204.12, longRun())).events).toEqual([{ phase: 'start', at: 100 }])
  })

  it('starts the next clip after a live label moment ends', () => {
    const d = make(storeWith(100, 130).store)
    d.run(200, 2, () => longRun())
    const moment = d.run(202, 2, () => longRun(), { labelMoment: true })
    expect(moment[0]!.events).toEqual([{ phase: 'end', at: 130 }])
    expect(moment.every((f) => f.shot === null)).toBe(true)
    // The moment is over and the run goes on: the next clip starts at once.
    expect(d.step(rec(204, longRun())).events).toEqual([{ phase: 'start', at: 100 }])
  })

  it('rides through a valid gap under 1.5 s', () => {
    const d = make(storeWith(100).store)
    d.run(200, 2, () => longRun())
    // A 0.28 s valid gap between two runs.
    const gap = d.step(rec(202, valid(0.28)))
    expect(gap.shot).not.toBeNull()
    expect(gap.events).toEqual([])
    d.run(202.04, 1, () => longRun())
    expect(d.fb.active).toBe(true)
    expect(d.step(rec(203.04, valid(MERGE_GAP_S - 0.01))).shot).not.toBeNull()
    const cut = d.step(rec(203.08, valid(MERGE_GAP_S)))
    expect(cut.shot).toBeNull()
    expect(cut.events).toEqual([{ phase: 'end', at: 100 }])
    expect(d.events('start')).toHaveLength(1)
  })

  it('rides through records with no validity', () => {
    const d = make(storeWith(100).store)
    const frames = d.run(200, 6, (_t, i) => (i % 7 === 3 ? undefined : longRun()))
    expect(frames.every((f) => f.shot !== null)).toBe(true)
    expect(d.events()).toEqual([{ phase: 'start', at: 100 }])
    const cut = d.step(rec(206, valid()))
    expect(cut.events).toEqual([{ phase: 'end', at: 100 }])
  })

  it('chains on a record with no validity, by the validity carried from the last that had it', () => {
    const d = make(storeWith(100, 130).store)
    d.run(200, 26, (_t, i) => (i === 0 ? longRun() : undefined))
    expect(d.events()).toEqual([
      { phase: 'start', at: 130 },
      { phase: 'start', at: 100 },
      { phase: 'end', at: 100 },
    ])
  })

  it('plays each clip once', () => {
    const { store } = storeWith(100, 130)
    const d = make(store)
    d.run(200, 2, () => longRun())
    expect(d.events('start')).toEqual([{ phase: 'start', at: 130 }])
    // The viewer presses the pitch, and the run then ends.
    d.fb.cut(d.nowMs)
    d.step(rec(202, valid()))
    expect(d.fb.active).toBe(false)
    d.run(202.04, 1, () => valid())
    // A new run plays the other clip, never the cut one.
    d.run(210, 2, () => longRun())
    expect(d.events('start')).toEqual([
      { phase: 'start', at: 130 },
      { phase: 'start', at: 100 },
    ])
    d.step(rec(212, valid()))
    // And a third has nothing left to play.
    d.run(220, 2, () => longRun())
    expect(d.events('start')).toHaveLength(2)
    expect(store.clips()).toHaveLength(0)
  })

  it('counts the timer from the moment in record time', () => {
    const d = make(storeWith(100).store)
    const newest = rec(250, longRun())
    const first = d.step(newest)
    expect(first.agoS).toBe(150)
    // The clock moves on, the stream does not: the timer stays.
    for (let i = 0; i < 10; i++) expect(d.step(newest).agoS).toBe(150)
    expect(d.fb.active).toBe(true)
    expect(d.step(rec(251.5, longRun())).agoS).toBe(151.5)
    // Before any clip, there is nothing to name.
    expect(make(new ClipStore()).step(rec(250, longRun())).agoS).toBeNull()
  })

  it('plays a clip on its own clock when the stream stalls', () => {
    const d = make(storeWith(100).store)
    const newest = rec(200, longRun())
    const shots = Array.from({ length: 50 }, () => d.step(newest).shot)
    expect(shots.every((s) => s !== null)).toBe(true)
    expect(shots.at(-1)!.record.t).toBeGreaterThan(shots[0]!.record.t + 1.9)
    expect(d.fb.animating).toBe(true)
  })

  it('keeps time going up across clips, with playback false on each first record', () => {
    const d = make(storeWith(100, 130).store)
    d.run(200, 26, () => longRun())
    const shots = d.frames.flatMap((f) => (f.shot ? [f.shot] : []))
    for (let i = 1; i < shots.length; i++) expect(shots[i]!.time).toBeGreaterThan(shots[i - 1]!.time)
    const firsts = shots.filter((s, i) => i === 0 || s.clip.id !== shots[i - 1]!.clip.id)
    expect(firsts).toHaveLength(2)
    for (const s of firsts) expect(s.playback).toBe(false)
    expect(shots.filter((s) => !s.playback)).toHaveLength(2)
  })

  it('fades in over ATTACK_IN_MS from the first clip', () => {
    const d = make(storeWith(100).store)
    const frames = d.run(200, 1, () => longRun())
    const inSteps = ATTACK_IN_MS / STEP_MS
    expect(frames[0]!.alpha).toBe(0)
    for (let i = 1; i < inSteps; i++) {
      expect(frames[i]!.alpha).toBeGreaterThan(frames[i - 1]!.alpha)
      expect(frames[i]!.alpha).toBeLessThan(1)
    }
    expect(frames[inSteps]!.alpha).toBe(1)
  })

  it('neither fades with reduced motion', () => {
    reduced = true
    const d = make(storeWith(100).store)
    const frames = d.run(200, 2, () => longRun())
    expect(frames.every((f) => f.alpha === 1)).toBe(true)
    const cut = d.step(rec(202, valid()))
    expect(cut.alpha).toBe(0)
    expect(cut.agoS).toBeNull()
    expect(d.fb.animating).toBe(false)
  })

  it('forgets everything on reset', () => {
    const { store } = storeWith(100, 130)
    const d = make(store)
    d.run(200, 2, () => longRun())
    d.fb.reset()
    expect(d.fb.active).toBe(false)
    expect(d.fb.animating).toBe(false)
    // A record with no validity after a reset says nothing: no carried state starts a clip.
    const frame = d.step(rec(202, undefined))
    expect(frame).toEqual({ shot: null, alpha: 0, agoS: null, events: [] })
  })

  it('ends the hold-off of a cut on reset', () => {
    const d = make(storeWith(100, 130).store)
    d.run(200, 2, () => longRun())
    d.fb.cut(d.nowMs)
    d.fb.reset()
    expect(d.step(rec(202, longRun())).events).toEqual([{ phase: 'start', at: 100 }])
  })
})
