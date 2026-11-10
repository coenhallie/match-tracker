/**
 * The flashback controller: when the live camera is away, it plays an earlier clip of live play
 * in its place (on screen, "REPLAY").
 *
 * A clip starts when the newest live record is invalid with FLASHBACK_MIN_RUN_S or more of the
 * run to go, the layer is on, no live moment a human label started is showing, and the store has
 * a ready clip. The clip is taken from the store at once, so it is played once whatever happens
 * next, and fitted to the time the run has left (fitClip). It plays on its own clock, from
 * `nowMs`, so it goes on when the stream stalls. When it ends and the start rule still holds, the
 * next clip follows at once; otherwise live play shows again. It is cut off at once by a valid
 * live record (unless an invalid one is due within MERGE_GAP_S, as the attack cover rides such
 * gaps), a live label moment, the layer going off, or `cut()`.
 *
 * A live record with no validity counts as the validity the last one that had it carries
 * (carriedValidity). A carried state that flipped is a guess with no horizon, so it can keep a
 * clip going but never start or chain one.
 *
 * It owns no DOM and draws nothing: `step` says what to show, and its caller paints it.
 */
import type { ClipStore } from '../history/clipStore.js'
import { carriedValidity, type CarriedValidity, type Clip } from '../model/flashback.js'
import type { RecordValidity, TrackerRecord } from '../model/types.js'
import { ATTACK_IN_MS, ATTACK_OUT_MS } from '../render/attackIndicator.js'
import { MERGE_GAP_S } from './playerLoss.js'

/** A clip starts, or follows another, only with this much of the run to go. */
export const FLASHBACK_MIN_RUN_S = 5
/** A fitted clip keeps at least this much after its moment... */
export const FIT_MIN_AFTER_S = 2
/** ...and at least this much before it, when the clip has it. */
export const FIT_MIN_BEFORE_S = 1

/** Record times are sums of floats: a record this close to a bound is on it. */
const EPS = 1e-9
/**
 * How far `time` moves at a clip's start at the least. The director reads `playback: false` (a
 * seek) only when its clock moves, so each clip's first record must move it.
 */
const SEEK_STEP_S = 0.001

/**
 * Fit a clip of `beforeS` before its moment and `afterS` after it into `leftS` seconds. The
 * before-part is trimmed first, keeping FIT_MIN_AFTER_S after the moment and FIT_MIN_BEFORE_S
 * before it; when even that does not fit, the end is cut too. Null (unknown, 10 s or more) keeps
 * it whole.
 */
export function fitClip(beforeS: number, afterS: number, leftS: number | null): { beforeS: number; afterS: number } {
  if (leftS === null || beforeS + afterS <= leftS) return { beforeS, afterS }
  let after = Math.min(afterS, Math.max(FIT_MIN_AFTER_S, leftS - beforeS))
  let before = Math.min(beforeS, Math.max(Math.min(beforeS, FIT_MIN_BEFORE_S), leftS - after))
  if (before + after > leftS) after = Math.max(0, leftS - before)
  return { beforeS: before, afterS: after }
}

/** What live play is doing, as of this animation frame. */
export interface FlashbackLive {
  /** The newest live record as pushed (`LiveHistory.latest()`). */
  newest: TrackerRecord | null
  /** Whether the live director is showing a moment a human label started. */
  labelMoment: boolean
  /** Whether the `flashback` layer is on. */
  layerOn: boolean
}

/** The clip to paint now. */
export interface FlashbackShot {
  clip: Clip
  /** The clip record to show now: the last at or before the clip's clock, within the fitted clip. */
  record: TrackerRecord
  /** All the clip's records, in time order, with the lookback before it for the phase and trail. */
  records: readonly TrackerRecord[]
  /** The clip's moment record. */
  event: TrackerRecord
  /** A clock in seconds that only goes up, across clips. */
  time: number
  /** False on each clip's first record: a seek. */
  playback: boolean
  /** The share of the fitted clip left, from 1 to 0. */
  leftShare: number
}

export interface FlashbackFrame {
  shot: FlashbackShot | null
  /** The stroke and tab's strength, 0 to 1. */
  alpha: number
  /** Seconds of record time since the named clip's moment, while there is a clip to name. */
  agoS: number | null
  events: ReadonlyArray<{ phase: 'start' | 'end'; at: number }>
}

type FlashbackEvent = FlashbackFrame['events'][number]

interface Playing {
  clip: Clip
  records: readonly TrackerRecord[]
  event: TrackerRecord
  /** The fitted clip's bounds, in record time. */
  from: number
  to: number
  /** The index of the first record shown, and of the one shown now. */
  first: number
  shown: number
  startMs: number
  /** `time` at the clip's start. */
  base: number
}

/** The time a run has left by `state`, or undefined when it may not start or chain a clip. */
function runLeft(state: RecordValidity | null): number | undefined {
  if (!state || !state.invalid) return undefined
  if (state.nextValidInS !== null) return state.nextValidInS
  return state.horizonS !== undefined ? Infinity : undefined
}

export class Flashback {
  private playing: Playing | null = null
  /** The last clip played, named while the tab fades out. */
  private last: Clip | null = null
  private carried: CarriedValidity | null = null
  private newestT: number | null = null
  private time = 0
  private fade: { from: number; atMs: number; target: 0 | 1 } = { from: 0, atMs: 0, target: 0 }
  private alpha = 0
  /** Events from `cut()`, given out by the next step. */
  private pending: FlashbackEvent[] = []

