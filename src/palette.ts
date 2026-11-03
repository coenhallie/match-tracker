/**
 * The few colours the console banner draws in, in a module of their own so
 * the banner entry (`@coenhallie/match-tracker/banner`) pulls in nothing of
 * the renderer for them. The renderer takes them from here too, so the
 * banner and the pitch can never drift apart.
 */

/** A home player's fill: red. */
export const HOME_FILL = '#e51a1a'
/** An away player's fill: blue. */
export const AWAY_FILL = '#184fe7'
/** Grass colour down the middle of the frame. */
export const PITCH_GRASS_MIDDLE = '#198061'
