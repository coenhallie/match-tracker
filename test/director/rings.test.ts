import { describe, it, expect } from 'vitest'
import { POSSESSION_FADE_IN_S, RECEIVE_FADE_S, RECEIVE_SHOW_S, RING_FADE_S } from '../../src/render/constants'
import type { Frame } from '../../src/model/types'
import { Rings, fadeRings } from '../../src/director/rings'
import { FakeReplay } from './harness'

// Ported from the reference's describe('ring fade') (pipelineOutputSurface.test.ts:1546-1817), case for
// case, reading the director's last painted layers where the reference read renderFrame's last call.
// Every case in that group is ported.

const person = (track_id: number, x: number, ball = false) => ({
  track_id,
  person_type: 'PersonType.PLAYER',
  projected_coordinates: { x, y: 0 },
  in_possession: ball,
})

/**
 * Red's carrier (track 1) at x = 0, and track 2 at `x`: ringed within
 * 15 m. Without `carrier`, nobody has the ball.
 */
const frameWith = (x: number, carrier = true): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [{ team_id: 0, players: [person(1, 0, carrier), person(2, x)] }],
    balls: [{ projected_coordinates: { x: 0, y: 0 } }],
    state: { actions: [] },
    frame_data: [{ frame_count: 1 }],
  }) as Frame
const NEAR = 10
const FAR = 30

function ready(x: number, layers = {}) {
  const replay = new FakeReplay(layers)
  replay.ready(frameWith(x))
  return replay
}

/** One step of playback, `by` seconds on, showing a fresh record. */
const step = (replay: FakeReplay, x: number, by = 0.04, carrier = true) => replay.step(frameWith(x, carrier), by)

/** The white ring's strength on track `id`. */
const ring = (replay: FakeReplay, id: number) => replay.last()?.rings?.nearby.get(id) ?? 0
/** The possession ring's strength on track `id`. */
const held = (replay: FakeReplay, id: number) => replay.last()?.rings?.possession.get(id) ?? 0
/** How strongly track `id` is drawn over the ball, having just received it. */
const cover = (replay: FakeReplay, id: number) => replay.last()?.received?.get(id) ?? 0

/** Play on `s` seconds, a frame at a time. */
function playFor(replay: FakeReplay, s: number, carrier = true) {
  for (let t = 0; t < s - 1e-9; t += 0.04) step(replay, NEAR, 0.04, carrier)
}

/** Playing, with nobody having had the ball for long enough to forget it. */
function playingWithoutBall(layers = {}) {
  const replay = ready(NEAR, layers)
  replay.play()
  playFor(replay, RING_FADE_S + 0.08, false)
  return replay
}

