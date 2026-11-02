import { describe, it, expect } from 'vitest'
import {
  ballTrailAt,
  sameTrail,
  trailOpacity,
  MAX_GAP_S,
  TRAIL_FADE_S,
  TRAIL_HEAD_ALPHA,
  TRAIL_HISTORY_S,
  TRAIL_LOOKBACK_S,
  TRAIL_TAIL_ALPHA,
  TURN_ARM_METRES,
  type BallTrail,
} from '../../src/analysis/ballTrail'
import type { Frame } from '../../src/model/types'
import type { PhaseRecord } from '../../src/analysis/teamPhase'

const DT = 0.04

function frame(ball: { x: number; y: number } | null): Frame {
  return {
    pitch_dimensions: { length: 105, width: 68 },
    teams: [],
    balls: ball ? [{ projected_coordinates: { ...ball, z: 0 } }] : [],
  } as unknown as Frame
}

/** One record per step, DT apart, with the ball at `at(i)`. */
function play(steps: number, at: (i: number) => { x: number; y: number } | null): PhaseRecord[] {
  return Array.from({ length: steps }, (_, i) => ({ t: 1000 + i * DT, frame: frame(at(i)) }))
}

const last = (records: PhaseRecord[]) => ballTrailAt(records, records.length - 1)
const path = (trail: BallTrail | null) => (trail?.runs ?? []).flat()

/** Along x at 0.5 m a frame until frame `turnAt`, then along y. */
const corner = (turnAt: number) => (i: number) =>
  i <= turnAt ? { x: i * 0.5, y: 0 } : { x: turnAt * 0.5, y: (i - turnAt) * 0.5 }

describe('ballTrailAt', () => {
  it("keeps 2.1 seconds of the ball's path", () => {
    expect(TRAIL_HISTORY_S).toBe(2.1)
  })

  it('is the path the ball took, oldest first, ending at the ball', () => {
    const trail = last(play(20, (i) => ({ x: i * 0.5, y: 0 })))
    expect(trail?.runs).toHaveLength(1)
    const points = path(trail)
    expect(points).toHaveLength(20)
    expect(points.at(-1)).toEqual({ x: 9.5, y: 0, age: 0 })
    expect(points[0]).toMatchObject({ x: 0, y: 0 })
    expect(points[0]!.age).toBeCloseTo(19 * DT)
  })

  it('keeps every point where it is, frame to frame, only older', () => {
    // Short enough that none of it is old enough to drop off the end.
    const records = play(Math.floor(TRAIL_HISTORY_S / DT) - 1, corner(30))
    for (let i = 1; i < records.length; i++) {
      const before = path(ballTrailAt(records, i - 1))
      const after = path(ballTrailAt(records, i))
      for (const [k, p] of before.entries()) {
        expect(after[k]).toMatchObject({ x: p.x, y: p.y })
        expect(after[k]!.age).toBeCloseTo(p.age + DT)
      }
    }
  })

  it('shows the last TRAIL_HISTORY_S of it', () => {
    const steps = Math.round((TRAIL_HISTORY_S + 2) / DT)
    const points = path(last(play(steps, (i) => ({ x: i * 0.1, y: 0 }))))
    expect(points[0]!.age).toBeLessThanOrEqual(TRAIL_HISTORY_S)
    expect(points[0]!.age).toBeGreaterThan(TRAIL_HISTORY_S - DT)
  })

  it('marks a turn once, at its corner, once the ball has gone far enough past it', () => {
    const records = play(60, corner(30))
    // Not yet: the ball is not TURN_ARM_METRES past the corner.
    const early = 30 + Math.floor(TURN_ARM_METRES / 0.5) - 1
    expect(ballTrailAt(records, early)?.turns).toEqual([])
    const turns = last(records)!.turns
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ x: 15, y: 0 })
  })

  it('keeps a turn where it is from the moment it is marked', () => {
    const records = play(80, corner(30))
    let marked: { x: number; y: number } | null = null
    for (let i = 0; i < records.length; i++) {
      const turns = ballTrailAt(records, i)?.turns ?? []
      if (marked) expect(turns).toEqual([expect.objectContaining(marked)])
      else if (turns.length > 0) marked = { x: turns[0]!.x, y: turns[0]!.y }
    }
    expect(marked).not.toBeNull()
  })

  it('does not mark a slight change of direction', () => {
    const records = play(60, (i) => (i <= 30 ? { x: i * 0.5, y: 0 } : { x: 15 + (i - 30) * 0.5, y: (i - 30) * 0.15 }))
    expect(last(records)?.turns).toEqual([])
  })

  it('marks a ball sent back the way it came', () => {
    const records = play(60, (i) => ({ x: i <= 30 ? i * 0.5 : 15 - (i - 30) * 0.5, y: 0 }))
    expect(last(records)?.turns).toEqual([expect.objectContaining({ x: 15, y: 0 })])
  })

  it('marks no turns on a ball standing still, however it jitters', () => {
    const records = play(100, (i) => ({ x: 0.04 * Math.sin(i * 2.1), y: 0.04 * Math.cos(i * 1.3) }))
    expect(last(records)?.turns).toEqual([])
  })

  it('marks the turn of a ball received, held, and played on in a new direction', () => {
    // Received at frame 20 and held until 40, so the turn is still on screen
    // at the last frame.
    const records = play(70, (i) =>
      i <= 20 ? { x: i * 0.5, y: 0 } : i <= 40 ? { x: 10, y: 0 } : { x: 10, y: (i - 40) * 0.5 },
    )
    expect(last(records)?.turns).toEqual([expect.objectContaining({ x: 10, y: 0 })])
  })

  it('breaks the path where the ball went untracked too long, and joins a frame or two missing', () => {
    const lost = Math.ceil(MAX_GAP_S / DT) + 1
    const broken = play(40, (i) => (i >= 10 && i < 10 + lost ? null : { x: i * 0.5, y: 0 }))
    expect(last(broken)?.runs).toHaveLength(2)
    const joined = play(40, (i) => (i === 10 ? null : { x: i * 0.5, y: 0 }))
    expect(last(joined)?.runs).toHaveLength(1)
  })

  it('breaks the path where the tracked ball jumps further than any ball can move', () => {
    // From frame 20 it is picked up 30 m away and followed from there.
    const records = play(40, (i) => ({ x: i * 0.5, y: i < 20 ? 0 : 30 }))
    const runs = last(records)!.runs
    expect(runs).toHaveLength(2)
    expect(runs[0]!.at(-1)).toMatchObject({ x: 9.5, y: 0 })
    expect(runs[1]![0]).toMatchObject({ x: 10, y: 30 })
  })

  it('leaves out a jump for a single frame, and carries on the path', () => {
    const records = play(40, (i) => (i === 20 ? { x: 40, y: 25 } : { x: i * 0.5, y: 0 }))
    const runs = last(records)!.runs
    expect(runs).toHaveLength(1)
    expect(runs[0]!.some((p) => p.x === 40)).toBe(false)
    expect(runs[0]).toHaveLength(39)
  })

  it('measures speed over at least a frame, so a repeated timestamp is no jump', () => {
    const records = play(30, (i) => ({ x: i * 0.5, y: 0 }))
    records[15] = { ...records[15]!, t: records[14]!.t }
    expect(last(records)!.runs).toHaveLength(1)
  })

  it('has no trail without a tracked ball to draw one from', () => {
    expect(last(play(10, () => null))).toBeNull()
  })

  it('gives the same answer however much further back the records go', () => {
    const records = play(Math.round((TRAIL_LOOKBACK_S + 6) / DT), (i) => corner(200)(i % 400))
    const end = records.length - 1
    const enough = Math.round(TRAIL_LOOKBACK_S / DT)
    expect(ballTrailAt(records.slice(end - enough), enough)).toEqual(ballTrailAt(records, end))
  })
})

