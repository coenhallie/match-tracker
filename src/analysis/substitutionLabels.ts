import { labelCard } from '../model/labelCards.js'
import { plainName } from '../model/parseRecord.js'
import type { Frame } from '../model/types.js'
import { actionName, isHumanLabel } from './actionLabels.js'
import { plainNumber, plainTeam, plainUuid } from './cardLabels.js'
import type { TeamId } from './teamPhase.js'

/**
 * A substitution a human gave, as its label on the live stream says it: the team (`team_id`), the
 * player going off (`from`) and the one coming on (`to`), as the labelling tool's roster ids,
 * which are read as shirt numbers (naming leaves out one that cannot be). Anything the label does
 * not say plainly is null, as for a card (cardLabels.ts). Since 2026-11-12 the label also names the
 * two players (`player_name_out` going off, `player_name` coming on), when the labeller has the names.
 */
export interface SubstitutionLabel {
  key: 'substitution'
  uuid: string | null
  team: TeamId | null
  from: number | null
  to: number | null
  /** The player going off's name, or null when the label has none (parseRecord's plainName). */
  fromName: string | null
  /** The player coming on's name, or null when the label has none. */
  toName: string | null
}

/** Every substitution a human gave on `frame`, in the order its labels come. */
export function substitutionLabels(frame: Frame): SubstitutionLabel[] {
  const names = labelCard('substitution').labels as readonly string[]
  return (frame.state?.actions ?? [])
    .filter((action) => isHumanLabel(action) && names.includes(actionName(action.action_type)))
    .map((action) => ({
      key: 'substitution',
      uuid: plainUuid(action.uuid),
      team: plainTeam(action.team_id),
      from: plainNumber(action.from),
      to: plainNumber(action.to),
      fromName: plainName(action.player_name_out),
      toName: plainName(action.player_name),
    }))
}
