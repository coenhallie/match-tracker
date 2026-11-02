import type { PitchDimensions, Transform2D } from '../model/types'
import { designUnit, resolvePitchDimensions, tracePlayingArea, worldToPx } from './pitchGeometry'

/**
 * The attack, as the match-summary design shows it: the pitch darkened from
 * the attacking team's own goal line to a toothed edge pointing at the goal
 * being attacked, with the team's name and "Attack" just behind that edge,
 * the players faded out and the ball ringed in the team's colour, pulsing.
 */
export interface AttackIndicator {
  /** The attacking team's team_id in the frame. */
  team: 0 | 1
  /** The attacking team's colour, as a #rrggbb hex: the label's bar and the ball's rings. */
  color: string
  /** The attacking team's name, drawn above "Attack". */
  name: string
  /** The direction along x the team attacks in. */
  direction: 1 | -1
  /**
   * 0 to 1. Coming in, how far the shade has swept up the pitch; leaving, how
   * much of it is still to fade.
   */
  intensity: number
  /** True while it fades out at the end of the attack, rather than sweeping in. */
  leaving?: boolean
  /** 0 to 1: how far everyone on the pitch has faded out, leaving the ball. */
  playersFade?: number
  /**
   * 0 to 1, repeating: how far through one pulse of the ball's border. Without
   * it the border holds still.
   */
  pulse?: number
  /**
   * The ball held where it was when the attack was shown, in pitch metres,
   * drawn in place of the tracked one, which play carries on without. Leaving,
   * the one fades into the other.
   */
  ball?: { x: number; y: number }
}

/**
 * How an attack is shown, in milliseconds: the shade sweeps in over
 * ATTACK_IN_MS, the players fading out over the second half of it; it stays
 * until ATTACK_SHOW_MS from the start, then fades out over ATTACK_OUT_MS. The
 * ball's border pulses once every ATTACK_PULSE_MS.
 */
export const ATTACK_IN_MS = 600
export const ATTACK_SHOW_MS = 2000
export const ATTACK_OUT_MS = 400
export const ATTACK_PULSE_MS = 800

/** Opacity of the black laid over the pitch behind the attack, markings included. */
const SHADE_ALPHA = 0.18
/**
 * Where the shade's toothed edge is, the same for every attack: the middle of
 * it is this far up the pitch from the attacking team's own goal line, as a
 * fraction of the pitch's length, as on the design.
 */
export const EDGE_AT = 0.74
/** Teeth along the shade's front edge, and how far their points reach, in metres. */
const EDGE_TEETH = 3
const EDGE_DEPTH_METRES = 5.4

/**
 * The label, in design pixels (designUnit), so it keeps its size against the
 * pitch at any zoom. Measured from the design's frame, with the pitch's
 * vertical middle as zero: the name's and "Attack"'s baselines, and the bar's
 * top and bottom.
 */
const NAME_FONT_PX = 40
const ATTACK_FONT_PX = 54
const NAME_BASELINE_PX = -51
const ATTACK_BASELINE_PX = 26
const BAR_TOP_PX = -94
const BAR_BOTTOM_PX = 59
const BAR_WIDTH_PX = 5
/** Between the text and the bar, and from the bar to the back of the edge's teeth. */
const TEXT_GAP_PX = 25
const BAR_LEAD_PX = 170
/** A longer name is drawn smaller, to fit. */
const NAME_MAX_WIDTH_PX = 560
const LABEL_FONT = 'Montserrat, sans-serif'
/** The name's colour in the design, whichever team it is: it reads on the grass, as red and blue do not. */
export const ATTACK_NAME_COLOR = '#70dfa7'

/**
 * The ball's border, in frame px: a solid ring against it that swells by
 * BALL_RING_SWELL_PX and back on each pulse, and a ring that pulses out from
 * it, growing by BALL_PULSE_GROWTH_PX and fading as it goes. Held still, the
 * outer one sits BALL_OUTER_RING_GAP_PX out, faint.
 */
export const BALL_RING_PX = 4
export const BALL_RING_SWELL_PX = 3
export const BALL_OUTER_RING_PX = 2
export const BALL_OUTER_RING_GAP_PX = 9
export const BALL_OUTER_RING_ALPHA = 0.45
export const BALL_PULSE_GROWTH_PX = 18

const easeOutCubic = (k: number) => 1 - (1 - k) ** 3
const clamp01 = (k: number) => Math.min(1, Math.max(0, k))

/** Where the middle of the toothed edge ends up, in metres. */
export function edgeAt(direction: 1 | -1, half: number): number {
  return direction * (EDGE_AT * 2 * half - half)
}

/**
 * The middle of the toothed edge, in metres. Coming in, it sweeps from
 * behind the team's own goal line, where the whole edge is off the pitch, up
 * to EDGE_AT, slowing as it arrives.
 */
