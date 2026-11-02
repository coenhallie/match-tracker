import { describe, it, expect } from 'vitest'
import { UPRIGHT, MAX_ROLL_STEP_RAD, footballPatches, rolled, turned, type Spin } from '../../src/analysis/football'

/** The body-frame point that faces the viewer while the ball is upright. */
const FRONT = [0, 0, -1] as const

/** How far a spin is turned from upright, in radians. */
const angleOf = (spin: Spin) => 2 * Math.acos(Math.min(1, Math.abs(spin[0])))

/** A spin with `n` small rolls `(dx, dy)` applied in turn. */
function rolls(n: number, dx: number, dy: number, radius: number, from: Spin = UPRIGHT): Spin {
  let spin = from
  for (let i = 0; i < n; i++) spin = rolled(spin, dx, dy, radius)
  return spin
}

describe('rolled', () => {
  it('turns the face of the ball the way the ball moves, as a rolling ball does', () => {
    const right = turned(rolled(UPRIGHT, 2, 0, 10), FRONT)
    expect(right[0]).toBeGreaterThan(0)
    expect(right[1]).toBeCloseTo(0)
    const down = turned(rolled(UPRIGHT, 0, 2, 10), FRONT)
    expect(down[1]).toBeGreaterThan(0)
    expect(down[0]).toBeCloseTo(0)
  })

  it('turns by the distance over the radius, so it rolls without slipping', () => {
    expect(angleOf(rolled(UPRIGHT, 3, 4, 50))).toBeCloseTo(5 / 50)
  })

  it('comes back to where it started after rolling its own circumference, whichever way', () => {
    const radius = 7
    const steps = 200
    const along = (2 * Math.PI * radius) / steps
    const heading = 0.65
    const spin = rolls(steps, along * Math.cos(heading), along * Math.sin(heading), radius)
    expect(angleOf(spin)).toBeCloseTo(0, 6)
  })

  it('turns no more than MAX_ROLL_STEP_RAD in one step, so a fast ball does not strobe', () => {
    expect(angleOf(rolled(UPRIGHT, 400, 0, 7))).toBeCloseTo(MAX_ROLL_STEP_RAD)
  })

  it('does not turn for no movement', () => {
    expect(rolled(UPRIGHT, 0, 0, 7)).toEqual(UPRIGHT)
  })

  it('stays a pure rotation however long it rolls', () => {
    const spin = rolls(5000, 1.3, -0.7, 7)
    expect(Math.hypot(...spin)).toBeCloseTo(1, 9)
  })
})

describe('footballPatches', () => {
  const spins: Spin[] = [UPRIGHT, rolls(17, 2, 1, 7), rolls(40, -1, 3, 7), rolls(9, 0, -4, 7)]

  it('shows the black patches on the side of the ball facing the viewer, inside its outline', () => {
    for (const spin of spins) {
      const patches = footballPatches(spin)
      expect(patches.length).toBeGreaterThanOrEqual(4)
      expect(patches.length).toBeLessThanOrEqual(10)
      for (const patch of patches) {
        expect(patch.length).toBeGreaterThanOrEqual(5)
        for (const [x, y] of patch) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })

  it('moves the patches as the ball rolls', () => {
    expect(footballPatches(rolls(3, 2, 0, 7))).not.toEqual(footballPatches(UPRIGHT))
  })
})
