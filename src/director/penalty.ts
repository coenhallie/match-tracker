/**
 * The penalty, the widget's own: video-annotation has none. Drawn by penalty.ts in render, which
 * has its look and timings.
 *
 * When playback runs into a record a human labelled "Penalty", its card comes up across the middle,
 * "PENALTY" over its icon and the team under it, fading in as a centre label card does
 * (LABEL_CARD_IN_MS), everyone and the ball faded out under it. It is on for PENALTY_CARD_MS; then
 * the scene, the goal, the keeper and the ball on the spot over a plain green, fades in on top of it
 * over PENALTY_SCENE_IN_MS, and waits for the kick. The card stays whole under the scene until the
 * scene is in, then goes: the renderer fades everyone out by the two together, so nobody shows
 * through as one hands over to the other.
 *
 * A "Penalty scored" or "Penalty missed" then plays the kick, PENALTY_KICK_MS; the result's banner
 * comes in over PENALTY_RESULT_IN_MS, holds PENALTY_HOLD_MS, and everything fades out together over
 * PENALTY_OUT_MS. A result that comes during the card waits for it and the scene's fade, then
 * kicks. A result with nothing showing (it came after the wait, or the widget joined after the
 * Penalty) brings the scene in with no card, and kicks once it is in, for the result's own team. So
 * does one that comes as a penalty with no result fades out, the scene coming in again from as
 * strongly as it was drawn. A second result is ignored; a second Penalty starts it again from the card, with its team and wait.
 * The team written is the Penalty's, whatever team its result gives.
 *
 * With no result PENALTY_WAIT_S of the clock after the Penalty's record, it leaves, from wherever
 * it is. The clock stands still while a live stream stalls, so it also leaves after twice that of
 * animation frames with no result, whatever the clock.
 *
 * Each label counts on the record it first comes on, as the goal's does. They are noted on every
 * record, but play only during playback, with the layer on, with no goal showing, and in a director
 * that plays it (`plays`: a flashback clip's never does). Anything that means someone wants the real
 * frame ends it at once, as it ends every moment. Under reduced motion nothing fades: the card whole,
 * then the scene whole, and a result shows the kick's last frame, the banner in, for PENALTY_HOLD_MS,
 * then goes.
 *
 * Played by hand (`play`), the penalty has no result to wait for: it leaves after LABEL_CARD_DEMO_MS
 * of waiting. A result by hand is one with nothing showing.
 */
import { penaltyLabels, type PenaltyResult } from '../analysis/penaltyLabels.js'
import type { Frame } from '../model/types.js'
import { LABEL_CARD_DEMO_MS, LABEL_CARD_IN_MS } from '../render/labelCard.js'
import {
  PENALTY_CARD_MS,
  PENALTY_HOLD_MS,
  PENALTY_KICK_MS,
  PENALTY_OUT_MS,
  PENALTY_RESULT_IN_MS,
  PENALTY_SCENE_IN_MS,
  PENALTY_WAIT_S,
  type PenaltyIndicator,
} from '../render/penalty.js'
import { teamWords, type Moment, type MomentContext, type MomentStep } from './moment.js'

export type PenaltyPhase = 'card' | 'waiting' | 'kick' | 'holding' | 'leaving'

interface Showing {
  /** The team taking it, as drawn, or null for none. */
  team: string | null
  /** Whether it opened on its card: false for a result that came with nothing showing. */
  card: boolean
  /**
   * How strongly it starts: 0, or how strongly the penalty it starts again from covered the pitch. The
   * card's, or with no card, the scene's.
   */
  fromIntensity: number
  /** The clock's time on the Penalty's record: what the wait for its result counts from. */
  penaltyAt: number
  result: PenaltyResult | null
  /** When the kick starts, in ms from the start; null until the first step after the result. */
  kickFromMs: number | null
  startedMs: number | null
  elapsedMs: number
  /** When it started to fade out, in ms from the start; null until then. */
  leavingFromMs: number | null
  /** Played by hand: waiting lasts LABEL_CARD_DEMO_MS, as there is no result to wait for. */
  byHand: boolean
}

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))
const easeOutCubic = (k: number) => 1 - (1 - k) ** 3
const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2)

