import { describe, expect, it } from 'vitest'
import { parseRecord } from '../../src/model/parseRecord'
import { hasBall, heldRecord } from '../../src/model/heldRecord'
import type { TrackerRecord } from '../../src/model/types'

/** A bare match whose `frame_uuid` window ends at `t`. */
function match(frameCount: number, t: number, extra: object = {}) {
  return {
    match_id: 1,
    pitch_dimensions: { length: 105, width: 68 },
    teams: [{ team_id: 0, players: [], actions: [] }],
    balls: [],
    state: { actions: [] },
    frame_data: [{ frame_count: frameCount, frame_uuid: [{ timestamp: t, uuid: 'a' }] }],
    ...extra,
  }
}

/** The pipeline's envelope, double-encoded, with `raw_data` beside `match`. */
function message(rawData: unknown, frameCount = 7, t = 12) {
  return JSON.stringify(JSON.stringify({ uuid: 'u', timestamp: t - 0.32, frame_id: 1, match: match(frameCount, t), raw_data: rawData }))
}

/** `raw_data` as the staging hose sends it, reduced to the keys read, plus one it does not read. */
function rawData(frameState: unknown, lookahead: object | undefined) {
  return {
    schema_version: 1,
    frame: { frame_id: 1, frame_state: 'skipped' },
    source_frame: { frame_id: 2, frame_state: frameState },
    detections: { persons: [{ x: 1, y: 2 }] },
    agentic: { is_valid_game_state: true, invalid_block_active: false, ...(lookahead ? { lookahead } : {}) },
  }
}

describe('parseRecord validity', () => {
  it('reads an invalid frame and its countdowns', () => {
    const record = parseRecord(
      message(rawData('invalid', { horizon_s: 10, valid_ratio: 0.3, next_invalid_in_s: 0, next_valid_in_s: 3.92 })),
    )
    expect(record?.validity).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: 3.92, horizonS: 10 })
  })

  it('reads a valid frame with no invalid one within the horizon', () => {
    const record = parseRecord(
      message(rawData('valid', { horizon_s: 10, valid_ratio: 1, next_invalid_in_s: null, next_valid_in_s: 0 })),
    )
    expect(record?.validity).toEqual({ invalid: false, nextInvalidInS: null, nextValidInS: 0, horizonS: 10 })
  })

  it('takes only frame_state "invalid" as invalid', () => {
    expect(parseRecord(message(rawData('skipped', undefined)))?.validity?.invalid).toBe(false)
    expect(parseRecord(message(rawData('INVALID', undefined)))?.validity?.invalid).toBe(false)
  })

  it('reads the source frame, not raw_data.frame or the agentic flags', () => {
    const raw = rawData('valid', undefined)
    raw.agentic.is_valid_game_state = false
    raw.agentic.invalid_block_active = true
    expect(parseRecord(message(raw))?.validity?.invalid).toBe(false)
  })

  it('has no countdowns without a lookahead', () => {
    expect(parseRecord(message(rawData('invalid', undefined)))?.validity).toEqual({
      invalid: true,
      nextInvalidInS: null,
      nextValidInS: null,
    })
  })

  it('drops a countdown that is negative, not finite or not a number', () => {
    for (const bad of [-0.04, '1', true, {}, Number.NaN]) {
      const record = parseRecord(message(rawData('valid', { next_invalid_in_s: bad, next_valid_in_s: bad })))
      expect(record?.validity).toEqual({ invalid: false, nextInvalidInS: null, nextValidInS: null })
    }
    const text = (n: string) =>
      `{"match":${JSON.stringify(match(1, 1))},"raw_data":{"source_frame":{"frame_state":"valid"},"agentic":{"lookahead":{"next_invalid_in_s":${n}}}}}`
    expect(parseRecord(text('1e999'))?.validity?.nextInvalidInS).toBeNull()
    expect(parseRecord(text('2.5'))?.validity?.nextInvalidInS).toBe(2.5)
  })

  it('has no horizon unless it is a number above 0', () => {
    for (const bad of [0, -1, '10', null, Number.NaN]) {
      const record = parseRecord(message(rawData('valid', { horizon_s: bad, next_invalid_in_s: null, next_valid_in_s: 0 })))
      expect(record?.validity && 'horizonS' in record.validity).toBe(false)
    }
  })

  it('has no validity without raw_data, or without a source frame_state', () => {
    for (const raw of [undefined, null, 'x', {}, { source_frame: {} }, { source_frame: { frame_state: 3 } }]) {
      const record = parseRecord(message(raw))
      expect(record).not.toBeNull()
      expect(record && 'validity' in record).toBe(false)
    }
  })

  it('keeps nothing else of raw_data', () => {
    const record = parseRecord(message(rawData('valid', { next_invalid_in_s: null, next_valid_in_s: 0 })))
    expect(Object.keys(record ?? {}).sort()).toEqual(['frame', 'frameCount', 't', 'validity'])
    expect(JSON.stringify(record)).not.toContain('persons')
  })
})

