import type { Transform2D } from '../model/types.js'
import type { PenaltyResult } from '../analysis/penaltyLabels.js'
import { FRAME_H, FRAME_W, worldToPx } from '../model/pitch.js'
import { drawEventBand, drawEventTitle, interBaselinePx, type CardBox, type TitleLayout } from './eventBanner.js'
import { fitText, measureWidth } from './fitText.js'
import { drawIconCard, PADDING_X_PX as LABEL_CARD_PADDING_X_PX, setLineShadow, TEAM_SHADOW } from './labelCard.js'
import { designUnit } from './pitchGeometry.js'
import { DEFAULT_THEME, type RenderTheme } from './theme.js'

/**
 * The penalty (Figma "Game Animation Visualizer", section "Events"): first a centre card, "PENALTY"
 * over its icon with the team under it (viewport/eventPenalty, node 136:2438), everyone and the ball
 * faded out under it; then a scene of its own over a plain green that covers the pitch: the goal, the
 * keeper and the ball on the spot, "PENALTY.." and the team at the top right (eventPenaltyWaiting,
 * 136:2587); then the kick, into the top corner (eventPenaltyScored, 136:3145) or over the bar
 * (eventPenaltyMissed, 136:3407), and "SCORED!" or "MISSED!" rising in at the foot.
 *
 * The widget's own: video-annotation has no penalty. Played by the director's penalty moment, which
 * fills the indicator; here it is only drawn.
 */
export interface PenaltyIndicator {
  /**
   * 0 to 1: how far the card has faded in, or, leaving, how much of it is left, already eased. It
   * and `scene` together are how far everyone on the pitch and the ball have faded out.
   */
  card: number
  /** 0 to 1: how far the scene has faded in, or, leaving, how much of it is left, already eased. */
  scene: number
  /** The team taking it, written under the card and under "PENALTY..", or null for none. */
  team: string | null
  /**
   * Milliseconds since the scene came in: the spinner's turn and the keeper's sway. During the kick
   * it may keep running or stand still: the keeper moves off from wherever his sway has him.
   */
  waitMs: number
  /** How the kick went, once known; null while waiting for it. */
  result: PenaltyResult | null
  /** 0 to 1 through the kick, linear in time: the drawing eases it. */
  kick: number
  /** Milliseconds since the kick ended: a missed ball carries on over the bar and out over PENALTY_MISS_ON_MS. */
  afterKickMs: number
  /** 0 to 1: how far the result's banner has risen and faded in, already eased. */
  banner: number
  /** Reduced motion: the spinner does not turn and the keeper does not sway. */
  still: boolean
}

