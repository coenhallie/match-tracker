import { describe, it, expect } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import { MERGE_GAP_S, MIN_STRETCH_S } from '../../src/director/playerLoss'
import type { Frame, RecordValidity } from '../../src/model/types'
import { ATTACK_OUT_MS } from '../../src/render/attackIndicator'
import { FakeReplay } from './harness'

// The attack over invalid frames: in live mode, while the pipeline's camera is away. The widget's own, as the
// attack over a player loss is. Records come every 40 ms with their animation frames, as in playerLoss.test.ts;
// what an invalid record holds is the last valid one's positions (LiveHistory.shown), so its frame is a full
// one here.

/** 22 players, half a team each, the ball at `ball`, and human labels. */
const frameWith = (ball: { x: number; y: number }, labels: string[] = []): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [0, 1].map((team) => ({
      team_id: team,
      players: Array.from({ length: 11 }, (_, i) => ({
        track_id: team * 100 + i,
        person_type: 'PersonType.PLAYER',
        projected_coordinates: { x: (team === 0 ? -1 : 1) * (5 + i * 3), y: -20 + i * 4 },
      })),
    })),
    balls: [{ projected_coordinates: ball }],
    state: { actions: labels.map((action_type) => ({ action_type, action_origin: 'human' })) },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

/** Team 0 attacks towards -x, team 1 towards +x; nobody in possession, nobody attacking. */
const ENDS: TeamPhase = { possession: null, attacks: { 0: -1, 1: 1 }, states: { 0: null, 1: null } }
const UNKNOWN: TeamPhase = { possession: null, attacks: { 0: null, 1: null }, states: { 0: null, 1: null } }
const STEP_S = 0.04
const recordsFor = (seconds: number) => Math.ceil(seconds / STEP_S - 1e-9)

const valid = (nextInvalidInS: number | null = null): RecordValidity => ({ invalid: false, nextInvalidInS, nextValidInS: 0 })
const invalid = (nextValidInS: number | null = 5): RecordValidity => ({ invalid: true, nextInvalidInS: 0, nextValidInS })

/** A live pitch, played on record by record, with the attack over lost players and invalid frames on. */
class Pitch {
  readonly replay: FakeReplay
  ball = { x: 0, y: 0 }

  constructor({ live = true, layer = true, reducedMotion = false, phase = ENDS } = {}) {
    this.replay = new FakeReplay({ playerLoss: layer }, { coverInvalidFrames: live })
    this.replay.reducedMotion = reducedMotion
    this.replay.set({ time: 10, frame: frameWith(this.ball), phase, validity: valid() })
    this.replay.play()
  }

  /** The next record, the ball moved on by `dx` metres, then its 40 ms of animation frames. */
  record(validity: RecordValidity | undefined, { dx = 0, phase = ENDS, labels = [] as string[] } = {}) {
    this.ball = { x: this.ball.x + dx, y: this.ball.y }
    this.replay.set({ time: this.replay.time + STEP_S, frame: frameWith(this.ball, labels), phase, validity })
    return this.replay.animate(STEP_S * 1000, true)
  }

  records(n: number, validity: RecordValidity | undefined, options: Parameters<Pitch['record']>[1] = {}) {
    for (let i = 0; i < n; i++) this.record(validity, options)
  }


  attack() {
    return this.replay.last()?.attack
  }

  loss() {
    return this.replay.director.loss()
  }
}

