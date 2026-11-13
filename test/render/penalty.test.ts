import { describe, it, expect } from 'vitest'
import {
  PENALTY_CARD_MS,
  PENALTY_HOLD_MS,
  PENALTY_KICK_MS,
  PENALTY_MISS_ON_MS,
  PENALTY_OUT_MS,
  PENALTY_RESULT_IN_MS,
  PENALTY_SCENE_IN_MS,
  PENALTY_WAIT_S,
  drawPenalty,
  penaltyPose,
  type PenaltyIndicator,
} from '../../src/render/penalty'
import { interBaselinePx } from '../../src/render/eventBanner'
import { designUnit } from '../../src/render/pitchGeometry'
import { DEFAULT_THEME, type RenderTheme } from '../../src/render/theme'
import { recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'
import { build2DTransform, FRAME_H, FRAME_W, worldToPx } from '../../src/model/pitch'

// The design (Figma "Game Animation Visualizer", viewport/eventPenalty, eventPenaltyWaiting,
// eventPenaltyScored and eventPenaltyMissed) is a 1600 by 1100 frame with the pitch's middle at
// 800 by 550: its places are read off it below.
const T = build2DTransform({ length: 105, width: 68 })
const u = designUnit(T)
const [CX, CY] = worldToPx(0, 0, T)
/** A design point, in frame units. */
const D = (x: number, y: number): [number, number] => [CX + (x - 800) * u, CY + (y - 550) * u]

type Pt = readonly [number, number]
const cubicAt = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, k: number): [number, number] => {
  const at = (i: 0 | 1) => (1 - k) ** 3 * p0[i] + 3 * (1 - k) ** 2 * k * p1[i] + 3 * (1 - k) * k ** 2 * p2[i] + k ** 3 * p3[i]
  return [at(0), at(1)]
}
/** The kicks' curves, cubics from the spot fitted to Figma's Line 1, in design pixels. */
const CURVES = {
  scored: { c1: [331.8, 713.4], c2: [514.4, 680], end: [566, 380], trailFrom: 0.34 },
  missed: { c1: [239.5, 672.5], c2: [575.6, 701.2], end: [610, 228], trailFrom: 0.325 },
} as const
/** The point `k` along a kick's curve, in design pixels. */
const flight = (result: 'scored' | 'missed', k: number) => {
  const c = CURVES[result]
  return cubicAt([402, 835], c.c1, c.c2, c.end, k)
}
/**
 * Figma's Line 1 in each frame (scored 136:3377, missed 136:3456), as its scene exports it, in design
 * pixels: a cubic from near the ball (its first control point on it) to its far end.
 */
const LINE_1 = {
  scored: { near: [563.466, 402.733], c2: [536.5, 558], far: [401.466, 726.733] },
  missed: { near: [610, 236], c2: [617.664, 487.749], far: [372, 712] },
} as const
const lineAt = (result: 'scored' | 'missed', k: number) => {
  const l = LINE_1[result]
  return cubicAt(l.near, l.near, l.c2, l.far, k)
}
/** A linear gradient as the recording context writes it: its two ends and its stops. */
const gradientOf = (style: string) => {
  const [, x0, y0, x1, y1, stops] = /^gradient\(([^,]+),([^-]+)->([^,]+),([^|]+)\|(.*)\)$/.exec(style)!
  return { from: [Number(x0), Number(y0)], to: [Number(x1), Number(y1)], stops }
}

const indicator = (over: Partial<PenaltyIndicator> = {}): PenaltyIndicator => ({
  card: 0,
  scene: 1,
  team: 'Team Away',
  waitMs: 0,
  result: null,
  kick: 0,
  afterKickMs: 0,
  banner: 0,
  still: false,
  ...over,
})

const picture = (name: string) => ({ name }) as unknown as CanvasImageSource
const PICTURES = {
  penalty: picture('penalty'),
  penaltyGoal: picture('goal'),
  penaltyKeeper: picture('keeper'),
  penaltyKeeperDive: picture('keeperDive'),
  penaltyBallSpin: picture('ballSpin'),
  penaltyBall: picture('ball'),
}
const THEME: RenderTheme = { ...DEFAULT_THEME, icons: { ...DEFAULT_THEME.icons, ...PICTURES } }

describe('the penalty timings', () => {
  it('are the spec’s', () => {
    expect([
      PENALTY_CARD_MS,
      PENALTY_SCENE_IN_MS,
      PENALTY_WAIT_S,
      PENALTY_KICK_MS,
      PENALTY_MISS_ON_MS,
      PENALTY_RESULT_IN_MS,
      PENALTY_HOLD_MS,
      PENALTY_OUT_MS,
    ]).toEqual([2400, 500, 20, 700, 500, 300, 3000, 600])
  })
})

