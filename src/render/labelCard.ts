import type { Frame, Transform2D } from '../model/types.js'
import { labelCard, labelCardTextKey, type IconCardKey, type LabelCardKey } from '../model/labelCards.js'
import { frameHasAction } from '../analysis/actionLabels.js'
import { FRAME_W } from './constants.js'
import { drawEventTitle, interBaselinePx, type CardBox, type TitleLayout } from './eventBanner.js'
import { measureWidth, wrapText } from './fitText.js'
import { designUnit, worldToPx } from './pitchGeometry.js'
import { drawSmallCard } from './smallCard.js'
import type { PitchDimensions } from '../model/types.js'
import { DEFAULT_THEME, type RenderTheme } from './theme.js'
import { THROW_IN_IN_MS, THROW_IN_REARM_S, THROW_IN_SHOW_MS } from './throwIn.js'

/**
 * A label card (labelCards.ts in model), as the match-summary design shows it
 * (Figma "Game Animation Visualizer", viewport/eventVarCheck, banner 75:2246,
 * viewport/eventGoalDisallowed, banner 80:3853, and viewport/eventHalfTime,
 * banner 81:4327): a title over an icon or a short text on a dark band centred
 * on the pitch. The band hugs its title, so any card's words fit it; only the
 * words and what is under them change from card to card. Everyone on the pitch,
 * the ball and its trail fade out as it fades in, as for the corner, and back
 * as it goes (renderer.ts).
 */
export interface LabelCardIndicator {
  key: LabelCardKey
  /**
   * 0 to 1: how far it has faded in, or, leaving, how much of it is left. It is
   * also how far everyone on the pitch and the ball have faded out.
   */
  intensity: number
  /** Its icon, if it has one, once it has loaded. Until then it is drawn without it. Default the theme's. */
  icon?: CanvasImageSource | null
}

/**
 * How a small label card is shown: as the throw-in is (throwIn.ts), fading in
 * over SMALL_CARD_IN_MS, staying until SMALL_CARD_SHOW_MS from the start whatever
 * its label does, and fading out over LABEL_CARD_OUT_MS. It counts as a new one
 * after SMALL_CARD_REARM_S off, as fouls and the like come close together.
 */
export const SMALL_CARD_IN_MS = THROW_IN_IN_MS
export const SMALL_CARD_SHOW_MS = THROW_IN_SHOW_MS
export const SMALL_CARD_REARM_S = THROW_IN_REARM_S

/**
 * How a label card is shown: it fades in over LABEL_CARD_IN_MS, stays for at
 * least LABEL_CARD_SHOW_MS from the start and after that for as long as its
 * label is on, then fades out over LABEL_CARD_OUT_MS. Played by hand, it is
 * on screen for LABEL_CARD_DEMO_MS, fading in and out included. A card that
 * stays until the next label does so however it was played, for as long as
 * that takes, and then fades out over LABEL_CARD_OUT_MS.
 */
export const LABEL_CARD_IN_MS = 400
export const LABEL_CARD_SHOW_MS = 2000
export const LABEL_CARD_OUT_MS = 400
export const LABEL_CARD_DEMO_MS = 4000

/**
 * The label can flicker on and off over one event: it has to have been off
 * for this long, in seconds of replay time, before it counts as a new one.
 */
export const LABEL_CARD_REARM_S = 15

/** Whether a human labelled this frame with one of `names`, however the export writes it (actionName). */
export function isLabelCardFrame(frame: Frame, names: readonly string[]): boolean {
  return names.some((name) => frameHasAction(frame, name))
}

/**
 * The card's layout, in design pixels (designUnit), as the design's auto
 * layout has it: 190 either side of the title and 16 above it, below the icon
 * and between the two. The title is 92 px on a 128 px line; the icon's slot
 * is 208 px square, centred. A short text starts 16 px down in that slot: Inter
 * Semi Bold at 40 px on 48 px lines, wrapped to 480 px, each line centred, with
 * room for as many lines as fit above the card's foot.
 */
const PADDING_X_PX = 190
const PADDING_Y_PX = 16
const GAP_PX = 16
const TITLE_PX = 92
const TITLE_LINE_PX = 128
const ICON_SLOT_PX = 208
const SLOT_TOP_PX = PADDING_Y_PX + TITLE_LINE_PX + GAP_PX
const CARD_HEIGHT_PX = SLOT_TOP_PX + ICON_SLOT_PX + PADDING_Y_PX
const TEXT_TOP_PX = SLOT_TOP_PX + 16
const TEXT_PX = 40
const TEXT_LINE_PX = 48
const TEXT_WIDTH_PX = 480
const TEXT_MAX_LINES = Math.floor((CARD_HEIGHT_PX - TEXT_TOP_PX) / TEXT_LINE_PX)

