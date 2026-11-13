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

// The penalty goes with the moments a human label starts, as the goal does: it takes over from what
// shows, nothing starts over it, the player cards wait their turn, and a goal takes over from it
// (docs/superpowers/specs/2026-11-13-penalty-design.md, "With the other moments").
describe('the penalty among the moments', () => {
  const PENALTY = human('Penalty', { team_name: 'Team Away' })

  /** Playing at 10 s, no attack. */
  function playingAlong(): FakeReplay {
    const replay = new FakeReplay()
    replay.set({ time: 10, frame: frame(), phase: NOBODY })
    replay.play()
    return replay
  }

  const quiet = (replay: FakeReplay, labels: FrameAction[] = [], ms = 100) => {
    replay.set({ time: replay.time + 0.04, frame: frame(labels), phase: NOBODY })
    replay.animate(ms)
  }

  for (const [what, label, showing] of [
    ['a corner', 'Corner kick', 'corner'],
    ['a throw-in', 'Throw in', 'throwIn'],
    ['a centre card', 'VAR check', 'labelCard'],
    ['a small card', 'Foul', 'smallLabelCard'],
  ] as const) {
    it(`takes over from ${what}, and nothing starts while it shows`, () => {
      const replay = playingAlong()
      quiet(replay, [human(label)], 600)
      expect(replay.last()?.[showing]).toBeDefined()
      quiet(replay, [PENALTY], 100)
      expect(replay.director.penaltyPhase).toBe('card')
      expect(replay.last()?.[showing]).toBeUndefined()
      // Each of them labelled afresh while it shows: none comes up.
      for (const other of ['Corner kick', 'Freekick', 'Throw in', 'VAR check', 'Foul']) {
        quiet(replay, [], 1000)
        quiet(replay, [human(other)], 100)
      }
      const shown = replay.last()!
      expect(shown.penalty).toBeDefined()
      expect([shown.corner, shown.freeKick, shown.throwIn, shown.throwInCard, shown.labelCard, shown.smallLabelCard]).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ])
    })
  }

  it('takes the attack off, and starts none while it shows', () => {
    const replay = attacking(0)
    next(replay, [PENALTY])
    expect(replay.last()?.penalty).toBeDefined()
    expect(attackGoing(replay)).toBe(true)
    for (let i = 0; i < 20; i++) next(replay, [], 100)
    expect(replay.last()?.penalty).toBeDefined()
    expect(replay.last()?.attack).toBeUndefined()
  })

  it('holds a yellow card back until it has gone', () => {
    const replay = playingAlong()
    quiet(replay, [PENALTY])
    quiet(replay, [human('Player yellow card', { team_id: 0, player_number: 9, player_name: 'Lando' })])
    expect(replay.last()?.labelCard).toBeUndefined()
    quiet(replay, [human('Penalty scored', { team_name: 'Team Away' })])
    for (let i = 0; i < 100 && replay.director.penaltyPhase !== null; i++) quiet(replay)
    expect(replay.director.penaltyPhase).toBeNull()
    expect(replay.last()?.labelCard).toBeUndefined()
    // The queue plays on the next record.
    quiet(replay)
    expect(replay.last()?.labelCard).toMatchObject({ key: 'yellowCard', player: { player: 'Lando' } })
  })

  it('gives way to a goal', () => {
    const replay = playingAlong()
    quiet(replay, [PENALTY], 3000)
    expect(replay.director.penaltyPhase).toBe('waiting')
    quiet(replay, [human('Goal', { team_id: 1 })])
    expect(replay.director.penaltyPhase).toBeNull()
    expect(replay.last()?.penalty).toBeUndefined()
    expect(replay.last()?.goal).toBeDefined()
  })

  // My call: as nothing starts over a goal, a penalty does not either. Its label is noted, so it
  // does not play later; its result, once the goal has gone, plays as one with nothing showing.
  it('does not start over a goal', () => {
    const replay = playingAlong()
    quiet(replay, [human('Goal', { team_id: 1 })])
    expect(replay.last()?.goal).toBeDefined()
    quiet(replay, [PENALTY])
    expect(replay.director.penaltyPhase).toBeNull()
    expect(replay.last()?.penalty).toBeUndefined()
    expect(replay.last()?.goal).toBeDefined()
  })

  it('ends when its layer goes off, and the next penalty scored plays the goal', () => {
    const replay = playingAlong()
    quiet(replay, [PENALTY], 3000)
    expect(replay.last()?.penalty).toBeDefined()
    const off = replay.toggle({ penalty: false })
    expect(off.paint).toBe(true)
    expect(replay.last()?.penalty).toBeUndefined()
    expect(replay.director.penaltyPhase).toBeNull()
    quiet(replay, [human('Penalty scored', { team_id: 1 })])
    expect(replay.last()?.penalty).toBeUndefined()
    expect(replay.last()?.goal).toBeDefined()
  })
})
