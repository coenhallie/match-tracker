import type { ReplayLayerKey } from '../model/replayLayers'
import { en } from './en'
import { zh } from './zh'

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
  /** The teams' names when the host gives none: the colours they are drawn in. */
  red: string
  blue: string
  /** The layers button's text. */
  layersButton: string
  /** The layers button's tooltip. */
  layersTooltip: string
  /** The layers menu's ARIA label. */
  layersMenuLabel: string
  /** The zoom badge's tooltip: how to go back to the whole pitch. */
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
