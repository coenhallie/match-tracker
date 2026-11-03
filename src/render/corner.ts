import type { Frame, PitchDimensions, Transform2D } from '../model/types.js'
import { frameHasAction } from '../analysis/actionLabels.js'
import { CARD_MIDDLE_PX, drawCentreCard } from './eventBanner.js'
import { resolvePitchDimensions, tracePlayingArea, worldToPx } from './pitchGeometry.js'
import { DEFAULT_THEME, type RenderTheme } from './theme.js'

/**
 * The corner: "CORNER" and the corner icon on a dark card across the middle
 * of the pitch, everyone and the ball faded out, and the corner it is taken
 * from lit up as a cone of sections fanning out from the flag, each lighting
 * up after the one inside it, again and again while it shows.
 *
 * The reference has no corner: this is the widget's own, built on the
 * reference's free kick card (vp-pitch-1, node 5:22), which the widget no
 * longer shows. A corner is usually prepared off camera, so it is held while
 * play is stopped (setPiece.ts in director).
 */
export interface CornerBanner {
  /** 0 to 1: how far the card and the cone have faded in, or, leaving, how much of them is left. */
  intensity: number
  /** 0 to 1: how far everyone on the pitch has faded out. */
  playersFade: number
  /** 0 to 1: how far the ball and its trail have faded out, so nothing of play is left under the card. */
  ballFade: number
  /**
   * The corner the cone fans out from, by the signs of its x and y in pitch
   * metres: x -1 the left goal line, y 1 the bottom touchline. Null when
   * there is no ball to tell which corner: the card is shown alone.
   */
  corner: { x: -1 | 1; y: -1 | 1 } | null
  /** 0 to 1 for each of the cone's sections, from the flag out: how strongly it is lit (cornerSections). */
  sections: readonly number[]
  /**
   * The corner icon, once it has loaded. Until then the card is drawn
   * without it. Default the theme's.
   */
  icon?: CanvasImageSource | null
}

/**
 * How a corner is shown: it fades in over CORNER_IN_MS, stays for at least
 * CORNER_SHOW_MS from the start, and after that for as long as the label is
 * on or play is stopped, then fades out over CORNER_OUT_MS. Played by hand,
 * it is on screen for CORNER_DEMO_MS, fading in and out included.
 */
export const CORNER_IN_MS = 400
export const CORNER_SHOW_MS = 2000
export const CORNER_OUT_MS = 400
export const CORNER_DEMO_MS = 4000

/**
 * The label comes and goes around one corner, as it is set up, while the
 * broadcast cuts away, and as it is taken: it has to have been off for this
 * long, in seconds of replay time, before it counts as a new one. Longer than
 * the reference's free kick's 5 s: in the February export it is off for up to
 * 9 s within one corner, and the corners themselves are minutes apart.
 */
export const CORNER_REARM_S = 15

/** The names a corner's label goes by, bare (actionName): "Corner", "Corner kick", "EventType.CORNER_KICK". */
const CORNER_LABELS = ['corner', 'corner kick']

/** Whether the pipeline labelled this frame a corner, however the export writes it. */
export function isCornerFrame(frame: Frame): boolean {
  return CORNER_LABELS.some((name) => frameHasAction(frame, name))
}

/**
 * The cone's sections, by their outer edge's distance from the flag, in
 * metres. Each is wider than the one inside it, so the cone opens out. On a
 * 68 m pitch the outermost meets the goal line just outside the goal area,
 * and stays clear of the centred card.
 */
export const CORNER_SECTION_METRES = [7, 15, 24] as const

/**
 * How the sections light up, in ms. Each fades in over SECTION_IN_MS, the
 * next SECTION_STAGGER_MS after the one inside it, brightening past its rest
 * and settling to it. The wave runs out from the flag again every
 * SECTION_WAVE_MS while the corner shows, lighting each section to full over
 * SECTION_PULSE_MS before it settles back.
 */
export const SECTION_IN_MS = 300
export const SECTION_STAGGER_MS = 200
export const SECTION_WAVE_MS = 1600
export const SECTION_PULSE_MS = 700
/** How strongly a section is lit between waves: low enough that each wave reads. */
export const SECTION_REST = 0.4

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))

/**
 * How strongly each section of the cone is lit, `elapsedMs` into the corner,
 * from the flag out. Under reduced motion they are all lit, and stay still.
 */
