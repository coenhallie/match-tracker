/**
 * The label cards: moments that show one card when a human labels a frame with
 * one of their names (Figma "Game Animation Visualizer"). They come in two
 * sizes, and within a size look and behave alike:
 *  - `centre`: across the middle of the pitch, everyone on it faded out, a title
 *    over an icon or a short text (viewport/eventVarCheck, node 75:2219,
 *    viewport/eventGoalDisallowed, node 80:3826, viewport/eventHalfTime, node
 *    81:4300, viewport node 81:4535 for the second half, and the same for the
 *    full time).
 *  - `small`: the title alone on a band along the bottom touchline, the pitch
 *    left as it is (viewport/eventFoul, node 75:461, viewport/eventShotOnGoal,
 *    node 80:4078, viewport/eventHeaderOnGoal, node 80:4173). The throw-in is the
 *    same card, but its own moment, as the parity test compares its timing with
 *    the reference's (throwIn.ts).
 *
 * Each card here is a layer of its own in the layers menu and a moment the
 * host can play by hand, under its key. To add one, add it here, then give it
 * its title in DEFAULT_THEME (theme.ts) and its title and its layer's words in
 * every locale (src/i18n), and its NOTHING_AVAILABLE entry in the Vue entry.
 * A small card needs nothing more. With an icon, add the icon (src/assets/icons.ts) and where that goes on the
 * card (labelCard.ts in render). With a text, add it in the same places as the
 * title, under the key + "Text". The compiler points at each. Everything else
 * is shared: the director's moment (labelCard.ts in director) and the drawing
 * (labelCard.ts in render).
 *
 * The order matters only for a frame carrying two cards' labels: the later
 * one here plays, as an outcome goes after what led to it.
 */
export const LABEL_CARDS = [
  /** Matched as actionName reads a label, so "VAR check", "VAR_CHECK" and "EventType.VAR_CHECK" are all one. */
  { key: 'varCheck', labels: ['var check'], size: 'centre', below: 'icon', until: 'labelOff', makesWay: true },
  /**
   * Matched whole, so it is not the goal's label, and no goal plays on it (actionName, frameHasAction). The team
   * its label names is written under the band (labelTeam in analysis).
   */
  { key: 'goalDisallowed', labels: ['goal disallowed'], size: 'centre', below: 'icon', until: 'labelOff', makesWay: true, team: true },
  /**
   * "Half time", "half-time" and "HALF_TIME" read as "half time"; "Halftime" is the same words written as one.
   * The labelling tool's button says "Half Time", but it sends "End first half", renamed "End FirstHalf" on saving.
   */
  { key: 'halfTime', labels: ['half time', 'halftime', 'end firsthalf', 'end first half'], size: 'centre', below: 'text', until: 'nextLabel', makesWay: true },
  /** The labelling tool's button says "Second Half", but it sends "Start second half". */
  { key: 'secondHalf', labels: ['second half', 'start second half'], size: 'centre', below: 'text', until: 'labelOff', makesWay: true },
  /** As for "Halftime", "Fulltime" is the same words written as one. The labelling tool sends "End second half", renamed "End SecondHalf" on saving. */
  { key: 'fullTime', labels: ['full time', 'fulltime', 'end secondhalf', 'end second half'], size: 'centre', below: 'text', until: 'nextLabel', makesWay: true },
  { key: 'foul', labels: ['foul'], size: 'small', below: 'nothing', until: 'time', makesWay: true },
  // A shot or a header on goal is what the zoom near goal is there for: it stays in.
  { key: 'shotOnGoal', labels: ['shot on goal'], size: 'small', below: 'nothing', until: 'time', makesWay: false },
  { key: 'headerOnGoal', labels: ['header on goal'], size: 'small', below: 'nothing', until: 'time', makesWay: false },
  /**
   * The player cards: the team and the player under the band, from the label (cardLabels.ts in analysis). The
   * labelling tool sends "Player yellow card" and "Player red card". Each plays in turn (cardQueue.ts in director).
   */
  { key: 'yellowCard', labels: ['player yellow card', 'yellow card'], size: 'centre', below: 'icon', until: 'labelOff', makesWay: true, player: { color: '#EAB308' } },
  { key: 'redCard', labels: ['player red card', 'red card'], size: 'centre', below: 'icon', until: 'labelOff', makesWay: true, player: { color: '#EF4444' } },
  /**
   * A team's substitutions, listed under the band, each joining the card while it is up (labelCard.ts in director).
   * The labelling tool sends "substitute".
   */
  { key: 'substitution', labels: ['substitute', 'substitution'], size: 'centre', below: 'icon', until: 'labelOff', makesWay: true, substitution: true },
] as const satisfies ReadonlyArray<{
  key: string
  labels: readonly string[]
  size: 'centre' | 'small'
  /** What is under the title. */
  below: 'icon' | 'text' | 'nothing'
  /**
   * How long it stays: `time`, as long as a throw-in does, whatever its label
   * does; `labelOff`, a little while and for as long as its label is on;
   * `nextLabel`, until a human gives any other label, however long that is.
   */
  until: 'time' | 'labelOff' | 'nextLabel'
  /** Whether the zoom near goal eases out to the whole pitch while it shows. */
  makesWay: boolean
  /** A card about a player: the team and the player under the band, with a small card in `color` (and the icon's card). */
  player?: { color: string }
  /** The substitution card: a team's substitutions listed under the band. */
  substitution?: true
  /** A card about a team: the team its label names under the band, and nothing more. */
  team?: true
}>

