import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { build2DTransform, buildPitchCache, resolvePitchDimensions, designUnit } from '../../src/render/pitchGeometry'
import type { PitchDimensions } from '../../src/model/types'
import { stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'

// Exactly the keys the pipeline's own export carries. It states neither
// center_circle_radius nor penalty_mark_distance in any of its 121,371 frames,
// so those two markings are always drawn from standard values.
const AS_EXPORTED: Partial<PitchDimensions> = {
  length: 105,
  width: 68,
  penalty_area_length: 16.5,
  penalty_area_width: 40.32,
  goal_area_length: 5.5,
  goal_area_width: 18.32,
  goal_width: 7.32,
  goal_height: 2.44,
}

describe('resolvePitchDimensions', () => {
  it('reports a dimension the frame states as measured', () => {
    const d = resolvePitchDimensions(AS_EXPORTED)
    expect(d.length).toEqual({ value: 105, assumed: false })
    expect(d.penalty_area_length).toEqual({ value: 16.5, assumed: false })
  })

  it('reports a dimension the frame omits as assumed, with the standard value', () => {
    const d = resolvePitchDimensions(AS_EXPORTED)
    expect(d.center_circle_radius).toEqual({ value: 9.15, assumed: true })
    expect(d.penalty_mark_distance).toEqual({ value: 11, assumed: true })
  })

  it('reports every dimension as assumed when the frame states none', () => {
    const d = resolvePitchDimensions(undefined)
    expect(Object.values(d).every((x) => x.assumed)).toBe(true)
  })
})

describe('buildPitchCache marking fidelity', () => {
  let stub: ReturnType<typeof stubOffscreenCanvas>

  beforeEach(() => {
    stub = stubOffscreenCanvas()
  })
  afterEach(() => {
    stub.restore()
  })

  const draw = (pd: Partial<PitchDimensions> | undefined): Op[] => {
    buildPitchCache(pd, build2DTransform(pd))
    return stub.ops
  }

  /** The centre circle is the only large-radius arc on the pitch. */
  const centreCircle = (ops: Op[]) => ops.find((o) => o.op === 'arc' && Number(o.args[2]) > 10)

  /** Penalty marks are the small dots away from the canvas centre. */
  const penaltyMarks = (ops: Op[]) =>
    ops.filter((o) => o.op === 'arc' && Number(o.args[2]) <= 4 && Math.abs(Number(o.args[0]) - 640) > 10)

  // The Figma pitch draws every marking solid. Whether a dimension was assumed
  // is still reported by resolvePitchDimensions, but no longer drawn.
  it('draws the centre circle solid even when the frame omits its radius', () => {
    const arc = centreCircle(draw(AS_EXPORTED))
    expect(arc).toBeDefined()
    expect(arc!.lineDash).toEqual([])
    expect(arc!.globalAlpha).toBe(1)
  })

  it('draws the penalty marks solid even when the frame omits their distance', () => {
    const marks = penaltyMarks(draw(AS_EXPORTED))
    expect(marks).toHaveLength(2)
    for (const m of marks) {
      expect(m.lineDash).toEqual([])
      expect(m.globalAlpha).toBe(1)
    }
  })

  it('draws every marking solid when the frame states nothing at all', () => {
    const ops = draw(undefined).filter((o) => o.op === 'stroke' || o.op === 'strokeRect' || o.op === 'fill')
    expect(ops.length).toBeGreaterThan(0)
    for (const o of ops.filter((x) => x.fillStyle === '#ffffff' || x.op !== 'fill')) {
      expect(o.lineDash).toEqual([])
    }
  })

  it('draws the penalty and goal areas at full strength', () => {
    const boxes = draw(AS_EXPORTED).filter((o) => o.op === 'strokeRect')
    expect(boxes).toHaveLength(4)
    for (const b of boxes) {
      expect(b.lineDash).toEqual([])
      expect(b.globalAlpha).toBe(1)
    }
  })

  it("draws the outer box's line around the stated pitch, rounded as in the design", () => {
    const t = build2DTransform(AS_EXPORTED)
    const u = designUnit(t)
    const [shade, line] = draw(AS_EXPORTED).filter((o) => o.op === 'roundRect')
    // The line runs down its own middle: 8px outside, so 6px there.
    ;[t.ox, t.oy, 105 * t.sc, 68 * t.sc, 6 * u].forEach((v, i) => expect(Number(line!.args[i])).toBeCloseTo(v, 6))
    // The playing area's shade reaches the outside of the line, 8px round.
    ;[t.ox - 2 * u, t.oy - 2 * u, 105 * t.sc + 4 * u, 68 * t.sc + 4 * u, 8 * u].forEach((v, i) =>
      expect(Number(shade!.args[i])).toBeCloseTo(v, 6),
    )
  })

  it('scales the line weight with the pitch as drawn', () => {
    const t = build2DTransform(AS_EXPORTED)
    // The design's goal lines are 1356 design pixels apart.
    expect(designUnit(t) * 1356).toBeCloseTo(105 * t.sc, 6)
  })

  it('leaves no dash or transparency in force after the pitch is drawn', () => {
    const ops = draw(AS_EXPORTED)
    const last = ops.at(-1)
    expect(last).toBeDefined()
    expect(last!.lineDash).toEqual([])
    expect(last!.globalAlpha).toBe(1)
  })
})
