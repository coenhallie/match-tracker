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
import { LiveHistory } from '../../src/history/liveHistory'
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
    store.add(record, record.validity ?? null)
    if (ats.includes(t)) {
      store.note({ kind: 'attack', at: t, frameCount: record.frameCount })
      frameOf.set(t, record.frameCount)
    }
  }
  return { store, frameOf }
}

/**
 * Steps the controller at 40 ms a step, as an animation frame does, each live record taken in by
 * a live history first, as the widget does, which says what it stands for.
 */
class Driver {
  nowMs = 1000
  frames: FlashbackFrame[] = []
  readonly history = new LiveHistory()
  constructor(readonly fb: Flashback) {}

  step(newest: TrackerRecord | null, live: Partial<Omit<FlashbackLive, 'newest' | 'state'>> = {}): FlashbackFrame {
    this.nowMs += STEP_MS
    if (newest) this.history.add(newest)
    const state = newest && this.history.validityOf(newest)
    const frame = this.fb.step(this.nowMs, { newest, state, labelMoment: false, layerOn: true, ...live })
    this.frames.push(frame)
    return frame
  }

  /** Live records from `from` for `seconds`, one a step, each with `validity(t)`. */
  run(
    from: number,
    seconds: number,
    validity: (t: number, i: number) => RecordValidity | undefined,
    live: Partial<Omit<FlashbackLive, 'newest' | 'state'>> = {},
  ): FlashbackFrame[] {
    const out: FlashbackFrame[] = []
    const n = Math.round((seconds * 1000) / STEP_MS)
    for (let i = 0; i < n; i++) {
      const t = from + (i * STEP_MS) / 1000
      out.push(this.step(rec(t, validity(t, i)), live))
    }
    return out
  }

