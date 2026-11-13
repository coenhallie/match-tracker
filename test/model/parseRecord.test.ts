import { describe, expect, it } from 'vitest'
import messages from '../fixtures/pipeline-messages.json'
import { parseRecord } from '../../src/model/parseRecord'

const DT = 0.04

/** A bare frame whose `frame_uuid` window ends at `t`, as the pipeline sends it. */
function frame(frameCount: number, t: number, extra: object = {}, windowSize = 9) {
  const frame_uuid = Array.from({ length: windowSize }, (_, i) => ({
    timestamp: t - (windowSize - 1 - i) * DT,
    uuid: String.fromCharCode(97 + i),
  }))
  return {
    match_id: 1,
    pitch_dimensions: { length: 105, width: 68 },
    teams: [{ team_id: 0, players: [], actions: [] }],
    balls: [],
    state: { actions: [] },
    frame_data: [{ frame_count: frameCount, frame_uuid }],
    ...extra,
  }
}

describe('parseRecord decoding', () => {
  it('decodes the double-encoded envelope the pipeline sends', () => {
    const record = parseRecord(messages[0])
    expect(record).not.toBeNull()
    expect(record?.frame.teams).toHaveLength(3)
    expect(record?.frame.pitch_dimensions?.length).toBe(105)
  })

  it('decodes a bare match, single-encoded', () => {
    const record = parseRecord(JSON.stringify(frame(12, 5)))
    expect(record?.frameCount).toBe(12)
  })

  it('unwraps a { match } envelope given as a string', () => {
    const record = parseRecord(JSON.stringify({ match: frame(12, 5) }))
    expect(record?.frameCount).toBe(12)
  })

  it('accepts an envelope object', () => {
    const record = parseRecord({ uuid: 'x', timestamp: 1, frame_id: 3, match: frame(3, 1) })
    expect(record?.frameCount).toBe(3)
  })

  it('accepts a bare frame object', () => {
    expect(parseRecord(frame(4, 2))?.frameCount).toBe(4)
  })
})

describe('parseRecord fields', () => {
  it('lifts t from the LAST frame_uuid entry and frameCount from frame_data', () => {
    const record = parseRecord(messages[0])
    expect(record?.frameCount).toBe(55149)
    expect(record?.t).toBe(2697.604692585)
  })

  it('takes the last entry, not the first, of a full window', () => {
    const line = {
      frame_data: [
        {
          frame_count: 30426,
          frame_uuid: [
            { timestamp: 2619.529, uuid: 'a' },
            { timestamp: 2619.569, uuid: 'b' },
            { timestamp: 2619.848, uuid: 'z' },
          ],
        },
      ],
      teams: [],
    }
    const record = parseRecord(line)
    expect(record?.t).toBeCloseTo(2619.848, 5)
    expect(record?.t).not.toBeCloseTo(2619.529, 5)
  })

  it('takes the last entry of a partially filled window', () => {
    expect(parseRecord(frame(2, 10.08, {}, 2))?.t).toBeCloseTo(10.08, 5)
    expect(parseRecord(frame(1, 10, {}, 1))?.t).toBeCloseTo(10, 5)
  })

  it('strips frame_uuid from the retained frame but keeps frame_count', () => {
    const record = parseRecord(frame(9, 1))
    expect(record?.frame.frame_data).toEqual([{ frame_count: 9 }])
  })

  it('does not mutate a frame object it was given', () => {
    const input = frame(9, 1)
    parseRecord(input)
    expect(input.frame_data[0]?.frame_uuid).toHaveLength(9)
  })

  it('keeps a frame with null ball coordinates', () => {
    const balls = [{ projected_coordinates: { x: null, y: null, z: null } }]
    const record = parseRecord(frame(5, 1, { balls }))
    expect(record).not.toBeNull()
    expect(record?.frame.balls).toHaveLength(1)
  })

  it('normalises malformed collections so consumers never throw', () => {
    const record = parseRecord(
      frame(6, 1, {
        teams: [null, 7, { team_id: 0, players: {}, actions: 'x' }, { team_id: 1, players: [null, { track_id: 1 }] }],
        state: { actions: {} },
        balls: 'nope',
      }),
    )
    expect(record).not.toBeNull()
    expect(record?.frame.teams).toHaveLength(2)
    expect(record?.frame.teams[0]).toMatchObject({ team_id: 0, players: [], actions: [] })
    expect(record?.frame.teams[1]?.players).toEqual([{ track_id: 1 }])
    expect(record?.frame.state?.actions).toEqual([])
    expect(record?.frame.balls).toEqual([])
  })
})

