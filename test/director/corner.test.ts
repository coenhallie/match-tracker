import { describe, it, expect } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import type { Frame } from '../../src/model/types'
import { CORNER_DEMO_MS, CORNER_REARM_S, CORNER_SHOW_MS, CORNER_SECTION_METRES } from '../../src/render/corner'
import { FakeReplay } from './harness'

// The corner is the widget's own: the reference has none. Built on the reference's free kick, which the
// widget no longer shows, so its cases follow that one's (pipelineOutputSurface.test.ts :1159-1544), with
// what is its own: which corner, and the cone. Whole animation frames, as there.

/** A record: someone at `x`, the ball at `ball` unless it is lost, and the labels it carries. */
const frameAt = (x: number, labels: string[] = [], ball: { x: number; y: number } | null = { x: 48, y: 30 }): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [
      {
        team_id: 0,
        players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x, y: 2 } }],
      },
    ],
    balls: ball ? [{ projected_coordinates: ball }] : [],
    state: { actions: labels.map((action_type) => ({ action_type })) },
    frame_data: [{ frame_count: 1 }],
  }) as Frame
const CORNER = ['EventType.CORNER_KICK']
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
  record(
    labels: string[] = [],
    { still = false, ball = { x: 48, y: 30 } as { x: number; y: number } | null, phase = NOBODY } = {},
  ) {
    if (!still) this.x += 0.1
    return this.replay.set({ time: this.replay.time + 0.04, frame: frameAt(this.x, labels, ball), phase })
  }

  animate(ms: number) {
    return this.replay.animate(ms, true)
  }

  corner() {
    return this.replay.last()?.corner
  }
}

