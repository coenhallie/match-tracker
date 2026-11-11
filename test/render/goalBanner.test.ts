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
import { build2DTransform, FRAME_W, worldToPx } from '../../src/model/pitch'

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
