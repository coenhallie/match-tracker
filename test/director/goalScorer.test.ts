import { describe, it, expect } from 'vitest'
import { GOAL_SEQUENCE_MS, SCORED_GOAL_MS } from '../../src/analysis/goalSequence'
import { GOAL_BANNER_OUT_MS } from '../../src/render/goalBanner'
import type { Frame, FrameAction } from '../../src/model/types'
import { FakeReplay } from './harness'

// The scorer under the goal: in the labelling tool a goal is a "Goal" label, which names the team,
// and a few seconds later a "Player scored" label, which names the player. Live, the goal waits for
// its scorer (scorerWaitS); replay plays the goal at once, as the reference does.

const WAIT_S = 6

const human = (action_type: string, over: Record<string, unknown> = {}): FrameAction =>
  ({ action_type, action_origin: 'human', ...over }) as FrameAction

/** A frame with the ball where it is, and the labels it carries. */
const frame = (actions: FrameAction[] = [], ball = { x: 30, y: 5 }): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68, goal_width: 7.32 },
    teams: [],
    balls: [{ projected_coordinates: ball }],
    state: { actions },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

const goal = (team = 1) => human('Goal', { team_id: team })
const scored = (team = 1, number = 3, name: string | null = 'Skyler Fring') =>
  human('Player scored', { team_id: team, player_number: number, player_name: name })

/** Playing at 10 s, waiting `waitS` for a scorer. */
function playing(waitS = WAIT_S): FakeReplay {
  const replay = new FakeReplay({}, { scorerWaitS: waitS })
  replay.set({ time: 10, frame: frame(), playing: true })
  return replay
}

/** Records for `seconds` of the clock, 25 a second, each with the ball at `ball`, and frames run alongside. */
function play(replay: FakeReplay, seconds: number, ball = { x: 30, y: 5 }): void {
  for (let i = 0; i < Math.round(seconds * 25); i++) {
    replay.step(frame([], ball))
    replay.animate(40)
  }
}

const banner = (replay: FakeReplay) => replay.last()?.goalBanner

