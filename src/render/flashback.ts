import type { Transform2D, TrackerRecord } from '../model/types.js'
import { interBaselinePx } from './eventBanner.js'
import { measureWidth } from './fitText.js'
import { designUnit } from './pitchGeometry.js'
import type { RenderTheme } from './theme.js'
import { FRAME_H, FRAME_W } from '../model/pitch.js'

/**
 * The flashback's look, as the design shows it (Figma frame 81:4738): a white
 * stroke round the whole frame, and a white tab in a bottom corner holding the
 * word REPLAY, the time since the moment and a progress line along its bottom.
 * All in design pixels, through `designUnit`, fixed to the frame.
 */
const STROKE_PX = 12
/** The tab sits on the stroke's inner edge, and is filled on under the stroke to the frame's edge. */
const INSET_PX = STROKE_PX
const PAD_Y_PX = 16
const PAD_OUTER_PX = 16
const PAD_INNER_PX = 32
const RADIUS_PX = 4
const TITLE_PX = 64
const LINE_PX = 80
const TIMER_PX = 36
const GAP_PX = 24
const PROGRESS_PX = 6
const TAB_HEIGHT_PX = PAD_Y_PX + LINE_PX + PAD_Y_PX
const GREEN = '#166a51'
const TIMER_ALPHA = 0.62
const PROGRESS_ALPHA = 0.35
/** The title's shadow: 0 4px 24px, black at 15%. */
const SHADOW_Y_PX = 4
const SHADOW_BLUR_PX = 24
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.15)'

/** What the flashback shows at one paint. */
export interface FlashbackIndicator {
  /** How visible it is, 0 to 1: the fade in and out. */
  alpha: number
  /** The tab's side, away from the action. */
  side: 'left' | 'right'
  /** Seconds since the moment; null draws no timer. */
  agoS: number | null
  /** The share of the clip still to play, 0 to 1: the progress line's width as a share of the tab's. */
  leftShare: number
}

/**
 * How much of the frame the flashback takes from its edges, in frame units through `t`: the
 * stroke's width all round, and how far the tab, with its inset, reaches up from the bottom. For
 * the widget's own controls, which keep clear of them while they show.
 */
export function flashbackTabExtent(t: Transform2D): { stroke: number; tab: number } {
  const u = designUnit(t)
  return { stroke: STROKE_PX * u, tab: (INSET_PX + TAB_HEIGHT_PX) * u }
}

/**
 * Which bottom corner the tab sits in: away from the action, so a ball in the
 * right half (x > 0) puts it left. The first ball with a usable x decides; none,
 * or x of 0, gives left. The caller passes the record as shown, with the halves
 * turned, so the ends are the ones the viewer sees.
 */
export function flashbackSide(event: TrackerRecord): 'left' | 'right' {
  for (const ball of event.frame.balls ?? []) {
    const x = ball.projected_coordinates?.x
    if (typeof x === 'number' && Number.isFinite(x)) return x < 0 ? 'right' : 'left'
  }
  return 'left'
}

/**
 * The timer laid out in tabular figures, as a canvas cannot ask the font for them: each digit
 * centred in a cell as wide as the widest digit, the rest at its own width. So the tab and the
 * words after the time keep still as the seconds tick. In `font`, from x 0.
 */
function tabularRuns(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
): { width: number; runs: Array<{ text: string; x: number }> } {
  const digit = Math.max(...'0123456789'.split('').map((d) => measureWidth(ctx, d, font)))
  const runs: Array<{ text: string; x: number }> = []
  let x = 0
  for (const part of text.match(/\d|\D+/g) ?? []) {
    const w = measureWidth(ctx, part, font)
    const isDigit = /^\d$/.test(part)
    runs.push({ text: part, x: isDigit ? x + (digit - w) / 2 : x })
    x += isDigit ? digit : w
  }
  return { width: x, runs }
}

/** `seconds` as m:ss, whole seconds, floored, put into `template` for `{time}`. */
export function formatAgo(seconds: number, template: string): string {
  const whole = Math.max(0, Math.floor(seconds))
  const time = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
  return template.replace('{time}', time)
}

/**
 * Draw the flashback in frame units at `value.alpha`, over everything, through
 * the context's current transform (the caller fixes it to the frame).
 */
