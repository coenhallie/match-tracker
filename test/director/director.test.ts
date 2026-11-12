import { describe, it, expect } from 'vitest'
import type { BallTrail } from '../../src/analysis/ballTrail'
import { UPRIGHT } from '../../src/analysis/football'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import { Director, type DirectorInput } from '../../src/director/director'
import { DEFAULT_REPLAY_LAYERS } from '../../src/model/replayLayers'
import type { Frame } from '../../src/model/types'
import { RING_FADE_S } from '../../src/render/constants'
import { FakeReplay, VIEW } from './harness'

const person = (track_id: number, x: number, ball = false) => ({
  track_id,
  person_type: 'PersonType.PLAYER',
  projected_coordinates: { x, y: 0 },
  in_possession: ball,
})

/** Red's carrier (track 1) at x = 0, track 2 at `x`, and the ball at `ballX`. */
const frameWith = (x = 10, ballX = 0): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68, goal_width: 7.32 },
    teams: [{ team_id: 0, players: [person(1, 0, true), person(2, x)] }],
    balls: [{ projected_coordinates: { x: ballX, y: -30 } }],
    state: { actions: [] },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

const BLUE_ATTACKING: TeamPhase = {
  possession: 1,
  attacks: { 0: 1, 1: -1 },
  states: { 0: 'defending', 1: 'attacking' },
}

const trailOf = (x: number): BallTrail => ({
  runs: [
    [
      { x: x - 1, y: 2, age: 1 },
      { x, y: 2, age: 0 },
    ],
  ],
  turns: [],
})

function ready() {
  const replay = new FakeReplay()
  replay.ready(frameWith(), 10, { phase: BLUE_ATTACKING })
  return replay
}

