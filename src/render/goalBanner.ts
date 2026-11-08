import type { Transform2D } from '../model/types.js'
import { FRAME_W } from './constants.js'
import { CARD_MIDDLE_PX, INTER_ASCENT, drawCentreCard, drawEventBand, drawEventTitle, type TitleLayout } from './eventBanner.js'
import { designUnit, worldToPx } from './pitchGeometry.js'
import { DEFAULT_THEME, type RenderTheme } from './theme.js'
import { GOAL_SEQUENCE_MS, type GoalPlan } from '../analysis/goalSequence.js'

/**
 * The goal's banner, as the match-summary design shows it (Figma "Game
 * Animation Visualizer", vp-pitch-3, eventGoal node 5:319): "GOAL" alone on
 * the dark band, in the half of the screen away from the goal. It slides in
 * from that side's edge towards the goal: left to right for a goal on the
 * right, right to left for one on the left.
 *
 * The reference's card is video-annotation's (vp-pitch-1, node 19:967):
 * "GOAL" and the ball-in-the-net icon on a band centred on the pitch, which
 * fades in where it stands. It is drawn for a banner with no `side`, as the
 * parity test gives it (test/parity/goldens.test.ts).
 *
 * The sequence zooms in on the shot and the net, so either is drawn fixed to
 * the frame rather than to the pitch: at the zoomed pitch's scale it would
 * cover the screen. And it comes in as the ball reaches the net, so the shot
 * itself is seen first.
 */
export interface GoalBanner {
  /** 0 to 1: how far it has faded in, or out. */
  intensity: number
  /**
   * The goal it went in: +1 the one on the right, -1 the one on the left. The
   * banner slides in from the other side. Without one, the reference's card.
   */
  side?: 1 | -1
  /** 0 to 1: how far it has slid in. Default 1, in place. */
  slide?: number
  /** The reference card's goal-net icon. Without one it is drawn without it, as the parity test draws it. */
  icon?: CanvasImageSource | null
}

/** Fading in from the ball reaching the net, and out over the end of the sequence, as the camera eases back. */
export const GOAL_BANNER_IN_MS = 300
export const GOAL_BANNER_OUT_MS = 400
/** And sliding in, from the ball reaching the net, slowing as it arrives. */
export const GOAL_BANNER_SLIDE_MS = 600

/**
 * The banner's band, 736 by 230 design pixels, its top 325 above the pitch's
 * middle; "GOAL", 160 px, 13 px down from its top and centred on it. It rests
 * centred on the middle of its half of the screen, as the design has it in a
 * frame twice its width.
 */
const BAND_WIDTH_PX = 736
const BAND_HEIGHT_PX = 230
const BAND_TOP_PX = -325
const TITLE_PX = 160
const TITLE_TOP_PX = 13
const TITLE_LAYOUT: TitleLayout = {
  word: DEFAULT_THEME.text.goal,
  leftPx: BAND_WIDTH_PX / 2 - 232,
  centrePx: BAND_WIDTH_PX / 2,
  bandWidthPx: BAND_WIDTH_PX,
  insetPx: TITLE_TOP_PX,
}

/**
 * The icon's drawing: inset 12.5% left, 17.19% top, 17.41% right and 15.78%
 * bottom in its 219 px slot at (265, 124), and drawn a little past that box
 * on every side (2.52%, 2.42%, 2.23%, 2.33%), as the design has it, so the
 * net's outline is not cut.
 */
const SLOT_PX = 219
const INSET = { left: 0.125, top: 0.1719, right: 0.1741, bottom: 0.1578 }
const BLEED = { left: 0.0252, top: 0.0242, right: 0.0223, bottom: 0.0233 }
const INNER = {
  left: 265 + SLOT_PX * INSET.left,
  top: 124 + SLOT_PX * INSET.top,
  width: SLOT_PX * (1 - INSET.left - INSET.right),
  height: SLOT_PX * (1 - INSET.top - INSET.bottom),
}
/** "GOAL" is the theme's text.goal. */
const GOAL_CARD = {
  designTitle: DEFAULT_THEME.text.goal,
  titleLeftPx: CARD_MIDDLE_PX - 133,
  iconBox: {
    left: INNER.left - INNER.width * BLEED.left,
    top: INNER.top - INNER.height * BLEED.top,
    width: INNER.width * (1 + BLEED.left + BLEED.right),
    height: INNER.height * (1 + BLEED.top + BLEED.bottom),
  },
}

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))
const easeOutCubic = (k: number) => 1 - (1 - k) ** 3

/** How strongly the card shows `elapsedMs` into the sequence planned by `plan`. */
export function goalBannerIntensity(plan: GoalPlan, elapsedMs: number): number {
  const coming = (elapsedMs - plan.shotMs) / GOAL_BANNER_IN_MS
  const going = (GOAL_SEQUENCE_MS - elapsedMs) / GOAL_BANNER_OUT_MS
  return clamp01(Math.min(coming, going))
}

/** How far the banner has slid in `elapsedMs` into the sequence planned by `plan`, before easing. */
export function goalBannerSlide(plan: GoalPlan, elapsedMs: number): number {
  return clamp01((elapsedMs - plan.shotMs) / GOAL_BANNER_SLIDE_MS)
}

/**
 * Draw the goal's banner, in frame units through the context's current
 * transform: the caller sets one without the view, so it stays put while the
 * pitch zooms behind it. In the theme's words and font.
 */
export function drawGoalBanner(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  banner: GoalBanner,
  theme: RenderTheme = DEFAULT_THEME,
): void {
  const alpha = clamp01(banner.intensity)
  if (banner.side === undefined) {
    const card = { ...GOAL_CARD, title: theme.text.goal, font: theme.fonts.title, icon: banner.icon ?? null }
    drawCentreCard(ctx, t, card, alpha)
    return
  }
  if (alpha <= 0) return
  const u = designUnit(t)
  const width = BAND_WIDTH_PX * u
  // In the half away from the goal, coming in from past that half's edge of the frame.
  const away = -banner.side
  const rest = FRAME_W / 2 + (away * FRAME_W) / 4
  const from = away > 0 ? FRAME_W + width / 2 : -width / 2
  const middle = from + (rest - from) * easeOutCubic(clamp01(banner.slide ?? 1))
  const left = middle - width / 2
  const [, cy] = worldToPx(0, 0, t)
  const top = cy + BAND_TOP_PX * u
  ctx.save()
  ctx.globalAlpha = alpha
  drawEventBand(ctx, left, top, width, BAND_HEIGHT_PX * u)
  const baseline = top + (TITLE_TOP_PX + TITLE_PX * INTER_ASCENT) * u
  drawEventTitle(ctx, t, theme.text.goal, left, baseline, TITLE_PX, TITLE_LAYOUT, theme.fonts.title)
  ctx.restore()
}
