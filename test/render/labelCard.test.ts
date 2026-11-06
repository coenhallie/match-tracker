import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drawLabelCard, drawSmallLabelCard, isLabelCardFrame } from '../../src/render/labelCard'
import { createRenderer, type FrameLayers } from '../../src/render/renderer'
import { drawSmallCard } from '../../src/render/smallCard'
import { build2DTransform, designUnit, worldToPx } from '../../src/render/pitchGeometry'
import { FRAME_W } from '../../src/render/constants'
import { DEFAULT_THEME, type RenderTheme } from '../../src/render/theme'
import { LABEL_CARDS } from '../../src/model/labelCards'
import type { Frame } from '../../src/model/types'
import { fakeCanvas, recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'

const T = build2DTransform({ length: 105, width: 68 })
const u = designUnit(T)
const [CX, CY] = worldToPx(0, 0, T)
const ICON = { icon: true } as unknown as CanvasImageSource

function draw(over: { intensity?: number; icon?: CanvasImageSource | null } = {}, theme?: RenderTheme, width?: number) {
  const { ctx, ops } = recordingCtx()
  // The recording context measures every title at this many design pixels.
  if (width !== undefined) ctx.measureText = (() => ({ width: width * u })) as never
  drawLabelCard(ctx as unknown as CanvasRenderingContext2D, T, { key: 'varCheck', intensity: 1, ...over }, theme)
  return { ops, measured: ctx }
}

const band = (ops: Op[]) => ops.find((o) => o.op === 'fillRect')?.args as [number, number, number, number]
const title = (ops: Op[]) => ops.find((o) => o.op === 'fillText')
const image = (ops: Op[]) => ops.find((o) => o.op === 'drawImage')?.args as [unknown, number, number, number, number]

describe('a label card', () => {
  it('hugs its title: 190 px either side and 384 px high, centred on the pitch', () => {
    const [left, top, width, height] = band(draw({}, undefined, 480).ops)
    expect(width / u).toBeCloseTo(480 + 380, 6)
    expect(height / u).toBeCloseTo(384, 6)
    expect(left + width / 2).toBeCloseTo(CX, 6)
    expect(top + height / 2).toBeCloseTo(CY, 6)
  })

  it('is as wide as its icon slot under a title shorter than that', () => {
    const [, , width] = band(draw({}, undefined, 100).ops)
    expect(width / u).toBeCloseTo(208 + 380, 6)
  })

  it('centres its title on the band, on the design’s line', () => {
    const { ops } = draw({}, undefined, 480)
    const [left, top] = band(ops)
    const text = title(ops)!
    expect(text.args[0]).toBe('VAR CHECK')
    expect(text.args[1]).toBeCloseTo(left + 190 * u, 6)
    // 16 down, then the middle of the 128 px line: Inter's line box is 111.34 px at 92 px.
    expect(((text.args[2] as number) - top) / u).toBeCloseTo(16 + (128 - 111.34) / 2 + 89.125, 1)
    expect(text.font).toContain(`italic 900 ${92 * u}px`)
  })

  it('never gets wider than the frame: a title too long for that is shrunk to fit', () => {
    const framePx = FRAME_W / u
    const { ops } = draw({}, undefined, framePx * 2)
    const [left, , width] = band(ops)
    expect(width).toBeCloseTo(FRAME_W, 6)
    expect(left).toBeCloseTo(CX - FRAME_W / 2, 6)
    expect(title(ops)!.font).not.toContain(`${92 * u}px`)
  })

  it('draws its icon where its design has it in the slot below the title', () => {
    const { ops } = draw({ icon: ICON })
    const [, top] = band(ops)
    const [source, x, y, w, h] = image(ops)
    expect(source).toBe(ICON)
    expect(x).toBeCloseTo(CX + (-104 + 16.25) * u, 6)
    expect(y).toBeCloseTo(top + (16 + 128 + 16 + 41.436) * u, 6)
    expect(w).toBeCloseTo(175.5 * u, 6)
    expect(h).toBeCloseTo(94.25 * u, 6)
  })

  it('takes its words and icon from the theme, and is drawn without an icon until it loads', () => {
    const theme = {
      ...DEFAULT_THEME,
      text: { ...DEFAULT_THEME.text, varCheck: 'VAR 检查' },
      icons: { ...DEFAULT_THEME.icons, varCheck: ICON },
    }
    const themed = draw({}, theme).ops
    expect(title(themed)!.args[0]).toBe('VAR 检查')
    expect(image(themed)[0]).toBe(ICON)
    expect(image(draw().ops)).toBeUndefined()
  })

  it('fades with its intensity, and draws nothing at none', () => {
    expect(band(draw({ intensity: 0.5 }).ops)).toBeDefined()
    expect(draw({ intensity: 0.5 }).ops.find((o) => o.op === 'fillRect')!.globalAlpha).toBe(0.5)
    expect(draw({ intensity: 0 }).ops).toHaveLength(0)
  })
})

describe('the goal disallowed card', () => {
  function drawn(width: number) {
    const { ctx, ops } = recordingCtx()
    ctx.measureText = (() => ({ width: width * u })) as never
    const theme = { ...DEFAULT_THEME, icons: { ...DEFAULT_THEME.icons, goalDisallowed: ICON } }
    drawLabelCard(ctx as unknown as CanvasRenderingContext2D, T, { key: 'goalDisallowed', intensity: 1 }, theme)
    return ops
  }

  it('is the same card, with its own title and its icon centred in the slot', () => {
    const ops = drawn(870)
    const [left, top, width, height] = band(ops)
    expect(title(ops)!.args[0]).toBe('GOAL DISALLOWED')
    expect(width / u).toBeCloseTo(870 + 380, 6)
    expect(height / u).toBeCloseTo(384, 6)
    expect(left + width / 2).toBeCloseTo(CX, 6)
    const [source, x, y, w, h] = image(ops)
    expect(source).toBe(ICON)
    expect(x + w / 2).toBeCloseTo(CX, 6)
    expect(y).toBeCloseTo(top + (160 + 29.25) * u, 6)
    expect(w).toBeCloseTo(149.5 * u, 6)
    expect(h).toBeCloseTo(149.5 * u, 6)
  })
})

describe('the half time card', () => {
  function drawn(titleWidth: number, text?: string) {
    const { ctx, ops } = recordingCtx()
    const real = ctx.measureText
    // The title is measured at `titleWidth` design pixels; the text as the recording context measures it.
    ctx.measureText = ((s: string) => (s === 'HALF TIME' ? { width: titleWidth * u } : real(s))) as never
    const theme = text ? { ...DEFAULT_THEME, text: { ...DEFAULT_THEME.text, halfTimeText: text } } : DEFAULT_THEME
    drawLabelCard(ctx as unknown as CanvasRenderingContext2D, T, { key: 'halfTime', intensity: 1 }, theme)
    return ops
  }
  const lines = (ops: Op[]) => ops.filter((o) => o.op === 'fillText' && o.args[0] !== 'HALF TIME')

  it('is the same card, hugging its title, with a short text and no icon under the title', () => {
    const ops = drawn(505)
    const [left, top, width, height] = band(ops)
    expect(title(ops)!.args[0]).toBe('HALF TIME')
    expect(title(ops)!.font).toContain(`italic 900 ${92 * u}px`)
    expect(width / u).toBeCloseTo(505 + 380, 6)
    expect(height / u).toBeCloseTo(384, 6)
    expect(left + width / 2).toBeCloseTo(CX, 6)
    expect(top + height / 2).toBeCloseTo(CY, 6)
    expect(image(ops)).toBeUndefined()
    const text = lines(ops)
    expect(text.length).toBeGreaterThanOrEqual(2)
    expect(text[0]!.font).toContain(`600 ${40 * u}px`)
    expect(text[0]!.font).not.toContain('italic')
    expect(text[0]!.textAlign).toBe('center')
    // 16 px down the slot, 48 px apart, centred on the band.
    expect(((text[0]!.args[2] as number) - top) / u).toBeCloseTo(176 + (48 - 40 * (0.96875 + 494 / 2048)) / 2 + 40 * 0.96875, 6)
    expect(((text[1]!.args[2] as number) - (text[0]!.args[2] as number)) / u).toBeCloseTo(48, 6)
    expect(text[0]!.args[1]).toBeCloseTo(CX, 6)
  })

  it('is no narrower than its text with a short title, and fades as one', () => {
    const [, , width] = band(drawn(100))
    expect(width / u).toBeCloseTo(480 + 380, 6)
    const { ctx, ops } = recordingCtx()
    drawLabelCard(ctx as unknown as CanvasRenderingContext2D, T, { key: 'halfTime', intensity: 0.5 })
    for (const op of ops.filter((o) => o.op === 'fillText' || o.op === 'fillRect')) expect(op.globalAlpha).toBe(0.5)
  })

  it('draws the theme\'s text, line by line, with no shadow left on it, and fits a long one', () => {
    const { ctx, ops } = recordingCtx()
    const shadows: string[] = []
    const fillText = ctx.fillText.bind(ctx)
    ctx.fillText = ((...args: Parameters<typeof fillText>) => {
      shadows.push(String((ctx as unknown as { shadowColor: string }).shadowColor))
      fillText(...args)
    }) as never
    const theme = { ...DEFAULT_THEME, text: { ...DEFAULT_THEME.text, halfTimeText: 'One\nTwo' } }
    drawLabelCard(ctx as unknown as CanvasRenderingContext2D, T, { key: 'halfTime', intensity: 1 }, theme)
    expect(lines(ops).map((o) => o.args[0])).toEqual(['One', 'Two'])
    expect(shadows.at(-1)).toBe('transparent')

    const long = lines(drawn(505, Array.from({ length: 60 }, () => 'word').join(' ')))
    expect(long).toHaveLength(4)
    expect(String(long.at(-1)!.args[0]).endsWith('…')).toBe(true)
  })
})

describe('the second half card', () => {
  it.each([
    ['secondHalf', 'SECOND HALF'],
    ['fullTime', 'FULL TIME'],
  ] as const)('%s is the half time card with its own words: the same band, title line and text lines', (key, words) => {
    const of = (key: 'halfTime' | 'secondHalf' | 'fullTime') => {
      const { ctx, ops } = recordingCtx()
      ctx.measureText = (() => ({ width: 505 * u })) as never
      const theme = {
        ...DEFAULT_THEME,
        text: { ...DEFAULT_THEME.text, halfTimeText: 'One\nTwo', secondHalfText: 'One\nTwo', fullTimeText: 'One\nTwo' },
      }
      drawLabelCard(ctx as unknown as CanvasRenderingContext2D, T, { key, intensity: 1 }, theme)
      return ops
    }
    const half = of('halfTime')
    const second = of(key)
    expect(band(second)).toEqual(band(half))
    expect(second.filter((o) => o.op === 'fillText').map((o) => o.args.slice(1))).toEqual(
      half.filter((o) => o.op === 'fillText').map((o) => o.args.slice(1)),
    )
    expect(title(second)!.args[0]).toBe(words)
    expect(image(second)).toBeUndefined()
  })
})

describe.each(['varCheck', 'goalDisallowed', 'halfTime', 'secondHalf', 'fullTime'] as const)('the %s card over the pitch', (key) => {
  /** Close to the ball, so not faint for being far from it. */
  const PLAYER = { x: 15, y: -5 }
  const BALL = { x: 20, y: -10 }
  const TURN = { x: -30, y: -20, age: 0 }
  const frame = {
    pitch_dimensions: { length: 105, width: 68 },
    teams: [{ team_id: 0, players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: PLAYER }] }],
    balls: [{ projected_coordinates: BALL }],
  } as unknown as Frame
  const trail = { runs: [[TURN, { ...BALL, age: 0 }]], turns: [TURN] } as FrameLayers['trail']
  const [PX, PY] = worldToPx(PLAYER.x, PLAYER.y, T)
  const [BX, BY] = worldToPx(BALL.x, BALL.y, T)
  const [TX, TY] = worldToPx(TURN.x, TURN.y, T)

  let offscreen: ReturnType<typeof stubOffscreenCanvas>
  beforeEach(() => {
    offscreen = stubOffscreenCanvas()
  })
  afterEach(() => offscreen.restore())

  function render(intensity: number | null, more: FrameLayers = {}) {
    const { canvas, ops } = fakeCanvas()
    const labelCard = intensity === null ? undefined : { key, intensity }
    createRenderer(canvas).renderFrame(frame, { trail, labelCard, ...more })
    return ops
  }
  /** Every op drawn at this point: a person, the ball, or a dot of its trail. */
  const at = (ops: Op[], x: number, y: number) =>
    ops.filter((o) => o.op === 'arc' && Math.abs((o.args[0] as number) - x) < 1e-6 && Math.abs((o.args[1] as number) - y) < 1e-6)

  it('draws the player, the ball and its trail at full strength with no card', () => {
    const ops = render(null)
    expect(at(ops, PX, PY)[0]!.globalAlpha).toBeCloseTo(1, 6)
    expect(at(ops, BX, BY).length).toBeGreaterThan(0)
    expect(at(ops, TX, TY).length).toBeGreaterThan(0)
  })

  it('fades them out as far as the card has faded in', () => {
    const ops = render(0.25)
    expect(at(ops, PX, PY)[0]!.globalAlpha).toBeCloseTo(0.75, 6)
    expect(at(ops, BX, BY)[0]!.globalAlpha).toBeCloseTo(0.75, 6)
    expect(at(ops, TX, TY)[0]!.globalAlpha).toBeLessThanOrEqual(0.75)
  })

  it('leaves none of them with the card fully in, and draws the card over the pitch', () => {
    const ops = render(1)
    expect(at(ops, PX, PY)).toHaveLength(0)
    expect(at(ops, BX, BY)).toHaveLength(0)
    expect(at(ops, TX, TY)).toHaveLength(0)
    expect(ops.some((o) => o.op === 'fillRect' && o.globalAlpha === 1)).toBe(true)
  })

  it('lets nobody show through as it hands over to a corner', () => {
    const corner = { intensity: 0.5, playersFade: 0.5, ballFade: 0.5, corner: null, sections: [] }
    const ops = render(0.5, { corner })
    expect(at(ops, PX, PY)).toHaveLength(0)
    expect(at(ops, BX, BY)).toHaveLength(0)
  })
})

