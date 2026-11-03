import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import type { Frame } from '../../src/model/types'
import { createRenderer } from '../../src/render/renderer'
import { fakeCanvas, stubOffscreenCanvas } from '../helpers/recordingCtx'
import { FakeReplay } from './harness'

// Data as it comes from a live pipeline: balls without coordinates, officials and unknowns on team -1,
// labels on frames that cannot carry them, positions that are not numbers. The director goes on, and what
// it last drew stays on screen.

const BLUE_ATTACKING: TeamPhase = {
  possession: 1,
  attacks: { 0: 1, 1: -1 },
  states: { 0: 'defending', 1: 'attacking' },
}

const player = (track_id: number, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  track_id,
  person_type: 'PersonType.PLAYER',
  projected_coordinates: { x, y },
  player_number: track_id,
  ...extra,
})

const frame = (balls: unknown[], labels: string[] = [], teams?: unknown[]): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: teams ?? [
      { team_id: 0, players: [player(1, -5, 0, { in_possession: true }), player(2, -8, 3)] },
      { team_id: 1, players: [player(11, 6, -2)] },
    ],
    balls,
    state: { actions: labels.map((action_type) => ({ action_type, action_origin: 'human' })) },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

const ball = (x: unknown, y: unknown) => ({ projected_coordinates: { x, y, z: 0 } })

let offscreen: ReturnType<typeof stubOffscreenCanvas>
beforeEach(() => {
  offscreen = stubOffscreenCanvas()
})
afterEach(() => offscreen.restore())

/** Every paint drawn, as the widget draws them, so a paint the renderer cannot take fails here too. */
function drawAll(replay: FakeReplay): void {
  const { canvas } = fakeCanvas()
  const renderer = createRenderer(canvas)
  for (const output of replay.outputs) {
    for (const paint of output.paints) {
      renderer.setView(paint.view)
      renderer.renderFrame(paint.frame, paint.layers)
    }
  }
}

function playing(first: Frame): FakeReplay {
  const replay = new FakeReplay()
  replay.set({ time: 10, frame: first })
  replay.play()
  return replay
}

describe('robustness', () => {
  it('plays on through balls with no coordinates, people on team -1 and positions that are not numbers', () => {
    const replay = playing(frame([ball(0, 0)]))
    const frames = [
      frame([ball(null, null)]),
      frame([{ projected_coordinates: null }, ball(Number.NaN, 4)]),
      frame([ball(3, 1)], [], [
        { team_id: -1, players: [player(21, 0, -30), player(22, Number.NaN, 2, { in_possession: true })] },
        { team_id: 0, players: [player(1, Number.NaN, Number.NaN, { in_possession: true })] },
        { team_id: 1, players: [{ track_id: 11, person_type: 'PersonType.PLAYER', projected_coordinates: null }] },
      ]),
      frame([], ['EventType.THROW_IN']),
      frame([ball(Number.POSITIVE_INFINITY, 0)], ['EventType.CORNER_KICK']),
      frame([ball(1, 1)], [], []),
      { pitch_dimensions: null, teams: null, balls: null, state: null, frame_data: [] } as unknown as Frame,
    ]
    for (const next of frames) {
      expect(() => replay.step(next)).not.toThrow()
      expect(() => replay.animate(100, true)).not.toThrow()
    }
    expect(() => replay.animate(5000, true)).not.toThrow()
    expect(() => drawAll(replay)).not.toThrow()
  })

  // The reference's frame watcher stops the other moments before startGoal finds no ball to plan from.
  it('stops the other moments on a GOAL label with no ball, without starting a goal', () => {
    const replay = playing(frame([ball(0, 0)]))
    replay.set({ time: replay.time + 0.04, frame: frame([ball(-12, 0)]), phase: BLUE_ATTACKING })
    replay.animate(200)
    expect(replay.last()?.attack).toBeDefined()
    const goal = replay.step(frame([], ['GOAL']))
    expect(goal.layers?.attack).toBeUndefined()
    expect(goal.layers?.goal).toBeUndefined()
    replay.animate(500)
    expect(replay.last()?.goal).toBeUndefined()
    expect(replay.last()?.attack).toBeUndefined()
  })

  it('keeps what it last drew when a record goes missing', () => {
    const replay = playing(frame([ball(0, 0)]))
    const drawn = replay.step(frame([ball(1, 0)])).layers
    expect(drawn).not.toBeNull()
    const gone = replay.set({ time: replay.time + 0.04, frame: null })
    expect(gone.paint).toBe(false)
    expect(gone.layers).toBe(drawn)
    expect(replay.animate(200).every((o) => o.layers === drawn)).toBe(true)
  })

  it('never throws on an update, whatever order things come in', () => {
    const replay = new FakeReplay()
    expect(() => {
      replay.set({ playing: true })
      replay.set({ time: -5 })
      replay.trigger('goal')
      replay.set({ frame: frame([]) })
      replay.trigger('goal')
      replay.trigger('attack', 1)
      replay.trigger('corner')
      replay.set({ time: Number.NaN })
      replay.set({ time: 3, phase: BLUE_ATTACKING, frame: frame([ball(-20, 0)]) })
      replay.trigger('attack', 1)
      replay.animate(100)
      replay.toggle({ attack: false, corner: false, goal: false, throwInBanner: false, ringFades: false })
      replay.director.reset()
      replay.animate(100)
      replay.stopAll()
    }).not.toThrow()
  })
})
