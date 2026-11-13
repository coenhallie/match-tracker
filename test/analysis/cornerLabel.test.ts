import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { cornerLabel, isCornerFrame } from '../../src/analysis/cornerLabel'
import { SecondHalf } from '../../src/analysis/secondHalf'
import { parseRecord } from '../../src/model/parseRecord'
import type { Frame, FrameAction, TrackerRecord } from '../../src/model/types'

const frame = (...actions: FrameAction[]): Frame => ({ teams: [], state: { actions } })
const human = (action_type: string): FrameAction => ({ action_type, action_origin: 'human' })
const record = (f: Frame, t = 10): TrackerRecord => ({ t, frameCount: 1, frame: f })

describe('which corner a label names', () => {
  it('reads the corner from the label the labelling tool sends', () => {
    const cases = [
      ['Corner kick - Top left', { x: -1, y: -1 }],
      ['Corner kick - Top right', { x: 1, y: -1 }],
      ['Corner kick - Bottom left', { x: -1, y: 1 }],
      ['Corner kick - Bottom right', { x: 1, y: 1 }],
    ] as const
    for (const [label, side] of cases) {
      expect({ label, corner: cornerLabel(record(frame(human(label)))) }).toEqual({ label, corner: { side, team: null } })
    }
  })

  it('names no corner for a label without one, however the export writes it', () => {
    for (const label of ['Corner', 'Corner kick', 'EventType.CORNER_KICK', 'EventType.CORNER']) {
      expect({ label, corner: cornerLabel(record(frame(human(label)))) }).toEqual({ label, corner: { side: null, team: null } })
    }
  })

  it('is no corner without a human corner label', () => {
    expect(cornerLabel(record(frame()))).toBeNull()
    expect(cornerLabel(record(frame(human('Throw in'))))).toBeNull()
    expect(cornerLabel(record(frame(human('Corner kick - Middle left'))))).toBeNull()
    expect(cornerLabel(record(frame({ action_type: 'Corner kick - Top left', action_origin: 'ai' })))).toBeNull()
    expect(cornerLabel(record(frame({ action_type: 'Corner kick - Top left' })))).toBeNull()
  })

  it('takes the first label that names a corner, before one that does not', () => {
    expect(cornerLabel(record(frame(human('Corner'), human('Corner kick - Bottom right'))))).toEqual({ side: { x: 1, y: 1 }, team: null })
  })

  it('turns the corner round in the second half, as the pitch is', () => {
    const halves = new SecondHalf()
    halves.see(record(frame(human('Start second half')), 2700))
    const shown = halves.shown(record(frame(human('Corner kick - Bottom left')), 2800))
    // The camera stays on its touchline: its bottom left is the turned pitch's top right.
    expect(cornerLabel(shown)).toEqual({ side: { x: 1, y: -1 }, team: null })
    expect(cornerLabel(halves.shown(record(frame(human('Corner')), 2800)))).toEqual({ side: null, team: null })
  })

  it('names the team taking it from the label, as the labelling tool sends it', () => {
    const teamed = (action_type: string, team_id: unknown): FrameAction =>
      ({ ...human(action_type), team_id }) as FrameAction
    expect(cornerLabel(record(frame(teamed('Corner kick - Top left', 0))))).toEqual({ side: { x: -1, y: -1 }, team: 0 })
    expect(cornerLabel(record(frame(teamed('Corner kick - Bottom right', 1))))).toEqual({ side: { x: 1, y: 1 }, team: 1 })
    expect(cornerLabel(record(frame(teamed('Corner', 1))))).toEqual({ side: null, team: 1 })
    // Anything but 0 or 1 is no team: the tracking writes -1 for the officials.
    for (const team_id of [-1, 2, '0', null]) {
      expect(cornerLabel(record(frame(teamed('Corner kick - Top left', team_id))))?.team).toBeNull()
    }
  })

  it('takes the team from the label it goes by', () => {
    const teamed = (action_type: string, team_id: number): FrameAction => ({ ...human(action_type), team_id })
    expect(cornerLabel(record(frame(teamed('Corner', 0), teamed('Corner kick - Top right', 1))))).toEqual({ side: { x: 1, y: -1 }, team: 1 })
    expect(cornerLabel(record(frame(teamed('Corner', 0), teamed('Corner kick', 1))))).toEqual({ side: null, team: 0 })
  })

  it('keeps the team in the second half, turning only the corner', () => {
    const halves = new SecondHalf()
    halves.see(record(frame(human('Start second half')), 2700))
    const shown = halves.shown(record(frame({ ...human('Corner kick - Bottom left'), team_id: 1 }), 2800))
    expect(cornerLabel(shown)).toEqual({ side: { x: 1, y: -1 }, team: 1 })
  })

  it('counts every corner label as a corner, and nothing else', () => {
    for (const label of ['Corner', 'Corner kick', 'EventType.CORNER_KICK', 'EventType.CORNER', 'Corner kick - Top left', 'Corner kick - Bottom right']) {
      expect({ label, corner: isCornerFrame(frame(human(label))) }).toEqual({ label, corner: true })
    }
    for (const label of ['EventType.FREE_KICK', 'EventType.GOAL_KICK', 'Short corner routine', 'Corner kick - Middle left']) {
      expect({ label, corner: isCornerFrame(frame(human(label))) }).toEqual({ label, corner: false })
    }
    expect(isCornerFrame(frame())).toBe(false)
    expect(isCornerFrame(frame({ action_type: 'Corner', action_origin: 'ai' }))).toBe(false)
  })

  it('reads the corner off records from the staging stream', () => {
    // One label per corner, as the labelling tool sent them on 2026-11-13.
    const lines = gunzipSync(readFileSync(resolve(process.cwd(), 'test/fixtures/corner-labels.jsonl.gz')))
      .toString()
      .trim()
      .split('\n')
    const read = lines.map((line) => {
      const r = parseRecord(JSON.parse(line))!
      return [r.frame.state!.actions!.find((a) => /corner/i.test(String(a.action_type)))!.action_type, cornerLabel(r)]
    })
    // The team is the one the labeller picked for each.
    expect(Object.fromEntries(read)).toEqual({
      'Corner kick - Bottom left': { side: { x: -1, y: 1 }, team: 0 },
      'Corner kick - Top left': { side: { x: -1, y: -1 }, team: 0 },
      'Corner kick - Top right': { side: { x: 1, y: -1 }, team: 0 },
      'Corner kick - Bottom right': { side: { x: 1, y: 1 }, team: 1 },
    })
  })
})
