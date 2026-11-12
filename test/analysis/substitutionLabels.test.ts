import { describe, it, expect } from 'vitest'
import { substitutionLabels } from '../../src/analysis/substitutionLabels'
import type { Frame, FrameAction } from '../../src/model/types'

const frame = (...actions: FrameAction[]): Frame => ({ teams: [], state: { actions } })
const sub = (over: Record<string, unknown>): FrameAction =>
  ({ action_type: 'substitute', action_origin: 'human', ...over }) as FrameAction

describe('who a substitution is for', () => {
  it('reads the team, the player going off and the one coming on', () => {
    expect(substitutionLabels(frame(sub({ uuid: 'u', team_id: 0, from: 1, to: 16 })))).toEqual([
      { key: 'substitution', uuid: 'u', team: 0, from: 1, to: 16 },
    ])
  })

  it('leaves out what the label does not say plainly, and keeps a roster id for naming to decide', () => {
    for (const team_id of [2, '0', undefined]) expect(substitutionLabels(frame(sub({ team_id })))[0]!.team).toBeNull()
    for (const from of [-1, 2.5, '9', undefined]) expect(substitutionLabels(frame(sub({ from, to: 3 })))[0]!.from).toBeNull()
    expect(substitutionLabels(frame(sub({ from: 91001, to: 91018 })))[0]).toMatchObject({ from: 91001, to: 91018, uuid: null })
  })

  it('reads two in order, and no AI one, nor any other label', () => {
    const labels = substitutionLabels(
      frame(
        sub({ uuid: 'a', action_type: 'Substitute' }),
        sub({ uuid: 'b', action_origin: 'ai' }),
        { action_type: 'Player red card', action_origin: 'human' },
        sub({ uuid: 'c' }),
      ),
    )
    expect(labels.map((l) => l.uuid)).toEqual(['a', 'c'])
  })
})
