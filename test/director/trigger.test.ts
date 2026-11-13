import { describe, it, expect } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import { Director } from '../../src/director/director'
import { DEFAULT_REPLAY_LAYERS } from '../../src/model/replayLayers'
import type { Frame } from '../../src/model/types'
import { LABEL_CARD_DEMO_MS } from '../../src/render/labelCard'
import { PENALTY_CARD_MS, PENALTY_HOLD_MS, PENALTY_KICK_MS, PENALTY_OUT_MS, PENALTY_RESULT_IN_MS, PENALTY_SCENE_IN_MS } from '../../src/render/penalty'
import { FakeReplay, VIEW } from './harness'

// The cases of 'playing moments by hand' from pipelineOutputSurface.test.ts (:2133-2345), with the
// surface's fake replay as FakeReplay and `trigger` for its exposed triggerMoment. These blocks run whole
// animation frames (`animate(ms, true)`), as the reference's do.

const frameAt = (ballX: number | null, labels: string[] = []): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [
      {
        team_id: 0,
        players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x: 3, y: 2 } }],
      },
    ],
    balls: ballX === null ? [] : [{ projected_coordinates: { x: ballX, y: 5 } }],
    state: { actions: labels.map((action_type) => ({ action_type })) },
    frame_data: [{ frame_count: 1 }],
  }) as Frame
const KNOWN_ENDS: TeamPhase = { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }

/** Ready on a frame, paused (reference :2186-2197). */
function ready(ballX: number | null = 20, phase: TeamPhase = KNOWN_ENDS, reducedMotion = false): FakeReplay {
  const names = ['Manchester City', 'PSG'] as const
  const replay = new FakeReplay({}, { teamName: (team) => names[team] })
  replay.reducedMotion = reducedMotion
  replay.set({ time: 10, frame: frameAt(ballX), phase })
  return replay
}

const animate = (replay: FakeReplay, ms: number) => replay.animate(ms, true)
const last = (replay: FakeReplay) => replay.last()!