describe('a small label card', () => {
  const PITCH = { length: 105, width: 68 }
  const [, TOUCHLINE] = worldToPx(0, PITCH.width / 2, T)

  function drawSmall(width: number, intensity = 1) {
    const { ctx, ops } = recordingCtx()
    ctx.measureText = (() => ({ width: width * u })) as never
    drawSmallLabelCard(ctx as unknown as CanvasRenderingContext2D, PITCH, T, { key: 'foul', intensity })
    return ops
  }

  it.each([
    ['shotOnGoal', 'SHOT!'],
    ['headerOnGoal', 'HEADER!'],
    ['foul', 'FOUL'],
  ] as const)('draws %s as the same card, with its own words', (key, words) => {
    const of = (intensity: number) => {
      const { ctx, ops } = recordingCtx()
      drawSmallLabelCard(ctx as unknown as CanvasRenderingContext2D, PITCH, T, { key, intensity })
      return ops
    }
    const card = recordingCtx()
    drawSmallCard(card.ctx as unknown as CanvasRenderingContext2D, PITCH, T, words, DEFAULT_THEME.fonts.title, 0.5)
    expect(of(0.5)).toEqual(card.ops)
    expect(title(of(1))!.args[0]).toBe(words)
  })

  it('hugs its title with 128 px either side, 112 px high, its top 60 px above the bottom touchline', () => {
    const [left, top, width, height] = band(drawSmall(190))
    expect(width / u).toBeCloseTo(190 + 256, 6)
    expect(height / u).toBeCloseTo(112, 6)
    expect(left + width / 2).toBeCloseTo(CX, 6)
    expect((TOUCHLINE - top) / u).toBeCloseTo(60, 6)
  })

  it('writes the title alone, centred, 64 px on an 80 px line, on the same band as the throw-in', () => {
    const ops = drawSmall(190)
    const [left, top] = band(ops)
    const text = title(ops)!
    expect(text.args[0]).toBe('FOUL')
    expect(text.font).toContain(`italic 900 ${64 * u}px`)
    expect(text.args[1]).toBeCloseTo(left + 128 * u, 6)
    expect(((text.args[2] as number) - top) / u).toBeCloseTo(16 + (80 - 64 * (0.96875 + 494 / 2048)) / 2 + 64 * 0.96875, 6)
    expect(ops.find((o) => o.op === 'fillRect')!.fillStyle).toContain('0.25:rgb(12, 63, 47)')
    expect(ops.filter((o) => o.op === 'fillText')).toHaveLength(1)
    expect(image(ops)).toBeUndefined()
  })

  it('fades with its intensity, draws nothing at none, and shrinks a title too long for the frame', () => {
    expect(drawSmall(190, 0.5).find((o) => o.op === 'fillRect')!.globalAlpha).toBe(0.5)
    expect(drawSmall(190, 0)).toHaveLength(0)
    const long = drawSmall((FRAME_W / u) * 2)
    expect(band(long)[2]).toBeCloseTo(FRAME_W, 6)
    expect(title(long)!.font).not.toContain(`${64 * u}px`)
  })

  describe('over the pitch', () => {
    const frame = {
      pitch_dimensions: PITCH,
      teams: [{ team_id: 0, players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x: 15, y: -5 } }] }],
      balls: [{ projected_coordinates: { x: 20, y: -10 } }],
    } as unknown as Frame
    const trail = { runs: [], turns: [{ x: -30, y: -20, age: 0 }] } as FrameLayers['trail']
    let offscreen: ReturnType<typeof stubOffscreenCanvas>
    beforeEach(() => {
      offscreen = stubOffscreenCanvas()
    })
    afterEach(() => offscreen.restore())

    function render(smallLabelCard?: FrameLayers['smallLabelCard'], zoomed = false) {
      const { canvas, ops } = fakeCanvas()
      const renderer = createRenderer(canvas)
      if (zoomed) renderer.setView({ zoom: 2, panX: -300, panY: 120, renderedWidth: 1280 })
      renderer.renderFrame(frame, { trail, smallLabelCard })
      return ops
    }
    const arcs = (ops: Op[]) => ops.filter((o) => o.op === 'arc').map((o) => [o.args[0], o.args[1], o.globalAlpha])

    it('leaves the players, the ball and its trail exactly as they are, and draws over them', () => {
      const plain = render()
      const ops = render({ key: 'foul', intensity: 1 })
      expect(arcs(ops)).toEqual(arcs(plain))
      expect(arcs(plain).length).toBeGreaterThan(0)
      const bandAt = ops.findIndex((o) => o.op === 'fillRect' && o.fillStyle.includes('12, 63, 47'))
      expect(bandAt).toBeGreaterThan(ops.findLastIndex((o) => o.op === 'arc'))
    })

    it('stays on the frame in a zoomed view, as the throw-in does', () => {
      const isTitle = (o: Op) => o.op === 'fillText' && o.args[0] === 'FOUL'
      const whole = render({ key: 'foul', intensity: 1 })
      const ops = render({ key: 'foul', intensity: 1 }, true)
      expect(ops.filter(isTitle).map((o) => o.args)).toEqual(whole.filter(isTitle).map((o) => o.args))
      const at = ops.findIndex(isTitle)
      expect(ops.slice(0, at).filter((o) => o.op === 'setTransform').at(-1)!.args).toEqual([1, 0, 0, 1, 0, 0])
    })
  })
})

describe('a label card’s labels', () => {
  const frame = (action_type: string, action_origin = 'human') =>
    ({ teams: [], state: { actions: [{ action_type, action_origin }] } }) as unknown as Frame
  const names = LABEL_CARDS.find((card) => card.key === 'varCheck')!.labels

  it.each(['VAR check', 'var check', 'VAR CHECK', 'Var Check', 'VAR_CHECK', 'var-check', 'EventType.VAR_CHECK', '  VAR  check '])(
    'matches %j, in any case and however it is written',
    (label) => {
      expect(isLabelCardFrame(frame(label), names)).toBe(true)
    },
  )

  it('does not match other labels, or one a human did not give', () => {
    expect(isLabelCardFrame(frame('VAR'), names)).toBe(false)
    expect(isLabelCardFrame(frame('Goal'), names)).toBe(false)
    expect(isLabelCardFrame(frame('VAR check', 'ai'), names)).toBe(false)
  })
})
