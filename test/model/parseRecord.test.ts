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
