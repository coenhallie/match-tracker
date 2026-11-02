import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ELLIPSIS, MIN_FIT, fitFontPx, fitText } from '../../src/render/fitText'
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

describe('fitText', () => {
  it('gives the text whole, at the size fitFontPx gives, when that fits', () => {
    expect(fitText(ctx(), 'ABCDEFGHIJ', font, 20, 500)).toEqual({ px: 20, text: 'ABCDEFGHIJ' })
    const shrunk = fitFontPx(ctx(), 'ABCDEFGHIJ', font, 20, 96)
    expect(fitText(ctx(), 'ABCDEFGHIJ', font, 20, 96)).toEqual({ px: shrunk, text: 'ABCDEFGHIJ' })
  })

  it('cuts text still too wide at 60% to the longest start that fits, with an ellipsis', () => {
    // At 12 px each character is 7.2 wide: seven and the ellipsis make 57.6.
    const fitted = fitText(ctx(), 'ABCDEFGHIJ', font, 20, 60)
    expect(fitted).toEqual({ px: 12, text: `ABCDEFG${ELLIPSIS}` })
  })

  it('drops the spaces before the ellipsis', () => {
    // Four characters and the ellipsis fit in 36, but the fourth is a space.
    expect(fitText(ctx(), 'ABC DEFGHIJKL', font, 20, 36).text).toBe(`ABC${ELLIPSIS}`)
  })

  it('never cuts a character in two', () => {
    expect(fitText(ctx(), '𝔸'.repeat(20), font, 20, 60).text).toBe(`𝔸𝔸𝔸${ELLIPSIS}`)
  })

  it('gives the ellipsis alone when not even one character fits', () => {
    expect(fitText(ctx(), 'ABC', font, 20, 0)).toEqual({ px: 12, text: ELLIPSIS })
    expect(fitText(ctx(), 'ABC', font, 20, -5)).toEqual({ px: 12, text: ELLIPSIS })
    // One character 12 * 0.6 = 7.2 wide at the floor, against 5.
    expect(fitText(ctx(), 'W', font, 20, 5)).toEqual({ px: 12, text: ELLIPSIS })
  })

  // The size that fits is scaled from one measurement, so measured again it
  // can come out a rounding error over the width. A name that only needed to
  // shrink must still be drawn whole, as the reference draws it.
  it('cuts a name only at the floor, and never draws it wider than it may be', () => {
    const problems: string[] = []
    let cut = 0
    for (const u of [1, 2 / 3]) {
      const basePx = 40 * u
      const maxWidth = 560 * u
      const nameFont = (px: number) => `600 ${px}px Test`
      for (let n = 20; n <= 40; n++) {
        const name = 'N'.repeat(n)
        const c = ctx()
        const fitted = fitText(c, name, nameFont, basePx, maxWidth)
        c.font = nameFont(fitted.px)
        const at = `${n} characters at u = ${u}`
        if (c.measureText(fitted.text).width > maxWidth * (1 + 1e-6)) problems.push(`${at}: too wide`)
        if (fitted.px > basePx * MIN_FIT && fitted.text !== name) problems.push(`${at}: cut above the floor`)
        if (fitted.px < basePx * MIN_FIT) problems.push(`${at}: below the floor`)
        if (fitted.text !== name) cut++
      }
    }
    expect(problems).toEqual([])
    // The sweep reaches the floor too: the longest names are cut there.
    expect(cut).toBeGreaterThan(0)
  })

  it('leaves the context as it found it', () => {
    const c = ctx()
    c.font = 'bold 9px sans-serif'
    fitText(c, 'ABCDEFGHIJ', font, 20, 60)
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
  const [CX] = worldToPx(0, 0, T)
  /** Measured as the recording context measures: 0.6 of the size a character. */
  const width = (op: Op) => {
    const { ctx } = recordingCtx()
    ctx.font = op.font
    return (ctx as unknown as CanvasRenderingContext2D).measureText(String(op.args[0])).width
  }
  const sizePx = (op: Op) => Number(/([\d.]+)px/.exec(op.font)![1]) / u
  const leftOf = (op: Op) => Number(op.args[1])
  const rightOf = (op: Op) => leftOf(op) + width(op)
  const centreOf = (op: Op) => leftOf(op) + width(op) / 2

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

  // The centre card is 736 design px wide and centred on the pitch; a title
  // keeps the clearance it has above it (13 px) from its sides.
  const cardLeft = CX - 368 * u
  const cardInnerLeft = cardLeft + 13 * u
  const cardInnerRight = cardLeft + (736 - 13) * u
  const freeKick: FrameLayers = { freeKick: { intensity: 1, playersFade: 0 } }
  const goal: FrameLayers = { goalBanner: { intensity: 1 } }
  const throwIn: FrameLayers = { throwIn: { intensity: 1, slide: 1, side: null } }
  // The throw-in band is 501 design px wide, centred, with 16 px kept clear.
  const bandInnerLeft = CX - (501 / 2 - 16) * u
  const bandInnerRight = CX + (501 / 2 - 16) * u

  it('draws the English titles exactly where the reference does', () => {
    const [freeKickTitle] = textAt(1280, {}, freeKick)
    const [goalTitle] = textAt(1280, {}, goal)
    const [throwInTitle] = textAt(1280, {}, throwIn)
    expect(leftOf(freeKickTitle!)).toBe(cardLeft + (368 - 232) * u)
    expect(leftOf(goalTitle!)).toBe(cardLeft + (368 - 133) * u)
    expect(leftOf(throwInTitle!)).toBe(CX - (501 / 2) * u + (501 / 2 - 165.5) * u)
    for (const title of [freeKickTitle!, goalTitle!]) expect(sizePx(title)).toBe(92)
    expect(sizePx(throwInTitle!)).toBe(64)
  })

  it('centres the Chinese titles where the design centres its words', () => {
    for (const [text, layers] of [
      [{ freeKick: '任意球' }, freeKick],
      [{ goal: '进球' }, goal],
      [{ throwIn: '界外球' }, throwIn],
    ] as const) {
      const [title] = textAt(1280, text, layers)
      expect(title!.args[0]).toBe(Object.values(text)[0])
      expect(Math.abs(centreOf(title!) - CX) / u).toBeLessThan(1)
    }
  })

  it('keeps the baseline and the size of a Chinese title that fits', () => {
    const [english] = textAt(1280, {}, freeKick)
    const [chinese] = textAt(1280, { freeKick: '任意球' }, freeKick)
    expect(chinese!.args[2]).toBe(english!.args[2])
    expect(sizePx(chinese!)).toBeCloseTo(92, 6)
  })

  it('draws the free kick title in Chinese at full size, within the card, in a 320 px box', () => {
    const [title] = textAt(320, { freeKick: '任意球' }, freeKick)
    expect(sizePx(title!)).toBeCloseTo(92, 6)
    expect(leftOf(title!)).toBeGreaterThanOrEqual(cardInnerLeft)
    expect(rightOf(title!)).toBeLessThanOrEqual(cardInnerRight + 1e-6)
  })

  it('shrinks a title too long for the card until it fills it, centred', () => {
    // 14 characters at 92 px: 773 design px, against the 710 inside the card.
    const [title] = textAt(320, { freeKick: 'FREISTOSS-TOR!' }, freeKick)
    expect(sizePx(title!)).toBeLessThan(92)
    expect(sizePx(title!)).toBeGreaterThan(92 * 0.6)
    expect(leftOf(title!)).toBeCloseTo(cardInnerLeft, 6)
    expect(rightOf(title!)).toBeCloseTo(cardInnerRight, 6)
  })

  it('stops shrinking a title at 60% of the size', () => {
    const [title] = textAt(320, { freeKick: 'CALCIO DI PUNIZIONE DIRETTO' }, freeKick)
    expect(sizePx(title!)).toBeCloseTo(92 * 0.6, 6)
    expect(Math.abs(centreOf(title!) - CX) / u).toBeLessThan(1)
  })

  it('shrinks a goal title too long for the card', () => {
    const [title] = textAt(320, { goal: 'GOOOOOOOOOOOAL!' }, goal)
    expect(sizePx(title!)).toBeLessThan(92)
    expect(leftOf(title!)).toBeCloseTo(cardInnerLeft, 6)
    expect(rightOf(title!)).toBeCloseTo(cardInnerRight, 6)
  })

  it('shrinks a throw-in title too long for its band', () => {
    const [title] = textAt(320, { throwIn: 'SAQUE DE BANDA' }, throwIn)
    expect(sizePx(title!)).toBeLessThan(64)
    expect(leftOf(title!)).toBeCloseTo(bandInnerLeft, 6)
    expect(rightOf(title!)).toBeCloseTo(bandInnerRight, 6)
  })

  const attack = (name: string) => ({
    attack: { team: 0 as const, color: '#e51a1a', name, direction: 1 as const, intensity: 1 },
  })

  it("shrinks the attack's word to the label's width", () => {
    const [, word] = textAt(320, { attack: 'Counter-attacking move' }, attack('Home'))
    expect(word!.args[0]).toBe('Counter-attacking move')
    expect(sizePx(word!)).toBeLessThan(54)
    expect(width(word!)).toBeCloseTo(560 * u, 6)
  })

  it('cuts a 60-character team name short with an ellipsis, within the label', () => {
    const long = 'Club Atlético Deportivo y Cultural de la Ciudad de San Martín'.slice(0, 60)
    expect(long).toHaveLength(60)
    const [name] = textAt(320, {}, attack(long))
    const text = String(name!.args[0])
    expect(text.endsWith(ELLIPSIS)).toBe(true)
    expect(long.startsWith(text.slice(0, -1))).toBe(true)
    expect(sizePx(name!)).toBeCloseTo(40 * 0.6, 6)
    expect(width(name!)).toBeLessThanOrEqual(560 * u + 1e-6)
  })

  it('draws every name that only needs to shrink whole, within the label', () => {
    const problems: string[] = []
    for (let n = 20; n <= 40; n++) {
      const name = 'N'.repeat(n)
      const [drawn] = textAt(320, {}, attack(name))
      if (width(drawn!) > 560 * u * (1 + 1e-6)) problems.push(`${n} characters: too wide`)
      if (sizePx(drawn!) > 40 * MIN_FIT + 1e-9 && drawn!.args[0] !== name) problems.push(`${n} characters: cut`)
    }
    expect(problems).toEqual([])
  })

  it('leaves a team name that fits at 60% whole', () => {
    const name = 'B'.repeat(30)
    const [drawn] = textAt(320, {}, attack(name))
    expect(drawn!.args[0]).toBe(name)
    expect(width(drawn!)).toBeLessThanOrEqual(560 * u + 1e-6)
  })
})
