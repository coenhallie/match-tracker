import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
import { scorerLabel } from '../../src/analysis/scorerLabel'
import { goalLabelTeam } from '../../src/analysis/goalSequence'
import { parseRecord } from '../../src/model/parseRecord'
import type { Frame, FrameAction } from '../../src/model/types'

const frame = (...actions: FrameAction[]): Frame => ({ teams: [], state: { actions } })
const scored = (over: Record<string, unknown>): FrameAction =>
  ({ action_type: 'Player scored', action_origin: 'human', ...over }) as FrameAction

describe('who scored', () => {
  it("reads the scorer's label: its uuid, team, shirt number and name", () => {
    expect(scorerLabel(frame(scored({ uuid: 'u1', team_id: 1, player_number: 3, player_name: 'Skyler Fring' })))).toEqual({
      uuid: 'u1',
      team: 1,
      number: 3,
      name: 'Skyler Fring',
    })
  })

  it('reads the name however the label writes it, and none from an AI label', () => {
    for (const action_type of ['Player scored', 'Player Scored', 'PLAYER_SCORED', 'EventType.PLAYER_SCORED']) {
      expect({ action_type, scorer: scorerLabel(frame(scored({ action_type, team_id: 0 }))) !== null }).toEqual({ action_type, scorer: true })
    }
    expect(scorerLabel(frame(scored({ action_origin: 'ai', team_id: 0 })))).toBeNull()
    // A goal names no scorer, and an own goal names the conceding team's player.
    for (const action_type of ['Goal', 'Penalty scored', 'Player Own Goal']) {
      expect(scorerLabel(frame(scored({ action_type, team_id: 0 })))).toBeNull()
    }
    expect(scorerLabel(frame())).toBeNull()
  })

  it('leaves out what the label does not say plainly', () => {
    expect(scorerLabel(frame(scored({ team_id: 2, player_number: -1, player_name: 'None' })))).toEqual({
      uuid: null,
      team: null,
      number: null,
      name: null,
    })
  })

  it("reads a goal's team from its label", () => {
    expect(goalLabelTeam(frame({ action_type: 'Goal', action_origin: 'human', team_id: 1 } as FrameAction))).toBe(1)
    expect(goalLabelTeam(frame({ action_type: 'Penalty scored', action_origin: 'human', team_id: 0 } as FrameAction))).toBe(0)
    expect(goalLabelTeam(frame({ action_type: 'Goal', action_origin: 'human' } as FrameAction))).toBeNull()
  })

  it('reads the goals and their scorers off records from the staging stream', () => {
    // A goal and then its scorer, twice, as the labelling tool sent them on 2026-11-13: the
    // scorer's name reaches the stream only in raw_data, and parseRecord puts it on the label.
    const records = gunzipSync(readFileSync(resolve(process.cwd(), 'test/fixtures/goal-labels.jsonl.gz')))
      .toString()
      .trim()
      .split('\n')
      .map((line) => parseRecord(JSON.parse(line))!)
    expect(records.map((r) => [r.frameCount, goalLabelTeam(r.frame), scorerLabel(r.frame)])).toEqual([
      [220941, 1, null],
      [221062, null, { uuid: '3c41ef96-3e90-44e1-b767-89165521f23c', team: 1, number: 3, name: 'Skyler Fring' }],
      [221207, 0, null],
      [221268, null, { uuid: expect.any(String), team: 0, number: 2, name: 'Jimmy Fett' }],
    ])
  })
})
