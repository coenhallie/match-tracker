import { describe, it, expect } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import type { Frame, FrameAction } from '../../src/model/types'
import { CORNER_DEMO_MS, CORNER_REARM_S, CORNER_SECTION_METRES, CORNER_SHOW_MS } from '../../src/render/corner'
import { FakeReplay } from './harness'

// The free kick is the widget's own (CHANGELOG 0.20.0), built on the corner's timing and fade: its cases
// follow the corner's (corner.test.ts), with what is its own, where the ball was and the team.

/** A human's label: its name, or the label as a whole, a team on it say. */
type Label = string | FrameAction

/** A record: someone at `x`, the ball at `ball` unless it is lost, and the labels it carries. */
const frameAt = (x: number, labels: Label[] = [], ball: { x: number; y: number } | null = { x: 30, y: 12 }): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [
      {
        team_id: 0,
        players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x, y: 2 } }],
      },
    ],
    balls: ball ? [{ projected_coordinates: ball }] : [],
    state: {
      actions: labels.map((label) =>
        typeof label === 'string' ? { action_type: label, action_origin: 'human' } : { action_origin: 'human', ...label },
      ),
    },
    frame_data: [{ frame_count: 1 }],
  }) as Frame
const FREE_KICK = ['Freekick']
const NOBODY: TeamPhase = { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }
const BLUE_ATTACKING: TeamPhase = {
  possession: 1,
  attacks: { 0: 1, 1: -1 },
  states: { 0: 'defending', 1: 'attacking' },
}

