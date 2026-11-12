/**
 * What a host can ask of the widget, and what that comes to for the
 * renderer, the director and the layers.
 */
import type { TeamId } from '../analysis/teamPhase.js'
import type { DirectorOptions } from '../director/director.js'
import { formatText, resolveText, type TrackerLocale, type TrackerText, type TrackerTextOverrides } from '../i18n/text.js'
import { labelCardRecord, labelCardTextRecord } from '../model/labelCards.js'
import {
  DEFAULT_REPLAY_LAYERS,
  readReplayLayers,
  writeReplayLayers,
  type ReplayLayerKey,
  type ReplayLayers,
} from '../model/replayLayers.js'
import { PERSON_COLORS, type PersonColors } from '../render/constants.js'
import { DEFAULT_THEME, type PersonRole, type RenderTheme } from '../render/theme.js'

export interface TeamOptions {
  /** The team's name, in the attack's label and the phase row. Default: the colour it is drawn in ("Red", "Blue"). */
  name?: string
  /** The team's fill colour, on its players, its attack's shade and its phase label. */
  color?: string
  /**
   * The team's players' names, by shirt number, for the cards: `{ 9: 'Name' }`. A player with
   * no name here is shown by the number ("#9"; the moments' `playerNumber` text).
   */
  players?: Record<number, string>
}

export interface MatchTrackerOptions {
  /** `live`: fed with `push`, on the widget's own clock. `replay`: fed with `present`, on the host's. */
  mode: 'live' | 'replay'
  /**
   * The built-in text: 'en' or 'zh', or a language tag, read by its language
   * ('zh-CN', 'zh-TW' and 'zh-Hans' are 'zh'). Anything else is 'en'. Default 'en'.
   */
  locale?: TrackerLocale | (string & {})
  /**
   * The language of the words the moments write on the canvas: the cards'
   * titles and texts ("GOAL", "FOUL", "HALF TIME" and the rest) and the word
   * under the team's name in the attack's label. Read as `locale` is. Default
   * `locale`. For a host that wants them in one language whatever the rest is
   * in, such as English until a translation has been approved. `text`
   * overrides them as it does the rest.
   */
  momentLocale?: TrackerLocale | (string & {})
  /** Any of the text, in place of the locale's; for the layers menu, any word of any layer. */
  text?: TrackerTextOverrides
  /** Team 0 is home, team 1 away. */
  teams?: { home?: TeamOptions; away?: TeamOptions }
  /** The people's colours, by role, over video-annotation's. A team's `color` wins over its `fill` here. */
  colors?: Partial<Record<PersonRole, Partial<PersonColors>>>
  /** The layers shown where none have been chosen and kept. */
  layers?: Partial<ReplayLayers>
  /**
   * Whether the LAYERS button and menu are shown. Default true. When false
   * the layers are the defaults over `layers` and the kept choice is neither
   * read nor written, so the view always shows the canonical layers.
   */
  layersMenu?: boolean
  /**
   * Where the layer choice is kept in localStorage. Default
   * 'match-tracker.layers'; null keeps nothing. Fixed at mount, as `mode`
   * is: setOptions leaves it as it was.
   */
  layersStorageKey?: string | null
  /** The bottom-left text for one of a frame's actions, from its `action_type`. Default: as it comes. */
  formatAction?: (actionType: string) => string
  /**
   * Whether the bottom-left text lists the pipeline's AI labels too. Default
   * false: only the labels a human gave (`action_origin` "human"), the ones
   * the moments play on. For developers, as `layersMenu` is.
   */
  aiLabels?: boolean
  /**
   * When the second half starts, as the host knows it: a record time
   * (`TrackerRecord.t`, the pipeline's own timestamp, in seconds). From it on
   * the frames are shown turned round, as from a half label the widget sees
   * itself, and the earlier of the two is where the second half starts. Kept
   * through `reset()`, unlike the labels seen. A host keeps what the
   * `secondHalf` event says, for its match, and gives it back here, so a
   * reconnect, a reload or a seek past the labels still has the teams at the
   * right ends. Null or left out: only the labels seen. Anything but a finite
   * number is taken for null.
   */
  secondHalfFrom?: number | null
  /**
   * Developer mode: a badge over the pitch while fewer than 18 players are
   * tracked, saying how many are, and whose attack covers the loss when one
   * does. For telling a real attack from one shown over lost players.
   * Default false.
   */
  debug?: boolean
}

