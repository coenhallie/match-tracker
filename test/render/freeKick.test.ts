import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drawFreeKickBanner, isFreeKickFrame, playMoved, type FreeKickBanner } from '../../src/render/freeKick'
import { build2DTransform, designUnit, worldToPx } from '../../src/render/pitchGeometry'
import { createRenderer } from '../../src/render/renderer'
import { BALL_RADIUS } from '../../src/render/constants'
import type { Frame } from '../../src/model/types'
import { fakeCanvas, recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'
import { normalizeCalls } from '../helpers/normalize'

const PITCH = { length: 105, width: 68 }
const T = build2DTransform(PITCH)
const u = designUnit(T)
const [CX, CY] = worldToPx(0, 0, T)

const player = (track_id: number, x: number, y = 3) => ({
  track_id,
  person_type: 'PersonType.PLAYER',
  projected_coordinates: { x, y },
})

function frameWith(
  actions: string[],
  players = [player(7, 5)],
  ball: { x: number; y: number } | null = { x: 10, y: 0 },
): Frame {
  return {
    pitch_dimensions: PITCH,
    teams: [{ team_id: 1, players }],
    balls: ball ? [{ projected_coordinates: ball }] : [],
    state: { actions: actions.map((action_type) => ({ action_type })) },
  } as unknown as Frame
}

describe('free kick label', () => {
  it('matches however the export writes it', () => {
    expect(isFreeKickFrame(frameWith(['EventType.FREE_KICK']))).toBe(true)
    expect(isFreeKickFrame(frameWith(['Free kick']))).toBe(true)
    expect(isFreeKickFrame(frameWith(['EventType.BALL_IN_PLAY']))).toBe(false)
    expect(isFreeKickFrame(frameWith(['EventType.GOAL_KICK']))).toBe(false)
    expect(isFreeKickFrame(frameWith([]))).toBe(false)
  })
})

// Off camera the data repeats everyone's last positions exactly.
describe('play moved', () => {
  it('is false for the same positions in a new record', () => {
    expect(playMoved(frameWith([], [player(7, 5), player(8, 9)]), frameWith([], [player(8, 9), player(7, 5)]))).toBe(
      false,
    )
  })

  it('is false with nobody in either frame', () => {
    expect(playMoved(frameWith([], [], null), frameWith([], [], null))).toBe(false)
  })

  it('is true when anyone moves, however little', () => {
    expect(playMoved(frameWith([], [player(7, 5)]), frameWith([], [player(7, 5.01)]))).toBe(true)
  })

  it('is true when only the ball moves, or someone appears or goes', () => {
    expect(playMoved(frameWith([]), frameWith([], [player(7, 5)], { x: 11, y: 0 }))).toBe(true)
    expect(playMoved(frameWith([]), frameWith([], [player(7, 5)], null))).toBe(true)
    expect(playMoved(frameWith([]), frameWith([], [player(7, 5), player(8, 1)]))).toBe(true)
    expect(playMoved(frameWith([], [player(7, 5)]), frameWith([], [player(9, 5)]))).toBe(true)
  })
})

describe('free kick banner', () => {
  const icon = { width: 45.5, height: 40.95 } as unknown as CanvasImageSource

  function draw(over: Partial<FreeKickBanner> = {}) {
    const { ctx, ops } = recordingCtx()
    drawFreeKickBanner(ctx as unknown as CanvasRenderingContext2D, T, {
      intensity: 1,
      playersFade: 1,
      icon,
      ...over,
    })
    return { ctx, ops }
  }

  const band = (ops: Op[]) => ops.find((o) => o.op === 'fillRect')
  const title = (ops: Op[]) => ops.find((o) => o.op === 'fillText')
  const image = (ops: Op[]) => ops.find((o) => o.op === 'drawImage')

  // The design's band is 736 by 373, centred on the pitch.
  it('lays a band across the middle of the pitch, the design’s size', () => {
    const [x, y, w, h] = band(draw().ops)!.args as [number, number, number, number]
    expect(w).toBeCloseTo(736 * u, 6)
    expect(h).toBeCloseTo(373 * u, 6)
    expect(x + w / 2).toBeCloseTo(CX, 6)
    expect(y + h / 2).toBeCloseTo(CY, 6)
  })

  it('fills the band solid in the middle and clear at each end, as the design', () => {
    const fill = band(draw().ops)!.fillStyle
    const left = CX - 368 * u
    expect(fill).toBe(
      `gradient(${left},0->${left + 736 * u},0|` +
        '0:rgba(12, 63, 47, 0),0.25:rgb(12, 63, 47),0.75481:rgb(12, 63, 47),1:rgba(12, 63, 47, 0))',
    )
  })

  it('writes FREE KICK in white Inter Black Italic where the design has it', () => {
    const text = title(draw().ops)!
    const top = CY - (373 / 2) * u
    expect(text.args[0]).toBe('FREE KICK')
    // The bundled face's private name and CJK fallback, read as the reference's family (theme.ts).
    expect((normalizeCalls([text])[0] as Op).font).toBe(`italic 900 ${92 * u}px Inter, sans-serif`)
    expect(text.fillStyle).toBe('#ffffff')
    expect(text.textAlign).toBe('left')
    expect(text.args[1]).toBeCloseTo(CX - 232 * u, 6)
    // 13 px down, plus Inter's ascent, to the baseline.
    expect(text.args[2]).toBeCloseTo(top + (13 + 92 * 0.96875) * u, 6)
  })

  it('shadows the title as the design does, in the bitmap’s pixels', () => {
    const { ctx, ops } = recordingCtx()
    const scaled = Object.assign(ctx, { getTransform: () => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }) })
    let shadow: unknown[] = []
    const fillText = scaled.fillText
    scaled.fillText = (...args: unknown[]) => {
      shadow = [scaled.shadowColor, scaled.shadowBlur, scaled.shadowOffsetX, scaled.shadowOffsetY]
      fillText(...args)
    }
    drawFreeKickBanner(scaled as unknown as CanvasRenderingContext2D, T, { intensity: 1, playersFade: 1 })
    expect(shadow[0]).toBe('rgba(0, 0, 0, 0.15)')
    expect(shadow[1]).toBeCloseTo(24 * 2 * u, 6)
    expect(shadow[2]).toBe(0)
    expect(shadow[3]).toBeCloseTo(4 * 2 * u, 6)
    expect(ops.some((o) => o.op === 'fillText')).toBe(true)
  })

  // The icon's slot is 219 px square at (265, 124) in the band, its drawing
  // inset 14.06% left, 17.27% top, 14.84% right and 18.75% bottom.
  it('draws the free kick icon in its slot', () => {
    const top = CY - (373 / 2) * u
    const left = CX - 368 * u
    const [img, x, y, w, h] = image(draw().ops)!.args as [unknown, number, number, number, number]
    expect(img).toBe(icon)
    expect(x).toBeCloseTo(left + (265 + 219 * 0.1406) * u, 6)
    expect(y).toBeCloseTo(top + (124 + 219 * 0.1727) * u, 6)
    expect(w).toBeCloseTo(219 * (1 - 0.1406 - 0.1484) * u, 6)
    expect(h).toBeCloseTo(219 * (1 - 0.1727 - 0.1875) * u, 6)
    // In proportion: the drawing is 45.5 by 40.95.
    expect(w / h).toBeCloseTo(45.5 / 40.9498, 2)
  })

  it('is drawn without the icon until it has loaded', () => {
    const { ops } = draw({ icon: null })
    expect(image(ops)).toBeUndefined()
    expect(title(ops)).toBeDefined()
  })

  it('fades as a whole, and draws nothing at zero', () => {
    const { ops } = draw({ intensity: 0.4 })
    for (const op of [band(ops), title(ops), image(ops)]) expect(op!.globalAlpha).toBeCloseTo(0.4, 6)
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

  const frame = frameWith([], [player(7, 5)])
  /** The ball's path to it, and a turn on the way, all fresh. */
  const trail = {
    runs: [
      [
        { x: 0, y: 0, age: 0.4 },
        { x: 5, y: 0, age: 0.2 },
        { x: 10, y: 0, age: 0 },
      ],
    ],
    turns: [{ x: 5, y: 0, age: 0.2 }],
  }
  function render(freeKick?: FreeKickBanner) {
    const { canvas, ops } = fakeCanvas()
    createRenderer(canvas).renderFrame(frame, { freeKick, trail })
    return ops
  }
  const trailOps = (ops: Op[]) =>
    ops.filter((o) => (o.op === 'stroke' && o.strokeStyle.startsWith('rgba(255,255,255,')) || (o.op === 'arc' && o.args[2] === 2.5))
  const [PX, PY] = worldToPx(5, 3, T)
  const playerOps = (ops: Op[]) =>
    ops.filter(
      (o) => o.op === 'arc' && (o.args[0] === PX || o.args[0] === PX + 1) && (o.args[1] === PY || o.args[1] === PY + 1),
    )
  const ballOps = (ops: Op[]) => ops.filter((o) => o.op === 'arc' && Number(o.args[2]) === BALL_RADIUS)

  it('fades everyone out as far as it says, and leaves the ball', () => {
    const full = playerOps(render({ intensity: 1, playersFade: 0 }))
    const half = playerOps(render({ intensity: 1, playersFade: 0.5 }))
    expect(full.length).toBeGreaterThan(0)
    expect(half).toHaveLength(full.length)
    half.forEach((o, i) => expect(o.globalAlpha).toBeCloseTo(full[i]!.globalAlpha * 0.5, 6))
    const gone = render({ intensity: 1, playersFade: 1 })
    expect(playerOps(gone)).toHaveLength(0)
    expect(ballOps(gone).length).toBeGreaterThan(0)
  })

  // The reference's free kick leaves the ball; the widget's fades it out with everyone else.
  it('fades the ball and its trail out as far as ballFade says, and leaves them without it', () => {
    const kept = render({ intensity: 1, playersFade: 1 })
    expect(ballOps(kept).length).toBeGreaterThan(0)
    expect(trailOps(kept).length).toBeGreaterThan(0)
    const half = render({ intensity: 1, playersFade: 1, ballFade: 0.5 })
    expect(ballOps(half)).toHaveLength(ballOps(kept).length)
    ballOps(half).forEach((o, i) => expect(o.globalAlpha).toBeCloseTo(ballOps(kept)[i]!.globalAlpha * 0.5, 6))
    expect(trailOps(half)).toHaveLength(trailOps(kept).length)
    trailOps(half).forEach((o, i) => expect(o.globalAlpha).toBeCloseTo(trailOps(kept)[i]!.globalAlpha * 0.5, 6))
    const gone = render({ intensity: 1, playersFade: 1, ballFade: 1 })
    expect(ballOps(gone)).toHaveLength(0)
    expect(trailOps(gone)).toHaveLength(0)
  })

  it('draws the banner over everything on the pitch', () => {
    const ops = render({ intensity: 1, playersFade: 0 })
    const bandAt = ops.findIndex((o) => o.op === 'fillRect' && o.fillStyle.includes('12, 63, 47'))
    const lastBall = ops.findLastIndex((o) => ballOps([o]).length > 0)
    const lastPlayer = ops.findLastIndex((o) => playerOps([o]).length > 0)
    expect(lastBall).toBeGreaterThan(-1)
    expect(lastPlayer).toBeGreaterThan(-1)
    expect(bandAt).toBeGreaterThan(lastBall)
    expect(bandAt).toBeGreaterThan(lastPlayer)
  })

  it('draws nothing of its own without one', () => {
    const ops = render()
    expect(ops.some((o) => o.op === 'fillText' && o.args[0] === 'FREE KICK')).toBe(false)
  })
})
