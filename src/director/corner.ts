/**
 * The corner, which the reference does not have: built on the reference's
 * free kick, which the widget no longer shows, on its card and held as it
 * was, with the corner it is taken from lit up as a cone (corner.ts in
 * render).
 *
 * When playback runs into a frame the pipeline labels a corner, "CORNER" is
 * shown across the middle of the pitch, fading in as everyone on the pitch
 * fades out, and the corner's sections light up one after another from the
 * flag outwards, again and again while it shows.
 *
 * The export does not say which corner, so it is the one nearest the ball:
 * the ball on the frame, or the last one tracked within BALL_MEMORY_S, as
 * the ball is often lost as it goes out. With no ball to go by, the card is
 * shown alone.
 *
 * A corner is usually prepared off camera, so it is held for at least
 * CORNER_SHOW_MS, and after that for as long as the label is on or play is
 * stopped (setPieceUnderWay, setPiece.ts). It is shown once per corner,
 * as the label flickers (CORNER_REARM_S), only during playback, and anything
 * that means someone wants the real frame stops it at once. Played by hand,
 * it is on screen for CORNER_DEMO_MS whatever play does.
 */
import type { Frame } from '../model/types.js'
import {
  CORNER_DEMO_MS,
  CORNER_IN_MS,
  CORNER_OUT_MS,
  CORNER_REARM_S,
  CORNER_SHOW_MS,
  cornerSections,
  isCornerFrame,
  type CornerBanner,
} from '../render/corner.js'
import { shownBall } from './ballRoll.js'
import { playMoved } from '../analysis/stoppage.js'
import { setPieceUnderWay } from './setPiece.js'
import type { Moment, MomentContext, MomentStep } from './moment.js'
import { BALL_MEMORY_S } from './throwIn.js'

/** The corner nearest `ball`, by the signs of its x and y. */
const nearestCorner = (ball: { x: number; y: number }): NonNullable<CornerBanner['corner']> => ({
  x: ball.x < 0 ? -1 : 1,
  y: ball.y < 0 ? -1 : 1,
})

interface Showing {
  corner: CornerBanner['corner']
  startedMs: number | null
  elapsedMs: number
  /** When it started to fade out, in ms from its start; null until then. */
  leavingFromMs: number | null
  /** Played by hand: on screen for CORNER_DEMO_MS, whatever play does. */
  byHand: boolean
}

export class Corner implements Moment {
  private corner: Showing | null = null

  constructor(private readonly ctx: MomentContext) {}

  get active(): boolean {
    return this.corner !== null
  }

  /**
   * Note whether play moved on `frame`, and whether it is a corner that
   * playback has just run into. Called for every new record, after the goal
   * has had its say; `blocked` is a goal showing. The director stops the
   * attack, the attack over a player loss and the throw-in, then calls
   * `start`.
   */
  detect(frame: Frame, prevFrame: Frame | null, now: number, blocked: boolean): boolean {
    const memory = this.ctx.memory()
    const playback = this.ctx.playback()
    if (!playback || !prevFrame || playMoved(prevFrame, frame)) memory.playMovedAt = now
    const labelled = isCornerFrame(frame)
    // Landed on by a seek or a step: a corner under way has been seen.
    if (!playback) {
      memory.cornerLabelAt = labelled ? now : null
      return false
    }
    if (!labelled) return false
    const fresh = memory.cornerLabelAt === null || now - memory.cornerLabelAt > CORNER_REARM_S
    memory.cornerLabelAt = now
    return fresh && this.ctx.layers().corner && !blocked && !this.corner
  }

  /** Show it at the corner nearest the ball on `frame`, or the one last tracked as of `now`. */
  start(frame: Frame, now: number, byHand = false): void {
    const { lastBall } = this.ctx.memory()
    const ball = shownBall(frame, undefined) ?? (lastBall && now - lastBall.at <= BALL_MEMORY_S ? lastBall : null)
    const corner = ball ? nearestCorner(ball) : null
    this.corner = { corner, startedMs: null, elapsedMs: 0, leavingFromMs: null, byHand }
  }

  step(ms: number): MomentStep {
    const corner = this.corner
    if (!corner) return 'stop'
    if (corner.startedMs === null) corner.startedMs = ms
    corner.elapsedMs = ms - corner.startedMs
    const still = this.ctx.reducedMotion()
    const over = corner.byHand
      ? corner.elapsedMs >= CORNER_DEMO_MS - (still ? 0 : CORNER_OUT_MS)
      : corner.elapsedMs >= CORNER_SHOW_MS && !setPieceUnderWay(this.ctx, this.ctx.memory().cornerLabelAt)
    if (corner.leavingFromMs === null && over) {
      if (still) return 'stop'
      corner.leavingFromMs = corner.elapsedMs
    }
    if (corner.leavingFromMs !== null && corner.elapsedMs - corner.leavingFromMs >= CORNER_OUT_MS) return 'stop'
    return 'paint'
  }

  /** End it at once, back to the frame as it is. */
  stop(): boolean {
    if (!this.corner) return false
    this.corner = null
    return true
  }

  /** What is drawn for it now, with the theme's icon. */
  value(): CornerBanner | undefined {
    const m = this.corner
    if (!m) return undefined
    const still = this.ctx.reducedMotion()
    const intensity = still
      ? 1
      : m.leavingFromMs !== null
        ? Math.max(0, 1 - (m.elapsedMs - m.leavingFromMs) / CORNER_OUT_MS)
        : Math.min(1, m.elapsedMs / CORNER_IN_MS)
    return {
      intensity,
      playersFade: intensity,
      ballFade: intensity,
      corner: m.corner,
      sections: cornerSections(m.elapsedMs, still),
    }
  }

  reset(): void {
    this.corner = null
  }
}