type Ball = { x: number; y: number } | null

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
  record(labels: Label[] = [], { still = false, ball = { x: 30, y: 12 } as Ball, phase = NOBODY, turned = undefined as true | undefined } = {}) {
    if (!still) this.x += 0.1
    return this.replay.set({ time: this.replay.time + 0.04, frame: frameAt(this.x, labels, ball), phase, turned })
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
    expect(early.ballFade).toBe(early.intensity)
    pitch.animate(400)
    expect(pitch.freeKick()).toMatchObject({ intensity: 1, playersFade: 1, ballFade: 1 })
  })

  it('matches the label however it is written, from a human only', () => {
    for (const label of ['Freekick', 'Free kick', 'Free Kick', 'FREE_KICK', 'EventType.FREE_KICK']) {
      const pitch = new Pitch()
      pitch.record([label])
      pitch.animate(100)
      expect({ label, shown: pitch.freeKick() !== undefined }).toEqual({ label, shown: true })
    }
    for (const label of [{ action_type: 'Free kick', action_origin: 'ai' }, 'Free kick taken quickly', 'Indirect free kick']) {
      const pitch = new Pitch()
      pitch.record([label])
      pitch.animate(100)
      expect({ label, shown: pitch.freeKick() !== undefined }).toEqual({ label, shown: false })
    }
  })

  it('marks where the ball was as the label came, and keeps it there as the ball moves', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK, { ball: { x: 20, y: -9 } })
    pitch.animate(100)
    expect(pitch.freeKick()!.ball).toEqual({ x: 20, y: -9 })
    pitch.record([], { ball: { x: -5, y: 3 } })
    pitch.animate(100)
    expect(pitch.freeKick()!.ball).toEqual({ x: 20, y: -9 })
  })

  it('goes by the last ball tracked within 5 s when the labelled record has none, as the throw-in does', () => {
    const recent = new Pitch()
    recent.record([], { ball: { x: -30, y: 4 } })
    for (let i = 0; i < 50; i++) recent.record([], { ball: null })
    recent.record(FREE_KICK, { ball: null })
    recent.animate(100)
    expect(recent.freeKick()!.ball).toEqual({ x: -30, y: 4 })

    // Lost for longer than that: the card alone, across the middle.
    const stale = new Pitch()
    stale.record([], { ball: { x: -30, y: 4 } })
    for (let i = 0; i < 5 / 0.04 + 5; i++) stale.record([], { ball: null })
    stale.record(FREE_KICK, { ball: null })
    stale.animate(100)
    expect(stale.freeKick()).toMatchObject({ ball: null })
  })

  it('marks the ball as the pitch is shown in the second half, turned round', () => {
    const pitch = new Pitch()
    // The harness gives the shown frame as it is: the second half's turning is SecondHalf's, upstream.
    pitch.record(FREE_KICK, { ball: { x: -25, y: 10 }, turned: true })
    pitch.animate(100)
    expect(pitch.freeKick()!.ball).toEqual({ x: -25, y: 10 })
  })

  it('names the team taking it, as the host names it, when its label says which', () => {
    for (const [team_id, team] of [[0, 'Red'], [1, 'Blue']] as const) {
      const pitch = new Pitch()
      pitch.record([{ action_type: 'Freekick', team_id }])
      pitch.animate(100)
      expect(pitch.freeKick()).toMatchObject({ team })
    }
    for (const labels of [FREE_KICK, [{ action_type: 'Freekick', team_id: -1 }]]) {
      const pitch = new Pitch()
      pitch.record(labels)
      pitch.animate(100)
      expect(pitch.freeKick()!.team).toBeNull()
    }
  })

  it('lights its pulse ring by ring from the middle out', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    pitch.animate(100)
    const [inner, middle, outer] = pitch.freeKick()!.rings
    expect(pitch.freeKick()!.rings).toHaveLength(CORNER_SECTION_METRES.length)
    expect(inner).toBeGreaterThan(0)
    expect(middle).toBe(0)
    expect(outer).toBe(0)
    pitch.animate(600)
    for (const k of pitch.freeKick()!.rings) expect(k).toBeGreaterThan(0)
  })

  it('stays while play is stopped, and goes after CORNER_SHOW_MS once play carries on', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    for (let i = 0; i < 70; i++) {
      pitch.record([], { still: true })
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
    for (let i = 0; i < 4; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.freeKick()!.intensity).toBeLessThan(1)
    pitch.animate(500)
    expect(pitch.freeKick()).toBeUndefined()
  })

  it('goes after CORNER_SHOW_MS when play carries on from the start', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    for (let i = 0; i < CORNER_SHOW_MS / 50 - 2; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toMatchObject({ intensity: 1 })
    for (let i = 0; i < 20; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toBeUndefined()
  })

  it('is not shown again when its label comes back within CORNER_REARM_S', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    for (let i = 0; i < 225; i++) {
      pitch.record()
      pitch.animate(20)
    }
    expect(pitch.freeKick()).toBeUndefined()
    pitch.record(FREE_KICK)
    pitch.animate(100)
    expect(pitch.freeKick()).toBeUndefined()
    for (let i = 0; i < CORNER_REARM_S / 0.04 + 1; i++) pitch.record()
    pitch.record(FREE_KICK)
    pitch.animate(100)
    expect(pitch.freeKick()).toBeDefined()
  })

  it('is not shown with its layer off, and ends when the layer is switched off', () => {
    const off = new Pitch()
    off.replay.toggle({ freeKickBanner: false })
    off.record(FREE_KICK)
    off.animate(300)
    expect(off.freeKick()).toBeUndefined()

    const on = new Pitch()
    on.record(FREE_KICK)
    on.animate(300)
    expect(on.freeKick()).toBeDefined()
    on.replay.toggle({ freeKickBanner: false })
    expect(on.freeKick()).toBeUndefined()
  })

  it('is not shown on a free kick a seek lands in', () => {
    const pitch = new Pitch()
    pitch.replay.set({ time: 60, frame: frameAt(0, FREE_KICK) })
    pitch.animate(300)
    expect(pitch.freeKick()).toBeUndefined()
    pitch.record(FREE_KICK)
    pitch.animate(300)
    expect(pitch.freeKick()).toBeUndefined()
  })

  it('ends on a pause, as every moment does', () => {
    const pitch = new Pitch()
    pitch.record(FREE_KICK)
    pitch.animate(300)
    pitch.replay.pause()
    expect(pitch.freeKick()).toBeUndefined()
  })

  it('shows still and whole under reduced motion, and goes without a fade', () => {
    const pitch = new Pitch(true)
    pitch.record(FREE_KICK)
    pitch.animate(16)
    expect(pitch.freeKick()).toMatchObject({ intensity: 1, rings: [1, 1, 1] })
    for (let i = 0; i < CORNER_SHOW_MS / 50 + 2; i++) {
      pitch.record()
      pitch.animate(50)
    }
    expect(pitch.freeKick()).toBeUndefined()
  })

  describe('with the other moments', () => {
    it('takes over from a throw-in and an attack, and holds them back while it shows', () => {
      const pitch = new Pitch()
      pitch.record(['Throw in'], { phase: BLUE_ATTACKING, ball: { x: -30, y: 12 } })
      pitch.animate(300)
      expect(pitch.replay.last()!.throwIn).toBeDefined()
      pitch.record(FREE_KICK, { phase: BLUE_ATTACKING, ball: { x: -30, y: 12 } })
      pitch.animate(100)
      const last = pitch.replay.last()!
      expect(last.freeKick).toBeDefined()
      expect(last.throwIn).toBeUndefined()
      expect(last.attack).toBeUndefined()
      pitch.record(['Throw in'], { phase: BLUE_ATTACKING, ball: { x: -30, y: 12 } })
      pitch.animate(100)
      expect(pitch.replay.last()!.throwIn).toBeUndefined()
    })

    it('takes over from a centre card, and holds one back while it shows', () => {
      const pitch = new Pitch()
      pitch.record(['VAR check'])
      pitch.animate(300)
      expect(pitch.replay.last()!.labelCard?.key).toBe('varCheck')
      pitch.record(FREE_KICK)
      pitch.animate(500)
      expect(pitch.replay.last()!.freeKick).toBeDefined()
      expect(pitch.replay.last()!.labelCard).toBeUndefined()
      pitch.record(['Goal disallowed'])
      pitch.animate(100)
      expect(pitch.replay.last()!.labelCard).toBeUndefined()
    })

    it('gives way to a goal', () => {
      const pitch = new Pitch()
      pitch.record(FREE_KICK)
      pitch.animate(300)
      pitch.record(['Goal'], { ball: { x: 50, y: 0 } })
      pitch.animate(100)
      expect(pitch.freeKick()).toBeUndefined()
    })
  })
})

