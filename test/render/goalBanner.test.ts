import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  drawGoalBanner,
  goalBannerIntensity,
  GOAL_BANNER_IN_MS,
  GOAL_BANNER_OUT_MS,
  GOAL_BANNER_SLIDE_MS,
  goalBannerSlide,
  type GoalBanner,
} from '../../src/render/goalBanner'
import { GOAL_SEQUENCE_MS, planGoal } from '../../src/analysis/goalSequence'
import { designUnit } from '../../src/render/pitchGeometry'
import { createRenderer } from '../../src/render/renderer'
import type { Frame } from '../../src/model/types'
import { fakeCanvas, recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'
import { normalizeCalls } from '../helpers/normalize'
import { build2DTransform, FRAME_H, FRAME_W, worldToPx } from '../../src/model/pitch'
import { DEFAULT_THEME } from '../../src/render/theme'
import { interBaselinePx } from '../../src/render/eventBanner'
import { measureWidth } from '../../src/render/fitText'
import { CJK_FALLBACK } from '../../src/assets/fontFamilies'

const PITCH = { length: 105, width: 68 }
const T = build2DTransform(PITCH)
const u = designUnit(T)
const [CX, CY] = worldToPx(0, 0, T)

const frame = {
  pitch_dimensions: PITCH,
  teams: [],
  balls: [{ projected_coordinates: { x: 36, y: 4 } }],
  state: { actions: [] },
} as unknown as Frame
const plan = planGoal(frame)!

describe('goal card timing', () => {
  it('waits for the ball to reach the net', () => {
    expect(goalBannerIntensity(plan, 0)).toBe(0)
    expect(goalBannerIntensity(plan, plan.shotMs)).toBe(0)
  })

  it('fades in over GOAL_BANNER_IN_MS from there, and holds', () => {
    expect(goalBannerIntensity(plan, plan.shotMs + GOAL_BANNER_IN_MS / 2)).toBeCloseTo(0.5, 6)
    expect(goalBannerIntensity(plan, plan.shotMs + GOAL_BANNER_IN_MS)).toBe(1)
    expect(goalBannerIntensity(plan, GOAL_SEQUENCE_MS - GOAL_BANNER_OUT_MS)).toBe(1)
  })

  it('fades out over the end of the sequence', () => {
    expect(goalBannerIntensity(plan, GOAL_SEQUENCE_MS - GOAL_BANNER_OUT_MS / 2)).toBeCloseTo(0.5, 6)
    expect(goalBannerIntensity(plan, GOAL_SEQUENCE_MS)).toBe(0)
  })
})

// The reference's card (vp-pitch-1), which the parity test draws: a banner with no side.
describe('goal card', () => {
  const icon = { width: 47, height: 45 } as unknown as CanvasImageSource
  function draw(over: Partial<GoalBanner> = {}) {
    const { ctx, ops } = recordingCtx()
    drawGoalBanner(ctx as unknown as CanvasRenderingContext2D, T, { intensity: 1, icon, ...over })
    return ops
  }

  it('is the design’s centred card, 736 by 373', () => {
    const [x, y, w, h] = draw().find((o) => o.op === 'fillRect')!.args as [number, number, number, number]
    expect(w).toBeCloseTo(736 * u, 6)
    expect(h).toBeCloseTo(373 * u, 6)
    expect(x + w / 2).toBeCloseTo(CX, 6)
    expect(y + h / 2).toBeCloseTo(CY, 6)
  })

  it('writes GOAL where the design has it', () => {
    const text = draw().find((o) => o.op === 'fillText')!
    expect(text.args[0]).toBe('GOAL')
    // The bundled face's private name and CJK fallback, read as the reference's family (theme.ts).
    expect((normalizeCalls([text])[0] as Op).font).toBe(`italic 900 ${92 * u}px Inter, sans-serif`)
    expect(text.args[1]).toBeCloseTo(CX - 133 * u, 6)
  })

  // The design draws the icon a little past its box on every side.
  it('draws the goal icon where the design does, in its proportions', () => {
    const left = CX - 368 * u
    const top = CY - (373 / 2) * u
    const [img, x, y, w, h] = draw().find((o) => o.op === 'drawImage')!.args as [
      unknown,
      number,
      number,
      number,
      number,
    ]
    expect(img).toBe(icon)
    const inner = {
      left: 265 + 219 * 0.125,
      top: 124 + 219 * 0.1719,
      w: 219 * (1 - 0.125 - 0.1741),
      h: 219 * (1 - 0.1719 - 0.1578),
    }
    expect(x).toBeCloseTo(left + (inner.left - inner.w * 0.0252) * u, 6)
    expect(y).toBeCloseTo(top + (inner.top - inner.h * 0.0242) * u, 6)
    expect(w / h).toBeCloseTo(46.9868 / 44.9362, 2)
  })

  it('draws nothing at zero', () => {
    expect(draw({ intensity: 0 })).toHaveLength(0)
  })
})

// The widget's banner (Figma "Game Animation Visualizer", vp-pitch-3, eventGoal 5:319).
describe('goal banner', () => {
  function draw(over: Partial<GoalBanner> = {}) {
    const { ctx, ops } = recordingCtx()
    drawGoalBanner(ctx as unknown as CanvasRenderingContext2D, T, { intensity: 1, side: -1, slide: 1, ...over })
    return ops
  }
  const band = (ops: Op[]) => ops.find((o) => o.op === 'fillRect')!.args as [number, number, number, number]

  it('slides in from the ball reaching the net, over GOAL_BANNER_SLIDE_MS', () => {
    expect(goalBannerSlide(plan, plan.shotMs)).toBe(0)
    expect(goalBannerSlide(plan, plan.shotMs + GOAL_BANNER_SLIDE_MS / 2)).toBeCloseTo(0.5, 6)
    expect(goalBannerSlide(plan, plan.shotMs + GOAL_BANNER_SLIDE_MS)).toBeCloseTo(1, 9)
    expect(goalBannerSlide(plan, GOAL_SEQUENCE_MS)).toBe(1)
  })

  it('is the design’s band, 736 by 230, its top 325 above the pitch’s middle', () => {
    const [, y, w, h] = band(draw())
    expect(w).toBeCloseTo(736 * u, 6)
    expect(h).toBeCloseTo(230 * u, 6)
    expect(y).toBeCloseTo(CY - 325 * u, 6)
  })

  it('rests in the middle of the half away from the goal', () => {
    const [lx, , lw] = band(draw({ side: -1 }))
    expect(lx + lw / 2).toBeCloseTo((FRAME_W * 3) / 4, 6)
    const [rx, , rw] = band(draw({ side: 1 }))
    expect(rx + rw / 2).toBeCloseTo(FRAME_W / 4, 6)
  })

  it('comes in from past the frame’s edge on that side: left to right for a goal on the right', () => {
    const [x0, , w] = band(draw({ side: 1, slide: 0 }))
    expect(x0 + w).toBeLessThan(1e-6)
    const xs = [0, 0.25, 0.5, 0.75, 1].map((slide) => band(draw({ side: 1, slide }))[0])
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]!)
  })

  it('and right to left for a goal on the left', () => {
    const [x0] = band(draw({ side: -1, slide: 0 }))
    expect(x0).toBeGreaterThan(FRAME_W - 1e-6)
    const xs = [0, 0.25, 0.5, 0.75, 1].map((slide) => band(draw({ side: -1, slide }))[0])
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThan(xs[i - 1]!)
  })

  it('writes GOAL alone, 160 px, centred on the band, with no icon', () => {
    const ops = draw({ icon: { width: 47, height: 45 } as unknown as CanvasImageSource })
    const [x, y, w] = band(ops)
    const text = ops.find((o) => o.op === 'fillText')!
    expect(text.args[0]).toBe('GOAL')
    expect((normalizeCalls([text])[0] as Op).font).toBe(`italic 900 ${160 * u}px Inter, sans-serif`)
    expect(text.args[1]).toBeCloseTo(x + w / 2 - 232 * u, 6)
    expect(text.args[2]).toBeCloseTo(y + (13 + 160 * 0.96875) * u, 6)
    expect(ops.some((o) => o.op === 'drawImage')).toBe(false)
  })

  it('moves the title with the band as it slides', () => {
    const at = (slide: number) => {
      const ops = draw({ side: 1, slide })
      return (ops.find((o) => o.op === 'fillText')!.args[1] as number) - band(ops)[0]
    }
    expect(at(0.3)).toBeCloseTo(at(1), 6)
  })

  it('draws nothing at zero', () => {
    expect(draw({ intensity: 0 })).toHaveLength(0)
  })
})