type Card = (typeof LABEL_CARDS)[number]

export type LabelCardKey = Card['key']
/** The cards with an icon under the title. */
export type IconCardKey = Extract<Card, { below: 'icon' }>['key']
/** The cards with a short text under the title. */
export type TextCardKey = Extract<Card, { below: 'text' }>['key']
/** Where a card's short text is kept, beside its title. */
export type LabelCardTextKey = `${TextCardKey}Text`

const keysOf = <K extends LabelCardKey>(cards: readonly Card[]): readonly K[] => cards.map((card) => card.key as K)

/** The cards about a player. */
export type PlayerCardKey = Extract<Card, { player: { color: string } }>['key']

/** Every card's key, in LABEL_CARDS order. */
export const LABEL_CARD_KEYS: readonly LabelCardKey[] = keysOf(LABEL_CARDS)
export const ICON_CARD_KEYS: readonly IconCardKey[] = keysOf(LABEL_CARDS.filter((card) => card.below === 'icon'))
export const TEXT_CARD_KEYS: readonly TextCardKey[] = keysOf(LABEL_CARDS.filter((card) => card.below === 'text'))

/** The cards about a player, in LABEL_CARDS order. */
export const PLAYER_CARD_KEYS: readonly PlayerCardKey[] = keysOf(LABEL_CARDS.filter((card) => 'player' in card))

/** Whether `key` names a card about a team, which writes the team its label names under the band. */
export function isTeamCardKey(key: LabelCardKey): boolean {
  return 'team' in labelCard(key)
}

/** Whether `key` names the substitution card. */
export function isSubstitutionKey(key: string): key is 'substitution' {
  return key === 'substitution'
}

/** Whether `key` names a card about a player. */
export function isPlayerCardKey(key: string): key is PlayerCardKey {
  return (PLAYER_CARD_KEYS as readonly string[]).includes(key)
}

/** The colour of the card under `key`, on its icon and its small card. */
export const playerCardColor = (key: PlayerCardKey): string => {
  const card = labelCard(key)
  return 'player' in card ? card.player.color : ''
}

/** Whether `key` names a label card. */
export function isLabelCardKey(key: string): key is LabelCardKey {
  return (LABEL_CARD_KEYS as readonly string[]).includes(key)
}

/** The card under `key`. */
export const labelCard = (key: LabelCardKey): Card => LABEL_CARDS.find((card) => card.key === key)!

/** Where the short text of the card under `key` is kept. */
export const labelCardTextKey = (key: TextCardKey): LabelCardTextKey => `${key}Text`

const record = <K extends string, T>(keys: readonly K[], value: (key: K) => T) =>
  Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<K, T>

/** A value for every card, by its key. */
export const labelCardRecord = <T>(value: (key: LabelCardKey) => T) => record(LABEL_CARD_KEYS, value)
/** A value for every card with an icon, by its key. */
export const iconCardRecord = <T>(value: (key: IconCardKey) => T) => record(ICON_CARD_KEYS, value)
/** Every card's short text, by where it is kept. */
export const labelCardTextRecord = (value: (key: LabelCardTextKey) => string) =>
  record(TEXT_CARD_KEYS.map(labelCardTextKey), value)
