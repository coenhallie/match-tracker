import type { Frame } from '../model/types'

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
 * Whether the pipeline gave this frame the label `name` (a bare name, see
 * actionName). Matched whole, so "goal" never matches a goal kick.
 */
export function frameHasAction(frame: Frame, name: string): boolean {
  return (frame.state?.actions ?? []).some((a) => actionName(a.action_type) === name)
}