describe('corner', () => {
  it('fades in on a corner label, fading the players, the ball and its trail out with it', () => {
    const pitch = new Pitch()
    pitch.record(CORNER)
    pitch.animate(150)
    const early = pitch.corner()!
    expect(early.intensity).toBeGreaterThan(0)
    expect(early.intensity).toBeLessThan(1)
    expect(early.playersFade).toBe(early.intensity)
    expect(early.ballFade).toBe(early.intensity)
    pitch.animate(400)
    expect(pitch.corner()).toMatchObject({ intensity: 1, playersFade: 1, ballFade: 1 })
  })

  it('matches the label however the export writes it', () => {
    for (const label of ['Corner', 'Corner kick', 'EventType.CORNER_KICK', 'EventType.CORNER']) {
      const pitch = new Pitch()
      pitch.record([label])
      pitch.animate(100)
      expect({ label, shown: pitch.corner() !== undefined }).toEqual({ label, shown: true })
    }
  })

  it('lights up the corner nearest the ball', () => {
    const cases = [
      [{ x: 50, y: 32 }, { x: 1, y: 1 }],
      [{ x: 50, y: -32 }, { x: 1, y: -1 }],
      [{ x: -50, y: 32 }, { x: -1, y: 1 }],
      [{ x: -50, y: -32 }, { x: -1, y: -1 }],
    ] as const
    for (const [ball, corner] of cases) {
      const pitch = new Pitch()
      pitch.record(CORNER, { ball })
      pitch.animate(100)
      expect(pitch.corner()!.corner).toEqual(corner)
    }
  })

  it('goes by the ball last tracked when the label comes with it lost, and by none when that is too old', () => {
    const pitch = new Pitch()
    pitch.record([], { ball: { x: -50, y: 30 } })
    pitch.record(CORNER, { ball: null })
    pitch.animate(100)
    expect(pitch.corner()!.corner).toEqual({ x: -1, y: 1 })

    const stale = new Pitch()
    stale.record([], { ball: { x: -50, y: 30 } })
    for (let i = 0; i < 130; i++) stale.record([], { ball: null })
    stale.record(CORNER, { ball: null })
    stale.animate(100)
    // The card alone: no corner to light.
    expect(stale.corner()).toMatchObject({ corner: null })
  })

  it('lights its sections one after another from the flag out', () => {
    const pitch = new Pitch()
    pitch.record(CORNER)
    pitch.animate(100)
    const [inner, middle, outer] = pitch.corner()!.sections
    expect(pitch.corner()!.sections).toHaveLength(CORNER_SECTION_METRES.length)
    expect(inner).toBeGreaterThan(0)
    expect(middle).toBe(0)
    expect(outer).toBe(0)
    pitch.animate(600)
    for (const k of pitch.corner()!.sections) expect(k).toBeGreaterThan(0)
  })

  it('stays while play is stopped, and goes after CORNER_SHOW_MS once play carries on', () => {
    const pitch = new Pitch()
    pitch.record(CORNER)
    // Off camera: everyone where they were.
    for (let i = 0; i < 70; i++) {
      pitch.record([], { still: true })
      pitch.animate(50)
    }
    expect(pitch.corner()).toMatchObject({ intensity: 1 })
    for (let i = 0; i < 4; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.corner()!.intensity).toBeLessThan(1)
    pitch.animate(500)
    expect(pitch.corner()).toBeUndefined()
  })

  it('goes after CORNER_SHOW_MS when play carries on from the start', () => {
    const pitch = new Pitch()
    pitch.record(CORNER)
    for (let i = 0; i < CORNER_SHOW_MS / 50 - 2; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.corner()).toMatchObject({ intensity: 1 })
    for (let i = 0; i < 20; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.corner()).toBeUndefined()
  })

  it('is shown once while its label flickers', () => {
    const pitch = new Pitch()
    pitch.record(CORNER)
    for (let i = 0; i < 60; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.corner()).toBeUndefined()
    pitch.record(CORNER)
    pitch.animate(100)
    expect(pitch.corner()).toBeUndefined()
  })

  it('is not shown again when its label comes back within CORNER_REARM_S, as it does as the corner is taken', () => {
    const pitch = new Pitch()
    pitch.record(CORNER)
    // Gone, and the label off for 9 s, as within one corner in the February export.
    for (let i = 0; i < 225; i++) {
      pitch.record()
      pitch.animate(20)
    }
    expect(pitch.corner()).toBeUndefined()
    pitch.record(CORNER)
    pitch.animate(100)
    expect(pitch.corner()).toBeUndefined()
    // Off for longer than that: another corner.
    for (let i = 0; i < CORNER_REARM_S / 0.04 + 1; i++) pitch.record()
    pitch.record(CORNER)
    pitch.animate(100)
    expect(pitch.corner()).toBeDefined()
  })

  it('is not shown with its layer off, and ends when the layer is switched off', () => {
    const off = new Pitch()
    off.replay.toggle({ corner: false })
    off.record(CORNER)
    off.animate(300)
    expect(off.corner()).toBeUndefined()

    const on = new Pitch()
    on.record(CORNER)
    on.animate(300)
    expect(on.corner()).toBeDefined()
    on.replay.toggle({ corner: false })
    expect(on.corner()).toBeUndefined()
  })

  it('is not shown on a corner a seek lands in', () => {
    const pitch = new Pitch()
    pitch.replay.set({ time: 60, frame: frameAt(0, CORNER) })
    pitch.animate(300)
    expect(pitch.corner()).toBeUndefined()
    pitch.record(CORNER)
    pitch.animate(300)
    expect(pitch.corner()).toBeUndefined()
  })

  it('ends on a pause, as every moment does', () => {
    const pitch = new Pitch()
    pitch.record(CORNER)
    pitch.animate(300)
    pitch.replay.pause()
    expect(pitch.corner()).toBeUndefined()
  })

  it('shows still and whole under reduced motion, and goes without a fade', () => {
    const pitch = new Pitch(true)
    pitch.record(CORNER)
    pitch.animate(20)
    expect(pitch.corner()).toMatchObject({ intensity: 1, playersFade: 1, sections: [1, 1, 1] })
    for (let i = 0; i < CORNER_SHOW_MS / 50 + 2; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.corner()).toBeUndefined()
  })

  describe('with the other moments', () => {
    // Blue attacks the left goal: the ball in that half.
    const LEFT = { x: -48, y: 30 }

    it('takes over from a throw-in and an attack', () => {
      const pitch = new Pitch()
      pitch.record(['Throw in'], { phase: BLUE_ATTACKING, ball: LEFT })
      pitch.animate(100)
      expect(pitch.replay.last()!.throwIn).toBeDefined()
      expect(pitch.replay.last()!.attack).toBeDefined()
      pitch.record(CORNER, { phase: BLUE_ATTACKING, ball: LEFT })
      pitch.animate(100)
      const last = pitch.replay.last()!
      expect(last.corner).toBeDefined()
      expect(last.throwIn).toBeUndefined()
      expect(last.attack).toBeUndefined()
    })

    it('holds back a throw-in and an attack while it shows', () => {
      const pitch = new Pitch()
      pitch.record(CORNER, { ball: LEFT })
      pitch.animate(100)
      pitch.record(['Throw in'], { phase: BLUE_ATTACKING, ball: LEFT })
      pitch.animate(100)
      const last = pitch.replay.last()!
      expect(last.corner).toBeDefined()
      expect(last.throwIn).toBeUndefined()
      expect(last.attack).toBeUndefined()
    })

    // The widget no longer shows the free kick: its label changes nothing.
    it('leaves a free kick label alone, showing or not', () => {
      const kick = new Pitch()
      kick.record(['Free kick'])
      kick.animate(100)
      expect(kick.replay.last()).not.toHaveProperty('freeKick')
      kick.record(CORNER)
      kick.animate(100)
      expect(kick.replay.last()!.corner).toBeDefined()
      kick.record(['Free kick'])
      kick.animate(100)
      expect(kick.replay.last()!.corner).toBeDefined()
    })

    it('gives way to a goal', () => {
      const pitch = new Pitch()
      pitch.record(CORNER)
      pitch.animate(100)
      pitch.record(['GOAL'])
      pitch.animate(100)
      const last = pitch.replay.last()!
      expect(last.corner).toBeUndefined()
      expect(last.goal ?? last.goalBanner).toBeDefined()
    })
  })
})

