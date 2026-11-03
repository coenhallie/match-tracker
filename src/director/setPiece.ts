/**
 * Whether a set piece is still being taken, for the corner (corner.ts): the
 * rule the reference's free kick held itself by (`freeKickUnderWay`,
 * PipelineOutputSurface.vue 6f14d1f), which the widget no longer shows.
 */
import { LABEL_HOLD_S, PLAY_STALL_S } from '../analysis/stoppage.js'
import { shownBall } from './ballRoll.js'
import type { MomentContext } from './moment.js'

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
