import { describe, it, expect } from 'vitest'
import { playMoved } from '../../src/analysis/stoppage'
import type { Frame } from '../../src/model/types'

const PITCH = { length: 105, width: 68 }

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
