/**
 * The flashback controller: when the live camera is away, it plays an earlier clip of live play
 * in its place (on screen, "REPLAY").
 *
 * A clip starts when the newest live record is invalid with FLASHBACK_MIN_RUN_S or more of the
 * run to go, the layer is on, no live moment a human label started is showing, and the store has
 * a ready clip. The clip is taken from the store at once, so it is played once whatever happens
 * next, and fitted to the time the run has left (fitClip). It plays on its own clock, from
 * `nowMs`, so it goes on when the stream stalls. When it ends and the start rule still holds, the
 * next clip follows at once; otherwise live play shows again. A clip that runs out in a valid gap
 * under MERGE_GAP_S, or as its run is about to end (live records come a little late, and the clip
 * is fitted in record time but played on the wall clock), holds its last frame instead, until a
 * record that says its validity decides whether the next clip follows (`holds`): a split run is
 * one replay. It is cut off at once by a valid live record (unless an invalid one is due within
 * MERGE_GAP_S, as the attack cover rides such gaps), a live label moment, the layer going off, or
 * `cut()`. After a cut that holds off, which means someone wants the live frame (a press,
 * `trigger()`), nothing starts again until the run ends (a valid live record not in such a gap)
 * or `reset()`. After any other cut (a seek, a stream break, the layer going off) or a live label
 * moment, the next clip may start as soon as the start rule holds.
 *
 * A live record with no validity counts as the validity the last one that had it carries
 * (carriedValidity). A carried state that flipped is a guess with no horizon, so it can keep a
 * clip going but never start, chain or end one: a carried guess that the run ended leaves the
 * replay to the next record that says, for MERGE_GAP_S at most.
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
  /** The hold of a clip that has run out, or null while it plays. */
  hold: Hold | null
}

/** A clip that has run out holding its last frame (`Flashback.holds`). */
interface Hold {
  /** When it ends if no record has decided by then. */
  untilMs: number
  /** Whether a short valid gap has been seen: the invalid record after it decides. */
  gap: boolean
}

/** The time a run has left by `state`, or undefined when it may not start or chain a clip. */
function runLeft(state: RecordValidity | null): number | undefined {
  if (!state || !state.invalid) return undefined
  if (state.nextValidInS !== null) return state.nextValidInS
  return state.horizonS !== undefined ? Infinity : undefined
}

/** Whether `state` ends the invalid run: valid, and not a short gap before the next invalid one. */
function runEnded(state: RecordValidity | null): boolean {
  if (!state || state.invalid) return false
  return !(state.nextInvalidInS !== null && state.nextInvalidInS < MERGE_GAP_S)
}

/** Whether `state` is a short valid gap: valid, with the next invalid record due within MERGE_GAP_S. */
function inShortGap(state: RecordValidity | null): boolean {
  return state !== null && !state.invalid && !runEnded(state)
}

