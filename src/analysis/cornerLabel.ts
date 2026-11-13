import type { Frame } from '../model/types.js'
import { actionName, isHumanLabel } from './actionLabels.js'
import { teamOfLabel, type LabelTeam } from './cardLabels.js'
import type { ShownRecord } from './secondHalf.js'

/**
 * A corner of the pitch, by the signs of its x and y in pitch metres: x -1 the
 * left goal line, y 1 the bottom touchline, as the frame is drawn.
 */
export interface CornerSide {
  x: -1 | 1
  y: -1 | 1
}

/**
 * The corner's labels, by their bare names (actionName), and the corner each
 * names. Since 2026-11-13 the labelling tool has a button for each corner and
 * sends its name in the label, "Corner kick - Bottom left" and so on: the
 * corner as the camera sees it, from its touchline, which is the bottom one,
 * with the left goal line on its left. Older labels, and the exports', name no
 * corner: "Corner", "Corner kick", "EventType.CORNER_KICK".
 */
const CORNER_LABELS: ReadonlyMap<string, CornerSide | null> = new Map([
  ['corner', null],
  ['corner kick', null],
  ['corner kick top left', { x: -1, y: -1 }],
  ['corner kick top right', { x: 1, y: -1 }],
  ['corner kick bottom left', { x: -1, y: 1 }],
  ['corner kick bottom right', { x: 1, y: 1 }],
])

/** Whether a human labelled this frame a corner, however the label writes it. */
export function isCornerFrame(frame: Frame): boolean {
  return (frame.state?.actions ?? []).some((a) => isHumanLabel(a) && CORNER_LABELS.has(actionName(a.action_type)))
}

/** A corner as a human labelled it: the corner its label names, and the team taking it. */
/** The team taking it is the label's (teamOfLabel): the labelling tool sends it since 2026-11, the exports do not. */
export interface CornerLabel extends LabelTeam {
  /** Where the corner is on the pitch as shown, or null when the label names none. */
  side: CornerSide | null
}

/**
 * The corner a human labelled `record` with, or null when no human label on it
 * is a corner's. A label that names a corner goes before one that does not, and
 * the team is the one on the label it goes by.
 *
 * The labeller names the corner as the camera sees it, and the camera stays on
 * its touchline at half time, so on a second-half record, which the widget
 * shows turned half round the centre spot (`turned`), the corner is turned
 * with it: the camera's bottom left is the turned pitch's top right. The team
 * is the same team in either half.
 */
export function cornerLabel(record: ShownRecord): CornerLabel | null {
  let first: CornerLabel | null = null
  for (const action of record.frame.state?.actions ?? []) {
    if (!isHumanLabel(action)) continue
    const name = actionName(action.action_type)
    if (!CORNER_LABELS.has(name)) continue
    const side = CORNER_LABELS.get(name) ?? null
    const team = teamOfLabel(action)
    if (side) return { side: record.turned ? { x: side.x === 1 ? -1 : 1, y: side.y === 1 ? -1 : 1 } : side, ...team }
    first ??= { side: null, ...team }
  }
  return first
}
