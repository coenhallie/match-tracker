import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, parseRecord, type MatchTracker, type TrackerRecord } from '../../src/index'
import { deriveAt, windowAt } from '../../src/analysis/derive'
import { installEnv, makeHost, type Env } from './env'
import { control } from './fakeDirector'
import { message } from './messages'

vi.mock('../../src/director/director', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/director/director')>()
  const { switchable } = await import('./fakeDirector')
  return { ...real, Director: switchable(real.Director) }
})

let env: Env
const mounted: MatchTracker[] = []
const records: TrackerRecord[] = Array.from({ length: 20 }, (_, i) => parseRecord(message(i))!)

function mount() {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'replay', layersStorageKey: null })
  mounted.push(tracker)
  env.resize(host, 1280, 760)
  const log: string[] = []
  tracker.on('moment', ({ moment, phase }) => log.push(`${moment}:${phase}`))
  return { host, tracker, log }
}

/** What the replay host hands over at `time`: the record at or before it, and the records before that. */
function stateAt(time: number, playing = true) {
  const at = Math.max(0, Math.min(records.length - 1, Math.floor((time - 10) / 0.04 + 1e-9)))
  return { time, playing, record: records[at]!, lookback: records.slice(0, at + 1) }
}

beforeEach(() => {
  env = installEnv()
  control.reset()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('replay input', () => {
  it('runs steps of the clock forward as playback', () => {
    const { tracker } = mount()
    for (const time of [10, 10.04, 10.08, 10.5, 10.9]) {
      tracker.present(stateAt(time))
      env.frame()
    }
    expect(control.inputs.map((i) => i.time)).toEqual([10, 10.04, 10.08, 10.5, 10.9])
    expect(control.inputs.map((i) => i.playback)).toEqual([false, true, true, true, true])
    expect(control.inputs.every((i) => i.playing)).toBe(true)
  })

  it('works out the phase and trail from the lookback it is given', () => {
    const { tracker } = mount()
    const state = stateAt(10.2)
    tracker.present(state)
    env.frame()
    const { phase, trail } = deriveAt(windowAt(state.lookback, state.record), state.record)
    expect(control.inputs[0]?.phase).toEqual(phase)
    expect(control.inputs[0]?.trail).toEqual(trail)
    expect(control.inputs[0]?.record).toBe(state.record)
  })

  it('takes the last state presented in a frame', () => {
    const { tracker } = mount()
    tracker.present(stateAt(10))
    tracker.present(stateAt(10.04))
    tracker.present(stateAt(10.08))
    expect(env.queued()).toBe(1)
    env.frame()
    expect(control.inputs.map((i) => i.time)).toEqual([10.08])
  })

  it('keeps the flag it had when the clock has not moved', () => {
    const { tracker } = mount()
    tracker.present(stateAt(10))
    env.frame()
    tracker.present(stateAt(10.04))
    env.frame()
    tracker.present({ ...stateAt(10.04), playing: false })
    env.frame()
    // Paused at the same time: still playback, as the reference's flag only moves with the clock.
    expect(control.inputs.map((i) => i.playback)).toEqual([false, true, true])
  })

  it('takes a jump of 3 s as a seek, which stops a running goal', () => {
    control.fake = true
    const { tracker, log } = mount()
    tracker.present(stateAt(10))
    env.frame()
    expect(tracker.trigger('goal')).toBe(true)
    tracker.present(stateAt(10.04))
    env.frame()
    expect(log).toEqual(['goal:start'])
    tracker.present(stateAt(13.04))
    env.frame()
    expect(control.inputs.at(-1)?.playback).toBe(false)
    expect(log).toEqual(['goal:start', 'goal:end'])
    env.settle()
    expect(env.queued()).toBe(0)
  })

  it('stops moments when play pauses', () => {
    control.fake = true
    const { tracker, log } = mount()
    tracker.present(stateAt(10))
    env.frame()
    tracker.trigger('goal')
    tracker.present(stateAt(10.04))
    env.frame()
    tracker.present(stateAt(10.04, false))
    env.frame()
    expect(log).toEqual(['goal:start', 'goal:end'])
  })

  it('ignores push in replay, and present in live', () => {
    const { tracker } = mount()
    tracker.push(message(0))
    expect(env.queued()).toBe(0)
    const host = makeHost()
    const live = createMatchTracker(host, { mode: 'live', layersStorageKey: null })
    mounted.push(live)
    live.present(stateAt(10))
    expect(env.queued()).toBe(0)
  })
})
