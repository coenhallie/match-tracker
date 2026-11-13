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
      expect({ label, corner: cornerLabel(record(frame(human(label)))) }).toEqual({ label, corner: { side } })
    }
  })

  it('names no corner for a label without one, however the export writes it', () => {
    for (const label of ['Corner', 'Corner kick', 'EventType.CORNER_KICK', 'EventType.CORNER']) {
      expect({ label, corner: cornerLabel(record(frame(human(label)))) }).toEqual({ label, corner: { side: null } })
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
    expect(cornerLabel(record(frame(human('Corner'), human('Corner kick - Bottom right'))))).toEqual({ side: { x: 1, y: 1 } })
  })

  it('turns the corner round in the second half, as the pitch is', () => {
    const halves = new SecondHalf()
    halves.see(record(frame(human('Start second half')), 2700))
    const shown = halves.shown(record(frame(human('Corner kick - Bottom left')), 2800))
    // The camera stays on its touchline: its bottom left is the turned pitch's top right.
    expect(cornerLabel(shown)).toEqual({ side: { x: 1, y: -1 } })
    expect(cornerLabel(halves.shown(record(frame(human('Corner')), 2800)))).toEqual({ side: null })
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
      return [r.frame.state!.actions!.find((a) => /corner/i.test(String(a.action_type)))!.action_type, cornerLabel(r)?.side]
    })
    expect(Object.fromEntries(read)).toEqual({
      'Corner kick - Bottom left': { x: -1, y: 1 },
      'Corner kick - Top left': { x: -1, y: -1 },
      'Corner kick - Top right': { x: 1, y: -1 },
      'Corner kick - Bottom right': { x: 1, y: 1 },
    })
  })
})