// The scorer under the banner (Figma "Game Animation Visualizer", viewport/eventGoalScorerInfo 149:2940,
// bannerPlayerInfo 149:3090): a band across the foot of its 1600 by 1100 frame, which is the foot of ours.
describe('the scorer under the goal banner', () => {
  const ICON = { width: 41, height: 39 } as unknown as CanvasImageSource
  function draw(scorer: GoalBanner['scorer'], over: Partial<GoalBanner> = {}) {
    const { ctx, ops } = recordingCtx()
    const theme = { ...DEFAULT_THEME, icons: { ...DEFAULT_THEME.icons, scorer: ICON } }
    drawGoalBanner(ctx as unknown as CanvasRenderingContext2D, T, { intensity: 1, side: -1, slide: 1, scorer, ...over }, theme)
    return { ctx, ops }
  }
  const SCORER = { player: 'Skyler Fring', team: 'Team Away', intensity: 1 }
  const bands = (ops: Op[]) => ops.filter((o) => o.op === 'fillRect')
  const text = (ops: Op[], words: string) => ops.find((o) => o.op === 'fillText' && o.args[0] === words)

  // The bottom 274 of the frame, as the design's 826 to 1100, and all the way across it.
  const BAND_TOP = FRAME_H - 274 * u

  it('is a band across the foot of the frame, 274 high, at 85%', () => {
    const [, foot] = bands(draw(SCORER).ops)
    const [x, y, w, h] = foot!.args as number[]
    expect(x).toBe(0)
    expect(w).toBe(FRAME_W)
    expect(y).toBeCloseTo(BAND_TOP, 6)
    expect(h).toBeCloseTo(274 * u, 6)
    expect(foot!.fillStyle).toContain('12, 63, 47')
    expect(foot!.globalAlpha).toBeCloseTo(0.85, 9)
  })

  it('writes the team in Inter Black, 48 px, centred, its 58 px line 136 into the band', () => {
    const team = text(draw(SCORER).ops, 'Team Away')!
    expect((normalizeCalls([team])[0] as Op).font).toBe(`900 ${48 * u}px Inter, sans-serif`)
    expect(team.textAlign).toBe('center')
    expect(team.args[1]).toBeCloseTo(CX, 6)
    expect(team.args[2]).toBeCloseTo(BAND_TOP + (136 + 46.5) * u, 6)
  })

  it('writes the player in Inter Semi Bold, 40 px, after the scorer icon, the row centred, its 64 px box 48 into the band', () => {
    const { ctx, ops } = draw(SCORER)
    const player = text(ops, 'Skyler Fring')!
    const font = `600 ${40 * u}px "MatchTracker Inter", ${CJK_FALLBACK}`
    expect(player.font).toBe(font)
    const width = measureWidth(ctx as unknown as CanvasRenderingContext2D, 'Skyler Fring', font)
    const left = CX - (80 * u + width) / 2
    expect(player.textAlign).toBe('left')
    expect(player.args[1]).toBeCloseTo(left + 80 * u, 6)
    expect(player.args[2]).toBeCloseTo(BAND_TOP + (48 + interBaselinePx(40, 64)) * u, 6)
    // The icon's drawing, inset in its 56 px badge 4 down the row: 10.94% left and 15.57% top, 41.11 by 39.32.
    const icon = ops.find((o) => o.op === 'drawImage')!
    expect(icon.args[0]).toBe(ICON)
    const [x, y, w, h] = icon.args.slice(1) as number[]
    expect(x).toBeCloseTo(left + 56 * 0.1094 * u, 6)
    expect(y).toBeCloseTo(BAND_TOP + (48 + 4 + 56 * 0.1557) * u, 6)
    expect(w).toBeCloseTo(41.1129 * u, 6)
    expect(h).toBeCloseTo(39.319 * u, 6)
  })

  it('fades in with the scorer', () => {
    const { ops } = draw({ ...SCORER, intensity: 0.5 })
    expect(bands(ops)[1]!.globalAlpha).toBeCloseTo(0.425, 9)
    expect(text(ops, 'Skyler Fring')!.globalAlpha).toBeCloseTo(0.5, 9)
  })

  it('writes the team alone for a scorer with no name, and the player alone for one with no team', () => {
    const team = draw({ ...SCORER, player: null }).ops
    expect(text(team, 'Team Away')).toBeDefined()
    expect(team.filter((o) => o.op === 'fillText')).toHaveLength(2)
    expect(team.some((o) => o.op === 'drawImage')).toBe(false)
    const player = draw({ ...SCORER, team: null }).ops
    expect(text(player, 'Skyler Fring')).toBeDefined()
    expect(player.filter((o) => o.op === 'fillText')).toHaveLength(2)
  })

  it('draws no band for a scorer with neither, nor for none, nor at zero', () => {
    expect(bands(draw({ ...SCORER, player: null, team: null }).ops)).toHaveLength(1)
    expect(bands(draw(undefined).ops)).toHaveLength(1)
    expect(bands(draw({ ...SCORER, intensity: 0 }).ops)).toHaveLength(1)
  })

  it('keeps a long name inside the band', () => {
    const long = 'Maximiliano Bartholomew Featherstonehaugh-Cholmondeley the Third'
    const { ctx, ops } = draw({ ...SCORER, player: long })
    const player = ops.find((o) => o.op === 'fillText' && String(o.args[0]).startsWith('Max'))!
    const width = measureWidth(ctx as unknown as CanvasRenderingContext2D, String(player.args[0]), player.font)
    expect(80 * u + width).toBeLessThanOrEqual(800 * u + 1e-6)
  })

  it('is not drawn under the reference card', () => {
    const { ops } = draw(SCORER, { side: undefined })
    expect(text(ops, 'Skyler Fring')).toBeUndefined()
  })
})

