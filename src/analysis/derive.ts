import type { TrackerRecord } from '../model/types.js'
import { PHASE_LOOKBACK_S, teamPhaseAt, type TeamPhase } from './teamPhase.js'
import { TRAIL_LOOKBACK_S, ballTrailAt, type BallTrail } from './ballTrail.js'

/** How far back from a record the phase and the trail read, the longer of their two lookbacks. */
export const HISTORY_S = Math.max(PHASE_LOOKBACK_S, TRAIL_LOOKBACK_S)

/**
 * HISTORY_S, as the package exports it: how many seconds of records before
 * the one on screen a replay host passes as `lookback`. Fewer is drawn with
 * less phase and trail than the reference has; more is trimmed.
 */
export const REPLAY_LOOKBACK_S: number = HISTORY_S

/**
 * The records the frames before `at` decide its phase and trail from: those from
 * HISTORY_S before it up to it, de-duplicated by frame number with `at` itself
 * winning over any copy of it, and in time order.
 *
 * The order is the replay's, tie for tie. `at` is placed first and the other records
 * follow in input order, then the whole is sorted by t with a stable sort. So among
 * records with one t, `at` comes first and the others keep their input order: a record
 * sharing `at`'s t sorts after it, and is left out of its phase and trail.
 */
export function windowAt(records: readonly TrackerRecord[], at: TrackerRecord): TrackerRecord[] {
  const from = at.t - HISTORY_S
  const byFrame = new Map<number, TrackerRecord>([[at.frameCount, at]])
  for (const r of records) {
    if (r.frameCount !== at.frameCount && r.t >= from && r.t <= at.t) byFrame.set(r.frameCount, r)
  }
  // sort() on a fresh array rather than toSorted(): toSorted needs ES2023 (Safari 16), the widget targets ES2022.
  return [...byFrame.values()].sort((a, b) => a.t - b.t)
}

/** Where `at` is in `window`: by frame number, as a window can hold its own copy of the record. */
const indexIn = (window: readonly TrackerRecord[], at: TrackerRecord): number =>
  window.findIndex((r) => r.frameCount === at.frameCount)

/** The phase and the ball trail at `at`, from a window of records that holds it, in time order. */
export function deriveAt(
  window: readonly TrackerRecord[],
  at: TrackerRecord,
): { phase: TeamPhase; trail: BallTrail | null } {
  const index = indexIn(window, at)
  return { phase: teamPhaseAt(window, index), trail: ballTrailAt(window, index) }
}

/** The phase at `at` as deriveAt gives it, without the trail, for a caller with no use for one. */
export function phaseAt(window: readonly TrackerRecord[], at: TrackerRecord): TeamPhase {
  return teamPhaseAt(window, indexIn(window, at))
}
