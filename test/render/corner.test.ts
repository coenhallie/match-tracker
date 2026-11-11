import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  CORNER_SECTION_METRES,
  SECTION_IN_MS,
  SECTION_PULSE_MS,
  SECTION_REST,
  SECTION_STAGGER_MS,
  SECTION_WAVE_MS,
  cornerSections,
  drawCornerCard,
  drawCornerCone,
  isCornerFrame,
  type CornerBanner,
} from '../../src/render/corner'
import { designUnit } from '../../src/render/pitchGeometry'
import { createRenderer } from '../../src/render/renderer'
import type { Frame } from '../../src/model/types'
import { fakeCanvas, recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'
import { normalizeCalls } from '../helpers/normalize'
import { build2DTransform, worldToPx } from '../../src/model/pitch'

const PITCH = { length: 105, width: 68 }
const T = build2DTransform(PITCH)
const u = designUnit(T)
const [CX, CY] = worldToPx(0, 0, T)

const banner = (over: Partial<CornerBanner> = {}): CornerBanner => ({
  intensity: 1,
  playersFade: 1,
  ballFade: 1,
  corner: { x: 1, y: 1 },
  sections: [1, 1, 1],
  ...over,
})

describe('corner label', () => {
  const frame = (labels: string[]) =>
    ({ teams: [], state: { actions: labels.map((action_type) => ({ action_type, action_origin: 'human' })) } }) as unknown as Frame

  it('matches however the export writes it', () => {
    expect(isCornerFrame(frame(['EventType.CORNER_KICK']))).toBe(true)
    expect(isCornerFrame(frame(['EventType.CORNER']))).toBe(true)
    expect(isCornerFrame(frame(['Corner kick']))).toBe(true)
    expect(isCornerFrame(frame(['Corner']))).toBe(true)
    expect(isCornerFrame(frame(['EventType.FREE_KICK']))).toBe(false)
    expect(isCornerFrame(frame(['EventType.GOAL_KICK']))).toBe(false)
    expect(isCornerFrame(frame(['Short corner routine']))).toBe(false)
    expect(isCornerFrame(frame([]))).toBe(false)
  })
})

describe('corner sections', () => {
  it('light up one after another from the flag out, each to full, then settle', () => {
    expect(cornerSections(0, false)).toEqual([0, 0, 0])
    // The first is halfway in when the second has not started.
    const early = cornerSections(SECTION_IN_MS / 2, false)
    expect(early[0]).toBeGreaterThan(0)
    expect(early[1]).toBe(0)
    // Each peaks at full as it finishes coming in.
    for (let i = 0; i < CORNER_SECTION_METRES.length; i++) {
      expect(cornerSections(i * SECTION_STAGGER_MS + SECTION_PULSE_MS / 2, false)[i]).toBeCloseTo(1, 6)
    }
    // Between waves, every section rests.
    const resting = cornerSections(SECTION_PULSE_MS + 2 * SECTION_STAGGER_MS + 10, false)
    for (const k of resting) expect(k).toBeCloseTo(SECTION_REST, 6)
  })

  it('run the wave out from the flag again every SECTION_WAVE_MS, never past full', () => {
    const at = SECTION_WAVE_MS + SECTION_PULSE_MS / 2
    expect(cornerSections(at, false)[0]).toBeCloseTo(1, 6)
    for (let ms = 0; ms < 3 * SECTION_WAVE_MS; ms += 7) {
      for (const k of cornerSections(ms, false)) {
        expect(k).toBeGreaterThanOrEqual(0)
        expect(k).toBeLessThanOrEqual(1)
      }
    }
  })

  it('are all lit, and still, under reduced motion', () => {
    for (const ms of [0, 100, 5000]) expect(cornerSections(ms, true)).toEqual([1, 1, 1])
  })
})

describe('corner cone', () => {
  function draw(over: Partial<CornerBanner> = {}) {
    const { ctx, ops } = recordingCtx()
    drawCornerCone(ctx as unknown as CanvasRenderingContext2D, PITCH, T, banner(over))
    return ops
  }
  const outerArcs = (ops: Op[]) => ops.filter((o) => o.op === 'arc' && o.args[5] === undefined)

  it('rings the flag of the corner it is given, a ring per section, clipped to the playing area', () => {
    for (const x of [-1, 1] as const) {
      for (const y of [-1, 1] as const) {
        const ops = draw({ corner: { x, y } })
        const [fx, fy] = worldToPx((x * PITCH.length) / 2, (y * PITCH.width) / 2, T)
        const clipAt = ops.findIndex((o) => o.op === 'clip')
        expect(ops.find((o) => o.op === 'roundRect')).toBeDefined()
        expect(clipAt).toBeGreaterThan(-1)
        const arcs = ops.filter((o) => o.op === 'arc')
        expect(arcs.length).toBeGreaterThan(0)
        for (const arc of arcs) {
          expect(arc.args[0]).toBeCloseTo(fx, 6)
          expect(arc.args[1]).toBeCloseTo(fy, 6)
        }
        expect(ops.findIndex((o) => o.op === 'arc')).toBeGreaterThan(clipAt)
      }
    }
  })

  it('makes each section the ring between its edge and the one inside it', () => {
    const ops = draw()
    const radii = outerArcs(ops).map((o) => Number(o.args[2]))
    expect(radii).toEqual(CORNER_SECTION_METRES.map((m) => m * T.sc))
    // The holes, wound the other way: none for the first, which reaches the flag.
    const holes = ops.filter((o) => o.op === 'arc' && o.args[5] === true).map((o) => Number(o.args[2]))
    expect(holes).toEqual(CORNER_SECTION_METRES.slice(0, -1).map((m) => m * T.sc))
  })

  /** Each section's white, at its inner edge and its outer edge, from its radial fill. */
  const whites = (ops: Op[]) =>
    ops
      .filter((o) => o.op === 'fill')
      .map((o) => [...o.fillStyle.matchAll(/rgba\(255, 255, 255, ([\d.e-]+)\)/g)].map((m) => Number(m[1])))

  it('divides the sections by their white alone, with no line between them', () => {
    const ops = draw()
    expect(ops.some((o) => o.op === 'stroke')).toBe(false)
    const fills = whites(ops)
    expect(fills).toHaveLength(CORNER_SECTION_METRES.length)
    fills.forEach(([inner, outer], i) => {
      // Stronger out to its edge...
      expect(outer).toBeGreaterThan(inner!)
      // ...where the next one starts fainter, and is fainter overall.
      const next = fills[i + 1]
      if (next) {
        expect(next[0]).toBeLessThan(outer!)
        expect(next[1]).toBeLessThan(outer!)
      }
    })
  })

  it('fills each section as strongly as it is lit', () => {
    const full = whites(draw())
    const lit = whites(draw({ intensity: 0.5, sections: [1, 0.5, 0] }))
    expect(lit).toHaveLength(2)
    lit[0]!.forEach((a, j) => expect(a).toBeCloseTo(full[0]![j]! * 0.5, 6))
    lit[1]!.forEach((a, j) => expect(a).toBeCloseTo(full[1]![j]! * 0.25, 6))
  })

  it('draws nothing unlit, faded out, or with no corner, and leaves the context as it found it', () => {
    expect(draw({ sections: [0, 0, 0] }).filter((o) => o.op === 'fill')).toHaveLength(0)
    expect(draw({ intensity: 0 })).toHaveLength(0)
    expect(draw({ corner: null })).toHaveLength(0)
    const ops = draw()
    expect(ops[0]!.op).toBe('save')
    expect(ops.at(-1)!.op).toBe('restore')
  })
})

describe('corner card', () => {
  const icon = { width: 45.5, height: 40.95 } as unknown as CanvasImageSource

  function draw(over: Partial<CornerBanner> = {}) {
    const { ctx, ops } = recordingCtx()
    drawCornerCard(ctx as unknown as CanvasRenderingContext2D, T, banner({ icon, ...over }))
    return ops
  }

  it('lays the card’s band across the middle of the pitch', () => {
    const [x, y, w, h] = draw().find((o) => o.op === 'fillRect')!.args as [number, number, number, number]
    expect(w).toBeCloseTo(736 * u, 6)
    expect(h).toBeCloseTo(373 * u, 6)
    expect(x + w / 2).toBeCloseTo(CX, 6)
    expect(y + h / 2).toBeCloseTo(CY, 6)
  })

  it('writes CORNER in white Inter Black Italic, centred on the card', () => {
    const text = draw().find((o) => o.op === 'fillText')!
    expect(text.args[0]).toBe('CORNER')
    expect((normalizeCalls([text])[0] as Op).font).toBe(`italic 900 ${92 * u}px Inter, sans-serif`)
    expect(text.fillStyle).toBe('#ffffff')
    // Its measured width in the bundled face, halved, left of the middle.
    expect(text.args[1]).toBeCloseTo(CX - (391.18 / 2) * u, 6)
  })

  it('draws the corner icon centred under the title, in proportion', () => {
    const [img, x, , w, h] = draw().find((o) => o.op === 'drawImage')!.args as [
      unknown,
      number,
      number,
      number,
      number,
    ]
    expect(img).toBe(icon)
    expect(x + w / 2).toBeCloseTo(CX, 6)
    expect(w / h).toBeCloseTo(45.5 / 40.95, 2)
  })

  it('fades as a whole, and is drawn without the icon until it has loaded', () => {
    const ops = draw({ intensity: 0.4 })
    for (const op of ops.filter((o) => ['fillRect', 'fillText', 'drawImage'].includes(o.op))) {
      expect(op.globalAlpha).toBeCloseTo(0.4, 6)
    }
    expect(draw({ icon: null }).find((o) => o.op === 'drawImage')).toBeUndefined()
  })
})

describe('corner in the renderer', () => {
  let offscreen: ReturnType<typeof stubOffscreenCanvas>
  beforeEach(() => {
    offscreen = stubOffscreenCanvas()
  })
  afterEach(() => {
    offscreen.restore()
  })

  const frame = {
    pitch_dimensions: PITCH,
    teams: [
      { team_id: 1, players: [{ track_id: 7, person_type: 'PersonType.PLAYER', projected_coordinates: { x: 5, y: 3 } }] },
    ],
    balls: [{ projected_coordinates: { x: 10, y: 0 } }],
    state: { actions: [] },
  } as unknown as Frame
  const [PX, PY] = worldToPx(5, 3, T)
  const [FX, FY] = worldToPx(PITCH.length / 2, PITCH.width / 2, T)

  function render(corner?: CornerBanner) {
    const { canvas, ops } = fakeCanvas()
    createRenderer(canvas).renderFrame(frame, { corner })
    return ops
  }

  it('draws the cone under the players and the card over everything, fading the players out', () => {
    const ops = render(banner({ playersFade: 0.5 }))
    const cone = ops.findIndex((o) => o.op === 'arc' && o.args[0] === FX && o.args[1] === FY)
    const player = ops.findIndex((o) => o.op === 'arc' && o.args[0] === PX && o.args[1] === PY)
    const card = ops.findIndex((o) => o.op === 'fillText' && o.args[0] === 'CORNER')
    expect(cone).toBeGreaterThan(-1)
    expect(player).toBeGreaterThan(cone)
    expect(card).toBeGreaterThan(player)
    expect(ops[player]!.globalAlpha).toBeCloseTo(0.5, 6)
    const gone = render(banner({ playersFade: 1 }))
    expect(gone.some((o) => o.op === 'arc' && o.args[0] === PX && o.args[1] === PY)).toBe(false)
  })

  it('draws nothing of it without one', () => {
    const ops = render()
    expect(ops.some((o) => o.op === 'arc' && o.args[0] === FX && o.args[1] === FY)).toBe(false)
    expect(ops.some((o) => o.op === 'fillText' && o.args[0] === 'CORNER')).toBe(false)
  })
})
