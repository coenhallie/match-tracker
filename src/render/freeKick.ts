import type { PitchDimensions, Transform2D } from '../model/types.js'
import { FRAME_H, FRAME_W, resolvePitchDimensions, worldToPx } from '../model/pitch.js'
import type { CardBox } from './eventBanner.js'
import { drawIconCard } from './labelCard.js'
import { DESIGN_LINE_PX, designUnit } from './pitchGeometry.js'
import { DEFAULT_THEME, type RenderTheme } from './theme.js'

/**
 * The free kick (Figma "Game Animation Visualizer", viewport/eventFreeKickRightSide, node 134:2011,
 * and viewport/eventFreeKickLeftSide, node 134:2181): where the ball was as its label came marked
 * by a pulse, the other half of the pitch shaded, and "FREE KICK" and its icon on a card in the
 * middle of that half, with the team taking it under the card. Everyone on the pitch and the ball
 * fade out with it, as for the corner. Held as the corner is (setPiece.ts in director).
 *
 * The widget's own: video-annotation's free kick, a card across the middle, was dropped in 0.2.0.
 */
export interface FreeKickBanner {
  /** 0 to 1: how far it has faded in, or, leaving, how much of it is left. */
  intensity: number
  /** 0 to 1: how far everyone on the pitch has faded out. */
  playersFade: number
  /** 0 to 1: how far the ball and its trail have faded out. */
  ballFade: number
  /**
   * Where the ball was as the label came, in pitch metres as the frame is shown: the ball on the
   * labelled record, or the last tracked one shortly before it. Null when neither is known: the
   * card is then shown alone, across the middle, with nothing shaded and no pulse.
   */
  ball: { x: number; y: number } | null
  /** The name of the team taking it, written under the card, or null for none. */
  team?: string | null | undefined
  /** 0 to 1 for each of the pulse's rings, from the middle out: how strongly it is lit (cornerSections). */
  rings: readonly number[]
  /** The free kick icon, once it has loaded. Until then the card is drawn without it. Default the theme's. */
  icon?: CanvasImageSource | null
}

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))

/** The half the card goes in and the shade covers, the one without the ball: -1 left, 1 right, 0 for no ball known. */
export function freeKickSide(ball: FreeKickBanner['ball']): -1 | 0 | 1 {
  if (!ball) return 0
  return ball.x >= 0 ? -1 : 1
}

/** The shade over the half without the ball: the design's dark green at 40%. */
const SHADE_RGB = '11, 51, 40'
const SHADE_ALPHA = 0.4

/**
 * Shade the half of the pitch without the ball, under the players, in frame units through the
 * context's current transform. It runs from the halfway line's edge out past the frame on that
 * side, and past its top and bottom, so no view shows where it ends, as the design's covers the
 * whole frame's half up to the line.
 */
export function drawFreeKickShade(ctx: CanvasRenderingContext2D, t: Transform2D, banner: FreeKickBanner): void {
  const alpha = clamp01(banner.intensity)
  const side = freeKickSide(banner.ball)
  if (alpha <= 0 || side === 0) return
  const [mx] = worldToPx(0, 0, t)
  const line = (DESIGN_LINE_PX / 2) * designUnit(t)
  const from = side < 0 ? -FRAME_W : mx + line
  const to = side < 0 ? mx - line : 2 * FRAME_W
  ctx.save()
  ctx.fillStyle = `rgba(${SHADE_RGB}, ${SHADE_ALPHA * alpha})`
  ctx.fillRect(from, -FRAME_H, to - from, 3 * FRAME_H)
  ctx.restore()
}

/**
 * The pulse's rings, from the middle out, in design pixels (the design's pulse2Placeholder, 80
 * px): each a disc of white at 20% and a 4 px white line round it, stronger further out.
 */