  constructor(
    private readonly store: ClipStore,
    private readonly reducedMotion: () => boolean,
  ) {}

  /** Whether a clip is playing. */
  get active(): boolean {
    return this.playing !== null
  }

  /** Whether the next animation frame has anything to show: a clip playing, a fade, an event. */
  get animating(): boolean {
    return this.playing !== null || this.alpha !== this.fade.target || this.pending.length > 0
  }

  step(nowMs: number, live: FlashbackLive): FlashbackFrame {
    const events = this.pending
    this.pending = []
    const { newest } = live
    if (newest) {
      this.newestT = newest.t
      if (newest.validity) this.carried = { t: newest.t, validity: newest.validity }
    }
    const state = newest ? (newest.validity ?? carriedValidity(this.carried, newest.t)) : null

    if (this.playing) {
      if (this.cuts(live, state)) this.end(nowMs, events)
      else if (this.clock(nowMs) > this.playing.to + EPS && !this.start(nowMs, live, state, events)) {
        this.end(nowMs, events)
      }
    } else this.start(nowMs, live, state, events)

    this.alpha = this.alphaAt(nowMs)
    const shot = this.shot(nowMs)
    const named = this.playing?.clip ?? (this.alpha > 0 ? this.last : null)
    const agoS = named && this.newestT !== null ? this.newestT - named.at : null
    return { shot, alpha: this.alpha, agoS, events }
  }

  /** End the clip playing at once, as when someone wants the live frame. Its `end` comes with the next step. */
  cut(nowMs: number): void {
    if (this.playing) this.end(nowMs, this.pending)
  }

  reset(): void {
    this.playing = null
    this.last = null
    this.carried = null
    this.newestT = null
    this.fade = { from: 0, atMs: 0, target: 0 }
    this.alpha = 0
    this.pending = []
    // `time` is kept: it only goes up.
  }

  private cuts(live: FlashbackLive, state: RecordValidity | null): boolean {
    if (live.labelMoment || !live.layerOn) return true
    if (!state || state.invalid) return false
    // A short valid gap before the next invalid run is ridden through.
    return !(state.nextInvalidInS !== null && state.nextInvalidInS < MERGE_GAP_S)
  }

  /** Start the next clip if the start rule holds. True when one started. */
  private start(nowMs: number, live: FlashbackLive, state: RecordValidity | null, events: FlashbackEvent[]): boolean {
    const left = runLeft(state)
    if (!live.layerOn || live.labelMoment || left === undefined || left < FLASHBACK_MIN_RUN_S) return false
    const chained = this.playing !== null
    for (let clip = this.store.next(); clip; clip = this.store.next()) {
      // The records first: taking the clip frees them.
      const records = this.store.records(clip.id)
      this.store.take(clip.id)
      const playing = this.begin(clip, records, left, nowMs)
      if (!playing) continue
      this.playing = playing
      this.last = clip
      events.push({ phase: 'start', at: clip.at })
      if (!chained) this.setTarget(1, nowMs)
      return true
    }
    return false
  }

  /** The clip fitted to `left`, or null when it has nothing to show. */
  private begin(clip: Clip, records: readonly TrackerRecord[], left: number, nowMs: number): Playing | null {
    const fit = fitClip(clip.at - clip.from, clip.to - clip.at, left)
    const from = clip.at - fit.beforeS
    const to = clip.at + fit.afterS
    const first = records.findIndex((r) => r.t >= from - EPS)
    const event = records.find((r) => r.frameCount === clip.frameCount)
    if (first < 0 || records[first]!.t > to + EPS || !event) return null
    return { clip, records, event, from, to, first, shown: first, startMs: nowMs, base: this.time + SEEK_STEP_S }
  }

  private end(nowMs: number, events: FlashbackEvent[]): void {
    const playing = this.playing
    if (!playing) return
    events.push({ phase: 'end', at: playing.clip.at })
    this.last = playing.clip
    this.playing = null
    this.setTarget(0, nowMs)
  }

  private clock(nowMs: number): number {
    const playing = this.playing!
    return playing.from + Math.max(0, nowMs - playing.startMs) / 1000
  }

  private shot(nowMs: number): FlashbackShot | null {
    const playing = this.playing
    if (!playing) return null
    const clock = this.clock(nowMs)
    const { records } = playing
    while (playing.shown + 1 < records.length && records[playing.shown + 1]!.t <= clock + EPS) playing.shown++
    this.time = Math.max(this.time, playing.base + (clock - playing.from))
    const span = playing.to - playing.from
    const leftShare = span > 0 ? Math.min(1, Math.max(0, (playing.to - clock) / span)) : 0
    return {
      clip: playing.clip,
      record: records[playing.shown]!,
      records,
      event: playing.event,
      time: this.time,
      playback: playing.shown !== playing.first,
      leftShare,
    }
  }

  private setTarget(target: 0 | 1, nowMs: number): void {
    if (this.fade.target === target) return
    this.fade = { from: this.alphaAt(nowMs), atMs: nowMs, target }
  }

  private alphaAt(nowMs: number): number {
    const { from, atMs, target } = this.fade
    if (this.reducedMotion()) return target
    const elapsed = Math.max(0, nowMs - atMs)
    return target === 1 ? Math.min(1, from + elapsed / ATTACK_IN_MS) : Math.max(0, from - elapsed / ATTACK_OUT_MS)
  }
}