function edgeMiddle(ind: AttackIndicator, half: number): number {
  const to = edgeAt(ind.direction, half)
  if (ind.leaving) return to
  const from = -ind.direction * (half + EDGE_DEPTH_METRES / 2)
  return from + (to - from) * easeOutCubic(clamp01(ind.intensity))
}

/**
 * Draw the attack's shade and label. Drawn in frame units through the
 * context's current transform, over the markings, as the design darkens them
 * with the grass, and under the goals and the players.
 *
 * Which team is attacking, and which way, is worked out by the app
 * (teamPhase.ts), not reported by the pipeline.
 */
export function drawAttackIndicator(
  ctx: CanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  ind: AttackIndicator,
): void {
  if (ind.intensity <= 0) return
  drawShade(ctx, pd, t, ind)
  drawLabel(ctx, pd, t, ind)
}

function drawShade(
  ctx: CanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  ind: AttackIndicator,
): void {
  const dims = resolvePitchDimensions(pd)
  const half = dims.length.value / 2
  const halfWidth = dims.width.value / 2
  const middle = edgeMiddle(ind, half)
  const dir = ind.direction
  // Past the pitch on every side; the playing area clips it.
  const back = -dir * (half + 10)
  const over = halfWidth + 10

  ctx.save()
  tracePlayingArea(ctx, pd, t)
  ctx.clip()
  ctx.globalAlpha = SHADE_ALPHA * (ind.leaving ? clamp01(ind.intensity) : 1)
  ctx.fillStyle = '#000000'
  ctx.beginPath()
  ctx.moveTo(...worldToPx(back, -over, t))
  ctx.lineTo(...worldToPx(middle - (dir * EDGE_DEPTH_METRES) / 2, -over, t))
  // From touchline to touchline, back in at each end and between the teeth,
  // out at each tooth's point.
  const steps = EDGE_TEETH * 2
  for (let i = 0; i <= steps; i++) {
    const y = -halfWidth + (i * 2 * halfWidth) / steps
    const out = i % 2 === 1 ? 1 : -1
    ctx.lineTo(...worldToPx(middle + (out * dir * EDGE_DEPTH_METRES) / 2, y, t))
  }
  ctx.lineTo(...worldToPx(middle - (dir * EDGE_DEPTH_METRES) / 2, over, t))
  ctx.lineTo(...worldToPx(back, over, t))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/**
 * The team's name over "Attack", beside a bar in the team's colour, just
 * behind the shade's edge: right-aligned for an attack to the right, mirrored
 * for one to the left. It stays where the edge ends up while the shade sweeps
 * in, and fades in over the second half of the sweep.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  ind: AttackIndicator,
): void {
  const k = clamp01(ind.intensity)
  const alpha = ind.leaving ? k : clamp01((k - 0.5) / 0.5)
  if (alpha <= 0) return

  const dims = resolvePitchDimensions(pd)
  const half = dims.length.value / 2
  const u = designUnit(t)
  const dir = ind.direction
  const [troughPx, cy] = worldToPx(edgeAt(dir, half) - (dir * EDGE_DEPTH_METRES) / 2, 0, t)

  ctx.save()
  let nameFont = NAME_FONT_PX * u
  ctx.font = `600 ${nameFont}px ${LABEL_FONT}`
  const fullName = ctx.measureText(ind.name).width
  if (fullName > NAME_MAX_WIDTH_PX * u) {
    nameFont *= (NAME_MAX_WIDTH_PX * u) / fullName
  }

  // The bar's middle, and the side of the text nearest it.
  const barX = troughPx - dir * BAR_LEAD_PX * u
  const textEdge = barX - dir * (BAR_WIDTH_PX / 2 + TEXT_GAP_PX) * u

  ctx.globalAlpha = alpha
  ctx.fillStyle = ind.color
  ctx.fillRect(barX - (BAR_WIDTH_PX / 2) * u, cy + BAR_TOP_PX * u, BAR_WIDTH_PX * u, (BAR_BOTTOM_PX - BAR_TOP_PX) * u)

  ctx.textAlign = dir === 1 ? 'right' : 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `600 ${nameFont}px ${LABEL_FONT}`
  ctx.fillStyle = ATTACK_NAME_COLOR
  ctx.fillText(ind.name, textEdge, cy + NAME_BASELINE_PX * u)
  ctx.font = `700 ${ATTACK_FONT_PX * u}px ${LABEL_FONT}`
  ctx.fillStyle = '#ffffff'
  ctx.fillText('Attack', textEdge, cy + ATTACK_BASELINE_PX * u)
  ctx.restore()
}

/**
 * How strongly the rings round the ball are drawn: with the label, so they
 * arrive as the shade does and go as it fades.
 */
export function ballRingAlpha(ind: AttackIndicator): number {
  const k = clamp01(ind.intensity)
  return ind.leaving ? k : clamp01((k - 0.5) / 0.5)
}
