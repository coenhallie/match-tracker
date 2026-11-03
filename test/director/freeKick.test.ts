import { describe, it, expect } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import type { Frame } from '../../src/model/types'
import { FakeReplay } from './harness'

// The free kick's cases from pipelineOutputSurface.test.ts (:1159-1544), with the surface's fake replay as
// FakeReplay. These blocks run whole animation frames (`animate(ms, true)`), as the reference's do.

/** A record: someone at `x`, the ball unless it is lost, and the labels it carries. */
const frameAt = (x: number, labels: string[] = [], ball = true): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [
      {
        team_id: 0,
        players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x, y: 2 } }],
      },
    ],
    balls: ball ? [{ projected_coordinates: { x: 10, y: 0 } }] : [],
    state: { actions: labels.map((action_type) => ({ action_type })) },
    frame_data: [{ frame_count: 1 }],
  }) as Frame
const FREE_KICK = ['EventType.FREE_KICK']
const NOBODY: TeamPhase = { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }
const BLUE_ATTACKING: TeamPhase = {
  possession: 1,
  attacks: { 0: 1, 1: -1 },
  states: { 0: 'defending', 1: 'attacking' },
}

/** The pitch, with someone at `x`, played on record by record. */
class Pitch {
  readonly replay = new FakeReplay()
  x = 0

  constructor(reducedMotion = false) {
    this.replay.reducedMotion = reducedMotion
    this.replay.set({ time: 10, frame: frameAt(this.x), phase: NOBODY })
    this.replay.play()
  }

  /** The next record by playback, 0.04 s on: play moving, unless `still`, when everyone is where they were. */
  record(labels: string[] = [], { still = false, ball = true, step = 0.04, phase = NOBODY } = {}) {
    if (!still) this.x += 0.1
    return this.replay.set({ time: this.replay.time + step, frame: frameAt(this.x, labels, ball), phase })
  }

  /** Playback with the clock moving on and no new records, as across a gap in the data. */
  tick(step = 0.04) {
    return this.replay.set({ time: this.replay.time + step })
  }

  animate(ms: number) {
    return this.replay.animate(ms, true)
  }

  freeKick() {
    return this.replay.last()?.freeKick
  }
}

