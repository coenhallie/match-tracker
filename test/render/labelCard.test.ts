import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drawLabelCard, drawSmallLabelCard, isLabelCardFrame, substitutionLiftPx, type LabelCardPlayer, type LabelCardSubstitution } from '../../src/render/labelCard'
import { createRenderer, type FrameLayers } from '../../src/render/renderer'
import { drawSmallCard } from '../../src/render/smallCard'
import { designUnit } from '../../src/render/pitchGeometry'
import { DEFAULT_THEME, type RenderTheme } from '../../src/render/theme'
import { LABEL_CARDS } from '../../src/model/labelCards'
import type { Frame } from '../../src/model/types'
import { fakeCanvas, recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'
import { build2DTransform, FRAME_W, worldToPx } from '../../src/model/pitch'

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

/**
 * Where the player's row, and a substitution card's first, has its baseline, below the band: its 64 px box
 * 122 below it, the 40 px text centred on a 64 px line.
 */
const ROW = 122 + (64 - 40 * (0.96875 + 494 / 2048)) / 2 + 40 * 0.96875

describe('a card about a team', () => {
  // The band's foot: the card is 384 px high, centred on the pitch.
  const FOOT = CY + 192 * u

  /** Draw the goal disallowed card with `team`, noting the shadow and alpha each text is written with. */
  function drawTeam(team: string | undefined, intensity = 1) {
    const { ctx, ops } = recordingCtx()
    const written = new Map<string, { color: string; blur: number; y: number; alpha: number }>()
    const fillText = ctx.fillText.bind(ctx)
    ctx.fillText = (...args: unknown[]) => {
      written.set(String(args[0]), { color: ctx.shadowColor, blur: ctx.shadowBlur, y: ctx.shadowOffsetY, alpha: ctx.globalAlpha })
      fillText(...args)
    }
    drawLabelCard(ctx as unknown as CanvasRenderingContext2D, T, { key: 'goalDisallowed', intensity, ...(team === undefined ? {} : { team }) })
    return { ops, written }
  }

  it('writes the team under the band as a player card does, 270.5 px below the pitch\'s middle, as viewport/eventGoalDisallowed has it', () => {
    const { ops, written } = drawTeam('Ajax')
    const team = ops.find((o) => o.op === 'fillText' && o.args[0] === 'Ajax')!
    expect(team.font).toContain(`900 ${48 * u}px`)
    expect(team.font).not.toContain('italic')
    expect(team.textAlign).toBe('center')
    expect(team.fillStyle).toBe('#ffffff')
    expect(team.args[1]).toBeCloseTo(CX, 6)
    expect(team.args[2]).toBeCloseTo(FOOT + 78.5 * u, 6)
    expect(team.args[2]).toBeCloseTo(CY + 270.5 * u, 6)
    expect(written.get('Ajax')).toEqual({ color: 'rgba(0, 0, 0, 0.5)', blur: 4 * u, y: 2 * u, alpha: 1 })
  })

  it('fades with the card, and writes nothing without a team', () => {
    expect(drawTeam('Ajax', 0.3).written.get('Ajax')!.alpha).toBeCloseTo(0.3, 6)
    expect(drawTeam(undefined).ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])).toEqual(['GOAL DISALLOWED'])
  })
})

