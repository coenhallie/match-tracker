import type { PitchDimensions, Transform2D } from '../model/types.js'
import { FRAME_W } from './constants.js'
import { drawEventBand, drawEventTitle, interBaselinePx, type TitleLayout } from './eventBanner.js'
import { measureWidth } from './fitText.js'
import { designUnit, resolvePitchDimensions, worldToPx } from './pitchGeometry.js'

/**
 * The small card, as the match-summary design shows it (Figma "Game Animation
 * Visualizer", the banner of viewport/eventThrowIn, node 75:368,
 * viewport/eventFoul, node 75:461, viewport/eventShotOnGoal, node 80:4078, and
 * viewport/eventHeaderOnGoal, node 80:4173): a title alone on a band along the
 * bottom touchline, the pitch left as it is. Only the words change.
 *
 * In design pixels, as the design's auto layout has it: 128 either side of the
 * title and 16 above and below it, the title 64 px on an 80 px line, its top 60
 * above the middle of the bottom touchline, so it stands across the line.
 */
const PADDING_X_PX = 128
const PADDING_Y_PX = 16
const TITLE_PX = 64
const TITLE_LINE_PX = 80
const HEIGHT_PX = PADDING_Y_PX + TITLE_LINE_PX + PADDING_Y_PX
const TOP_ABOVE_TOUCHLINE_PX = 60

/**
 * Draw a small card, `title` in the family list `font`, at `alpha`, over
 * everything else on the pitch, in frame units through the context's current
 * transform. The band hugs its title, and is never wider than the frame: a title
 * too long for that is shrunk to fit (drawEventTitle).
 */
export function drawSmallCard(
  ctx: CanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  title: string,
  font: string,
  alpha: number,
): void {
  if (alpha <= 0) return
  const u = designUnit(t)
  const titleWidthPx = measureWidth(ctx, title, `italic 900 ${TITLE_PX * u}px ${font}`) / u
  const widthPx = Math.min(FRAME_W / u, titleWidthPx + 2 * PADDING_X_PX)
  const [cx, touchline] = worldToPx(0, resolvePitchDimensions(pd).width.value / 2, t)
  const left = cx - (widthPx / 2) * u
  const top = touchline - TOP_ABOVE_TOUCHLINE_PX * u

  ctx.save()
  ctx.globalAlpha = alpha
  drawEventBand(ctx, left, top, widthPx * u, HEIGHT_PX * u)
  const layout: TitleLayout = { word: null, leftPx: 0, centrePx: widthPx / 2, bandWidthPx: widthPx, insetPx: PADDING_X_PX }
  const baseline = top + (PADDING_Y_PX + interBaselinePx(TITLE_PX, TITLE_LINE_PX)) * u
  drawEventTitle(ctx, t, title, left, baseline, TITLE_PX, layout, font)
  ctx.restore()
}
