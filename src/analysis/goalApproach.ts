import type { PitchDimensions } from '../model/types.js'
import { FRAME_H, FRAME_W } from '../render/constants.js'
import { resolvePitchDimensions } from '../render/pitchGeometry.js'
import type { Camera } from '../render/viewTransform.js'
import { framePitchBox, NET_DEPTH_METRES } from './goalSequence.js'

/**
 * The zoom near goal: as the ball nears a goal, the view closes in on it and
 * that goal, a little more the nearer it gets. This is where the view is to
 * be for a ball at a place; the director eases the view there over time
 * (director/goalZoom.ts), so a ball that jumps about never jerks the view.
 *
 * Distance is to the middle of the goal on the ball's half, so a ball by the
 * corner flag is far, and one in the box is near.
 */

/** Further than this from the goal, in metres, the view is the whole pitch: past the box's corner. */
export const APPROACH_FAR_METRES = 32
/** Nearer than this, about the penalty spot and in, the view is as close in as the zoom near goal goes. */
export const APPROACH_NEAR_METRES = 12
/** As close in as it goes: less than a goal's own camera, which comes in further for the shot. */
export const APPROACH_MAX_ZOOM = 1.8
/** Room kept around the ball and the goal, so the players around them stay in view. */
const APPROACH_MARGIN_METRES = 12

/** The whole pitch: what the view is with the ball far from either goal. */
export const WHOLE_PITCH_CAMERA: Camera = Object.freeze({ zoom: 1, x: FRAME_W / 2, y: FRAME_H / 2 })

const smoothstep = (u: number) => {
  const k = Math.min(1, Math.max(0, u))
  return k * k * (3 - 2 * k)
}

/** How close in to be for a ball `metres` from the middle of the goal: 0 is the whole pitch, 1 as close as it goes. */
export function approachWeight(metres: number): number {
  return smoothstep((APPROACH_FAR_METRES - metres) / (APPROACH_FAR_METRES - APPROACH_NEAR_METRES))
}

/**
 * The view for the ball at `ball` (pitch metres, centred): the whole pitch
 * far from goal, and nearer it, partway towards a view framing the ball and
 * the goal on its half. Between the two the zoom moves geometrically and the
 * centre in a line, as blendCamera does, so it never shows past the frame.
 */
export function approachCamera(
  ball: { x: number; y: number },
  pd: Partial<PitchDimensions> | undefined,
): Camera {
  const dims = resolvePitchDimensions(pd)
  const halfLength = dims.length.value / 2
  const goalWidth = dims.goal_width.value
  const side = ball.x < 0 ? -1 : 1
  const weight = approachWeight(Math.hypot(side * halfLength - ball.x, ball.y))
  if (weight <= 0) return WHOLE_PITCH_CAMERA
  const framed = framePitchBox(
    [ball.x, side * (halfLength + NET_DEPTH_METRES)],
    [ball.y, -goalWidth / 2, goalWidth / 2],
    APPROACH_MARGIN_METRES,
    1,
    APPROACH_MAX_ZOOM,
    pd,
  )
  return {
    zoom: framed.zoom ** weight,
    x: WHOLE_PITCH_CAMERA.x + (framed.x - WHOLE_PITCH_CAMERA.x) * weight,
    y: WHOLE_PITCH_CAMERA.y + (framed.y - WHOLE_PITCH_CAMERA.y) * weight,
  }
}
