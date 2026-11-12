import { PLAYER_CARD_KEYS, labelCard, type PlayerCardKey } from '../model/labelCards.js'
import { plainName } from '../model/parseRecord.js'
import type { Frame } from '../model/types.js'
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
export interface CardLabel {
  key: PlayerCardKey
  uuid: string | null
  team: TeamId | null
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
    cards.push({ key, uuid: plainUuid(action.uuid), team: plainTeam(action.team_id), number: plainNumber(action.player_number), name: plainName(action.player_name) })
  }
  return cards
}

/** A label's uuid, or null when it has none. */
export const plainUuid = (uuid: unknown): string | null => (typeof uuid === 'string' && uuid !== '' ? uuid : null)

/** A label's team, 0 or 1, or null for anything else. */
export const plainTeam = (team: unknown): TeamId | null => (team === 0 || team === 1 ? team : null)

/** A whole number of 0 or more, or null for anything else. */
export const plainNumber = (number: unknown): number | null =>
  typeof number === 'number' && Number.isInteger(number) && number >= 0 ? number : null
