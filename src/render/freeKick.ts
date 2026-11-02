import type { Frame, Transform2D } from '../model/types'
import { frameHasAction } from '../analysis/actionLabels'
import { CARD_MIDDLE_PX, drawCentreCard } from './eventBanner'

/**
 * The free kick, as the match-summary design shows it: "FREE KICK" and the
 * free kick icon on a dark band across the middle of the pitch, the players
 * faded out.
 *
 * A free kick is usually prepared off camera: the broadcast cuts away, and the
 * data stops moving, either holding everyone where they were or stopping
 * altogether. So the banner stays for as long as that lasts, and goes once
 * play is back.
 */
export interface FreeKickBanner {
  /** 0 to 1: how far the banner has faded in, or, leaving, how much of it is left. */
  intensity: number
  /** 0 to 1: how far everyone on the pitch has faded out. */
  playersFade: number
  /** The free kick icon, once it has loaded. Until then the banner is drawn without it. */
  icon?: CanvasImageSource | null
}

/**
 * How a free kick is shown: it fades in over FREE_KICK_IN_MS, stays for at
 * least FREE_KICK_SHOW_MS from the start, and after that for as long as the
 * label is on or play is stopped, then fades out over FREE_KICK_OUT_MS.
 */
export const FREE_KICK_IN_MS = 400
export const FREE_KICK_SHOW_MS = 2000
export const FREE_KICK_OUT_MS = 400

/**
 * How long a free kick played by hand from the demo controls is on screen,
 * fading in and out included. It has no label or cutaway to wait on, so it
 * runs for a set time, for recording.
 */
export const FREE_KICK_DEMO_MS = 4000

/**
 * Play counts as stopped once nobody has moved for this long, in seconds of
 * replay time, or while the ball is not tracked. In play the tracking moves
 * someone in every record, 25 a second; off camera it repeats the last
 * positions exactly, or has no records, and it loses the ball first, as the
 * broadcast goes to a close-up.
 */
export const FREE_KICK_STALL_S = 0.3

/**
 * The label counts as still on until it has been off for this long, in
 * seconds of replay time: it drops out for a record or two at a time, and the
 * broadcast often cuts away just as it goes, before play can be seen to stop.
 */
export const FREE_KICK_LABEL_HOLD_S = 0.5

/**
 * The label flickers on and off over a few records around one free kick: it
 * has to have been off for this long, in seconds of replay time, before it
 * counts as a new one.
 */
export const FREE_KICK_REARM_S = 5

/**
 * Whether the pipeline labelled this frame a free kick, however the export
 * writes it ("Free kick", "EventType.FREE_KICK"; see actionName).
 */
export function isFreeKickFrame(frame: Frame): boolean {
  return frameHasAction(frame, 'free kick')
}

const POSITION_EPSILON_METRES = 1e-6

/** Everyone's position in the frame, and the ball's, by who they are. */
function positions(frame: Frame): Map<string, { x: number; y: number }> {
  const at = new Map<string, { x: number; y: number }>()
  for (const team of frame.teams ?? []) {
    ;(team.players ?? []).forEach((player, i) => {
      const c = player.projected_coordinates
      if (typeof c?.x !== 'number' || typeof c?.y !== 'number') return
      at.set(`${team.team_id}:${player.track_id ?? `#${i}`}`, { x: c.x, y: c.y })
    })
  }
  ;(frame.balls ?? []).forEach((ball, i) => {
    const c = ball.projected_coordinates
    if (typeof c?.x === 'number' && typeof c?.y === 'number') at.set(`ball:${i}`, { x: c.x, y: c.y })
  })
  return at
}

/**
 * Whether anyone, or the ball, is somewhere else in `next` than in `prev`:
 * moved, appeared or gone. Two frames with nobody in either have not moved.
 */
export function playMoved(prev: Frame, next: Frame): boolean {
  const a = positions(prev)
  const b = positions(next)
  if (a.size !== b.size) return true
  for (const [key, p] of b) {
    const q = a.get(key)
    if (!q) return true
    if (Math.abs(p.x - q.x) > POSITION_EPSILON_METRES || Math.abs(p.y - q.y) > POSITION_EPSILON_METRES) {
      return true
    }
  }
  return false
}

/**
 * The free kick's card (vp-pitch-1, node 5:22): "FREE KICK", and the free
 * kick icon inset in its 219 px slot at (265, 124) as the design places it.
 */
const ICON_SLOT_PX = 219
const FREE_KICK_CARD = {
  title: 'FREE KICK',
  titleLeftPx: CARD_MIDDLE_PX - 232,
  iconBox: {
    left: 265 + ICON_SLOT_PX * 0.1406,
    top: 124 + ICON_SLOT_PX * 0.1727,
    width: ICON_SLOT_PX * (1 - 0.1406 - 0.1484),
    height: ICON_SLOT_PX * (1 - 0.1727 - 0.1875),
  },
}

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))

/**
 * Draw the free kick banner over everything else on the pitch, in frame units
 * through the context's current transform.
 */
export function drawFreeKickBanner(ctx: CanvasRenderingContext2D, t: Transform2D, banner: FreeKickBanner): void {
  drawCentreCard(ctx, t, { ...FREE_KICK_CARD, icon: banner.icon }, clamp01(banner.intensity))
}
