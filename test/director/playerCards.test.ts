/**
 * The player cards through the director: each human card label plays, in turn, with who it is
 * for, however it has to wait. The drawing's cases are in test/render/labelCard.test.ts, the
 * queue's in test/director/cardQueue.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { GOAL_SEQUENCE_MS } from '../../src/analysis/goalSequence'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import type { Frame, FrameAction } from '../../src/model/types'
import { LABEL_CARD_OUT_MS, LABEL_CARD_SHOW_MS } from '../../src/render/labelCard'
import { FakeReplay } from './harness'

type Label = string | FrameAction

/** A card label as the live stream sends it. */
const cardLabel = (kind: 'yellow' | 'red', uuid: string | undefined, team?: number, number?: number, origin = 'human'): FrameAction =>
  ({
    action_type: `Player ${kind} card`,
    action_origin: origin,
    ...(uuid === undefined ? {} : { uuid }),
    ...(team === undefined ? {} : { team_id: team }),
    ...(number === undefined ? {} : { player_number: number }),
  }) as FrameAction

/** A record, the ball at `ballX` along the pitch, with these labels: a name is a human's label. */
const frameAt = (labels: Label[] = [], ballX = 40): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [{ team_id: 0, players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x: 3, y: 2 } }] }],
    balls: [{ projected_coordinates: { x: ballX, y: 3 } }],
    state: { actions: labels.map((l) => (typeof l === 'string' ? { action_type: l, action_origin: 'human' } : l)) },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

const NOBODY: TeamPhase = { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }

function ready(): FakeReplay {
  const replay = new FakeReplay()
  replay.set({ time: 10, frame: frameAt(), phase: NOBODY })
  replay.play()
  return replay
}
const record = (replay: FakeReplay, labels: Label[] = [], step = 0.04) =>
  replay.set({ time: replay.time + step, frame: frameAt(labels) })
const card = (replay: FakeReplay) => replay.last()?.labelCard
/** Playback for `ms`: a record every 50 ms, each followed by its animation frames. */
function play(replay: FakeReplay, ms: number) {
  for (let t = 0; t < ms; t += 50) {
    record(replay, [], 0.05)
    replay.animate(50, true)
  }
}
/** Which card each output showed, a run of the same counted once. */
function shown(replay: FakeReplay): string[] {
  const keys: string[] = []
  for (const output of replay.outputs) {
    // An output that paints nothing says nothing about what is on screen.
    if (!output.layers) continue
    const key = output.layers.labelCard?.key ?? '-'
    if (keys.at(-1) !== key) keys.push(key)
  }
  return keys.filter((k) => k !== '-')
}

/** Which player each output's card named, a run of the same counted once. */
function players(replay: FakeReplay): string[] {
  const names: string[] = []
  for (const output of replay.outputs) {
    if (!output.layers) continue
    const card = output.layers.labelCard
    const name = card?.player ? `${card.key} ${card.player.player}` : '-'
    if (names.at(-1) !== name) names.push(name)
  }
  return names.filter((n) => n !== '-')
}