/** An ellipse in design pixels: its centre, and its width and height. */
export interface Ellipse {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Where everything that moves in the scene is, in design pixels, centres. The ball: its size across
 * (its circle's), its turn in degrees and its strength. Only the spinner is drawn turned: the kicked
 * ball is a plain disc with its drop shadow to one side, so the drawing ignores its `turnDeg`, which
 * would only swing the shadow round it. The keeper: his turn in degrees, the diving keeper's (the
 * standing one is never turned), and `dive`, 0 to 1, how far the standing keeper has cross-faded into
 * the diving one. The trail: the stretch of the kick's curve it covers, `from` and `to` as the curve's
 * parameters (0 at the spot, 1 at the curve's end), and its strength; once a missed ball carries on
 * past the curve's end, the trail runs on to the ball.
 */
export interface PenaltyPose {
  ball: { x: number; y: number; size: number; turnDeg: number; alpha: number }
  ballShadow: Ellipse
  keeper: { x: number; y: number; turnDeg: number; dive: number }
  keeperShadow: Ellipse
  trail: { from: number; to: number; alpha: number }
}

/**
 * How it plays (the director's penalty moment): the card is on screen for PENALTY_CARD_MS, fading in
 * and out included, as a label card fades (LABEL_CARD_IN_MS, LABEL_CARD_OUT_MS); the scene fades in
 * over PENALTY_SCENE_IN_MS as the card goes; a result is waited for PENALTY_WAIT_S on the clock. The
 * kick takes PENALTY_KICK_MS, a miss carries on PENALTY_MISS_ON_MS after it, the result's banner
 * comes in over PENALTY_RESULT_IN_MS from the kick's end, holds PENALTY_HOLD_MS, and the scene fades
 * out over PENALTY_OUT_MS.
 */
export const PENALTY_CARD_MS = 2400
export const PENALTY_SCENE_IN_MS = 500
export const PENALTY_WAIT_S = 20
export const PENALTY_KICK_MS = 700
export const PENALTY_MISS_ON_MS = 500
export const PENALTY_RESULT_IN_MS = 300
export const PENALTY_HOLD_MS = 3000
export const PENALTY_OUT_MS = 600

type Point = { x: number; y: number }

/** The design frame's middle, on the pitch's middle. */
const MIDDLE: Point = { x: 800, y: 550 }

/** The ball on the spot (the spinner, 136:2913, 128 across) and its shadow (136:3141). */
const SPOT: Point = { x: 402, y: 835 }
const SPINNER_PX = 128
const SPOT_SHADOW: Ellipse = { x: 403, y: 898, w: 126, h: 50 }
/** The kicked ball (136:3191) is 74 across, its circle centred 45 in from its 106 picture's corner (the rest its drop shadow). */
const KICKED_PX = 74
const BALL_PICTURE_PX = 106
const BALL_CIRCLE_AT_PX = 45
/** It turns one and a half times over the kick. */
const KICK_TURN_DEG = 540

/**
 * Each kick: the curve's control point and end, where a miss carries on to and its size there, and
 * `trailFrom`, where on the curve the trail's far end is once the ball has reached the curve's end:
 * the curve's point nearest the far end of Figma's Line 1 (scored 136:3377, its end at (401.5, 726.7),
 * 4 px off the curve; missed 136:3456, its end at (372, 712), 42 px off, as Figma's line bends more
 * than the ball's curve). The trail keeps that stretch of the curve, 1 - trailFrom, behind the ball.
 */
const KICKS: Record<PenaltyResult, { control: Point; end: Point; trailFrom: number; on?: { at: Point; size: number } }> = {
  scored: { control: { x: 400, y: 470 }, end: { x: 566, y: 380 }, trailFrom: 0.157 },
  missed: { control: { x: 430, y: 420 }, end: { x: 610, y: 228 }, trailFrom: 0.147, on: { at: { x: 640, y: 150 }, size: 54 } },
}
/** The ball's shadow on the goal line at the kick's end, either way (136:3176, 136:3438). */
const LINE_SHADOW: Ellipse = { x: 560, y: 551, w: 63, h: 25 }

/** The keeper standing (136:2918, 191 by 194) and his shadow (136:3142). */
const KEEPER: Point = { x: 401.5, y: 497 }
const KEEPER_SHADOW: Ellipse = { x: 402, y: 594, w: 126, h: 50 }
/**
 * Diving (136:3192) and his shadow stretched (136:3177, 178 by 37 at 351, 569). The dive is a frame
 * turned 45 degrees: Figma gives its corner, (468, 348), as its place, but its 272 square picture
 * is drawn from (331, 348), as the frames' own export (penaltyScene, 136:3437) has it.
 */
const DIVE: Point = { x: 467, y: 484 }
const DIVE_SHADOW: Ellipse = { x: 440, y: 587.5, w: 178, h: 37 }
/** The diving keeper starts turned back this far, nearer standing, and turns to his Figma pose. */
const DIVE_FROM_DEG = -35
/** He goes from 15% of the kick to 85%, and has crossed into the diving keeper a quarter of the way. */
const COMMIT_FROM = 0.15
const COMMIT_OVER = 0.7
const CROSS_FADE = 0.25
/** His sway while waiting, side to side: SWAY_PX * sin(waitMs / SWAY_MS). */
const SWAY_PX = 10
const SWAY_MS = 380
/** The spinner turns once in SPIN_MS. */
const SPIN_MS = 800

/** The pictures, each where its Figma frame is and as large as its export (a frame's width rounds up). */
const GOAL = { left: 160, top: 304, w: 484, h: 242 }
const KEEPER_FRAME = { w: 191, h: 194, imageW: 192, imageH: 194 }
const DIVE_FRAME = { w: 272, h: 272, imageW: 273, imageH: 273 }
/** The goal's shadow, a trapezoid under its posts (136:3143). */
const GOAL_SHADOW: readonly Point[] = [
  { x: 210, y: 526 },
  { x: 593, y: 526 },
  { x: 644, y: 546 },
  { x: 160, y: 546 },
]
/** Every shadow is black at 25%. */
const SHADOW = 'rgba(0, 0, 0, 0.25)'

/**
 * The trail, as Figma's Line 1 is (136:3377, 136:3456): 48 wide, its ends square, faded from white at
 * the ball to #999999 and clear at its far end, along it (Figma's gradient runs between the line's two
 * ends). Its head is at the ball's middle, under the ball.
 */
const TRAIL_PX = 48
const TRAIL_HEAD = 'rgba(255, 255, 255, 1)'
const TRAIL_TAIL = 'rgba(153, 153, 153, 0)'

/** The green over the whole frame (136:2763): top to bottom of the 1100 px design frame. */
const GREEN_TOP = '#086046'
const GREEN_FOOT = '#033324'
const DESIGN_H = 1100
/**
 * Figma's grain over it (136:2763's noise): fractal noise four times finer than a design pixel,
 * thresholded into black at 25% over about half of it. Figma's frame measures 12.2% darker than the
 * plain gradient, so 49% of it is black, and, finer than any pixel it is shown at, the grain varies
 * only a little from pixel to pixel. So each design pixel of the grain's tile is black at 25% times
 * its share of GRAIN_SAMPLES random draws that came out black: 49% on average, spread as Figma's
 * frame is from pixel to pixel. The tile is made once for each context, from a fixed seed, and repeated a tile pixel to a design
 * pixel, so the grain keeps its size against everything else at any zoom and pixel density.
 */
const GRAIN_SHARE = 0.49
const GRAIN_SAMPLES = 16
const GRAIN_ALPHA = 0.25
const GRAIN_TILE_PX = 256
const GRAIN_SEED = 7824
const grains = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>()

/**
 * "PENALTY.." (136:2766): Figma's band at (754, 64), 846 by 160, its title 112 px on a 128 px line,
 * 16 down, centred, kept 128 clear of the band's ends. The team under it (136:2615): Inter Black,
 * 48 px, its 58 px line's top at 248, centred under the title (Figma's 270 px box is) and no wider than it.
 */
const WAITING_BAND = { left: 754, top: 64, w: 846, h: 160 }
const WAITING_TITLE_PX = 112
const WAITING_LINE_PX = 128
const BAND_PADDING_X_PX = 128
const BAND_PADDING_Y_PX = 16
const TEAM_TOP_PX = 248
const TEAM_PX = 48
const TEAM_LINE_PX = 58

/**
 * The result's banner (136:3259, 136:3458): its top at 780, 240 high, as wide as its title and 128
 * either side, centred; the title 160 px on a 208 px line. It rises RESULT_RISE_PX into place.
 */
const RESULT_TOP_PX = 780
const RESULT_H_PX = 240
const RESULT_TITLE_PX = 160
const RESULT_LINE_PX = 208
const RESULT_RISE_PX = 40

/** The card's icon fills its 208 slot, as card 136:2465 has it. */
const CARD_ICON_BOX: CardBox = { left: 0, top: 0, width: 208, height: 208 }

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))
const easeOutCubic = (k: number) => 1 - (1 - k) ** 3
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const lerpEllipse = (a: Ellipse, b: Ellipse, k: number): Ellipse => ({
  x: lerp(a.x, b.x, k),
  y: lerp(a.y, b.y, k),
  w: lerp(a.w, b.w, k),
  h: lerp(a.h, b.h, k),
})
/** The point `k` along the quadratic curve from `a` through control `c` to `b`. */
const onCurve = (a: Point, c: Point, b: Point, k: number): Point => ({
  x: (1 - k) ** 2 * a.x + 2 * (1 - k) * k * c.x + k ** 2 * b.x,
  y: (1 - k) ** 2 * a.y + 2 * (1 - k) * k * c.y + k ** 2 * b.y,
})
/** The control point of the stretch of that curve from `j` to `k`: itself a quadratic. */
const controlBetween = (a: Point, c: Point, b: Point, j: number, k: number): Point => ({
  x: (1 - j) * (1 - k) * a.x + ((1 - j) * k + j * (1 - k)) * c.x + j * k * b.x,
  y: (1 - j) * (1 - k) * a.y + ((1 - j) * k + j * (1 - k)) * c.y + j * k * b.y,
})

