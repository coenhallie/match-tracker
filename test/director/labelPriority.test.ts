import { describe, it, expect } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import type { Frame, FrameAction } from '../../src/model/types'
import { FakeReplay } from './harness'

// A human's label goes before an attack: whatever it plays, the attack showing goes, and none starts
// while it shows. A goal waiting for its scorer counts as showing: it is about to.

// Blue attacks toward x < 0, so its opponent's half is x < 0.
const BLUE_ATTACKING: TeamPhase = {
  possession: 1,
  attacks: { 0: 1, 1: -1 },
  states: { 0: 'defending', 1: 'attacking' },
}
const NOBODY: TeamPhase = { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }

const human = (action_type: string, over: Record<string, unknown> = {}): FrameAction =>
  ({ action_type, action_origin: 'human', ...over }) as FrameAction

/** A frame with the ball in Blue's opponent's half, and the labels it carries. */
const frame = (actions: FrameAction[] = []): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68, goal_width: 7.32 },
    teams: [],
    balls: [{ projected_coordinates: { x: -12, y: 0 } }],
    state: { actions },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

/** Live play, waiting `waitS` for a goal's scorer, with Blue's attack showing. */
function attacking(waitS = 6): FakeReplay {
  const replay = new FakeReplay({}, { scorerWaitS: waitS })
  replay.set({ time: 10, frame: frame(), phase: NOBODY })
  replay.play()
  replay.set({ time: 10.04, frame: frame(), phase: BLUE_ATTACKING })
  replay.animate(1000)
  expect(replay.last()?.attack?.intensity).toBe(1)
  return replay
}

/** One more record of Blue attacking, with `labels`, and frames for `ms`. */
function next(replay: FakeReplay, labels: FrameAction[] = [], ms = 600): void {
  replay.set({ time: replay.time + 0.04, frame: frame(labels), phase: BLUE_ATTACKING })
  replay.animate(ms)
}

/** Whether the attack is gone or on its way out. */
const attackGoing = (replay: FakeReplay) => {
  const attack = replay.last()?.attack
  return attack === undefined || attack.leaving
}

describe('a human label goes before an attack', () => {
  it('takes the attack off for a goal waiting for its scorer, and starts none while it waits', () => {
    const replay = attacking()
    next(replay, [human('Goal', { team_id: 1 })])
    expect(replay.last()?.goal).toBeUndefined()
    expect(attackGoing(replay)).toBe(true)
    // Blue still attacking, a few records on: the attack does not come back while the goal waits.
    for (let i = 0; i < 20; i++) next(replay, [], 100)
    expect(replay.last()?.attack).toBeUndefined()
  })

  for (const [what, label] of [
    ['a foul', 'Foul'],
    ['a shot on goal', 'Shot on goal'],
    ['a header on goal', 'Header on goal'],
  ] as const) {
    it(`takes the attack off for ${what}'s small card, and starts none while it shows`, () => {
      const replay = attacking()
      next(replay, [human(label)])
      expect(replay.last()?.smallLabelCard).toBeDefined()
      expect(attackGoing(replay)).toBe(true)
      for (let i = 0; i < 10; i++) next(replay, [], 100)
      expect(replay.last()?.smallLabelCard).toBeDefined()
      expect(replay.last()?.attack).toBeUndefined()
    })
  }

  it('lets the next attack show once the label has gone', () => {
    const replay = attacking()
    next(replay, [human('Foul')])
    for (let i = 0; i < 80; i++) next(replay, [], 100)
    expect(replay.last()?.smallLabelCard).toBeUndefined()
    // An attack shows as the phase turns to one: nobody's, then Blue's again.
    replay.set({ time: replay.time + 0.04, frame: frame(), phase: NOBODY })
    next(replay, [], 1000)
    expect(replay.last()?.attack?.intensity).toBe(1)
  })
})
