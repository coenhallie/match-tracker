import { describe, it, expect } from 'vitest'
import { PENALTY_LABELS, PENALTY_MISSED_LABELS, PENALTY_SCORED_LABELS, penaltyLabels } from '../../src/analysis/penaltyLabels'
import type { Frame, FrameAction } from '../../src/model/types'

const frame = (...actions: FrameAction[]): Frame => ({ teams: [], state: { actions } })
const human = (action_type: string, extra: Partial<FrameAction> = {}): FrameAction => ({ action_type, action_origin: 'human', ...extra })
const away = { team_id: 1, team_name: 'Team Away', is_home: 'away' } as const
const AWAY = { team: 1, teamName: 'Team Away' }
const NONE = { team: null, teamName: null }

describe('the penalty labels', () => {
  it('reads the labelling tool’s three penalty labels', () => {
    expect(penaltyLabels(frame(human('Penalty', away)))).toEqual({ penalty: AWAY, result: null })
    expect(penaltyLabels(frame(human('Penalty scored', away)))).toEqual({ penalty: null, result: { kind: 'scored', team: AWAY } })
    expect(penaltyLabels(frame(human('Penalty missed', away)))).toEqual({ penalty: null, result: { kind: 'missed', team: AWAY } })
  })

  it('reads a penalty and its result on one frame', () => {
    expect(penaltyLabels(frame(human('Penalty', away), human('Penalty missed', away)))).toEqual({ penalty: AWAY, result: { kind: 'missed', team: AWAY } })
  })

  it('gives scored over missed on one frame, and no team when the label names none', () => {
    expect(penaltyLabels(frame(human('Penalty missed'), human('Penalty scored'))).result).toEqual({ kind: 'scored', team: NONE })
    expect(penaltyLabels(frame(human('Penalty'))).penalty).toEqual(NONE)
  })

  it('reads the other spellings', () => {
    for (const label of ['PENALTY_MISSED', 'Missed penalty', 'EventType.PENALTY_MISSED', 'Penalty kick missed']) {
      expect({ label, kind: penaltyLabels(frame(human(label))).result?.kind }).toEqual({ label, kind: 'missed' })
    }
    for (const label of ['EventType.PENALTY_SCORED', 'Penalty goal', 'PenaltyScored', 'Penalty kick goal', 'Scored penalty']) {
      expect({ label, kind: penaltyLabels(frame(human(label))).result?.kind }).toEqual({ label, kind: 'scored' })
    }
    expect(penaltyLabels(frame(human('EventType.PENALTY'))).penalty).toEqual(NONE)
  })

  it('reads no AI label, and not a goal kick or a goal', () => {
    const none = { penalty: null, result: null }
    expect(penaltyLabels(frame({ action_type: 'Penalty', action_origin: 'ai' }, { action_type: 'Penalty scored' }))).toEqual(none)
    for (const label of ['Goal kick', 'Goal', 'Penalty area', 'Penalty saved', 'Kick']) {
      expect({ label, read: penaltyLabels(frame(human(label))) }).toEqual({ label, read: none })
    }
    expect(penaltyLabels(frame())).toEqual(none)
  })

  it('lists the names it reads', () => {
    expect(PENALTY_LABELS).toEqual(['penalty'])
    expect(PENALTY_SCORED_LABELS).toContain('penalty scored')
    expect(PENALTY_MISSED_LABELS).toContain('penalty missed')
  })
})
