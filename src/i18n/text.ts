import type { ReplayLayerKey } from '../model/replayLayers.js'
import { en } from './en.js'
import { zh } from './zh.js'

/**
 * Everything the widget writes, on the canvas and in its HUD. The English is
 * video-annotation's, word for word (en.ts). Words the HUD shows in capitals
 * are kept in their own case here and capitalised by its CSS, as in the
 * reference, whose phase row's ARIA label lowercases "Attacking" and
 * "Defending" for reading out.
 */
export interface TrackerText {
  /** The goal card's title. */
  goal: string
  /** The free kick card's title. */
  freeKick: string
  /** The throw-in band's title. */
  throwIn: string
  /** The word under the team's name in the attack's label. */
  attack: string
  /** A team's state in the phase row above the pitch. */
  attacking: string
  defending: string
  /** Between the two teams in the phase row. */
  versus: string
  /** The phase row's tooltip: how the states are worked out. */
  phaseTooltip: string
  /**
   * The phase row's ARIA label, read out in place of the row: one part per
   * team, `{team}` for its name, joined by `phaseAria`. A team with no state
   * is read out by its name alone. Templates, so each language puts the
   * words in its own order (formatText).
   */
  phaseAttackingAria: string
  phaseDefendingAria: string
  /** The whole label, with `{home}` and `{away}` for the two teams' parts. */
  phaseAria: string
  /** The teams' names when the host gives none: the colours they are drawn in. */
  red: string
  blue: string
  /** The layers button's text. */
  layersButton: string
  /** The layers button's tooltip. */
  layersTooltip: string
  /** The layers menu's ARIA label. */
  layersMenuLabel: string
  /** The zoom badge's text, with `{zoom}` for the zoom to one decimal. */
  zoomLevel: string
  /** The tooltip on the pitch while it is zoomed in: how to go back to the whole of it. */
  zoomReset: string
  /** Each layer's name and hint in the layers menu, listed in REPLAY_LAYERS order. */
  layers: Record<ReplayLayerKey, { label: string; hint: string }>
}

export type TrackerLocale = 'en' | 'zh'

const BUILT_IN: Record<TrackerLocale, TrackerText> = { en, zh }

/**
 * The text for `locale`, with any of `overrides` in place of its own. A
 * `layers` override replaces only the layers it names. The result is a copy:
 * changing it leaves the built-in text alone.
 */
export function resolveText(locale: TrackerLocale, overrides: Partial<TrackerText> = {}): TrackerText {
  const base = structuredClone(BUILT_IN[locale])
  return { ...base, ...overrides, layers: { ...base.layers, ...overrides.layers } }
}

/**
 * `template` with each `{name}` in it replaced by `values[name]`, as it is: a
 * value's own text is never read as a pattern. A placeholder with no value
 * is left as it is.
 */
export function formatText(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(values, name) ? values[name]! : match))
}
