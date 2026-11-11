import { describe, it, expect } from 'vitest'
import {
  APPROACH_FAR_METRES,
  APPROACH_MAX_ZOOM,
  APPROACH_NEAR_METRES,
  WHOLE_PITCH_CAMERA,
  approachCamera,
  approachWeight,
} from '../../src/analysis/goalApproach'
import { edgeAt } from '../../src/render/attackIndicator'
import { build2DTransform, FRAME_H, FRAME_W, worldToPx } from '../../src/model/pitch'

const PITCH = { length: 105, width: 68, goal_width: 7.32 }
const HALF = PITCH.length / 2

describe('approachWeight', () => {
  it('is nothing far from goal, everything near it, and climbs smoothly between', () => {
    expect(approachWeight(APPROACH_FAR_METRES)).toBe(0)
    expect(approachWeight(60)).toBe(0)
    expect(approachWeight(APPROACH_NEAR_METRES)).toBe(1)
    expect(approachWeight(0)).toBe(1)
    let before = 0
    for (let m = APPROACH_FAR_METRES; m >= APPROACH_NEAR_METRES; m -= 0.5) {
      const w = approachWeight(m)
      expect(w).toBeGreaterThanOrEqual(before)
      before = w
    }
  })
})

describe('approachCamera', () => {
  it('is the whole pitch with the ball far from either goal, the corner flags included', () => {
    for (const ball of [
      { x: 0, y: 0 },
      { x: 20, y: -10 },
      { x: -20, y: 30 },
      { x: HALF, y: PITCH.width / 2 },
      { x: -HALF, y: -PITCH.width / 2 },
    ]) {
      expect(approachCamera(ball, PITCH)).toEqual(WHOLE_PITCH_CAMERA)
    }
  })

  it('closes in, a little more the nearer the ball gets, never past its furthest', () => {
    let before = 1
    for (let x = 15; x <= HALF; x += 1) {
      const { zoom } = approachCamera({ x, y: 0 }, PITCH)
      expect(zoom).toBeGreaterThanOrEqual(before)
      expect(zoom).toBeLessThanOrEqual(APPROACH_MAX_ZOOM)
      before = zoom
    }
    expect(approachCamera({ x: HALF - 11, y: 0 }, PITCH).zoom).toBeCloseTo(APPROACH_MAX_ZOOM, 6)
  })

  it('looks towards the goal on the ball’s half, and mirrors between the two', () => {
    const right = approachCamera({ x: 38, y: 6 }, PITCH)
    const left = approachCamera({ x: -38, y: -6 }, PITCH)
    expect(right.zoom).toBeGreaterThan(1)
    expect(right.x).toBeGreaterThan(FRAME_W / 2)
    expect(left.x).toBeLessThan(FRAME_W / 2)
    expect(left.zoom).toBeCloseTo(right.zoom, 9)
    expect(left.x).toBeCloseTo(FRAME_W - right.x, 6)
    expect(left.y).toBeCloseTo(FRAME_H - right.y, 6)
  })

  it('never shows past the frame, wherever the ball is, off the pitch too', () => {
    for (let x = -HALF - 4; x <= HALF + 4; x += 2.5) {
      for (let y = -PITCH.width / 2 - 4; y <= PITCH.width / 2 + 4; y += 2.5) {
        const cam = approachCamera({ x, y }, PITCH)
        const halfW = FRAME_W / (2 * cam.zoom)
        const halfH = FRAME_H / (2 * cam.zoom)
        expect(cam.zoom).toBeGreaterThanOrEqual(1)
        expect(cam.x).toBeGreaterThanOrEqual(halfW - 1e-9)
        expect(cam.x).toBeLessThanOrEqual(FRAME_W - halfW + 1e-9)
        expect(cam.y).toBeGreaterThanOrEqual(halfH - 1e-9)
        expect(cam.y).toBeLessThanOrEqual(FRAME_H - halfH + 1e-9)
      }
    }
  })

  it('takes a pitch with no dimensions as the standard one', () => {
    expect(approachCamera({ x: 40, y: 0 }, undefined)).toEqual(approachCamera({ x: 40, y: 0 }, PITCH))
  })
})

describe('approachCamera and the attack', () => {
  // The attack's toothed edge sits a quarter of the pitch into the attacked half, at its middle, and its name
  // and "Attack" just behind it: the zoom near goal never crops them, so it leaves an attack its view.
  it('keeps the edge, and 15 m behind it, in view for any ball in the attacked half', () => {
    const t = build2DTransform(PITCH)
    for (const dir of [1, -1] as const) {
      const edge = edgeAt(dir, HALF)
      for (let x = 0; x <= HALF + 2; x += 1.5) {
        for (let y = -PITCH.width / 2; y <= PITCH.width / 2; y += 2) {
          const cam = approachCamera({ x: dir * x, y }, PITCH)
          for (const at of [edge, edge - dir * 15]) {
            const [px, py] = worldToPx(at, 0, t)
            expect(Math.abs(px - cam.x)).toBeLessThanOrEqual(FRAME_W / (2 * cam.zoom))
            expect(Math.abs(py - cam.y)).toBeLessThanOrEqual(FRAME_H / (2 * cam.zoom))
          }
        }
      }
    }
  })
})
