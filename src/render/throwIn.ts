import type { Frame, PitchDimensions, Transform2D } from '../model/types.js'
import { frameHasAction } from '../analysis/actionLabels.js'
import { designUnit, resolvePitchDimensions, worldToPx } from './pitchGeometry.js'
import { drawEventBand, drawEventTitle, INTER_ASCENT, type TitleLayout } from './eventBanner.js'
import { FRAME_W } from './constants.js'
import { DEFAULT_THEME, type RenderTheme } from './theme.js'

/**
 * The throw-in, as the match-summary design shows it (Figma vp-pitch-2): a
 * small "THROW IN" band just above the bottom touchline, the players left as
 * they are. The widget's fades in and out where it stands (inPlace). The
 * reference's slides in from the side of the half the ball is in, and back
 * out the same way: the export does not say which team takes a throw-in, so
 * the side says where it is rather than whose it is.
 */
export interface ThrowInIndicator {
  /** 0 to 1: how far it has faded in, or, leaving, how much of it is left. */
  intensity: number
  /** 0 to 1: how far it has slid in from its side; 1 is in place. */
  slide: number
  /** The side it slides from: -1 the left, 1 the right, null in place. */
  side: -1 | 1 | null
  /**
   * Drawn where it stands, fading in and out, whatever `side` says: the
   * widget's throw-in. Default false, the reference's, which slides.
   */
  inPlace?: boolean
}

/**
 * How a throw-in is shown, in milliseconds: it fades in over THROW_IN_IN_MS,
 * stays until THROW_IN_SHOW_MS from the start, then fades out over
 * THROW_IN_OUT_MS. The reference's slides in and out over the same times.
 */
export const THROW_IN_IN_MS = 500
export const THROW_IN_SHOW_MS = 2000
export const THROW_IN_OUT_MS = 400

/**
 * The label flickers on and off over a few records around one throw-in: it
 * has to have been off for this long, in seconds of replay time, before it
 * counts as a new one.
 */
export const THROW_IN_REARM_S = 5

/**
 * Whether the pipeline labelled this frame a throw-in, however the export
 * writes it ("Throw in", "EventType.THROW_IN"; see actionName).
 */
export function isThrowInFrame(frame: Frame): boolean {
  return frameHasAction(frame, 'throw in')
}

/**
 * The band, in design pixels. Measured from the design's frame: 501 by 109,
 * its top 90 px above the middle of the bottom touchline, so its foot sits on
 * the grass just past the line. Centred on the pitch.
 */
const BAND_WIDTH_PX = 501
const BAND_HEIGHT_PX = 109
const BAND_TOP_ABOVE_TOUCHLINE_PX = 90
/** "THROW IN" (the theme's text.throwIn): its left edge, its baseline and its size. */
const TITLE_LEFT_PX = BAND_WIDTH_PX / 2 - 165.5
const TITLE_TOP_PX = 16
const TITLE_BASELINE_PX = TITLE_TOP_PX + 64 * INTER_ASCENT
const TITLE_FONT_PX = 64
/**
 * The design centres "THROW IN" on the band. Another title is centred there
 * too, and every title keeps the clearance it has above it from the band's
 * sides; "THROW IN" fits at its full size (TitleLayout).
 */
const TITLE_LAYOUT: TitleLayout = {
  word: DEFAULT_THEME.text.throwIn,
  leftPx: TITLE_LEFT_PX,
  centrePx: BAND_WIDTH_PX / 2,
  bandWidthPx: BAND_WIDTH_PX,
  insetPx: TITLE_TOP_PX,
}

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))
const easeOutCubic = (k: number) => 1 - (1 - k) ** 3

/**
 * Draw the throw-in indicator over everything else on the pitch, in frame
 * units through the context's current transform, in the theme's words and
 * font. Sliding, it starts wholly past the frame's edge on its side.
 */
export function drawThrowInIndicator(
  ctx: CanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  ind: ThrowInIndicator,
  theme: RenderTheme = DEFAULT_THEME,
): void {
  const alpha = clamp01(ind.intensity)
  if (alpha <= 0) return
  const u = designUnit(t)
  const width = BAND_WIDTH_PX * u
  const halfWidth = resolvePitchDimensions(pd).width.value / 2
  const [cx, touchline] = worldToPx(0, halfWidth, t)
  const travel = FRAME_W / 2 + width / 2
  const offset = ind.side === null || ind.inPlace ? 0 : ind.side * travel * (1 - easeOutCubic(clamp01(ind.slide)))
  const left = cx + offset - width / 2
  const top = touchline - BAND_TOP_ABOVE_TOUCHLINE_PX * u

  ctx.save()
  ctx.globalAlpha = alpha
  drawEventBand(ctx, left, top, width, BAND_HEIGHT_PX * u)
  drawEventTitle(
    ctx,
    t,
    theme.text.throwIn,
    left,
    top + TITLE_BASELINE_PX * u,
    TITLE_FONT_PX,
    TITLE_LAYOUT,
    theme.fonts.title,
  )
  ctx.restore()
}
