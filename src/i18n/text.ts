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
  /** The corner card's title. */
  corner: string
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
  /** What a screen reader calls the pitch: the canvas's ARIA label. */
  pitchLabel: string
  /**
   * The debug badge (the `debug` option) while too few players are tracked,
   * with `{players}` for how many are; and the same while an attack covers
   * it, with `{team}` for whose.
   */
  playerLoss: string
  playerLossCover: string
  /** Each layer's name and hint in the layers menu, listed in REPLAY_LAYERS order. */
  layers: Record<ReplayLayerKey, LayerText>
}

/** A layer's words in the layers menu. */
export interface LayerText {
  label: string
  hint: string
}

/**
 * Text a host gives in place of the locale's: any of TrackerText, and for
 * the layers menu any word of any layer, each kept from the locale where it
 * is not given.
 */
export type TrackerTextOverrides = Partial<Omit<TrackerText, 'layers'>> & {
  layers?: Partial<Record<ReplayLayerKey, Partial<LayerText>>>
}

/** The languages the widget has its own text in. */
export type TrackerLocale = 'en' | 'zh'

const BUILT_IN: Record<TrackerLocale, TrackerText> = { en, zh }

/**
 * The built-in text a locale reads as: a language tag by its language, so
 * 'zh-CN', 'zh-TW' and 'zh-Hans' are 'zh' and 'en-GB' is 'en', in any case;
 * anything the widget has no text for is 'en'.
 */
export function localeOf(tag: string): TrackerLocale {
  const language = String(tag).toLowerCase().split(/[-_]/)[0]
  return language === 'zh' ? 'zh' : 'en'
}

/**
 * The text for `locale` (as localeOf reads it), with any of `overrides` in
 * place of its own. A `layers` override replaces only the words it gives,
 * layer by layer. The result is a copy: changing it leaves the built-in text
 * alone.
 */
export function resolveText(locale: string, overrides: TrackerTextOverrides = {}): TrackerText {
  const base = structuredClone(BUILT_IN[localeOf(locale)])
  const layers = { ...base.layers }
  for (const key of Object.keys(layers) as ReplayLayerKey[]) {
    layers[key] = { ...layers[key], ...overrides.layers?.[key] }
  }
  return { ...base, ...overrides, layers }
}

/**
 * `template` with each `{name}` in it replaced by `values[name]`, as it is: a
 * value's own text is never read as a pattern. A placeholder with no value
 * is left as it is.
 */
export function formatText(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(values, name) ? values[name]! : match))
}