describe('parseRecord rejects', () => {
  it('a missing frame_uuid', () => {
    expect(parseRecord({ teams: [], frame_data: [{ frame_count: 1 }] })).toBeNull()
  })

  it('an empty frame_uuid', () => {
    expect(parseRecord({ teams: [], frame_data: [{ frame_count: 1, frame_uuid: [] }] })).toBeNull()
  })

  it('a missing frame_data or frame_count', () => {
    expect(parseRecord({ teams: [] })).toBeNull()
    expect(parseRecord(frame(1, 1, { frame_data: [{ frame_uuid: [{ timestamp: 1 }] }] }))).toBeNull()
  })

  it('a non-numeric timestamp', () => {
    expect(parseRecord(frame(1, 1, { frame_data: [{ frame_count: 1, frame_uuid: [{ timestamp: 'x' }] }] }))).toBeNull()
  })

  it('a timestamp or frame_count that is not finite, as JSON reads 1e999', () => {
    const text = (t: string, count: string) =>
      `{"teams":[],"frame_data":[{"frame_count":${count},"frame_uuid":[{"timestamp":${t},"uuid":"a"}]}]}`
    expect(parseRecord(text('5', '1'))?.frameCount).toBe(1)
    expect(parseRecord(text('1e999', '1'))).toBeNull()
    expect(parseRecord(text('-1e999', '1'))).toBeNull()
    expect(parseRecord(text('5', '1e999'))).toBeNull()
    expect(parseRecord({ teams: [], frame_data: [{ frame_count: NaN, frame_uuid: [{ timestamp: 5 }] }] })).toBeNull()
  })

  it('non-JSON text', () => {
    expect(parseRecord('{ not json')).toBeNull()
  })

  it('teams that is not an array', () => {
    expect(parseRecord(frame(1, 1, { teams: 'x' }))).toBeNull()
    expect(parseRecord(frame(1, 1, { teams: {} }))).toBeNull()
  })

  it('undefined and other garbage', () => {
    for (const bad of [undefined, '', '{', 'null', '"just text"', 42, null, { match: {} }, []]) {
      expect(parseRecord(bad)).toBeNull()
    }
  })
})

describe("a player label's name", () => {
  /**
   * A record with one human label on it, as the live stream sends it since 2026-11-12: the entry in
   * `state.actions` carries no name, and `raw_data.labels.human_label.items` carries the labelling
   * tool's `player_name`.
   */
  function labelled(items: Record<string, unknown>, label: Record<string, unknown> = {}, entry: Record<string, unknown> = {}) {
    const card = { action_type: 'Player yellow card', action_origin: 'human', uuid: 'u1', team_id: 1, player_number: 7, player_id: 23 }
    return {
      match: {
        ...frame(225090, 100),
        state: { actions: [{ action_type: 'EventType.BALL_IN_PLAY', action_origin: 'ai' }, { ...card, ...entry }] },
      },
      raw_data: {
        labels: {
          human_label: {
            uuid: 'u1',
            frame_match: 'current',
            action_name: 'Player yellow card',
            obj: 'player',
            items: { team_id: 1, player_name: 'Lando Fring', team_name: 'Team Away', player: 23, number: 7, ...items },
            ...label,
          },
        },
      },
    }
  }
  const entry = (message: unknown) => parseRecord(message)!.frame.state!.actions![1]!

  it("puts the label's player name on its entry in state.actions", () => {
    expect(entry(labelled({})).player_name).toBe('Lando Fring')
    expect(entry(JSON.stringify(JSON.stringify(labelled({})))).player_name).toBe('Lando Fring')
  })

  it('leaves the entry its own name, when the stream gives it one', () => {
    expect(entry(labelled({}, {}, { player_name: 'Han Fett' })).player_name).toBe('Han Fett')
  })

  it('takes the label’s name over an entry’s name that is no name', () => {
    expect(entry(labelled({}, {}, { player_name: 'None' })).player_name).toBe('Lando Fring')
  })

  it('takes no name that is not one', () => {
    for (const player_name of [null, undefined, '', '  ', 'None', 'null', 7, {}]) {
      expect(entry(labelled({ player_name })).player_name).toBeUndefined()
    }
    expect(entry(labelled({ player_name: '  Lando Fring ' })).player_name).toBe('Lando Fring')
  })

  it("puts a substitution label's two names on its entry: the player coming on's, and the player going off's", () => {
    const sub = entry(labelled({ player_name: 'Han Tano', player_name_out: 'Charles Windu' }, { obj: 'subst', action_name: 'substitute' }))
    expect(sub.player_name).toBe('Han Tano')
    expect(sub.player_name_out).toBe('Charles Windu')
    const none = entry(labelled({ player_name: null, player_name_out: 'None' }, { obj: 'subst' }))
    expect(none.player_name).toBeUndefined()
    expect(none.player_name_out).toBeUndefined()
    const own = entry(labelled({ player_name: 'Han Tano', player_name_out: 'Charles Windu' }, { obj: 'subst' }, { player_name_out: 'Own Name' }))
    expect(own.player_name).toBe('Han Tano')
    expect(own.player_name_out).toBe('Own Name')
  })

  it('takes no going-off name from a label about one player', () => {
    expect(entry(labelled({ player_name_out: 'Charles Windu' })).player_name_out).toBeUndefined()
  })

  it('takes no name from a label about no player, or about another entry', () => {
    expect(entry(labelled({}, { obj: 'game' })).player_name).toBeUndefined()
    expect(entry(labelled({}, { uuid: 'u2' })).player_name).toBeUndefined()
    expect(entry(labelled({}, {}, { uuid: undefined })).player_name).toBeUndefined()
    const { raw_data: _, ...bare } = labelled({})
    expect(entry(bare).player_name).toBeUndefined()
  })

  it('does not change the message it was given', () => {
    const message = labelled({})
    parseRecord(message)
    expect('player_name' in message.match.state.actions[1]!).toBe(false)
  })
})