/** When the scene starts to come in, in ms from the start: after the card, if it has one. */
const sceneFrom = (m: Showing) => (m.card ? PENALTY_CARD_MS : 0)

export class Penalty implements Moment {
  private showing: Showing | null = null
  /** Each label usually comes on one record, but may stay on several: only its first one counts. */
  private penaltySeen = false
  private resultSeen = false

  /** `plays`: false for a flashback clip's director, which notes the labels but never plays it. */
  constructor(
    private readonly ctx: MomentContext,
    private readonly plays: boolean,
  ) {}

  get active(): boolean {
    return this.showing !== null
  }

  get phase(): PenaltyPhase | null {
    const m = this.showing
    if (!m) return null
    if (m.leavingFromMs !== null) return 'leaving'
    if (m.card && m.elapsedMs < PENALTY_CARD_MS) return 'card'
    if (m.result === null) return 'waiting'
    const still = this.ctx.reducedMotion()
    return m.elapsedMs < this.kickFrom(m, still) + (still ? 0 : PENALTY_KICK_MS) ? 'kick' : 'holding'
  }

  /**
   * On each new record, at `time` on the clock: true when its labels start it or move it on, so it
   * needs animation frames. Notes what is labelled either way. A Penalty and its result on one
   * record play the card, then the kick. `blocked`: a goal is showing, and none of the three plays
   * over it, nor later as it carries on: it was noted.
   */
  detect(frame: Frame, time: number, blocked = false): boolean {
    const { penalty, result } = penaltyLabels(frame)
    const newPenalty = penalty !== null && !this.penaltySeen
    const newResult = result !== null && !this.resultSeen
    this.penaltySeen = penalty !== null
    this.resultSeen = result !== null
    if (!this.plays || blocked || !this.ctx.layers().penalty || !this.ctx.playback()) return false
    let moved = false
    if (newPenalty) {
      this.startCard(teamWords(this.ctx, penalty), time)
      moved = true
    }
    if (newResult && this.startResult(result.kind, teamWords(this.ctx, result.team), time)) moved = true
    return moved
  }

  step(ms: number): MomentStep {
    const m = this.showing
    if (!m) return 'stop'
    if (m.startedMs === null) m.startedMs = ms
    m.elapsedMs = ms - m.startedMs
    const still = this.ctx.reducedMotion()
    if (m.result !== null && m.kickFromMs === null) m.kickFromMs = this.kickFrom(m, still)
    if (m.leavingFromMs === null && this.over(m, still)) {
      if (still) return 'stop'
      m.leavingFromMs = m.elapsedMs
    }
    // Reduced motion coming on as it fades out: it goes at once, as it would have.
    if (m.leavingFromMs !== null && (still || m.elapsedMs - m.leavingFromMs >= PENALTY_OUT_MS)) return 'stop'
    return 'paint'
  }

  /**
   * Play it by hand, for `team` in the words drawn, at `time` on the clock: `penalty`, the card and
   * the scene waiting, which leaves after LABEL_CARD_DEMO_MS of waiting; a result, the scene and its
   * kick, as a result with nothing showing plays.
   */
  play(kind: 'penalty' | PenaltyResult, team: string | null, time: number): void {
    if (kind === 'penalty') this.startCard(team, time)
    else this.showing = { ...this.fresh(team, time), result: kind }
    this.showing!.byHand = true
  }

  /** End it at once, back to the frame as it is. */
  stop(): boolean {
    if (!this.showing) return false
    this.showing = null
    return true
  }

  reset(): void {
    this.showing = null
    this.penaltySeen = false
    this.resultSeen = false
  }

