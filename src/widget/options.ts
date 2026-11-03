/**
 * What a host can ask of the widget, and what that comes to for the
 * renderer, the director and the layers.
 */
import type { TeamId } from '../analysis/teamPhase.js'
import type { DirectorOptions } from '../director/director.js'
import { resolveText, type TrackerLocale, type TrackerText, type TrackerTextOverrides } from '../i18n/text.js'
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
}

export interface MatchTrackerOptions {
  /** `live`: fed with `push`, on the widget's own clock. `replay`: fed with `present`, on the host's. */
  mode: 'live' | 'replay'
  /**
   * The built-in text: 'en' or 'zh', or a language tag, read by its language
   * ('zh-CN', 'zh-TW' and 'zh-Hans' are 'zh'). Anything else is 'en'. Default 'en'.
   */
  locale?: TrackerLocale | (string & {})
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

/** What the options come to, worked out afresh on every change. */
export interface Resolved {
  text: TrackerText
  colors: Record<PersonRole, PersonColors>
  teamName: (team: TeamId) => string
  teamColor: (team: TeamId) => string
  formatAction: (actionType: string) => string
}

export function resolveOptions(options: MutableOptions): Resolved {
  const text = resolveText(options.locale ?? 'en', options.text)
  // Every role a copy of its own, so nothing here can change PERSON_COLORS,
  // which every other instance on the page reads too.
  const colors = {} as Record<PersonRole, PersonColors>
  for (const role of ROLES) colors[role] = { ...PERSON_COLORS[role], ...options.colors?.[role] }
  const { home, away } = options.teams ?? {}
  if (home?.color) colors.home.fill = home.color
  if (away?.color) colors.away.fill = away.color
  const names: Record<TeamId, string> = { 0: home?.name || text.red, 1: away?.name || text.blue }
  const fills: Record<TeamId, string> = { 0: colors.home.fill, 1: colors.away.fill }
  return {
    text,
    colors,
    teamName: (team) => names[team],
    teamColor: (team) => fills[team],
    formatAction: options.formatAction ?? DEFAULT_THEME.formatAction,
  }
}

/** The renderer's theme for `resolved`, with the cards' icons once they have loaded. */
export function themeFor(resolved: Resolved, icons: RenderTheme['icons']): RenderTheme {
  const { text } = resolved
  return {
    colors: resolved.colors,
    text: { goal: text.goal, corner: text.corner, throwIn: text.throwIn, attack: text.attack },
    fonts: DEFAULT_THEME.fonts,
    icons,
    formatAction: resolved.formatAction,
  }
}

/** Whether `matchMedia` says the user prefers reduced motion; asked afresh each time, as the reference does. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The director's options for `resolved`, the layers aside. */
export function directorOptions(resolved: Resolved): Omit<DirectorOptions, 'layers'> {
  return { reducedMotion: prefersReducedMotion, teamName: resolved.teamName, teamColor: resolved.teamColor }
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