describe('heldRecord', () => {
  const ball = (x: number) => [{ projected_coordinates: { x, y: 0, z: 0 } }]
  const player = (x: number) => ({ track_id: 1, projected_coordinates: { x, y: 0 } })
  const lastValid: TrackerRecord = {
    t: 10,
    frameCount: 250,
    validity: { invalid: false, nextInvalidInS: 0.04, nextValidInS: 0 },
    frame: {
      pitch_dimensions: { length: 105, width: 68 },
      teams: [{ team_id: 0, players: [player(5)], actions: [] }],
      balls: ball(5),
      state: { actions: [{ action_type: 'EventType.BALL_IN_PLAY', action_origin: 'ai' }] },
      frame_data: [{ frame_count: 250 }],
    },
  }
  const invalid: TrackerRecord = {
    t: 11,
    frameCount: 275,
    validity: { invalid: true, nextInvalidInS: 0, nextValidInS: 2 },
    frame: {
      pitch_dimensions: { length: 105, width: 68 },
      teams: [{ team_id: 0, players: [player(30)], actions: [] }],
      balls: ball(30),
      state: { actions: [{ action_type: 'EventType.GOAL', action_origin: 'human' }] },
      frame_data: [{ frame_count: 275 }],
    },
  }

  it("keeps the last valid record's players and ball", () => {
    const held = heldRecord(invalid, lastValid)
    expect(held.frame.teams).toBe(lastValid.frame.teams)
    expect(held.frame.balls).toBe(lastValid.frame.balls)
    expect(held.frame.pitch_dimensions).toBe(lastValid.frame.pitch_dimensions)
  })

  it("takes the invalid record's time, frame number, labels and validity", () => {
    const held = heldRecord(invalid, lastValid)
    expect(held.t).toBe(11)
    expect(held.frameCount).toBe(275)
    expect(held.validity).toBe(invalid.validity)
    expect(held.frame.state).toBe(invalid.frame.state)
    expect(held.frame.frame_data).toEqual([{ frame_count: 275 }])
  })

  it('changes neither record', () => {
    const before = JSON.stringify([invalid, lastValid])
    heldRecord(invalid, lastValid)
    expect(JSON.stringify([invalid, lastValid])).toBe(before)
  })
})

describe('heldRecord with a ball of its own', () => {
  it('takes the ball it is given, and the rest from the last valid record', () => {
    const lastValid: TrackerRecord = { t: 1, frameCount: 1, frame: { teams: [], balls: [] } }
    const record: TrackerRecord = { t: 2, frameCount: 2, frame: { teams: [], balls: [] } }
    const balls = [{ projected_coordinates: { x: 3, y: 4 } }]
    const held = heldRecord(record, lastValid, balls)
    expect(held.frame.balls).toBe(balls)
    expect(held.frame.teams).toBe(lastValid.frame.teams)
  })

  it('knows a frame with a ball from one without', () => {
    expect(hasBall({ teams: [], balls: [{ projected_coordinates: { x: 1, y: 2 } }] })).toBe(true)
    expect(hasBall({ teams: [], balls: [{ projected_coordinates: { x: null as unknown as number, y: 2 } }] })).toBe(false)
    expect(hasBall({ teams: [], balls: [] })).toBe(false)
    expect(hasBall({ teams: [] })).toBe(false)
  })
})