  /** What is drawn for it now. Leaving, the card and the scene fade out from where they were, the banners with the scene. */
  value(): PenaltyIndicator | undefined {
    const m = this.showing
    if (!m) return undefined
    const still = this.ctx.reducedMotion()
    const t = m.elapsedMs
    const at = m.leavingFromMs ?? t
    const left = m.leavingFromMs === null || still ? 1 : 1 - easeInOutCubic(clamp01((t - m.leavingFromMs) / PENALTY_OUT_MS))
    const sinceKick = m.result === null ? -Infinity : t - this.kickFrom(m, still)
    const sinceBanner = sinceKick - PENALTY_KICK_MS
    return {
      card: this.cardAt(m, at, still) * left,
      scene: this.sceneAt(m, at, still) * left,
      team: m.team,
      waitMs: Math.max(0, t - sceneFrom(m)),
      result: m.result,
      kick: still ? (sinceKick >= 0 ? 1 : 0) : clamp01(sinceKick / PENALTY_KICK_MS),
      afterKickMs: still ? 0 : Math.max(0, sinceBanner),
      banner: still ? (sinceKick >= 0 ? 1 : 0) : easeOutCubic(clamp01(sinceBanner / PENALTY_RESULT_IN_MS)),
      still,
    }
  }

  /**
   * Start it at the card, for `team` in the words drawn, the wait counting from `time` on the clock.
   * Starting again over itself, the card comes in from as strongly as that covered the pitch.
   */
  private startCard(team: string | null, time: number): void {
    const shown = this.value()
    const from = shown && !this.ctx.reducedMotion() ? Math.min(1, shown.card + shown.scene) : 0
    this.showing = { ...this.fresh(team, time), card: true, fromIntensity: from }
  }

  /**
   * A result: the kick of the penalty showing, or, with none, the scene with that kick for `team`. A
   * penalty fading out with no result is as good as none: the scene comes in again from as strongly
   * as that was drawn, so it does not blink. False when it is ignored: a result already in.
   */
  private startResult(kind: PenaltyResult, team: string | null, time: number): boolean {
    const m = this.showing
    if (m && m.result !== null) return false
    if (m && m.leavingFromMs === null) {
      m.result = kind
      return true
    }
    const shown = this.value()
    const from = shown && !this.ctx.reducedMotion() ? Math.min(1, shown.card + shown.scene) : 0
    this.showing = { ...this.fresh(team, time), result: kind, fromIntensity: from }
    return true
  }

  private fresh(team: string | null, time: number): Showing {
    return {
      team,
      card: false,
      fromIntensity: 0,
      penaltyAt: time,
      result: null,
      kickFromMs: null,
      startedMs: null,
      elapsedMs: 0,
      leavingFromMs: null,
      byHand: false,
    }
  }

  /** When the kick starts, in ms from the start: once the result is in and the scene is in, whichever is later. */
  private kickFrom(m: Showing, still: boolean): number {
    return m.kickFromMs ?? Math.max(m.elapsedMs, sceneFrom(m) + (still ? 0 : PENALTY_SCENE_IN_MS))
  }

  /** Whether it is time to go: the hold over after a result, or with none, the wait (by hand, the demo's). */
  private over(m: Showing, still: boolean): boolean {
    if (m.kickFromMs !== null) return m.elapsedMs >= m.kickFromMs + (still ? 0 : PENALTY_KICK_MS + PENALTY_RESULT_IN_MS) + PENALTY_HOLD_MS
    if (m.byHand) return m.elapsedMs - sceneFrom(m) >= LABEL_CARD_DEMO_MS
    return this.ctx.shown().time - m.penaltyAt >= PENALTY_WAIT_S || m.elapsedMs >= 2 * PENALTY_WAIT_S * 1000
  }

  /** The card at `t` ms from the start: fading in as a centre label card does, whole until the scene is in, then gone. */
  private cardAt(m: Showing, t: number, still: boolean): number {
    if (!m.card || t >= sceneFrom(m) + (still ? 0 : PENALTY_SCENE_IN_MS)) return 0
    return still ? 1 : Math.min(1, m.fromIntensity + ((1 - m.fromIntensity) * t) / LABEL_CARD_IN_MS)
  }

  /**
   * The scene at `t` ms from the start: in over PENALTY_SCENE_IN_MS once the card has had its time.
   * With no card, from `fromIntensity`: how strongly the penalty it took over from was drawn.
   */
  private sceneAt(m: Showing, t: number, still: boolean): number {
    const from = sceneFrom(m)
    if (t < from) return 0
    if (still) return 1
    const k = easeInOutCubic(clamp01((t - from) / PENALTY_SCENE_IN_MS))
    return m.card ? k : m.fromIntensity + (1 - m.fromIntensity) * k
  }
}