describe('playing moments by hand', () => {
  it('plays the throw-in by hand, fading in where it stands, noting the ball’s half', () => {
    const replay = ready(-25)
    replay.trigger('throwIn')
    animate(replay, 600)
    expect(last(replay).throwIn).toMatchObject({ intensity: 1, side: -1, inPlace: true })
  })

  it('plays a team’s attack by hand, holding the ball where it is', () => {
    const replay = ready(-12)
    replay.trigger('attack', 1)
    animate(replay, 1000)
    expect(last(replay).attack).toMatchObject({ team: 1, name: 'PSG', ball: { x: -12, y: 5 } })
  })

  it('plays the goal by hand, into the goal in the ball’s half', () => {
    const replay = ready(30)
    replay.trigger('goal')
    animate(replay, 100)
    expect(last(replay).goal?.net.side).toBe(1)
  })

  // The shot is seen first; the card comes up as it reaches the net and goes as the camera eases back.
  it('brings the goal’s card up as the ball reaches the net, and takes it down at the end', () => {
    const replay = ready(30)
    replay.trigger('goal')
    animate(replay, 150)
    expect(last(replay).goalBanner).toBeUndefined()
    animate(replay, 1500)
    expect(last(replay).goalBanner).toMatchObject({ intensity: 1 })
    animate(replay, 2000)
    expect(last(replay).goalBanner).toBeUndefined()
  })

  it('takes over from a moment already showing', () => {
    const replay = ready()
    replay.trigger('throwIn')
    animate(replay, 300)
    replay.trigger('corner')
    animate(replay, 100)
    expect(last(replay).throwIn).toBeUndefined()
    expect(last(replay).corner).toBeDefined()
  })

  it('says what can be played: no goal without a ball, no attack without a direction', () => {
    const withBall = ready(20)
    expect(withBall.director.availability()).toEqual({
      goal: true,
      attack: { 0: true, 1: true },
      corner: true,
      freeKick: true,
      throwIn: true,
      varCheck: true,
      goalDisallowed: true,
      halfTime: true,
      secondHalf: true,
      fullTime: true,
      foul: true,
      shotOnGoal: true,
      headerOnGoal: true,
      yellowCard: true,
      redCard: true,
      substitution: true,
      penalty: true,
      penaltyScored: true,
      penaltyMissed: true,
    })

    const without = ready(null, { possession: null, attacks: { 0: null, 1: null }, states: { 0: null, 1: null } })
    expect(without.director.availability()).toMatchObject({ goal: false, attack: { 0: false, 1: false } })
    without.trigger('goal')
    without.trigger('attack', 0)
    animate(without, 300)
    expect(last(without).goal).toBeUndefined()
    expect(last(without).attack).toBeUndefined()
  })

  // The penalty's three, each a moment of its own by hand (docs/superpowers/specs/2026-11-13-penalty-design.md,
  // "Played by hand"): the penalty has no result to wait for, and a result is one with no penalty showing.
  it('plays each of the three by hand', () => {
    const replay = ready()
    replay.trigger('penalty', 1)
    expect(replay.director.penaltyPhase).toBe('card')
    expect(last(replay).penalty).toMatchObject({ team: 'PSG', result: null })
    animate(replay, PENALTY_CARD_MS + LABEL_CARD_DEMO_MS - 50)
    expect(replay.director.penaltyPhase).toBe('waiting')
    animate(replay, 100)
    expect(replay.director.penaltyPhase).toBe('leaving')
    animate(replay, PENALTY_OUT_MS)
    expect(replay.director.penaltyPhase).toBeNull()
    expect(last(replay).penalty).toBeUndefined()

    for (const [moment, result] of [
      ['penaltyScored', 'scored'],
      ['penaltyMissed', 'missed'],
    ] as const) {
      replay.trigger(moment)
      expect(replay.director.penaltyPhase).toBe('kick')
      expect(last(replay).penalty).toMatchObject({ team: 'Manchester City', result, card: 0 })
      animate(replay, PENALTY_SCENE_IN_MS + PENALTY_KICK_MS + PENALTY_RESULT_IN_MS + 100)
      expect(replay.director.penaltyPhase).toBe('holding')
      expect(last(replay).penalty).toMatchObject({ scene: 1, kick: 1, banner: 1 })
      animate(replay, PENALTY_HOLD_MS + PENALTY_OUT_MS)
      expect(replay.director.penaltyPhase).toBeNull()
    }
  })

  it('plays the penalty by hand over another moment, and a seek ends it', () => {
    const replay = ready()
    replay.trigger('corner')
    animate(replay, 300)
    replay.trigger('penaltyMissed')
    expect(last(replay).corner).toBeUndefined()
    expect(last(replay).penalty).toBeDefined()
    animate(replay, 300)
    replay.set({ time: 60 })
    expect(replay.director.penaltyPhase).toBeNull()
    expect(last(replay).penalty).toBeUndefined()
  })

  it('plays the penalty by hand with its layer off', () => {
    const replay = new FakeReplay({ penalty: false })
    replay.set({ time: 10, frame: frameAt(20) })
    replay.trigger('penalty')
    animate(replay, 100)
    expect(last(replay).penalty).toBeDefined()
  })

  it('is available once a frame is on screen', () => {
    const director = new Director({
      layers: { ...DEFAULT_REPLAY_LAYERS, goalZoom: false, penalty: false },
      reducedMotion: () => false,
      teamName: () => 'Red',
      playerName: (_team, number) => `#${number}`,
      substitutionName: (_team, number) => (number === null ? null : `#${number}`),
      teamColor: () => '#e51a1a',
    })
    const none = { nowMs: 1000, time: 0, playing: false, playback: false, record: null, phase: null, trail: null }
    director.update(none, VIEW)
    expect(director.availability()).toMatchObject({ penalty: false, penaltyScored: false, penaltyMissed: false })
    // Its layer off, as by hand every moment plays whether or not its layer is on.
    director.update({ ...none, nowMs: 1020, time: 10, record: { t: 10, frameCount: 1, frame: frameAt(null) } }, VIEW)
    expect(director.availability()).toMatchObject({ penalty: true, penaltyScored: true, penaltyMissed: true })
  })

  it('is ended by a seek, as the others are', () => {
    const replay = ready()
    replay.trigger('corner')
    animate(replay, 300)
    replay.set({ time: 60 })
    expect(last(replay).corner).toBeUndefined()
  })

  // Beyond the reference's cases: what trigger returns.
  describe('the output', () => {
    it('is null with no record on screen, as nothing can be played without a frame', () => {
      const director = new Director({
        // The zoom near goal off, as in the harness: the reference's camera.
        layers: { ...DEFAULT_REPLAY_LAYERS, goalZoom: false },
        reducedMotion: () => false,
        teamName: () => 'Red',
        playerName: (_team, number) => `#${number}`,
        substitutionName: (_team, number) => (number === null ? null : `#${number}`),
        teamColor: () => '#e51a1a',
      })
      const input = { nowMs: 1000, time: 0, playing: false, playback: false, record: null, phase: null, trail: null }
      expect(director.trigger('corner', 0, input, VIEW)).toBeNull()
      expect(director.availability()).toEqual({
        goal: false,
        attack: { 0: false, 1: false },
        corner: false,
        freeKick: false,
        throwIn: false,
        varCheck: false,
        goalDisallowed: false,
        halfTime: false,
        secondHalf: false,
        fullTime: false,
        foul: false,
        shotOnGoal: false,
        headerOnGoal: false,
        yellowCard: false,
        redCard: false,
        substitution: false,
        penalty: false,
        penaltyScored: false,
        penaltyMissed: false,
      })
    })

    it('paints once when the moment plays, and not at all when it cannot', () => {
      const replay = ready(null, { possession: null, attacks: { 0: null, 1: null }, states: { 0: null, 1: null } })
      expect(replay.trigger('goal')!.paints).toHaveLength(0)
      expect(replay.trigger('attack', 1)!.paints).toHaveLength(0)
      const played = replay.trigger('throwIn')!
      expect(played.paints).toHaveLength(1)
      expect(played.animating).toBe(true)
    })

    it('marks an attack played by hand as seen, so it does not play again by itself', () => {
      const replay = ready(-12)
      replay.play()
      replay.trigger('attack', 1)
      animate(replay, 3000)
      expect(last(replay).attack).toBeUndefined()
      const attacking: TeamPhase = {
        possession: 1,
        attacks: { 0: 1, 1: -1 },
        states: { 0: 'defending', 1: 'attacking' },
      }
      replay.set({ time: replay.time + 0.04, frame: frameAt(-14), phase: attacking })
      animate(replay, 100)
      expect(last(replay).attack).toBeUndefined()
    })
  })
})