describe('Director', () => {
  describe('drawing the first record', () => {
    it('has nothing to draw before a record arrives', () => {
      const replay = new FakeReplay()
      const output = replay.set({ time: 3 })
      expect(output.layers).toBeNull()
      expect(output.paint).toBe(false)
      expect(output.camera).toBeNull()
      expect(replay.pause().paint).toBe(false)
    })

    // Reference :496, 'attaches the renderer and draws when state flips to ready'. The director has no
    // replay state: the first record it is given stands for the replay becoming ready. The frame watcher
    // attaches the renderer on it, which pushes the view and paints before the rings have settled on the
    // record (ensureRenderer, :1239-1255; golden step 0 of every fixture), then paints itself, and the ready
    // watcher (:1311-1319) paints once more.
    it('draws the first record it is given, as the renderer attaching and the frame and ready watchers do', () => {
      const replay = new FakeReplay()
      const output = replay.ready(frameWith())
      expect(output.paint).toBe(true)
      expect(output.paints).toHaveLength(3)
      // The carrier has no ring yet as the renderer attaches.
      expect(output.paints[0]!.layers.rings?.possession).toEqual(new Map())
      expect(output.paints[1]!.layers.rings?.possession).toEqual(new Map([[1, 1]]))
      expect(output.paints[1]).toEqual(output.paints[2])
      expect(output.layers).toBe(output.paints[2]!.layers)
    })

    it('draws the layers as paint() does', () => {
      const replay = ready()
      expect(replay.last()).toEqual({
        goal: undefined,
        attack: undefined,
        throwIn: undefined,
        goalBanner: undefined,
        rings: {
          nearby: new Map([
            [1, 1],
            [2, 1],
          ]),
          possession: new Map([[1, 1]]),
        },
        fadeFar: true,
        ballShadow: true,
        trail: undefined,
        ballSpin: UPRIGHT,
        received: new Map(),
      })
    })
  })

  describe('when it paints', () => {
    it('paints a new record, and not a clock tick with nothing fading', () => {
      const replay = ready()
      replay.play()
      expect(replay.step(frameWith()).paint).toBe(true)
      expect(replay.advance(0.016).paint).toBe(false)
    })

    it('paints every tick of a fade, the tick it ends on, and then stops', () => {
      const replay = ready()
      replay.play()
      expect(replay.step(frameWith(30)).paint).toBe(true)
      let output = replay.advance(0.016)
      let ticks = 1
      while (output.layers?.rings?.nearby.has(2)) {
        expect(output.paint).toBe(true)
        output = replay.advance(0.016)
        ticks++
      }
      // The tick the fade ends on still paints, to show its end.
      expect(output.paint).toBe(true)
      // About (RING_FADE_S - 0.04) / 0.016 ticks, give or take the rounding of the sum.
      expect(Math.abs(ticks - (RING_FADE_S - 0.04) / 0.016)).toBeLessThan(1.5)
      expect(replay.advance(0.016).paint).toBe(false)
    })

    it('repaints when the phase changes without a new frame', () => {
      const replay = ready()
      const before = replay.paintCount()
      const output = replay.set({ phase: { ...BLUE_ATTACKING, states: { 0: null, 1: null } } })
      expect(output.paints).toHaveLength(1)
      expect(replay.paintCount()).toBe(before + 1)
    })

    // deriveAt makes a new phase and trail for every update; the replay's setHistory keeps its refs
    // when they say the same (usePipelineReplay.ts:485-499), so an equal copy is no change.
    it('does not paint a clock tick that brings an equal phase and trail', () => {
      const replay = ready()
      replay.set({ trail: trailOf(2) })
      replay.play()
      const output = replay.set({
        time: replay.time + 0.016,
        phase: structuredClone(BLUE_ATTACKING),
        trail: structuredClone(trailOf(2)),
      })
      expect(output.paint).toBe(false)
    })

    it('paints, once, a fresh phase that says something else', () => {
      const replay = ready()
      replay.play()
      const output = replay.set({
        time: replay.time + 0.016,
        phase: { ...structuredClone(BLUE_ATTACKING), possession: 0 },
      })
      expect(output.paints).toHaveLength(1)
    })

    it('draws the phase and trail it already had when an equal copy arrives', () => {
      const replay = ready()
      const trail = trailOf(2)
      replay.set({ trail })
      expect(replay.set({ trail: structuredClone(trail), frame: frameWith() }).layers?.trail).toBe(trail)
    })

    // Reference :2487.
    it('repaints when the trail changes without a new frame', () => {
      const replay = ready()
      const calls = replay.paintCount()
      replay.set({ trail: trailOf(2) })
      expect(replay.paintCount()).toBe(calls + 1)
    })

    it('does not paint when only playing starts', () => {
      const replay = ready()
      expect(replay.play().paint).toBe(false)
    })

    it('paints when playback pauses, settling the rings', () => {
      const replay = ready()
      replay.play()
      replay.step(frameWith())
      const output = replay.pause()
      expect(output.paints).toHaveLength(1)
    })

    it('is animating while a fade needs the clock, and not once it has settled', () => {
      const replay = ready()
      expect(replay.outputs.at(-1)?.animating).toBe(false)
      replay.play()
      expect(replay.step(frameWith(30)).animating).toBe(true)
      expect(replay.pause().animating).toBe(false)
    })

    it('keeps what it last drew on an update that paints nothing', () => {
      const replay = ready()
      replay.play()
      const drawn = replay.step(frameWith()).layers
      expect(replay.advance(0.016).layers).toBe(drawn)
    })
  })

  describe('the playback flag', () => {
    const input = (time: number, frame: Frame, playback: boolean): DirectorInput => ({
      nowMs: 1000,
      time,
      playing: true,
      playback,
      record: { t: time, frameCount: 1, frame },
      phase: null,
      trail: null,
    })

    // The reference sets lastStepWasPlayback in its currentTime watcher, so only when the clock moves
    // (:562-581): a record arriving at an unchanged time keeps the flag it had.
    it('is read only when the clock moves', () => {
      const director = new Director({
        // The zoom near goal off, as in the harness: the reference's camera.
        layers: { ...DEFAULT_REPLAY_LAYERS, goalZoom: false },
        reducedMotion: () => false,
        teamName: () => '',
        playerName: (_team, number) => `#${number}`,
        substitutionName: (_team, number) => (number === null ? null : `#${number}`),
        teamColor: () => '',
      })
      director.update(input(10, frameWith(10, 0), false), VIEW)
      const played = director.update(input(10.04, frameWith(10, 0.5), true), VIEW).layers?.ballSpin
      expect(played).not.toEqual(UPRIGHT)
      // A new record at the same time, said to be a seek: the flag stands, so the ball rolls on.
      const held = director.update(input(10.04, frameWith(10, 1), false), VIEW).layers?.ballSpin
      expect(held).not.toEqual(played)
      // The clock moves by a seek: the flag is taken, and the ball does not roll.
      const seek = director.update(input(30, frameWith(10, 1.5), false), VIEW).layers?.ballSpin
      expect(seek).toEqual(held)
    })
  })

  describe('layers', () => {
    // Reference :2468.
    it('draws far players solid when their fade is off', () => {
      const replay = ready()
      expect(replay.last()?.fadeFar).toBe(true)
      replay.toggle({ farFade: false })
      expect(replay.last()?.fadeFar).toBe(false)
    })

    // Reference :2476.
    it('draws the ball trail the replay reports, and none when it is off', () => {
      const replay = ready()
      const trail = trailOf(0)
      replay.set({ trail })
      expect(replay.last()?.trail).toEqual(trail)
      replay.toggle({ ballTrail: false })
      expect(replay.last()?.trail).toBeUndefined()
    })

    // Reference :2496.
    it('drops the white rings, and only them', () => {
      const replay = ready()
      expect(replay.last()?.rings?.nearby.size).toBeGreaterThan(0)
      replay.toggle({ nearbyRings: false })
      expect(replay.last()?.rings?.nearby.size).toBe(0)
      expect(replay.last()?.rings?.possession.get(1)).toBe(1)
    })

    // Reference :2505.
    it('snaps the rings during playback when smooth changes are off', () => {
      const replay = ready()
      replay.toggle({ ringFades: false })
      replay.play()
      replay.step(frameWith(30))
      expect(replay.last()?.rings?.nearby.get(2)).toBeUndefined()
      replay.step(frameWith())
      expect(replay.last()?.rings?.nearby.get(2)).toBe(1)
    })

    // toggleLayer (:108-118) settles the rings when their fades are switched off, then paints.
    it('settles a fade at once when ring fades are switched off', () => {
      const replay = ready()
      replay.play()
      replay.step(frameWith(30))
      expect(replay.last()?.rings?.nearby.get(2)).toBeGreaterThan(0)
      const output = replay.toggle({ ringFades: false })
      expect(output.paints).toHaveLength(1)
      expect(replay.last()?.rings?.nearby.has(2)).toBe(false)
    })

    it('paints nothing on a layer change before a record arrives', () => {
      const replay = new FakeReplay()
      expect(replay.toggle({ farFade: false }).paint).toBe(false)
    })
  })

  describe('stopping and resetting', () => {
    it('stops nothing, and so paints nothing, with no moment showing', () => {
      const replay = ready()
      expect(replay.director.stopAll().paint).toBe(false)
    })

    it('forgets everything on reset', () => {
      const replay = ready()
      replay.play()
      replay.step(frameWith(30, 0.5))
      replay.director.reset()
      const fresh = new FakeReplay()
      const output = replay.director.update(
        { nowMs: 2000, time: 20, playing: true, playback: false, record: null, phase: null, trail: null },
        VIEW,
      )
      expect(output.layers).toBeNull()
      const again = replay.director.update(
        {
          nowMs: 2016,
          time: 20,
          playing: true,
          playback: false,
          record: { t: 20, frameCount: 9, frame: frameWith(30, 1) },
          phase: null,
          trail: null,
        },
        VIEW,
      )
      expect(again.paints).toHaveLength(3)
      expect(again.layers).toEqual(fresh.ready(frameWith(30, 1)).layers)
    })
  })
})

// Reference cases not ported here, one line each (pipelineOutputSurface.test.ts line numbers).
// :517 'draws immediately when state flips to ready and the frame was already set': Vue watcher plumbing;
//   the director has no replay state, and its first record always paints (ported :496 above).
// The seek and pause cases of the moment groups are ported with their moments, under the same names:
// goal :769, :777, :787, :797, :855 in goal.test.ts; attack :1089, :1098, :1108 in attack.test.ts; throw-in
// :2058, :2067 in throwIn.test.ts; by hand :2336 in trigger.test.ts. So are the layers menu's goal cases, :2517
// and :2528, in goal.test.ts. The free kick's, :1432, :1441, :1455 and :1465, went with the free kick, which
// the widget no longer shows (CHANGELOG 0.2.0).
// Layers menu cases that are not about what paint() draws:
// :2441 'lists every layer, all shown by default': menu DOM, Task 11.
// :2450 'hides the attacking and defending labels': HUD DOM, Task 11.
// :2460 'leaves the attacking and defending labels to their own layer': HUD DOM, Task 11.
// :2541 'remembers the choice for the next time the replay opens': storage, Task 10/11.
// :2552 'closes on Escape, and on a click outside it': menu DOM, Task 11.
