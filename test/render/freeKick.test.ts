import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  drawFreeKickCard,
  drawFreeKickPulse,
  drawFreeKickShade,
  freeKickSide,
  type FreeKickBanner,
} from '../../src/render/freeKick'
import { designUnit } from '../../src/render/pitchGeometry'
import { createRenderer } from '../../src/render/renderer'
import { DEFAULT_THEME } from '../../src/render/theme'
import type { Frame } from '../../src/model/types'
import { fakeCanvas, recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'
import { normalizeCalls } from '../helpers/normalize'
import { FRAME_W, build2DTransform, worldToPx } from '../../src/model/pitch'

// The design (Figma "Game Animation Visualizer", viewport/eventFreeKickRightSide and LeftSide) is a
// 1600 by 1100 frame with the pitch's middle at 800 by 550: its places are read off it below.
const PITCH = { length: 105, width: 68 }
const T = build2DTransform(PITCH)
const u = designUnit(T)
const [CX, CY] = worldToPx(0, 0, T)

const banner = (over: Partial<FreeKickBanner> = {}): FreeKickBanner => ({
  intensity: 1,
  playersFade: 1,
  ballFade: 1,
  ball: { x: 30, y: 12 },
  rings: [1, 1, 1],
  ...over,
})

describe('the free kick side', () => {
  it('is the half without the ball, none with no ball known', () => {
    expect(freeKickSide({ x: 30, y: 0 })).toBe(-1)
    expect(freeKickSide({ x: -0.1, y: 0 })).toBe(1)
    expect(freeKickSide({ x: 0, y: 5 })).toBe(-1)
    expect(freeKickSide(null)).toBe(0)
  })
})

describe('the free kick shade', () => {
  function draw(over: Partial<FreeKickBanner> = {}) {
    const { ctx, ops } = recordingCtx()
    drawFreeKickShade(ctx as unknown as CanvasRenderingContext2D, T, banner(over))
    return ops.filter((o) => o.op === 'fillRect')
  }

  it('shades the half without the ball up to the halfway line’s edge, past the frame either way, in the design’s green at 40%', () => {
    const [left] = draw({ ball: { x: 30, y: 12 } })
    const [x, y, w, h] = left!.args as number[]
    expect(left!.fillStyle).toBe('rgba(11, 51, 40, 0.4)')
    // The design's shade ends at 798, 2 px short of the line's middle at 800.
    expect(x! + w!).toBeCloseTo(CX - 2 * u, 6)
    expect(x).toBeLessThanOrEqual(0)
    expect(y).toBeLessThan(0)
    expect(y! + h!).toBeGreaterThan(720)
    const [right] = draw({ ball: { x: -30, y: 12 } })
    const [rx, , rw] = right!.args as number[]
    expect(rx).toBeCloseTo(CX + 2 * u, 6)
    expect(rx! + rw!).toBeGreaterThanOrEqual(FRAME_W)
  })

  it('fades with it, and shades nothing with no ball known or nothing of it left', () => {
    expect(draw({ intensity: 0.5 })[0]!.fillStyle).toBe('rgba(11, 51, 40, 0.2)')
    expect(draw({ ball: null })).toHaveLength(0)
    expect(draw({ intensity: 0 })).toHaveLength(0)
  })
})

describe('the free kick pulse', () => {
  function draw(over: Partial<FreeKickBanner> = {}) {
    const { ctx, ops } = recordingCtx()
    drawFreeKickPulse(ctx as unknown as CanvasRenderingContext2D, T, banner(over))
    return ops
  }
  const [BX, BY] = worldToPx(30, 12, T)

  it('rings where the ball was, as the design’s 80 px pulse: three discs at 20% and their lines, outside in', () => {
    const ops = draw()
    const arcs = ops.filter((o) => o.op === 'arc')
    for (const arc of arcs) {
      expect(arc.args[0]).toBeCloseTo(BX, 6)
      expect(arc.args[1]).toBeCloseTo(BY, 6)
    }
    // Disc, then its line, from the outside in.
    expect(arcs.map((a) => (a.args[2] as number) / u).map((r) => Math.round(r * 1000) / 1000)).toEqual([38, 38, 26, 24, 16, 14])
    const fills = ops.filter((o) => o.op === 'fill').map((o) => o.fillStyle)
    expect(fills).toEqual(['rgba(255, 255, 255, 0.2)', 'rgba(255, 255, 255, 0.2)', 'rgba(255, 255, 255, 0.2)'])
    const lines = ops.filter((o) => o.op === 'stroke')
    expect(lines.map((o) => o.strokeStyle)).toEqual(['rgba(255, 255, 255, 1)', 'rgba(255, 255, 255, 0.8)', 'rgba(255, 255, 255, 0.5)'])
    for (const line of lines) expect(line.lineWidth).toBeCloseTo(4 * u, 6)
  })

  it('lights each ring as strongly as it is, faded with the free kick', () => {
    const ops = draw({ rings: [1, 0.5, 0], intensity: 0.5 })
    expect(ops.filter((o) => o.op === 'fill').map((o) => o.fillStyle)).toEqual(['rgba(255, 255, 255, 0.05)', 'rgba(255, 255, 255, 0.1)'])
    expect(draw({ ball: null })).toHaveLength(0)
    expect(draw({ intensity: 0 })).toHaveLength(0)
  })
})

describe('the free kick card', () => {
  const icon = { width: 45.5, height: 40.95 } as unknown as CanvasImageSource

  function draw(over: Partial<FreeKickBanner> = {}) {
    const { ctx, ops } = recordingCtx()
    const written = new Map<string, { color: string; alpha: number }>()
    const fillText = ctx.fillText.bind(ctx)
    ctx.fillText = (...args: unknown[]) => {
      written.set(String(args[0]), { color: ctx.shadowColor, alpha: ctx.globalAlpha })
      fillText(...args)
    }
    drawFreeKickCard(ctx as unknown as CanvasRenderingContext2D, PITCH, T, banner({ icon, ...over }))
    return { ops, written }
  }
  const band = (ops: Op[]) => ops.find((o) => o.op === 'fillRect')!.args as [number, number, number, number]

  it('sits in the middle of the shaded half, 339 design px from the pitch’s, as both frames have it', () => {
    for (const [ball, side] of [[{ x: 30, y: 12 }, -1], [{ x: -30, y: 12 }, 1]] as const) {
      const [x, y, w, h] = band(draw({ ball }).ops)
      expect((x + w / 2 - CX) / u).toBeCloseTo(side * 339, 0)
      expect(h).toBeCloseTo(384 * u, 6)
      expect(y + h / 2).toBeCloseTo(CY, 6)
    }
  })

  it('is the label cards’ card with 80 px either side of the title, which is centred on it', () => {
    const { ops } = draw()
    const [x, , w] = band(ops)
    const title = ops.find((o) => o.op === 'fillText' && o.args[0] === 'FREE KICK')!
    expect((normalizeCalls([title])[0] as Op).font).toBe(`italic 900 ${92 * u}px Inter, sans-serif`)
    // The recording context measures every character at 0.6 of the size.
    const titleWidth = 9 * 92 * u * 0.6
    expect(w).toBeCloseTo(titleWidth + 160 * u, 6)
    expect(title.args[1]).toBeCloseTo(x + w / 2 - titleWidth / 2, 6)
  })

  it('draws the icon where the design places it in its 208 px slot, under the title', () => {
    const { ops } = draw()
    const [x, y, w] = band(ops)
    const [img, ix, iy, iw, ih] = ops.find((o) => o.op === 'drawImage')!.args as [unknown, number, number, number, number]
    expect(img).toBe(icon)
    const slotLeft = x + w / 2 - 104 * u
    expect((ix - slotLeft) / u).toBeCloseTo(208 * 0.1406, 6)
    expect((iy - y) / u).toBeCloseTo(160 + 208 * 0.1727, 6)
    expect(iw / u).toBeCloseTo(208 * (1 - 0.1406 - 0.1484), 6)
    expect(ih / u).toBeCloseTo(208 * (1 - 0.1727 - 0.1875), 6)
    // The free kick icon is drawn at 3.25 times its own box, as the design has it.
    expect(iw / u / 45.5).toBeCloseTo(3.25, 2)
  })

  it('writes the team under the card, at its middle, 270.5 px below the pitch’s, as every frame has it', () => {
    const { ops, written } = draw({ team: 'Ajax', intensity: 0.5 })
    const [x, , w] = band(ops)
    const team = ops.find((o) => o.op === 'fillText' && o.args[0] === 'Ajax')!
    expect(team.font).toContain(`900 ${48 * u}px`)
    expect(team.textAlign).toBe('center')
    expect(team.args[1]).toBeCloseTo(x + w / 2, 6)
    expect(team.args[2]).toBeCloseTo(CY + 270.5 * u, 6)
    expect(written.get('Ajax')).toMatchObject({ color: 'rgba(0, 0, 0, 0.5)', alpha: 0.5 })
    expect(draw({ team: null }).ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])).toEqual(['FREE KICK'])
  })

  it('keeps a long title and team inside the half, clear of the halfway line', () => {
    const long = 'Bartholomew-Maximilian '.repeat(4).trim()
    const theme = { ...DEFAULT_THEME, text: { ...DEFAULT_THEME.text, freeKick: long } }
    const { ctx, ops } = recordingCtx()
    drawFreeKickCard(ctx as unknown as CanvasRenderingContext2D, PITCH, T, banner({ team: long }), theme)
    const [x, , w] = band(ops)
    expect(x + w).toBeLessThanOrEqual(CX + 1e-6)
    const team = ops.find((o) => o.op === 'fillText' && o.font.startsWith('900 '))!
    const px = Number(/([\d.]+)px/.exec(team.font)![1])
    expect((String(team.args[0]).length * px * 0.6) / 2 + (team.args[1] as number)).toBeLessThanOrEqual(x + w + 1e-6)
  })

  it('sits across the middle with no ball known', () => {
    const [x, , w] = band(draw({ ball: null }).ops)
    expect(x + w / 2).toBeCloseTo(CX, 6)
    expect(draw({ intensity: 0 }).ops).toHaveLength(0)
  })
})