describe('trailOpacity', () => {
  it('is strongest at the ball and fades to nothing at the end of the history', () => {
    const fading = TRAIL_HISTORY_S - TRAIL_FADE_S
    expect(trailOpacity(0)).toBeCloseTo(TRAIL_HEAD_ALPHA)
    expect(trailOpacity(fading / 2)).toBeLessThan(trailOpacity(fading / 4))
    expect(trailOpacity(fading)).toBeCloseTo(TRAIL_TAIL_ALPHA)
    expect(trailOpacity(fading + TRAIL_FADE_S / 2)).toBeCloseTo(TRAIL_TAIL_ALPHA / 2)
    expect(trailOpacity(TRAIL_HISTORY_S)).toBe(0)
    expect(trailOpacity(TRAIL_HISTORY_S + 1)).toBe(0)
  })
})

describe('sameTrail', () => {
  it('tells trails that draw the same from those that do not', () => {
    const run = [
      { x: 0, y: 0, age: 1 },
      { x: 1, y: 0, age: 0 },
    ]
    const a = { runs: [run], turns: [] }
    expect(sameTrail(a, { runs: [run.map((p) => ({ ...p }))], turns: [] })).toBe(true)
    expect(sameTrail(a, { runs: [[run[0]!, { x: 1, y: 1, age: 0 }]], turns: [] })).toBe(false)
    expect(sameTrail(a, { runs: [run], turns: [run[0]!] })).toBe(false)
    expect(sameTrail(a, { runs: [run, run], turns: [] })).toBe(false)
    expect(sameTrail(a, null)).toBe(false)
    expect(sameTrail(null, null)).toBe(true)
  })
})
