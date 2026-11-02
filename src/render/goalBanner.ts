import type { Transform2D } from '../model/types'
import { CARD_MIDDLE_PX, drawCentreCard } from './eventBanner'
import { GOAL_SEQUENCE_MS, type GoalPlan } from '../analysis/goalSequence'

/**
 * The goal's card, as the match-summary design shows it (vp-pitch-1, node
 * 19:967): "GOAL" and the ball-in-the-net icon on the dark band, shown over
 * the goal sequence.
 *
 * The sequence zooms in on the shot and the net, so the card is drawn fixed
 * to the frame rather than to the pitch: at the zoomed pitch's scale it would
 * cover the screen. And it comes in as the ball reaches the net, so the shot
 * itself is seen first.
 */
export interface GoalBanner {
  /** 0 to 1: how far it has faded in, or out. */
  intensity: number
  /** The goal icon, once it has loaded. Until then the card is drawn without it. */
  icon?: CanvasImageSource | null
}

/** Fading in from the ball reaching the net, and out over the end of the sequence, as the camera eases back. */
export const GOAL_BANNER_IN_MS = 300
export const GOAL_BANNER_OUT_MS = 400

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
const GOAL_CARD = {
  title: 'GOAL',
  titleLeftPx: CARD_MIDDLE_PX - 133,
  iconBox: {
    left: INNER.left - INNER.width * BLEED.left,
    top: INNER.top - INNER.height * BLEED.top,
    width: INNER.width * (1 + BLEED.left + BLEED.right),
    height: INNER.height * (1 + BLEED.top + BLEED.bottom),
  },
}

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))

/** How strongly the card shows `elapsedMs` into the sequence planned by `plan`. */
export function goalBannerIntensity(plan: GoalPlan, elapsedMs: number): number {
  const coming = (elapsedMs - plan.shotMs) / GOAL_BANNER_IN_MS
  const going = (GOAL_SEQUENCE_MS - elapsedMs) / GOAL_BANNER_OUT_MS
  return clamp01(Math.min(coming, going))
}

/**
 * Draw the goal's card, in frame units through the context's current
 * transform: the caller sets one without the view, so it stays put while the
 * pitch zooms behind it.
 */
export function drawGoalBanner(ctx: CanvasRenderingContext2D, t: Transform2D, banner: GoalBanner): void {
  drawCentreCard(ctx, t, { ...GOAL_CARD, icon: banner.icon }, clamp01(banner.intensity))
}
