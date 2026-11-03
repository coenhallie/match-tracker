import { describe, it, expect } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import { Director } from '../../src/director/director'
import { DEFAULT_REPLAY_LAYERS } from '../../src/model/replayLayers'
import type { Frame } from '../../src/model/types'
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
  // The flow for recording: the layer off, so it never plays by itself, and played by hand at the moment
  // it should be seen.
  it('plays the free kick by hand with its layer off and no label, even paused', () => {
    const replay = ready()
    replay.toggle({ freeKick: false })
    replay.trigger('freeKick')
    animate(replay, 600)
    expect(last(replay).freeKick).toMatchObject({ intensity: 1 })
  })

  // Nothing to wait on when played by hand: no label, no cutaway.
  it('shows a free kick played by hand for 4 s, whatever play does, then fades out', () => {
    const replay = ready(null)
    replay.play()
    replay.trigger('freeKick')
    // The ball is lost and nobody moves: a free kick off its label would hold.
    for (let i = 0; i < 70; i++) {
      replay.set({ time: replay.time + 0.04, frame: frameAt(null) })
      animate(replay, 50)
    }
    expect(last(replay).freeKick).toMatchObject({ intensity: 1 })
    animate(replay, 300)
    const going = last(replay).freeKick!
    expect(going.intensity).toBeGreaterThan(0)
    expect(going.intensity).toBeLessThan(1)
    // 4 s from its first frame, a frame after the button.
    animate(replay, 250)
    expect(last(replay).freeKick).toBeUndefined()
  })

  it('shows a free kick played by hand for 4 s under reduced motion too', () => {
    const replay = ready(20, KNOWN_ENDS, true)
    replay.trigger('freeKick')
    animate(replay, 3950)
    expect(last(replay).freeKick).toMatchObject({ intensity: 1 })
    animate(replay, 100)
    expect(last(replay).freeKick).toBeUndefined()
  })

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
    replay.trigger('freeKick')
    animate(replay, 100)
    expect(last(replay).throwIn).toBeUndefined()
    expect(last(replay).freeKick).toBeDefined()
  })

  it('says what can be played: no goal without a ball, no attack without a direction', () => {
    const withBall = ready(20)
    expect(withBall.director.availability()).toEqual({
      goal: true,
      attack: { 0: true, 1: true },
      freeKick: true,
      corner: true,
      throwIn: true,
    })

    const without = ready(null, { possession: null, attacks: { 0: null, 1: null }, states: { 0: null, 1: null } })
    expect(without.director.availability()).toMatchObject({ goal: false, attack: { 0: false, 1: false } })
    without.trigger('goal')
    without.trigger('attack', 0)
    animate(without, 300)
    expect(last(without).goal).toBeUndefined()
    expect(last(without).attack).toBeUndefined()
  })

  it('is ended by a seek, as the others are', () => {
    const replay = ready()
    replay.trigger('freeKick')
    animate(replay, 300)
    replay.set({ time: 60 })
    expect(last(replay).freeKick).toBeUndefined()
  })

  // Beyond the reference's cases: what trigger returns.
  describe('the output', () => {
    it('is null with no record on screen, as nothing can be played without a frame', () => {
      const director = new Director({
        layers: DEFAULT_REPLAY_LAYERS,
        reducedMotion: () => false,
        teamName: () => 'Red',
        teamColor: () => '#e51a1a',
      })
      const input = { nowMs: 1000, time: 0, playing: false, playback: false, record: null, phase: null, trail: null }
      expect(director.trigger('freeKick', 0, input, VIEW)).toBeNull()
      expect(director.availability()).toEqual({
        goal: false,
        attack: { 0: false, 1: false },
        freeKick: false,
        corner: false,
        throwIn: false,
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
