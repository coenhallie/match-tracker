import { describe, it, expect } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import type { Frame } from '../../src/model/types'
import { FakeReplay } from './harness'

// The throw-in's cases from pipelineOutputSurface.test.ts (:1904-2131), with the surface's fake replay as
// FakeReplay. These blocks run whole animation frames (`animate(ms, true)`), as the reference's do.

/** A record: the ball at `ballX` along the pitch, or lost, and the labels it carries. */
const frameAt = (ballX: number | null, labels: string[] = []): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [
      {
        team_id: 0,
        players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x: 3, y: 2 } }],
      },
    ],
    balls: ballX === null ? [] : [{ projected_coordinates: { x: ballX, y: 33 } }],
    state: { actions: labels.map((action_type) => ({ action_type })) },
    frame_data: [{ frame_count: 1 }],
  }) as Frame
const THROW_IN = ['EventType.THROW_IN']
const NOBODY: TeamPhase = { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }

function ready(reducedMotion = false): FakeReplay {
  const replay = new FakeReplay()
  replay.reducedMotion = reducedMotion
  replay.set({ time: 10, frame: frameAt(0), phase: NOBODY })
  replay.play()
  return replay
}

/** The next record by playback, `step` seconds on (a seek when large). */
const record = (replay: FakeReplay, ballX: number | null, labels: string[] = [], step = 0.04) =>
  replay.set({ time: replay.time + step, frame: frameAt(ballX, labels) })

const animate = (replay: FakeReplay, ms: number) => replay.animate(ms, true)
const lastThrowIn = (replay: FakeReplay) => replay.last()?.throwIn

