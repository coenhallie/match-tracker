/**
 * The zoom near goal, as the director moves the view: towards where
 * approachCamera (analysis/goalApproach.ts) puts it for the ball on screen,
 * eased there over time by a critically damped spring. The spring follows a
 * target that moves with every record without jerking at each, sets off and
 * comes to rest smoothly, and carries its speed over when the target turns.
 *
 * The director decides when it may move the view (the layer on, no reduced
 * motion, the view not the user's, no goal moving it); this only says where
 * the view goes next.
 */
import { approachCamera, WHOLE_PITCH_CAMERA } from '../analysis/goalApproach.js'
import type { PitchDimensions } from '../model/types.js'
import { FRAME_H, FRAME_W } from '../render/constants.js'
import type { Camera } from '../render/viewTransform.js'
import { MIN_ZOOM } from './camera.js'

/** How quickly the view follows: it is about 90% of the way to where it is going after twice this. */
export const GOAL_ZOOM_SMOOTH_MS = 700

/**
 * How long the ball may go untracked, in seconds of the clock, before the
 * view lets go of where it last was: tracking drops the ball for moments at a
 * time, and the view should not leave the goal at each.
 */
export const BALL_HOLD_S = 2

/**
 * The most time one step moves the view by, in ms: a frame late after a
 * hitch moves it as far as a few frames would, not to the end of its way.
 */
const MAX_STEP_MS = 50

/** Closer than this to where it is going, at about this speed, the view is there: zoom (log), then frame units. */
const REST_LOG_ZOOM = 1e-4
const REST_FRAME_PX = 0.02

/** What the view follows in a frame: the ball drawn, if any, on its pitch, at the clock's `time`. */
export interface FollowAt {
  ball: { x: number; y: number } | null
  pitch: Partial<PitchDimensions> | undefined
  time: number
}

interface Axis {
  at: number
  /** Per ms. */
  speed: number
}

interface Following {
  logZoom: Axis
  x: Axis
  y: Axis
  lastMs: number
}

/**
 * One step of a critically damped spring towards `target`, `dt` ms on: the
 * exact solution, so it is the same at any frame rate and never overshoots a
 * target it starts still at.
 */
function spring(axis: Axis, target: number, dt: number): Axis {
  const omega = 2 / GOAL_ZOOM_SMOOTH_MS
  const decay = Math.exp(-omega * dt)
  const offset = axis.at - target
  const push = (axis.speed + omega * offset) * dt
  return { at: target + (offset + push) * decay, speed: (axis.speed - omega * push) * decay }
}

/**
 * `camera` kept to what the frame can show: no further out than the whole
 * pitch, and never centred so near an edge that it would show past the frame.
 * The spring can carry its speed a hair past where it is going.
 */
function withinFrame(camera: Camera): Camera {
  const zoom = Math.max(MIN_ZOOM, camera.zoom)
  const halfW = FRAME_W / (2 * zoom)
  const halfH = FRAME_H / (2 * zoom)
  return {
    zoom,
    x: Math.min(FRAME_W - halfW, Math.max(halfW, camera.x)),
    y: Math.min(FRAME_H - halfH, Math.max(halfH, camera.y)),
  }
}

const atRest = (axis: Axis, target: number, near: number) =>
  Math.abs(axis.at - target) < near && Math.abs(axis.speed) * 16 < near

export class GoalZoom {
  private following: Following | null = null
  private moved = false
  /** The ball the view last followed, and the clock it was tracked at. */
  private ball: { x: number; y: number; at: number } | null = null

  /** Whether the view is still on its way: the director wants another animation frame. */
  get moving(): boolean {
    return this.moved
  }

  /**
   * One animation frame at `nowMs`, with the ball and pitch of `at` on
   * screen, and the view at `view`: the view it moves to, or null when it stays put.
   * With `makeWay`, a card laid out for the whole pitch is showing, and the
   * view goes out to the whole pitch. The first frame after a release starts
   * from `view`, still, and moves nothing yet: there is no time since the
   * last frame to move by, and neither does the first frame after the view
   * has been still.
   */
  step(at: FollowAt, view: Camera, nowMs: number, makeWay = false): Camera | null {
    const followed = this.target(at)
    const target = makeWay ? WHOLE_PITCH_CAMERA : followed
    const following = this.following
    if (!following) {
      this.following = {
        logZoom: { at: Math.log(view.zoom), speed: 0 },
        x: { at: view.x, speed: 0 },
        y: { at: view.y, speed: 0 },
        lastMs: nowMs,
      }
      this.moved = !this.arrived(this.following, target)
      return null
    }
    // From rest, it sets off now: the time it spent still, with no animation
    // frames asked for, is not time to move by.
    const dt = this.moved ? Math.min(MAX_STEP_MS, nowMs - following.lastMs) : 0
    following.lastMs = nowMs
    this.moved = !this.arrived(following, target)
    if (!this.moved || !(dt > 0)) return null
    following.logZoom = spring(following.logZoom, Math.log(target.zoom), dt)
    following.x = spring(following.x, target.x, dt)
    following.y = spring(following.y, target.y, dt)
    if (this.arrived(following, target)) {
      // Close enough to see no difference: there, and still.
      following.logZoom = { at: Math.log(target.zoom), speed: 0 }
      following.x = { at: target.x, speed: 0 }
      following.y = { at: target.y, speed: 0 }
      this.moved = false
    }
    return withinFrame({ zoom: Math.exp(following.logZoom.at), x: following.x.at, y: following.y.at })
  }

  /** Stop moving the view: the next step starts again from the view as it is then, still. */
  release(): void {
    this.following = null
    this.moved = false
  }

  /** A seek: the ball last followed is not where play is now. */
  forgetBall(): void {
    this.ball = null
  }

  /** A new match: as if just made. */
  reset(): void {
    this.release()
    this.forgetBall()
  }

  /** Where the view is to be: for the ball on screen, or the one last tracked while it is briefly lost. */
  private target({ ball, pitch, time }: FollowAt): Camera {
    if (ball) this.ball = { ...ball, at: time }
    else if (this.ball && !(Math.abs(time - this.ball.at) <= BALL_HOLD_S)) this.ball = null
    return this.ball ? approachCamera(this.ball, pitch) : WHOLE_PITCH_CAMERA
  }

  private arrived(following: Following, target: Camera): boolean {
    return (
      atRest(following.logZoom, Math.log(target.zoom), REST_LOG_ZOOM) &&
      atRest(following.x, target.x, REST_FRAME_PX) &&
      atRest(following.y, target.y, REST_FRAME_PX)
    )
  }
}