describe('a card about a player', () => {
  // The band's foot: the card is 384 px high, centred on the pitch.
  const FOOT = CY + 192 * u
  // Inter's capitals are 1490 of its 2048 units high.
  const CAP = 1490 / 2048

  /** Draw the yellow card with `player`, noting the shadow each text is written with. */
  function drawPlayer(player: LabelCardPlayer | undefined, intensity = 1) {
    const { ctx, ops } = recordingCtx()
    const shadows = new Map<string, { color: string; blur: number; y: number }>()
    const fillText = ctx.fillText.bind(ctx)
    ctx.fillText = (...args: unknown[]) => {
      shadows.set(String(args[0]), { color: ctx.shadowColor, blur: ctx.shadowBlur, y: ctx.shadowOffsetY })
      fillText(...args)
    }
    drawLabelCard(ctx as unknown as CanvasRenderingContext2D, T, { key: 'yellowCard', intensity, ...(player ? { player } : {}) })
    return { ops, shadows }
  }
  const text = (ops: Op[], s: string) => ops.find((o) => o.op === 'fillText' && o.args[0] === s)
  const smallCard = (ops: Op[]) => ops.find((o) => o.op === 'fillRect' && o.fillStyle === '#EAB308')
  const PLAYER: LabelCardPlayer = { team: 'Ajax', player: 'Name', color: '#EAB308' }

  it('writes the team in Inter Black 48 px, centred, 78.5 px below the band, where every frame has it', () => {
    const { ops, shadows } = drawPlayer(PLAYER)
    const team = text(ops, 'Ajax')!
    expect(team.font).toContain(`900 ${48 * u}px`)
    expect(team.font).not.toContain('italic')
    expect(team.textAlign).toBe('center')
    expect(team.fillStyle).toBe('#ffffff')
    expect(team.args[1]).toBeCloseTo(CX, 6)
    // A 58 px line, its top 32 below the band's foot: 774 on the 1100 px frame, its ink 786 to 820.
    expect(team.args[2]).toBeCloseTo(FOOT + 78.5 * u, 6)
    expect(shadows.get('Ajax')).toEqual({ color: 'rgba(0, 0, 0, 0.5)', blur: 4 * u, y: 2 * u })
  })

  it('writes the player in Inter 600 40 px, 168.55 px below the band, after a small card in its colour, as the design places it', () => {
    const { ops, shadows } = drawPlayer(PLAYER)
    const name = text(ops, 'Name')!
    const [x, y, w, h] = smallCard(ops)!.args as number[]
    expect(w).toBeCloseTo(32 * u, 6)
    expect(h).toBeCloseTo(44 * u, 6)
    // The row's 64 px box is 122 below the band (864 on the 1100 px frame), its text centred on a 64 px
    // line; the small card's middle, 896 on the frame, is the middle of the capitals.
    expect(y! + h! / 2).toBeCloseTo(FOOT + (ROW - (CAP * 40) / 2) * u, 6)
    expect(FOOT / u + (ROW - (CAP * 40) / 2) - CY / u).toBeCloseTo(896 - 550, 1)
    expect(name.font).toContain(`600 ${40 * u}px`)
    expect(name.textAlign).toBe('left')
    expect(name.fillStyle).toBe('#ffffff')
    expect(name.args[2]).toBeCloseTo(FOOT + ROW * u, 6)
    // 37 px from the small card to the text, which puts the letters' ink 40 px from it, as in the design.
    expect(name.args[1]).toBeCloseTo(x! + (32 + 37) * u, 6)
    // The recording context measures every character at 0.6 of the size: "Name" is 96 px. The design
    // has the row 6 px right of the pitch's middle (measured on both frames; the team's name is centred).
    const right = (name.args[1] as number) + 4 * 40 * u * 0.6
    expect((x! + right) / 2).toBeCloseTo(CX + 6 * u, 6)
    expect(shadows.get('Name')).toEqual({ color: 'rgba(0, 0, 0, 0.25)', blur: 4 * u, y: 2 * u })
  })

  it('leaves out the team line, or the player row, it is not given', () => {
    const noTeam = drawPlayer({ ...PLAYER, team: null }).ops
    expect(noTeam.some((o) => o.op === 'fillText' && o.font.startsWith('900 '))).toBe(false)
    expect(text(noTeam, 'Name')).toBeDefined()
    const noPlayer = drawPlayer({ ...PLAYER, player: null }).ops
    expect(smallCard(noPlayer)).toBeUndefined()
    expect(text(noPlayer, 'Ajax')).toBeDefined()
    const neither = drawPlayer(undefined).ops
    expect(neither.filter((o) => o.op === 'fillText').map((o) => o.args[0])).toEqual(['YELLOW CARD'])
  })

  it('shrinks a long name, then cuts it, inside the frame', () => {
    const long = 'Bartholomew-Maximilian '.repeat(8).trim()
    const { ops } = drawPlayer({ ...PLAYER, team: long, player: long })
    const limit = (FRAME_W - 380 * u) / 2
    const team = ops.find((o) => o.op === 'fillText' && o.font.startsWith('900 '))!
    const teamPx = Number(/([\d.]+)px/.exec(team.font)![1])
    expect(teamPx).toBeLessThan(48 * u)
    expect((String(team.args[0]).length * teamPx * 0.6) / 2).toBeLessThanOrEqual(limit + 1e-6)
    const name = ops.find((o) => o.op === 'fillText' && o.font.startsWith('600 '))!
    const namePx = Number(/([\d.]+)px/.exec(name.font)![1])
    expect(namePx).toBeLessThan(40 * u)
    expect(String(name.args[0]).endsWith('…')).toBe(true)
    const [x] = smallCard(ops)!.args as number[]
    const right = (name.args[1] as number) + String(name.args[0]).length * namePx * 0.6
    expect(x!).toBeGreaterThanOrEqual(CX - limit - 1e-6)
    expect(right).toBeLessThanOrEqual(CX + limit + 1e-6)
  })

  it('fades the lines with the card', () => {
    const { ops } = drawPlayer(PLAYER, 0.5)
    expect(text(ops, 'Ajax')!.globalAlpha).toBe(0.5)
    expect(text(ops, 'Name')!.globalAlpha).toBe(0.5)
    expect(smallCard(ops)!.globalAlpha).toBe(0.5)
  })
})

