import { describe, expect, it } from 'vitest'
import { SecondHalf, turnFrame } from '../../src/analysis/secondHalf'
import type { Frame, TrackerRecord } from '../../src/model/types'

/** A frame with one player of each team, a goalkeeper among them, a ball, and these labels. */
function frame(actions: Array<{ action_type: string; action_origin?: string }> = []): Frame {
  return {
    match_id: 1,
    state: { actions },
    teams: [
      { team_id: 0, color_name: 'Yellow', players: [{ track_id: 1, person_type: 'PersonType.GOALKEEPER', projected_coordinates: { x: -48, y: 2 } }] },
      { team_id: 1, players: [{ track_id: 2, projected_coordinates: { x: 10, y: -20 } }, { track_id: 3 }] },
    ],
    balls: [{ projected_coordinates: { x: 30, y: 4, z: 1.5 } }],
  }
}

const record = (t: number, actions: Array<{ action_type: string; action_origin?: string }> = []): TrackerRecord => ({
  t,
  frameCount: Math.round(t * 25),
  frame: frame(actions),
})

const human = (action_type: string) => ({ action_type, action_origin: 'human' })

const ballOf = (r: TrackerRecord) => r.frame.balls?.[0]?.projected_coordinates

describe('turnFrame', () => {
  it('turns every position half round the centre spot, keeping the height', () => {
    const turned = turnFrame(frame())
    expect(turned.teams[0]!.players[0]!.projected_coordinates).toEqual({ x: 48, y: -2 })
    expect(turned.teams[1]!.players[0]!.projected_coordinates).toEqual({ x: -10, y: 20 })
    expect(turned.balls?.[0]?.projected_coordinates).toEqual({ x: -30, y: -4, z: 1.5 })
  })

  it('keeps everything else as it is, a player without a position among it', () => {
    const turned = turnFrame(frame([human('Goal')]))
    expect(turned.teams[1]!.players[1]).toEqual({ track_id: 3 })
    expect(turned.teams[0]!.color_name).toBe('Yellow')
    expect(turned.teams[0]!.players[0]!.person_type).toBe('PersonType.GOALKEEPER')
    expect(turned.state).toEqual({ actions: [human('Goal')] })
    expect(turned.match_id).toBe(1)
  })

  it('leaves the frame it is given alone', () => {
    const original = frame()
    const copy = structuredClone(original)
    turnFrame(original)
    expect(original).toEqual(copy)
  })
})

describe('SecondHalf', () => {
  it('shows every record as it is until a half label is seen', () => {
    const halves = new SecondHalf()
    const r = record(100)
    halves.see(r)
    expect(halves.from).toBeNull()
    expect(halves.shown(r)).toBe(r)
  })

  it.each([
    ['End FirstHalf'],
    ['End first half'],
    ['EventType.END_FIRST_HALF'],
    ['Half Time'],
    ['Start second half'],
    ['Second Half'],
  ])('starts the second half on the human label "%s"', (label) => {
    const halves = new SecondHalf()
    halves.see(record(2700, [human(label)]))
    expect(halves.from).toBe(2700)
  })

  it('turns the records from the label on, and not those before it', () => {
    const halves = new SecondHalf()
    halves.see(record(2700, [human('End FirstHalf')]))
    expect(ballOf(halves.shown(record(2699.96)))).toEqual({ x: 30, y: 4, z: 1.5 })
    expect(ballOf(halves.shown(record(2700)))).toEqual({ x: -30, y: -4, z: 1.5 })
    expect(ballOf(halves.shown(record(3600)))).toEqual({ x: -30, y: -4, z: 1.5 })
  })

  it("ignores the AI's half labels, and those without an origin", () => {
    const halves = new SecondHalf()
    halves.see(record(2700, [{ action_type: 'End FirstHalf', action_origin: 'ai' }]))
    halves.see(record(2701, [{ action_type: 'Start second half' }]))
    expect(halves.from).toBeNull()
  })

  it('ignores the full time and every other label', () => {
    const halves = new SecondHalf()
    halves.see(record(5400, [human('End SecondHalf'), human('Full Time'), human('Kick off')]))
    expect(halves.from).toBeNull()
  })

  it('turns once for both labels, from the earlier, in whichever order they are seen', () => {
    const halves = new SecondHalf()
    halves.see(record(3600, [human('Start second half')]))
    halves.see(record(2700, [human('End FirstHalf')]))
    expect(halves.from).toBe(2700)
    halves.see(record(3600, [human('Start second half')]))
    expect(halves.from).toBe(2700)
    expect(ballOf(halves.shown(record(3700)))).toEqual({ x: -30, y: -4, z: 1.5 })
  })

  it('keeps the second half through a label switched off, a seek back and a seek forward', () => {
    const halves = new SecondHalf()
    halves.see(record(2700, [human('End FirstHalf')]))
    halves.see(record(2710))
    halves.see(record(600))
    expect(halves.shown(record(600)).frame.balls?.[0]?.projected_coordinates?.x).toBe(30)
    halves.see(record(4000))
    expect(halves.shown(record(4000)).frame.balls?.[0]?.projected_coordinates?.x).toBe(-30)
  })

  it('gives the same turned copy of a record each time, without changing the record', () => {
    const halves = new SecondHalf()
    halves.see(record(2700, [human('End FirstHalf')]))
    const r = record(3000)
    const shown = halves.shown(r)
    expect(halves.shown(r)).toBe(shown)
    expect(shown).not.toBe(r)
    expect(shown.t).toBe(3000)
    expect(shown.frameCount).toBe(r.frameCount)
    expect(ballOf(r)).toEqual({ x: 30, y: 4, z: 1.5 })
  })

  it('turns a window as the record it is for, so it never straddles the turn', () => {
    const halves = new SecondHalf()
    const before = record(2695)
    const at = record(2700, [human('End FirstHalf')])
    halves.see(at)
    const window = halves.window([before, at], at)
    expect(window.map((r) => ballOf(r)?.x)).toEqual([-30, -30])
    expect(window[1]).toBe(halves.shown(at))
    const earlier = record(2690)
    expect(halves.window([earlier, before], before)).toEqual([earlier, before])
  })

  it('forgets the second half on reset', () => {
    const halves = new SecondHalf()
    halves.see(record(2700, [human('End FirstHalf')]))
    halves.reset()
    expect(halves.from).toBeNull()
    const r = record(3000)
    expect(halves.shown(r)).toBe(r)
  })
})