describe('the penalty pose', () => {
  it('stands the keeper and the ball where Figma has them while waiting', () => {
    const pose = penaltyPose(indicator())
    expect(pose.ball).toEqual({ x: 402, y: 835, size: 128, turnDeg: 0, alpha: 1 })
    expect(pose.ballShadow).toEqual({ x: 403, y: 898, w: 126, h: 50 })
    expect(pose.keeper).toMatchObject({ x: 401.5, y: 497, dive: 0 })
    expect(pose.keeperShadow).toEqual({ x: 402, y: 594, w: 126, h: 50 })
    expect(pose.trail).toEqual({ from: 0, to: 0, alpha: 0 })
  })

  it('turns the spinner once in 800 ms while waiting', () => {
    expect(penaltyPose(indicator({ waitMs: 200 })).ball.turnDeg).toBeCloseTo(90, 6)
    expect(penaltyPose(indicator({ waitMs: 1000 })).ball.turnDeg).toBeCloseTo(90, 6)
  })

  it('sways the keeper 10 at most', () => {
    let widest = 0
    for (let ms = 0; ms <= 6000; ms += 10) {
      const pose = penaltyPose(indicator({ waitMs: ms }))
      const off = pose.keeper.x - 401.5
      expect(Math.abs(off)).toBeLessThanOrEqual(10)
      // His shadow goes with him.
      expect(pose.keeperShadow.x - 402).toBeCloseTo(off, 6)
      expect(pose.keeper.y).toBe(497)
      widest = Math.max(widest, Math.abs(off))
    }
    expect(widest).toBeGreaterThan(9.99)
    // sin of time over 380 ms: furthest right a quarter of the way round.
    expect(penaltyPose(indicator({ waitMs: (380 * Math.PI) / 2 })).keeper.x).toBeCloseTo(411.5, 6)
  })

  it('puts the scored ball in the top corner at the kick’s end', () => {
    const pose = penaltyPose(indicator({ result: 'scored', kick: 1 }))
    expect(pose.ball.x).toBeCloseTo(566, 6)
    expect(pose.ball.y).toBeCloseTo(380, 6)
    expect(pose.ball.size).toBeCloseTo(74, 6)
    expect(pose.ball.turnDeg).toBeCloseTo(540, 6)
    expect(pose.ball.alpha).toBe(1)
    // In front of the goal: the dive's picture at (331, 348), 272 square, as Figma draws it.
    expect(pose.keeper.x).toBeCloseTo(467, 6)
    expect(pose.keeper.y).toBeCloseTo(484, 6)
    expect(pose.keeper.turnDeg).toBeCloseTo(0, 6)
    expect(pose.keeper.dive).toBe(1)
    // The shadows: the ball's on the goal line (136:3176), the keeper's stretched (136:3177).
    expect(pose.ballShadow).toEqual({ x: 560, y: 551, w: 63, h: 25 })
    expect(pose.keeperShadow.x).toBeCloseTo(440, 6)
    expect(pose.keeperShadow.y).toBeCloseTo(587.5, 6)
    expect(pose.keeperShadow.w).toBeCloseTo(178, 6)
    expect(pose.keeperShadow.h).toBeCloseTo(37, 6)
    // The trail keeps the stretch of the curve behind the ball that Figma's Line 1 covers.
    expect(pose.trail).toEqual({ from: 0.34, to: 1, alpha: 1 })
  })

  it('kicks along the curve fitted to Figma’s Line 1, easing out, shrinking and turning', () => {
    const pose = penaltyPose(indicator({ result: 'scored', kick: 0.5 }))
    const e = 1 - 0.5 ** 3
    const [x, y] = flight('scored', e)
    expect(pose.ball.x).toBeCloseTo(x, 6)
    expect(pose.ball.y).toBeCloseTo(y, 6)
    expect(pose.ball.size).toBeCloseTo(128 + (74 - 128) * e, 6)
    expect(pose.ball.turnDeg).toBeCloseTo(540 * e, 6)
    expect(pose.trail.to).toBeCloseTo(e, 6)
    expect(pose.trail.from).toBeCloseTo(e - 0.66, 6)
    expect(pose.trail.alpha).toBe(1)
    expect(pose.ballShadow.x).toBeCloseTo(403 + (560 - 403) * e, 6)
    expect(pose.ballShadow.w).toBeCloseTo(126 + (63 - 126) * e, 6)
  })

  it('commits the keeper late', () => {
    for (const kick of [0, 0.1, 0.15]) {
      const pose = penaltyPose(indicator({ result: 'scored', kick }))
      expect(pose.keeper.dive).toBe(0)
      expect(pose.keeper.x).toBeCloseTo(401.5, 6)
      expect(pose.keeper.y).toBeCloseTo(497, 6)
      // The diving keeper starts turned back 35 degrees, nearer standing.
      expect(pose.keeper.turnDeg).toBeCloseTo(-35, 6)
    }
    // He is all the way over at 85% of the kick.
    const over = penaltyPose(indicator({ result: 'scored', kick: 0.85 }))
    expect(over.keeper.x).toBeCloseTo(467, 6)
    expect(over.keeper.dive).toBe(1)
    // The standing keeper has crossed into the diving one by a quarter of his move.
    const k = 1 - (1 - 0.05 / 0.7) ** 3
    const early = penaltyPose(indicator({ result: 'scored', kick: 0.2 }))
    expect(early.keeper.dive).toBeCloseTo(k / 0.25, 6)
    expect(early.keeper.x).toBeCloseTo(401.5 + (467 - 401.5) * k, 6)
    expect(early.keeper.turnDeg).toBeCloseTo(-35 * (1 - k), 6)
    expect(early.keeperShadow.w).toBeCloseTo(126 + (178 - 126) * k, 6)
  })

  it('moves the keeper from where his sway has him, so he does not jump as the kick starts', () => {
    const ms = (380 * Math.PI) / 2
    expect(penaltyPose(indicator({ result: 'scored', kick: 0.1, waitMs: ms })).keeper.x).toBeCloseTo(411.5, 6)
  })

  it('carries the missed ball on and out', () => {
    const atEnd = penaltyPose(indicator({ result: 'missed', kick: 1 }))
    expect(atEnd.ball.x).toBeCloseTo(610, 6)
    expect(atEnd.ball.y).toBeCloseTo(228, 6)
    expect(atEnd.ball.size).toBeCloseTo(74, 6)
    expect(atEnd.ball.alpha).toBe(1)
    // Straight on from the curve's end, the way it was going there, to (616, 145).
    const mid = penaltyPose(indicator({ result: 'missed', kick: 1, afterKickMs: 250 }))
    expect(mid.ball.x).toBeCloseTo(613, 6)
    expect(mid.ball.y).toBeCloseTo(186.5, 6)
    expect(mid.ball.size).toBeCloseTo(64, 6)
    expect(mid.ball.alpha).toBeCloseTo(0.5, 6)
    const out = penaltyPose(indicator({ result: 'missed', kick: 1, afterKickMs: 500 }))
    expect(out.ball.x).toBeCloseTo(616, 6)
    expect(out.ball.y).toBeCloseTo(145, 6)
    expect(out.ball.size).toBeCloseTo(54, 6)
    expect(out.ball.alpha).toBe(0)
    expect(penaltyPose(indicator({ result: 'missed', kick: 1, afterKickMs: 900 })).ball.alpha).toBe(0)
    // The miss goes along its own curve, over the bar.
    const e = 1 - 0.5 ** 3
    const half = penaltyPose(indicator({ result: 'missed', kick: 0.5 }))
    expect(half.ball.x).toBeCloseTo(flight('missed', e)[0], 6)
    expect(half.ball.y).toBeCloseTo(flight('missed', e)[1], 6)
  })

  it('carries the missed ball on the way the curve was going at its end', () => {
    const { c2, end } = CURVES.missed
    const on = [616 - end[0], 145 - end[1]]
    const tangent = [end[0] - c2[0], end[1] - c2[1]]
    const angle = (v: number[]) => (Math.atan2(v[0]!, -v[1]!) * 180) / Math.PI
    expect(Math.abs(angle(on) - angle(tangent))).toBeLessThan(0.5)
  })

  it('leaves the spot heading upwards, and rises all the way', () => {
    for (const result of ['scored', 'missed'] as const) {
      let last = penaltyPose(indicator({ result, kick: 0 })).ball.y
      for (let kick = 0.01; kick <= 1; kick += 0.01) {
        const { y } = penaltyPose(indicator({ result, kick })).ball
        expect(y).toBeLessThanOrEqual(last)
        last = y
      }
    }
  })

  it('does not carry a scored ball on', () => {
    const pose = penaltyPose(indicator({ result: 'scored', kick: 1, afterKickMs: 500 }))
    expect(pose.ball.x).toBeCloseTo(566, 6)
    expect(pose.ball.alpha).toBe(1)
  })

  it('holds still under reduced motion', () => {
    const pose = penaltyPose(indicator({ waitMs: 1234, still: true }))
    expect(pose.ball.turnDeg).toBe(0)
    expect(pose.keeper.x).toBe(401.5)
    expect(pose.keeperShadow.x).toBe(402)
    const kicked = penaltyPose(indicator({ waitMs: 1234, still: true, result: 'scored', kick: 1 }))
    expect(kicked.keeper.x).toBeCloseTo(467, 6)
  })
})