describe('free kick', () => {
  it('fades in on a free kick label, fading the players, the ball and its trail out with it', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    pitch.animate(150)
    const early = pitch.freeKick()!
    expect(early.intensity).toBeGreaterThan(0)
    expect(early.intensity).toBeLessThan(1)
    expect(early.playersFade).toBe(early.intensity)
    // Beyond the reference, whose free kick leaves the ball.
    expect(early.ballFade).toBe(early.intensity)
    pitch.animate(400)
    expect(pitch.freeKick()).toMatchObject({ intensity: 1, playersFade: 1, ballFade: 1 })
  })

  it('goes after FREE_KICK_SHOW_MS when play carries on, fading out onto it', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    for (let i = 0; i < 30; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
    for (let i = 0; i < 12; i++) {
      pitch.record()
      pitch.animate(50)
    }
    const going = pitch.freeKick()!
    expect(going.intensity).toBeGreaterThan(0)
    expect(going.intensity).toBeLessThan(1)
    expect(going.playersFade).toBe(going.intensity)
    pitch.record()
    pitch.animate(400)
    expect(pitch.freeKick()).toBeUndefined()
  })

  // Off camera the data repeats everyone's last positions.
  it('stays while the records stand still, and goes once play moves again', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    for (let i = 0; i < 150; i++) {
      pitch.record([], { still: true })
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
    pitch.record()
    pitch.animate(50)
    pitch.record()
    pitch.animate(200)
    expect(pitch.freeKick()!.intensity).toBeLessThan(1)
    pitch.animate(300)
    expect(pitch.freeKick()).toBeUndefined()
  })

  // Or has no records at all: the replay holds the last one.
  it('stays across a gap in the records', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    for (let i = 0; i < 150; i++) {
      pitch.tick()
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
    pitch.record()
    pitch.animate(500)
    expect(pitch.freeKick()).toBeUndefined()
  })

  it('holds when the stop starts during it', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    for (let i = 0; i < 25; i++) {
      pitch.record()
      pitch.animate(50)
    }
    for (let i = 0; i < 100; i++) {
      pitch.record([], { still: true })
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
  })

  it('stays while the label is on, and goes once it is off', () => {
    const pitch = new Pitch()
    for (let i = 0; i < 80; i++) {
      pitch.record(FREE_KICK)
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
    for (let i = 0; i < 25; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toBeUndefined()
  })

  // The broadcast often cuts away just as the label goes, before the records can be seen to stand still.
  it('holds through a stop that starts as the label goes', () => {
    const pitch = new Pitch()
    for (let i = 0; i < 40; i++) {
      pitch.record(FREE_KICK)
      pitch.animate(50)
    }
    for (let i = 0; i < 100; i++) {
      pitch.record([], { still: true })
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
  })

  // The broadcast goes to a close-up, and the ball is lost, before the records stand still.
  it('holds while the ball is lost, and goes once it is back', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    for (let i = 0; i < 80; i++) {
      pitch.record([], { ball: false })
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
    for (let i = 0; i < 12; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toBeUndefined()
  })

  it('arrives on a label shown during the stop, and holds', () => {
    const pitch = new Pitch()
    for (let i = 0; i < 10; i++) pitch.record([], { still: true })
    pitch.record(FREE_KICK, { still: true })
    for (let i = 0; i < 80; i++) {
      pitch.record(FREE_KICK, { still: true })
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
  })

  // The label flickers on and off over a few records around one free kick.
  it('is shown once for a label that flickers, and again for a later free kick', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    for (let i = 0; i < 70; i++) {
      pitch.record(i % 3 === 0 ? FREE_KICK : [])
      pitch.animate(50)
    }
    for (let i = 0; i < 25; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toBeUndefined()
    pitch.record(FREE_KICK)
    pitch.animate(100)
    expect(pitch.freeKick()).toBeUndefined()
    // Off for long enough: a new one.
    for (let i = 0; i < 130; i++) pitch.record()
    pitch.record(FREE_KICK)
    pitch.animate(100)
    expect(pitch.freeKick()).toBeDefined()
  })

  it('is not shown for a free kick a seek lands in the middle of', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK, { step: 30 })
    pitch.record(FREE_KICK)
    pitch.animate(300)
    expect(pitch.freeKick()).toBeUndefined()
  })

  it('is shown after a seek back to before it', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    pitch.animate(100)
    pitch.replay.set({ time: 5 })
    expect(pitch.freeKick()).toBeUndefined()
    pitch.record()
    pitch.record(FREE_KICK)
    pitch.animate(100)
    expect(pitch.freeKick()).toBeDefined()
  })

  it('stops at once on a pause', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    pitch.animate(500)
    pitch.replay.pause()
    expect(pitch.freeKick()).toBeUndefined()
  })

  it('stops at once on a seek', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    pitch.animate(500)
    pitch.replay.set({ time: 60 })
    expect(pitch.freeKick()).toBeUndefined()
  })

  it('takes over from an attack, and holds the next one back', () => {
    const pitch = new Pitch()
    pitch.record([], { phase: BLUE_ATTACKING })
    pitch.replay.set({ frame: { ...frameAt(pitch.x), balls: [{ projected_coordinates: { x: -12, y: 0 } }] } as Frame })
    pitch.animate(100)
    expect(pitch.replay.last()?.attack).toBeDefined()
    pitch.record(FREE_KICK, { phase: BLUE_ATTACKING })
    pitch.animate(100)
    expect(pitch.replay.last()?.attack).toBeUndefined()
    expect(pitch.freeKick()).toBeDefined()
  })

  it('gives way to a goal', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    pitch.animate(500)
    pitch.record(['EventType.GOAL'])
    pitch.animate(100)
    expect(pitch.freeKick()).toBeUndefined()
    expect(pitch.replay.last()?.goal).toBeDefined()
  })

  it('shows nothing while the layer is off, and stops when it is turned off', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    pitch.animate(500)
    expect(pitch.freeKick()).toBeDefined()
    pitch.replay.toggle({ freeKick: false })
    expect(pitch.freeKick()).toBeUndefined()
    for (let i = 0; i < 130; i++) pitch.record()
    pitch.record(FREE_KICK)
    pitch.animate(300)
    expect(pitch.freeKick()).toBeUndefined()
  })

  it('shows at once, without fading, under reduced motion, and still waits for play', () => {
    const pitch = new Pitch(true)
    pitch.record(FREE_KICK)
    pitch.animate(50)
    expect(pitch.freeKick()).toMatchObject({ intensity: 1, playersFade: 1 })
    for (let i = 0; i < 100; i++) {
      pitch.tick()
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
    pitch.record()
    pitch.animate(50)
    expect(pitch.freeKick()).toBeUndefined()
  })

  // Beyond the reference's cases.
  it('stops the attack and then the throw-in, each stop a paint, before it starts', () => {
    const pitch = new Pitch()
    const attacking: TeamPhase = { possession: 0, attacks: { 0: 1, 1: -1 }, states: { 0: 'attacking', 1: 'defending' } }
    pitch.record([], { phase: attacking })
    pitch.record(['EventType.THROW_IN'], { phase: attacking })
    pitch.animate(100)
    expect(pitch.replay.last()?.attack).toBeDefined()
    expect(pitch.replay.last()?.throwIn).toBeDefined()
    const labelled = pitch.record(FREE_KICK, { phase: attacking })
    expect(labelled.paints.map((p) => [p.layers.attack !== undefined, p.layers.throwIn !== undefined])).toEqual([
      [false, true],
      [false, false],
      [false, false],
    ])
    expect(labelled.layers?.freeKick).toBeDefined()
  })

  it('is drawn with the theme’s icon', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    pitch.animate(50)
    expect(pitch.freeKick()).not.toHaveProperty('icon')
  })
})
