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

describe("a substituted player's name", () => {
  it('names a substituted player, or writes a shirt number, but no roster id', () => {
    const { substitutionName } = resolveOptions({ teams: { home: { players: { 16: 'Name' } } } })
    expect(substitutionName(0, 16)).toBe('Name')
    expect(substitutionName(0, 1)).toBe('#1')
    expect(substitutionName(0, 99)).toBe('#99')
    expect(substitutionName(0, 100)).toBeNull()
    expect(substitutionName(0, 91001)).toBeNull()
    expect(substitutionName(null, 7)).toBe('#7')
    expect(substitutionName(0, null)).toBeNull()
  })

  it('names a roster id the host names', () => {
    const { substitutionName } = resolveOptions({ teams: { away: { players: { 91001: 'Name' } } } })
    expect(substitutionName(1, 91001)).toBe('Name')
    expect(substitutionName(0, 91001)).toBeNull()
  })

  it('hands the director the same names', () => {
    const resolved = resolveOptions({ teams: { home: { players: { 16: 'Name' } } } })
    expect(directorOptions(resolved, () => false).substitutionName(0, 16)).toBe('Name')
  })
})

