import { describe, it, expect } from 'vitest'
import { UPRIGHT, rolled } from '../../src/analysis/football'
import { BallRoll, MAX_ROLL_STEP_METRES, shownBall } from '../../src/director/ballRoll'
import type { Frame } from '../../src/model/types'
import { BALL_RADIUS } from '../../src/render/constants'
import type { GoalOverlay } from '../../src/render/renderer'
import { FakeReplay } from './harness'
import { build2DTransform, worldToPx } from '../../src/model/pitch'

// Ported from the reference's describe('ball roll') (pipelineOutputSurface.test.ts:1819-1902), case for
// case, reading the director's last painted ballSpin. Every case in that group is ported.

const frameWith = (ballX: number): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [],
    balls: [{ projected_coordinates: { x: ballX, y: 0 } }],
    state: { actions: [] },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

function ready(reducedMotion = false) {
  const replay = new FakeReplay()
  replay.reducedMotion = reducedMotion
  replay.ready(frameWith(0))
  return replay
}

function playing(reducedMotion = false) {
  const replay = ready(reducedMotion)
  replay.play()
  return replay
}

const spin = (replay: FakeReplay) => replay.last()?.ballSpin

describe('ball roll', () => {
  it('rolls the ball as it moves during playback, and only then', () => {
    const replay = playing()
    expect(spin(replay)).toEqual(UPRIGHT)
    replay.step(frameWith(0.5))
    const turned = spin(replay)
    expect(turned).not.toEqual(UPRIGHT)
    // Still: the clock moves, the ball does not.
    replay.advance(0.02)
    expect(spin(replay)).toEqual(turned)
  })

  it('keeps the ball as it was across a seek, or a step while paused', () => {
    const replay = ready()
    replay.step(frameWith(0.5))
    expect(spin(replay)).toEqual(UPRIGHT)
    replay.play()
    replay.step(frameWith(5), 30)
    expect(spin(replay)).toEqual(UPRIGHT)
  })

  it('does not roll the ball across a jump in its tracking', () => {
    const replay = playing()
    replay.step(frameWith(20))
    expect(spin(replay)).toEqual(UPRIGHT)
  })

  it('does not roll the ball under reduced motion', () => {
    const replay = playing(true)
    replay.step(frameWith(0.5))
    expect(spin(replay)).toEqual(UPRIGHT)
  })

  // Beyond the reference's group: the exact turn, so a port that rolled in metres rather than on
  // screen, or from the wrong point, would show.
  it('rolls by the on-screen distance from where it was last drawn', () => {
    const replay = playing()
    replay.step(frameWith(0.5))
    const t = build2DTransform({ length: 105, width: 68 })
    const [x0, y0] = worldToPx(0, 0, t)
    const [x1, y1] = worldToPx(0.5, 0, t)
    expect(spin(replay)).toEqual(rolled(UPRIGHT, x1 - x0, y1 - y0, BALL_RADIUS))
  })
})

describe('shownBall', () => {
  const goal: GoalOverlay = { ball: { x: 50, y: 1 }, trail: [], net: { side: 1, y: 1, metres: 0 } }

  it('is the goal sequence’s ball while one plays', () => {
    expect(shownBall(frameWith(3), goal)).toEqual({ x: 50, y: 1 })
  })

  it('is the first tracked ball with a finite position', () => {
    const frame = {
      balls: [
        { projected_coordinates: { x: NaN, y: 0 } },
        { projected_coordinates: { x: 1, y: Infinity } },
        {},
        { projected_coordinates: { x: 2, y: 3 } },
      ],
    } as unknown as Frame
    expect(shownBall(frame, undefined)).toEqual({ x: 2, y: 3 })
  })

  it('is null without a tracked ball', () => {
    expect(shownBall({ balls: [] } as unknown as Frame, undefined)).toBeNull()
    expect(shownBall({} as Frame, undefined)).toBeNull()
  })
})

describe('BallRoll', () => {
  it('jumps rather than rolls beyond MAX_ROLL_STEP_METRES in one step', () => {
    const roll = new BallRoll()
    roll.roll(frameWith(0), undefined, true, false)
    roll.roll(frameWith(MAX_ROLL_STEP_METRES + 0.01), undefined, true, false)
    expect(roll.spin).toEqual(UPRIGHT)
    roll.roll(frameWith(MAX_ROLL_STEP_METRES + 0.02), undefined, true, false)
    expect(roll.spin).not.toEqual(UPRIGHT)
  })

  it('does not roll between the tracked ball and the goal’s, but rolls the goal’s ball when paused', () => {
    const goal: GoalOverlay = { ball: { x: 1, y: 0 }, trail: [], net: { side: 1, y: 0, metres: 0 } }
    const roll = new BallRoll()
    roll.roll(frameWith(0), undefined, true, false)
    roll.roll(frameWith(0), goal, false, false)
    expect(roll.spin).toEqual(UPRIGHT)
    roll.roll(frameWith(0), { ...goal, ball: { x: 1.5, y: 0 } }, false, false)
    expect(roll.spin).not.toEqual(UPRIGHT)
  })

  it('starts upright again on reset', () => {
    const roll = new BallRoll()
    roll.roll(frameWith(0), undefined, true, false)
    roll.roll(frameWith(1), undefined, true, false)
    roll.reset()
    expect(roll.spin).toEqual(UPRIGHT)
    roll.roll(frameWith(1.5), undefined, true, false)
    expect(roll.spin).toEqual(UPRIGHT)
  })
})
