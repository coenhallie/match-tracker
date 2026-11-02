import { describe, it, expect } from 'vitest'
import { build2DTransform, worldToPx } from '../../src/render/pitchGeometry'
import { FRAME_W, FRAME_H } from '../../src/render/constants'

const FULL = { length: 105, width: 68 }

describe('build2DTransform', () => {
  it('centres the pitch on the canvas', () => {
    const t = build2DTransform(FULL)
    const [cx, cy] = worldToPx(0, 0, t)
    expect(cx).toBeCloseTo(FRAME_W / 2, 5)
    expect(cy).toBeCloseTo(FRAME_H / 2, 5)
  })

  it('falls back to FIFA standard dimensions when none are given', () => {
    expect(build2DTransform(undefined).pl).toBe(105)
    expect(build2DTransform(undefined).pw).toBe(68)
  })

  it('keeps both pitch ends inside the canvas', () => {
    const t = build2DTransform(FULL)
    const [left] = worldToPx(-FULL.length / 2, 0, t)
    const [right] = worldToPx(FULL.length / 2, 0, t)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(right).toBeLessThanOrEqual(FRAME_W)
  })

  it('scales x and y by the same factor', () => {
    const t = build2DTransform(FULL)
    const [x0, y0] = worldToPx(0, 0, t)
    const [x1] = worldToPx(10, 0, t)
    const [, y1] = worldToPx(0, 10, t)
    expect(Math.abs(x1 - x0)).toBeCloseTo(Math.abs(y1 - y0), 5)
  })
})
