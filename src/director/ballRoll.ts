/**
 * Ball roll, ported from PipelineOutputSurface.vue (6f14d1f) :1185-1237.
 *
 * The ball is drawn as a football, and during playback it rolls the way it
 * moves on screen (football.ts). How it is turned carries on from frame to
 * frame, so it is kept here. A seek, a step while paused, or a jump in the
 * ball's tracking moves it without rolling it, and reduced motion never rolls
 * it.
 */
import { rolled, UPRIGHT, type Spin } from '../analysis/football.js'
import type { Frame } from '../model/types.js'
import { BALL_RADIUS } from '../render/constants.js'
import type { GoalOverlay } from '../render/renderer.js'
import { build2DTransform, worldToPx } from '../model/pitch.js'

/**
 * Further than this in one step, in metres, the tracked ball has jumped
 * rather than moved: 45 m/s, as in ballTrail.ts, over a frame and a half.
 */
export const MAX_ROLL_STEP_METRES = 2.7

/** The ball the frame is drawn with: the goal sequence's, or the tracked one. */
export function shownBall(frame: Frame, goal: GoalOverlay | undefined): { x: number; y: number } | null {
  if (goal) return goal.ball
  for (const ball of frame.balls ?? []) {
    const { x, y } = ball.projected_coordinates ?? {}
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      return { x, y }
    }
  }
  return null
}

/** How the ball is turned, and where it was last drawn. */
export class BallRoll {
  spin: Spin = UPRIGHT
  /** Where the ball was last drawn, in metres, and whether it was the goal's. */
  private rolledFrom: { x: number; y: number } | null = null
  private rolledGoal = false

  /**
   * Roll the ball on from where it was last drawn, if it is moving in play:
   * the goal's ball always is, and the tracked one is on a `playback` step
   * (playing, and the clock's last step was playback). Called on every paint.
   */
  roll(frame: Frame, goal: GoalOverlay | undefined, playback: boolean, reducedMotion: boolean): void {
    const at = shownBall(frame, goal)
    const moving = (goal !== undefined || playback) && !reducedMotion
    // Between the tracked ball and the goal's, the ball did not travel.
    const sameBall = (goal !== undefined) === this.rolledGoal
    this.rolledGoal = goal !== undefined
    if (at && this.rolledFrom && moving && sameBall) {
      const dx = at.x - this.rolledFrom.x
      const dy = at.y - this.rolledFrom.y
      if (Math.hypot(dx, dy) <= MAX_ROLL_STEP_METRES) {
        // Rolled on screen, where it is drawn at BALL_RADIUS.
        const t = build2DTransform(frame.pitch_dimensions)
        const [x0, y0] = worldToPx(this.rolledFrom.x, this.rolledFrom.y, t)
        const [x1, y1] = worldToPx(at.x, at.y, t)
        this.spin = rolled(this.spin, x1 - x0, y1 - y0, BALL_RADIUS)
      }
    }
    this.rolledFrom = at
  }

  /** Upright, drawn nowhere yet. */
  reset(): void {
    this.spin = UPRIGHT
    this.rolledFrom = null
    this.rolledGoal = false
  }
}
