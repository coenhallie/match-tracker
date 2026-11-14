import type { Frame } from '../model/types.js'
import { frameHasAction, humanLabelNames } from './actionLabels.js'
import { labelTeam, type LabelTeam } from './cardLabels.js'

/**
 * The penalty's labels, by their bare names (actionName). The labelling tool sends "Penalty" for a
 * penalty given, and "Penalty scored" or "Penalty missed" for its result; other exports write
 * "PENALTY_SCORED", "PenaltyScored" or "Penalty goal".
 */
export const PENALTY_LABELS: readonly string[] = ['penalty']

/** A penalty scored: a goal from the spot, unless the penalty layer plays it as its own scene. */
export const PENALTY_SCORED_LABELS: readonly string[] = [
  'penalty scored',
  'penaltyscored',
  'penalty goal',
  'penaltygoal',
  'penalty kick scored',
  'penalty kick goal',
  'scored penalty',
]

/** A penalty missed, whether it was saved or went wide. */
export const PENALTY_MISSED_LABELS: readonly string[] = ['penalty missed', 'penaltymissed', 'missed penalty', 'penalty kick missed']

export type PenaltyResult = 'scored' | 'missed'

const labelled = (frame: Frame, names: readonly string[]): boolean => names.some((name) => frameHasAction(frame, name))

/** The penalty labels a human put on `frame`: the penalty given and its result, each with the team it names. */
export function penaltyLabels(frame: Frame): { penalty: LabelTeam | null; result: { kind: PenaltyResult; team: LabelTeam } | null } {
  const penalty = labelled(frame, PENALTY_LABELS) ? labelTeam(frame, PENALTY_LABELS) : null
  const kind: PenaltyResult | null = labelled(frame, PENALTY_SCORED_LABELS) ? 'scored' : labelled(frame, PENALTY_MISSED_LABELS) ? 'missed' : null
  const names = kind === 'scored' ? PENALTY_SCORED_LABELS : PENALTY_MISSED_LABELS
  return { penalty, result: kind === null ? null : { kind, team: labelTeam(frame, names) } }
}

const PENALTY_NAMES = new Set([...PENALTY_LABELS, ...PENALTY_SCORED_LABELS, ...PENALTY_MISSED_LABELS])

/** The bare names (actionName) of the labels a human put on `frame` that are not the penalty's own. */
export function otherHumanLabels(frame: Frame): string[] {
  return humanLabelNames(frame).filter((name) => !PENALTY_NAMES.has(name))
}
