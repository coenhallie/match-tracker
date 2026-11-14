import { describe, it, expect } from 'vitest'
import type { Frame, FrameAction } from '../../src/model/types'
import type { MomentContext } from '../../src/director/moment'
import { Penalty } from '../../src/director/penalty'
import { SCORER_WAIT_S } from '../../src/director/goal'
import { DEFAULT_REPLAY_LAYERS } from '../../src/model/replayLayers'
import { LABEL_CARD_IN_MS } from '../../src/render/labelCard'
import {
  PENALTY_CARD_MS,
  PENALTY_HOLD_MS,
  PENALTY_KICK_MS,
  PENALTY_OUT_MS,
  PENALTY_RESULT_IN_MS,
  PENALTY_SCENE_IN_MS,
  PENALTY_WAIT_S,
} from '../../src/render/penalty'
import type { DirectorOptions } from '../../src/director/director'
import type { ReplayLayers } from '../../src/model/replayLayers'
import { FakeReplay } from './harness'

// The penalty is the widget's own: "Penalty" plays its card, then its scene waiting for the kick;
// "Penalty scored" or "Penalty missed" plays the kick (docs/superpowers/specs/2026-11-13-penalty-design.md,
// "How it plays"). The labelling tool names the team (`team_name`); these labels give no side, so the
// name drawn is the label's own.

const human = (action_type: string, team_name?: string): FrameAction =>
  ({ action_type, action_origin: 'human', ...(team_name ? { team_name } : {}) }) as FrameAction

const PENALTY = human('Penalty', 'Team Away')
const SCORED = human('Penalty scored', 'Team Home')
const MISSED = human('Penalty missed', 'Team Home')

/** A record: someone at `x`, the ball near the goal, and the labels it carries. */
const frameAt = (x: number, actions: FrameAction[] = []): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68, goal_width: 7.32 },
    teams: [{ team_id: 0, players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x, y: 2 } }] }],
    balls: [{ projected_coordinates: { x: 30, y: 5 } }],
    state: { actions },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

/** The pitch, playing at 10 s, with someone moving record by record. */
class Pitch {
  readonly replay: FakeReplay
  x = 0

  constructor({ reducedMotion = false, layers = {}, options = {} }: { reducedMotion?: boolean; layers?: Partial<ReplayLayers>; options?: Partial<DirectorOptions> } = {}) {
    this.replay = new FakeReplay(layers, options)
    this.replay.reducedMotion = reducedMotion
    this.replay.set({ time: 10, frame: frameAt(this.x) })
    this.replay.play()
  }

  /** The next record by playback, 0.04 s on. */
  record(labels: FrameAction[] = []) {
    this.x += 0.1
    return this.replay.set({ time: this.replay.time + 0.04, frame: frameAt(this.x, labels) })
  }

  animate(ms: number) {
    return this.replay.animate(ms)
  }

  /** Records for `seconds` of the clock, 25 a second, with frames run alongside. */
  play(seconds: number) {
    for (let i = 0; i < Math.round(seconds * 25); i++) {
      this.record()
      this.animate(40)
    }
  }

  phase() {
    return this.replay.director.penaltyPhase
  }

  penalty() {
    return this.replay.last()?.penalty
  }

  /** The penalty's label, then its first animation frame. */
  start(labels: FrameAction[] = [PENALTY]) {
    this.record(labels)
    this.animate(1)
  }

  /** On, from its first frame, until its scene is in and waiting. */
  toWaiting() {
    this.start()
    this.animate(PENALTY_CARD_MS + PENALTY_SCENE_IN_MS + 100)
  }
}