describe('goal card in the renderer', () => {
  let offscreen: ReturnType<typeof stubOffscreenCanvas>
  beforeEach(() => {
    offscreen = stubOffscreenCanvas()
  })
  afterEach(() => {
    offscreen.restore()
  })

  const band = (ops: Op[]) => ops.find((o) => o.op === 'fillRect' && o.fillStyle.includes('12, 63, 47'))!.args

  // The goal sequence zooms the view in on the net: the card stays as it is.
  it('stays fixed to the frame however far the view is zoomed', () => {
    const render = (zoom: number) => {
      const { canvas, ops } = fakeCanvas()
      const r = createRenderer(canvas)
      r.setView({ zoom, panX: 0.2, panY: -0.1, renderedWidth: 1280 })
      r.renderFrame(frame, { goalBanner: { intensity: 1 } })
      return ops
    }
    const plain = render(1)
    const zoomed = render(3)
    expect(band(zoomed)).toEqual(band(plain))
    // Drawn with the bitmap's scale only, not the view's.
    const at = zoomed.findIndex((o) => o.op === 'fillRect' && o.fillStyle.includes('12, 63, 47'))
    const transform = zoomed.slice(0, at).findLast((o) => o.op === 'setTransform')!
    expect(transform.args).toEqual([1, 0, 0, 1, 0, 0])
  })
})