describe('corner played by hand', () => {
  const ready = (ball: { x: number; y: number } | null = { x: -40, y: -20 }) => {
    const replay = new FakeReplay()
    replay.set({ time: 10, frame: frameAt(0, [], ball), phase: NOBODY })
    return replay
  }

  it('plays with its layer off and no label, even paused, at the corner nearest the ball', () => {
    const replay = ready()
    replay.toggle({ corner: false })
    expect(replay.director.availability().corner).toBe(true)
    replay.trigger('corner')
    replay.animate(600, true)
    expect(replay.last()!.corner).toMatchObject({ intensity: 1, corner: { x: -1, y: -1 } })
  })

  it('shows the card alone with no ball to go by', () => {
    const replay = ready(null)
    replay.trigger('corner')
    replay.animate(600, true)
    expect(replay.last()!.corner).toMatchObject({ intensity: 1, corner: null })
  })

  it('is on screen for CORNER_DEMO_MS, whatever play does, then fades out', () => {
    const replay = ready()
    replay.play()
    replay.trigger('corner')
    // The ball is lost and nobody moves: a corner off its label would hold.
    for (let i = 0; i < 70; i++) {
      replay.set({ time: replay.time + 0.04, frame: frameAt(0, [], null) })
      replay.animate(50, true)
    }
    expect(replay.last()!.corner).toMatchObject({ intensity: 1 })
    replay.animate(300, true)
    const going = replay.last()!.corner!
    expect(going.intensity).toBeGreaterThan(0)
    expect(going.intensity).toBeLessThan(1)
    replay.animate(CORNER_DEMO_MS - 3500 - 250, true)
    expect(replay.last()!.corner).toBeUndefined()
  })

  it('is ended by a seek, as the others are', () => {
    const replay = ready()
    replay.trigger('corner')
    replay.animate(300, true)
    replay.set({ time: 60 })
    expect(replay.last()!.corner).toBeUndefined()
  })
})
