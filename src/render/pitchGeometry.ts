// Vendored from datalabelling-frontend/src/lib/vis/ on 2026-08-22. Keep edits
// minimal so the two copies stay diffable. Deliberate difference from the
// vendored copy:
//  - the vendored buildPitchCache silently substitutes FIFA standard values for
//    any dimension the frame omits. The pipeline's export states neither
//    center_circle_radius nor penalty_mark_distance in any frame, so the centre
//    circle and both penalty spots are always drawn from constants.
//    resolvePitchDimensions() still records which dimensions were assumed. They
//    were drawn dashed and dimmed for a while; that cue was dropped on
//    2026-10-24 so the pitch matches the Figma design exactly, every marking
//    solid.
//  - buildPitchCache takes an optional surface: the bitmap size and the matrix
//    to draw through. The vendored cache is always 1280x720, which the browser
//    then stretched to the display (soft on any 2x screen) and magnified up to
//    6x under zoom. Drawn at the display's own resolution through the current
//    view instead, the lines stay sharp. The surface can also leave the grass
//    out, so the renderer can draw between the grass and the markings. And it
//    takes the cache drawn before, which it clears and draws into again when
//    the size has not changed, rather than make a new bitmap for every view.
//  - the pitch is drawn to the Figma pitch (Game Animation Visualizer, node
//    5:22): a lit gradient for the grass, a darker playing area, 4px lines with
//    a rounded outer box, 8px spots, and goals as translucent boxes behind the
//    goal line (goalNets.ts). The design's sizes are scaled to the pitch as
//    drawn (designUnit). Its layout is within a few percent of scale but not
//    exactly to it, so every marking is still placed from the frame's
//    dimensions, which are what the players are positioned against.
//  - resolvePitchDimensions(), build2DTransform(), worldToPx() and the design's
//    pitch length live in src/model/pitch.ts, unchanged, with FRAME_W, FRAME_H
//    and PITCH_MARGIN from constants.ts: the analysis places things on the
//    pitch too, and may not import from render.

// ---------------------------------------------------------------------------
// Pitch geometry utilities for the 2D canvas renderer.
// Ported from build2DTransform(), worldToPx(), buildPitchCache() in the
// original index.html (lines 475-550).
// ---------------------------------------------------------------------------

import {
  DESIGN_PITCH_LENGTH_PX,
  FRAME_H,
  FRAME_W,
  resolvePitchDimensions,
  worldToPx,
} from '../model/pitch.js'
import type { PitchDimensions, Transform2D } from '../model/types.js'
import { PITCH_GRASS_MIDDLE } from '../palette.js'
import { LINE_COLOR } from './constants.js'

// ── Figma pitch style ──────────────────────────────────────────────────────

/** Grass colour at the left and right edges of the frame. */
export const PITCH_GRASS_EDGE = '#166950'

/**
 * Opacity the markings are drawn at, over the grass. Applied to the cache as a
 * whole when it is drawn, as the design applies it to the group of lines, so
 * crossing lines do not double up where they overlap.
 */
export const PITCH_LINE_ALPHA = 0.75

/** Darkening over the playing area, inside the outer box. */
const PLAYING_AREA_SHADE = 'rgba(0, 0, 0, 0.15)'

/**
 * Light at the centre of the grass: grey stops brightening the grass through
 * colour dodge, at half strength, fading to none at the frame's edges.
 */
const GRASS_LIGHT_ALPHA = 0.5
const GRASS_LIGHT_STOPS: Array<[number, string]> = [
  [0.19712, '#666666'],
  [0.39784, '#4d4d4d'],
  [0.59856, '#333333'],
  [0.79928, '#1a1a1a'],
  [0.89964, '#0d0d0d'],
  [0.94982, '#060606'],
  [1, '#000000'],
]

/** Sizes on the design, in design pixels. */
export const DESIGN_LINE_PX = 4
const DESIGN_SPOT_RADIUS_PX = 4
/** The outer box's corner radius, on the outside of its line. */
const DESIGN_CORNER_RADIUS_PX = 8

