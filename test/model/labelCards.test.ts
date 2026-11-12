import { describe, it, expect } from 'vitest'
import { PLAYER_CARD_KEYS, isPlayerCardKey, labelCard, playerCardColor } from '../../src/model/labelCards'
import { isLabelCardFrame } from '../../src/render/labelCard'
import type { Frame } from '../../src/model/types'

const labelled = (action_type: string, action_origin = 'human'): Frame => ({
  teams: [],
  state: { actions: [{ action_type, action_origin }] },
})

describe('the player cards', () => {
  it("reads the labelling tool's card labels as the two player cards", () => {
    expect(isLabelCardFrame(labelled('Player yellow card'), labelCard('yellowCard').labels)).toBe(true)
    expect(isLabelCardFrame(labelled('Yellow card'), labelCard('yellowCard').labels)).toBe(true)
    expect(isLabelCardFrame(labelled('Player red card'), labelCard('redCard').labels)).toBe(true)
    expect(isLabelCardFrame(labelled('EventType.PLAYER_RED_CARD'), labelCard('redCard').labels)).toBe(true)
    expect(isLabelCardFrame(labelled('Red card'), labelCard('redCard').labels)).toBe(true)
    expect(isLabelCardFrame(labelled('Player red card'), labelCard('yellowCard').labels)).toBe(false)
    expect(isLabelCardFrame(labelled('Player red card', 'ai'), labelCard('redCard').labels)).toBe(false)
  })

  it('marks only the two cards as about a player, with their colours', () => {
    expect(PLAYER_CARD_KEYS).toEqual(['yellowCard', 'redCard'])
    expect(playerCardColor('yellowCard')).toBe('#EAB308')
    expect(playerCardColor('redCard')).toBe('#EF4444')
    expect(isPlayerCardKey('redCard')).toBe(true)
    expect(isPlayerCardKey('varCheck')).toBe(false)
    expect(isPlayerCardKey('goal')).toBe(false)
  })

  it('plays as the VAR check does: a centre card under an icon, while its label is on, making way for the whole pitch', () => {
    for (const key of PLAYER_CARD_KEYS) {
      expect(labelCard(key)).toMatchObject({ size: 'centre', below: 'icon', until: 'labelOff', makesWay: true })
    }
  })
})
