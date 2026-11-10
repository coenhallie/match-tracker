import type { LabelCardKey, LabelCardTextKey } from '../model/labelCards.js'
import type { ReplayLayerKey } from '../model/replayLayers.js'
import { en } from './en.js'
import { zh } from './zh.js'

/**
 * Everything the widget writes, on the canvas and in its HUD. The English is
 * video-annotation's, word for word (en.ts). Words the HUD shows in capitals
 * are kept in their own case here and capitalised by its CSS, as in the
 * reference, whose phase row's ARIA label lowercases "Attacking" and
 * "Defending" for reading out. Each label card's title is under its key, and
 * the short text of one that has it under its key + "Text", with a line break
 * for each of its own: it wraps within the card as well.
 */
export interface TrackerText extends Record<LabelCardKey | LabelCardTextKey, string> {
  /** The goal card's title. */
  goal: string
  /** The corner card's title. */
  corner: string
  /** The throw-in band's title. */
  throwIn: string
  /** The word under the team's name in the attack's label. */
  attack: string
  /** The flashback tab's title, on screen "REPLAY". */
  flashback: string
  /** The flashback timer, with `{time}` for how long ago the moment was, as m:ss. */
  flashbackAgo: string
  /** The debug line for a flashback, with `{kind}` for the moment and `{ago}` for how long ago it was. */
  flashbackDebug: string
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
  /**
   * The debug badge in live mode while the frame on screen is one the pipeline marked
   * invalid, so its positions were made up: with `{team}` for whose attack covers it,
   * and without for when none could be chosen.
   */
  invalidFrames: string
  invalidFramesCover: string
  /**
   * The same, counting down while the frame is invalid: `{label}` for the text above, and
   * `{seconds}` for how long until a valid one, or how far ahead the pipeline sees when none
   * is due by then.
   */
  invalidFramesValidIn: string
  invalidFramesValidLater: string
  /** The same for a run too short to cover, with `{seconds}` for how short (MIN_STRETCH_S). */
  invalidFramesShort: string
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
