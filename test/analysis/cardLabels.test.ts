import { describe, it, expect } from 'vitest'
import { cardLabels } from '../../src/analysis/cardLabels'
import type { Frame, FrameAction } from '../../src/model/types'

const frame = (...actions: FrameAction[]): Frame => ({ teams: [], state: { actions } })
const card = (over: Record<string, unknown>): FrameAction =>
  ({ action_type: 'Player red card', action_origin: 'human', ...over }) as FrameAction

describe('who a card is for', () => {
  it('reads the card, its uuid, its team and its shirt number', () => {
    expect(cardLabels(frame(card({ uuid: 'u1', team_id: 0, player_number: 3 })))).toEqual([
      { key: 'redCard', uuid: 'u1', team: 0, number: 3 },
    ])
    expect(cardLabels(frame(card({ action_type: 'Player yellow card', uuid: 'u2', team_id: 1, player_number: 0 })))).toEqual([
      { key: 'yellowCard', uuid: 'u2', team: 1, number: 0 },
    ])
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
