import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drawThrowInIndicator, isThrowInFrame, type ThrowInIndicator } from '../../src/render/throwIn'
import { build2DTransform, designUnit, worldToPx } from '../../src/render/pitchGeometry'
import { createRenderer } from '../../src/render/renderer'
import { FRAME_W } from '../../src/render/constants'
import type { Frame } from '../../src/model/types'
import { fakeCanvas, recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'
import { normalizeCalls } from '../helpers/normalize'

const PITCH = { length: 105, width: 68 }
const T = build2DTransform(PITCH)
const u = designUnit(T)
/** The middle of the bottom touchline. */
const [CX, TOUCHLINE] = worldToPx(0, PITCH.width / 2, T)

function draw(over: Partial<ThrowInIndicator> = {}) {
  const { ctx, ops } = recordingCtx()
  drawThrowInIndicator(ctx as unknown as CanvasRenderingContext2D, PITCH, T, {
    intensity: 1,
    slide: 1,
    side: -1,
    ...over,
  })
  return ops
}

const band = (ops: Op[]) => ops.find((o) => o.op === 'fillRect')?.args as [number, number, number, number]
const title = (ops: Op[]) => ops.find((o) => o.op === 'fillText')

describe('throw-in label', () => {
  const frame = (labels: string[]) =>
    ({ teams: [], state: { actions: labels.map((action_type) => ({ action_type })) } }) as unknown as Frame

  it('matches however the export writes it', () => {
    expect(isThrowInFrame(frame(['EventType.THROW_IN']))).toBe(true)
    expect(isThrowInFrame(frame(['Throw in']))).toBe(true)
    expect(isThrowInFrame(frame(['EventType.FREE_KICK']))).toBe(false)
    expect(isThrowInFrame(frame([]))).toBe(false)
  })
})

describe('throw-in indicator', () => {
  // The design's band is 501 by 109, its top 90 px above the bottom touchline.
  it('sits on the bottom touchline, centred, the design’s size, once in place', () => {
    const [x, y, w, h] = band(draw())
    expect(w).toBeCloseTo(501 * u, 6)
    expect(h).toBeCloseTo(109 * u, 6)
    expect(x + w / 2).toBeCloseTo(CX, 6)
    expect(y).toBeCloseTo(TOUCHLINE - 90 * u, 6)
  })

  it('starts wholly past the frame’s edge on its side', () => {
    const [lx, , lw] = band(draw({ slide: 0, side: -1 }))
    expect(lx + lw).toBeLessThan(1e-6)
    const [rx] = band(draw({ slide: 0, side: 1 }))
    expect(rx).toBeGreaterThan(FRAME_W - 1e-6)
  })

  it('moves in from its side as it slides', () => {
    const at = (slide: number, side: -1 | 1) => band(draw({ slide, side }))[0]
    expect(at(0.5, -1)).toBeLessThan(at(1, -1))
    expect(at(0.5, -1)).toBeGreaterThan(at(0, -1))
    expect(at(0.5, 1)).toBeGreaterThan(at(1, 1))
    expect(at(0.5, 1)).toBeLessThan(at(0, 1))
  })

  it('stays in place without a side', () => {
    expect(band(draw({ slide: 0, side: null }))).toEqual(band(draw()))
  })

  it('writes THROW IN in white Inter Black Italic where the design has it', () => {
    const ops = draw()
    const text = title(ops)!
    const [x, y] = band(ops)
    expect(text.args[0]).toBe('THROW IN')
    // The bundled face's private name and CJK fallback, read as the reference's family (theme.ts).
    expect((normalizeCalls([text])[0] as Op).font).toBe(`italic 900 ${64 * u}px Inter, sans-serif`)
    expect(text.fillStyle).toBe('#ffffff')
    expect(text.args[1]).toBeCloseTo(x + (501 / 2 - 165.5) * u, 6)
    expect(text.args[2]).toBeCloseTo(y + (16 + 64 * 0.96875) * u, 6)
  })

  it('fades as a whole, and draws nothing at zero', () => {
    const ops = draw({ intensity: 0.3 })
    expect(ops.find((o) => o.op === 'fillRect')!.globalAlpha).toBeCloseTo(0.3, 6)
    expect(title(ops)!.globalAlpha).toBeCloseTo(0.3, 6)
    expect(draw({ intensity: 0 })).toHaveLength(0)
  })
})

describe('throw-in in the renderer', () => {
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
      {
        team_id: 0,
        players: [{ track_id: 7, person_type: 'PersonType.PLAYER', projected_coordinates: { x: 5, y: 3 } }],
      },
    ],
    balls: [{ projected_coordinates: { x: 10, y: 0 } }],
    state: { actions: [] },
  } as unknown as Frame

  it('draws over the players, and leaves them as they are', () => {
    const render = (throwIn?: ThrowInIndicator) => {
      const { canvas, ops } = fakeCanvas()
      createRenderer(canvas).renderFrame(frame, { throwIn })
      return ops
    }
    const [px, py] = worldToPx(5, 3, T)
    const isPlayer = (o: Op) =>
      o.op === 'arc' && (o.args[0] === px || o.args[0] === px + 1) && (o.args[1] === py || o.args[1] === py + 1)
    const plain = render().filter(isPlayer)
    const ops = render({ intensity: 1, slide: 1, side: 1 })
    expect(ops.filter(isPlayer).map((o) => o.globalAlpha)).toEqual(plain.map((o) => o.globalAlpha))
    const bandAt = ops.findIndex((o) => o.op === 'fillRect' && o.fillStyle.includes('12, 63, 47'))
    expect(bandAt).toBeGreaterThan(ops.findLastIndex(isPlayer))
  })
})
