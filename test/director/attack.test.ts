import { describe, it, expect } from 'vitest'
import type { BallTrail } from '../../src/analysis/ballTrail'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import type { Frame } from '../../src/model/types'
import { PERSON_COLORS } from '../../src/render/constants'
import { FakeReplay } from './harness'

// The attack's cases from pipelineOutputSurface.test.ts (:893-1157), with the surface's fake replay as
// FakeReplay: `arrive` is one step of the clock bringing a record and a phase, `animate` runs animation
// frames as the reference's does.

const frameAt = (ballX = 10): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [],
    balls: [{ projected_coordinates: { x: ballX, y: 0 } }],
    state: { actions: [] },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

// Blue attacks toward x < 0, so its opponent's half is x < 0.
const BLUE_ATTACKING: TeamPhase = {
  possession: 1,
  attacks: { 0: 1, 1: -1 },
  states: { 0: 'defending', 1: 'attacking' },
}
const NOBODY: TeamPhase = { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }

/** Ready on a frame with nobody attacking, then playing (reference :964-975). */
function ready(teamNames?: [string, string], reducedMotion = false): FakeReplay {
  const replay = new FakeReplay({}, teamNames ? { teamName: (team) => teamNames[team] } : {})
  replay.reducedMotion = reducedMotion
  replay.set({ time: 10, frame: frameAt(), phase: NOBODY })
  replay.play()
  return replay
}

/** A new frame and phase, arrived at by playback (step s) or a seek. */
const arrive = (replay: FakeReplay, phase: TeamPhase, ballX = 10, step = 0.04) =>
  replay.set({ time: replay.time + step, frame: frameAt(ballX), phase })

const lastAttack = (replay: FakeReplay) => replay.last()?.attack