describe('the scorer under the goal', () => {
  it('waits for the scorer, then plays the goal with the scorer and the team under it', () => {
    const replay = playing()
    replay.step(frame([goal()]))
    replay.animate(1200)
    expect(replay.last()?.goal).toBeUndefined()
    play(replay, 2.4)
    expect(replay.last()?.goal).toBeUndefined()
    replay.step(frame([scored()]))
    replay.animate(1200)
    expect(replay.last()?.goal).toBeDefined()
    expect(banner(replay)?.scorer).toEqual({ player: 'Skyler Fring', team: 'Blue', intensity: 1 })
  })

  it("shoots from where the ball was on the goal's record, not the scorer's", () => {
    const replay = playing()
    // On the goal's record the ball is near the left goal; by the scorer's it is back on the centre spot.
    replay.step(frame([goal()], { x: -40, y: 2 }))
    play(replay, 1, { x: 0, y: 0 })
    replay.step(frame([scored()], { x: 0, y: 0 }))
    replay.animate(GOAL_SEQUENCE_MS / 2)
    expect(banner(replay)?.side).toBe(-1)
  })

  it('names the player by shirt number when the label has no name, and the team from the goal when the scorer has none', () => {
    const replay = playing()
    replay.step(frame([goal(0)]))
    replay.step(frame([human('Player scored', { player_number: 9 })]))
    replay.animate(1200)
    // The scorer is of the goal's team: the number is looked up in that team's roster.
    expect(banner(replay)?.scorer).toEqual({ player: '#9', team: 'Red', intensity: 1 })
    // With neither a team nor a number, the label's name alone, and no team.
    const unnamed = playing()
    unnamed.step(frame([human('Goal')]))
    unnamed.step(frame([human('Player scored', { player_name: 'Jimmy Fett' })]))
    unnamed.animate(1200)
    expect(banner(unnamed)?.scorer).toEqual({ player: 'Jimmy Fett', team: null, intensity: 1 })
  })

  it('plays the goal without a scorer once the wait is over', () => {
    const replay = playing()
    replay.step(frame([goal()]))
    play(replay, WAIT_S - 0.2)
    expect(replay.last()?.goal).toBeUndefined()
    play(replay, 0.4)
    replay.animate(1200)
    expect(replay.last()?.goal).toBeDefined()
    expect(banner(replay)?.scorer).toBeUndefined()
  })

  it('puts a scorer who comes while that goal plays under it, fading in', () => {
    const replay = playing()
    replay.step(frame([goal()]))
    play(replay, WAIT_S + 0.2)
    replay.animate(1200)
    expect(banner(replay)?.scorer).toBeUndefined()
    replay.step(frame([scored()]))
    replay.animate(100)
    const coming = banner(replay)?.scorer?.intensity ?? 0
    expect(coming).toBeGreaterThan(0)
    expect(coming).toBeLessThan(1)
    replay.animate(400)
    expect(banner(replay)?.scorer?.intensity).toBe(1)
  })

  it('does not play the goal again for a scorer who comes after it', () => {
    const replay = playing()
    replay.step(frame([goal()]))
    play(replay, WAIT_S + GOAL_SEQUENCE_MS / 1000 + 0.5)
    expect(replay.last()?.goal).toBeUndefined()
    replay.step(frame([scored()]))
    replay.animate(1200)
    expect(replay.last()?.goal).toBeUndefined()
  })

  it('plays nothing for a scorer with no goal before: the labelling tool gives a scorer only after a goal', () => {
    const replay = playing()
    replay.step(frame([scored()]))
    replay.animate(1200)
    expect(replay.last()?.goal).toBeUndefined()
    play(replay, 20)
    replay.step(frame([scored(0, 9, 'Jimmy Fett')]))
    replay.animate(1200)
    expect(replay.last()?.goal).toBeUndefined()
  })

  it('names the first scorer of a goal, not a second one labelled while it plays', () => {
    const replay = playing()
    replay.step(frame([goal()]))
    replay.step(frame([scored()]))
    play(replay, 1)
    replay.step(frame([scored(1, 9, 'Han Tano')]))
    replay.animate(200)
    expect(banner(replay)?.scorer?.player).toBe('Skyler Fring')
  })

  it("names the scorer under the goal they follow, with their own team, whatever team the goal's label gives", () => {
    // As production labelled Qatar vs Australia on 2026-11-13: a goal given to one team, and its scorer
    // from the other. The scorer's team is the one the labeller picked them from.
    const replay = playing()
    replay.step(frame([goal(0)]))
    replay.step(frame([scored(1)]))
    replay.animate(1200)
    expect(replay.last()?.goal).toBeDefined()
    expect(banner(replay)?.scorer).toEqual({ player: 'Skyler Fring', team: 'Blue', intensity: 1 })
    const joining = playing(0)
    joining.step(frame([goal(0)]))
    joining.animate(1000)
    joining.step(frame([scored(1)]))
    joining.animate(600)
    expect(banner(joining)?.scorer).toEqual({ player: 'Skyler Fring', team: 'Blue', intensity: 1 })
  })

  it('plays once for a scorer whose label stays on for several records', () => {
    const replay = playing()
    replay.step(frame([goal()]))
    replay.step(frame([scored()]))
    replay.step(frame([scored()]))
    replay.animate(SCORED_GOAL_MS + 100)
    expect(replay.last()?.goal).toBeUndefined()
    replay.step(frame([scored()]))
    replay.animate(1200)
    expect(replay.last()?.goal).toBeUndefined()
  })

  it('forgets a goal waiting for its scorer on a seek, and on a pause', () => {
    const seek = playing()
    seek.step(frame([goal()]))
    seek.set({ time: 100, frame: frame() })
    seek.step(frame([scored()]))
    seek.animate(1200)
    // The goal before the seek is gone, and its scorer plays nothing alone.
    expect(seek.last()?.goal).toBeUndefined()
    const paused = playing()
    paused.step(frame([goal()]))
    paused.pause()
    paused.play()
    play(paused, WAIT_S + 1)
    expect(paused.last()?.goal).toBeUndefined()
  })

  it('does not wait with the goal layer off, nor play when it is switched off while waiting', () => {
    const replay = playing()
    replay.step(frame([goal()]))
    replay.toggle({ goal: false })
    play(replay, WAIT_S + 1)
    expect(replay.last()?.goal).toBeUndefined()
  })

  describe('how long a goal with its scorer lasts', () => {
    /** A goal with its scorer known from the start, and the zoom near goal off, so the goal moves the view. */
    function scoredGoal(): FakeReplay {
      const replay = new FakeReplay({ goalZoom: false }, { scorerWaitS: WAIT_S })
      replay.set({ time: 10, frame: frame(), playing: true })
      replay.step(frame([goal()]))
      replay.step(frame([scored()]))
      return replay
    }

    it('lasts SCORED_GOAL_MS, 6 s, where a goal alone lasts GOAL_SEQUENCE_MS', () => {
      expect(SCORED_GOAL_MS).toBe(6000)
      const replay = scoredGoal()
      replay.animate(SCORED_GOAL_MS - 100)
      expect(replay.last()?.goal).toBeDefined()
      replay.animate(200)
      expect(replay.last()?.goal).toBeUndefined()
      const alone = playing(0)
      alone.step(frame([goal()]))
      alone.animate(GOAL_SEQUENCE_MS + 100)
      expect(alone.last()?.goal).toBeUndefined()
    })

    it('names the scorer in full until the last GOAL_BANNER_OUT_MS, then fades them out with the banner', () => {
      const replay = scoredGoal()
      // In once the ball is in the net and GOAL_BANNER_IN_MS on: this shot takes 0.75 s.
      replay.animate(1200)
      expect(banner(replay)).toMatchObject({ intensity: 1, scorer: { intensity: 1 } })
      replay.animate(SCORED_GOAL_MS - GOAL_BANNER_OUT_MS - 1300)
      expect(banner(replay)).toMatchObject({ intensity: 1, scorer: { intensity: 1 } })
      replay.animate(GOAL_BANNER_OUT_MS / 2)
      const fading = banner(replay)!.scorer!.intensity
      expect(fading).toBeGreaterThan(0)
      expect(fading).toBeLessThan(1)
    })

    it('keeps the view in on the goal while the scorer is named, and eases out at the end', () => {
      const replay = scoredGoal()
      replay.animate(1000)
      const inOnGoal = replay.lastView()!.zoom
      expect(inOnGoal).toBeGreaterThan(1)
      replay.animate(SCORED_GOAL_MS - 1000 - 700)
      expect(replay.lastView()!.zoom).toBeCloseTo(inOnGoal, 6)
      replay.animate(800)
      expect(replay.lastView()).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
    })

    it('lasts SCORED_GOAL_MS for a scorer who comes while the goal plays, before it closes', () => {
      const replay = playing(0)
      replay.step(frame([goal()]))
      replay.animate(1500)
      replay.step(frame([scored()]))
      replay.animate(SCORED_GOAL_MS - 1500 - GOAL_BANNER_OUT_MS - 100)
      expect(banner(replay)?.scorer?.intensity).toBe(1)
      replay.animate(600)
      expect(replay.last()?.goal).toBeUndefined()
    })

    it('does not name a scorer who comes as it closes, too late to read: it ends when a goal alone does', () => {
      const replay = playing(0)
      replay.step(frame([goal()]))
      replay.animate(GOAL_SEQUENCE_MS - 300)
      replay.step(frame([scored()]))
      replay.animate(100)
      expect(replay.last()?.goal).toBeDefined()
      expect(banner(replay)?.scorer).toBeUndefined()
      replay.animate(300)
      expect(replay.last()?.goal).toBeUndefined()
    })
  })

  describe('replay, which plays the goal at once', () => {
    it('plays the goal on its label, as the reference does', () => {
      const replay = playing(0)
      replay.step(frame([goal()]))
      replay.animate(1200)
      expect(replay.last()?.goal).toBeDefined()
      expect(banner(replay)?.scorer).toBeUndefined()
    })

    it('puts a scorer who comes while it plays under it', () => {
      const replay = playing(0)
      replay.step(frame([goal()]))
      play(replay, 1)
      replay.step(frame([scored()]))
      replay.animate(600)
      expect(banner(replay)?.scorer).toEqual({ player: 'Skyler Fring', team: 'Blue', intensity: 1 })
    })
  })

  it('names the scorer at once under reduced motion', () => {
    const replay = playing()
    replay.reducedMotion = true
    replay.step(frame([goal()]))
    replay.step(frame([scored()]))
    replay.animate(16)
    expect(banner(replay)?.scorer).toEqual({ player: 'Skyler Fring', team: 'Blue', intensity: 1 })
  })
})
