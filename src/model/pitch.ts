/**
 * The frame's coordinate system: the pitch a frame is on, and the 1280x720 frame units its
 * positions are mapped into. Everything that places something on the pitch reads it, the
 * analysis (a goal's camera, the zoom near goal) as much as the drawing, so it sits here, under
 * both. Moved out of render/pitchGeometry.ts and render/constants.ts unchanged.
 */
import type { PitchDimensions, Transform2D } from './types.js'

/** Internal canvas width in pixels. */
export const FRAME_W = 1280
/** Internal canvas height in pixels. */
export const FRAME_H = 720
/** Margin (px) between canvas edge and pitch outline. */
export const PITCH_MARGIN = 40

// ── Default pitch metric values (FIFA standard) ────────────────────────────
const DEFAULT_LENGTH = 105
const DEFAULT_WIDTH = 68
const DEFAULT_PAL = 16.5
const DEFAULT_PAW = 40.32
const DEFAULT_GAL = 5.5
const DEFAULT_GAW = 18.32
const DEFAULT_GW = 7.32
const DEFAULT_CCR = 9.15
const DEFAULT_PMD = 11.0

/** A pitch dimension, and whether it came from the frame or from this file. */
export interface ResolvedDimension {
  /** Metres. The standard value when `assumed` is true. */
  value: number
  /** True when the frame did not state this dimension. */
  assumed: boolean
}

/** Every dimension the 2D pitch is drawn from. */
export type ResolvedPitch = Record<
  | 'length'
  | 'width'
  | 'penalty_area_length'
  | 'penalty_area_width'
  | 'goal_area_length'
  | 'goal_area_width'
  | 'goal_width'
  | 'center_circle_radius'
  | 'penalty_mark_distance',
  ResolvedDimension
>

/** A stated dimension, or the standard one in its place. */
const take = (v: number | undefined, standard: number): ResolvedDimension =>
  typeof v === 'number' && !isNaN(v) ? { value: v, assumed: false } : { value: standard, assumed: true }

/**
 * Resolve every pitch dimension the 2D renderer needs, recording which ones the
 * frame actually stated.
 *
 * A standard value still has to be produced for the ones it omits, because a
 * marking cannot be positioned without one. What changes is that the caller can
 * now tell the two apart and draw them differently.
 */
export function resolvePitchDimensions(pd: Partial<PitchDimensions> | undefined): ResolvedPitch {
  return {
    length: take(pd?.length, DEFAULT_LENGTH),
    width: take(pd?.width, DEFAULT_WIDTH),
    penalty_area_length: take(pd?.penalty_area_length, DEFAULT_PAL),
    penalty_area_width: take(pd?.penalty_area_width, DEFAULT_PAW),
    goal_area_length: take(pd?.goal_area_length, DEFAULT_GAL),
    goal_area_width: take(pd?.goal_area_width, DEFAULT_GAW),
    goal_width: take(pd?.goal_width, DEFAULT_GW),
    center_circle_radius: take(pd?.center_circle_radius, DEFAULT_CCR),
    penalty_mark_distance: take(pd?.penalty_mark_distance, DEFAULT_PMD),
  }
}

/**
 * Build a 2D transform that maps world coordinates (in metres, centred on
 * the pitch origin) to pixel coordinates on a FRAME_W x FRAME_H canvas.
 *
 * The transform uniformly scales the pitch so it fits within the canvas
 * minus the configured margin, then centres it.
 */
export function build2DTransform(pd: Partial<PitchDimensions> | undefined): Transform2D {
  const pl = pd?.length ?? DEFAULT_LENGTH
  const pw = pd?.width ?? DEFAULT_WIDTH
  const sx = (FRAME_W - 2 * PITCH_MARGIN) / pl
  const sy = (FRAME_H - 2 * PITCH_MARGIN) / pw
  const sc = Math.min(sx, sy)
  const ox = (FRAME_W - pl * sc) / 2
  const oy = (FRAME_H - pw * sc) / 2
  return { ox, oy, sc, pl, pw }
}

/**
 * Convert a world-space position (x, y) - where (0, 0) is the pitch centre
 * - to canvas pixel coordinates using the given transform.
 */
export function worldToPx(x: number, y: number, t: Transform2D): [number, number] {
  return [t.ox + (x + t.pl / 2) * t.sc, t.oy + (y + t.pw / 2) * t.sc]
}

/**
 * The pitch's length in the design, between the centres of the two goal
 * lines, in design pixels. The outer box spans 1360, with its 4px border
 * inside that.
 */
export const DESIGN_PITCH_LENGTH_PX = 1356

/**
 * Depth of the net behind the goal line. The export does not state one, so it
 * is the Figma pitch's: the middle of the goal's back line sits 37 design
 * pixels behind the middle of the goal line, on a standard 105 m pitch.
 */
export const NET_DEPTH_METRES = (37 / DESIGN_PITCH_LENGTH_PX) * DEFAULT_LENGTH

/** A view described by what it looks at: a zoom and a centre in frame units. */
export interface Camera {
  zoom: number
  x: number
  y: number
}
