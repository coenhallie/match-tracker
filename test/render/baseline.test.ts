import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRenderer, nearbyTrackIds, possessionTrackIds, type FrameLayers } from '../../src/render/renderer'
import type { AttackIndicator } from '../../src/render/attackIndicator'
import type { BallTrail } from '../../src/analysis/ballTrail'
import type { Frame } from '../../src/model/types'
import { fakeCanvas, stubOffscreenCanvas } from '../helpers/recordingCtx'
import { normalizeCalls } from '../helpers/normalize'

// The contract the theming work has to keep: the draw calls renderFrame makes,
// as the reference makes them, for the main draw paths. A snapshot that
// changes means the drawing changed. Font family names are normalised, so the
// private bundled families and their CJK fallbacks do not count as a change.

const PITCH = { length: 105, width: 68 }

const player = (
  track_id: number,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
  person_type = 'PersonType.PLAYER',
) => ({
  track_id,
  person_type,
  projected_coordinates: { x, y },
  player_number: track_id,
  ...extra,
})

/**
 * Home (team 0) has the ball at (-10, 4) with a teammate near it and one far
 * away, away (team 1) has a defender close by, a goalkeeper and a far player,
 * and there is a referee.
 */
function plainFrame(actions: string[] = []): Frame {
  return {
    pitch_dimensions: PITCH,
    teams: [
      {
        team_id: 0,
        players: [
          player(7, -10, 4, { in_possession: true }),
          player(8, -14, 2),
          player(9, -40, -20),
          player(1, -50, 0, {}, 'PersonType.GOALKEEPER'),
        ],
      },
      {
        team_id: 1,
        players: [player(21, -8, 6), player(22, 30, -10), player(23, 45, 3, {}, 'PersonType.GOALKEEPER')],
      },
      { team_id: -1, players: [player(99, 0, -34, {}, 'PersonType.REFEREE')] },
    ],
    balls: [{ projected_coordinates: { x: -10, y: 4 } }],
    // Human, as the reference's labels are taken to be: the widget lists only human labels by default (aiLabels).
    state: { actions: actions.map((action_type) => ({ action_type, action_origin: 'human' })) },
  } as unknown as Frame
}

const TRAIL: BallTrail = {
  runs: [
    [
      { x: -30, y: -2, age: 4 },
      { x: -22, y: 0, age: 3 },
      { x: -16, y: 5, age: 2 },
      { x: -12, y: 4, age: 1 },
      { x: -10, y: 4, age: 0 },
    ],
    [
      { x: -34, y: -8, age: 6 },
      { x: -31, y: -4, age: 5 },
    ],
  ],
  turns: [{ x: -16, y: 5, age: 2 }],
}

const ATTACK: AttackIndicator = {
  team: 0,
  color: '#e51a1a',
  name: 'Home',
  direction: 1,
  intensity: 0.8,
  playersFade: 0.6,
  pulse: 0.35,
}

// A stand-in for a loaded icon, so the draw calls carry the image draw.
const ICON = { icon: 'stub' } as unknown as CanvasImageSource

let offscreen: ReturnType<typeof stubOffscreenCanvas>

beforeEach(() => {
  offscreen = stubOffscreenCanvas()
})

afterEach(() => {
  offscreen.restore()
})

/** The calls renderFrame makes on the canvas. The pitch it draws is a cached image, recorded on its own below. */
function record(frame: Frame, layers?: FrameLayers) {
  const { canvas, ops } = fakeCanvas()
  createRenderer(canvas).renderFrame(frame, layers)
  return normalizeCalls(ops)
}

/** The rings as a caller that has fully faded them in draws them. */
function ringsOf(frame: Frame): NonNullable<FrameLayers['rings']> {
  return {
    nearby: new Map([...nearbyTrackIds(frame)].map((id) => [id, 1])),
    possession: new Map([...possessionTrackIds(frame)].map((id) => [id, 1])),
  }
}

describe('renderFrame baseline', () => {
  it('draws the pitch cache: the grass, the markings and the goals, once for every frame', () => {
    record(plainFrame())
    expect(normalizeCalls(offscreen.ops)).toMatchSnapshot()
  })

  it('draws the pitch, players, possession and nearby rings and the ball trail', () => {
    const frame = plainFrame()
    expect(record(frame, { rings: ringsOf(frame), trail: TRAIL })).toMatchSnapshot()
  })

  it('draws the goal overlay: its ball, its trail and the net it hit', () => {
    const frame = plainFrame()
    const goal = {
      ball: { x: 52.9, y: 1.5 },
      trail: [
        { x: 44, y: 0 },
        { x: 48, y: 1 },
        { x: 51, y: 1.4 },
      ],
      net: { side: 1 as const, y: 1.5, metres: 0.6 },
    }
    expect(record(frame, { goal, rings: ringsOf(frame) })).toMatchSnapshot()
  })

  it('draws the attack: the shade and label, the faded players and the ball rings', () => {
    const frame = plainFrame()
    expect(record(frame, { attack: { ...ATTACK, ball: { x: -10, y: 4 } }, rings: ringsOf(frame) })).toMatchSnapshot()
  })

  // The reference drew its free kick banner in this one too; the widget no longer shows the free kick.
  it('draws the throw-in indicator and the goal card together', () => {
    const frame = plainFrame(['EventType.FREE_KICK'])
    const layers: FrameLayers = {
      throwIn: { intensity: 1, slide: 0.5, side: 1 },
      goalBanner: { intensity: 1, icon: ICON },
    }
    expect(record(frame, layers)).toMatchSnapshot()
  })
})
