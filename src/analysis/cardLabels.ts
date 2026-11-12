import { PLAYER_CARD_KEYS, labelCard, type PlayerCardKey } from '../model/labelCards.js'
import type { Frame } from '../model/types.js'
import { actionName, isHumanLabel } from './actionLabels.js'
import type { TeamId } from './teamPhase.js'

/**
 * A card a human gave, and who it is for, as its label on the live stream says it: since
 * 2026-11 the labelling tool sends the team (`team_id`) and the shirt number
 * (`player_number`) with a card, and every human label has its own `uuid`. Anything the label
 * does not say plainly is null: a team other than 0 or 1, and a number that is not a whole
 * number of 0 or more (the tracking writes -1 for one it could not read).
 */
export interface CardLabel {
  key: PlayerCardKey
  uuid: string | null
  team: TeamId | null
  number: number | null
}

/** Every card a human gave on `frame`, in the order its labels come. */
export function cardLabels(frame: Frame): CardLabel[] {
  const cards: CardLabel[] = []
  for (const action of frame.state?.actions ?? []) {
    if (!isHumanLabel(action)) continue
    const name = actionName(action.action_type)
    const key = PLAYER_CARD_KEYS.find((k) => (labelCard(k).labels as readonly string[]).includes(name))
    if (!key) continue
    const { uuid, team_id: team, player_number: number } = action
    cards.push({
      key,
      uuid: typeof uuid === 'string' && uuid !== '' ? uuid : null,
      team: team === 0 || team === 1 ? team : null,
      number: typeof number === 'number' && Number.isInteger(number) && number >= 0 ? number : null,
    })
  }
  return cards
}
