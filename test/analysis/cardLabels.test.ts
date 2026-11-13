import { describe, it, expect } from 'vitest'
import { cardLabels, labelTeam, teamOfLabel } from '../../src/analysis/cardLabels'
import type { Frame, FrameAction } from '../../src/model/types'

const frame = (...actions: FrameAction[]): Frame => ({ teams: [], state: { actions } })
const card = (over: Record<string, unknown>): FrameAction =>
  ({ action_type: 'Player red card', action_origin: 'human', ...over }) as FrameAction

describe('who a card is for', () => {
  it('reads the card, its uuid, its team and its shirt number', () => {
    expect(cardLabels(frame(card({ uuid: 'u1', team_id: 0, player_number: 3 })))).toEqual([
      { key: 'redCard', uuid: 'u1', team: 0, teamName: null, number: 3, name: null },
    ])
    expect(cardLabels(frame(card({ action_type: 'Player yellow card', uuid: 'u2', team_id: 1, player_number: 0 })))).toEqual([
      { key: 'yellowCard', uuid: 'u2', team: 1, teamName: null, number: 0, name: null },
    ])
  })

  it("reads the player's name, when the label has one", () => {
    expect(cardLabels(frame(card({ team_id: 1, player_number: 7, player_name: 'Lando Fring' })))[0]!.name).toBe('Lando Fring')
    for (const player_name of [undefined, null, '', ' ', 'None', 7]) {
      expect(cardLabels(frame(card({ team_id: 1, player_number: 7, player_name })))[0]!.name).toBeNull()
    }
  })

  it('leaves out what the label does not say plainly', () => {
    for (const team_id of [2, -1, '0', undefined, 0.5]) {
      expect(cardLabels(frame(card({ team_id, player_number: 3 })))[0]!.team).toBeNull()
    }
    for (const player_number of [-1, 2.5, '9', undefined, null]) {
      expect(cardLabels(frame(card({ team_id: 0, player_number })))[0]!.number).toBeNull()
    }
    expect(cardLabels(frame(card({ team_id: 0, player_number: 3 })))[0]!.uuid).toBeNull()
    expect(cardLabels(frame(card({ uuid: '' })))[0]!.uuid).toBeNull()
  })

  it('reads two cards on one record in their order, and no AI card', () => {
    const labels = cardLabels(
      frame(
        { action_type: 'EventType.BALL_IN_PLAY', action_origin: 'ai' },
        card({ action_type: 'Player yellow card', uuid: 'a' }),
        card({ uuid: 'b', action_origin: 'ai' }),
        { action_type: 'VAR check', action_origin: 'human' },
        card({ uuid: 'c' }),
      ),
    )
    expect(labels.map((l) => [l.key, l.uuid])).toEqual([
      ['yellowCard', 'a'],
      ['redCard', 'c'],
    ])
  })

  it('reads nothing from a frame with no labels', () => {
    expect(cardLabels({ teams: [] })).toEqual([])
  })
})

describe("a label's team", () => {
  const label = (over: Record<string, unknown>) => ({ action_type: 'Goal', action_origin: 'human', ...over }) as FrameAction

  it('reads the side from team_id, as staging sends it', () => {
    expect(teamOfLabel(label({ team_id: 0 }))).toEqual({ team: 0, teamName: null })
    expect(teamOfLabel(label({ team_id: 1 }))).toEqual({ team: 1, teamName: null })
  })

  it("reads the side from is_home and the name from team_name, as production sends them, whatever team_id says", () => {
    // Production's team_id is the team's id in its backend: 807 is Australia, the away side.
    expect(teamOfLabel(label({ team_id: 807, is_home: 0, team_name: 'Australia' }))).toEqual({ team: 1, teamName: 'Australia' })
    expect(teamOfLabel(label({ team_id: 806, is_home: 1, team_name: 'Qatar' }))).toEqual({ team: 0, teamName: 'Qatar' })
    expect(teamOfLabel(label({ team_id: 1, is_home: 'home' }))).toEqual({ team: 0, teamName: null })
    expect(teamOfLabel(label({ team_name: 'Australia', is_home: 'Away' }))).toEqual({ team: 1, teamName: 'Australia' })
    expect(teamOfLabel(label({ team_id: 806, is_home: true }))).toEqual({ team: 0, teamName: null })
  })

  it('takes no side from is_home on a label that names no team', () => {
    // Production's "Kick off" (2026-11-13): no team_id and no team_name, and is_home 0 all the same.
    expect(teamOfLabel(label({ action_type: 'Kick off', team_id: null, is_home: 0, team_name: null }))).toEqual({ team: null, teamName: null })
    expect(teamOfLabel(label({ is_home: 'away' }))).toEqual({ team: null, teamName: null })
  })

  it('says no side for a team_id that is not one and no is_home, and keeps the name', () => {
    expect(teamOfLabel(label({ team_id: 807, team_name: 'Australia' }))).toEqual({ team: null, teamName: 'Australia' })
    expect(teamOfLabel(label({ team_id: 807, is_home: 'yes', team_name: 'None' }))).toEqual({ team: null, teamName: null })
  })

  it("reads the team of a label by name from the first that gives one", () => {
    const f = frame(label({ action_type: 'Free kick' }), label({ action_type: 'Freekick', team_id: 807, is_home: 0, team_name: 'Australia' }))
    expect(labelTeam(f, ['free kick', 'freekick'])).toEqual({ team: 1, teamName: 'Australia' })
    expect(labelTeam(frame(label({ action_type: 'Free kick' })), ['free kick'])).toEqual({ team: null, teamName: null })
  })

  it("gives the cards their team's side and name", () => {
    expect(cardLabels(frame(card({ team_id: 807, is_home: 0, team_name: 'Australia', player_number: 4 })))[0]).toMatchObject({ team: 1, teamName: 'Australia', number: 4 })
  })
})
