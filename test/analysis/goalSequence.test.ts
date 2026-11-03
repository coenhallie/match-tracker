import { describe, it, expect } from 'vitest'
import {
  isGoalFrame,
  planGoal,
  goalStateAt,
  goalCamera,
  goalCameraWeight,
  GOAL_SEQUENCE_MS,
  NET_DEPTH_METRES,
} from '../../src/analysis/goalSequence'
import { build2DTransform, worldToPx } from '../../src/render/pitchGeometry'
import { FRAME_W, FRAME_H } from '../../src/render/constants'
import type { Frame } from '../../src/model/types'

const PITCH = { length: 105, width: 68, goal_width: 7.32 }
const HALF = PITCH.length / 2

function frame(opts: { actions?: string[]; ball?: { x: number; y: number } | null }): Frame {
  return {
    pitch_dimensions: PITCH,
    teams: [],
    balls: opts.ball ? [{ projected_coordinates: opts.ball }] : [],
    state: { actions: (opts.actions ?? []).map((action_type) => ({ action_type, action_origin: 'human' })) },
  } as unknown as Frame
}

describe('isGoalFrame', () => {
  it('recognises a GOAL label, whatever its case or padding', () => {
    for (const label of ['GOAL', 'Goal', ' goal ']) {
      expect(isGoalFrame(frame({ actions: [label] }))).toBe(true)
    }
  })

  // "Goal kick" is in the real export 43 times; it is a restart, not a goal.
  it('does not mistake a goal kick for a goal', () => {
    expect(isGoalFrame(frame({ actions: ['Goal kick'] }))).toBe(false)
  })

  it('finds the label among other actions', () => {
    expect(isGoalFrame(frame({ actions: ['other', 'GOAL'] }))).toBe(true)
  })

  // The Manchester City vs PSG export names its labels "EventType.THROW_IN"
  // and so on, where the February one said "Throw in".
  it('recognises the label with its EventType prefix', () => {
    expect(isGoalFrame(frame({ actions: ['EventType.GOAL'] }))).toBe(true)
    expect(isGoalFrame(frame({ actions: ['EventType.GOAL_KICK'] }))).toBe(false)
    expect(isGoalFrame(frame({ actions: ['EventType.BALL_IN_PLAY'] }))).toBe(false)
  })

  it('is false for a frame without actions', () => {
    expect(isGoalFrame(frame({}))).toBe(false)
  })
})

describe('planGoal', () => {
  it('shoots at the goal nearest the ball', () => {
    expect(planGoal(frame({ ball: { x: 40, y: 2 } }))?.side).toBe(1)
    expect(planGoal(frame({ ball: { x: -30, y: -5 } }))?.side).toBe(-1)
  })

  it('starts from the ball when it is a sensible distance out', () => {
    const plan = planGoal(frame({ ball: { x: 35, y: 6 } }))!
    expect(plan.start).toEqual({ x: 35, y: 6 })
  })

  // The tracked ball can be anywhere, including 175 m behind the goal line in
  // the real export. A shot from there would be nonsense.
  it('starts in front of goal when the ball is off the pitch or already at the goal', () => {
    for (const ball of [
      { x: 228, y: 1 },
      { x: 53, y: 0.5 },
      { x: 50, y: 40 },
    ]) {
      const plan = planGoal(frame({ ball }))!
      expect(Math.abs(plan.start.x)).toBeLessThan(HALF - 8)
      expect(Math.abs(plan.start.y)).toBeLessThanOrEqual(PITCH.width / 2)
      expect(Math.sign(plan.start.x)).toBe(plan.side)
    }
  })

  it('aims between the posts', () => {
    const plan = planGoal(frame({ ball: { x: 30, y: 25 } }))!
    expect(Math.abs(plan.impact.y)).toBeLessThan(PITCH.goal_width / 2)
  })

  it('plans nothing without a usable ball, rather than inventing a goal', () => {
    expect(planGoal(frame({ ball: null }))).toBeNull()
    expect(planGoal(frame({ ball: { x: Number.NaN, y: 0 } }))).toBeNull()
  })
})