/**
 * Frame units per design pixel: the design's pitch length against the length
 * of the pitch as drawn, so its line weights keep their proportion to it.
 */
export function designUnit(t: Transform2D): number {
  return (t.pl * t.sc) / DESIGN_PITCH_LENGTH_PX
}

/**
 * Fill the frame with grass: a gradient from the edges to the middle, lit
 * towards the centre, and the playing area shaded a little darker.
 *
 * Drawn in frame units through whatever transform the context already has.
 * Leaves the context's composite mode and alpha as it found them.
 */
export function fillGrass(
  c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
): void {
  const grass = c.createLinearGradient(0, 0, FRAME_W, 0)
  grass.addColorStop(0, PITCH_GRASS_EDGE)
  grass.addColorStop(0.5, PITCH_GRASS_MIDDLE)
  grass.addColorStop(1, PITCH_GRASS_EDGE)
  c.fillStyle = grass
  c.fillRect(0, 0, FRAME_W, FRAME_H)

  // An ellipse filling the frame: a unit circle scaled to its half extents.
  c.save()
  c.globalCompositeOperation = 'color-dodge'
  c.globalAlpha = GRASS_LIGHT_ALPHA
  c.translate(FRAME_W / 2, FRAME_H / 2)
  c.scale(FRAME_W / 2, FRAME_H / 2)
  const light = c.createRadialGradient(0, 0, 0, 0, 0, 1)
  for (const [offset, color] of GRASS_LIGHT_STOPS) light.addColorStop(offset, color)
  c.fillStyle = light
  c.fillRect(-1, -1, 2, 2)
  c.restore()

  // The shade sits under the lines in the design, so it takes their opacity.
  c.save()
  c.globalAlpha = PITCH_LINE_ALPHA
  c.fillStyle = PLAYING_AREA_SHADE
  tracePlayingArea(c, pd, t)
  c.fill()
  c.restore()
}

/**
 * Begin a path round the playing area: the outer box out to the outside of its
 * line, rounded as the design's box is, which is where the box's own
 * background reaches. Anything shading the pitch fills or clips to it.
 */
export function tracePlayingArea(
  c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
): void {
  const R = resolvePitchDimensions(pd)
  const u = designUnit(t)
  const half = (DESIGN_LINE_PX / 2) * u
  const [tlX, tlY] = worldToPx(-R.length.value / 2, -R.width.value / 2, t)
  const [brX, brY] = worldToPx(R.length.value / 2, R.width.value / 2, t)
  c.beginPath()
  c.roundRect(tlX - half, tlY - half, brX - tlX + 2 * half, brY - tlY + 2 * half, DESIGN_CORNER_RADIUS_PX * u)
}

/**
 * Pre-render all static pitch markings to an OffscreenCanvas so they can be
 * blitted in a single `drawImage` call each frame. Given the cache drawn
 * before, at the same bitmap size, it clears that and draws into it again
 * rather than making a new one: the view moves every frame while the zoom near
 * goal eases, or someone pinches or drags, and a new full-size bitmap each
 * time is garbage the browser has to reclaim. The markings come out the same,
 * as everything they are drawn with is set before it is used.
 *
 * Draws:
 *  - Grass (fillGrass), unless the surface leaves it out
 *  - White lines: outer box, halfway line, centre circle + centre spot
 *  - Penalty areas (both ends)
 *  - Goal areas (both ends)
 *  - Penalty marks
 *
 * The lines are drawn at full strength; draw the cache at PITCH_LINE_ALPHA.
 */

/** The bitmap a pitch cache is drawn into, and the matrix to draw through. */
export interface PitchSurface {
  width: number
  height: number
  /** ctx.setTransform order: a, b, c, d, e, f. Maps frame units to bitmap pixels. */
  matrix: [number, number, number, number, number, number]
  /**
   * Whether to fill the grass under the markings. Off when something is drawn
   * between the grass and the markings, so the cache holds the lines alone.
   */
  grass?: boolean
}

const FRAME_SURFACE: PitchSurface = {
  width: FRAME_W,
  height: FRAME_H,
  matrix: [1, 0, 0, 1, 0, 0],
}