describe('the penalty', () => {
  it('plays the card, then waits in the scene', () => {
    const pitch = new Pitch()
    pitch.start()
    expect(pitch.phase()).toBe('card')
    expect(pitch.penalty()).toMatchObject({ card: 0, scene: 0, team: 'Team Away', result: null, still: false })
    expect(pitch.replay.outputs.at(-1)!.animating).toBe(true)
    pitch.animate(LABEL_CARD_IN_MS)
    expect(pitch.penalty()).toMatchObject({ card: 1, scene: 0 })
    pitch.animate(PENALTY_CARD_MS + 1 - LABEL_CARD_IN_MS)
    expect(pitch.phase()).toBe('waiting')
    expect(pitch.penalty()!.card).toBe(1)
    expect(pitch.penalty()!.scene).toBeGreaterThan(0)
    expect(pitch.penalty()!.scene).toBeLessThan(1)
    pitch.animate(PENALTY_SCENE_IN_MS)
    expect(pitch.phase()).toBe('waiting')
    expect(pitch.penalty()).toMatchObject({ card: 0, scene: 1, team: 'Team Away', result: null, kick: 0, banner: 0 })
    const waited = pitch.penalty()!.waitMs
    pitch.animate(500)
    expect(pitch.penalty()!.waitMs).toBeGreaterThan(waited)
    expect(pitch.replay.outputs.at(-1)!.animating).toBe(true)
  })

  // The renderer fades everyone out by card + scene: below 1, the players would show through.
  it('holds the card whole until the scene is in, so nobody shows through the hand-over', () => {
    const pitch = new Pitch()
    pitch.start()
    pitch.animate(LABEL_CARD_IN_MS)
    const frames = pitch.animate(PENALTY_CARD_MS + PENALTY_SCENE_IN_MS)
    for (const output of frames) {
      const p = output.layers!.penalty!
      expect(p.card + p.scene).toBeGreaterThanOrEqual(1)
      expect(p.card === 0 || p.card === 1).toBe(true)
    }
    expect(pitch.penalty()).toMatchObject({ card: 0, scene: 1 })
  })

  it('kicks and scores on a penalty scored, then leaves', () => {
    const pitch = new Pitch()
    pitch.toWaiting()
    pitch.record([SCORED])
    pitch.animate(1)
    expect(pitch.phase()).toBe('kick')
    expect(pitch.penalty()).toMatchObject({ result: 'scored', kick: 0, banner: 0, scene: 1 })
    // One step, and one paint, an animation frame, however often its labels have moved it on.
    for (const output of pitch.animate(PENALTY_KICK_MS / 2)) expect(output.paints).toHaveLength(1)
    expect(pitch.penalty()!.kick).toBeGreaterThan(0)
    expect(pitch.penalty()!.kick).toBeLessThan(1)
    pitch.animate(PENALTY_KICK_MS / 2)
    expect(pitch.phase()).toBe('holding')
    expect(pitch.penalty()!.kick).toBe(1)
    pitch.animate(PENALTY_RESULT_IN_MS)
    expect(pitch.penalty()).toMatchObject({ banner: 1, scene: 1, team: 'Team Away' })
    pitch.animate(PENALTY_HOLD_MS - 100)
    expect(pitch.phase()).toBe('holding')
    pitch.animate(200)
    expect(pitch.phase()).toBe('leaving')
    expect(pitch.penalty()!.scene).toBeGreaterThan(0)
    expect(pitch.penalty()!.scene).toBeLessThan(1)
    // The banner goes with the scene it is drawn in.
    expect(pitch.penalty()!.banner).toBe(1)
    pitch.animate(PENALTY_OUT_MS)
    expect(pitch.phase()).toBeNull()
    expect(pitch.penalty()).toBeUndefined()
    expect(pitch.replay.outputs.at(-1)!.animating).toBe(false)
  })

  it('takes PENALTY_KICK_MS + PENALTY_RESULT_IN_MS + PENALTY_HOLD_MS + PENALTY_OUT_MS from the kick', () => {
    const total = PENALTY_KICK_MS + PENALTY_RESULT_IN_MS + PENALTY_HOLD_MS + PENALTY_OUT_MS
    const pitch = new Pitch()
    pitch.toWaiting()
    pitch.record([SCORED])
    pitch.animate(1)
    pitch.animate(total - 40)
    expect(pitch.phase()).toBe('leaving')
    pitch.animate(40)
    expect(pitch.phase()).toBeNull()
  })

  it('misses on a penalty missed', () => {
    const pitch = new Pitch()
    pitch.toWaiting()
    pitch.record([MISSED])
    pitch.animate(1)
    expect(pitch.phase()).toBe('kick')
    pitch.animate(PENALTY_KICK_MS + 200)
    expect(pitch.phase()).toBe('holding')
    expect(pitch.penalty()).toMatchObject({ result: 'missed', kick: 1, team: 'Team Away' })
    expect(pitch.penalty()!.afterKickMs).toBeGreaterThan(0)
  })

  it('leaves after 20 s on the clock with no result', () => {
    const pitch = new Pitch()
    pitch.start()
    pitch.play(PENALTY_WAIT_S - 0.5)
    expect(pitch.phase()).toBe('waiting')
    pitch.play(0.8)
    expect(pitch.phase()).toBe('leaving')
    pitch.animate(PENALTY_OUT_MS)
    expect(pitch.phase()).toBeNull()
    expect(pitch.penalty()).toBeUndefined()
  })

  // Review Focus 3: live, a stalled stream stands the clock still, so the clock's wait would never end.
  it('leaves when the stream stalls', () => {
    const pitch = new Pitch()
    pitch.start()
    pitch.animate(2 * PENALTY_WAIT_S * 1000 - 500)
    expect(pitch.phase()).toBe('waiting')
    pitch.animate(1000)
    expect(pitch.phase()).toBe('leaving')
    pitch.animate(PENALTY_OUT_MS)
    expect(pitch.phase()).toBeNull()
  })

  it('finishes the card before a result that comes during it', () => {
    const pitch = new Pitch()
    pitch.start()
    pitch.animate(1000)
    pitch.record([SCORED])
    const frames = pitch.animate(PENALTY_CARD_MS + PENALTY_SCENE_IN_MS + PENALTY_KICK_MS)
    expect(pitch.penalty()).toMatchObject({ result: 'scored', team: 'Team Away' })
    for (const output of frames) {
      const p = output.layers!.penalty!
      // The kick waits for the card, and for the scene to be in.
      if (p.scene < 1) expect(p.kick).toBe(0)
      expect(p.card + p.scene).toBeGreaterThanOrEqual(1)
    }
    const during = frames.filter((output) => output.layers!.penalty!.scene === 0)
    expect(during.length).toBeGreaterThan(0)
    expect(during.every((output) => output.layers!.penalty!.card === 1)).toBe(true)
    expect(pitch.phase()).toBe('holding')
  })

  // Review Focus 2: a fast labeller, the two records merged into one.
  it('plays the card then the kick when both labels are on one record', () => {
    const pitch = new Pitch()
    pitch.start([PENALTY, SCORED])
    expect(pitch.phase()).toBe('card')
    expect(pitch.penalty()).toMatchObject({ team: 'Team Away', result: 'scored', kick: 0, scene: 0 })
    pitch.animate(PENALTY_CARD_MS + PENALTY_SCENE_IN_MS - 50)
    expect(pitch.penalty()!.kick).toBe(0)
    pitch.animate(100)
    expect(pitch.phase()).toBe('kick')
    pitch.animate(PENALTY_KICK_MS)
    expect(pitch.phase()).toBe('holding')
  })

  it("kicks at once on a result with no penalty showing, with the result's team", () => {
    const pitch = new Pitch()
    pitch.start([MISSED])
    expect(pitch.phase()).toBe('kick')
    expect(pitch.penalty()).toMatchObject({ card: 0, scene: 0, team: 'Team Home', result: 'missed' })
    const frames = pitch.animate(PENALTY_SCENE_IN_MS + PENALTY_KICK_MS / 2)
    for (const output of frames) expect(output.layers!.penalty!.card).toBe(0)
    expect(pitch.penalty()!.scene).toBe(1)
    expect(pitch.penalty()!.kick).toBeGreaterThan(0)
    pitch.animate(PENALTY_KICK_MS / 2)
    expect(pitch.phase()).toBe('holding')
  })

  // Final review: a result that came during the fade-out was noted as seen and then dropped.
  it('plays a result that comes as the penalty fades out, from the scene as it was', () => {
    const pitch = new Pitch()
    pitch.toWaiting()
    while (pitch.phase() !== 'leaving') {
      pitch.record()
      pitch.animate(40)
    }
    const before = pitch.penalty()!.scene
    pitch.record([MISSED])
    const frames = pitch.animate(1)
    for (let i = 0; i < 200; i++) {
      pitch.record()
      frames.push(...pitch.animate(40))
    }
    const shown = frames.map((output) => output.layers?.penalty)
    // Kicked, for the result's team, as with nothing showing.
    expect(shown.some((p) => p?.result === 'missed' && p.kick === 1)).toBe(true)
    expect(shown.find((p) => p?.result === 'missed')!.team).toBe('Team Home')
    // From the scene as it was, not snapping back to the pitch and fading in again.
    const start = shown.findIndex((p) => p?.result === 'missed')
    const kicked = shown.findIndex((p) => p?.kick === 1)
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThan(1)
    let scene = before
    for (const p of shown.slice(start, kicked + 1)) {
      expect(p!.scene).toBeGreaterThanOrEqual(scene - 1e-9)
      scene = p!.scene
    }
    expect(scene).toBe(1)
    expect(pitch.phase()).toBeNull()
  })

  it("names the penalty's team, not its result's", () => {
    const pitch = new Pitch()
    pitch.toWaiting()
    pitch.record([MISSED])
    pitch.animate(PENALTY_KICK_MS + 100)
    expect(pitch.penalty()).toMatchObject({ team: 'Team Away', result: 'missed' })
  })

  it('starts again on a second penalty', () => {
    const pitch = new Pitch()
    pitch.start()
    // A label that stays on is the same penalty.
    pitch.animate(1000)
    pitch.record([PENALTY])
    pitch.animate(PENALTY_CARD_MS)
    expect(pitch.phase()).toBe('waiting')
    pitch.play(15)
    expect(pitch.phase()).toBe('waiting')
    pitch.record([human('Penalty', 'Team Home')])
    pitch.animate(1)
    expect(pitch.phase()).toBe('card')
    // From the scene it covers, so nobody shows through.
    expect(pitch.penalty()).toMatchObject({ card: 1, scene: 0, team: 'Team Home' })
    // A new 20 s, from the second penalty.
    pitch.play(10)
    expect(pitch.phase()).toBe('waiting')
    pitch.play(PENALTY_WAIT_S - 10 + 0.3)
    expect(pitch.phase()).toBe('leaving')
  })

  it('ignores a second result', () => {
    const pitch = new Pitch()
    pitch.toWaiting()
    pitch.record([SCORED])
    pitch.animate(PENALTY_KICK_MS / 2)
    pitch.record([MISSED])
    pitch.animate(PENALTY_KICK_MS)
    expect(pitch.phase()).toBe('holding')
    expect(pitch.penalty()!.result).toBe('scored')
    pitch.record([])
    pitch.record([SCORED])
    pitch.animate(PENALTY_RESULT_IN_MS + PENALTY_HOLD_MS)
    expect(pitch.phase()).toBe('leaving')
    pitch.record([MISSED])
    pitch.animate(1)
    expect(pitch.phase()).toBe('leaving')
    expect(pitch.penalty()!.result).toBe('scored')
    pitch.animate(PENALTY_OUT_MS)
    expect(pitch.phase()).toBeNull()
  })

  it('plays no goal on a penalty scored', () => {
    const pitch = new Pitch()
    pitch.start([SCORED])
    pitch.animate(1200)
    expect(pitch.replay.last()?.goal).toBeUndefined()
    expect(pitch.replay.last()?.goalBanner).toBeUndefined()
    expect(pitch.penalty()).toBeDefined()
  })

  // Turning the layer off leaves the widget as it was without it: "Penalty scored" is a goal's label again.
  it('plays the goal on a penalty scored with the penalty layer off', () => {
    const pitch = new Pitch({ layers: { penalty: false } })
    pitch.start([PENALTY])
    pitch.record([SCORED])
    pitch.animate(1200)
    expect(pitch.replay.last()?.goal).toBeDefined()
    expect(pitch.penalty()).toBeUndefined()
    expect(pitch.phase()).toBeNull()
  })

  // Review Focus 1: the labelling tool's "Player scored" a couple of seconds after a "Penalty scored".
  it('plays nothing on a player scored after a penalty scored', () => {
    for (const scorerWaitS of [0, SCORER_WAIT_S]) {
      const pitch = new Pitch({ options: { scorerWaitS } })
      pitch.toWaiting()
      pitch.record([SCORED])
      pitch.animate(1)
      expect(pitch.replay.director.goalWaiting).toBe(false)
      pitch.play(2)
      pitch.record([human('Player scored', 'Team Home')])
      pitch.play(SCORER_WAIT_S + 1)
      expect(pitch.replay.director.goalWaiting).toBe(false)
      expect(pitch.replay.outputs.some((output) => output.layers?.goal !== undefined)).toBe(false)
      expect(pitch.replay.outputs.some((output) => output.layers?.goalBanner !== undefined)).toBe(false)
    }
  })

  it('ends on a pause or a seek', () => {
    const paused = new Pitch()
    paused.toWaiting()
    paused.replay.pause()
    expect(paused.phase()).toBeNull()
    expect(paused.penalty()).toBeUndefined()

    const sought = new Pitch()
    sought.start()
    sought.animate(500)
    sought.replay.set({ time: 60, frame: frameAt(0) })
    expect(sought.phase()).toBeNull()
    expect(sought.penalty()).toBeUndefined()
  })

  it('plays nothing on a label a seek lands on, or with its layer off', () => {
    const sought = new Pitch()
    sought.replay.set({ time: 60, frame: frameAt(0, [PENALTY]) })
    sought.animate(300)
    expect(sought.phase()).toBeNull()
    // The label carrying on is not a new one.
    sought.record([PENALTY])
    sought.animate(300)
    expect(sought.phase()).toBeNull()

    const off = new Pitch({ layers: { penalty: false } })
    off.start([PENALTY, SCORED])
    off.animate(300)
    expect(off.phase()).toBeNull()
    expect(off.penalty()).toBeUndefined()
    // Noted while off: switched on, the labels carrying on start nothing.
    off.replay.toggle({ penalty: true })
    off.record([PENALTY, SCORED])
    off.animate(300)
    expect(off.phase()).toBeNull()
  })

  it('shows still under reduced motion', () => {
    const pitch = new Pitch({ reducedMotion: true })
    pitch.start()
    expect(pitch.penalty()).toMatchObject({ card: 1, scene: 0, still: true })
    pitch.animate(PENALTY_CARD_MS + 1)
    expect(pitch.phase()).toBe('waiting')
    expect(pitch.penalty()).toMatchObject({ card: 0, scene: 1, still: true })
    pitch.record([SCORED])
    pitch.animate(1)
    // The kick's last frame, the banner in, for the hold.
    expect(pitch.phase()).toBe('holding')
    expect(pitch.penalty()).toMatchObject({ result: 'scored', kick: 1, banner: 1, afterKickMs: 0, scene: 1, card: 0 })
    const frames = pitch.animate(PENALTY_HOLD_MS - 50)
    expect(pitch.phase()).toBe('holding')
    frames.push(...pitch.animate(100))
    // Gone without a fade.
    expect(pitch.phase()).toBeNull()
    expect(pitch.penalty()).toBeUndefined()
    for (const output of pitch.replay.outputs) {
      const p = output.layers?.penalty
      if (p) expect([p.card, p.scene].every((k) => k === 0 || k === 1)).toBe(true)
    }
  })
})

describe('the penalty in a flashback clip', () => {
  /** A context with the moment's layer on, during playback at `time`. */
  const context = (time: number): MomentContext =>
    ({
      shown: () => ({ time, playing: true, record: null, phase: null, trail: null }),
      playback: () => true,
      layers: () => DEFAULT_REPLAY_LAYERS,
      reducedMotion: () => false,
      teamName: (team: number) => (team === 0 ? 'Red' : 'Blue'),
    }) as unknown as MomentContext

  it('plays nothing in a director that never plays it', () => {
    const penalty = new Penalty(context(10), false)
    expect(penalty.detect(frameAt(0, [PENALTY]), 10)).toBe(false)
    expect(penalty.detect(frameAt(0, [SCORED]), 10.04)).toBe(false)
    expect(penalty.active).toBe(false)
    expect(penalty.value()).toBeUndefined()
  })
})
