/**
 * The goal sequence, ported from PipelineOutputSurface.vue (6f14d1f)
 * :439-552 and its part of the frame watcher, :1280-1289.
 *
 * When playback runs into a frame the pipeline labels GOAL, a ball is shot
 * into the net and settles there, in place of the tracked ball (see
 * goalSequence.ts). As it reaches the net the goal's card comes up, fixed to
 * the frame while the view zooms behind it (goalBanner.ts).
 *
 * It only ever plays during playback, and anything that means someone wants
 * the real frame stops it at once. While it plays, the view zooms in on the
 * shot and the net and eases back out to the view the user had. Stopping it
 * puts that view straight back; zooming or panning during it hands the view
 * to the user for good.
 */
import {
  GOAL_SEQUENCE_MS,
  goalCamera,
  goalCameraWeight,
  goalStateAt,
  isGoalFrame,
  planGoal,
  type GoalPlan,
  type GoalState,
} from '../analysis/goalSequence'
import type { Frame } from '../model/types'
import { goalBannerIntensity, type GoalBanner } from '../render/goalBanner'
import type { GoalOverlay } from '../render/renderer'
import { cameraFromView, type Camera } from '../render/viewTransform'
import { blendCamera } from './camera'
import type { Moment, MomentContext, MomentStep } from './moment'

interface Running {
  plan: GoalPlan
  /** The first animation frame's timestamp, once it has had one. */
  startedMs: number | null
  elapsedMs: number
  /**
   * The user's view and the goal's framing. Null once the user takes the view
   * over, and with reduced motion, when the view does not move at all.
   */
  camera: { from: Camera; to: Camera } | null
}

export class Goal implements Moment {
  private goal: Running | null = null
  /** The label usually stays on for many frames: only its first one is a goal. */
  private labelSeen = false

  constructor(private readonly ctx: MomentContext) {}

  get active(): boolean {
    return this.goal !== null
  }

  /**
   * The frame watcher's goal check, on each new record (`:1280-1289`):
   * whether a goal starts on `frame`. Notes whether it is labelled either way.
   * The director stops the other moments, then calls `start`.
   */
  detect(frame: Frame): boolean {
    const labelled = isGoalFrame(frame)
    const starts = labelled && this.ctx.layers().goal && !this.labelSeen && !this.goal && this.ctx.playback()
    this.labelSeen = labelled
    return starts
  }

  /**
   * `startGoal`: plan the shot on `frame`, the camera moving from the user's
   * view to the goal. False with no ball, when there is no telling which goal
   * it went in: better no sequence than one at the wrong end.
   */
  start(frame: Frame): boolean {
    const plan = planGoal(frame)
    if (!plan) return false
    const from = cameraFromView(this.ctx.view())
    this.goal = {
      plan,
      startedMs: null,
      elapsedMs: 0,
      camera: this.ctx.reducedMotion() ? null : { from, to: goalCamera(plan, frame.pitch_dimensions) },
    }
    return true
  }

  /** `goalStep`: move the sequence, and the camera, on to `ms`. */
  step(ms: number): MomentStep {
    const goal = this.goal
    if (!goal) return 'stop'
    if (goal.startedMs === null) goal.startedMs = ms
    goal.elapsedMs = ms - goal.startedMs
    if (goal.elapsedMs >= GOAL_SEQUENCE_MS) return 'stop'
    if (goal.camera) {
      const { from, to } = goal.camera
      this.ctx.showCamera(blendCamera(from, to, goalCameraWeight(goal.elapsedMs)))
    }
    return 'paint'
  }

  /** `stopGoal`: end it, putting the user's view back unless they took it over. */
  stop(): boolean {
    const goal = this.goal
    if (!goal) return false
    this.goal = null
    if (goal.camera) this.ctx.showCamera(goal.camera.from)
    return true
  }

  /** `releaseSequenceCamera`: the user has zoomed or panned, so the view is theirs, and stays where they put it. */
  releaseCamera(): void {
    if (this.goal) this.goal.camera = null
  }

  /** What the sequence draws over the frame (`goalOverlay`): its ball, that ball's trail, and the net it hits. */
  overlay(): GoalOverlay | undefined {
    const state = this.state()
    if (!this.goal || !state) return undefined
    return {
      ball: state.ball,
      trail: state.trail,
      net: { side: this.goal.plan.side, y: this.goal.plan.impact.y, metres: state.netBulge },
    }
  }

  /**
   * The goal's card (`goalBannerValue`): in as the ball reaches the net, out
   * as the camera eases back. With reduced motion the ball is in the net from
   * the start, and so is the card. Drawn with the theme's icon.
   */
  banner(): GoalBanner | undefined {
    if (!this.goal) return undefined
    const intensity = this.ctx.reducedMotion() ? 1 : goalBannerIntensity(this.goal.plan, this.goal.elapsedMs)
    return intensity > 0 ? { intensity } : undefined
  }

  reset(): void {
    this.goal = null
    this.labelSeen = false
  }

  /** With reduced motion the ball is simply in the net. */
  private state(): GoalState | null {
    if (!this.goal) return null
    return goalStateAt(this.goal.plan, this.ctx.reducedMotion() ? GOAL_SEQUENCE_MS : this.goal.elapsedMs)
  }
}