describe('goalStateAt', () => {
  const plan = planGoal(frame({ ball: { x: 30, y: 8 } }))!
  const samples = Array.from({ length: 400 }, (_, i) => (i / 399) * GOAL_SEQUENCE_MS)

  it('starts where the shot is taken from', () => {
    const s = goalStateAt(plan, 0)
    expect(s.ball.x).toBeCloseTo(plan.start.x, 6)
    expect(s.ball.y).toBeCloseTo(plan.start.y, 6)
  })

  it('ends at rest inside the net', () => {
    const end = goalStateAt(plan, GOAL_SEQUENCE_MS).ball
    expect(Math.abs(end.x)).toBeGreaterThan(HALF)
    expect(Math.abs(end.x)).toBeLessThan(HALF + NET_DEPTH_METRES)
    expect(Math.abs(end.y)).toBeLessThan(PITCH.goal_width / 2)
  })

  // The point of the sequence: the tracked ball sails straight through.
  it('never goes through the back of the net', () => {
    for (const t of samples) {
      expect(Math.abs(goalStateAt(plan, t).ball.x)).toBeLessThanOrEqual(HALF + NET_DEPTH_METRES)
    }
  })

  it('never comes back out over the goal line once it is in', () => {
    const inAt = samples.find((t) => Math.abs(goalStateAt(plan, t).ball.x) > HALF)!
    for (const t of samples.filter((t) => t >= inAt)) {
      expect(Math.abs(goalStateAt(plan, t).ball.x)).toBeGreaterThan(HALF)
    }
  })

  it('only ever bows the net outwards', () => {
    for (const t of samples) expect(goalStateAt(plan, t).netBulge).toBeGreaterThanOrEqual(0)
  })

  it('bulges the net only once the ball hits it, then lets it settle', () => {
    expect(goalStateAt(plan, 0).netBulge).toBe(0)
    const peak = Math.max(...samples.map((t) => Math.abs(goalStateAt(plan, t).netBulge)))
    expect(peak).toBeGreaterThan(0.3)
    expect(Math.abs(goalStateAt(plan, GOAL_SEQUENCE_MS).netBulge)).toBeLessThan(0.02)
  })

  it('holds its final state past the end', () => {
    expect(goalStateAt(plan, GOAL_SEQUENCE_MS * 2)).toEqual(goalStateAt(plan, GOAL_SEQUENCE_MS))
  })
})

describe('goalCamera', () => {
  const T = build2DTransform(PITCH)
  const visible = (cam: { zoom: number; x: number; y: number }, x: number, y: number) => {
    const [px, py] = worldToPx(x, y, T)
    const halfW = FRAME_W / (2 * cam.zoom)
    const halfH = FRAME_H / (2 * cam.zoom)
    return Math.abs(px - cam.x) <= halfW && Math.abs(py - cam.y) <= halfH
  }

  for (const [name, ball] of [
    ['a long shot', { x: 10, y: 18 }],
    ['a close shot', { x: 40, y: -6 }],
    ['the fallback start', { x: 228, y: 1 }],
  ] as const) {
    it(`frames the shot and the whole net for ${name}`, () => {
      const plan = planGoal(frame({ ball }))!
      const cam = goalCamera(plan, PITCH)
      expect(visible(cam, plan.start.x, plan.start.y)).toBe(true)
      for (const y of [-PITCH.goal_width / 2, PITCH.goal_width / 2]) {
        expect(visible(cam, plan.side * (HALF + NET_DEPTH_METRES), y)).toBe(true)
      }
    })
  }

  it('zooms in, but not so far that the play loses its context', () => {
    for (const ball of [
      { x: 10, y: 18 },
      { x: 40, y: -6 },
      { x: -44, y: 0 },
    ]) {
      const cam = goalCamera(planGoal(frame({ ball }))!, PITCH)
      expect(cam.zoom).toBeGreaterThanOrEqual(1.4)
      expect(cam.zoom).toBeLessThanOrEqual(3)
    }
  })

  it('never shows past the edge of the frame', () => {
    const cam = goalCamera(planGoal(frame({ ball: { x: 50, y: 30 } }))!, PITCH)
    const halfW = FRAME_W / (2 * cam.zoom)
    const halfH = FRAME_H / (2 * cam.zoom)
    expect(cam.x - halfW).toBeGreaterThanOrEqual(-1e-9)
    expect(cam.x + halfW).toBeLessThanOrEqual(FRAME_W + 1e-9)
    expect(cam.y - halfH).toBeGreaterThanOrEqual(-1e-9)
    expect(cam.y + halfH).toBeLessThanOrEqual(FRAME_H + 1e-9)
  })
})

describe('goalCameraWeight', () => {
  it('starts at the normal view and is fully zoomed in quickly', () => {
    expect(goalCameraWeight(0)).toBe(0)
    expect(goalCameraWeight(500)).toBe(1)
  })

  it('eases in, rather than jumping', () => {
    const early = goalCameraWeight(60)
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(0.6)
  })

  it('holds while the ball goes in and settles', () => {
    for (const t of [600, 1200, 2000]) expect(goalCameraWeight(t)).toBe(1)
  })

  it('eases back out to the normal view by the end', () => {
    const tail = [2700, 2850, 3000, 3150].map(goalCameraWeight)
    for (let i = 1; i < tail.length; i++) expect(tail[i]).toBeLessThan(tail[i - 1]!)
    expect(goalCameraWeight(GOAL_SEQUENCE_MS)).toBe(0)
  })
})