describe('free kick in the renderer', () => {
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
  const [BX, BY] = worldToPx(30, 12, T)

  function render(freeKick?: FreeKickBanner) {
    const { canvas, ops } = fakeCanvas()
    createRenderer(canvas).renderFrame(frame, { freeKick })
    return ops
  }

  it('draws the shade and the pulse under the players and the card over everything, fading the players out', () => {
    const ops = render(banner({ playersFade: 0.5 }))
    const shade = ops.findIndex((o) => o.op === 'fillRect' && o.fillStyle === 'rgba(11, 51, 40, 0.4)')
    const pulse = ops.findIndex((o) => o.op === 'arc' && o.args[0] === BX && o.args[1] === BY)
    const player = ops.findIndex((o) => o.op === 'arc' && o.args[0] === PX && o.args[1] === PY)
    const card = ops.findIndex((o) => o.op === 'fillText' && o.args[0] === 'FREE KICK')
    expect(shade).toBeGreaterThan(-1)
    expect(pulse).toBeGreaterThan(shade)
    expect(player).toBeGreaterThan(pulse)
    expect(card).toBeGreaterThan(player)
    expect(ops[player]!.globalAlpha).toBeCloseTo(0.5, 6)
    const gone = render(banner({ playersFade: 1 }))
    expect(gone.some((o) => o.op === 'arc' && o.args[0] === PX && o.args[1] === PY)).toBe(false)
  })

  it('draws nothing of it without one', () => {
    const ops = render()
    expect(ops.some((o) => o.op === 'fillRect' && o.fillStyle.startsWith('rgba(11, 51, 40'))).toBe(false)
    expect(ops.some((o) => o.op === 'fillText' && o.args[0] === 'FREE KICK')).toBe(false)
  })
})
