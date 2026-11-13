import type { Frame } from '../model/types.js'
import { frameHasAction } from './actionLabels.js'
import { labelTeam, type LabelTeam } from './cardLabels.js'

/**
 * The free kick's labels, by their bare names (actionName). The labelling tool sends "Freekick"
 * (its actionMap renames "free kick" so on saving); "Free kick", "FREE_KICK" and
 * "EventType.FREE_KICK" read as "free kick".
 */
export const FREE_KICK_LABELS = ['free kick', 'freekick'] as const

/** Whether a human labelled this frame a free kick, however the label writes it. */
export function isFreeKickFrame(frame: Frame): boolean {
  return FREE_KICK_LABELS.some((name) => frameHasAction(frame, name))
}

/** The team a human's free kick label on `frame` gives (labelTeam). */
export function freeKickTeam(frame: Frame): LabelTeam {
  return labelTeam(frame, FREE_KICK_LABELS)
}
