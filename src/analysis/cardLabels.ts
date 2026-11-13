import { PLAYER_CARD_KEYS, labelCard, type PlayerCardKey } from '../model/labelCards.js'
import { isHome, plainName } from '../model/parseRecord.js'
import type { Frame, FrameAction } from '../model/types.js'
import { actionName, isHumanLabel } from './actionLabels.js'
import type { TeamId } from './teamPhase.js'

/**
 * A card a human gave, and who it is for, as its label on the live stream says it: since
 * 2026-11 the labelling tool sends the team (`team_id`) and the shirt number
 * (`player_number`) with a card, and every human label has its own `uuid`; since 2026-11-12 the player's
 * name (`player_name`, which parseRecord moves there from the label's `raw_data`). Anything the label
 * does not say plainly is null: a team other than 0 or 1, and a number that is not a whole
 * number of 0 or more (the tracking writes -1 for one it could not read).
 */
export interface CardLabel extends LabelTeam {
  key: PlayerCardKey
  uuid: string | null
  number: number | null
  /** The player's name, from the labelling tool, or null when it has none (parseRecord's plainName). */
  name: string | null
}

/** Every card a human gave on `frame`, in the order its labels come. */
export function cardLabels(frame: Frame): CardLabel[] {
  const cards: CardLabel[] = []
  for (const action of frame.state?.actions ?? []) {
    if (!isHumanLabel(action)) continue
    const name = actionName(action.action_type)
    const key = PLAYER_CARD_KEYS.find((k) => (labelCard(k).labels as readonly string[]).includes(name))
    if (!key) continue
    cards.push({ key, uuid: plainUuid(action.uuid), ...teamOfLabel(action), number: plainNumber(action.player_number), name: plainName(action.player_name) })
  }
  return cards
}

/**
 * The team a human's label gives: its side (`team`, 0 home or 1 away), and its name as the labelling
 * tool has it (`teamName`), each null when the label does not say. The exports' labels say neither.
 */
export interface LabelTeam {
  team: TeamId | null
  teamName: string | null
}

/** No team: a label that says neither its side nor its name. */
export const NO_TEAM: LabelTeam = Object.freeze({ team: null, teamName: null })

/**
 * The team `action`, a human's label, gives. The side is its `is_home` (isHome) on a label that names
 * a team, by a `team_id` or a `team_name`, else its `team_id` when that is a side. Staging's `team_id`
 * is the side, but production's is the team's id in its backend (807), which says none: there only
 * `is_home` does (2026-11-13). Production also writes `is_home` 0 on a label about no team, as its
 * "Kick off", which is no side. The name is its `team_name`. parseRecord puts both from the label's
 * `raw_data` on the entry.
 */
export function teamOfLabel(action: FrameAction): LabelTeam {
  const teamName = plainName(action.team_name)
  const namesTeam = teamName !== null || (action.team_id !== undefined && action.team_id !== null)
  const home = namesTeam ? isHome(action.is_home) : null
  return { team: home === null ? plainTeam(action.team_id) : home ? 0 : 1, teamName }
}

/**
 * The team a human's label named `names` (bare names, actionName) gives on `frame` (teamOfLabel), from
 * the first of them that gives a side or a name. NO_TEAM when none does, as the exports' labels do not.
 */
export function labelTeam(frame: Frame, names: readonly string[]): LabelTeam {
  for (const action of frame.state?.actions ?? []) {
    if (!isHumanLabel(action) || !names.includes(actionName(action.action_type))) continue
    const team = teamOfLabel(action)
    if (team.team !== null || team.teamName !== null) return team
  }
  return NO_TEAM
}

/** A label's uuid, or null when it has none. */
export const plainUuid = (uuid: unknown): string | null => (typeof uuid === 'string' && uuid !== '' ? uuid : null)

/** A label's team, 0 or 1, or null for anything else. */
export const plainTeam = (team: unknown): TeamId | null => (team === 0 || team === 1 ? team : null)

/** A whole number of 0 or more, or null for anything else. */
export const plainNumber = (number: unknown): number | null =>
  typeof number === 'number' && Number.isInteger(number) && number >= 0 ? number : null
