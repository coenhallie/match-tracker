import type { TrackerRecord } from '../model/types'
import { PHASE_LOOKBACK_S, teamPhaseAt, type TeamPhase } from './teamPhase'
import { TRAIL_LOOKBACK_S, ballTrailAt, type BallTrail } from './ballTrail'

/** How far back from a record the phase and the trail read, the longer of their two lookbacks. */
export const HISTORY_S = Math.max(PHASE_LOOKBACK_S, TRAIL_LOOKBACK_S)

/**
 * The records the frames before `at` decide its phase and trail from: those from
 * HISTORY_S before it up to it, de-duplicated by frame number with `at` itself
 * winning over any copy of it, and in time order.
 */
export function windowAt(records: readonly TrackerRecord[], at: TrackerRecord): TrackerRecord[] {
  const from = at.t - HISTORY_S
  const byFrame = new Map<number, TrackerRecord>()
  for (const r of records) {
    if (r.t >= from && r.t <= at.t) byFrame.set(r.frameCount, r)
  }
  byFrame.set(at.frameCount, at)
  return [...byFrame.values()].toSorted((a, b) => a.t - b.t)
}

/** The phase and the ball trail at `at`, from a window of records that holds it, in time order. */
export function deriveAt(
  window: readonly TrackerRecord[],
  at: TrackerRecord,
): { phase: TeamPhase; trail: BallTrail | null } {
  // By frame number: a window can hold its own copy of the record.
  const index = window.findIndex((r) => r.frameCount === at.frameCount)
  return { phase: teamPhaseAt(window, index), trail: ballTrailAt(window, index) }
}
