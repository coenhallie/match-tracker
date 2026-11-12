/**
 * The substitution card through the director: a team's substitutions on one card, joining while it
 * is up, in turn with the cards. The drawing's cases are in test/render/labelCard.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { GOAL_SEQUENCE_MS } from '../../src/analysis/goalSequence'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import type { Frame, FrameAction } from '../../src/model/types'
import { SUBSTITUTION_LIFT_MS, SUBSTITUTION_ROW_IN_MS, SUBSTITUTION_SHOW_MS } from '../../src/render/labelCard'
import { FakeReplay } from './harness'

type Label = string | FrameAction
const sub = (uuid: string | undefined, team: number, from: number, to: number): FrameAction =>
  ({ action_type: 'substitute', action_origin: 'human', team_id: team, from, to, ...(uuid ? { uuid } : {}) }) as FrameAction

const frameAt = (labels: Label[] = []): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [{ team_id: 0, players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x: 3, y: 2 } }] }],
    balls: [{ projected_coordinates: { x: 40, y: 3 } }],
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
const record = (replay: FakeReplay, labels: Label[] = [], step = 0.04) => replay.set({ time: replay.time + step, frame: frameAt(labels) })
const shown = (replay: FakeReplay) => replay.last()?.labelCard
function play(replay: FakeReplay, ms: number) {
  for (let t = 0; t < ms; t += 50) {
    record(replay, [], 0.05)
    replay.animate(50, true)
  }
}
/** Each substitution card shown, as its team and its rows' players, a run of the same counted once. */
function cards(replay: FakeReplay): string[] {
  const seen: string[] = []
  for (const output of replay.outputs) {
    if (!output.layers) continue
    const sub = output.layers.labelCard?.substitution
    const what = sub ? `${sub.team}: ${sub.rows.map((r) => `${r.out}>${r.in}`).join(', ')}` : '-'
    if (seen.at(-1) !== what) seen.push(what)
  }
  return seen.filter((s) => s !== '-')
}
const distinctCards = (replay: FakeReplay) => {
  let n = 0
  let up = false
  for (const output of replay.outputs) {
    if (!output.layers) continue
    const now = output.layers.labelCard?.key === 'substitution'
    if (now && !up) n++
    up = now
  }
  return n
}