describe('the substitution card', () => {
  const FOOT = CY + 192 * u
  const CAP = 1490 / 2048
  const OUT = { badge: 'out' } as unknown as CanvasImageSource
  const IN = { badge: 'in' } as unknown as CanvasImageSource
  const THEME: RenderTheme = { ...DEFAULT_THEME, icons: { ...DEFAULT_THEME.icons, substitutionOut: OUT, substitutionIn: IN } }
  const row = (out: string | null, inn: string | null, intensity = 1) => ({ out, in: inn, intensity })

  function drawSubs(substitution: LabelCardSubstitution, intensity = 1) {
    const { ctx, ops } = recordingCtx()
    drawLabelCard(ctx as unknown as CanvasRenderingContext2D, T, { key: 'substitution', intensity, substitution }, THEME)
    return ops
  }
  const text = (ops: Op[], s: string) => ops.filter((o) => o.op === 'fillText' && o.args[0] === s)
  const badges = (ops: Op[], badge: CanvasImageSource) =>
    ops.filter((o) => o.op === 'drawImage' && o.args[0] === badge).map((o) => o.args.slice(1) as number[])
  const bandTop = (ops: Op[]) => (ops.find((o) => o.op === 'fillRect')!.args as number[])[1]!

  it('lifts the card only once the last row would pass the touchline', () => {
    expect(substitutionLiftPx(T, 0)).toBe(0)
    expect(substitutionLiftPx(T, 1)).toBeCloseTo(0, 0)
    expect(substitutionLiftPx(T, 2)).toBeLessThan(2)
    // The last row's baseline at most 7.55 below the touchline, as the 5-row frame has it: the touchline is
    // 34 m, 439.1 design px, below the middle, and the third row's baseline 192 + 168.55 + 144 below it.
    expect(substitutionLiftPx(T, 3)).toBeCloseTo(192 + ROW + 144 - (34 * 1356) / 105 - 7.55, 1)
    expect(substitutionLiftPx(T, 4) - substitutionLiftPx(T, 3)).toBeCloseTo(72, 6)
    expect(substitutionLiftPx(T, 5) - substitutionLiftPx(T, 4)).toBeCloseTo(72, 6)
    expect(substitutionLiftPx(T, 5)).toBeCloseTo(192 + ROW + 288 - (34 * 1356) / 105 - 7.55, 1)
  })

  it('writes each row: going off, two badges, coming on', () => {
    const ops = drawSubs({ team: 'Arsenal', rows: [row('Off A', 'On A'), row('Off B', 'On B')], rowsShown: 2 })
    expect(text(ops, 'Arsenal')[0]!.args[2]).toBeCloseTo(FOOT + 78.5 * u, 6)
    for (const [i, [off, on]] of [['Off A', 'On A'], ['Off B', 'On B']].entries()) {
      const baseline = FOOT + (ROW + 72 * i) * u
      const out = text(ops, off!)[0]!
      expect(out.textAlign).toBe('right')
      expect(out.args[1]).toBeCloseTo(CX - (12 + 56 + 24) * u, 6)
      expect(out.args[2]).toBeCloseTo(baseline, 6)
      // The design's names are lighter than the player cards': Inter Regular, measured against its frames.
      expect(out.font).toContain(`400 ${40 * u}px`)
      const inn = text(ops, on!)[0]!
      expect(inn.textAlign).toBe('left')
      expect(inn.args[1]).toBeCloseTo(CX + (12 + 56 + 24) * u, 6)
      const capMiddle = baseline - (CAP * 40 * u) / 2
      const [ox, oy, ow, oh] = badges(ops, OUT)[i]!
      expect([ox, ow, oh].map((v) => v! / u)).toEqual([expect.closeTo((CX - (12 + 56) * u) / u, 6), expect.closeTo(56, 6), expect.closeTo(56, 6)])
      expect(oy! + oh! / 2).toBeCloseTo(capMiddle, 6)
      const [ix] = badges(ops, IN)[i]!
      expect(ix).toBeCloseTo(CX + 12 * u, 6)
    }
  })

  it('draws the whole card higher by its lift, the band included', () => {
    const two = drawSubs({ team: 'A', rows: [row('a', 'b'), row('c', 'd')], rowsShown: 2 })
    const five = drawSubs({ team: 'A', rows: Array.from({ length: 5 }, () => row('a', 'b')), rowsShown: 5 })
    const lift = substitutionLiftPx(T, 5) - substitutionLiftPx(T, 2)
    expect(bandTop(two) - bandTop(five)).toBeCloseTo(lift * u, 6)
    expect((text(two, 'A')[0]!.args[2] as number) - (text(five, 'A')[0]!.args[2] as number)).toBeCloseTo(lift * u, 6)
    // Halfway through a row joining, halfway up.
    const half = drawSubs({ team: 'A', rows: [row('a', 'b'), row('c', 'd'), row('e', 'f')], rowsShown: 2.5 })
    expect(bandTop(two) - bandTop(half)).toBeCloseTo(((substitutionLiftPx(T, 3) - substitutionLiftPx(T, 2)) / 2) * u, 6)
  })

  it('fades a row in with its intensity', () => {
    const ops = drawSubs({ team: 'A', rows: [row('a', 'b'), row('c', 'd', 0.25)], rowsShown: 2 }, 0.8)
    expect(text(ops, 'a')[0]!.globalAlpha).toBeCloseTo(0.8, 6)
    expect(text(ops, 'c')[0]!.globalAlpha).toBeCloseTo(0.2, 6)
  })

  it('leaves out a side with no name, and a row with neither', () => {
    const ops = drawSubs({ team: null, rows: [row(null, 'In'), row(null, null)], rowsShown: 2 })
    expect(ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])).toEqual(['SUBSTITUTION', 'In'])
    expect(badges(ops, OUT)).toHaveLength(1)
    expect(badges(ops, IN)).toHaveLength(1)
  })

  it('shrinks and cuts long names inside the frame', () => {
    const long = 'Bartholomew-Maximilian '.repeat(8).trim()
    const ops = drawSubs({ team: 'A', rows: [row(long, long)], rowsShown: 1 })
    const limit = FRAME_W / 2 - 190 * u
    const names = ops.filter((o) => o.op === 'fillText' && o.font.startsWith('400 '))
    expect(names).toHaveLength(2)
    for (const name of names) {
      const px = Number(/([\d.]+)px/.exec(name.font)![1])
      expect(px).toBeLessThan(40 * u)
      const width = String(name.args[0]).length * px * 0.6
      const x = name.args[1] as number
      if (name.textAlign === 'right') expect(x - width).toBeGreaterThanOrEqual(CX - limit - 1e-6)
      else expect(x + width).toBeLessThanOrEqual(CX + limit + 1e-6)
    }
  })

  it('lays a row out in the first free place when the one before it names no one', () => {
    const ops = drawSubs({ team: 'A', rows: [row(null, null), row('a', 'b')], rowsShown: 1 })
    expect(text(ops, 'a')[0]!.args[2]).toBeCloseTo(FOOT + ROW * u, 6)
  })

  it('never lifts the band past the top of the frame, on a pitch narrower for its length', () => {
    for (const pitch of [{ length: 110, width: 64 }, { length: 105, width: 60 }]) {
      const t = build2DTransform(pitch)
      const [, cy] = worldToPx(0, 0, t)
      const ut = designUnit(t)
      expect(cy - (192 + substitutionLiftPx(t, 5)) * ut).toBeGreaterThanOrEqual(-1e-6)
    }
  })
})

