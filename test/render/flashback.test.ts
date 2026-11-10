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
/** The white shape's subpaths, each as its points, an arc's two control points included. */
const subpaths = (ops: Op[]) => {
  const paths: number[][][] = []
  for (const o of ops) {
    if (o.op === 'moveTo') paths.push([])
    if (o.op !== 'moveTo' && o.op !== 'lineTo' && o.op !== 'arcTo') continue
    const args = o.args as number[]
    paths.at(-1)!.push([args[0]!, args[1]!])
    if (o.op === 'arcTo') paths.at(-1)!.push([args[2]!, args[3]!])
  }
  return paths
}
/** Twice a closed path's signed area: its sign is the way round it goes. */
const winding = (path: number[][]) =>
  path.reduce((sum, [x, y], i) => {
    const [nx, ny] = path[(i + 1) % path.length]!
    return sum + x! * ny! - nx! * y!
  }, 0)
/** The tab's subpath: the third, after the frame's edge and the hole. */
const tabPoints = (ops: Op[]) => subpaths(ops)[2]!.flat()
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
    // One white shape, filled once: the stroke and the tab.
    expect(ops.filter((o) => o.op === 'stroke')).toHaveLength(0)
    const fills = ops.filter((o) => o.op === 'fill')
    expect(fills).toHaveLength(1)
    expect(fills[0]!.fillStyle).toBe('#ffffff')
    const [outer, hole, tab] = subpaths(ops)
    expect(outer).toEqual([
      [0, 0],
      [FRAME_W, 0],
      [FRAME_W, FRAME_H],
      [0, FRAME_H],
    ])
    expect(hole).toEqual([
      [12 * u, 12 * u],
      [12 * u, FRAME_H - 12 * u],
      [FRAME_W - 12 * u, FRAME_H - 12 * u],
      [FRAME_W - 12 * u, 12 * u],
    ])

    // The tab: its top 112 above the stroke's inner edge, its rounded corner on the pitch's side.
    const xs = tab!.map(([x]) => x!)
    const ys = tab!.map(([, y]) => y!)
    const top = FRAME_H - 12 * u - 112 * u
    expect(Math.min(...ys)).toBeCloseTo(top, 9)
    const corner = ops.find((o) => o.op === 'arcTo')!.args as number[]
    expect(corner[0]).toBeCloseTo(Math.max(...xs), 9)
    expect(corner[1]).toBeCloseTo(top, 9)
    expect(corner[4]).toBeCloseTo(4 * u, 9)
    expect(Math.max(...xs) - 12 * u).toBeGreaterThan(0)

    const texts = ops.filter((o) => o.op === 'fillText')
    const title = texts.find((o) => o.args[0] === 'REPLAY')!
    expect(title.font).toBe(`italic 900 ${64 * u}px ${TITLE}`)
    expect(title.fillStyle).toBe('#166a51')
    expect(title.args[1]).toBeCloseTo(12 * u + 16 * u, 9)
    // The timer, drawn a figure at a time: "2", ":", "4", "7", " AGO".
    const timer = texts.filter((o) => o.args[0] !== 'REPLAY')
    expect(timer.map((o) => o.args[0]).join('')).toBe('2:47 AGO')
    for (const part of timer) {
      expect(part.font).toBe(`italic 900 ${36 * u}px ${TITLE}`)
      expect(part.args[2]).toBeCloseTo(title.args[2] as number, 9)
      expect(part.globalAlpha).toBeCloseTo(0.62, 9)
    }
    // The fake measures every character at 0.6 of the size.
    const titleW = 6 * 64 * u * 0.6
    expect(timer[0]!.args[1]).toBeCloseTo((title.args[1] as number) + titleW + 24 * u, 9)
    const timerW = 8 * 36 * u * 0.6
    // 16 on the outer side and 32 on the inner side of the words.
    expect(Math.max(...xs)).toBeCloseTo((title.args[1] as number) + titleW + 24 * u + timerW + 32 * u, 9)
  })

  it('fills the tab on under the stroke to the edge of the frame, so no grass shows between them', () => {
    for (const side of ['left', 'right'] as const) {
      const [outer, hole, tab] = subpaths(draw({ side }))
      // Nonzero winding: the frame's edge and the tab go one way round, the hole the other.
      expect(Math.sign(winding(outer!))).toBe(Math.sign(winding(tab!)))
      expect(Math.sign(winding(hole!))).toBe(-Math.sign(winding(outer!)))
      const xs = tab!.map(([x]) => x!)
      const ys = tab!.map(([, y]) => y!)
      expect(Math.max(...ys)).toBe(FRAME_H)
      expect(side === 'left' ? Math.min(...xs) : Math.max(...xs)).toBe(side === 'left' ? 0 : FRAME_W)
    }
  })

  it('mirrors the tab to the right', () => {
    const left = tabPoints(draw()).filter((_, i) => i % 2 === 0)
    const right = tabPoints(draw({ side: 'right' })).filter((_, i) => i % 2 === 0)
    // The rounded corner and the wider padding swap sides: the inner edge mirrors the left tab's.
    expect(Math.min(...right)).toBeCloseTo(FRAME_W - Math.max(...left), 9)
    const corner = draw({ side: 'right' }).find((o) => o.op === 'arcTo')!.args as number[]
    expect(corner[0]).toBeCloseTo(Math.min(...right), 9)
    const bar = rects(draw({ side: 'right' }))[0]!.args as number[]
    expect(bar[0]! + bar[2]!).toBeCloseTo(FRAME_W - 12 * u, 9)
    const title = draw({ side: 'right' }).find((o) => o.op === 'fillText' && o.args[0] === 'REPLAY')!
    expect(title.args[1]).toBeCloseTo(Math.min(...right) + 32 * u, 9)
  })

  it('keeps the tab and the words after the time still as the seconds tick', () => {
    // A face whose 1 is narrow, as Inter's is.
    const narrowOne = (agoS: number) => {
      const { ctx, ops } = recordingCtx()
      ctx.measureText = (text: string) => {
        const size = Number(/([\d.]+)px/.exec(ctx.font)?.[1] ?? 10)
        return { width: [...text].reduce((w, c) => w + (c === '1' ? 0.3 : 0.6) * size, 0) }
      }
      const value: FlashbackIndicator = { alpha: 1, side: 'right', agoS, leftShare: 1 }
      drawFlashback(ctx as unknown as CanvasRenderingContext2D, T, value, DEFAULT_THEME)
      return ops
    }
    const at = (ops: Op[]) => ({
      inner: Math.min(...tabPoints(ops).filter((_, i) => i % 2 === 0)),
      ago: ops.find((o) => o.op === 'fillText' && o.args[0] === ' AGO')!.args[1],
    })
    expect(at(narrowOne(11))).toEqual(at(narrowOne(38)))
    expect(at(narrowOne(0))).toEqual(at(narrowOne(38)))
    // The 1 is centred in its cell.
    const ones = narrowOne(11).filter((o) => o.op === 'fillText' && o.args[0] === '1')
    const cell = 0.6 * 36 * u
    expect((ones[1]!.args[1] as number) - (ones[0]!.args[1] as number)).toBeCloseTo(cell, 9)
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

  it('covers the action text, which would be white on its tab', () => {
    const f = {
      pitch_dimensions: PITCH,
      teams: [],
      balls: [],
      state: { actions: [{ action_type: 'Shot on goal', action_origin: 'human' }] },
    } as unknown as Frame
    const { canvas, ops } = fakeCanvas()
    const r = createRenderer(canvas)
    r.renderFrame(f, { flashback: { alpha: 1, side: 'left', agoS: 10, leftShare: 1 } })
    const action = ops.findIndex((o) => o.op === 'fillText' && o.args[0] === 'Shot on goal')
    // The tab is the white fill just before its title.
    const title = ops.findIndex((o) => o.op === 'fillText' && o.args[0] === 'REPLAY')
    const tab = ops.slice(0, title).findLastIndex((o) => o.op === 'fill' && o.fillStyle === '#ffffff')
    expect(action).toBeGreaterThanOrEqual(0)
    expect(tab).toBeGreaterThan(action)
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
