/**
 * What the set pieces share, the corner (corner.ts) and the free kick (freeKick.ts): the rule the
 * reference's free kick held itself by (`freeKickUnderWay`, PipelineOutputSurface.vue 6f14d1f), and
 * the timing built on it.
 *
 * A set piece is usually prepared off camera. It fades in over CORNER_IN_MS, stays for at least
 * CORNER_SHOW_MS, and after that for as long as its label is on or play is stopped, then fades out
 * over CORNER_OUT_MS. Played by hand, it is on screen for CORNER_DEMO_MS, fading in and out included,
 * whatever play does. Under reduced motion it shows whole, and goes without a fade.
 */
import { LABEL_HOLD_S, PLAY_STALL_S } from '../analysis/stoppage.js'
import { CORNER_DEMO_MS, CORNER_IN_MS, CORNER_OUT_MS, CORNER_SHOW_MS } from '../render/corner.js'
import { shownBall } from './ballRoll.js'
import type { MomentContext, MomentStep } from './moment.js'

/**
 * Whether the set piece whose label was last seen at `labelAt` is still being
 * taken: its label is on, nobody has moved for PLAY_STALL_S of replay time,
 * or the ball is not tracked.
 */
export function setPieceUnderWay(ctx: MomentContext, labelAt: number | null): boolean {
  const { time: now, record } = ctx.shown()
  const { playMovedAt } = ctx.memory()
  const labelOn = labelAt !== null && now - labelAt < LABEL_HOLD_S
  const ballGone = !record || shownBall(record.frame, undefined) === null
  return labelOn || ballGone || now - playMovedAt >= PLAY_STALL_S
}

/** Where a set piece showing is in its time. */
export interface SetPieceClock {
  startedMs: number | null
  elapsedMs: number
  /** When it started to fade out, in ms from its start; null until then. */
  leavingFromMs: number | null
  /** Played by hand: on screen for CORNER_DEMO_MS, whatever play does. */
  byHand: boolean
}

/** A set piece's clock at its start. */
export const startClock = (byHand: boolean): SetPieceClock => ({ startedMs: null, elapsedMs: 0, leavingFromMs: null, byHand })

/**
 * Move `clock` on to `ms`, for the set piece whose label was last seen at `labelAt`: whether it
 * goes on being drawn, or has ended.
 */
export function stepClock(ctx: MomentContext, clock: SetPieceClock, labelAt: number | null, ms: number): MomentStep {
  if (clock.startedMs === null) clock.startedMs = ms
  clock.elapsedMs = ms - clock.startedMs
  const still = ctx.reducedMotion()
  const over = clock.byHand
    ? clock.elapsedMs >= CORNER_DEMO_MS - (still ? 0 : CORNER_OUT_MS)
    : clock.elapsedMs >= CORNER_SHOW_MS && !setPieceUnderWay(ctx, labelAt)
  if (clock.leavingFromMs === null && over) {
    if (still) return 'stop'
    clock.leavingFromMs = clock.elapsedMs
  }
  if (clock.leavingFromMs !== null && clock.elapsedMs - clock.leavingFromMs >= CORNER_OUT_MS) return 'stop'
  return 'paint'
}

/** 0 to 1: how far a set piece has faded in, or, leaving, how much of it is left. */
export function clockIntensity(ctx: MomentContext, clock: SetPieceClock): number {
  if (ctx.reducedMotion()) return 1
  return clock.leavingFromMs !== null
    ? Math.max(0, 1 - (clock.elapsedMs - clock.leavingFromMs) / CORNER_OUT_MS)
    : Math.min(1, clock.elapsedMs / CORNER_IN_MS)
}