/** Where everything that moves in the scene is (PenaltyPose), in design pixels. */
export function penaltyPose(p: PenaltyIndicator): PenaltyPose {
  const sway = p.still ? 0 : SWAY_PX * Math.sin(p.waitMs / SWAY_MS)
  const standing = { x: KEEPER.x + sway, y: KEEPER.y }
  const standingShadow = { ...KEEPER_SHADOW, x: KEEPER_SHADOW.x + sway }
  if (p.result === null) {
    const turnDeg = p.still ? 0 : ((p.waitMs * 360) / SPIN_MS) % 360
    return {
      ball: { ...SPOT, size: SPINNER_PX, turnDeg, alpha: 1 },
      ballShadow: { ...SPOT_SHADOW },
      keeper: { ...standing, turnDeg: DIVE_FROM_DEG, dive: 0 },
      keeperShadow: standingShadow,
      trail: { from: 0, to: 0, alpha: 0 },
    }
  }
  const kick = KICKS[p.result]
  const e = easeOutCubic(clamp01(p.kick))
  let ball = { ...onCurve(SPOT, kick.control, kick.end, e), size: lerp(SPINNER_PX, KICKED_PX, e), turnDeg: KICK_TURN_DEG * e, alpha: 1 }
  let ballShadow = lerpEllipse(SPOT_SHADOW, LINE_SHADOW, e)
  if (kick.on && p.kick >= 1) {
    const m = clamp01(p.afterKickMs / PENALTY_MISS_ON_MS)
    ball = { ...ball, x: lerp(kick.end.x, kick.on.at.x, m), y: lerp(kick.end.y, kick.on.at.y, m), size: lerp(KICKED_PX, kick.on.size, m), alpha: 1 - m }
    ballShadow = { ...ballShadow, x: ballShadow.x + (ball.x - kick.end.x) }
  }
  const k = easeOutCubic(clamp01((p.kick - COMMIT_FROM) / COMMIT_OVER))
  return {
    ball,
    ballShadow,
    keeper: { x: lerp(standing.x, DIVE.x, k), y: lerp(standing.y, DIVE.y, k), turnDeg: DIVE_FROM_DEG * (1 - k), dive: clamp01(k / CROSS_FADE) },
    keeperShadow: lerpEllipse(standingShadow, DIVE_SHADOW, k),
    trail: { from: Math.max(0, kick.trailFrom - (1 - e)), to: e, alpha: ball.alpha },
  }
}

