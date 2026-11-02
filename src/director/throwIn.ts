/**
 * The throw-in, ported from PipelineOutputSurface.vue (6f14d1f) :937-1016.
 *
 * When playback runs into a frame the pipeline labels a throw-in, a small
 * "THROW IN" band slides in along the bottom touchline, stays until
 * THROW_IN_SHOW_MS from the start, and slides back out the way it came
 * (throwIn.ts in render). The players are left as they are.
 *
 * The export does not say which team takes a throw-in, so it slides in from
 * the side of the half the ball is in: the ball on the frame, or the last one
 * tracked within BALL_MEMORY_S, as the ball is often lost as it goes out.
 * With no ball to go by it fades in where it stands.
 *
 * Shown once per throw-in, as the label flickers (THROW_IN_REARM_S). It only
 * plays during playback, anything that means someone wants the real frame
 * stops it, and a free kick or a goal takes over from it.
 */
import type { Frame } from '../model/types.js'
import {
  THROW_IN_IN_MS,
  THROW_IN_OUT_MS,
  THROW_IN_REARM_S,
  THROW_IN_SHOW_MS,
  isThrowInFrame,
  type ThrowInIndicator,
} from '../render/throwIn.js'
import { shownBall } from './ballRoll.js'
import type { Moment, MomentContext, MomentStep } from './moment.js'

/** How long, in seconds of replay time, the last tracked ball says which half play is in. */
export const BALL_MEMORY_S = 5

interface Showing {
  side: -1 | 1 | null
  startedMs: number | null
  elapsedMs: number
}

export class ThrowIn implements Moment {
  private throwIn: Showing | null = null

  constructor(private readonly ctx: MomentContext) {}

  get active(): boolean {
    return this.throwIn !== null
  }

  /**
   * `updateThrowIn`, up to its start: note where the ball is on `frame`, and
   * whether it is a throw-in that playback has just run into. Called for
   * every new record, after the free kick has had its say; `blocked` is a
   * goal or a free kick showing.
   */
  detect(frame: Frame, now: number, blocked: boolean): boolean {
    const memory = this.ctx.memory()
    const ball = shownBall(frame, undefined)
    if (ball) memory.lastBall = { x: ball.x, at: now }
    const labelled = isThrowInFrame(frame)
    // Landed on by a seek or a step: a throw-in under way has been seen.
    if (!this.ctx.playback()) {
      memory.throwInLabelAt = labelled ? now : null
      return false
    }
    if (!labelled) return false
    const fresh = memory.throwInLabelAt === null || now - memory.throwInLabelAt > THROW_IN_REARM_S
    memory.throwInLabelAt = now
    return fresh && this.ctx.layers().throwInBanner && !blocked && !this.throwIn
  }

  /** `startThrowIn`: slide in from the half the ball is in, or was last tracked in, as of `now`. */
  start(now: number): void {
    const { lastBall } = this.ctx.memory()
    const side = lastBall && now - lastBall.at <= BALL_MEMORY_S ? (lastBall.x < 0 ? -1 : 1) : null
    this.throwIn = { side, startedMs: null, elapsedMs: 0 }
  }

  /** `throwInStep`. */
  step(ms: number): MomentStep {
    const throwIn = this.throwIn
    if (!throwIn) return 'stop'
    if (throwIn.startedMs === null) throwIn.startedMs = ms
    throwIn.elapsedMs = ms - throwIn.startedMs
    const end = this.ctx.reducedMotion() ? THROW_IN_SHOW_MS : THROW_IN_SHOW_MS + THROW_IN_OUT_MS
    return throwIn.elapsedMs >= end ? 'stop' : 'paint'
  }

  /** `stopThrowIn`: end it at once, back to the frame as it is. */
  stop(): boolean {
    if (!this.throwIn) return false
    this.throwIn = null
    return true
  }

  /** `throwInValue`: what is drawn for it now. */
  value(): ThrowInIndicator | undefined {
    const m = this.throwIn
    if (!m) return undefined
    if (this.ctx.reducedMotion()) return { intensity: 1, slide: 1, side: null }
    const e = m.elapsedMs
    const k =
      e >= THROW_IN_SHOW_MS
        ? Math.max(0, 1 - (e - THROW_IN_SHOW_MS) / THROW_IN_OUT_MS)
        : Math.min(1, e / THROW_IN_IN_MS)
    return { intensity: k, slide: k, side: m.side }
  }

  reset(): void {
    this.throwIn = null
  }
}
