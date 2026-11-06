import { describe, it, expect } from 'vitest'
import { drawLabelCard, isLabelCardFrame } from '../../src/render/labelCard'
import { build2DTransform, designUnit, worldToPx } from '../../src/render/pitchGeometry'
import { FRAME_W } from '../../src/render/constants'
import { DEFAULT_THEME, type RenderTheme } from '../../src/render/theme'
import { LABEL_CARDS } from '../../src/model/labelCards'
import type { Frame } from '../../src/model/types'
import { recordingCtx, type Op } from '../helpers/recordingCtx'

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
