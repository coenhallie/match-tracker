import { describe, it, expect } from 'vitest'
import {
  teamPhaseAt,
  POSSESSION_HOLD_S,
  ATTACK_HOLD_S,
  POSSESSION_FORGET_S,
  PHASE_LOOKBACK_S,
  samePhase,
  type PhaseRecord,
  type TeamPhase,
} from '../../src/analysis/teamPhase'
import type { Frame } from '../../src/model/types'

/**
 * One record per 0.04 s. Team 0's keeper stands at x = -45 and team 1's at
 * +45 unless a test says otherwise, so team 0 attacks towards +x.
 */
interface Moment {
  carrier?: 0 | 1 | null
  ball?: { x: number; y: number } | null
  keepers?: { 0?: number | null; 1?: number | null }
}

function records(moments: Moment[], t0 = 100): PhaseRecord[] {
  return moments.map((m, i) => {
    const keeper = (team: 0 | 1, fallback: number) => {
      const x = m.keepers && team in m.keepers ? m.keepers[team] : fallback
      return x == null
        ? []
        : [{ track_id: 90 + team, person_type: 'PersonType.GOALKEEPER', projected_coordinates: { x, y: 0 } }]
    }
    const outfield = (team: 0 | 1) => ({
      track_id: 10 + team,
      person_type: 'PersonType.PLAYER',
      projected_coordinates: { x: 0, y: 5 },
      in_possession: m.carrier === team,
    })
    const frame = {
      teams: [
        {
          team_id: -1,
          players: [{ track_id: 1, person_type: 'PersonType.OFFICIAL', projected_coordinates: { x: 0, y: 0 } }],
        },
        { team_id: 0, players: [outfield(0), ...keeper(0, -45)] },
        { team_id: 1, players: [outfield(1), ...keeper(1, 45)] },
      ],
      balls: m.ball === null ? [] : [{ projected_coordinates: m.ball ?? { x: 10, y: 0 } }],
    } as unknown as Frame
    return { t: Number((t0 + i * 0.04).toFixed(4)), frame }
  })
}

/** `seconds` worth of records that all look like `m`. */
const hold = (seconds: number, m: Moment): Moment[] => Array.from({ length: Math.round(seconds / 0.04) }, () => m)

const last = (recs: PhaseRecord[]) => teamPhaseAt(recs, recs.length - 1)

describe('teamPhaseAt: possession', () => {
  it('gives a team possession once it has kept the ball for the hold time', () => {
    const recs = records(hold(POSSESSION_HOLD_S + 0.2, { carrier: 0 }))
    expect(last(recs).possession).toBe(0)
  })

  it('does not give possession for a touch shorter than the hold time', () => {
    const recs = records(hold(POSSESSION_HOLD_S - 0.3, { carrier: 0 }))
    expect(last(recs).possession).toBeNull()
  })

  it('keeps possession through frames with no carrier, such as a pass', () => {
    const recs = records([...hold(1.5, { carrier: 0 }), ...hold(2, { carrier: null })])
    expect(last(recs).possession).toBe(0)
  })

  it('ignores the other team touching the ball for less than the hold time', () => {
    const recs = records([...hold(1.5, { carrier: 0 }), ...hold(0.4, { carrier: 1 })])
    expect(last(recs).possession).toBe(0)
  })

  it('hands possession over once the other team has kept it for the hold time', () => {
    const recs = records([...hold(1.5, { carrier: 0 }), ...hold(POSSESSION_HOLD_S + 0.2, { carrier: 1 })])
    expect(last(recs).possession).toBe(1)
  })

  it('counts the hold across gaps with no carrier', () => {
    // Team 1 has the ball on and off for 1.5 s: still a hand-over.
    const onOff = Array.from({ length: 38 }, (_, i) => ({ carrier: i % 3 === 0 ? null : 1 }) as Moment)
    const recs = records([...hold(1.5, { carrier: 0 }), ...onOff])
    expect(last(recs).possession).toBe(1)
  })

  // Bounded memory is what makes a frame's answer independent of how the
  // replay got there: nothing older than the lookback can matter.
  it('forgets possession nobody has confirmed within the lookback', () => {
    const recs = records([...hold(1.5, { carrier: 0 }), ...hold(PHASE_LOOKBACK_S + 0.5, { carrier: null })])
    expect(last(recs).possession).toBeNull()
  })

  it('gives the same answer whatever came before the lookback', () => {
    // Team 0 had the ball for 8 s, but all of that bar its last few frames is
    // older than the lookback, so it must count for nothing.
    const tail = hold(PHASE_LOOKBACK_S - 0.3, { carrier: null })
    const a = records([...hold(8, { carrier: 0 }), ...tail])
    const b = records([...hold(8, { carrier: null }), ...tail])
    expect(last(a)).toEqual(last(b))
    expect(last(a).possession).toBeNull()
  })
})

describe('teamPhaseAt: direction', () => {
  it('has each team attack away from its own keeper', () => {
    const p = last(records(hold(1.5, { carrier: 0 })))
    expect(p.attacks).toEqual({ 0: 1, 1: -1 })
  })

  it('follows the keepers when the teams have swapped ends', () => {
    const p = last(records(hold(1.5, { carrier: 0, keepers: { 0: 44, 1: -40 } })))
    expect(p.attacks).toEqual({ 0: -1, 1: 1 })
  })

  it("reads a team's direction from the other keeper when its own is missing", () => {
    const p = last(records(hold(1.5, { carrier: 0, keepers: { 0: null, 1: 45 } })))
    expect(p.attacks[0]).toBe(1)
  })

  it('ignores a keeper standing near the halfway line', () => {
    const p = last(records(hold(1.5, { carrier: 0, keepers: { 0: -5, 1: 45 } })))
    expect(p.attacks[0]).toBe(1)
  })

  it('remembers the last direction seen within the lookback', () => {
    const recs = records([...hold(1, { carrier: 0 }), ...hold(1, { carrier: 0, keepers: { 0: null, 1: null } })])
    expect(last(recs).attacks).toEqual({ 0: 1, 1: -1 })
  })

  it('reports no direction when no keeper was seen in the lookback', () => {
    const p = last(records(hold(1.5, { carrier: 0, keepers: { 0: null, 1: null } })))
    expect(p.attacks).toEqual({ 0: null, 1: null })
  })
})