describe('drawing the penalty', () => {
  /** `share`: each character's width, as a share of the size (the recording context's own is 0.6). */
  function draw(over: Partial<PenaltyIndicator> = {}, theme: RenderTheme = THEME, share = 0.6) {
    const { ctx, ops } = recordingCtx()
    ctx.measureText = (text: string) => ({ width: text.length * Number(/([\d.]+)px/.exec(ctx.font)?.[1] ?? 10) * share })
    // What the recording context does not keep with each op: the shadow under a text, the line's ends.
    const shadows = new Map<string, string>()
    const fillText = ctx.fillText.bind(ctx)
    ctx.fillText = (...args: unknown[]) => {
      shadows.set(String(args[0]), ctx.shadowColor)
      fillText(...args)
    }
    const caps: string[] = []
    const stroke = ctx.stroke.bind(ctx)
    ctx.stroke = () => {
      caps.push(ctx.lineCap)
      stroke()
    }
    drawPenalty(ctx as unknown as CanvasRenderingContext2D, T, indicator(over), theme)
    return { ops, shadows, caps }
  }
  const images = (ops: Op[], name: string) =>
    ops.filter((o) => o.op === 'drawImage' && (o.args[0] as { name?: string }).name === name)
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  /** A text's size, in frame units. */
  const px = (o: Op) => Number(/([\d.]+)px/.exec(o.font)![1])

  it('draws the card as a label card with an icon and the team', () => {
    const { ops, shadows } = draw({ card: 1, scene: 0 })
    const band = ops.find((o) => o.op === 'fillRect')!
    const [x, y, w, h] = band.args as number[]
    // The label cards' band, 190 either side of the title, 384 high, on the pitch's middle.
    expect(band.fillStyle).toContain('0.19712:rgba(12, 63, 47, 0.95)')
    expect(h! / u).toBeCloseTo(384, 6)
    expect(x! + w! / 2).toBeCloseTo(CX, 6)
    expect(y! + h! / 2).toBeCloseTo(CY, 6)
    const titleWidth = 7 * 92 * u * 0.6
    expect(w).toBeCloseTo(titleWidth + 380 * u, 6)
    const title = ops.find((o) => o.op === 'fillText' && o.args[0] === 'PENALTY')!
    expect(title.font).toMatch(/^italic 900 /)
    expect(px(title)).toBeCloseTo(92 * u, 6)
    // The icon fills its 208 px slot, under the title, as card 136:2465 has it.
    const [, ix, iy, iw, ih] = images(ops, 'penalty')[0]!.args as number[]
    expect(ix).toBeCloseTo(CX - 104 * u, 6)
    expect(iy).toBeCloseTo(y! + 160 * u, 6)
    expect(iw).toBeCloseTo(208 * u, 6)
    expect(ih).toBeCloseTo(208 * u, 6)
    // The team under the band, where every centre card has it.
    const team = ops.find((o) => o.op === 'fillText' && o.args[0] === 'Team Away')!
    expect(team.args[1]).toBeCloseTo(CX, 6)
    expect(team.args[2]).toBeCloseTo(y! + h! + 78.5 * u, 6)
    expect(shadows.get('Team Away')).toBe('rgba(0, 0, 0, 0.5)')
    // Nothing of the scene.
    expect(ops.some((o) => o.op === 'fillText' && o.args[0] === 'PENALTY..')).toBe(false)
  })

  it('fades the card with its strength, and draws nothing with neither card nor scene', () => {
    const { ops } = draw({ card: 0.5, scene: 0 })
    expect(ops.find((o) => o.op === 'fillRect')!.globalAlpha).toBeCloseTo(0.5, 6)
    expect(ops.find((o) => o.op === 'fillText' && o.args[0] === 'Team Away')!.globalAlpha).toBeCloseTo(0.5, 6)
    expect(draw({ card: 0, scene: 0 }).ops.filter((o) => o.op !== 'save' && o.op !== 'restore')).toHaveLength(0)
  })

  it('covers the frame in green under the scene', () => {
    const { ops } = draw()
    const green = ops.find((o) => o.op === 'fillRect')!
    expect(green.args).toEqual([0, 0, FRAME_W, FRAME_H])
    // Figma's green, top to bottom of its frame.
    const [, top] = D(0, 0)
    const [, foot] = D(0, 1100)
    expect(green.fillStyle).toBe(`gradient(0,${top}->0,${foot}|0:#086046,1:#033324)`)
    expect(green.globalAlpha).toBe(1)
    expect(draw({ scene: 0.4 }).ops.find((o) => o.op === 'fillRect')!.globalAlpha).toBeCloseTo(0.4, 6)
  })

  it('lays Figma’s grain over the green: black at 25% over 49% of it, a tile pixel to a design pixel', () => {
    const offscreen = stubOffscreenCanvas()
    try {
      const { ctx, ops } = recordingCtx()
      const patterns: Array<ReturnType<typeof ctx.createPattern>> = []
      const createPattern = ctx.createPattern.bind(ctx)
      ctx.createPattern = (image: unknown, repetition: string) => {
        patterns.push(createPattern(image, repetition))
        return patterns.at(-1)!
      }
      drawPenalty(ctx as unknown as CanvasRenderingContext2D, T, indicator({ scene: 0.6 }), THEME)
      const fills = ops.filter((o) => o.op === 'fillRect')
      const grain = fills[1]!
      expect(fills[0]!.fillStyle).toContain('#086046')
      expect(grain.fillStyle).toBe('pattern(repeat)')
      expect(grain.args).toEqual([0, 0, FRAME_W, FRAME_H])
      expect(grain.globalAlpha).toBeCloseTo(0.6 * 0.25, 6)
      expect(patterns).toHaveLength(1)
      expect(patterns[0]!.transform).toEqual({ a: u, b: 0, c: 0, d: u, e: 0, f: 0 })
      // The tile: 256 square, black, each pixel as opaque as its share of 16 draws: 49% on average,
      // spread about 0.12 either way from pixel to pixel.
      expect(offscreen.sizes).toEqual([[256, 256]])
      const image = offscreen.ops.find((o) => o.op === 'putImageData')!.args[0] as ImageData
      const shares: number[] = []
      for (let i = 0; i < image.data.length; i += 4) {
        expect(image.data[i]! + image.data[i + 1]! + image.data[i + 2]!).toBe(0)
        const share = image.data[i + 3]! / 255
        expect(Math.round(share * 16)).toBeCloseTo(share * 16, 1)
        shares.push(share)
      }
      const mean = shares.reduce((a, b) => a + b, 0) / shares.length
      const spread = Math.sqrt(shares.reduce((a, b) => a + (b - mean) ** 2, 0) / shares.length)
      expect(mean).toBeCloseTo(0.49, 2)
      expect(spread).toBeCloseTo(Math.sqrt((0.49 * 0.51) / 16), 2)
      // Made once for the context, not again each frame.
      drawPenalty(ctx as unknown as CanvasRenderingContext2D, T, indicator(), THEME)
      expect(offscreen.sizes).toHaveLength(1)
      expect(ops.filter((o) => o.fillStyle === 'pattern(repeat)')).toHaveLength(2)
    } finally {
      offscreen.restore()
    }
  })

  it('leaves the green plain where there is no OffscreenCanvas to make the grain in', () => {
    expect(draw().ops.some((o) => o.fillStyle.startsWith('pattern'))).toBe(false)
  })

  it('draws the scene’s pieces in order: shadows under what casts them, the trail under the ball, the banners on top', () => {
    // Early in the keeper's move, so both of him are drawn.
    const { ops } = draw({ result: 'scored', kick: 0.2, banner: 0.5 })
    const index = (find: (o: Op) => boolean) => ops.findIndex(find)
    const ellipses = ops.filter((o) => o.op === 'ellipse')
    const order = [
      index((o) => o.op === 'fillRect'),
      index((o) => o.op === 'moveTo' && near(o.args[0] as number, D(210, 526)[0])),
      index((o) => o === images(ops, 'goal')[0]),
      index((o) => o === ellipses[0]),
      index((o) => o === images(ops, 'keeper')[0]),
      index((o) => o === images(ops, 'keeperDive')[0]),
      index((o) => o.op === 'stroke'),
      index((o) => o === ellipses[1]),
      index((o) => o === images(ops, 'ball')[0]),
      index((o) => o.op === 'fillText' && o.args[0] === 'PENALTY..'),
      index((o) => o.op === 'fillText' && o.args[0] === 'Team Away'),
      index((o) => o.op === 'fillText' && o.args[0] === 'SCORED!'),
    ]
    for (const at of order) expect(at).toBeGreaterThanOrEqual(0)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('lays the goal, its shadow and the keeper’s and ball’s shadows where Figma has them', () => {
    const { ops } = draw()
    const [, gx, gy, gw, gh] = images(ops, 'goal')[0]!.args as number[]
    expect([gx, gy]).toEqual(D(160, 304).map((v) => expect.closeTo(v, 6)))
    expect(gw).toBeCloseTo(484 * u, 6)
    expect(gh).toBeCloseTo(242 * u, 6)
    // The goal's shadow is a trapezoid, black at 25%.
    const corners = ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo').slice(0, 4).map((o) => o.args)
    const want = [D(210, 526), D(593, 526), D(644, 546), D(160, 546)]
    corners.forEach((c, i) => {
      expect(c[0]).toBeCloseTo(want[i]![0], 6)
      expect(c[1]).toBeCloseTo(want[i]![1], 6)
    })
    const ellipses = ops.filter((o) => o.op === 'ellipse')
    expect(ellipses).toHaveLength(2)
    const [keeper, ball] = ellipses.map((o) => o.args as number[])
    expect(keeper!.slice(0, 4)).toEqual([...D(402, 594), 63 * u, 25 * u].map((v) => expect.closeTo(v, 6)))
    expect(ball!.slice(0, 4)).toEqual([...D(403, 898), 63 * u, 25 * u].map((v) => expect.closeTo(v, 6)))
    for (const o of ops.filter((o) => o.op === 'fill')) expect(o.fillStyle).toBe('rgba(0, 0, 0, 0.25)')
  })

  it('stands the keeper in his Figma frame and turns the spinner on its centre', () => {
    const [, kx, ky, kw, kh] = images(draw().ops, 'keeper')[0]!.args as number[]
    // The frame 136:2918 at (306, 400), 191 by 194; the picture its 192 by 194 export.
    expect([kx, ky]).toEqual(D(306, 400).map((v) => expect.closeTo(v, 6)))
    expect(kw).toBeCloseTo(192 * u, 6)
    expect(kh).toBeCloseTo(194 * u, 6)
    const { ops } = draw({ waitMs: 200 })
    expect(images(ops, 'keeperDive')).toHaveLength(0)
    expect(images(ops, 'ball')).toHaveLength(0)
    const spinner = images(ops, 'ballSpin')[0]!
    const turn = ops[ops.indexOf(spinner) - 1]!
    expect(turn.op).toBe('transform')
    const [a, b, c, d, e, f] = turn.args as number[]
    expect([a, b, c, d]).toEqual([0, 1, -1, 0].map((v) => expect.closeTo(v, 6)))
    expect([e, f]).toEqual(D(402, 835).map((v) => expect.closeTo(v, 6)))
    expect(spinner.args.slice(1)).toEqual([-64 * u, -64 * u, 128 * u, 128 * u].map((v) => expect.closeTo(v, 6)))
  })

  it('cross-fades the standing keeper into the diving one, turned on his centre', () => {
    // A quarter of the way into his cross-fade: k = 1/16.
    const kick = 0.15 + 0.7 * (1 - Math.cbrt(1 - 1 / 16))
    const { ops } = draw({ result: 'scored', kick, scene: 0.8 })
    const pose = penaltyPose(indicator({ result: 'scored', kick }))
    expect(pose.keeper.dive).toBeCloseTo(0.25, 6)
    const standing = images(ops, 'keeper')[0]!
    const diving = images(ops, 'keeperDive')[0]!
    expect(standing.globalAlpha).toBeCloseTo(0.8 * 0.75, 6)
    expect(diving.globalAlpha).toBeCloseTo(0.8 * 0.25, 6)
    const turn = ops[ops.indexOf(diving) - 1]!
    const angle = (pose.keeper.turnDeg * Math.PI) / 180
    expect(turn.op).toBe('transform')
    expect(turn.args).toEqual(
      [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), ...D(pose.keeper.x, pose.keeper.y)].map((v) => expect.closeTo(v, 6)),
    )
    // The dive's frame (136:3192) is 272 square; its picture its 273 export.
    expect(diving.args.slice(1)).toEqual([-136 * u, -136 * u, 273 * u, 273 * u].map((v) => expect.closeTo(v, 6)))
  })

  it('draws the diving keeper from (331, 348) at the kick’s end, as Figma’s scene does', () => {
    const { ops } = draw({ result: 'scored', kick: 1 })
    expect(images(ops, 'keeper')).toHaveLength(0)
    const diving = images(ops, 'keeperDive')[0]!
    const [a, b, c, d, e, f] = ops[ops.indexOf(diving) - 1]!.args as number[]
    expect([a, b, c, d]).toEqual([1, 0, 0, 1].map((v) => expect.closeTo(v, 6)))
    const [, x, y] = diving.args as number[]
    expect(e! + x!).toBeCloseTo(D(331, 348)[0], 6)
    expect(f! + y!).toBeCloseTo(D(331, 348)[1], 6)
  })

  it('puts the kicked ball’s 74 px circle where Figma has it, its drop shadow round it', () => {
    const { ops } = draw({ result: 'scored', kick: 1 })
    const [, x, y, w, h] = images(ops, 'ball')[0]!.args as number[]
    // The ball 136:3191 at (529, 343), 74 across: its circle is 8 in from its 106 picture's corner.
    expect(x! + 8 * u).toBeCloseTo(D(529, 343)[0], 6)
    expect(y! + 8 * u).toBeCloseTo(D(529, 343)[1], 6)
    expect(w).toBeCloseTo(106 * u, 6)
    expect(h).toBeCloseTo(106 * u, 6)
    expect(images(ops, 'ballSpin')).toHaveLength(0)
    // Smaller as it carries on over the bar, and fading.
    const out = draw({ result: 'missed', kick: 1, afterKickMs: 250 }).ops
    const ball = images(out, 'ball')[0]!
    const s = 64 / 74
    expect(ball.args[1]).toBeCloseTo(D(613, 186.5)[0] - 45 * s * u, 6)
    expect(ball.args[3]).toBeCloseTo(106 * s * u, 6)
    expect(ball.globalAlpha).toBeCloseTo(0.5, 6)
    expect(images(draw({ result: 'missed', kick: 1, afterKickMs: 500 }).ops, 'ball')).toHaveLength(0)
  })

  it('draws the trail as Figma’s Line 1: 48 wide, square ended, white at the ball fading to clear grey along it', () => {
    const { ops, caps } = draw({ result: 'scored', kick: 1 })
    const stroke = ops.find((o) => o.op === 'stroke')!
    expect(stroke.lineWidth).toBeCloseTo(48 * u, 6)
    expect(caps[0]).toBe('butt')
    expect(stroke.globalAlpha).toBe(1)
    // The fade runs from the ball to the trail's far end, not from the spot.
    const fade = gradientOf(stroke.strokeStyle)
    expect(fade.from).toEqual(D(566, 380).map((v) => expect.closeTo(v, 6)))
    expect(fade.to).toEqual(D(...flight('scored', 0.34)).map((v) => expect.closeTo(v, 6)))
    expect(fade.stops).toBe('0:rgba(255, 255, 255, 1),1:rgba(153, 153, 153, 0)')
    expect(draw().ops.some((o) => o.op === 'stroke')).toBe(false)
  })

  /** The trail as drawn: the cubic from its moveTo through its bezierCurveTo, back in design pixels. */
  function drawnTrail(ops: Op[]) {
    const curve = ops.find((o) => o.op === 'bezierCurveTo')!
    const start = ops.slice(0, ops.indexOf(curve)).findLast((o) => o.op === 'moveTo')!
    const design = (x: number, y: number): Pt => [(x - CX) / u + 800, (y - CY) / u + 550]
    const [a, b] = start.args as number[]
    const [c, d, e, f, g, h] = curve.args as number[]
    return { curve, points: [design(a!, b!), design(c!, d!), design(e!, f!), design(g!, h!)] as const }
  }

  it('lies along Figma’s Line 1 within 3 px, bending as it does, for both results', () => {
    for (const result of ['scored', 'missed'] as const) {
      const { points } = drawnTrail(draw({ result, kick: 1 }).ops)
      const trail = Array.from({ length: 2001 }, (_, i) => cubicAt(...points, i / 2000))
      const line = Array.from({ length: 2001 }, (_, i) => lineAt(result, i / 2000))
      const nearest = (p: Pt, to: Pt[]) => Math.min(...to.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))
      // Every point of Line 1 is on the trail, to 3 px.
      for (let i = 0; i <= 40; i++) expect(nearest(lineAt(result, i / 40), trail)).toBeLessThan(3)
      // And the trail runs along Line 1 from its far end to where Line 1 stops near the ball; past
      // that it goes on into the ball's middle, under the ball.
      const near = LINE_1[result].near
      const stop = trail.findIndex((p) => Math.hypot(p[0] - near[0], p[1] - near[1]) === nearest(near, trail))
      for (let i = 0; i <= stop; i += 50) expect(nearest(trail[i]!, line)).toBeLessThan(3)
      // Its far end is Line 1's.
      expect(Math.hypot(points[0][0] - LINE_1[result].far[0], points[0][1] - LINE_1[result].far[1])).toBeLessThan(3)
      expect(points[3]).toEqual(CURVES[result].end.map((v) => expect.closeTo(v, 6)))
    }
  })

  it('grows from the spot early in the kick, then keeps its stretch behind the ball', () => {
    const early = penaltyPose(indicator({ result: 'scored', kick: 0.1 }))
    expect(early.trail.from).toBe(0)
    expect(early.trail.to).toBeCloseTo(1 - 0.9 ** 3, 6)
    const [sx, sy] = D(402, 835)
    const moveTo = draw({ result: 'scored', kick: 0.1 }).ops.filter((o) => o.op === 'moveTo').at(-1)!
    expect(moveTo.args).toEqual([sx, sy].map((v) => expect.closeTo(v, 6)))
    const late = penaltyPose(indicator({ result: 'scored', kick: 0.8 }))
    expect(late.trail.to - late.trail.from).toBeCloseTo(0.66, 6)
    // Cut from the kick's own curve: drawn mid-kick, it lies on the curve.
    const { points } = drawnTrail(draw({ result: 'scored', kick: 0.8 }).ops)
    for (const k of [0, 0.3, 0.7, 1]) {
      const at = cubicAt(...points, k)
      const whole = Array.from({ length: 4001 }, (_, i) => flight('scored', i / 4000))
      expect(Math.min(...whole.map((q) => Math.hypot(at[0] - q[0], at[1] - q[1])))).toBeLessThan(0.2)
    }
  })

  it('runs the miss’s trail on to the ball as it carries on, and fades it with the ball', () => {
    const { ops } = draw({ result: 'missed', kick: 1, afterKickMs: 250, scene: 0.8 })
    const stroke = ops.find((o) => o.op === 'stroke')!
    expect(stroke.globalAlpha).toBeCloseTo(0.8 * 0.5, 6)
    const { curve } = drawnTrail(ops)
    const on = ops.slice(ops.indexOf(curve)).find((o) => o.op === 'lineTo')!
    expect(on.args).toEqual(D(613, 186.5).map((v) => expect.closeTo(v, 6)))
    // Its fade starts at the ball where it is now.
    const fade = gradientOf(stroke.strokeStyle)
    expect(fade.from).toEqual(D(613, 186.5).map((v) => expect.closeTo(v, 6)))
    expect(fade.to).toEqual(D(...flight('missed', 0.325)).map((v) => expect.closeTo(v, 6)))
    expect(penaltyPose(indicator({ result: 'missed', kick: 1, afterKickMs: 250 })).trail.alpha).toBeCloseTo(0.5, 6)
    expect(draw({ result: 'missed', kick: 1, afterKickMs: 500 }).ops.some((o) => o.op === 'stroke')).toBe(false)
    // At the kick's end, before it carries on, the trail ends on the ball.
    const atEnd = draw({ result: 'missed', kick: 1 }).ops
    expect(atEnd.slice(atEnd.indexOf(drawnTrail(atEnd).curve)).some((o) => o.op === 'lineTo')).toBe(false)
  })

  it('writes “PENALTY..” on Figma’s band, the team under it, as Figma has them', () => {
    // Measured as Figma lays it out: "PENALTY.." 590 px across at 112 px, its band hugging it 128 either side.
    const { ops, shadows } = draw({}, THEME, 590 / 9 / 112)
    const band = ops.find((o) => o.op === 'fillRect' && o.fillStyle.includes('12, 63, 47'))!
    const [x, y, w, h] = band.args as number[]
    expect([x, y]).toEqual(D(754, 64).map((v) => expect.closeTo(v, 6)))
    expect(w).toBeCloseTo(846 * u, 6)
    expect(h).toBeCloseTo(160 * u, 6)
    expect(band.fillStyle).toBe(
      `gradient(${x},0->${x! + w!},0|0:rgba(12, 63, 47, 0),0.25:rgb(12, 63, 47),0.75481:rgb(12, 63, 47),1:rgba(12, 63, 47, 0))`,
    )
    const title = ops.find((o) => o.op === 'fillText' && o.args[0] === 'PENALTY..')!
    expect(title.font).toMatch(/^italic 900 /)
    expect(px(title)).toBeCloseTo(112 * u, 6)
    const width = 590 * u
    expect(title.args[1]).toBeCloseTo(D(1177, 0)[0] - width / 2, 6)
    expect(title.args[2]).toBeCloseTo(D(0, 64 + 16 + interBaselinePx(112, 128))[1], 6)
    expect(shadows.get('PENALTY..')).toBe('rgba(0, 0, 0, 0.15)')
    const team = ops.find((o) => o.op === 'fillText' && o.args[0] === 'Team Away')!
    expect(team.font).toMatch(/^900 /)
    expect(px(team)).toBeCloseTo(48 * u, 6)
    expect(team.textAlign).toBe('center')
    expect(team.args[1]).toBeCloseTo(D(1177, 0)[0], 6)
    expect(team.args[2]).toBeCloseTo(D(0, 248 + interBaselinePx(48, 58))[1], 6)
    expect(shadows.get('Team Away')).toBe('rgba(0, 0, 0, 0.5)')
    expect(draw({ team: null }).ops.some((o) => o.op === 'fillText' && o.args[0] !== 'PENALTY..')).toBe(false)
  })

  it('keeps a long team’s name under the title', () => {
    const name = 'A Team With A Very Long Name Indeed'
    const team = draw({ team: name }).ops.filter((o) => o.op === 'fillText' && o.args[0] !== 'PENALTY..')[0]!
    const width = String(team.args[0]).length * Number(/([\d.]+)px/.exec(team.font)![1]) * 0.6
    expect(width).toBeLessThanOrEqual(590 * u + 1e-6)
  })

  it('raises the result’s banner 40 into place as it fades in, sized by its words', () => {
    for (const [result, word] of [['scored', 'SCORED!'], ['missed', 'MISSED!']] as const) {
      const { ops } = draw({ result, kick: 1, banner: 0.5, scene: 0.8 })
      const bands = ops.filter((o) => o.op === 'fillRect' && o.fillStyle.includes('12, 63, 47'))
      expect(bands).toHaveLength(2)
      const [x, y, w, h] = bands[1]!.args as number[]
      const width = 7 * 160 * u * 0.6
      expect(w).toBeCloseTo(width + 256 * u, 6)
      expect(x! + w! / 2).toBeCloseTo(CX, 6)
      expect(y).toBeCloseTo(D(0, 780 + 20)[1], 6)
      expect(h).toBeCloseTo(240 * u, 6)
      expect(bands[1]!.globalAlpha).toBeCloseTo(0.4, 6)
      const title = ops.find((o) => o.op === 'fillText' && o.args[0] === word)!
      expect(title.font).toMatch(/^italic 900 /)
      expect(px(title)).toBeCloseTo(160 * u, 6)
      expect(title.args[1]).toBeCloseTo(CX - width / 2, 6)
      expect(title.args[2]).toBeCloseTo(y! + (16 + interBaselinePx(160, 208)) * u, 6)
    }
    const inPlace = draw({ result: 'scored', kick: 1, banner: 1 }).ops.filter((o) => o.op === 'fillRect' && o.fillStyle.includes('12, 63, 47'))[1]!
    expect(inPlace.args[1]).toBeCloseTo(D(0, 780)[1], 6)
    expect(draw({ result: 'scored', kick: 1, banner: 0 }).ops.some((o) => o.op === 'fillText' && o.args[0] === 'SCORED!')).toBe(false)
  })

  it('draws without its pictures until they have loaded', () => {
    const { ops } = draw({ card: 1, result: 'scored', kick: 1, banner: 1 }, DEFAULT_THEME)
    expect(ops.some((o) => o.op === 'drawImage')).toBe(false)
    expect(ops.some((o) => o.op === 'fillText' && o.args[0] === 'SCORED!')).toBe(true)
  })
})