/** Whether `state` is invalid with its run about to end: a valid record due within MERGE_GAP_S. */
function runEnding(state: RecordValidity | null): boolean {
  return state !== null && state.invalid && state.nextValidInS !== null && state.nextValidInS < MERGE_GAP_S
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
  /** Set by a `cut()` that holds off: no clip starts until the live run ends. */
  private held = false
  /** What the newest live record says, or carries, as of the last step. */
  private state: RecordValidity | null = null
  /**
   * When the carried state flipped to valid as its countdown ran out, with no record saying so,
   * while it still has; null otherwise. Such a guess never ends a replay on its own.
   */
  private guessMs: number | null = null

  constructor(
    private readonly store: ClipStore,
    private readonly reducedMotion: () => boolean,
  ) {}

  /** Whether a clip is playing. */
  get active(): boolean {
    return this.playing !== null
  }

  /** What the newest live record says of the run, or carries, as of the last step: its countdown. */
  get run(): RecordValidity | null {
    return this.state
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
    this.state = state
    if (this.held && runEnded(state)) this.held = false
    const guess = newest !== null && !newest.validity && this.carried?.validity.invalid === true && !state?.invalid
    this.guessMs = guess ? (this.guessMs ?? nowMs) : null

    if (this.playing) {
      const ranOut = this.clock(nowMs) > this.playing.to + EPS
      if (this.cuts(nowMs, live)) this.end(nowMs, events)
      else if (ranOut && !this.start(nowMs, live, state, events) && !this.holds(nowMs, state)) {
        this.end(nowMs, events)
      }
    } else this.start(nowMs, live, state, events)

    this.alpha = this.alphaAt(nowMs)
    const shot = this.shot(nowMs)
    const named = this.playing?.clip ?? (this.alpha > 0 ? this.last : null)
    const agoS = named && this.newestT !== null ? this.newestT - named.at : null
    return { shot, alpha: this.alpha, agoS, events }
  }

  /**
   * End the clip playing at once. With `holdOff`, as when someone wants the live frame (a press,
   * `trigger()`), start none until the live run ends; without it (a seek, a stream break), the
   * next may start as soon as the start rule holds. Its `end` comes with the next step. With no
   * clip playing it does nothing.
   */
  cut(nowMs: number, holdOff: boolean): void {
    if (!this.playing) return
    this.end(nowMs, this.pending)
    if (holdOff) this.held = true
  }

  reset(): void {
    this.playing = null
    this.last = null
    this.carried = null
    this.newestT = null
    this.fade = { from: 0, atMs: 0, target: 0 }
    this.alpha = 0
    this.pending = []
    this.held = false
    this.state = null
    this.guessMs = null
    // `time` is kept: it only goes up.
  }

  /**
   * Whether a clip that has run out holds its last frame, the tab up, rather than end, so that
   * live play is not shown for a fraction of a second between two runs a short gap splits. It
   * holds when it ran out in a short valid gap, or while the newest record that said its validity
   * is invalid with its run about to end: the clip is fitted to the run in record time but plays on
   * the wall clock, so with live records a little late it runs out just before the gap. It holds
   * too on a carried guess that the run ended, until a record says (`cuts` bounds the guess).
   *
   * Only a record that says its validity decides, and one from before a guess decides nothing. The
   * run's own last records, still invalid and about to end, decide nothing until a valid one has
   * been seen. A valid record in a short gap
   * keeps it holding, and one outside such a gap ends it (`cuts`). An invalid record after the gap,
   * or one whose run is no longer about to end, decides: `start` has already chained on it if the
   * start rule holds, so here the replay ends.
   *
   * It holds on its own clock, so a stalled stream does not keep the frame up: from when the clip
   * ran out, for the run's countdown left then (under MERGE_GAP_S, and 0 in a gap) plus
   * MERGE_GAP_S.
   */
  private holds(nowMs: number, state: RecordValidity | null): boolean {
    const playing = this.playing!
    const stated = this.carried?.validity ?? null
    if (!playing.hold) {
      if (inShortGap(state)) playing.hold = { untilMs: nowMs + MERGE_GAP_S * 1000, gap: true }
      else if (runEnding(stated) || this.guessMs !== null) {
        // Carried on, the countdown may have run out: a guess that the run ended, with none left.
        const leftS = state?.invalid ? Math.min(Math.max(0, state.nextValidInS ?? 0), MERGE_GAP_S) : 0
        playing.hold = { untilMs: nowMs + (leftS + MERGE_GAP_S) * 1000, gap: false }
      } else return false
    }
    const { hold } = playing
    if (this.guessMs === null) {
      if (stated?.invalid) {
        if (hold.gap || !runEnding(stated)) return false
      } else if (stated) hold.gap = true
    }
    return nowMs < hold.untilMs
  }

  /**
   * Whether the clip playing is cut off now: by a live label moment, the layer going off, or a
   * record that says it is valid outside a short gap. A carried guess that the run ended never
   * cuts it on its own: the next record that says decides, and if none has by MERGE_GAP_S after
   * the guess, it ends then.
   */
  private cuts(nowMs: number, live: FlashbackLive): boolean {
    if (live.labelMoment || !live.layerOn) return true
    if (this.guessMs !== null && nowMs - this.guessMs >= MERGE_GAP_S * 1000) return true
    return runEnded(this.carried?.validity ?? null)
  }

  /** Start the next clip if the start rule holds. True when one started. */
  private start(nowMs: number, live: FlashbackLive, state: RecordValidity | null, events: FlashbackEvent[]): boolean {
    const left = runLeft(state)
    if (this.held || !live.layerOn || live.labelMoment) return false
    if (left === undefined || left < FLASHBACK_MIN_RUN_S) return false
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
    return {
      clip,
      records,
      event,
      from,
      to,
      first,
      shown: first,
      startMs: nowMs,
      base: this.time + SEEK_STEP_S,
      hold: null,
    }
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
    // A clip held through a short gap shows its last frame: the clock stops at its end.
    const clock = Math.min(this.clock(nowMs), playing.to)
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