describe('attack', () => {
  it('shows an attack that reaches the other team’s half, for the team attacking', () => {
    const replay = ready(['Manchester City', 'PSG'])
    arrive(replay, BLUE_ATTACKING, -12)
    replay.animate(1000)
    expect(lastAttack(replay)).toMatchObject({
      color: PERSON_COLORS.away.fill,
      team: 1,
      name: 'PSG',
      direction: -1,
      intensity: 1,
      leaving: false,
      playersFade: 1,
      ball: { x: -12, y: 0 },
    })
  })

  it('waits for the attack to reach the other team’s half', () => {
    const replay = ready()
    arrive(replay, BLUE_ATTACKING, 12)
    replay.animate(100)
    expect(lastAttack(replay)).toBeUndefined()
    arrive(replay, BLUE_ATTACKING, 5)
    replay.animate(100)
    expect(lastAttack(replay)).toBeUndefined()
    arrive(replay, BLUE_ATTACKING, -2)
    replay.animate(100)
    expect(lastAttack(replay)?.ball).toEqual({ x: -2, y: 0 })
  })

  it('shows nothing while nobody is attacking, or with no direction to attack in', () => {
    const replay = ready()
    arrive(replay, NOBODY, -12)
    arrive(replay, { ...BLUE_ATTACKING, attacks: { 0: null, 1: null } }, -14)
    replay.animate(500)
    expect(lastAttack(replay)).toBeUndefined()
  })

  it('sweeps in, fades the players out, holds, then fades out onto play as it is', () => {
    const replay = ready()
    arrive(replay, BLUE_ATTACKING, -12)
    replay.animate(150)
    const early = lastAttack(replay)!
    expect(early.intensity).toBeGreaterThan(0)
    expect(early.intensity).toBeLessThan(0.5)
    expect(early.playersFade).toBe(0)
    replay.animate(300)
    const later = lastAttack(replay)!
    expect(later.playersFade).toBeGreaterThan(0)
    expect(later.playersFade).toBeLessThan(1)
    replay.animate(1300)
    expect(lastAttack(replay)).toMatchObject({ intensity: 1, playersFade: 1, leaving: false })
    replay.animate(400)
    const going = lastAttack(replay)!
    expect(going.leaving).toBe(true)
    expect(going.intensity).toBeGreaterThan(0)
    expect(going.intensity).toBeLessThan(1)
    expect(going.playersFade).toBe(going.intensity)
    replay.animate(400)
    expect(lastAttack(replay)).toBeUndefined()
  })

  // Play carries on underneath: only the ball, and its trail, stay put.
  it('holds the ball and its trail where they were while play carries on', () => {
    const replay = ready()
    const trail: BallTrail = {
      runs: [
        [
          { x: -5, y: 0, age: 1 },
          { x: -12, y: 0, age: 0 },
        ],
      ],
      turns: [],
    }
    replay.set({ time: replay.time + 0.04, frame: frameAt(-12), phase: BLUE_ATTACKING, trail })
    const later: BallTrail = {
      runs: [
        [
          { x: -12, y: 0, age: 1 },
          { x: -30, y: 0, age: 0 },
        ],
      ],
      turns: [],
    }
    replay.set({ time: replay.time + 0.04, frame: frameAt(-30), phase: BLUE_ATTACKING, trail: later })
    replay.animate(500)
    expect(replay.time).toBeGreaterThan(10.07)
    expect(lastAttack(replay)!.ball).toEqual({ x: -12, y: 0 })
    expect(replay.last()?.trail).toEqual(trail)
  })

  it('pulses the ball’s border while it shows', () => {
    const replay = ready()
    arrive(replay, BLUE_ATTACKING, -12)
    replay.animate(100)
    const a = lastAttack(replay)!.pulse!
    replay.animate(200)
    expect(lastAttack(replay)!.pulse).not.toBeCloseTo(a, 3)
  })

  it('shows each attack once', () => {
    const replay = ready()
    arrive(replay, BLUE_ATTACKING, -12)
    replay.animate(3000)
    expect(lastAttack(replay)).toBeUndefined()
    arrive(replay, { ...BLUE_ATTACKING }, -20)
    replay.animate(100)
    expect(lastAttack(replay)).toBeUndefined()
    // Over, and a new one: shown again.
    arrive(replay, NOBODY, -20)
    arrive(replay, BLUE_ATTACKING, -22)
    replay.animate(100)
    expect(lastAttack(replay)).toBeDefined()
  })

  // A frame looked at shows the data as it is.
  it('is not shown for an attack a seek lands in the middle of', () => {
    const replay = ready()
    arrive(replay, BLUE_ATTACKING, -12, 30)
    arrive(replay, { ...BLUE_ATTACKING }, -14)
    replay.animate(300)
    expect(lastAttack(replay)).toBeUndefined()
  })

  it('stops at once on a pause', () => {
    const replay = ready()
    arrive(replay, BLUE_ATTACKING, -12)
    replay.animate(500)
    replay.pause()
    expect(lastAttack(replay)).toBeUndefined()
  })

  it('stops at once on a seek', () => {
    const replay = ready()
    arrive(replay, BLUE_ATTACKING, -12)
    replay.animate(500)
    replay.set({ time: 60 })
    expect(lastAttack(replay)).toBeUndefined()
  })

  it('shows nothing while the layer is off, and stops when it is turned off', () => {
    const replay = ready()
    arrive(replay, BLUE_ATTACKING, -12)
    replay.animate(500)
    expect(lastAttack(replay)).toBeDefined()
    replay.toggle({ attack: false })
    expect(lastAttack(replay)).toBeUndefined()
    arrive(replay, NOBODY, -12)
    arrive(replay, BLUE_ATTACKING, -14)
    replay.animate(300)
    expect(lastAttack(replay)).toBeUndefined()
  })

  it('shows at once, without moving, under reduced motion', () => {
    const replay = ready(undefined, true)
    arrive(replay, BLUE_ATTACKING, -12)
    replay.animate(100)
    expect(lastAttack(replay)).toMatchObject({ intensity: 1, playersFade: 1 })
    expect(lastAttack(replay)!.pulse).toBeUndefined()
    replay.animate(2000)
    expect(lastAttack(replay)).toBeUndefined()
  })

  // Beyond the reference's cases.
  it('holds the ball’s spin as it was when the attack was shown', () => {
    const replay = ready()
    arrive(replay, BLUE_ATTACKING, -12)
    const shown = replay.last()!.ballSpin
    arrive(replay, BLUE_ATTACKING, -13)
    arrive(replay, BLUE_ATTACKING, -14)
    expect(replay.last()!.ballSpin).toEqual(shown)
    replay.animate(3000)
    // Over: the ball is drawn as it has rolled underneath.
    expect(replay.last()!.ballSpin).not.toEqual(shown)
  })

  it('names the team as the options name it when it is painted, and colours it as they did when it started', () => {
    const replay = ready(['Ajax', 'PSV'])
    arrive(replay, BLUE_ATTACKING, -12)
    replay.animate(100)
    replay.director.setOptions({ teamName: () => 'Renamed', teamColor: () => '#00ff00' })
    replay.animate(100)
    expect(lastAttack(replay)).toMatchObject({ name: 'Renamed', color: PERSON_COLORS.away.fill })
  })
})