export function drawFlashback(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  value: FlashbackIndicator,
  theme: RenderTheme,
): void {
  const alpha = Math.min(1, value.alpha)
  if (!(alpha > 0)) return
  const u = designUnit(t)
  const font = (px: number) => `italic 900 ${px * u}px ${theme.fonts.title}`
  const title = theme.text.flashback
  const timer = value.agoS === null ? null : formatAgo(value.agoS, theme.text.flashbackAgo)

  const titleW = measureWidth(ctx, title, font(TITLE_PX))
  const timerLayout = timer === null ? null : tabularRuns(ctx, timer, font(TIMER_PX))
  const timerW = timerLayout?.width ?? 0
  const contentW = titleW + (timerLayout === null ? 0 : GAP_PX * u + timerW)
  const width = (PAD_OUTER_PX + PAD_INNER_PX) * u + contentW
  const height = TAB_HEIGHT_PX * u
  const left = value.side === 'left'
  const x0 = left ? INSET_PX * u : FRAME_W - INSET_PX * u - width
  const x1 = x0 + width
  const bottom = FRAME_H - INSET_PX * u
  const top = bottom - height
  const r = RADIUS_PX * u

  ctx.save()
  ctx.globalAlpha = alpha

  // The stroke and the tab are one white shape, filled once: the frame's edge round a hole
  // STROKE_PX in from it, and the tab, which meets the stroke's inner edge, carried on under the
  // stroke to the frame's edge. Two shapes meeting on a fractional pixel each leave it part
  // covered, and the grass shows through as a hairline; one fill has no edge there, and at a
  // fade's alpha nothing is drawn twice. Nonzero winding: the hole goes the other way round.
  const s = STROKE_PX * u
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(FRAME_W, 0)
  ctx.lineTo(FRAME_W, FRAME_H)
  ctx.lineTo(0, FRAME_H)
  ctx.closePath()
  ctx.moveTo(s, s)
  ctx.lineTo(s, FRAME_H - s)
  ctx.lineTo(FRAME_W - s, FRAME_H - s)
  ctx.lineTo(FRAME_W - s, s)
  ctx.closePath()
  // The tab, its top corner on the pitch's side rounded.
  if (left) {
    ctx.moveTo(0, top)
    ctx.lineTo(x1 - r, top)
    ctx.arcTo(x1, top, x1, top + r, r)
    ctx.lineTo(x1, FRAME_H)
    ctx.lineTo(0, FRAME_H)
  } else {
    ctx.moveTo(x0 + r, top)
    ctx.lineTo(FRAME_W, top)
    ctx.lineTo(FRAME_W, FRAME_H)
    ctx.lineTo(x0, FRAME_H)
    ctx.lineTo(x0, top + r)
    ctx.arcTo(x0, top, x0 + r, top, r)
  }
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill('nonzero')

  // The progress line along the tab's bottom, shrinking towards its outer edge.
  const share = Math.min(1, Math.max(0, value.leftShare))
  const barW = width * share
  ctx.fillStyle = GREEN
  ctx.globalAlpha = alpha * PROGRESS_ALPHA
  ctx.fillRect(left ? x0 : x1 - barW, bottom - PROGRESS_PX * u, barW, PROGRESS_PX * u)

  const textX = x0 + (left ? PAD_OUTER_PX : PAD_INNER_PX) * u
  const baseline = top + (PAD_Y_PX + interBaselinePx(TITLE_PX, LINE_PX)) * u
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // A shadow is drawn in the bitmap's pixels, whatever the transform.
  const scale = ctx.getTransform().a * u
  ctx.globalAlpha = alpha
  ctx.shadowColor = SHADOW_COLOR
  ctx.shadowBlur = SHADOW_BLUR_PX * scale
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = SHADOW_Y_PX * scale
  ctx.font = font(TITLE_PX)
  ctx.fillStyle = GREEN
  ctx.fillText(title, textX, baseline)
  ctx.shadowColor = 'transparent'

  if (timerLayout !== null) {
    ctx.globalAlpha = alpha * TIMER_ALPHA
    ctx.font = font(TIMER_PX)
    const timerX = textX + titleW + GAP_PX * u
    for (const run of timerLayout.runs) ctx.fillText(run.text, timerX + run.x, baseline)
  }
  ctx.restore()
}