describe("a label's team", () => {
  /**
   * A record with one human label, as production sent it on 2026-11-13: the entry's `team_id` is the
   * team's id in the backend (807, Australia), not the side, and `raw_data.labels.human_label.items`
   * says the side (`is_home`) and the team's name (`team_name`).
   */
  function labelled(items: Record<string, unknown>, label: Record<string, unknown> = {}, entry: Record<string, unknown> = {}) {
    const card = { action_type: 'Player red card', action_origin: 'human', uuid: 'u1', team_id: 807, player_number: 4, player_id: 118678 }
    return {
      match: { ...frame(225090, 100), state: { actions: [{ ...card, ...entry }] } },
      raw_data: {
        labels: {
          human_label: {
            uuid: 'u1',
            frame_match: 'current',
            action_name: 'Player red card',
            obj: 'player',
            items: { is_home: 0, team_id: 807, player_name: 'Jacob Italiano', team_name: 'Australia', player: 118678, number: 4, ...items },
            ...label,
          },
        },
      },
    }
  }
  const entry = (message: unknown) => parseRecord(message)!.frame.state!.actions![0]!

  it("puts the label's team name and side on its entry, for every kind of label", () => {
    for (const label of [{}, { obj: 'subst', action_name: 'substitute' }, { obj: 'game', action_name: 'Goal' }]) {
      const read = entry(labelled({}, label))
      expect({ label, team_name: read.team_name, is_home: read.is_home }).toEqual({ label, team_name: 'Australia', is_home: 0 })
    }
    // A game label's side, as staging sends it: a word.
    expect(entry(labelled({ is_home: 'home', team_name: 'Team Home' }, { obj: 'game' })).is_home).toBe('home')
  })

  it('leaves the entry its own, when the stream gives it one', () => {
    const own = entry(labelled({}, {}, { team_name: 'Socceroos', is_home: 1 }))
    expect(own.team_name).toBe('Socceroos')
    expect(own.is_home).toBe(1)
  })

  it('takes no name or side that is not one', () => {
    for (const team_name of [null, undefined, '', ' ', 'None', 7]) {
      expect(entry(labelled({ team_name })).team_name).toBeUndefined()
    }
    for (const is_home of [null, undefined, 2, -1, 'yes', '', {}]) {
      expect(entry(labelled({ is_home })).is_home).toBeUndefined()
    }
    expect(entry(labelled({}, { uuid: 'u2' })).team_name).toBeUndefined()
  })
})