describe('attack over invalid frames', () => {
  it('starts on the first invalid record, not on the warning before it', () => {
    const pitch = new Pitch()
    for (let n = recordsFor(2); n >= 1; n--) pitch.record(valid(n * STEP_S), { dx: 0.3 })
    expect(pitch.replay.outputs.some((o) => o.layers?.attack)).toBe(false)
    pitch.record(invalid(), { dx: 0.3 })
    expect(pitch.attack()).toMatchObject({ team: 1, direction: 1 })
  })

  it('leaves a stretch shorter than MIN_STRETCH_S uncovered, and the badge says why', () => {
    expect(MIN_STRETCH_S).toBe(1)
    const pitch = new Pitch()
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    for (let n = recordsFor(0.96); n >= 1; n--) {
      pitch.record(invalid(n * STEP_S))
      expect(pitch.attack()).toBeUndefined()
    }
    expect(pitch.loss()).toEqual({ cause: 'invalidFrames', players: 22, cover: null, validInS: STEP_S, short: true })
    pitch.records(recordsFor(1), valid())
    expect(pitch.replay.outputs.some((o) => o.layers?.attack)).toBe(false)
  })

  it('covers a stretch of MIN_STRETCH_S or more, or of a length it is not told', () => {
    const exactly = new Pitch()
    exactly.records(recordsFor(1), valid(), { dx: 0.3 })
    exactly.record(invalid(MIN_STRETCH_S))
    expect(exactly.attack()).toMatchObject({ team: 1 })

    const untold = new Pitch()
    untold.records(recordsFor(1), valid(), { dx: 0.3 })
    untold.record(invalid(null))
    expect(untold.attack()).toMatchObject({ team: 1 })
  })

  it('starts at once on an invalid record that came without warning', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    pitch.record(invalid(), { dx: 0.3 })
    expect(pitch.attack()).toMatchObject({ team: 1 })
  })

  it('goes by the ball’s heading, then the team that last had the ball, then the half the ball is in', () => {
    const heading = new Pitch()
    heading.ball = { x: 20, y: 0 }
    heading.records(recordsFor(1), valid(), { dx: -0.3 })
    heading.record(invalid())
    expect(heading.attack()).toMatchObject({ team: 0, direction: -1 })

    const possession = new Pitch()
    possession.ball = { x: 20, y: 0 }
    possession.records(recordsFor(1), valid(), { phase: { ...ENDS, possession: 0 } })
    possession.record(invalid(), { phase: { ...ENDS, possession: 0 } })
    expect(possession.attack()).toMatchObject({ team: 0 })

    const half = new Pitch()
    half.ball = { x: 20, y: 0 }
    half.records(recordsFor(1), valid())
    half.record(invalid())
    expect(half.attack()).toMatchObject({ team: 1, direction: 1 })

    const otherHalf = new Pitch()
    otherHalf.ball = { x: -20, y: 0 }
    otherHalf.records(recordsFor(1), valid())
    otherHalf.record(invalid())
    expect(otherHalf.attack()).toMatchObject({ team: 0, direction: -1 })
  })

  it('shows nothing while no way of attacking is known, and the badge says so', () => {
    const pitch = new Pitch({ phase: UNKNOWN })
    pitch.ball = { x: 20, y: 0 }
    pitch.records(recordsFor(1), valid(), { dx: 0.3, phase: UNKNOWN })
    pitch.records(recordsFor(1), invalid(), { phase: UNKNOWN })
    expect(pitch.attack()).toBeUndefined()
    expect(pitch.loss()).toEqual({ cause: 'invalidFrames', players: 22, cover: null, validInS: 5 })
  })

  it('tells the badge it covers invalid frames, and a regular attack nothing', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    expect(pitch.loss()).toBeNull()
    pitch.records(recordsFor(1), invalid(), { dx: 0.3 })
    expect(pitch.loss()).toEqual({ cause: 'invalidFrames', players: 22, cover: 1, validInS: 5 })

    const regular = new Pitch()
    regular.ball = { x: 20, y: 0 }
    const attacking: TeamPhase = { ...ENDS, possession: 1, states: { 0: 'defending', 1: 'attacking' } }
    regular.records(recordsFor(1), valid(), { dx: 0.3, phase: attacking })
    expect(regular.attack()).toMatchObject({ team: 1 })
    expect(regular.loss()).toBeNull()
  })

  it('tells the badge how long until the frames are valid again, while they are invalid', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    pitch.record({ invalid: true, nextInvalidInS: 0, nextValidInS: 3.2, horizonS: 10 })
    expect(pitch.loss()).toMatchObject({ validInS: 3.2, horizonS: 10 })
    pitch.record({ invalid: true, nextInvalidInS: 0, nextValidInS: null, horizonS: 10 })
    expect(pitch.loss()).toMatchObject({ validInS: null, horizonS: 10 })
    // Valid again, fading out: nothing to count down.
    pitch.record(valid(5))
    expect(pitch.loss()).toEqual({ cause: 'invalidFrames', players: 22, cover: 1 })
  })

  it('stays through a valid gap shorter than MERGE_GAP_S', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    pitch.records(recordsFor(2), invalid())
    const gap = recordsFor(0.24)
    for (let n = gap; n >= 1; n--) pitch.record(valid(n * STEP_S))
    // A short stretch too: it is covered already.
    pitch.records(recordsFor(0.3), invalid(0.3))
    for (let n = gap; n >= 1; n--) pitch.record(valid(n * STEP_S))
    pitch.records(recordsFor(2), invalid())
    expect(MERGE_GAP_S).toBe(1.5)
    expect(pitch.replay.outputs.slice(-recordsFor(2.5) * 3).every((o) => o.layers?.attack?.leaving === false)).toBe(true)
  })

  it('fades out from the first valid record with no stretch due within MERGE_GAP_S', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    pitch.records(recordsFor(2), invalid())
    pitch.record(valid(2.8))
    const going = pitch.attack()!
    expect(going.leaving).toBe(true)
    pitch.records(recordsFor(ATTACK_OUT_MS / 1000), valid(2.8 - STEP_S))
    expect(pitch.attack()).toBeUndefined()
    expect(pitch.loss()).toBeNull()
  })

  it('stays up while a stretch is due within MERGE_GAP_S, and comes back for it', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    pitch.records(recordsFor(1), invalid())
    pitch.record(valid(1))
    expect(pitch.attack()).toMatchObject({ leaving: false })
  })

  it('is off in replay, whatever the records say', () => {
    const pitch = new Pitch({ live: false })
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    pitch.records(recordsFor(2), invalid())
    expect(pitch.attack()).toBeUndefined()
    expect(pitch.loss()).toBeNull()
  })

  it('is not shown with the layer off, while the badge still says why', () => {
    const pitch = new Pitch({ layer: false })
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    pitch.records(recordsFor(1), invalid())
    expect(pitch.attack()).toBeUndefined()
    expect(pitch.loss()).toEqual({ cause: 'invalidFrames', players: 22, cover: null, validInS: 5 })
  })

  it('shows whole under reduced motion, and goes without a fade', () => {
    const pitch = new Pitch({ reducedMotion: true })
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    pitch.record(invalid())
    expect(pitch.attack()).toMatchObject({ intensity: 1, playersFade: 1 })
    pitch.record(valid())
    expect(pitch.attack()).toBeUndefined()
  })

  it('gives way to a goal labelled on an invalid record', () => {
    const pitch = new Pitch()
    pitch.ball = { x: 40, y: 0 }
    pitch.records(recordsFor(1), valid(), { dx: 0.3 })
    pitch.records(recordsFor(1), invalid())
    expect(pitch.attack()).toBeDefined()
    pitch.record(invalid(), { labels: ['GOAL'] })
    expect(pitch.replay.last()!.goal ?? pitch.replay.last()!.goalBanner).toBeDefined()
    expect(pitch.attack()).toBeUndefined()
  })
})