describe('the substitution card', () => {
  it('plays a substitution with the team and both players', () => {
    const replay = ready()
    record(replay, [sub('a', 0, 1, 16)])
    replay.animate(100, true)
    expect(shown(replay)).toMatchObject({ key: 'substitution', substitution: { team: 'Red', rows: [{ out: '#1', in: '#16' }] } })
  })

  it('takes a second for the team into its list, and stays 5 s from it', () => {
    const replay = ready()
    record(replay, [sub('a', 0, 1, 16)])
    play(replay, 3000)
    record(replay, [sub('b', 0, 2, 17)])
    play(replay, SUBSTITUTION_SHOW_MS - 300)
    expect(shown(replay)?.substitution?.rows.map((r) => r.out)).toEqual(['#1', '#2'])
    play(replay, 900)
    expect(shown(replay)).toBeUndefined()
    expect(distinctCards(replay)).toBe(1)
  })

  it('gives a substitution for the other team its own card, after', () => {
    const replay = ready()
    record(replay, [sub('a', 0, 1, 16)])
    play(replay, 1000)
    record(replay, [sub('b', 1, 3, 18)])
    play(replay, SUBSTITUTION_SHOW_MS + 2000)
    expect(cards(replay)).toEqual(['Red: #1>#16', 'Blue: #3>#18'])
  })

  it('gives a 6th its own card, after', () => {
    const replay = ready()
    for (let i = 1; i <= 6; i++) {
      record(replay, [sub(`s${i}`, 0, i, 10 + i)])
      play(replay, 500)
    }
    play(replay, SUBSTITUTION_SHOW_MS + 2000)
    expect(distinctCards(replay)).toBe(2)
    expect(cards(replay).at(-1)).toBe('Red: #6>#16')
  })

  it('gives one arriving as the card fades its own card, after', () => {
    const replay = ready()
    record(replay, [sub('a', 0, 1, 16)])
    play(replay, SUBSTITUTION_SHOW_MS + 150)
    expect(shown(replay)?.intensity).toBeLessThan(1)
    record(replay, [sub('b', 0, 2, 17)])
    play(replay, SUBSTITUTION_SHOW_MS + 1500)
    expect(cards(replay)).toEqual(['Red: #1>#16', 'Red: #2>#17'])
  })

  it('plays three held back by a goal as one card of three', () => {
    const replay = ready()
    record(replay, ['Goal', sub('a', 0, 1, 16), sub('b', 0, 2, 17)])
    record(replay, [sub('c', 0, 3, 18)])
    expect(shown(replay)).toBeUndefined()
    play(replay, GOAL_SEQUENCE_MS + 800)
    expect(shown(replay)?.substitution?.rows).toHaveLength(3)
    expect(distinctCards(replay)).toBe(1)
  })

  it('glides up as a 3rd row joins, and fades the row in', () => {
    const replay = ready()
    record(replay, [sub('a', 0, 1, 16), sub('b', 0, 2, 17)])
    play(replay, 1000)
    expect(shown(replay)?.substitution?.rowsShown).toBe(2)
    record(replay, [sub('c', 0, 3, 18)])
    replay.animate(SUBSTITUTION_LIFT_MS / 2, true)
    const half = shown(replay)!.substitution!
    expect(half.rowsShown).toBeGreaterThan(2)
    expect(half.rowsShown).toBeLessThan(3)
    expect(half.rows[2]!.intensity).toBeGreaterThan(0)
    expect(half.rows[2]!.intensity).toBeLessThan(1)
    replay.animate(Math.max(SUBSTITUTION_LIFT_MS, SUBSTITUTION_ROW_IN_MS), true)
    expect(shown(replay)!.substitution!.rowsShown).toBe(3)
    expect(shown(replay)!.substitution!.rows[2]!.intensity).toBe(1)
  })

  it('plays again, with its rows, a card a goal cut short', () => {
    const replay = ready()
    record(replay, [sub('a', 0, 1, 16), sub('b', 0, 2, 17)])
    play(replay, 1000)
    record(replay, ['Goal'])
    replay.animate(100, true)
    expect(shown(replay)).toBeUndefined()
    play(replay, GOAL_SEQUENCE_MS + 800)
    expect(shown(replay)?.substitution?.rows.map((r) => r.out)).toEqual(['#1', '#2'])
  })

  it('forgets what waits on a seek, a pause, a press', () => {
    for (const interrupt of [
      (r: FakeReplay) => r.set({ time: r.time + 5, frame: frameAt() }),
      (r: FakeReplay) => {
        r.pause()
        r.play()
      },
      (r: FakeReplay) => r.stopAll(),
    ]) {
      const replay = ready()
      record(replay, [sub('a', 0, 1, 16)])
      play(replay, 500)
      record(replay, [sub('b', 1, 3, 18)])
      interrupt(replay)
      play(replay, SUBSTITUTION_SHOW_MS + 2000)
      expect(cards(replay).filter((c) => c.startsWith('Blue'))).toEqual([])
    }
  })

  it('plays nothing landed on by a seek or seen while paused', () => {
    const seek = ready()
    seek.set({ time: seek.time + 5, frame: frameAt([sub('a', 0, 1, 16)]) })
    play(seek, 1000)
    expect(cards(seek)).toEqual([])
    const paused = ready()
    record(paused)
    paused.pause()
    paused.set({ frame: frameAt([sub('a', 0, 1, 16)]) })
    paused.play()
    play(paused, 1000)
    expect(cards(paused)).toEqual([])
  })

  it('plays by hand with the team and no rows', () => {
    const replay = ready()
    replay.trigger('substitution', 1)
    replay.animate(100, true)
    expect(shown(replay)).toMatchObject({ key: 'substitution', substitution: { team: 'Blue', rows: [] } })
  })

  it('shows one card, start to end, for a card of three', () => {
    const replay = ready()
    record(replay, [sub('a', 0, 1, 16)])
    play(replay, 1000)
    record(replay, [sub('b', 0, 2, 17)])
    play(replay, 1000)
    record(replay, [sub('c', 0, 3, 18)])
    play(replay, SUBSTITUTION_SHOW_MS + 1000)
    expect(distinctCards(replay)).toBe(1)
  })
})
