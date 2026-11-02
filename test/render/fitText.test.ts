import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fitFontPx } from '../../src/render/fitText'
import { createRenderer, type FrameLayers } from '../../src/render/renderer'
import { DEFAULT_THEME, type RenderTheme } from '../../src/render/theme'
import { build2DTransform, designUnit, worldToPx } from '../../src/render/pitchGeometry'
import type { Frame } from '../../src/model/types'
import { recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'

// The recording context measures every character as 0.6 of the font size.
const ctx = () => recordingCtx().ctx as unknown as CanvasRenderingContext2D
const font = (px: number) => `600 ${px}px Test`

describe('fitFontPx', () => {
  it('keeps the size of text that fits', () => {
    // 10 characters at 20 px: 120 wide.
    expect(fitFontPx(ctx(), 'ABCDEFGHIJ', font, 20, 120)).toBe(20)
    expect(fitFontPx(ctx(), 'ABCDEFGHIJ', font, 20, 500)).toBe(20)
  })

  it('shrinks text that does not, to the largest size that fits', () => {
    // 150 wide at 20 px, against 120: 16 px is 120 wide.
    const c = ctx()
    const px = fitFontPx(c, 'ABCDEFGHIJ', font, 20, 120 / 1.25)
    expect(px).toBeCloseTo(16, 9)
    c.font = font(px)
    expect(c.measureText('ABCDEFGHIJ').width).toBeLessThanOrEqual(120 / 1.25 + 1e-9)
  })

  it('shrinks text twice too wide no further than 60% of the size', () => {
    // Half the size would fit, but that is below the floor.
    expect(fitFontPx(ctx(), 'ABCDEFGHIJ', font, 20, 60)).toBe(20 * 0.6)
    expect(fitFontPx(ctx(), 'ABCDEFGHIJ', font, 20, 1)).toBe(20 * 0.6)
  })

  it('leaves the context as it found it', () => {
    const c = ctx()
    c.font = 'bold 9px sans-serif'
    fitFontPx(c, 'ABCDEFGHIJ', font, 20, 60)
    expect(c.font).toBe('bold 9px sans-serif')
  })
})

describe('canvas text fits its card', () => {
  const PITCH = { length: 105, width: 68 }
  const FRAME = {
    pitch_dimensions: PITCH,
    teams: [],
    balls: [{ projected_coordinates: { x: -10, y: 4 } }],
  } as unknown as Frame
  const T = build2DTransform(PITCH)
  const u = designUnit(T)
  const [CX, CY] = worldToPx(0, 0, T)
  const width = (op: Op) => String(op.args[0]).length * 0.6 * Number(/([\d.]+)px/.exec(op.font)![1])
  const sizePx = (op: Op) => Number(/([\d.]+)px/.exec(op.font)![1]) / u

  let offscreen: ReturnType<typeof stubOffscreenCanvas>
  beforeEach(() => {
    offscreen = stubOffscreenCanvas()
  })
  afterEach(() => {
    offscreen.restore()
  })

  /** Draw into a box `boxPx` wide, at 16:9, and hand back the text drawn. */
  function textAt(boxPx: number, text: Partial<RenderTheme['text']>, layers: FrameLayers): Op[] {
    const { ctx, ops } = recordingCtx()
    const canvas = { width: boxPx, height: (boxPx * 9) / 16, getContext: () => ctx } as unknown as HTMLCanvasElement
    createRenderer(canvas, { ...DEFAULT_THEME, text: { ...DEFAULT_THEME.text, ...text } }).renderFrame(FRAME, layers)
    return ops.filter((o) => o.op === 'fillText')
  }

  // The centre card is 736 design px wide; its title keeps the clearance it
  // has above it (13 px) from the card's right edge.
  const cardLeft = CX - 368 * u
  const cardInnerRight = cardLeft + (736 - 13) * u
  const freeKick: FrameLayers = { freeKick: { intensity: 1, playersFade: 0 } }

  it('draws the free kick title in Chinese at full size, within the card, in a 320 px box', () => {
    const [title] = textAt(320, { freeKick: '任意球' }, freeKick)
    expect(title!.args[0]).toBe('任意球')
    expect(sizePx(title!)).toBeCloseTo(92, 6)
    expect(Number(title!.args[1])).toBeGreaterThanOrEqual(cardLeft)
    expect(Number(title!.args[1]) + width(title!)).toBeLessThanOrEqual(cardInnerRight + 1e-6)
  })

  it('shrinks a title too long for the card until it fits', () => {
    // 12 characters at 92 px: 662 design px, against the 587 from its left edge.
    const [title] = textAt(320, { freeKick: 'TIRO LIBRE!!' }, freeKick)
    expect(sizePx(title!)).toBeLessThan(92)
    expect(sizePx(title!)).toBeGreaterThan(92 * 0.6)
    expect(Number(title!.args[1]) + width(title!)).toBeCloseTo(cardInnerRight, 6)
  })

  it('stops shrinking at 60% of the size', () => {
    const [title] = textAt(320, { freeKick: 'CALCIO DI PUNIZIONE' }, freeKick)
    expect(sizePx(title!)).toBeCloseTo(92 * 0.6, 6)
  })

  it("keeps the title's place and the card's baseline when it shrinks", () => {
    const [english] = textAt(1280, {}, freeKick)
    const [shrunk] = textAt(1280, { freeKick: 'TIRO LIBRE!!' }, freeKick)
    expect(shrunk!.args[1]).toBe(english!.args[1])
    expect(shrunk!.args[2]).toBe(english!.args[2])
    expect(Number(english!.args[2])).toBeGreaterThan(CY - (373 / 2) * u)
  })

  it('shrinks a goal title too long for the card', () => {
    const [title] = textAt(320, { goal: 'GOOOOOOOAL!' }, { goalBanner: { intensity: 1 } })
    expect(sizePx(title!)).toBeLessThan(92)
    expect(Number(title!.args[1]) + width(title!)).toBeCloseTo(cardInnerRight, 6)
  })

  it('shrinks a throw-in title too long for its band', () => {
    // The band is 501 design px wide, centred, with the title 85 px in and
    // 16 px of clearance kept at its right edge.
    const [title] = textAt(320, { throwIn: 'SAQUE DE BANDA' }, { throwIn: { intensity: 1, slide: 1, side: null } })
    expect(sizePx(title!)).toBeLessThan(64)
    const bandRight = CX + (501 / 2) * u
    expect(Number(title!.args[1]) + width(title!)).toBeCloseTo(bandRight - 16 * u, 6)
  })

  it("shrinks the attack's word to the label's width", () => {
    const attack = {
      team: 0 as const,
      color: '#e51a1a',
      name: 'Home',
      direction: 1 as const,
      intensity: 1,
    }
    const [, word] = textAt(320, { attack: 'Counter-attacking move' }, { attack })
    expect(word!.args[0]).toBe('Counter-attacking move')
    expect(sizePx(word!)).toBeLessThan(54)
    expect(width(word!)).toBeCloseTo(560 * u, 6)
  })
})
