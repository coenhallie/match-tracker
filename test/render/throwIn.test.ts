import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drawSmallCard } from '../../src/render/smallCard'
import { DEFAULT_THEME } from '../../src/render/theme'
import { drawThrowInIndicator, isThrowInFrame, type ThrowInIndicator } from '../../src/render/throwIn'
import { drawThrowInCard, drawThrowInPulse, type ThrowInCard } from '../../src/render/throwInCard'
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

// The card for a throw-in the camera cuts away from (Figma viewport/eventThrowInExclusive 136:2310):
// the label cards' band, 384 high and 190 either side of "THROW IN", centred on the pitch, the
// throw-in's icon in the 208 px slot under the title, and a pulse on the touchline.
describe('the throw-in card', () => {
  const CARD: ThrowInCard = { intensity: 1, playersFade: 1, ballFade: 1, spot: { x: -20, y: 34 }, team: 'Australia', rings: [1, 1, 1] }
  const ICON = { width: 123.5, height: 156 } as unknown as CanvasImageSource
  const [, CY] = worldToPx(0, 0, T)
  function drawCard(over: Partial<ThrowInCard> = {}, icon: CanvasImageSource | null = ICON) {
    const { ctx, ops } = recordingCtx()
    const theme = { ...DEFAULT_THEME, icons: { ...DEFAULT_THEME.icons, throwIn: icon } }
    drawThrowInCard(ctx as unknown as CanvasRenderingContext2D, T, { ...CARD, ...over }, theme)
    return { ctx, ops }
  }

  it('is the label cards’ band round "THROW IN", centred on the pitch, 384 high', () => {
    const { ops } = drawCard()
    const [left, top, width, height] = band(ops)
    expect(height / u).toBeCloseTo(384, 6)
    expect(left + width / 2).toBeCloseTo(CX, 6)
    expect(top + height / 2).toBeCloseTo(CY, 6)
    const text = ops.find((o) => o.op === 'fillText' && o.args[0] === 'THROW IN')!
    expect(text.font).toContain(`italic 900 ${92 * u}px`)
    expect(text.args[1]).toBeCloseTo(left + 190 * u, 6)
  })

  it('draws the throw-in icon where the design has it: 19.53% and 9.38% into its 208 px slot, 123.5 by 156', () => {
    const { ops } = drawCard()
    const [, top] = band(ops)
    const [source, x, y, w, h] = ops.find((o) => o.op === 'drawImage')!.args as [unknown, number, number, number, number]
    expect(source).toBe(ICON)
    expect(x).toBeCloseTo(CX + (-104 + 208 * 0.1953) * u, 3)
    expect(y).toBeCloseTo(top + (16 + 128 + 16 + 208 * 0.0938) * u, 3)
    expect(w).toBeCloseTo(123.5 * u, 6)
    expect(h).toBeCloseTo(156 * u, 6)
  })

  it('writes the team under the band, as the label cards do, and nothing for none', () => {
    expect(drawCard().ops.some((o) => o.op === 'fillText' && o.args[0] === 'Australia')).toBe(true)
    expect(drawCard({ team: null }).ops.filter((o) => o.op === 'fillText')).toHaveLength(1)
  })

  it('is drawn without its icon until it loads, fades with its intensity, and draws nothing at none', () => {
    expect(drawCard({}, null).ops.some((o) => o.op === 'drawImage')).toBe(false)
    expect(drawCard({ intensity: 0.5 }).ops.find((o) => o.op === 'fillRect')!.globalAlpha).toBe(0.5)
    expect(drawCard({ intensity: 0 }).ops).toHaveLength(0)
  })

  it('marks where the ball went out with the free kick’s pulse, on the touchline', () => {
    const { ctx, ops } = recordingCtx()
    drawThrowInPulse(ctx as unknown as CanvasRenderingContext2D, T, CARD)
    const arcs = ops.filter((o) => o.op === 'arc')
    const [sx, sy] = worldToPx(-20, 34, T)
    expect(arcs.length).toBeGreaterThan(0)
    for (const arc of arcs) {
      expect(arc.args[0]).toBeCloseTo(sx, 6)
      expect(arc.args[1]).toBeCloseTo(sy, 6)
    }
    // The design's outer ring: 38 px.
    expect(Math.max(...arcs.map((a) => a.args[2] as number)) / u).toBeCloseTo(38, 6)
    const none = recordingCtx()
    drawThrowInPulse(none.ctx as unknown as CanvasRenderingContext2D, T, { ...CARD, spot: null })
    expect(none.ops).toHaveLength(0)
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

  it('draws the card for a throw-in the camera cuts away from, its pulse under the players, and fades them out', () => {
    const card: ThrowInCard = { intensity: 1, playersFade: 1, ballFade: 1, spot: { x: -20, y: 34 }, team: null, rings: [1, 1, 1] }
    const { canvas, ops } = fakeCanvas()
    createRenderer(canvas).renderFrame(frame, { throwInCard: card })
    const [px, py] = worldToPx(5, 3, T)
    const [sx, sy] = worldToPx(-20, 34, T)
    const pulse = ops.findIndex((o) => o.op === 'arc' && Math.abs((o.args[0] as number) - sx) < 1e-6 && Math.abs((o.args[1] as number) - sy) < 1e-6)
    const player = ops.findIndex((o) => o.op === 'arc' && Math.abs((o.args[0] as number) - px) <= 1 && Math.abs((o.args[1] as number) - py) <= 1)
    const band = ops.findIndex((o) => o.op === 'fillRect' && o.fillStyle.includes('12, 63, 47'))
    expect(pulse).toBeGreaterThan(-1)
    expect(band).toBeGreaterThan(pulse)
    // Everyone faded out: the player is drawn at no strength, if at all.
    if (player > -1) expect(ops[player]!.globalAlpha).toBe(0)
    expect(ops.some((o) => o.op === 'fillText' && o.args[0] === 'THROW IN')).toBe(true)
  })

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
