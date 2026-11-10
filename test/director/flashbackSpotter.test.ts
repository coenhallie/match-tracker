import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
import { deriveAt, windowAt } from '../../src/analysis/derive'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import { AREA_REARM_S, FlashbackSpotter, LABEL_REARM_S } from '../../src/director/flashbackSpotter'
import type { SpottedMoment } from '../../src/model/flashback'
import { carriedValidity, type CarriedValidity } from '../../src/model/validity'
import { parseRecord } from '../../src/model/parseRecord'
import type { Frame, RecordValidity, TrackerRecord } from '../../src/model/types'

const frameWith = (ball: { x: number; y: number }, labels: string[] = [], origin: string | null = 'human'): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68, penalty_area_length: 16.5, penalty_area_width: 40.32 },
    teams: [],
    balls: [{ projected_coordinates: ball }],
    state: { actions: labels.map((action_type) => ({ action_type, ...(origin === null ? {} : { action_origin: origin }) })) },
    frame_data: [{ frame_count: 1 }],
  }) as unknown as Frame

let counter = 0
const record = (t: number, ball = { x: 0, y: 0 }, labels: string[] = [], origin: string | null = 'human'): TrackerRecord => ({
  t,
  frameCount: ++counter,
  frame: frameWith(ball, labels, origin),
})

const ATTACKING: TeamPhase = { possession: 0, attacks: { 0: 1, 1: -1 }, states: { 0: 'attacking', 1: 'defending' } }
const NOBODY: TeamPhase = { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }

const run = (records: TrackerRecord[], phase: TeamPhase | null = ATTACKING) => {
  const spotter = new FlashbackSpotter()
  const spotted: SpottedMoment[] = []
  for (const r of records) {
    const s = spotter.spot(r, phase)
    if (s) spotted.push(s)
  }
  return spotted
}

describe('FlashbackSpotter', () => {
  it('spots a human goal label once per run', () => {
    const records = [record(10, undefined, ['goal']), record(10.04, undefined, ['goal']), record(10.08, undefined, ['goal'])]
    for (let t = 10.12; t < 30; t += 0.04) records.push(record(t))
    records.push(record(30, undefined, ['goal']))
    const spotted = run(records)
    expect(spotted.map(({ kind, at }) => ({ kind, at }))).toEqual([
      { kind: 'goal', at: 10 },
      { kind: 'goal', at: 30 },
    ])
    expect(LABEL_REARM_S).toBe(15)
  })

  it('ignores AI labels, and labels with no origin', () => {
    const records = [
      record(1, undefined, ['goal'], 'ai'),
      record(2, undefined, ['corner'], 'ai'),
      record(3, undefined, ['goal'], null),
      record(4, undefined, ['corner'], null),
    ]
    expect(run(records)).toEqual([])
  })

  it('spots a corner, a shot on goal and a header on goal', () => {
    const records = [record(1, undefined, ['corner']), record(20, undefined, ['shot on goal']), record(40, undefined, ['header on goal'])]
    expect(run(records).map((s) => s.kind)).toEqual(['corner', 'shot', 'shot'])
  })

  it('takes the most important of two labels on one record', () => {
    expect(run([record(1, undefined, ['corner', 'goal'])]).map((s) => s.kind)).toEqual(['goal'])
  })

  it('spots the ball entering the penalty area the team in possession attacks', () => {
    const entry = [record(1, { x: 30, y: 0 }), record(1.04, { x: 35, y: 0 }), record(1.08, { x: 36, y: 0 }), record(1.12, { x: 40, y: 0 })]
    const spotted = run(entry)
    expect(spotted).toHaveLength(1)
    expect(spotted[0]).toMatchObject({ kind: 'attack', at: 1.08, frameCount: entry[2]!.frameCount })
    expect(run([record(1, { x: -30, y: 0 }), record(1.04, { x: -40, y: 0 })])).toEqual([])
    expect(run([record(1, { x: 30, y: 0 }), record(1.04, { x: 40, y: 0 })], NOBODY)).toEqual([])
    expect(run([record(1, { x: 30, y: 0 }), record(1.04, { x: 40, y: 0 })], { ...NOBODY, possession: 0 })).toHaveLength(1)
    expect(run([record(1, { x: 30, y: 0 }), record(1.04, { x: 40, y: 0 })], null)).toEqual([])
    expect(run([record(1, { x: 30, y: 0 }), record(1.04, { x: 40, y: 30 })])).toEqual([])
  })

  it('re-arms the area only after 15 s outside it', () => {
    const cycle = (outsideS: number) => {
      const records = [record(100, { x: 40, y: 0 })]
      let t = 100
      const end = 100 + outsideS
      while (t + 0.04 <= end + 1e-9) records.push(record((t += 0.04), { x: 20, y: 0 }))
      records.push(record(t + 0.04, { x: 40, y: 0 }))
      return run(records)
    }
    expect(cycle(10)).toHaveLength(1)
    expect(cycle(15.04)).toHaveLength(2)
    expect(AREA_REARM_S).toBe(15)
  })

  it('forgets its re-arm memory when the stream restarts', () => {
    const spotted = run([record(1000, undefined, ['goal']), record(500, undefined, ['goal'])])
    expect(spotted).toHaveLength(2)
  })

  it('finds an attack into the box before a long run in the staging fixture', () => {
    const lines = gunzipSync(readFileSync(resolve(process.cwd(), 'test/fixtures/staging-validity.jsonl.gz')))
      .toString('utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
    const spotter = new FlashbackSpotter()
    const valid: TrackerRecord[] = []
    const attacks: SpottedMoment[] = []
    let last: CarriedValidity | null = null
    let longRunAt: number | null = null
    for (const line of lines) {
      const parsed = parseRecord(JSON.parse(line))
      if (!parsed) continue
      const stated = parsed.validity
      if (stated) last = { t: parsed.t, validity: stated }
      // A long run is one a record states itself; a guessed flip has a null countdown and no horizon.
      if (stated && stated.invalid && (stated.nextValidInS === null ? stated.horizonS !== undefined : stated.nextValidInS >= 5)) {
        longRunAt ??= parsed.t
      }
      const carried: RecordValidity | null = stated ?? carriedValidity(last, parsed.t)
      if (carried && carried.invalid) continue
      valid.push(parsed)
      const { phase } = deriveAt(windowAt(valid, parsed), parsed)
      const spotted = spotter.spot(parsed, phase)
      if (spotted?.kind === 'attack') attacks.push(spotted)
    }
    expect(attacks.length).toBeGreaterThan(0)
    expect(longRunAt).not.toBeNull()
    expect(attacks.some((a) => a.at < longRunAt!)).toBe(true)
  })
})