export function cornerSections(elapsedMs: number, reducedMotion: boolean): number[] {
  return CORNER_SECTION_METRES.map((_, i) => {
    if (reducedMotion) return 1
    const local = elapsedMs - i * SECTION_STAGGER_MS
    if (local <= 0) return 0
    const lit = clamp01(local / SECTION_IN_MS)
    // 0 at the start and end of a pulse, 1 halfway, eased both ways.
    const p = local % SECTION_WAVE_MS
    const pulse = p < SECTION_PULSE_MS ? (1 - Math.cos((p / SECTION_PULSE_MS) * Math.PI * 2)) / 2 : 0
    return lit * (SECTION_REST + (1 - SECTION_REST) * pulse)
  })
}

/**
 * Each section's white fill when fully lit: at its inner edge and at its
 * outer edge. Strongest near the flag, fading out across the cone. Each
 * section grows stronger out to its edge, and the next starts fainter, so
 * the step between them divides the cone with no line drawn.
 */
const SECTION_FILL: ReadonlyArray<readonly [number, number]> = [
  [0.4, 0.78],
  [0.24, 0.56],
  [0.1, 0.36],
]

/**
 * Draw the corner's cone, under the players, in frame units through the
 * context's current transform: each section a ring round the flag, clipped to
 * the playing area, so only the quarter on the pitch shows.
 */
export function drawCornerCone(
  ctx: CanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  banner: CornerBanner,
): void {
  const alpha = clamp01(banner.intensity)
  const corner = banner.corner
  if (alpha <= 0 || !corner) return
  const R = resolvePitchDimensions(pd)
  const [cx, cy] = worldToPx((corner.x * R.length.value) / 2, (corner.y * R.width.value) / 2, t)

  ctx.save()
  tracePlayingArea(ctx, pd, t)
  ctx.clip()
  CORNER_SECTION_METRES.forEach((metres, i) => {
    const k = alpha * clamp01(banner.sections[i] ?? 0)
    if (k <= 0) return
    const inner = i === 0 ? 0 : CORNER_SECTION_METRES[i - 1]! * t.sc
    const outer = metres * t.sc
    const [fillIn, fillOut] = SECTION_FILL[i]!
    const fill = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer)
    fill.addColorStop(0, `rgba(255, 255, 255, ${fillIn * k})`)
    fill.addColorStop(1, `rgba(255, 255, 255, ${fillOut * k})`)
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(cx, cy, outer, 0, Math.PI * 2)
    // The hole, wound the other way, so the ring is filled and not the middle.
    if (inner > 0) ctx.arc(cx, cy, inner, Math.PI * 2, 0, true)
    ctx.fill()
  })
  ctx.restore()
}

/**
 * The corner's card: the reference's free kick card (vp-pitch-1, node 5:22),
 * with "CORNER" (the theme's text.corner) and the corner icon both centred
 * on it. The icon is the size of the free kick's, which the corner's drawing
 * is made to fill: its 219 px slot, inset 14.06% left, 17.27% top, 14.84%
 * right and 18.75% bottom.
 */
const ICON_SLOT_PX = 219
const ICON_WIDTH_PX = ICON_SLOT_PX * (1 - 0.1406 - 0.1484)
/** "CORNER" in the card's title font at its 92 px, measured: the word is centred on the card. */
const CORNER_TITLE_WIDTH_PX = 391.18
const CORNER_CARD = {
  designTitle: DEFAULT_THEME.text.corner,
  titleLeftPx: CARD_MIDDLE_PX - CORNER_TITLE_WIDTH_PX / 2,
  iconBox: {
    left: CARD_MIDDLE_PX - ICON_WIDTH_PX / 2,
    top: 124 + ICON_SLOT_PX * 0.1727,
    width: ICON_WIDTH_PX,
    height: ICON_SLOT_PX * (1 - 0.1727 - 0.1875),
  },
}

/**
 * Draw the corner's card over everything else on the pitch, in frame units
 * through the context's current transform, in the theme's words, font and icon.
 */
export function drawCornerCard(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  banner: CornerBanner,
  theme: RenderTheme = DEFAULT_THEME,
): void {
  const card = {
    ...CORNER_CARD,
    title: theme.text.corner,
    font: theme.fonts.title,
    icon: banner.icon ?? theme.icons.corner,
  }
  drawCentreCard(ctx, t, card, clamp01(banner.intensity))
}
