import type { PitchDimensions, Transform2D } from '../model/types'
import { DESIGN_LINE_PX, PITCH_LINE_ALPHA, designUnit, resolvePitchDimensions, worldToPx } from './pitchGeometry'
import { NET_DEPTH_METRES } from '../analysis/goalSequence'

/** Struck net: which goal, where along it, and how far it bows out, in metres. */
export interface NetBulge {
  side: 1 | -1
  y: number
  metres: number
}

/** The goal's line, and its corner radius on the outside of it, in design pixels. */
const GOAL_LINE_PX = 2
const GOAL_CORNER_RADIUS_PX = 2
/** The goal's fill in the design: white at this opacity, under the line opacity. */
const GOAL_FILL_ALPHA = 0.2

/**
 * Draw both goals as the Figma pitch draws them: a box behind the goal line
 * with a thin white outline and a translucent white fill, rounded at the back.
 * The goal width comes from the frame, the depth from the design
 * (NET_DEPTH_METRES).
 *
 * The design's goal overlaps the outer box's line, which hides that part of it.
 * As the goals are drawn over the line rather than inside the same group, they
 * are clipped to beyond the line, so the overlap cannot brighten it.
 *
 * Drawn in frame units through whatever transform the context already has, and
 * on every frame rather than into the pitch cache, so a struck net bowing out
 * costs a few lines rather than a rebuilt pitch.
 */
export function drawGoalNets(
  ctx: CanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  bulge?: NetBulge,
): void {
  const dims = resolvePitchDimensions(pd)
  const half = dims.length.value / 2
  const g = dims.goal_width.value / 2
  const u = designUnit(t)
  const p = (x: number, y: number) => worldToPx(x, y, t)

  for (const side of [-1, 1] as const) {
    const b = bulge && bulge.side === side ? bulge.metres : 0
    const by = bulge && bulge.side === side ? bulge.y : 0
    const backX = side * (half + NET_DEPTH_METRES)
    const [lx0, ly0] = p(side * half, -g)
    const [lx1, ly1] = p(side * half, g)
    const [bx0, by0] = p(backX, -g)
    const [bx1, by1] = p(backX, g)

    // The goal's outline from post to post, round the back. At rest the back
    // is straight and its corners rounded as in the design; struck, it bows
    // out through a quadratic, whose peak is halfway to its control point.
    const outline = () => {
      ctx.moveTo(lx0, ly0)
      if (b === 0) {
        const r = (GOAL_CORNER_RADIUS_PX - GOAL_LINE_PX / 2) * u
        ctx.arcTo(bx0, by0, bx1, by1, r)
        ctx.arcTo(bx1, by1, lx1, ly1, r)
      } else {
        const [cx, cy] = p(backX + side * 2 * b, by)
        ctx.lineTo(bx0, by0)
        ctx.quadraticCurveTo(cx, cy, bx1, by1)
      }
      ctx.lineTo(lx1, ly1)
    }

    ctx.save()
    // Only beyond the outside of the goal line.
    const edgeX = lx0 + side * (DESIGN_LINE_PX / 2) * u
    ctx.beginPath()
    ctx.rect(edgeX, -1e5, side * 1e6, 2e5)
    ctx.clip()

    ctx.lineJoin = 'round'
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = GOAL_LINE_PX * u

    // Fill, lit up while the net moves so the impact reads at a glance.
    ctx.globalAlpha = GOAL_FILL_ALPHA * PITCH_LINE_ALPHA + Math.min(0.15, Math.abs(b) * 0.25)
    ctx.beginPath()
    outline()
    ctx.closePath()
    ctx.fill()

    ctx.globalAlpha = PITCH_LINE_ALPHA
    ctx.beginPath()
    outline()
    ctx.stroke()
    ctx.restore()
  }
}