describe('ring fade', () => {
  it('shows the rings at once on a frame reached by a seek', () => {
    const replay = ready(FAR)
    step(replay, NEAR, 30)
    expect(ring(replay, 2)).toBe(1)
    expect(ring(replay, 1)).toBe(1)
  })

  it('fades a ring in during playback', () => {
    const replay = ready(FAR)
    replay.play()
    step(replay, NEAR)
    expect(ring(replay, 2)).toBeGreaterThan(0)
    expect(ring(replay, 2)).toBeLessThan(1)
    for (let t = 0; t < RING_FADE_S; t += 0.04) step(replay, NEAR)
    expect(ring(replay, 2)).toBe(1)
  })

  it('fades a ring out during playback when its player leaves the area', () => {
    const replay = ready(NEAR)
    replay.play()
    step(replay, FAR)
    expect(ring(replay, 2)).toBeGreaterThan(0)
    expect(ring(replay, 2)).toBeLessThan(1)
    for (let t = 0; t < RING_FADE_S; t += 0.04) step(replay, FAR)
    expect(ring(replay, 2)).toBe(0)
  })

  it('moves a fade on with the clock between records', () => {
    const replay = ready(FAR)
    replay.play()
    step(replay, NEAR)
    const before = ring(replay, 2)
    replay.advance(0.016)
    expect(ring(replay, 2)).toBeGreaterThan(before)
  })

  it('settles at once when playback pauses partway through a fade', () => {
    const replay = ready(FAR)
    replay.play()
    step(replay, NEAR)
    replay.pause()
    expect(ring(replay, 2)).toBe(1)
  })

  it('fades the possession ring out when nobody has the ball, and back in', () => {
    const replay = ready(NEAR)
    expect(held(replay, 1)).toBe(1)
    replay.play()
    step(replay, NEAR, 0.04, false)
    expect(held(replay, 1)).toBeGreaterThan(0)
    expect(held(replay, 1)).toBeLessThan(1)
    const dipped = held(replay, 1)
    step(replay, NEAR, 0.04, true)
    expect(held(replay, 1)).toBeGreaterThan(dipped)
    for (let t = 0; t < RING_FADE_S; t += 0.04) step(replay, NEAR)
    expect(held(replay, 1)).toBe(1)
  })

  it('shows the possession ring at once on a frame reached by a seek', () => {
    const replay = ready(NEAR)
    step(replay, NEAR, 30, false)
    expect(held(replay, 1)).toBe(0)
    step(replay, NEAR, 30, true)
    expect(held(replay, 1)).toBe(1)
  })

  it('settles the possession ring at once when playback pauses', () => {
    const replay = ready(NEAR)
    replay.play()
    step(replay, NEAR, 0.04, false)
    replay.pause()
    expect(held(replay, 1)).toBe(0)
  })

  it('brings the possession ring in quickly, and fades it out slowly', () => {
    const replay = ready(NEAR)
    replay.play()
    for (let t = 0; t <= RING_FADE_S; t += 0.04) step(replay, NEAR, 0.04, false)
    expect(held(replay, 1)).toBe(0)
    for (let t = 0; t < POSSESSION_FADE_IN_S - 1e-9; t += 0.04) step(replay, NEAR)
    expect(held(replay, 1)).toBeCloseTo(1, 9)
    // It still fades out over RING_FADE_S.
    step(replay, NEAR, 0.04, false)
    expect(held(replay, 1)).toBeCloseTo(1 - 0.04 / RING_FADE_S)
  })

  it('draws a player who receives the ball over it for a moment, then fades them to show it', () => {
    const replay = playingWithoutBall()
    expect(cover(replay, 1)).toBe(0)
    step(replay, NEAR)
    expect(cover(replay, 1)).toBe(1)
    playFor(replay, RECEIVE_SHOW_S - 0.04)
    expect(cover(replay, 1)).toBe(1)
    playFor(replay, RECEIVE_FADE_S / 2)
    expect(cover(replay, 1)).toBeGreaterThan(0)
    expect(cover(replay, 1)).toBeLessThan(1)
    playFor(replay, RECEIVE_FADE_S / 2 + 0.04)
    expect(cover(replay, 1)).toBe(0)
  })

  it('does not start again when the data loses the player with the ball for a frame or two', () => {
    const replay = playingWithoutBall()
    step(replay, NEAR)
    playFor(replay, RECEIVE_SHOW_S + RECEIVE_FADE_S)
    expect(cover(replay, 1)).toBe(0)
    playFor(replay, 0.08, false)
    step(replay, NEAR)
    expect(cover(replay, 1)).toBe(0)
  })

  // The cover is not a ring fade: switching those off must not lose it.
  describe('with ring fades switched off', () => {
    const OFF = { ringFades: false }

    it('still draws a player who receives the ball over it, and fades them', () => {
      const replay = playingWithoutBall(OFF)
      step(replay, NEAR)
      expect(cover(replay, 1)).toBe(1)
      playFor(replay, RECEIVE_SHOW_S + RECEIVE_FADE_S / 2)
      expect(cover(replay, 1)).toBeGreaterThan(0)
      expect(cover(replay, 1)).toBeLessThan(1)
    })

    it('still does not start again when the data loses the player for a frame or two', () => {
      const replay = playingWithoutBall(OFF)
      step(replay, NEAR)
      playFor(replay, RECEIVE_SHOW_S + RECEIVE_FADE_S)
      playFor(replay, 0.08, false)
      step(replay, NEAR)
      expect(cover(replay, 1)).toBe(0)
    })
  })

  it('draws nobody over the ball on a frame reached by a seek, or while paused', () => {
    const replay = ready(FAR)
    step(replay, NEAR, 30, false)
    step(replay, NEAR, 30, true)
    expect(cover(replay, 1)).toBe(0)
    replay.play()
    playFor(replay, RING_FADE_S + 0.08, false)
    step(replay, NEAR)
    expect(cover(replay, 1)).toBe(1)
    replay.pause()
    expect(cover(replay, 1)).toBe(0)
  })

  it('does not fade under reduced motion', () => {
    const replay = new FakeReplay()
    replay.reducedMotion = true
    replay.ready(frameWith(FAR))
    replay.play()
    step(replay, NEAR)
    expect(ring(replay, 2)).toBe(1)
    // Nor draw the player with the ball over it, which would only flash.
    expect(cover(replay, 1)).toBe(0)
  })

  // Not in the reference's group, which saw only the last paint: each paint is a copy, so a later
  // update does not change what an earlier one drew.
  it('hands each paint its own copy of the rings and covers', () => {
    const replay = playingWithoutBall()
    const painted = step(replay, NEAR).layers
    const nearby = painted?.rings?.nearby.get(2)
    playFor(replay, RECEIVE_SHOW_S + RECEIVE_FADE_S)
    expect(painted?.rings?.nearby.get(2)).toBe(nearby)
    expect(painted?.received?.get(1)).toBe(1)
  })
})