/**
 * Where each card's icon goes in its slot, in design pixels from the slot's
 * top left corner, as its design places it. The VAR check's eye: inset 19.92%
 * from the top and 7.81% each side. The goal disallowed's struck-through goal:
 * centred, its 149.5 px inset 14.06% all round.
 */
const LABEL_CARD_ICON_BOXES: Record<IconCardKey, CardBox> = {
  varCheck: { left: 16.25, top: 41.436, width: 175.5, height: 94.25 },
  goalDisallowed: { left: 29.25, top: 29.25, width: 149.5, height: 149.5 },
}

const TITLE_BASELINE_PX = PADDING_Y_PX + interBaselinePx(TITLE_PX, TITLE_LINE_PX)

/** The band's colour, and its opacity across it: clear at each end, solid at its middle. */
const BAND_RGB = '12, 63, 47'
const BAND_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.19712, 0.95],
  [0.5, 1],
  [0.80288, 0.95],
  [1, 0],
]

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))

/**
 * Draw a label card over everything else on the pitch, in frame units through
 * the context's current transform, in the theme's words, fonts and icon. The
 * band is never wider than the frame: a title too long for that is shrunk to
 * fit (drawEventTitle).
 */
export function drawLabelCard(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  card: LabelCardIndicator,
  theme: RenderTheme = DEFAULT_THEME,
): void {
  const alpha = clamp01(card.intensity)
  if (alpha <= 0) return
  const u = designUnit(t)
  const title = theme.text[card.key]
  const font = theme.fonts.title
  const titleWidthPx = measureWidth(ctx, title, `italic 900 ${TITLE_PX * u}px ${font}`) / u
  const spec = labelCard(card.key)
  const contentPx = Math.max(titleWidthPx, spec.below === 'icon' ? ICON_SLOT_PX : TEXT_WIDTH_PX)
  const widthPx = Math.min(FRAME_W / u, contentPx + 2 * PADDING_X_PX)
  const [cx, cy] = worldToPx(0, 0, t)
  const left = cx - (widthPx / 2) * u
  const top = cy - (CARD_HEIGHT_PX / 2) * u
  const width = widthPx * u

  ctx.save()
  ctx.globalAlpha = alpha
  const band = ctx.createLinearGradient(left, 0, left + width, 0)
  for (const [at, opacity] of BAND_STOPS) band.addColorStop(at, `rgba(${BAND_RGB}, ${opacity})`)
  ctx.fillStyle = band
  ctx.fillRect(left, top, width, CARD_HEIGHT_PX * u)
  const layout: TitleLayout = { word: null, leftPx: 0, centrePx: widthPx / 2, bandWidthPx: widthPx, insetPx: PADDING_X_PX }
  drawEventTitle(ctx, t, title, left, top + TITLE_BASELINE_PX * u, TITLE_PX, layout, font)
  if (spec.below === 'icon') {
    const icon = card.icon ?? theme.icons[spec.key]
    if (icon) {
      const box = LABEL_CARD_ICON_BOXES[spec.key]
      const slotLeft = cx - (ICON_SLOT_PX / 2) * u
      const slotTop = top + SLOT_TOP_PX * u
      ctx.drawImage(icon, slotLeft + box.left * u, slotTop + box.top * u, box.width * u, box.height * u)
    }
  } else if (spec.below === 'text') {
    const textFont = `600 ${TEXT_PX * u}px ${font}`
    const text = theme.text[labelCardTextKey(spec.key)]
    ctx.font = textFont
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#ffffff'
    wrapText(ctx, text, textFont, TEXT_WIDTH_PX * u, TEXT_MAX_LINES).forEach((line, i) => {
      ctx.fillText(line, cx, top + (TEXT_TOP_PX + i * TEXT_LINE_PX + interBaselinePx(TEXT_PX, TEXT_LINE_PX)) * u)
    })
  }
  ctx.restore()
}

/** Draw a small label card, in the theme's words and font (smallCard.ts). */
export function drawSmallLabelCard(
  ctx: CanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  card: LabelCardIndicator,
  theme: RenderTheme = DEFAULT_THEME,
): void {
  drawSmallCard(ctx, pd, t, theme.text[card.key], theme.fonts.title, clamp01(card.intensity))
}