describe('throw-in', () => {
  // The reference's slides in from the ball's half; the widget's fades in where it stands, and notes the
  // side, which the parity test draws the reference's from.
  it('fades in where it stands for a throw-in in the left half, noting the side, the players left as they are', () => {
    const replay = ready()
    const from = replay.outputs.length
    record(replay, -30, THROW_IN)
    animate(replay, 150)
    const early = lastThrowIn(replay)!
    expect(early.side).toBe(-1)
    expect(early.inPlace).toBe(true)
    expect(early.intensity).toBeGreaterThan(0)
    expect(early.intensity).toBeLessThan(1)
    expect(early.slide).toBe(early.intensity)
    animate(replay, 500)
    expect(lastThrowIn(replay)).toEqual({ intensity: 1, slide: 1, side: -1, inPlace: true })
    // Nothing else on the pitch changes for it: no fade, no zoom.
    expect(replay.last()?.corner).toBeUndefined()
    expect(replay.outputs.slice(from).every((o) => o.camera === null)).toBe(true)
    expect(replay.lastView()).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
  })

  it('notes the right side for a throw-in in the right half', () => {
    const replay = ready()
    record(replay, 30, THROW_IN)
    animate(replay, 600)
    expect(lastThrowIn(replay)?.side).toBe(1)
  })

  // The ball is often lost as it goes out.
  it('goes by the last tracked ball when the label’s frame has none, and fades in place with none', () => {
    const replay = ready()
    record(replay, 40)
    record(replay, null)
    record(replay, null, THROW_IN)
    animate(replay, 600)
    expect(lastThrowIn(replay)?.side).toBe(1)

    const other = ready()
    record(other, null, [], 30)
    for (let i = 0; i < 130; i++) record(other, null)
    record(other, null, THROW_IN)
    animate(other, 600)
    expect(lastThrowIn(other)).toEqual({ intensity: 1, slide: 1, side: null, inPlace: true })
  })

  it('fades out where it stands after THROW_IN_SHOW_MS', () => {
    const replay = ready()
    record(replay, -30, THROW_IN)
    animate(replay, 2000 + 150)
    const going = lastThrowIn(replay)!
    expect(going.inPlace).toBe(true)
    expect(going.intensity).toBeGreaterThan(0)
    expect(going.intensity).toBeLessThan(1)
    animate(replay, 400)
    expect(lastThrowIn(replay)).toBeUndefined()
  })

  it('is shown once for a label that flickers, and again for a later throw-in', () => {
    const replay = ready()
    record(replay, -30, THROW_IN)
    for (let i = 0; i < 70; i++) {
      record(replay, -30, i % 3 === 0 ? THROW_IN : [])
      animate(replay, 50)
    }
    expect(lastThrowIn(replay)).toBeUndefined()
    for (let i = 0; i < 130; i++) record(replay, -30)
    record(replay, -30, THROW_IN)
    animate(replay, 100)
    expect(lastThrowIn(replay)).toBeDefined()
  })

  it('is not shown for a throw-in a seek lands in the middle of', () => {
    const replay = ready()
    record(replay, -30, THROW_IN, 30)
    record(replay, -30, THROW_IN)
    animate(replay, 300)
    expect(lastThrowIn(replay)).toBeUndefined()
  })

  it('stops at once on a pause', () => {
    const replay = ready()
    record(replay, -30, THROW_IN)
    animate(replay, 500)
    replay.pause()
    expect(lastThrowIn(replay)).toBeUndefined()
  })

  // The reference's case gives way to a free kick, which the widget no longer shows; the corner takes its place.
  it('gives way to a corner, and does not start while one shows', () => {
    const replay = ready()
    record(replay, -30, THROW_IN)
    animate(replay, 200)
    record(replay, -30, ['EventType.CORNER_KICK'])
    animate(replay, 100)
    expect(lastThrowIn(replay)).toBeUndefined()
    expect(replay.last()?.corner).toBeDefined()
    for (let i = 0; i < 130; i++) record(replay, -30, ['EventType.CORNER_KICK'])
    record(replay, -30, THROW_IN)
    animate(replay, 100)
    expect(lastThrowIn(replay)).toBeUndefined()
  })

  it('shows nothing while the layer is off, and stops when it is turned off', () => {
    const replay = ready()
    record(replay, -30, THROW_IN)
    animate(replay, 300)
    expect(lastThrowIn(replay)).toBeDefined()
    replay.toggle({ throwInBanner: false })
    expect(lastThrowIn(replay)).toBeUndefined()
    for (let i = 0; i < 130; i++) record(replay, -30)
    record(replay, -30, THROW_IN)
    animate(replay, 300)
    expect(lastThrowIn(replay)).toBeUndefined()
  })

  it('shows whole and still under reduced motion', () => {
    const replay = ready(true)
    record(replay, -30, THROW_IN)
    animate(replay, 50)
    expect(lastThrowIn(replay)).toEqual({ intensity: 1, slide: 1, side: null, inPlace: true })
    animate(replay, 2000)
    expect(lastThrowIn(replay)).toBeUndefined()
  })

  // Beyond the reference's cases: attack and throw-in can show together.
  it('shows alongside an attack', () => {
    const replay = ready()
    const attacking: TeamPhase = { possession: 0, attacks: { 0: 1, 1: -1 }, states: { 0: 'attacking', 1: 'defending' } }
    replay.set({ time: replay.time + 0.04, frame: frameAt(20), phase: attacking })
    animate(replay, 100)
    expect(replay.last()?.attack).toBeDefined()
    replay.set({ time: replay.time + 0.04, frame: frameAt(20, THROW_IN), phase: attacking })
    animate(replay, 100)
    expect(replay.last()?.attack).toBeDefined()
    expect(lastThrowIn(replay)?.side).toBe(1)
  })

  // The browser calls animation frames in the order they were asked for, and a running moment asks for
  // its next frame as its callback runs: one started by the replay's tick, earlier in the same frame, goes
  // first from then on.
  it('takes its animation frame before an attack that was already running, when the tick started it', () => {
    const replay = ready()
    const attacking: TeamPhase = { possession: 0, attacks: { 0: 1, 1: -1 }, states: { 0: 'attacking', 1: 'defending' } }
    replay.set({ time: replay.time + 0.04, frame: frameAt(20), phase: attacking })
    animate(replay, 100)
    const started = replay.frame({ time: replay.time + 0.04, frame: frameAt(20, THROW_IN), phase: attacking })
    const before = started.paints.at(-1)!.layers.attack!.pulse
    const [frame] = animate(replay, 1)
    const [first, second] = frame!.paints
    // The throw-in's callback paints first, with the attack as it was on the frame before.
    expect(first!.layers.throwIn).toBeDefined()
    expect(first!.layers.attack!.pulse).toBe(before)
    expect(second!.layers.attack!.pulse).not.toBe(before)
  })
})