/** The options as the widget holds them: all but the mode. */
export type MutableOptions = Omit<MatchTrackerOptions, 'mode'>

/** What setOptions takes: every option but the two fixed at mount, `mode` and `layersStorageKey`. */
export type SettableOptions = Partial<Omit<MatchTrackerOptions, 'mode' | 'layersStorageKey'>>

export const DEFAULT_LAYERS_STORAGE_KEY = 'match-tracker.layers'

const ROLES: readonly PersonRole[] = ['home', 'away', 'goalkeeper', 'official', 'unknown']

/** The highest shirt number: a substitution's player above it is a roster id, not a number. */
const MAX_SHIRT_NUMBER = 99

/** What the options come to, worked out afresh on every change. */
export interface Resolved {
  /** The HUD's and the layers menu's words, in `locale`. */
  text: TrackerText
  /** The words the moments write on the canvas, in `momentLocale`. */
  momentText: TrackerText
  colors: Record<PersonRole, PersonColors>
  teamName: (team: TeamId) => string
  teamColor: (team: TeamId) => string
  /**
   * A carded player's name, or shirt number, as the moments write it: the host's name for the number
   * first, then the name the label gave (`labelName`), then the number.
   */
  playerName: (team: TeamId, number: number, labelName?: string | null) => string
  /**
   * A substituted player's name, or shirt number, or null: the substitution's players are roster ids,
   * so one above 99, not a shirt number, is shown only if the host names it.
   */
  substitutionName: (team: TeamId | null, number: number | null) => string | null
  formatAction: (actionType: string) => string
  aiLabels: boolean
}

export function resolveOptions(options: MutableOptions): Resolved {
  const text = resolveText(options.locale ?? 'en', options.text)
  const momentLocale = options.momentLocale ?? options.locale ?? 'en'
  // Resolved once, and only on a change of options: never per frame.
  const momentText = momentLocale === (options.locale ?? 'en') ? text : resolveText(momentLocale, options.text)
  // Every role a copy of its own, so nothing here can change PERSON_COLORS,
  // which every other instance on the page reads too.
  const colors = {} as Record<PersonRole, PersonColors>
  for (const role of ROLES) colors[role] = { ...PERSON_COLORS[role], ...options.colors?.[role] }
  const { home, away } = options.teams ?? {}
  if (home?.color) colors.home.fill = home.color
  if (away?.color) colors.away.fill = away.color
  const names: Record<TeamId, string> = { 0: home?.name || text.red, 1: away?.name || text.blue }
  const fills: Record<TeamId, string> = { 0: colors.home.fill, 1: colors.away.fill }
  const players: Record<TeamId, Record<number, string> | undefined> = { 0: home?.players, 1: away?.players }
  return {
    text,
    momentText,
    colors,
    teamName: (team) => names[team],
    teamColor: (team) => fills[team],
    playerName: (team, number, labelName) =>
      players[team]?.[number] || labelName || formatText(momentText.playerNumber, { number: String(number) }),
    substitutionName: (team, number) => {
      if (number === null) return null
      const name = team === null ? undefined : players[team]?.[number]
      if (name) return name
      return number <= MAX_SHIRT_NUMBER ? formatText(momentText.playerNumber, { number: String(number) }) : null
    },
    formatAction: options.formatAction ?? DEFAULT_THEME.formatAction,
    aiLabels: options.aiLabels ?? DEFAULT_THEME.aiLabels,
  }
}