/**
 * Draw the penalty, its card and its scene, over everything on the pitch, in frame units through the
 * context's current transform, which is the frame's own (renderer.ts): it is laid out on the whole
 * pitch whatever the view, as the cards are. The design's pixels go through designUnit, its middle on
 * the pitch's. Drawn in the theme's words, fonts and pictures; a picture not yet loaded is left out.
 */
export function drawPenalty(ctx: CanvasRenderingContext2D, t: Transform2D, p: PenaltyIndicator, theme: RenderTheme = DEFAULT_THEME): void {
  const card = clamp01(p.card)
  const scene = clamp01(p.scene)
  if (card > 0) {
    const [cx] = worldToPx(0, 0, t)
    drawIconCard(
      ctx,
      t,
      cx,
      {
        title: theme.text.penalty,
        font: theme.fonts.title,
        icon: theme.icons.penalty,
        iconBox: CARD_ICON_BOX,
        paddingXPx: LABEL_CARD_PADDING_X_PX,
        maxWidthPx: FRAME_W / designUnit(t),
        team: p.team,
      },
      card,
    )
  }
  if (scene > 0) drawScene(ctx, t, p, scene, theme)
}

/** The scene at `alpha`: the green, the shadows, goal, keeper, trail and ball, then the banners. */
function drawScene(ctx: CanvasRenderingContext2D, t: Transform2D, p: PenaltyIndicator, alpha: number, theme: RenderTheme): void {
  const u = designUnit(t)
  const [mx, my] = worldToPx(0, 0, t)
  const X = (x: number) => mx + (x - MIDDLE.x) * u
  const Y = (y: number) => my + (y - MIDDLE.y) * u
  const pose = penaltyPose(p)
  const icons = theme.icons

  ctx.save()
  ctx.globalAlpha = alpha
  const green = ctx.createLinearGradient(0, Y(0), 0, Y(DESIGN_H))
  green.addColorStop(0, GREEN_TOP)
  green.addColorStop(1, GREEN_FOOT)
  ctx.fillStyle = green
  ctx.fillRect(0, 0, FRAME_W, FRAME_H)
  const grain = grainOf(ctx)
  if (grain) {
    grain.setTransform({ a: u, b: 0, c: 0, d: u, e: 0, f: 0 })
    ctx.globalAlpha = alpha * GRAIN_ALPHA
    ctx.fillStyle = grain
    ctx.fillRect(0, 0, FRAME_W, FRAME_H)
    ctx.globalAlpha = alpha
  }

  ctx.fillStyle = SHADOW
  ctx.beginPath()
  GOAL_SHADOW.forEach((c, i) => (i === 0 ? ctx.moveTo(X(c.x), Y(c.y)) : ctx.lineTo(X(c.x), Y(c.y))))
  ctx.closePath()
  ctx.fill()
  if (icons.penaltyGoal) ctx.drawImage(icons.penaltyGoal, X(GOAL.left), Y(GOAL.top), GOAL.w * u, GOAL.h * u)

  const fillEllipse = (e: Ellipse) => {
    ctx.fillStyle = SHADOW
    ctx.beginPath()
    ctx.ellipse(X(e.x), Y(e.y), (e.w / 2) * u, (e.h / 2) * u, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  fillEllipse(pose.keeperShadow)
  const { keeper } = pose
  if (keeper.dive < 1 && icons.penaltyKeeper) {
    ctx.globalAlpha = alpha * (1 - keeper.dive)
    const f = KEEPER_FRAME
    ctx.drawImage(icons.penaltyKeeper, X(keeper.x - f.w / 2), Y(keeper.y - f.h / 2), f.imageW * u, f.imageH * u)
  }
  if (keeper.dive > 0 && icons.penaltyKeeperDive) {
    ctx.globalAlpha = alpha * keeper.dive
    const f = DIVE_FRAME
    drawTurned(ctx, icons.penaltyKeeperDive, X(keeper.x), Y(keeper.y), keeper.turnDeg, -f.w / 2, -f.h / 2, f.imageW, f.imageH, u)
  }
  ctx.globalAlpha = alpha

  const { trail, ball } = pose
  if (p.result !== null && trail.alpha > 0 && trail.to > trail.from) {
    // The stretch of the kick's curve behind the ball, one quadratic, then on to a missed ball carrying on.
    const kick = KICKS[p.result]
    const tail = onCurve(SPOT, kick.control, kick.end, trail.from)
    const control = controlBetween(SPOT, kick.control, kick.end, trail.from, trail.to)
    const head = onCurve(SPOT, kick.control, kick.end, trail.to)
    const fade = ctx.createLinearGradient(X(ball.x), Y(ball.y), X(tail.x), Y(tail.y))
    fade.addColorStop(0, TRAIL_HEAD)
    fade.addColorStop(1, TRAIL_TAIL)
    ctx.globalAlpha = alpha * trail.alpha
    ctx.strokeStyle = fade
    ctx.lineWidth = TRAIL_PX * u
    ctx.lineCap = 'butt'
    ctx.beginPath()
    ctx.moveTo(X(tail.x), Y(tail.y))
    ctx.quadraticCurveTo(X(control.x), Y(control.y), X(head.x), Y(head.y))
    if (ball.x !== head.x || ball.y !== head.y) ctx.lineTo(X(ball.x), Y(ball.y))
    ctx.stroke()
    ctx.globalAlpha = alpha
  }

  if (ball.alpha > 0) {
    ctx.globalAlpha = alpha * ball.alpha
    fillEllipse(pose.ballShadow)
    if (p.result === null) {
      if (icons.penaltyBallSpin) {
        const half = -SPINNER_PX / 2
        drawTurned(ctx, icons.penaltyBallSpin, X(ball.x), Y(ball.y), ball.turnDeg, half, half, SPINNER_PX, SPINNER_PX, u)
      }
    } else if (icons.penaltyBall) {
      // Not turned (PenaltyPose).
      const s = ball.size / KICKED_PX
      const side = BALL_PICTURE_PX * s * u
      ctx.drawImage(icons.penaltyBall, X(ball.x - BALL_CIRCLE_AT_PX * s), Y(ball.y - BALL_CIRCLE_AT_PX * s), side, side)
    }
    ctx.globalAlpha = alpha
  }

  drawWaitingBanner(ctx, t, p.team, X, Y, u, theme)
  const banner = clamp01(p.banner)
  if (p.result !== null && banner > 0) {
    ctx.globalAlpha = alpha * banner
    const title = p.result === 'scored' ? theme.text.penaltyScored : theme.text.penaltyMissed
    drawResultBanner(ctx, t, title, X, Y(RESULT_TOP_PX + RESULT_RISE_PX * (1 - banner)), u, theme.fonts.title)
  }
  ctx.restore()
}

/**
 * The green's grain for `ctx`, made the first time it is asked for: a tile of black, each pixel as
 * opaque as its share of GRAIN_SAMPLES draws below GRAIN_SHARE, from a small seeded generator
 * (mulberry32), so it is the same every time. Null where there is no OffscreenCanvas to make it in:
 * the green is then drawn plain.
 */
function grainOf(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const known = grains.get(ctx)
  if (known !== undefined) return known
  let pattern: CanvasPattern | null = null
  const tile = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(GRAIN_TILE_PX, GRAIN_TILE_PX)
  const c = tile?.getContext('2d')
  if (tile && c) {
    const image = c.createImageData(GRAIN_TILE_PX, GRAIN_TILE_PX)
    let seed = GRAIN_SEED
    const draw = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let r = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
    for (let i = 3; i < image.data.length; i += 4) {
      let black = 0
      for (let k = 0; k < GRAIN_SAMPLES; k++) if (draw() < GRAIN_SHARE) black++
      image.data[i] = Math.round((255 * black) / GRAIN_SAMPLES)
    }
    c.putImageData(image, 0, 0)
    pattern = ctx.createPattern(tile, 'repeat')
  }
  grains.set(ctx, pattern)
  return pattern
}

/**
 * Draw `image` turned `turnDeg` about (`cx`, `cy`), in frame units, its top left corner at
 * (`left`, `top`) design pixels from that point, `w` by `h` design pixels.
 */
function drawTurned(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  cx: number,
  cy: number,
  turnDeg: number,
  left: number,
  top: number,
  w: number,
  h: number,
  u: number,
): void {
  const a = (turnDeg * Math.PI) / 180
  ctx.save()
  ctx.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cx, cy)
  ctx.drawImage(image, left * u, top * u, w * u, h * u)
  ctx.restore()
}

/** "PENALTY.." on its band, and the team under it. */
function drawWaitingBanner(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  team: string | null,
  X: (x: number) => number,
  Y: (y: number) => number,
  u: number,
  theme: RenderTheme,
): void {
  const band = WAITING_BAND
  const font = theme.fonts.title
  drawEventBand(ctx, X(band.left), Y(band.top), band.w * u, band.h * u)
  const layout: TitleLayout = { word: null, leftPx: 0, centrePx: band.w / 2, bandWidthPx: band.w, insetPx: BAND_PADDING_X_PX }
  const baseline = Y(band.top + BAND_PADDING_Y_PX + interBaselinePx(WAITING_TITLE_PX, WAITING_LINE_PX))
  drawEventTitle(ctx, t, theme.text.penaltyWaiting, X(band.left), baseline, WAITING_TITLE_PX, layout, font)
  if (team === null) return
  const teamFont = (px: number) => `900 ${px}px ${font}`
  const fit = fitText(ctx, team, teamFont, TEAM_PX * u, (band.w - 2 * BAND_PADDING_X_PX) * u)
  setLineShadow(ctx, u)
  ctx.shadowColor = TEAM_SHADOW
  ctx.font = teamFont(fit.px)
  ctx.textAlign = 'center'
  ctx.fillText(fit.text, X(band.left + band.w / 2), Y(TEAM_TOP_PX + interBaselinePx(TEAM_PX, TEAM_LINE_PX)))
  ctx.shadowColor = 'transparent'
}

/** The result's band, its top at `top`, centred on the design's middle, as wide as `title` and its padding, and the title on it. */
function drawResultBanner(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  title: string,
  X: (x: number) => number,
  top: number,
  u: number,
  font: string,
): void {
  const titleWidthPx = measureWidth(ctx, title, `italic 900 ${RESULT_TITLE_PX * u}px ${font}`) / u
  const widthPx = Math.min(FRAME_W / u, titleWidthPx + 2 * BAND_PADDING_X_PX)
  const left = X(MIDDLE.x - widthPx / 2)
  drawEventBand(ctx, left, top, widthPx * u, RESULT_H_PX * u)
  const layout: TitleLayout = { word: null, leftPx: 0, centrePx: widthPx / 2, bandWidthPx: widthPx, insetPx: BAND_PADDING_X_PX }
  const baseline = top + (BAND_PADDING_Y_PX + interBaselinePx(RESULT_TITLE_PX, RESULT_LINE_PX)) * u
  drawEventTitle(ctx, t, title, left, baseline, RESULT_TITLE_PX, layout, font)
}