describe('a player card', () => {
  it("plays a human's card with the team and the player, and not an AI's", () => {
    const replay = ready()
    record(replay, [cardLabel('red', 'u1', 0, 3)])
    replay.animate(100, true)
    expect(card(replay)).toMatchObject({ key: 'redCard', player: { team: 'Red', player: '#3', color: '#EF4444' } })

    const ai = ready()
    record(ai, [cardLabel('red', 'u2', 0, 3, 'ai')])
    ai.animate(100, true)
    expect(card(ai)).toBeUndefined()
  })

  it('plays two cards on one record, one after the other, each its full time', () => {
    const replay = ready()
    record(replay, [cardLabel('yellow', 'u1', 1, 4), cardLabel('red', 'u2', 0, 3)])
    replay.animate(100, true)
    expect(card(replay)).toMatchObject({ key: 'yellowCard', player: { team: 'Blue', player: '#4' } })
    play(replay, LABEL_CARD_SHOW_MS - 300)
    expect(card(replay)?.key).toBe('yellowCard')
    play(replay, LABEL_CARD_OUT_MS + 600)
    expect(card(replay)).toMatchObject({ key: 'redCard', player: { team: 'Red', player: '#3' } })
    expect(shown(replay)).toEqual(['yellowCard', 'redCard'])
  })

  it('plays a card given during a goal once the goal is over', () => {
    const replay = ready()
    record(replay, ['Goal', cardLabel('red', 'u1', 0, 3)])
    replay.animate(100, true)
    expect(replay.last()?.goal).toBeDefined()
    expect(card(replay)).toBeUndefined()
    play(replay, GOAL_SEQUENCE_MS + 400)
    expect(replay.last()?.goal).toBeUndefined()
    expect(shown(replay)).toEqual(['redCard'])
  })

  it('plays again a card a goal cut short', () => {
    const replay = ready()
    record(replay, [cardLabel('red', 'u1', 0, 3)])
    play(replay, 1000)
    expect(card(replay)?.key).toBe('redCard')
    record(replay, ['Goal'])
    replay.animate(100, true)
    expect(replay.last()?.goal).toBeDefined()
    expect(card(replay)).toBeUndefined()
    play(replay, GOAL_SEQUENCE_MS + 400)
    expect(card(replay)?.key).toBe('redCard')
  })

  it('plays one card for a label seen on several records', () => {
    const replay = ready()
    for (let i = 0; i < 5; i++) record(replay, [cardLabel('red', 'u1', 0, 3)])
    play(replay, LABEL_CARD_SHOW_MS + LABEL_CARD_OUT_MS + 1000)
    expect(shown(replay)).toEqual(['redCard'])
  })

  it('forgets the waiting cards on a seek', () => {
    const replay = ready()
    record(replay, ['Goal', cardLabel('red', 'u1', 0, 3)])
    replay.set({ time: replay.time + 5, frame: frameAt() })
    play(replay, GOAL_SEQUENCE_MS + 1000)
    expect(shown(replay)).toEqual([])
  })

  it('does not play a card landed on by a seek, as its label carries on', () => {
    const replay = ready()
    replay.set({ time: replay.time + 5, frame: frameAt([cardLabel('red', 'u1', 0, 3)]) })
    for (let i = 0; i < 5; i++) record(replay, [cardLabel('red', 'u1', 0, 3)])
    play(replay, 1000)
    expect(shown(replay)).toEqual([])
  })

  it('drops a waiting card whose layer goes off', () => {
    const replay = ready()
    record(replay, ['Goal', cardLabel('red', 'u1', 0, 3)])
    replay.toggle({ redCard: false })
    replay.toggle({ redCard: true })
    play(replay, GOAL_SEQUENCE_MS + 1000)
    expect(shown(replay)).toEqual([])
  })

  it('plays a card by hand for a team, with no player', () => {
    const replay = ready()
    replay.trigger('yellowCard', 1)
    replay.animate(100, true)
    expect(card(replay)).toMatchObject({ key: 'yellowCard', player: { team: 'Blue', player: null, color: '#EAB308' } })
  })

  it('leaves out the player for a label with no team or no number', () => {
    const noTeam = ready()
    record(noTeam, [cardLabel('red', 'u1', undefined, 3)])
    noTeam.animate(100, true)
    expect(card(noTeam)?.player).toEqual({ team: null, player: null, color: '#EF4444' })
    const noNumber = ready()
    record(noNumber, [cardLabel('red', 'u2', 0, -1)])
    noNumber.animate(100, true)
    expect(card(noNumber)?.player).toEqual({ team: 'Red', player: null, color: '#EF4444' })
  })

  it('fades one card out before the next fades in', () => {
    const replay = ready()
    record(replay, [cardLabel('yellow', 'u1', 1, 4), cardLabel('yellow', 'u2', 1, 7)])
    play(replay, LABEL_CARD_SHOW_MS + LABEL_CARD_OUT_MS + 1200)
    const cards = replay.outputs.flatMap((o) => (o.layers ? [o.layers.labelCard] : []))
    const second = cards.findIndex((c) => c?.player?.player === '#7')
    expect(second).toBeGreaterThan(0)
    // The first had gone, and the second comes in from nothing.
    expect(cards.slice(0, second).filter((c) => c?.player?.player === '#4').at(-1)!.intensity).toBeLessThan(0.1)
    expect(cards[second]!.intensity).toBeLessThan(0.3)
    expect(players(replay)).toEqual(['yellowCard #4', 'yellowCard #7'])
  })

  it('does not play a card on a new record while paused, nor after', () => {
    const replay = ready()
    record(replay)
    replay.pause()
    replay.set({ frame: frameAt([cardLabel('red', 'u1', 0, 3)]) })
    replay.animate(1000, true)
    expect(card(replay)).toBeUndefined()
    replay.play()
    play(replay, 1000)
    expect(shown(replay)).toEqual([])
  })

  it('forgets the waiting card when play pauses', () => {
    const replay = ready()
    record(replay, [cardLabel('yellow', 'u1', 1, 4), cardLabel('red', 'u2', 0, 3)])
    play(replay, 500)
    replay.pause()
    replay.play()
    play(replay, LABEL_CARD_SHOW_MS + 2000)
    expect(shown(replay)).toEqual(['yellowCard'])
  })

  it('forgets the waiting cards on a press', () => {
    const replay = ready()
    record(replay, [cardLabel('yellow', 'u1', 1, 4), cardLabel('red', 'u2', 0, 3)])
    play(replay, 500)
    replay.stopAll()
    play(replay, LABEL_CARD_SHOW_MS + 2000)
    expect(shown(replay)).toEqual(['yellowCard'])
  })

  it('plays two cards of one colour for two players on one record, with no uuid', () => {
    const replay = ready()
    record(replay, [cardLabel('yellow', undefined, 1, 4), cardLabel('yellow', undefined, 1, 9)])
    play(replay, 2 * (LABEL_CARD_SHOW_MS + LABEL_CARD_OUT_MS) + 1500)
    expect(players(replay)).toEqual(['yellowCard #4', 'yellowCard #9'])
  })
})
