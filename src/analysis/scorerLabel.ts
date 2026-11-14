import { plainName } from '../model/parseRecord.js'
import type { Frame } from '../model/types.js'
import { actionName, isHumanLabel } from './actionLabels.js'
import { plainNumber, plainUuid, teamOfLabel, type LabelTeam } from './cardLabels.js'

/**
 * The scorer's label, by its bare name (actionName). In the labelling tool a goal is two labels:
 * "Goal" (or "Penalty scored", with the penalty's layer off), a game label that names the team, and
 * then, a few seconds later, the scorer, a player label the labeller gives from the player's row
 * (seen on staging, 2026-11-13: 2.4 and 4.8 s after the goal). "Player Own Goal" names a player of
 * the team that conceded, so it is not a scorer.
 */
export const SCORER_LABELS = ['player scored'] as const

/**
 * Who scored, as the scorer's label says it: its `uuid`, the team (teamOfLabel), the shirt number
 * (`player_number`) and the player's name (`player_name`, which parseRecord moves there from the
 * label's `raw_data`). Anything the label does not say plainly is null, as for a card (cardLabels.ts).
 */
export interface ScorerLabel extends LabelTeam {
  uuid: string | null
  number: number | null
  name: string | null
}

/** The scorer a human labelled on `frame`, the first if there are several, or null for none. */
export function scorerLabel(frame: Frame): ScorerLabel | null {
  const action = (frame.state?.actions ?? []).find(
    (a) => isHumanLabel(a) && (SCORER_LABELS as readonly string[]).includes(actionName(a.action_type)),
  )
  if (!action) return null
  return {
    uuid: plainUuid(action.uuid),
    ...teamOfLabel(action),
    number: plainNumber(action.player_number),
    name: plainName(action.player_name),
  }
}
