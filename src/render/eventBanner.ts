import type { Transform2D } from '../model/types'
import { designUnit, worldToPx } from './pitchGeometry'

/**
 * What the match-summary design's event banners share (Figma "Game Animation
 * Visualizer", the eventGoal frames on vp-pitch-1 and vp-pitch-2): a band in
 * the design's dark green, solid through the middle and clear at each end,
 * with the event's name in white Inter Black Italic over it. Sizes are in
 * design pixels (designUnit), so a banner keeps its size against the pitch at
 * any zoom.
 */

/** The band's colour, solid from a quarter of the way across to three quarters, clear at each end. */
const BAND_RGB = '12, 63, 47'
const BAND_SOLID_FROM = 0.25
const BAND_SOLID_TO = 0.75481

export const EVENT_TITLE_FONT = 'Inter, sans-serif'
/** Inter's ascent as a share of its size: the baseline below the top of a line box. */
export const INTER_ASCENT = 0.96875
/** The title's shadow: 0 4px 24px, black at 15%. */
const TITLE_SHADOW_Y_PX = 4
const TITLE_SHADOW_BLUR_PX = 24
const TITLE_SHADOW_COLOR = 'rgba(0, 0, 0, 0.15)'

/** Fill the band, in frame units, at the context's current alpha. */
export function drawEventBand(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const band = ctx.createLinearGradient(left, 0, left + width, 0)
  band.addColorStop(0, `rgba(${BAND_RGB}, 0)`)
  band.addColorStop(BAND_SOLID_FROM, `rgb(${BAND_RGB})`)
  band.addColorStop(BAND_SOLID_TO, `rgb(${BAND_RGB})`)
  band.addColorStop(1, `rgba(${BAND_RGB}, 0)`)
  ctx.fillStyle = band
  ctx.fillRect(left, top, width, height)
}

/**
 * Write an event's name, `sizePx` design pixels high, its left edge at `x`
 * and its baseline at `baseline`, in frame units.
 */
export function drawEventTitle(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  text: string,
  x: number,
  baseline: number,
  sizePx: number,
): void {
  const u = designUnit(t)
  // A shadow is drawn in the bitmap's pixels, whatever the transform.
  const scale = ctx.getTransform().a * u
  ctx.shadowColor = TITLE_SHADOW_COLOR
  ctx.shadowBlur = TITLE_SHADOW_BLUR_PX * scale
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = TITLE_SHADOW_Y_PX * scale
  ctx.font = `italic 900 ${sizePx * u}px ${EVENT_TITLE_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, x, baseline)
  ctx.shadowColor = 'transparent'
}

/** A box inside a card, in design pixels from the card's top left corner. */
export interface CardBox {
  left: number
  top: number
  width: number
  height: number
}

/** What a centred event card shows: its title, and its icon once loaded. */
export interface CentreCard {
  title: string
  /** The title's left edge, in design pixels from the card's. */
  titleLeftPx: number
  icon?: CanvasImageSource | null | undefined
  /** Where the icon's drawing goes. */
  iconBox: CardBox
}

/**
 * The card's band, 736 by 373 design pixels and centred on the pitch, and
 * its title: 92 px, 13 px down from the band's top (vp-pitch-1).
 */
const CARD_WIDTH_PX = 736
const CARD_HEIGHT_PX = 373
const CARD_TITLE_PX = 92
const CARD_TITLE_BASELINE_PX = 13 + CARD_TITLE_PX * INTER_ASCENT
/** The card's middle, in design pixels from its left edge, for laying titles out from. */
export const CARD_MIDDLE_PX = CARD_WIDTH_PX / 2

/**
 * Draw a centred event card - the free kick's, the goal's - at `alpha`, in
 * frame units through the context's current transform.
 */
export function drawCentreCard(ctx: CanvasRenderingContext2D, t: Transform2D, card: CentreCard, alpha: number): void {
  if (alpha <= 0) return
  const u = designUnit(t)
  const [cx, cy] = worldToPx(0, 0, t)
  const left = cx - (CARD_WIDTH_PX / 2) * u
  const top = cy - (CARD_HEIGHT_PX / 2) * u

  ctx.save()
  ctx.globalAlpha = alpha
  drawEventBand(ctx, left, top, CARD_WIDTH_PX * u, CARD_HEIGHT_PX * u)
  drawEventTitle(ctx, t, card.title, left + card.titleLeftPx * u, top + CARD_TITLE_BASELINE_PX * u, CARD_TITLE_PX)
  if (card.icon) {
    const box = card.iconBox
    ctx.drawImage(card.icon, left + box.left * u, top + box.top * u, box.width * u, box.height * u)
  }
  ctx.restore()
}
