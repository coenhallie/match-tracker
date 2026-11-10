import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drawFlashback, flashbackSide, formatAgo, type FlashbackIndicator } from '../../src/render/flashback'
import { build2DTransform, designUnit } from '../../src/render/pitchGeometry'
import { FRAME_H, FRAME_W } from '../../src/render/constants'
import { DEFAULT_THEME } from '../../src/render/theme'
import { createRenderer } from '../../src/render/renderer'
import type { Frame, TrackerRecord } from '../../src/model/types'
import { fakeCanvas, recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'

const PITCH = { length: 105, width: 68 }
const T = build2DTransform(PITCH)
const u = designUnit(T)
const TITLE = DEFAULT_THEME.fonts.title

const record = (balls: unknown[]) => ({ t: 0, frameCount: 0, frame: { balls } }) as unknown as TrackerRecord
const ball = (x: number) => ({ projected_coordinates: { x, y: 0 } })

function draw(over: Partial<FlashbackIndicator> = {}) {
  const { ctx, ops } = recordingCtx()
  const value: FlashbackIndicator = { alpha: 1, side: 'left', agoS: 167.9, leftShare: 1, ...over }
  drawFlashback(ctx as unknown as CanvasRenderingContext2D, T, value, DEFAULT_THEME)
  return ops
}
/** The points of the tab's path, an arc's two control points included. */
const points = (ops: Op[]) =>
  ops
    .filter((o) => o.op === 'moveTo' || o.op === 'lineTo' || o.op === 'arcTo')
    .flatMap((o) => (o.args as number[]).slice(0, 4).filter((_, i) => o.op === 'arcTo' || i < 2))
const rects = (ops: Op[]) => ops.filter((o) => o.op === 'fillRect')

describe('the flashback tab', () => {
  it('formats the time since the moment', () => {
    expect(formatAgo(167.9, '{time} AGO')).toBe('2:47 AGO')
    expect(formatAgo(45, '{time} AGO')).toBe('0:45 AGO')
    expect(formatAgo(3730, '{time} AGO')).toBe('62:10 AGO')
  })

  it('puts the tab away from the action', () => {
    expect(flashbackSide(record([ball(20)]))).toBe('left')
    expect(flashbackSide(record([ball(-20)]))).toBe('right')
    expect(flashbackSide(record([]))).toBe('left')
    expect(flashbackSide(record([ball(0)]))).toBe('left')
    expect(flashbackSide(record([{ projected_coordinates: { x: NaN } }, ball(-3)]))).toBe('right')
  })

  it('draws the stroke round the frame and the tab bottom left, at the design sizes', () => {
    const ops = draw()
    const stroke = ops.find((o) => o.op === 'rect' && o.strokeStyle === '#ffffff')!
    expect(stroke.args).toEqual([6 * u, 6 * u, FRAME_W - 12 * u, FRAME_H - 12 * u])
    const strokes = ops.filter((o) => o.op === 'stroke')
    expect(strokes).toHaveLength(1)
    expect(strokes[0]!.lineWidth).toBeCloseTo(12 * u, 9)
    expect(strokes[0]!.strokeStyle).toBe('#ffffff')

    const tab = ops.find((o) => o.op === 'fill' && o.fillStyle === '#ffffff')
    expect(tab).toBeDefined()
    const lines = points(ops)
    expect(Math.min(...lines.filter((_, i) => i % 2 === 0))).toBeCloseTo(12 * u, 9)
    const ys = lines.filter((_, i) => i % 2 === 1)
    expect(Math.max(...ys)).toBeCloseTo(FRAME_H - 12 * u, 9)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(112 * u, 9)

    const texts = ops.filter((o) => o.op === 'fillText')
    const title = texts.find((o) => o.args[0] === 'REPLAY')!
    expect(title.font).toBe(`italic 900 ${64 * u}px ${TITLE}`)
    expect(title.fillStyle).toBe('#166a51')
    const timer = texts.find((o) => o.args[0] === '2:47 AGO')!
    expect(timer.font).toBe(`italic 900 ${36 * u}px ${TITLE}`)
    expect(timer.args[2]).toBeCloseTo(title.args[2] as number, 9)
    expect(timer.args[1] as number).toBeGreaterThan((title.args[1] as number) + 24 * u)
    expect(timer.globalAlpha).toBeCloseTo(0.62, 9)
  })

  it('mirrors the tab to the right', () => {
    const ops = draw({ side: 'right' })
    const xs = points(ops).filter((_, i) => i % 2 === 0)
    expect(Math.max(...xs)).toBeCloseTo(FRAME_W - 12 * u, 9)
    const bar = rects(draw({ side: 'right' }))[0]!.args as number[]
    expect(bar[0]! + bar[2]!).toBeCloseTo(FRAME_W - 12 * u, 9)
  })

  it('shrinks the progress line with the clip', () => {
    const full = rects(draw())[0]!.args as number[]
    const half = rects(draw({ leftShare: 0.5 }))[0]!.args as number[]
    expect(full[3]).toBeCloseTo(6 * u, 9)
    expect(half[2]).toBeCloseTo(full[2]! / 2, 9)
    expect(rects(draw())[0]!.fillStyle).toBe('#166a51')
    expect(rects(draw())[0]!.globalAlpha).toBeCloseTo(0.35, 9)
    // Grows from the outer edge, the left edge on the left tab.
    expect(half[0]).toBeCloseTo(full[0]!, 9)
    const rightFull = rects(draw({ side: 'right' }))[0]!.args as number[]
    const rightHalf = rects(draw({ side: 'right', leftShare: 0.5 }))[0]!.args as number[]
    expect(rightHalf[0]! + rightHalf[2]!).toBeCloseTo(rightFull[0]! + rightFull[2]!, 9)
  })

  it('draws nothing at alpha 0, and no timer without one', () => {
    expect(draw({ alpha: 0 })).toEqual([])
    const ops = draw({ agoS: null })
    const words = ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])
    expect(words).toEqual(['REPLAY'])
  })
})

describe('the flashback in a frame', () => {
  let offscreen: ReturnType<typeof stubOffscreenCanvas>
  beforeEach(() => {
    offscreen = stubOffscreenCanvas()
  })
  afterEach(() => {
    offscreen.restore()
  })

  it('is drawn over the goal banner, fixed to the frame in a zoomed view', () => {
    const f = { pitch_dimensions: PITCH, teams: [], balls: [], state: { actions: [] } } as unknown as Frame
    const { canvas, ops } = fakeCanvas()
    const r = createRenderer(canvas)
    r.setView({ zoom: 2, panX: 0.2, panY: -0.1, renderedWidth: 1280 })
    r.renderFrame(f, {
      goalBanner: { intensity: 1 },
      flashback: { alpha: 1, side: 'left', agoS: 10, leftShare: 1 },
    })
    const banner = ops.findIndex((o) => o.op === 'fillRect' && o.fillStyle.includes('12, 63, 47'))
    const first = ops.findIndex((o) => o.op === 'fillText' && o.args[0] === 'REPLAY')
    expect(banner).toBeGreaterThanOrEqual(0)
    expect(first).toBeGreaterThan(banner)
    const transform = ops.slice(0, first).findLast((o) => o.op === 'setTransform')!
    expect(transform.args).toEqual([1, 0, 0, 1, 0, 0])
    const afterTab = ops.slice(first).find((o) => o.op === 'setTransform')!
    expect(afterTab.args).not.toEqual([1, 0, 0, 1, 0, 0])
  })
})
