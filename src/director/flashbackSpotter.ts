import { frameHasAction } from '../analysis/actionLabels.js'
import { isCornerFrame } from '../analysis/cornerLabel.js'
import { HISTORY_S } from '../analysis/derive.js'
import { isGoalFrame } from '../analysis/goalSequence.js'
import { penaltyLabels } from '../analysis/penaltyLabels.js'
import type { TeamPhase } from '../analysis/teamPhase.js'
import { KIND_RANK, type FlashbackKind, type SpottedMoment } from '../model/flashback.js'
import type { TrackerRecord } from '../model/types.js'
import { shownBall } from './ballRoll.js'
import { resolvePitchDimensions } from '../model/pitch.js'

/** A label kind is spotted again only after this long, in record time, without it. */
export const LABEL_REARM_S = 15
/** An end's penalty area is spotted again only after the ball has been outside it this long, in record time. */
export const AREA_REARM_S = 15

type End = 1 | -1

interface AreaState {
  armed: boolean
  /** The record time the ball was first seen outside the area, or null while it is in. */
  outsideSince: number | null
}

const freshAreas = (): Record<End, AreaState> => ({
  1: { armed: true, outsideSince: null },
  [-1]: { armed: true, outsideSince: null },
})

/** The labels a record can carry that a flashback is of, by their kind. */
function labelKinds(record: TrackerRecord): FlashbackKind[] {
  const { frame } = record
  const kinds: FlashbackKind[] = []
  if (isGoalFrame(frame)) kinds.push('goal')
  if (isCornerFrame(frame)) kinds.push('corner')
  if (frameHasAction(frame, 'shot on goal') || frameHasAction(frame, 'header on goal') || penaltyLabels(frame).result?.kind === 'missed') kinds.push('shot')
  return kinds
}

/**
 * Finds the moments worth a flashback in a stream of valid records: human labels (a goal, a corner, a
 * shot or header on goal) and the ball entering the penalty area the team in possession attacks.
 * Called with valid, unturned records in time order.
 */
export class FlashbackSpotter {
  private lastSeen = new Map<FlashbackKind, number>()
  private areas = freshAreas()
  private lastT: number | null = null

  /** The most important moment this record is the start of, or null. */
  spot(record: TrackerRecord, phase: TeamPhase | null): SpottedMoment | null {
    const { t } = record
    if (this.lastT !== null && t < this.lastT - HISTORY_S) this.reset()
    this.lastT = t

    const found: FlashbackKind[] = []
    for (const kind of labelKinds(record)) {
      const seen = this.lastSeen.get(kind)
      this.lastSeen.set(kind, t)
      if (seen === undefined || t - seen > LABEL_REARM_S) found.push(kind)
    }
    if (this.spotAttack(record, phase)) found.push('attack')

    if (found.length === 0) return null
    const kind = found.reduce((best, k) => (KIND_RANK[k] < KIND_RANK[best] ? k : best))
    return { kind, at: t, frameCount: record.frameCount }
  }

  /** Forget everything seen. */
  reset(): void {
    this.lastSeen = new Map()
    this.areas = freshAreas()
    this.lastT = null
  }

  /** Whether the ball has entered an armed penalty area that the team in possession attacks. */
  private spotAttack(record: TrackerRecord, phase: TeamPhase | null): boolean {
    const ball = shownBall(record.frame, undefined)
    if (!ball) return false
    const { t } = record
    const pitch = resolvePitchDimensions(record.frame.pitch_dimensions)
    const half = pitch.length.value / 2
    const inWidth = Math.abs(ball.y) <= pitch.penalty_area_width.value / 2
    const attacked = phase && phase.possession !== null ? phase.attacks[phase.possession] : null

    let spotted = false
    for (const end of [1, -1] as const) {
      const area = this.areas[end]
      const inside = Math.sign(ball.x) === end && Math.abs(ball.x) >= half - pitch.penalty_area_length.value && inWidth
      if (!inside) {
        area.outsideSince ??= t
        if (t - area.outsideSince >= AREA_REARM_S) area.armed = true
        continue
      }
      if (area.outsideSince !== null && t - area.outsideSince >= AREA_REARM_S) area.armed = true
      area.outsideSince = null
      if (area.armed && attacked === end) {
        area.armed = false
        spotted = true
      }
    }
    return spotted
  }
}
