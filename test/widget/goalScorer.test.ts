import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, type MatchTracker, type MatchTrackerOptions } from '../../src/index'
import { SCORER_WAIT_S } from '../../src/director/goal'
import { installEnv, makeHost, type Env } from './env'
import { control } from './recording'

vi.mock('../../src/director/director', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/director/director')>()
  const { recordingDirector } = await import('./recording')
  return { ...real, Director: recordingDirector(real.Director) }
})
vi.mock('../../src/render/renderer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/render/renderer')>()
  const { recordingRenderer } = await import('./recording')
  return { ...real, createRenderer: recordingRenderer(real.createRenderer) }
})

// A goal and then its scorer, twice, as the labelling tool sent them on the staging stream on
// 2026-11-13 (test/fixtures/goal-labels.jsonl.gz): "Goal" names the team, and "Player scored", 4.8 s
// and 2.4 s later, the player.

interface Message {
  timestamp: number
  frame_id: number
  match: { frame_data: Array<{ frame_count: number; frame_uuid: Array<{ timestamp: number; uuid: string }> }>; state: { actions: unknown[] } }
  raw_data: { labels: Record<string, unknown> }
}

const RECORDS: Message[] = gunzipSync(readFileSync(resolve(process.cwd(), 'test/fixtures/goal-labels.jsonl.gz')))
  .toString()
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as Message)
const [GOAL, SCORED] = RECORDS as [Message, Message]

/** `record` as a record of its own at `t`, with no labels: the stream between two labelled records. */
function between(record: Message, t: number, i: number): string {
  const copy = structuredClone(record)
  copy.timestamp = t
  copy.frame_id = record.frame_id + i
  copy.match.frame_data = [{ frame_count: record.frame_id + i, frame_uuid: [{ timestamp: t, uuid: `between-${i}` }] }]
  copy.match.state.actions = []
  copy.raw_data.labels = { ...copy.raw_data.labels, human_label: null }
  return JSON.stringify(copy)
}

let env: Env
const mounted: MatchTracker[] = []

function mount(options: Partial<MatchTrackerOptions> = {}) {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...options })
  mounted.push(tracker)
  env.resize(host, 1280, 760)
  const log: string[] = []
  tracker.on('moment', ({ moment, phase }) => log.push(`${moment}:${phase}`))
  return { host, tracker, log }
}

/** Push the stream from just after `from` up to just before `to`, 25 records a second, a frame each. */
function stream(tracker: MatchTracker, from: Message, to: number): void {
  let i = 1
  for (let t = from.timestamp + 0.04; t < to - 0.02; t += 0.04) {
    tracker.push(between(from, t, i++))
    env.frame(40)
  }
}

/** A second of the stream before the goal: its first record is a seek, on which no label plays. */
function before(tracker: MatchTracker): void {
  for (let i = 25; i > 0; i--) {
    tracker.push(between(GOAL, GOAL.timestamp - i * 0.04, -i))
    env.frame(40)
  }
}

/** The scorer under the goal's banner on the last frame drawn, if any. */
const scorerDrawn = () => control.drawn.at(-1)?.layers?.goalBanner?.scorer

beforeEach(() => {
  env = installEnv()
  control.reset()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('the scorer under a live goal', () => {
  it('waits for the scorer, and plays the goal with them named under it', () => {
    const { tracker, log } = mount({ teams: { away: { name: 'Away United' } } })
    before(tracker)
    tracker.push(JSON.stringify(GOAL))
    env.frame(40)
    stream(tracker, GOAL, SCORED.timestamp)
    expect(log).toEqual([])
    tracker.push(JSON.stringify(SCORED))
    for (let i = 0; i < 90; i++) env.frame(16)
    expect(log).toEqual(['goal:start'])
    expect(scorerDrawn()).toEqual({ player: 'Skyler Fring', team: 'Away United', intensity: 1 })
  })

  it('plays the goal without a scorer when none comes in time', () => {
    const { tracker, log } = mount()
    before(tracker)
    tracker.push(JSON.stringify(GOAL))
    env.frame(40)
    stream(tracker, GOAL, GOAL.timestamp + SCORER_WAIT_S + 0.5)
    expect(log).toEqual(['goal:start'])
    for (let i = 0; i < 60; i++) env.frame(16)
    expect(scorerDrawn()).toBeUndefined()
  })

  it('waits only live: replay, and the replays of earlier moments, play the goal on its label', () => {
    mount()
    expect(control.options[0]!.scorerWaitS).toBe(SCORER_WAIT_S)
    control.reset()
    mount({ mode: 'replay' })
    expect(control.options[0]!.scorerWaitS ?? 0).toBe(0)
  })
})
