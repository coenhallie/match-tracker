import { PERSON_COLORS, type PersonColors } from './constants'
import { LABEL_FAMILY, TITLE_FAMILY, familyList } from '../assets/fontFamilies'

/** Who a person on the pitch is drawn as. Team 0 is home, team 1 away. */
export type PersonRole = 'home' | 'away' | 'goalkeeper' | 'official' | 'unknown'

/**
 * What the renderer takes from its host rather than from the reference's
 * constants: the people's colours, the words on the canvas and the fonts they
 * are written in, the event cards' icons, and how the bottom-left action text
 * reads. Nothing about where or how big anything is drawn.
 */
export interface RenderTheme {
  colors: Record<PersonRole, PersonColors>
  /** The event cards' titles, and the word under the team's name in the attack's label. */
  text: { goal: string; freeKick: string; throwIn: string; attack: string }
  /**
   * Family lists, fallbacks included: `label` for the attack's label,
   * `title` for the event cards' titles.
   */
  fonts: { label: string; title: string }
  /** The cards' icons, once loaded. A card is drawn without its icon until then. */
  icons: { freeKick: CanvasImageSource | null; goal: CanvasImageSource | null }
  /** The bottom-left text for one of the frame's actions, from its `action_type`. */
  formatAction: (actionType: string) => string
}

/**
 * video-annotation's look, exactly: its colours (PERSON_COLORS), its English,
 * the action types as the export writes them, and its fonts, under the
 * bundled faces' private names with a CJK fallback after each.
 */
export const DEFAULT_THEME: RenderTheme = {
  colors: PERSON_COLORS,
  text: { goal: 'GOAL', freeKick: 'FREE KICK', throwIn: 'THROW IN', attack: 'Attack' },
  fonts: { label: familyList(LABEL_FAMILY), title: familyList(TITLE_FAMILY) },
  icons: { freeKick: null, goal: null },
  formatAction: (actionType) => actionType,
}
