import type { Transform2D } from '../model/types'
import { designUnit, worldToPx } from './pitchGeometry'
import { fitFontPx, measureWidth } from './fitText'
import { DEFAULT_THEME } from './theme'

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

/** The titles' family list unless a theme gives another: Inter, bundled (theme.ts). */
export const EVENT_TITLE_FONT = DEFAULT_THEME.fonts.title
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
 * Where a band's title goes, in design pixels from the band's left edge. The
 * design lays out one English word: that word is drawn exactly where the
 * design has it. Any other text, a translation or an override, is centred on
 * the middle of the design's word, where the eye expects the title. Either
 * way, the title keeps `insetPx` clear of the band's sides, as it does above
 * it, and is drawn smaller to fit if it would not (fitText.ts).
 */
export interface TitleLayout {
  /** The design's word ("GOAL", "FREE KICK", "THROW IN"). */
  word: string
  /** The design's word's left edge. */
  leftPx: number
  /** The design's word's middle. */
  centrePx: number
  bandWidthPx: number
  insetPx: number
}

/**
 * Write an event's name, `sizePx` design pixels high, in its band whose left
 * edge is at `bandLeft`, with its baseline at `baseline`, in frame units, in
 * the family list `font`, as `layout` places it.
 */
export function drawEventTitle(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  text: string,
  bandLeft: number,
  baseline: number,
  sizePx: number,
  layout: TitleLayout,
  font: string = EVENT_TITLE_FONT,
): void {
  const u = designUnit(t)
  const fontAt = (px: number) => `italic 900 ${px * u}px ${font}`
  const own = text === layout.word
  const maxWidthPx = own
    ? layout.bandWidthPx - layout.insetPx - layout.leftPx
    : layout.bandWidthPx - 2 * layout.insetPx
  const px = fitFontPx(ctx, text, fontAt, sizePx, maxWidthPx * u)
  const x = own
    ? bandLeft + layout.leftPx * u
    : bandLeft + layout.centrePx * u - measureWidth(ctx, text, fontAt(px)) / 2
  // A shadow is drawn in the bitmap's pixels, whatever the transform.
  const scale = ctx.getTransform().a * u
  ctx.shadowColor = TITLE_SHADOW_COLOR
  ctx.shadowBlur = TITLE_SHADOW_BLUR_PX * scale
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = TITLE_SHADOW_Y_PX * scale
  ctx.font = fontAt(px)
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
  /** The title's family list. Default EVENT_TITLE_FONT. */
  font?: string | undefined
  /** The English word the design lays out on the card (TitleLayout). */
  designTitle: string
  /** The design's word's left edge, in design pixels from the card's. */
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
const CARD_TITLE_TOP_PX = 13
const CARD_TITLE_BASELINE_PX = CARD_TITLE_TOP_PX + CARD_TITLE_PX * INTER_ASCENT
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
  // The design centres both its words on the card's middle. A title keeps
  // the clearance it has above it from the card's sides; every English
  // title fits at its full size.
  const layout: TitleLayout = {
    word: card.designTitle,
    leftPx: card.titleLeftPx,
    centrePx: CARD_MIDDLE_PX,
    bandWidthPx: CARD_WIDTH_PX,
    insetPx: CARD_TITLE_TOP_PX,
  }
  drawEventTitle(ctx, t, card.title, left, top + CARD_TITLE_BASELINE_PX * u, CARD_TITLE_PX, layout, card.font)
  if (card.icon) {
    const box = card.iconBox
    ctx.drawImage(card.icon, left + box.left * u, top + box.top * u, box.width * u, box.height * u)
  }
  ctx.restore()
}
