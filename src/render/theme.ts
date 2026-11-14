import { PERSON_COLORS, type PersonColors } from './constants.js'
import { LABEL_FAMILY, TITLE_FAMILY, familyList } from '../assets/fontFamilies.js'
import { iconCardRecord, type IconCardKey, type LabelCardKey, type LabelCardTextKey } from '../model/labelCards.js'

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
  text: { goal: string; corner: string; freeKick: string; throwIn: string; penalty: string; penaltyWaiting: string; penaltyScored: string; penaltyMissed: string; attack: string; flashback: string; flashbackAgo: string } & Record<LabelCardKey | LabelCardTextKey, string>
  /**
   * Family lists, fallbacks included: `label` for the attack's label,
   * `title` for the event cards' titles.
   */
  fonts: { label: string; title: string }
  /** The cards' icons, once loaded. A card is drawn without its icon until then. */
  icons: {
    corner: CanvasImageSource | null
    freeKick: CanvasImageSource | null
    substitutionOut: CanvasImageSource | null
    substitutionIn: CanvasImageSource | null
    /** Before the goal's scorer's name (goalBanner.ts). */
    scorer: CanvasImageSource | null
    /** On the throw-in's card (throwInCard.ts). */
    throwIn: CanvasImageSource | null
    /** The penalty's card and scene (render/penalty.ts): its card icon, goal, keeper standing and diving, and kicked ball (the spinner ball is a gradient). */
    penalty: CanvasImageSource | null
    penaltyGoal: CanvasImageSource | null
    penaltyKeeper: CanvasImageSource | null
    penaltyKeeperDive: CanvasImageSource | null
    penaltyBall: CanvasImageSource | null
  } & Record<IconCardKey, CanvasImageSource | null>
  /** The bottom-left text for one of the frame's actions, from its `action_type`. */
  formatAction: (actionType: string) => string
  /** Whether the bottom-left text lists the AI's labels too, or only the ones a human gave. */
  aiLabels: boolean
}

/** PERSON_COLORS, copied role by role and frozen, so the default theme shares no object with the constants. */
function frozenColors(): Readonly<Record<PersonRole, Readonly<PersonColors>>> {
  const colors = {} as Record<PersonRole, PersonColors>
  for (const role of Object.keys(PERSON_COLORS) as PersonRole[]) {
    colors[role] = Object.freeze({ ...PERSON_COLORS[role] })
  }
  return Object.freeze(colors)
}

/**
 * The colours the people are drawn in without `colors` or a team's `color`,
 * as the package exports them: video-annotation's, frozen all the way down.
 * The default theme reads this one object.
 */
export const DEFAULT_PERSON_COLORS: Readonly<Record<PersonRole, Readonly<PersonColors>>> = frozenColors()

/**
 * video-annotation's look, exactly: its colours (PERSON_COLORS), its English,
 * the action types as the export writes them, and its fonts, under the
 * bundled faces' private names with a CJK fallback after each.
 *
 * Frozen all the way down: every renderer without a theme of its own reads
 * this one object, so nothing may change it in place.
 */
export const DEFAULT_THEME: Readonly<RenderTheme> = Object.freeze({
  colors: DEFAULT_PERSON_COLORS,
  text: Object.freeze({
    goal: 'GOAL',
    corner: 'CORNER',
    freeKick: 'FREE KICK',
    throwIn: 'THROW IN',
    penalty: 'PENALTY',
    penaltyWaiting: 'PENALTY..',
    penaltyScored: 'SCORED!',
    penaltyMissed: 'MISSED!',
    attack: 'Attack',
    flashback: 'REPLAY',
    flashbackAgo: '{time} AGO',
    varCheck: 'VAR CHECK',
    goalDisallowed: 'GOAL DISALLOWED',
    halfTime: 'HALF TIME',
    halfTimeText: 'There is a break in play.\nCoverage will resume soon.',
    secondHalf: 'SECOND HALF',
    secondHalfText: 'The match has restarted.',
    fullTime: 'FULL TIME',
    fullTimeText: 'This match has ended.',
    foul: 'FOUL',
    shotOnGoal: 'SHOT!',
    headerOnGoal: 'HEADER!',
    yellowCard: 'YELLOW CARD',
    redCard: 'RED CARD',
    substitution: 'SUBSTITUTION',
  }),
  fonts: Object.freeze({ label: familyList(LABEL_FAMILY), title: familyList(TITLE_FAMILY) }),
  icons: Object.freeze({ corner: null, freeKick: null, substitutionOut: null, substitutionIn: null, scorer: null, throwIn: null, penalty: null, penaltyGoal: null, penaltyKeeper: null, penaltyKeeperDive: null, penaltyBall: null, ...iconCardRecord(() => null) }),
  formatAction: (actionType: string) => actionType,
  aiLabels: false,
})
