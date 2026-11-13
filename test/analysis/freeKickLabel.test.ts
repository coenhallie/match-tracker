import { describe, it, expect } from 'vitest'
import { freeKickTeam, isFreeKickFrame } from '../../src/analysis/freeKickLabel'
import type { Frame, FrameAction } from '../../src/model/types'

const frame = (...actions: FrameAction[]): Frame => ({ teams: [], state: { actions } })
const human = (action_type: string, extra: Partial<FrameAction> = {}): FrameAction => ({ action_type, action_origin: 'human', ...extra })

describe('the free kick label', () => {
  it('is the labelling tool’s "Freekick", and "free kick" however it is written', () => {
    for (const label of ['Freekick', 'freekick', 'Free kick', 'Free Kick', 'FREE_KICK', 'EventType.FREE_KICK', 'free-kick']) {
      expect({ label, kick: isFreeKickFrame(frame(human(label))) }).toEqual({ label, kick: true })
    }
  })

  it('is matched whole, from a human only', () => {
    for (const label of ['Free kick taken', 'Indirect free kick', 'Kick', 'Corner kick']) {
      expect({ label, kick: isFreeKickFrame(frame(human(label))) }).toEqual({ label, kick: false })
    }
    expect(isFreeKickFrame(frame({ action_type: 'Freekick', action_origin: 'ai' }))).toBe(false)
    expect(isFreeKickFrame(frame({ action_type: 'EventType.FREE_KICK' }))).toBe(false)
    expect(isFreeKickFrame(frame())).toBe(false)
  })

  it('gives the team on its label, 0 or 1, from the first that gives one', () => {
    expect(freeKickTeam(frame(human('Freekick', { team_id: 1 })))).toBe(1)
    expect(freeKickTeam(frame(human('Free kick', { team_id: 0 })))).toBe(0)
    expect(freeKickTeam(frame(human('Freekick'), human('Free kick', { team_id: 1 })))).toBe(1)
    expect(freeKickTeam(frame(human('Freekick', { team_id: -1 })))).toBeNull()
    expect(freeKickTeam(frame(human('Freekick')))).toBeNull()
    // Another label's team is not the free kick's.
    expect(freeKickTeam(frame(human('Corner', { team_id: 1 }), human('Freekick')))).toBeNull()
    expect(freeKickTeam(frame({ action_type: 'Freekick', action_origin: 'ai', team_id: 1 }))).toBeNull()
  })
})
