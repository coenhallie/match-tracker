import type { Transform2D } from '../model/types.js'
import { CARD_MIDDLE_PX, INTER_ASCENT, drawCentreCard, drawEventBand, drawEventTitle, interBaselinePx, type TitleLayout } from './eventBanner.js'
import { fitText, measureWidth } from './fitText.js'
import { PLAYER_SHADOW, TEAM_SHADOW, setLineShadow } from './labelCard.js'
import { designUnit } from './pitchGeometry.js'
import { DEFAULT_THEME, type RenderTheme } from './theme.js'
import { GOAL_SEQUENCE_MS, type GoalPlan } from '../analysis/goalSequence.js'
import { FRAME_H, FRAME_W, worldToPx } from '../model/pitch.js'

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
 *
 * Once the scorer is known, the banner has them under it, in a band of their
 * own at the foot of the frame (drawScorerBand). The reference's card has none.
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
  /** Who scored, written in a band at the foot of the frame, once known; only under a banner with a side. */
  scorer?: GoalScorer & {
    /** 0 to 1: how far it has faded in, or out with the banner. */
    intensity: number
  }
}

/** The scorer, in the words drawn: their name or shirt number, and their team's name, each null when not known. */
export interface GoalScorer {
  player: string | null
  team: string | null
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

/**
 * The scorer's band (Figma "Game Animation Visualizer", viewport/eventGoalScorerInfo 149:2940,
 * bannerPlayerInfo 149:3090), in design pixels: the event band, 274 high, at 85%, across the foot
 * of the frame, as across the foot of the design's 1600 by 1100 frame from 826 down. That frame is
 * taller than ours for the pitch, so the band keeps to our frame's foot and width, not to where the
 * design's would be against the pitch, which is below ours. In it, 48 down, a 64 px
 * row centred as a whole: the scorer's icon, its drawing inset 10.94% left and 15.57% top in a
 * 56 px badge 4 down the row, and 80 from the row's start the player's name, Inter Semi Bold,
 * 40 px, centred on the row. 136 down, the team's name, Inter Black, 48 px, centred, its baseline
 * 46.5 into its 58 px line, as the label cards' team line has it. Both white, with the label cards'
 * shadows. Each is kept to the band's solid middle, 800 wide: a longer one is drawn smaller, then
 * cut short (fitText).
 */
const SCORER_BAND_HEIGHT_PX = 274
const SCORER_BAND_ALPHA = 0.85
const SCORER_ROW_TOP_PX = 48
const SCORER_ROW_PX = 64
const SCORER_BADGE_TOP_PX = 4
const SCORER_BADGE_PX = 56
const SCORER_ICON_INSET = { left: 0.1094, top: 0.1557 }
/** The icon's drawing, as its SVG's box has it (icons.ts). */
const SCORER_ICON_W_PX = 41.1129
const SCORER_ICON_H_PX = 39.319
const SCORER_NAME_LEFT_PX = 80
const SCORER_NAME_PX = 40
const SCORER_TEAM_BASELINE_PX = 136 + 46.5
const SCORER_TEAM_PX = 48
const SCORER_MAX_WIDTH_PX = 800

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
  if (banner.scorer) drawScorerBand(ctx, t, banner.scorer, theme)
}

/**
 * The scorer's band at the foot of the frame, at `scorer.intensity`, in frame units through the
 * context's current transform: the player's row, if they are named, and the team's line, if it is.
 * Nothing when neither is.
 */
function drawScorerBand(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  scorer: NonNullable<GoalBanner['scorer']>,
  theme: RenderTheme,
): void {
  const alpha = clamp01(scorer.intensity)
  if (alpha <= 0 || (scorer.player === null && scorer.team === null)) return
  const u = designUnit(t)
  const cx = FRAME_W / 2
  const top = FRAME_H - SCORER_BAND_HEIGHT_PX * u
  const maxWidth = SCORER_MAX_WIDTH_PX * u
  const family = theme.fonts.title
  ctx.save()
  ctx.globalAlpha = alpha * SCORER_BAND_ALPHA
  drawEventBand(ctx, 0, top, FRAME_W, SCORER_BAND_HEIGHT_PX * u)
  ctx.globalAlpha = alpha
  setLineShadow(ctx, u)
  if (scorer.player !== null) {
    const nameFont = (px: number) => `600 ${px}px ${family}`
    const lead = SCORER_NAME_LEFT_PX * u
    const name = fitText(ctx, scorer.player, nameFont, SCORER_NAME_PX * u, maxWidth - lead)
    const rowLeft = cx - (lead + measureWidth(ctx, name.text, nameFont(name.px))) / 2
    const rowTop = top + SCORER_ROW_TOP_PX * u
    const icon = theme.icons.scorer
    if (icon) {
      const badgeTop = rowTop + SCORER_BADGE_TOP_PX * u
      ctx.shadowColor = 'transparent'
      ctx.drawImage(
        icon,
        rowLeft + SCORER_BADGE_PX * SCORER_ICON_INSET.left * u,
        badgeTop + SCORER_BADGE_PX * SCORER_ICON_INSET.top * u,
        SCORER_ICON_W_PX * u,
        SCORER_ICON_H_PX * u,
      )
    }
    ctx.font = nameFont(name.px)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = PLAYER_SHADOW
    ctx.fillText(name.text, rowLeft + lead, rowTop + interBaselinePx(SCORER_NAME_PX, SCORER_ROW_PX) * u)
  }
  if (scorer.team !== null) {
    const teamFont = (px: number) => `900 ${px}px ${family}`
    const team = fitText(ctx, scorer.team, teamFont, SCORER_TEAM_PX * u, maxWidth)
    ctx.font = teamFont(team.px)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = TEAM_SHADOW
    ctx.fillText(team.text, cx, top + SCORER_TEAM_BASELINE_PX * u)
  }
  ctx.shadowColor = 'transparent'
  ctx.restore()
}
