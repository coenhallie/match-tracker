import type { Frame, FrameAction } from '../model/types.js'

/**
 * A pipeline action label reduced to its bare name, so the same label matches
 * however an export writes it. The February export says "Throw in"; the
 * Manchester City vs PSG one says "EventType.THROW_IN". Any dotted prefix is
 * dropped, case is ignored, and spaces, underscores and hyphens all count as
 * one space: both become "throw in".
 */
export function actionName(actionType: unknown): string {
  const name = String(actionType ?? '').trim()
  return name
    .slice(name.lastIndexOf('.') + 1)
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim()
}

/**
 * Whether a human analyst gave the label: its `action_origin` is "human".
 * The pipeline marks its own labels "ai", and older exports carry no origin
 * at all; neither counts, so nothing the AI labelled plays a moment.
 */
export function isHumanLabel(action: FrameAction): boolean {
  return String(action.action_origin ?? '').trim().toLowerCase() === 'human'
}

/** The labels a human gave this frame, by their bare names (actionName). */
export function humanLabelNames(frame: Frame): string[] {
  return (frame.state?.actions ?? []).filter(isHumanLabel).map((a) => actionName(a.action_type))
}

/**
 * Whether a human gave this frame the label `name` (a bare name, see
 * actionName). Matched whole, so "goal" never matches a goal kick. The
 * moments (goal, corner, throw-in, label cards) play only on these; a label from the AI,
 * or one without an origin, is ignored (isHumanLabel).
 */
export function frameHasAction(frame: Frame, name: string): boolean {
  return (frame.state?.actions ?? []).some((a) => isHumanLabel(a) && actionName(a.action_type) === name)
}