describe('Rings', () => {
  it('fades a ring in over its fade-in and out over RING_FADE_S, dropping it at 0', () => {
    const rings = new Map<number, number>()
    fadeRings(rings, new Set([1]), 0.06, 0.12)
    expect(rings.get(1)).toBeCloseTo(0.5, 12)
    fadeRings(rings, new Set(), 0.15)
    expect(rings.get(1)).toBeCloseTo(0.25, 12)
    fadeRings(rings, new Set(), 0.15)
    expect(rings.has(1)).toBe(false)
  })

  it('sets the rings to the target at once without a step', () => {
    const rings = new Map<number, number>([[3, 0.2]])
    fadeRings(rings, new Set([1, 2]), null)
    expect([...rings]).toEqual([
      [1, 1],
      [2, 1],
    ])
  })

  it('is fading while a ring is below full strength or someone is drawn over the ball', () => {
    const rings = new Rings()
    expect(rings.fading()).toBe(false)
    rings.update(frameWith(NEAR), null)
    expect(rings.fading()).toBe(false)
    rings.update(frameWith(FAR), 0.04)
    expect(rings.fading()).toBe(true)
    rings.settle(frameWith(FAR))
    expect(rings.fading()).toBe(false)
  })

  it('eases a cover out over RECEIVE_FADE_S after RECEIVE_SHOW_S', () => {
    const rings = new Rings()
    rings.update(frameWith(NEAR, false), null)
    rings.update(frameWith(NEAR, false), RING_FADE_S + 0.01)
    rings.update(frameWith(NEAR), 0.04)
    expect(rings.covers().get(1)).toBe(1)
    // In two steps, each short enough that the carrier is not forgotten in between.
    rings.update(frameWith(NEAR), (RECEIVE_SHOW_S + RECEIVE_FADE_S / 2) / 2)
    rings.update(frameWith(NEAR), (RECEIVE_SHOW_S + RECEIVE_FADE_S / 2) / 2)
    expect(rings.covers().get(1)).toBeCloseTo(0.5, 9)
  })

  it('clears everything', () => {
    const rings = new Rings()
    rings.update(frameWith(NEAR), null)
    rings.clear()
    expect(rings.nearby.size + rings.possession.size + rings.covers().size).toBe(0)
    expect(rings.fading()).toBe(false)
  })
})
