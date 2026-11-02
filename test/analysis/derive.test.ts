import { describe, it, expect } from 'vitest'
import { HISTORY_S, deriveAt, windowAt } from '../../src/analysis/derive'
import { PHASE_LOOKBACK_S, teamPhaseAt } from '../../src/analysis/teamPhase'
import { TRAIL_LOOKBACK_S, ballTrailAt } from '../../src/analysis/ballTrail'
import type { Frame, TrackerRecord } from '../../src/model/types'

const DT = 0.04

function frame(ball: { x: number; y: number } | null): Frame {
  return {
    pitch_dimensions: { length: 105, width: 68 },
    teams: [],
    balls: ball ? [{ projected_coordinates: { ...ball, z: 0 } }] : [],
  } as unknown as Frame
}

/** A record `frameCount` frames into the stream, DT apart, ball moving along x. */
function record(frameCount: number, x = frameCount * 0.5): TrackerRecord {
  return { t: 1000 + frameCount * DT, frameCount, frame: frame({ x, y: 0 }) }
}

const run = (n: number) => Array.from({ length: n }, (_, i) => record(i))

describe('HISTORY_S', () => {
  it('is the longer of the phase and trail lookbacks', () => {
    expect(HISTORY_S).toBe(Math.max(PHASE_LOOKBACK_S, TRAIL_LOOKBACK_S))
  })
})

describe('windowAt', () => {
  it('keeps the records from HISTORY_S before `at` up to `at`, oldest first', () => {
    const records = run(10)
    const at = records[6]!
    expect(windowAt(records, at).map((r) => r.frameCount)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('keeps the passed `at` when a cached record shares its frameCount', () => {
    const cached = record(5, 99)
    const at = record(5, 1)
    const window = windowAt([record(3), record(4), cached], at)
    expect(window).toHaveLength(3)
    const kept = window.find((r) => r.frameCount === 5)
    expect(kept).toBe(at)
    expect(kept).not.toBe(cached)
  })

  it('adds `at` when the records do not hold it', () => {
    const at = record(5)
    expect(windowAt([record(3), record(4)], at).map((r) => r.frameCount)).toEqual([3, 4, 5])
  })

  it('de-duplicates repeated frameCounts among the records', () => {
    const at = record(6)
    const window = windowAt([record(4), record(4), record(5), record(5)], at)
    expect(window.map((r) => r.frameCount)).toEqual([4, 5, 6])
  })

  it('excludes records older than HISTORY_S and records after `at`', () => {
    const at = record(1000)
    const old = { ...record(1), t: at.t - HISTORY_S - DT }
    const edge = { ...record(2), t: at.t - HISTORY_S }
    const later = { ...record(1001), t: at.t + DT }
    const window = windowAt([old, edge, later], at)
    expect(window.map((r) => r.frameCount)).toEqual([2, 1000])
  })

  it('sorts by t when the input is shuffled', () => {
    const records = run(8)
    const shuffled = [records[5]!, records[0]!, records[7]!, records[2]!, records[6]!, records[1]!, records[4]!]
    const window = windowAt(shuffled, records[7]!)
    expect(window.map((r) => r.frameCount)).toEqual([0, 1, 2, 4, 5, 6, 7])
  })

  it('does not change the records it is given', () => {
    const records = run(5)
    const copy = [...records]
    windowAt(records, records[4]!)
    expect(records).toEqual(copy)
  })
})

describe('deriveAt', () => {
  it('equals teamPhaseAt and ballTrailAt called directly at the index of `at`', () => {
    const at = record(30)
    const window = windowAt(run(31), at)
    const index = window.findIndex((r) => r.frameCount === at.frameCount)
    expect(index).toBe(window.length - 1)
    expect(deriveAt(window, at)).toEqual({
      phase: teamPhaseAt(window, index),
      trail: ballTrailAt(window, index),
    })
  })

  it('finds `at` by frameCount when it is not the last record', () => {
    const window = run(20)
    const at = window[12]!
    expect(deriveAt(window, at)).toEqual({
      phase: teamPhaseAt(window, 12),
      trail: ballTrailAt(window, 12),
    })
  })

  it('gives a trail that ends at the ball', () => {
    const at = record(30)
    const { trail } = deriveAt(windowAt(run(31), at), at)
    expect(trail?.runs.flat().at(-1)).toEqual({ x: 15, y: 0, age: 0 })
  })
})
