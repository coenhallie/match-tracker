/**
 * Who a card names: the host's name for the shirt number in `teams`, or the
 * number, in the moments' language.
 */
import { describe, it, expect } from 'vitest'
import { directorOptions, resolveOptions } from '../../src/widget/options'

describe("a carded player's name", () => {
  it('names a player by shirt number, or writes the number', () => {
    const { playerName } = resolveOptions({ teams: { home: { players: { 9: 'Name' } } } })
    expect(playerName(0, 9)).toBe('Name')
    expect(playerName(0, 7)).toBe('#7')
    expect(playerName(1, 9)).toBe('#9')
  })

  it('writes the number in the moments’ language', () => {
    expect(resolveOptions({ momentLocale: 'zh' }).playerName(0, 7)).toBe('7号')
    expect(resolveOptions({ locale: 'zh-CN' }).playerName(1, 10)).toBe('10号')
  })

  it('takes a name keyed by the number as a string, as JSON has it, and no empty name', () => {
    const players = JSON.parse('{"9": "Name", "4": ""}') as Record<number, string>
    const { playerName } = resolveOptions({ teams: { away: { players } } })
    expect(playerName(1, 9)).toBe('Name')
    expect(playerName(1, 4)).toBe('#4')
  })

  it('follows a change of options for the next name asked', () => {
    const before = resolveOptions({ teams: { home: { players: { 9: 'Old' } } } })
    const after = resolveOptions({ teams: { home: { players: { 9: 'New' } } } })
    expect(before.playerName(0, 9)).toBe('Old')
    expect(after.playerName(0, 9)).toBe('New')
  })

  it('hands the director the same names', () => {
    const resolved = resolveOptions({ teams: { home: { players: { 9: 'Name' } } } })
    expect(directorOptions(resolved, () => false).playerName(0, 9)).toBe('Name')
  })
})