  /** Reset as the widget does: the controller, and the live history with it. */
  reset(): void {
    this.fb.reset()
    this.history.clear()
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
      notReady.add(record, record.validity ?? null)
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
        d.fb.cut(d.nowMs, true)
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
    d.fb.cut(d.nowMs, true)
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

  it('lets the next clip start after a cut that does not hold off', () => {
    const d = make(storeWith(100, 130).store)
    d.run(200, 2, () => longRun())
    // A seek, as the widget coming back into view: the clip on screen ends, and the next may start.
    d.fb.cut(d.nowMs, false)
    expect(d.fb.active).toBe(false)
    expect(d.step(rec(202, longRun())).events).toEqual([
      { phase: 'end', at: 130 },
      { phase: 'start', at: 100 },
    ])
  })

  it('a short valid gap does not end the hold-off', () => {
    const d = make(storeWith(100, 130).store)
    d.run(200, 2, () => longRun())
    d.fb.cut(d.nowMs, true)
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

  /** A run of `seconds` with an exact countdown from `from`, as the stream sends a run under 10 s. */
  const exactRun = (d: Driver, from: number, seconds: number) => d.run(from, seconds, (t) => invalid(from + seconds - t))
  /** A valid gap of `seconds` from `from`, its countdown to the next invalid record under MERGE_GAP_S. */
  const shortGap = (d: Driver, from: number, seconds: number) => d.run(from, seconds, (t) => valid(from + seconds - t))

  it('holds the last clip frame through a short valid gap, then chains', () => {
    const d = make(storeWith(100, 130).store)
    // A 6 s run: the first clip is fitted to end with it, at the gap.
    exactRun(d, 200, 6)
    const gap = shortGap(d, 206, 0.32)
    expect(d.events()).toEqual([{ phase: 'start', at: 130 }])
    // It ran out in the gap: its last frame stays, the tab up, the line run down.
    const held = gap.filter((f) => f.shot !== null && f.shot.leftShare === 0)
    expect(held.length).toBeGreaterThan(0)
    expect(gap.every((f) => f.shot !== null && f.alpha === 1 && f.shot.clip.at === 130)).toBe(true)
    expect(new Set(held.map((f) => f.shot!.record)).size).toBe(1)
    expect(held[0]!.shot!.record.t).toBeLessThanOrEqual(132 + 1e-9)
    expect(new Set(held.map((f) => f.shot!.time)).size).toBe(1)
    // The next run comes: the next clip follows, with no end between.
    const next = d.step(rec(206.32, longRun()))
    expect(next.events).toEqual([{ phase: 'start', at: 100 }])
    expect(next.shot?.clip.at).toBe(100)
    expect(next.shot?.playback).toBe(false)
    expect(d.events('end')).toEqual([])
  })

  it('ends a clip held through a short valid gap when the next run has nothing to chain', () => {
    const d = make(storeWith(100).store)
    exactRun(d, 200, 6)
    const gap = shortGap(d, 206, 0.32)
    expect(gap.every((f) => f.shot !== null && f.events.length === 0)).toBe(true)
    // The next run: no clip is left, so the replay ends on its first record.
    const next = d.step(rec(206.32, longRun()))
    expect(next.shot).toBeNull()
    expect(next.events).toEqual([{ phase: 'end', at: 100 }])
    expect(d.events()).toEqual([
      { phase: 'start', at: 100 },
      { phase: 'end', at: 100 },
    ])
  })

  it('ends a held clip at once on a valid record not in a short gap, or after MERGE_GAP_S with no invalid one', () => {
    // The gap turns out not to be short.
    const long = make(storeWith(100, 130).store)
    exactRun(long, 200, 6)
    shortGap(long, 206, 0.2)
    expect(long.fb.active).toBe(true)
    const cut = long.step(rec(206.2, valid(MERGE_GAP_S)))
    expect(cut.shot).toBeNull()
    expect(cut.events).toEqual([{ phase: 'end', at: 130 }])

    // The stream stalls in the gap: the hold ends on its own clock.
    const stall = make(storeWith(100, 130).store)
    exactRun(stall, 200, 6)
    const last = rec(206, valid(0.3))
    const frames = Array.from({ length: Math.ceil((MERGE_GAP_S * 1000) / STEP_MS) + 4 }, () => stall.step(last))
    const end = frames.findIndex((f) => f.events.some((e) => e.phase === 'end'))
    const holdFrom = frames.findIndex((f) => f.shot !== null && f.shot.leftShare === 0)
    expect(holdFrom).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(holdFrom)
    // The line may reach 0 a step before the clip runs out, on its last record.
    expect((end - holdFrom) * STEP_MS).toBeGreaterThanOrEqual(MERGE_GAP_S * 1000)
    expect((end - holdFrom) * STEP_MS).toBeLessThanOrEqual(MERGE_GAP_S * 1000 + 2 * STEP_MS)
    expect(stall.events('start')).toHaveLength(1)

    // Records with no validity in the gap neither chain nor end it: it waits for one that says.
    const quiet = make(storeWith(100, 130).store)
    exactRun(quiet, 200, 6)
    shortGap(quiet, 206, 0.12)
    // Carried on, the gap's countdown runs out: a guess of invalid, with no horizon.
    quiet.run(206.12, 0.6, () => undefined)
    expect(quiet.fb.active).toBe(true)
    expect(quiet.events()).toEqual([{ phase: 'start', at: 130 }])
    expect(quiet.step(rec(206.72, longRun())).events).toEqual([{ phase: 'start', at: 100 }])
  })

  /**
   * Steps the controller in animation frames of 16 ms from `startMs` to `untilMs`, giving it the
   * newest of `arrivals` that has come by each frame, as a socket's records come. The events, with
   * the frame they came on.
   */
  function deliver(
    fb: Flashback,
    arrivals: ReadonlyArray<{ atMs: number; record: TrackerRecord }>,
    startMs: number,
    untilMs: number,
  ): Array<{ nowMs: number; newest: TrackerRecord | null; frame: FlashbackFrame }> {
    const out: Array<{ nowMs: number; newest: TrackerRecord | null; frame: FlashbackFrame }> = []
    let next = 0
    let newest: TrackerRecord | null = null
    const history = new LiveHistory()
    for (let nowMs = startMs; nowMs <= untilMs; nowMs += 16) {
      while (next < arrivals.length && arrivals[next]!.atMs <= nowMs) {
        newest = arrivals[next++]!.record
        history.add(newest)
      }
      const state = newest && history.validityOf(newest)
      out.push({ nowMs, newest, frame: fb.step(nowMs, { newest, state, labelMoment: false, layerOn: true }) })
    }
    return out
  }

  /** Records at 10 Hz from `from`, each `validity(t)`, for `seconds`. */
  const tenHz = (from: number, seconds: number, validity: (t: number) => RecordValidity | undefined): TrackerRecord[] =>
    Array.from({ length: Math.round(seconds * 10) }, (_, k) => {
      const t = from + k / 10
      return rec(t, validity(t))
    })

  it('holds through a split run when the live records come slightly late', () => {
    const fb = new Flashback(storeWith(100, 130).store, () => reduced)
    // A 6 s run with its exact countdown, a 0.3 s valid gap, then a long run, at 10 Hz.
    const records = [
      ...tenHz(200, 6, (t) => invalid(206 - t)),
      ...tenHz(206, 0.3, (t) => valid(206.3 - t)),
      ...tenHz(206.3, 3, () => longRun()),
    ]
    // Each comes 0.5% slower than record time: the clip, fitted to the run on the wall clock, runs
    // out while the newest record is still the run's last invalid one.
    const arrivals = records.map((record) => ({ atMs: 1000 + (record.t - 200) * 1000 * 1.005, record }))
    const frames = deliver(fb, arrivals, 1000, arrivals.at(-1)!.atMs + 200)
    const events = frames.flatMap((f) => f.frame.events)
    expect(events).toEqual([
      { phase: 'start', at: 130 },
      { phase: 'start', at: 100 },
    ])
    // The clip did run out on the run's last invalid record, before the gap came.
    const held = frames.find((f) => f.frame.shot?.clip.at === 130 && f.frame.shot.leftShare === 0)
    expect(held?.newest?.validity?.invalid).toBe(true)
    // The second clip follows on the long run's first record.
    const chained = frames.find((f) => f.frame.events.length > 0 && f.frame.events[0]!.at === 100)!
    expect(chained.newest!.t).toBeCloseTo(206.3, 9)
    expect(frames.every((f) => f.frame.shot !== null)).toBe(true)
  })

  it('holds a clip that runs out as its run ends, bounded by the run left plus MERGE_GAP_S', () => {
    const d = make(storeWith(100, 130).store)
    // A 6 s run whose records stop 0.4 s before its end: the last says a valid record is due in 0.4 s.
    d.run(200, 5.64, (t) => invalid(206 - t))
    const last = d.frames.at(-1)!
    expect(last.shot?.clip.at).toBe(130)
    // The stream stalls on that record.
    const stalled = rec(205.6, invalid(0.4))
    const frames = Array.from({ length: Math.ceil(((0.4 + MERGE_GAP_S) * 1000) / STEP_MS) + 20 }, () => d.step(stalled))
    const holdFrom = frames.findIndex((f) => f.shot !== null && f.shot.leftShare === 0)
    const end = frames.findIndex((f) => f.events.some((e) => e.phase === 'end'))
    expect(holdFrom).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(holdFrom)
    expect(frames.slice(holdFrom, end).every((f) => f.shot !== null && f.alpha === 1)).toBe(true)
    // The line may reach 0 a step before the clip runs out, on its last record.
    expect((end - holdFrom) * STEP_MS).toBeGreaterThanOrEqual((0.4 + MERGE_GAP_S) * 1000)
    expect((end - holdFrom) * STEP_MS).toBeLessThanOrEqual((0.4 + MERGE_GAP_S) * 1000 + 2 * STEP_MS)
    expect(d.events()).toEqual([
      { phase: 'start', at: 130 },
      { phase: 'end', at: 130 },
    ])
  })

  it('a clip held as its run ends waits for a record that says, then ends or chains by it', () => {
    /** A 6 s run, its clip run out on the run's last record (countdown 0.04), held a few frames. */
    const ranOut = (...ats: number[]): Driver => {
      const d = make(storeWith(...ats).store)
      exactRun(d, 200, 6)
      const tail = rec(205.96, invalid(0.04))
      for (let k = 0; k < 4; k++) d.step(tail)
      expect(d.frames.at(-1)!.shot?.leftShare).toBe(0)
      expect(d.events()).toEqual([{ phase: 'start', at: ats.at(-1)! }])
      return d
    }

    // A record with no validity past the countdown, a guess that the run ended, decides nothing; the
    // long run then chains.
    const guess = ranOut(100, 130)
    guess.step(rec(206, undefined))
    expect(guess.fb.active).toBe(true)
    expect(guess.step(rec(206.04, longRun())).events).toEqual([{ phase: 'start', at: 100 }])
    expect(guess.events('end')).toEqual([])

    // The run's late tail records decide nothing either.
    const tail = ranOut(100, 130)
    tail.step(rec(205.98, invalid(0.02)))
    expect(tail.fb.active).toBe(true)
    expect(tail.events('end')).toEqual([])

    // A valid record not in a short gap ends it at once.
    const back = ranOut(100, 130)
    expect(back.step(rec(206, valid())).events).toEqual([{ phase: 'end', at: 130 }])

    // A short gap, then a run under 5 s: it ends on that run's first record.
    const short = ranOut(100, 130)
    shortGap(short, 206, 0.2)
    expect(short.fb.active).toBe(true)
    expect(short.step(rec(206.2, invalid(3))).events).toEqual([{ phase: 'end', at: 130 }])
    expect(short.events()).toEqual([
      { phase: 'start', at: 130 },
      { phase: 'end', at: 130 },
    ])

    // A run whose countdown goes back up, with no gap, under 5 s: the run is no longer ending, so it ends.
    const revised = ranOut(100, 130)
    expect(revised.step(rec(205.98, invalid(3))).events).toEqual([{ phase: 'end', at: 130 }])
  })

  it('holds a clip that runs out on a record with no validity just past its run', () => {
    const d = make(storeWith(100, 130).store)
    exactRun(d, 200, 6)
    // A frame late: the run's last record is still the newest as the clip reaches its end...
    const tail = 200 + 5.96
    d.step(rec(tail, invalid(206 - tail)))
    // ...and the gap's first says nothing: carried on, the run's countdown has run out, a guess
    // that it ended. The clip runs out on it, and holds.
    const guess = d.step(rec(206, undefined))
    expect(guess.events).toEqual([])
    expect(guess.shot?.leftShare).toBe(0)
    shortGap(d, 206.04, 0.28)
    expect(d.step(rec(206.32, longRun())).events).toEqual([{ phase: 'start', at: 100 }])
    expect(d.events()).toEqual([
      { phase: 'start', at: 130 },
      { phase: 'start', at: 100 },
    ])
  })

  it('a carried guess that the run ended does not end a replay: the next stated record does', () => {
    // On time: the clip reaches its end on the gap's first record, which says nothing.
    const gap = make(storeWith(100, 130).store)
    exactRun(gap, 200, 6)
    expect(gap.step(rec(206, undefined)).events).toEqual([])
    // A stated short gap: it holds, and the long run after it chains.
    shortGap(gap, 206.04, 0.28)
    gap.run(206.32, 1, () => longRun())
    expect(gap.events()).toEqual([
      { phase: 'start', at: 130 },
      { phase: 'start', at: 100 },
    ])

    // A stated valid record outside a short gap ends it, on that record and not before.
    const back = make(storeWith(100, 130).store)
    exactRun(back, 200, 6)
    const guessed = back.run(206, 0.4, () => undefined)
    expect(guessed.every((f) => f.shot !== null && f.events.length === 0)).toBe(true)
    expect(back.step(rec(206.4, valid())).events).toEqual([{ phase: 'end', at: 130 }])
    expect(back.events('end')).toHaveLength(1)
  })

  it('a replay on a carried guess that the run ended ends MERGE_GAP_S after the guess, if no record says', () => {
    const steps = Math.round((MERGE_GAP_S * 1000) / STEP_MS)
    // The clip still playing: a 10 s run, its countdown cut to 1 s, then records with no validity.
    const playing = make(storeWith(100).store)
    playing.step(rec(200, invalid(10)))
    playing.step(rec(201, invalid(1)))
    const flipped = playing.run(202, 3, () => undefined)
    expect(flipped.every((f) => f.shot === null || f.shot.leftShare > 0)).toBe(true)
    const end = flipped.findIndex((f) => f.events.length > 0)
    expect(flipped[end]!.events).toEqual([{ phase: 'end', at: 100 }])
    expect(end).toBeGreaterThanOrEqual(steps)
    expect(end).toBeLessThanOrEqual(steps + 1)

    // The clip run out: it holds its last frame for MERGE_GAP_S from the guess, then ends.
    const ranOut = make(storeWith(100, 130).store)
    exactRun(ranOut, 200, 6)
    const held = ranOut.run(206, 3, () => undefined)
    const heldEnd = held.findIndex((f) => f.events.length > 0)
    expect(held[heldEnd]!.events).toEqual([{ phase: 'end', at: 130 }])
    expect(heldEnd).toBeGreaterThanOrEqual(steps)
    expect(heldEnd).toBeLessThanOrEqual(steps + 1)
    expect(ranOut.events()).toEqual([
      { phase: 'start', at: 130 },
      { phase: 'end', at: 130 },
    ])
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
    // A 20 s run said at its start and 5 s in: when the first clip ends, 7 s after the stream last
    // said anything (within the HISTORY_S a word with no horizon reaches), 8 s of it are left.
    d.run(200, 26, (_t, i) => (i === 0 ? invalid(20) : i === 125 ? invalid(15) : undefined))
    expect(d.events()).toEqual([
      { phase: 'start', at: 130 },
      { phase: 'start', at: 100 },
      { phase: 'end', at: 100 },
    ])
  })

  it('chains no clip once a carried null countdown has aged past its horizon', () => {
    const { store } = storeWith(100, 130, 160, 190)
    const d = make(store)
    // 1 s of a run with no valid record due within the horizon, then 80 s of records with no validity.
    d.run(200, 1, () => longRun())
    d.run(201, 80, () => undefined)
    // The first clip plays out whole; by its end the promise is spent, so no other follows.
    expect(d.events()).toEqual([
      { phase: 'start', at: 190 },
      { phase: 'end', at: 190 },
    ])
    expect(store.clips()).toHaveLength(3)
  })

  it('plays each clip once', () => {
    const { store } = storeWith(100, 130)
    const d = make(store)
    d.run(200, 2, () => longRun())
    expect(d.events('start')).toEqual([{ phase: 'start', at: 130 }])
    // The viewer presses the pitch, and the run then ends.
    d.fb.cut(d.nowMs, true)
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
    d.reset()
    expect(d.fb.active).toBe(false)
    expect(d.fb.animating).toBe(false)
    // A record with no validity after a reset says nothing: no carried state starts a clip.
    const frame = d.step(rec(202, undefined))
    expect(frame).toEqual({ shot: null, alpha: 0, agoS: null, events: [] })
  })

  it('ends the hold-off of a cut on reset', () => {
    const d = make(storeWith(100, 130).store)
    d.run(200, 2, () => longRun())
    d.fb.cut(d.nowMs, true)
    d.reset()
    expect(d.step(rec(202, longRun())).events).toEqual([{ phase: 'start', at: 100 }])
  })
})