export function buildPitchCache(
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  surface: PitchSurface = FRAME_SURFACE,
  previous: OffscreenCanvas | null = null,
): OffscreenCanvas {
  const reuse = previous !== null && previous.width === surface.width && previous.height === surface.height
  const oc = reuse ? previous : new OffscreenCanvas(surface.width, surface.height)
  const c = oc.getContext('2d')!
  if (reuse) {
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, oc.width, oc.height)
  }
  // Everything below is drawn in frame units; this maps them to the bitmap.
  c.setTransform(...surface.matrix)

  // Background
  if (surface.grass !== false) fillGrass(c, pd, t)

  const R = resolvePitchDimensions(pd)
  const D = {
    length: R.length.value,
    width: R.width.value,
    pal: R.penalty_area_length.value,
    paw: R.penalty_area_width.value,
    gal: R.goal_area_length.value,
    gaw: R.goal_area_width.value,
    ccr: R.center_circle_radius.value,
    pmd: R.penalty_mark_distance.value,
  }

  // Line weight and spot size, scaled from the design to the pitch as drawn
  const u = designUnit(t)
  const lineWidth = DESIGN_LINE_PX * u
  const spotRadius = DESIGN_SPOT_RADIUS_PX * u

  // Shorthand for worldToPx using the provided transform
  const p = (x: number, y: number): [number, number] => worldToPx(x, y, t)

  c.strokeStyle = LINE_COLOR
  c.fillStyle = LINE_COLOR
  c.lineWidth = lineWidth
  // The design's boxes are square inside and rounded by half the line's width
  // outside, which is what a round join gives.
  c.lineJoin = 'round'

  // ── Outer box ──────────────────────────────────────────────────────────────
  // Its corner radius is on the outside of the line; the path runs down the
  // line's middle.
  const [tlX, tlY] = p(-D.length / 2, -D.width / 2)
  const [brX, brY] = p(D.length / 2, D.width / 2)
  c.beginPath()
  c.roundRect(tlX, tlY, brX - tlX, brY - tlY, (DESIGN_CORNER_RADIUS_PX - DESIGN_LINE_PX / 2) * u)
  c.stroke()

  // ── Helpers ────────────────────────────────────────────────────────────────
  function line(x1: number, y1: number, x2: number, y2: number) {
    const [ax, ay] = p(x1, y1)
    const [bx, by] = p(x2, y2)
    c.beginPath()
    c.moveTo(ax, ay)
    c.lineTo(bx, by)
    c.stroke()
  }

  function rect(x1: number, y1: number, x2: number, y2: number) {
    const [ax, ay] = p(x1, y1)
    const [bx, by] = p(x2, y2)
    c.strokeRect(ax, ay, bx - ax, by - ay)
  }

  function dot(x: number, y: number) {
    const [px_, py_] = p(x, y)
    c.beginPath()
    c.arc(px_, py_, spotRadius, 0, Math.PI * 2)
    c.fill()
  }

  // ── Halfway line ───────────────────────────────────────────────────────────
  line(0, -D.width / 2, 0, D.width / 2)

  // ── Centre circle + centre spot ────────────────────────────────────────────
  const [cX, cY] = p(0, 0)
  c.beginPath()
  c.arc(cX, cY, D.ccr * t.sc, 0, Math.PI * 2)
  c.stroke()
  dot(0, 0)

  // ── Penalty areas ──────────────────────────────────────────────────────────
  rect(-D.length / 2, -D.paw / 2, -D.length / 2 + D.pal, D.paw / 2)
  rect(D.length / 2 - D.pal, -D.paw / 2, D.length / 2, D.paw / 2)

  // ── Goal areas ─────────────────────────────────────────────────────────────
  rect(-D.length / 2, -D.gaw / 2, -D.length / 2 + D.gal, D.gaw / 2)
  rect(D.length / 2 - D.gal, -D.gaw / 2, D.length / 2, D.gaw / 2)

  // ── Penalty marks ──────────────────────────────────────────────────────────
  dot(-D.length / 2 + D.pmd, 0)
  dot(D.length / 2 - D.pmd, 0)

  return oc
}