describe('teamPhaseAt: states', () => {
  /** Long enough for possession to pass and then to count as an attack. */
  const SUSTAINED = POSSESSION_HOLD_S + ATTACK_HOLD_S + 0.5

  it('has a team attacking once it has kept possession for the attack hold', () => {
    const p = last(records(hold(SUSTAINED, { carrier: 0, ball: { x: 20, y: 0 } })))
    expect(p.states).toEqual({ 0: 'attacking', 1: 'defending' })
  })

  // Keeping the ball is not attacking: a team can play it around at the back.
  it('does not call a team attacking before it has kept possession that long', () => {
    const p = last(records(hold(POSSESSION_HOLD_S + ATTACK_HOLD_S - 1, { carrier: 0 })))
    expect(p.possession).toBe(0)
    expect(p.states).toEqual({ 0: null, 1: null })
  })

  it('keeps counting through passes, when nobody is the carrier', () => {
    const passing = Array.from(
      { length: Math.round(SUSTAINED / 0.04) },
      (_, i) => (i % 4 === 0 ? { carrier: null } : { carrier: 1 }) as Moment,
    )
    expect(last(records(passing)).states).toEqual({ 0: 'defending', 1: 'attacking' })
  })

  it('stops the attack the moment possession passes to the other team', () => {
    const recs = records([...hold(SUSTAINED, { carrier: 0 }), ...hold(POSSESSION_HOLD_S + 0.2, { carrier: 1 })])
    expect(last(recs).possession).toBe(1)
    expect(last(recs).states).toEqual({ 0: null, 1: null })
  })

  it('keeps a long possession an attack all the way through', () => {
    const p = last(records(hold(PHASE_LOOKBACK_S * 3, { carrier: 0 })))
    expect(p.states).toEqual({ 0: 'attacking', 1: 'defending' })
  })

  it('has the team attacking wherever the ball is', () => {
    const p = last(records(hold(SUSTAINED, { carrier: 0, ball: { x: -30, y: 0 } })))
    expect(p.states[0]).toBe('attacking')
  })

  it('does not need to know the direction to say who is attacking', () => {
    const p = last(records(hold(SUSTAINED, { carrier: 0, keepers: { 0: null, 1: null } })))
    expect(p.states).toEqual({ 0: 'attacking', 1: 'defending' })
  })

  it('gives neither team a state when nobody is in possession', () => {
    const p = last(records(hold(SUSTAINED, { carrier: null })))
    expect(p.states).toEqual({ 0: null, 1: null })
  })

  // The bug the real match showed: when the start of the lookback fell in a
  // quiet spell, the calculation thought possession had only just begun, and
  // a long attack dropped out halfway through.
  it('keeps an attack going through a quiet spell shorter than the forget time', () => {
    const recs = records([
      ...hold(10, { carrier: 0 }),
      ...hold(POSSESSION_FORGET_S - 0.5, { carrier: null }),
      ...hold(ATTACK_HOLD_S + 0.6, { carrier: 0 }),
    ])
    expect(last(recs).states).toEqual({ 0: 'attacking', 1: 'defending' })
  })

  it('ends possession once the team has gone the forget time without the ball', () => {
    const recs = records([...hold(8, { carrier: 0 }), ...hold(POSSESSION_FORGET_S + 0.2, { carrier: null })])
    expect(last(recs).possession).toBeNull()
  })

  // Long enough that the window always reaches back past anything that could
  // still affect the answer, so it never differs from unlimited memory.
  it('remembers far enough back for the answer never to depend on the window', () => {
    expect(PHASE_LOOKBACK_S).toBeGreaterThan(POSSESSION_HOLD_S + ATTACK_HOLD_S + POSSESSION_FORGET_S)
  })
})

describe('samePhase', () => {
  const base: TeamPhase = {
    possession: 0,
    attacks: { 0: 1, 1: -1 },
    states: { 0: 'attacking', 1: 'defending' },
  }
  const copy = (): TeamPhase => JSON.parse(JSON.stringify(base))

  it('is true for two phases that say the same thing', () => {
    expect(samePhase(base, copy())).toBe(true)
  })

  it('tells apart a change of possession', () => {
    expect(samePhase(base, { ...copy(), possession: 1 })).toBe(false)
    expect(samePhase(base, { ...copy(), possession: null })).toBe(false)
  })

  it('tells apart a change of direction', () => {
    expect(samePhase(base, { ...copy(), attacks: { 0: -1, 1: -1 } })).toBe(false)
    expect(samePhase(base, { ...copy(), attacks: { 0: 1, 1: null } })).toBe(false)
  })

  it('tells apart a change of state', () => {
    expect(samePhase(base, { ...copy(), states: { 0: null, 1: 'defending' } })).toBe(false)
    expect(samePhase(base, { ...copy(), states: { 0: 'attacking', 1: null } })).toBe(false)
  })
})
