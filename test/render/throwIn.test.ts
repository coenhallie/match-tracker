import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drawSmallCard } from '../../src/render/smallCard'
import { DEFAULT_THEME } from '../../src/render/theme'
import { drawThrowInIndicator, isThrowInFrame, type ThrowInIndicator } from '../../src/render/throwIn'
import { designUnit } from '../../src/render/pitchGeometry'
import { createRenderer } from '../../src/render/renderer'
import type { Frame } from '../../src/model/types'
import { fakeCanvas, recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'
import { normalizeCalls } from '../helpers/normalize'
import { build2DTransform, FRAME_W, worldToPx } from '../../src/model/pitch'

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
    ({ teams: [], state: { actions: labels.map((action_type) => ({ action_type, action_origin: 'human' })) } }) as unknown as Frame

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

  // The widget's throw-in: the reference's slides, as above.
  it('is the small card when drawn in place, call for call, whatever its side and however far it has slid', () => {
    const card = recordingCtx()
    drawSmallCard(card.ctx as unknown as CanvasRenderingContext2D, PITCH, T, 'THROW IN', DEFAULT_THEME.fonts.title, 0.4)
    expect(card.ops.length).toBeGreaterThan(0)
    for (const side of [-1, 1, null] as const) {
      for (const slide of [0, 0.4, 1]) expect(draw({ intensity: 0.4, slide, side, inPlace: true })).toEqual(card.ops)
    }
  })

  it('stands where the design has it when drawn in place, hugging its title', () => {
    const { ctx, ops } = recordingCtx()
    ctx.measureText = (() => ({ width: 331 * u })) as never
    drawThrowInIndicator(ctx as unknown as CanvasRenderingContext2D, PITCH, T, { intensity: 1, slide: 1, side: 1, inPlace: true })
    const [left, top, width, height] = band(ops)
    expect(width / u).toBeCloseTo(587, 6)
    expect(height / u).toBeCloseTo(112, 6)
    expect(left + width / 2).toBeCloseTo(CX, 6)
    expect((TOUCHLINE - top) / u).toBeCloseTo(60, 6)
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

  // Laid out for the whole pitch: zoomed or panned, by the user or the zoom near goal, the throw-in's band and
  // the corner's card stay on the frame where the whole pitch has them, whole, as the goal's card does.
  it.each(['throwIn', 'corner'] as const)('draws the %s card on the frame in a zoomed and panned view', (moment) => {
    const layers =
      moment === 'throwIn'
        ? { throwIn: { intensity: 1, slide: 1, side: 1 as const, inPlace: true } }
        : { corner: { intensity: 1, playersFade: 1, ballFade: 1, corner: { x: 1 as const, y: 1 as const }, sections: [1, 1, 1] } }
    const render = (zoomed: boolean) => {
      const { canvas, ops } = fakeCanvas()
      const renderer = createRenderer(canvas)
      if (zoomed) renderer.setView({ zoom: 2, panX: -300, panY: 120, renderedWidth: 1280 })
      renderer.renderFrame(frame, layers as never)
      return ops
    }
    const isCard = (o: Op) => o.op === 'fillText' && /THROW|CORNER/.test(String(o.args[0]))
    const whole = render(false)
    const ops = render(true)
    const at = ops.findIndex(isCard)
    expect(at).toBeGreaterThan(-1)
    const transforms = ops.slice(0, at).filter((o) => o.op === 'setTransform')
    expect(transforms.at(-1)!.args).toEqual([1, 0, 0, 1, 0, 0])
    // Drawn as in the whole pitch, call for call.
    const card = (list: Op[]) => list.filter(isCard).map((o) => o.args)
    expect(card(ops)).toEqual(card(whole))
    // And the view is put back after it, for what is drawn over it.
    const after = ops.slice(at).find((o) => o.op === 'setTransform')
    expect(after!.args).toEqual([2, 0, 0, 2, -940, -240])
  })
})