/** The renderer's theme for `resolved`, with the cards' icons once they have loaded. */
export function themeFor(resolved: Resolved, icons: RenderTheme['icons']): RenderTheme {
  const text = resolved.momentText
  return {
    colors: resolved.colors,
    text: {
      goal: text.goal,
      corner: text.corner,
      throwIn: text.throwIn,
      attack: text.attack,
      flashback: text.flashback,
      flashbackAgo: text.flashbackAgo,
      ...labelCardRecord((key) => text[key]),
      ...labelCardTextRecord((key) => text[key]),
    },
    fonts: DEFAULT_THEME.fonts,
    icons,
    formatAction: resolved.formatAction,
    aiLabels: resolved.aiLabels,
  }
}

/**
 * Whether `matchMedia` says the user prefers reduced motion, at each ask, as the reference asks
 * afresh each time. It is asked several times an animation frame, so one MediaQueryList is made,
 * on the first ask, and read after: its `matches` follows the setting.
 */
export function prefersReducedMotion(): () => boolean {
  let query: MediaQueryList | null | undefined
  return () => {
    query ??= typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
    return query?.matches === true
  }
}

/** The director's options for `resolved`, the layers aside, asking `reducedMotion` (prefersReducedMotion). */
export function directorOptions(resolved: Resolved, reducedMotion: () => boolean): Omit<DirectorOptions, 'layers'> {
  return {
    reducedMotion,
    teamName: resolved.teamName,
    teamColor: resolved.teamColor,
    playerName: resolved.playerName,
    substitutionName: resolved.substitutionName,
  }
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Storage refused, as in some private modes: nothing is kept.
    return null
  }
}

/**
 * localStorage under `key`, in the shape readReplayLayers and
 * writeReplayLayers take, whichever key they name; null when nothing is kept.
 */
function layerStore(key: string | null): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (key === null) return null
  const storage = localStorageOrNull()
  if (!storage) return null
  return {
    getItem: () => storage.getItem(key),
    setItem: (_name, value) => storage.setItem(key, value),
  }
}

/** Whether the layers menu is on: it is unless the host turned it off. */
export function layersMenuOn(options: MutableOptions): boolean {
  return options.layersMenu !== false
}

/** The layers with no menu and nothing kept: the defaults, over the host's `layers`. */
export function canonicalLayers(options: MutableOptions): ReplayLayers {
  return { ...DEFAULT_REPLAY_LAYERS, ...options.layers }
}

function storageKey(options: MutableOptions): string | null {
  // Without the menu there is no user choice to keep, and none to honour.
  if (!layersMenuOn(options)) return null
  return options.layersStorageKey === undefined ? DEFAULT_LAYERS_STORAGE_KEY : options.layersStorageKey
}

/**
 * The layers to start with: the choice kept under the storage key, layer by
 * layer, over the host's `layers`, over the defaults; with the menu off, the
 * host's `layers` over the defaults and nothing read. A kept entry that is
 * not a known layer set to true or false is ignored, as readReplayLayers
 * ignores it.
 */
export function initialLayers(options: MutableOptions): ReplayLayers {
  const layers = canonicalLayers(options)
  if (!layersMenuOn(options)) return layers
  const store = layerStore(storageKey(options))
  let kept: unknown = null
  try {
    kept = JSON.parse(store?.getItem('') ?? 'null')
  } catch {
    // Unreadable: nothing was kept.
  }
  if (!kept || typeof kept !== 'object') return layers
  // Read as readReplayLayers reads it, then taken only where it was kept.
  const read = readReplayLayers(store)
  for (const key of Object.keys(layers) as ReplayLayerKey[]) {
    if (typeof (kept as Record<string, unknown>)[key] === 'boolean') layers[key] = read[key]
  }
  return layers
}

/** Keep `layers` under the storage key, when there is one. */
export function storeLayers(options: MutableOptions, layers: ReplayLayers): void {
  writeReplayLayers(layerStore(storageKey(options)), layers)
}
