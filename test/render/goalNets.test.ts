import { describe, it, expect } from 'vitest'
import { drawGoalNets } from '../../src/render/goalNets'
import { NET_DEPTH_METRES } from '../../src/analysis/goalSequence'
import { build2DTransform, designUnit, worldToPx, PITCH_LINE_ALPHA } from '../../src/render/pitchGeometry'
import { recordingCtx } from '../helpers/recordingCtx'

const PITCH = { length: 105, width: 68, goal_width: 7.32 }
const T = build2DTransform(PITCH)

function draw(bulge?: { side: 1 | -1; y: number; metres: number }) {
  const { ctx, ops } = recordingCtx()
  drawGoalNets(ctx as unknown as CanvasRenderingContext2D, PITCH, T, bulge)
  return ops
}

const isRight = (x: unknown) => Number(x) > 640

describe('drawGoalNets', () => {
  it('runs each goal from post to post on the goal line', () => {
    const starts = draw().filter((o) => o.op === 'moveTo')
    const ends = draw().filter((o) => o.op === 'lineTo')
    for (const x of [-52.5, 52.5]) {
      const [px, top] = worldToPx(x, -3.66, T)
      const [, bottom] = worldToPx(x, 3.66, T)
      expect(starts.some((o) => o.args[0] === px && o.args[1] === top)).toBe(true)
      expect(ends.some((o) => o.args[0] === px && o.args[1] === bottom)).toBe(true)
    }
  })

  it("puts the back of each goal the design's depth behind the goal line", () => {
    // 37 design pixels on a 1356 pixel, 105 m pitch.
    expect(NET_DEPTH_METRES).toBeCloseTo(2.865, 3)
    const corners = draw().filter((o) => o.op === 'arcTo')
    for (const x of [-52.5 - NET_DEPTH_METRES, 52.5 + NET_DEPTH_METRES]) {
      const [px] = worldToPx(x, 0, T)
      expect(corners.some((o) => o.args[0] === px)).toBe(true)
    }
  })

  it('rounds the back corners at rest, as the design does', () => {
    const corners = draw().filter((o) => o.op === 'arcTo')
    // Two corners per goal, each traced by the fill and by the outline.
    expect(corners).toHaveLength(8)
    for (const c of corners) expect(Number(c.args[4])).toBeCloseTo(designUnit(T), 6)
  })

  it('outlines the goal in white at the line opacity, over a fainter white fill', () => {
    const ops = draw()
    const strokes = ops.filter((o) => o.op === 'stroke')
    const fills = ops.filter((o) => o.op === 'fill')
    expect(strokes).toHaveLength(2)
    expect(fills).toHaveLength(2)
    for (const s of strokes) {
      expect(s.strokeStyle).toBe('#ffffff')
      expect(s.globalAlpha).toBe(PITCH_LINE_ALPHA)
    }
    for (const f of fills) {
      expect(f.fillStyle).toBe('#ffffff')
      expect(f.globalAlpha).toBeCloseTo(0.2 * PITCH_LINE_ALPHA, 6)
    }
  })

  it('clips each goal to beyond the outside of the goal line', () => {
    const clips = draw().filter((o) => o.op === 'rect')
    const halfLine = 2 * designUnit(T)
    const [left] = worldToPx(-52.5, 0, T)
    const [right] = worldToPx(52.5, 0, T)
    expect(Number(clips[0]!.args[0])).toBeCloseTo(left - halfLine, 6)
    expect(Number(clips[0]!.args[2])).toBeLessThan(0)
    expect(Number(clips[1]!.args[0])).toBeCloseTo(right + halfLine, 6)
    expect(Number(clips[1]!.args[2])).toBeGreaterThan(0)
  })

  it('bows the back of the struck net outwards, and only that one', () => {
    const struck = draw({ side: 1, y: 0, metres: 0.5 })
    const curves = struck.filter((o) => o.op === 'quadraticCurveTo')
    // Fill and outline, both on the struck goal only.
    expect(curves).toHaveLength(2)
    // quadraticCurveTo(cpx, cpy, x, y): the control point sits out by twice
    // the bulge, which puts the curve's own peak out by the bulge.
    const [backX] = worldToPx(52.5 + NET_DEPTH_METRES, 0, T)
    for (const c of curves) {
      expect(isRight(c.args[2])).toBe(true)
      expect(Number(c.args[0]) - backX).toBeCloseTo(2 * 0.5 * T.sc, 6)
    }
    // The other goal keeps its straight, rounded back.
    const leftCorners = struck.filter((o) => o.op === 'arcTo' && !isRight(o.args[0]))
    expect(leftCorners).toHaveLength(4)
  })

  // The moment of impact has to read at a glance, not only as a few pixels of
  // bulge.
  it('brightens the struck net while it moves, and only that one', () => {
    const fillAlpha = (ops: ReturnType<typeof draw>, side: 'left' | 'right') =>
      ops.filter((o) => o.op === 'fill').map((o) => o.globalAlpha)[side === 'left' ? 0 : 1]
    const still = draw()
    const struck = draw({ side: 1, y: 0, metres: 0.8 })
    expect(fillAlpha(struck, 'right')).toBeGreaterThan(fillAlpha(still, 'right')!)
    expect(fillAlpha(struck, 'left')).toBe(fillAlpha(still, 'left'))
  })

  it('leaves the context as it found it', () => {
    const ops = draw()
    expect(ops.filter((o) => o.op === 'save')).toHaveLength(2)
    expect(ops.filter((o) => o.op === 'restore')).toHaveLength(2)
    expect(ops.at(-1)!.op).toBe('restore')
  })
})
