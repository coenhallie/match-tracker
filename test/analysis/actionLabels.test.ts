import { describe, it, expect } from 'vitest'
import { actionName, frameHasAction, isHumanLabel } from '../../src/analysis/actionLabels'
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
    ({ state: { actions: labels.map((action_type) => ({ action_type, action_origin: 'human' })) } }) as unknown as Frame

  it('finds a label among the others, matched whole', () => {
    expect(frameHasAction(frame(['EventType.BALL_IN_PLAY', 'EventType.GOAL']), 'goal')).toBe(true)
    expect(frameHasAction(frame(['EventType.GOAL_KICK']), 'goal')).toBe(false)
  })

  it('is false for a frame without actions', () => {
    expect(frameHasAction({} as Frame, 'goal')).toBe(false)
  })

  it('counts only a human’s label: not the AI’s, nor one with no origin', () => {
    const labelled = (...actions: Array<Record<string, string>>) => ({ state: { actions } }) as unknown as Frame
    expect(frameHasAction(labelled({ action_type: 'Goal', action_origin: 'human' }), 'goal')).toBe(true)
    expect(frameHasAction(labelled({ action_type: 'Goal', action_origin: 'ai' }), 'goal')).toBe(false)
    expect(frameHasAction(labelled({ action_type: 'Goal' }), 'goal')).toBe(false)
    // The AI's and a human's label for one moment, on one frame: the human's counts.
    expect(
      frameHasAction(labelled({ action_type: 'Goal', action_origin: 'ai' }, { action_type: 'Goal', action_origin: 'human' }), 'goal'),
    ).toBe(true)
    // A human's label for one thing does not make the AI's label for another count.
    expect(
      frameHasAction(labelled({ action_type: 'Corner', action_origin: 'ai' }, { action_type: 'Goal', action_origin: 'human' }), 'corner'),
    ).toBe(false)
  })
})

describe('isHumanLabel', () => {
  it('reads the origin however it is written', () => {
    expect(isHumanLabel({ action_origin: 'human' })).toBe(true)
    expect(isHumanLabel({ action_origin: ' Human ' })).toBe(true)
    expect(isHumanLabel({ action_origin: 'ai' })).toBe(false)
    expect(isHumanLabel({ action_origin: 'AI' })).toBe(false)
    expect(isHumanLabel({})).toBe(false)
  })
})
