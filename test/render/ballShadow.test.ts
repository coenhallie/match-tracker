import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Frame } from '../../src/model/types'
import { createRenderer, type FrameLayers } from '../../src/render/renderer'
import { PLAYER_RADIUS } from '../../src/render/constants'
import { fakeCanvas, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'
import { build2DTransform, worldToPx } from '../../src/model/pitch'

// The shadow under a high ball: the widget's own (the `ballShadow` layer), which the reference does not have.

const PITCH = { length: 105, width: 68 }
const BALL = { x: 10, y: 4 }

function frame(ball: { high: boolean; z?: number } | null, player = { x: 30, y: -20 }): Frame {
  return {
    pitch_dimensions: PITCH,
    teams: [{ team_id: 0, players: [{ track_id: 7, person_type: 'PersonType.PLAYER', projected_coordinates: player }] }],
    balls: ball ? [{ is_high_ball: ball.high, projected_coordinates: { ...BALL, z: ball.z ?? 8 } }] : [],
  } as unknown as Frame
}

function render(f: Frame, layers: FrameLayers = { ballShadow: true }): Op[] {
  const { canvas, ops } = fakeCanvas()
  createRenderer(canvas).renderFrame(f, layers)
  return ops
}

/** The shadow's fills: black at its middle, fading to nothing at its edge. */
const shadows = (ops: Op[]) =>
  ops.filter((o) => o.op === 'fill' && o.fillStyle.startsWith('radial(') && o.fillStyle.includes('|0:rgba(0,0,0,'))

/** Where a shadow's middle is, in frame px, from its gradient. */
function middle(o: Op): [number, number] {
  const [x, y] = o.fillStyle.slice('radial('.length).split('|')[0]!.split(',').map(Number)
  return [x!, y!]
}

const ballPx = () => worldToPx(BALL.x, BALL.y, build2DTransform(PITCH))

let offscreen: ReturnType<typeof stubOffscreenCanvas>
beforeEach(() => {
  offscreen = stubOffscreenCanvas()
})
afterEach(() => {
  offscreen.restore()
})

describe('the shadow under a high ball', () => {
  it('lies on the pitch below and right of a high ball, away from the light at the top left', () => {
    const ops = render(frame({ high: true }))
    expect(shadows(ops)).toHaveLength(1)
    const [sx, sy] = middle(shadows(ops)[0]!)
    const [px, py] = ballPx()
    expect(sx).toBeGreaterThan(px)
    expect(sy).toBeGreaterThan(py)
  })

  it('is drawn on the grass, under the players and the ball', () => {
    const [px, py] = worldToPx(30, -20, build2DTransform(PITCH))
    const ops = render(frame({ high: true }))
    const shadow = ops.indexOf(shadows(ops)[0]!)
    const playerCircle = ops.findIndex(
      (o) => o.op === 'arc' && o.args[0] === px && o.args[1] === py && Number(o.args[2]) >= PLAYER_RADIUS,
    )
    const [bx, by] = ballPx()
    const ball = ops.findIndex((o) => o.op === 'arc' && o.args[0] === bx && o.args[1] === by)
    expect(shadow).toBeGreaterThan(-1)
    expect(shadow).toBeLessThan(playerCircle)
    expect(shadow).toBeLessThan(ball)
  })

  it('falls further from the ball, and fainter, the higher the ball is', () => {
    const [px, py] = ballPx()
    const low = shadows(render(frame({ high: true, z: 2 })))[0]!
    const high = shadows(render(frame({ high: true, z: 12 })))[0]!
    const distance = (o: Op) => Math.hypot(middle(o)[0] - px, middle(o)[1] - py)
    expect(distance(high)).toBeGreaterThan(distance(low))
    const darkness = (o: Op) => Number(/\|0:rgba\(0,0,0,([\d.]+)\)/.exec(o.fillStyle)![1])
    expect(darkness(high)).toBeLessThan(darkness(low))
  })

  it('is cast by a high ball with no height, at its lowest', () => {
    const ops = render({
      ...frame(null),
      balls: [{ is_high_ball: true, projected_coordinates: { ...BALL } }],
    } as unknown as Frame)
    expect(shadows(ops)).toHaveLength(1)
  })

  it('is not cast by a ball that is not high, or with the layer off', () => {
    expect(shadows(render(frame({ high: false })))).toHaveLength(0)
    expect(shadows(render(frame({ high: true }), { ballShadow: false }))).toHaveLength(0)
    expect(shadows(render(frame({ high: true }), {}))).toHaveLength(0)
  })

  it('fades out with the ball under a card', () => {
    const shown = shadows(render(frame({ high: true })))[0]!
    const half = shadows(render(frame({ high: true }), { ballShadow: true, labelCard: { key: 'varCheck', intensity: 0.5 } }))[0]!
    expect(half.globalAlpha).toBeCloseTo(shown.globalAlpha / 2, 5)
    expect(shadows(render(frame({ high: true }), { ballShadow: true, labelCard: { key: 'varCheck', intensity: 1 } }))).toHaveLength(0)
  })
})