describe('free kick played by hand', () => {
  const ready = (ball: Ball = { x: -40, y: -20 }, labels: Label[] = []) => {
    const replay = new FakeReplay()
    replay.set({ time: 10, frame: frameAt(0, labels, ball), phase: NOBODY })
    return replay
  }

  it('plays with its layer off and no label, even paused, at the ball on screen', () => {
    const replay = ready()
    replay.toggle({ freeKickBanner: false })
    expect(replay.director.availability().freeKick).toBe(true)
    replay.trigger('freeKick')
    replay.animate(600, true)
    expect(replay.last()!.freeKick).toMatchObject({ intensity: 1, ball: { x: -40, y: -20 } })
  })

  it('shows the card alone with no ball on screen', () => {
    const replay = ready(null)
    replay.trigger('freeKick')
    replay.animate(600, true)
    expect(replay.last()!.freeKick).toMatchObject({ intensity: 1, ball: null })
  })

  it('names the team the label on screen gives, else the team it was played for', () => {
    const labelled = ready(undefined, [{ action_type: 'Freekick', team_id: 1 }])
    labelled.trigger('freeKick', 0)
    labelled.animate(600, true)
    expect(labelled.last()!.freeKick).toMatchObject({ team: 'Blue' })
    for (const [team, name] of [[0, 'Red'], [1, 'Blue']] as const) {
      const bare = ready()
      bare.trigger('freeKick', team)
      bare.animate(600, true)
      expect(bare.last()!.freeKick).toMatchObject({ team: name })
    }
  })

  it('is on screen for CORNER_DEMO_MS, whatever play does, then fades out', () => {
    const replay = ready()
    replay.play()
    replay.trigger('freeKick')
    for (let i = 0; i < 70; i++) {
      replay.set({ time: replay.time + 0.04, frame: frameAt(0, [], null) })
      replay.animate(50, true)
    }
    expect(replay.last()!.freeKick).toMatchObject({ intensity: 1 })
    replay.animate(300, true)
    const going = replay.last()!.freeKick!
    expect(going.intensity).toBeGreaterThan(0)
    expect(going.intensity).toBeLessThan(1)
    replay.animate(CORNER_DEMO_MS - 3500 - 250, true)
    expect(replay.last()!.freeKick).toBeUndefined()
  })

  it('is ended by a seek, as the others are', () => {
    const replay = ready()
    replay.trigger('freeKick')
    replay.animate(300, true)
    replay.set({ time: 60 })
    expect(replay.last()!.freeKick).toBeUndefined()
  })
})