const PULSE_RINGS: ReadonlyArray<{ fillR: number; lineR: number; lineAlpha: number }> = [
  { fillR: 16, lineR: 14, lineAlpha: 0.5 },
  { fillR: 26, lineR: 24, lineAlpha: 0.8 },
  { fillR: 38, lineR: 38, lineAlpha: 1 },
]
const PULSE_FILL_ALPHA = 0.2
const PULSE_LINE_PX = 4

/**
 * Mark where the ball was with the pulse, under the players, in frame units through the context's
 * current transform. Its rings light up one after another from the middle out, as the corner's
 * cone does, again and again while it shows; drawn from the outside in, so the discs stack as the
 * design's do.
 */
export function drawFreeKickPulse(ctx: CanvasRenderingContext2D, t: Transform2D, banner: FreeKickBanner): void {
  drawPulse(ctx, t, banner.ball, banner.rings, banner.intensity)
}

/**
 * The pulse at `spot` on the pitch, in metres, its rings lit as `rings` says, at `intensity`: the
 * free kick's, and the throw-in card's (throwIn.ts), whose design is the same. Nothing with no spot.
 */
export function drawPulse(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  spot: { x: number; y: number } | null,
  rings: readonly number[],
  intensity: number,
): void {
  const alpha = clamp01(intensity)
  const ball = spot
  if (alpha <= 0 || !ball) return
  const u = designUnit(t)
  const [bx, by] = worldToPx(ball.x, ball.y, t)
  ctx.save()
  ctx.lineWidth = PULSE_LINE_PX * u
  for (let i = PULSE_RINGS.length - 1; i >= 0; i--) {
    const k = alpha * clamp01(rings[i] ?? 0)
    if (k <= 0) continue
    const ring = PULSE_RINGS[i]!
    ctx.fillStyle = `rgba(255, 255, 255, ${PULSE_FILL_ALPHA * k})`
    ctx.beginPath()
    ctx.arc(bx, by, ring.fillR * u, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = `rgba(255, 255, 255, ${ring.lineAlpha * k})`
    ctx.beginPath()
    ctx.arc(bx, by, ring.lineR * u, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * The card: the label cards' band, title and icon slot, with 80 design pixels either side of the
 * title, as the design has it. The icon fills the slot as the design places it: inset 14.06% left,
 * 17.27% top, 14.84% right and 18.75% bottom.
 */
const SLOT_PX = 208
const FREE_KICK_ICON_BOX: CardBox = {
  left: SLOT_PX * 0.1406,
  top: SLOT_PX * 0.1727,
  width: SLOT_PX * (1 - 0.1406 - 0.1484),
  height: SLOT_PX * (1 - 0.1727 - 0.1875),
}
const PADDING_X_PX = 80

/**
 * Draw the free kick's card over everything else on the pitch, in frame units through the
 * context's current transform, in the theme's words, font and icon. It is centred in the shaded
 * half, a quarter of the pitch's length from the halfway line (339 design pixels, as both frames
 * have it), and no wider than that half: a longer title is shrunk to fit. With no ball known it is
 * centred on the pitch.
 */
export function drawFreeKickCard(
  ctx: CanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  banner: FreeKickBanner,
  theme: RenderTheme = DEFAULT_THEME,
): void {
  const alpha = clamp01(banner.intensity)
  if (alpha <= 0) return
  const u = designUnit(t)
  const side = freeKickSide(banner.ball)
  const [mx] = worldToPx(0, 0, t)
  const [cx] = worldToPx((side * resolvePitchDimensions(pd).length.value) / 4, 0, t)
  const maxWidthPx = side === 0 ? FRAME_W / u : (2 * Math.abs(cx - mx)) / u
  drawIconCard(
    ctx,
    t,
    cx,
    {
      title: theme.text.freeKick,
      font: theme.fonts.title,
      icon: banner.icon ?? theme.icons.freeKick,
      iconBox: FREE_KICK_ICON_BOX,
      paddingXPx: PADDING_X_PX,
      maxWidthPx,
      team: banner.team,
    },
    alpha,
  )
}
