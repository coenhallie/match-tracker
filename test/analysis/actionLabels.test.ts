import { describe, it, expect } from 'vitest'
import { actionName, frameHasAction } from '../../src/analysis/actionLabels'
import type { Frame } from '../../src/model/types'

describe('actionName', () => {
  it('reduces each way an export writes a label to one name', () => {
    for (const label of ['Throw in', 'THROW_IN', 'throw-in', ' Throw  In ', 'EventType.THROW_IN']) {
      expect(actionName(label)).toBe('throw in')
    }
  })

  it('keeps the parts of a name apart', () => {
    expect(actionName('EventType.GOAL_KICK')).toBe('goal kick')
    expect(actionName('EventType.BALL_IN_PLAY')).toBe('ball in play')
  })

  it('is empty for a missing label', () => {
    expect(actionName(undefined)).toBe('')
    expect(actionName(null)).toBe('')
  })
})

describe('frameHasAction', () => {
  const frame = (labels: string[]) =>
    ({ state: { actions: labels.map((action_type) => ({ action_type })) } }) as unknown as Frame

  it('finds a label among the others, matched whole', () => {
    expect(frameHasAction(frame(['EventType.BALL_IN_PLAY', 'EventType.GOAL']), 'goal')).toBe(true)
    expect(frameHasAction(frame(['EventType.GOAL_KICK']), 'goal')).toBe(false)
  })

  it('is false for a frame without actions', () => {
    expect(frameHasAction({} as Frame, 'goal')).toBe(false)
  })
})
