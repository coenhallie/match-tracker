import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, parseRecord, type MatchTracker, type TrackerRecord } from '../../src/index'
import { deriveAt, windowAt } from '../../src/analysis/derive'
import { FakeIntersectionObserver, installEnv, makeHost, type Env } from './env'
import { control } from './recording'
import { message } from './messages'

vi.mock('../../src/director/director', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/director/director')>()
  const { recordingDirector } = await import('./recording')
  return { ...real, Director: recordingDirector(real.Director) }
})

let env: Env
const mounted: MatchTracker[] = []
const records: TrackerRecord[] = Array.from({ length: 20 }, (_, i) => parseRecord(message(i, { withBall: true }))!)

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
    // Nothing animates on; the loop runs only for the clock, until it pauses.
    expect(control.outputs.at(-1)?.animating).toBe(false)
    tracker.present(stateAt(13.04, false))
    env.settle()
    expect(env.queued()).toBe(0)
    expect(log).toEqual(['goal:start', 'goal:end'])
  })

  it('stops moments when play pauses', () => {
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

describe('the replay loop while playing', () => {
  /**
   * A replay host whose clock runs in its own animation frame callback, as
   * video-annotation's does: it asks for its next frame first, then
   * presents, twice in a frame (the clock, then the frame the video has
   * reached). Returns the last time it presented in each frame, in order.
   */
  function hostClock(tracker: MatchTracker, start = 10) {
    const presented: number[] = []
    let time = start
    const tick = () => {
      requestAnimationFrame(tick)
      time = Math.round((time + 0.02) * 1000) / 1000
      tracker.present(stateAt(time))
      time = Math.round((time + 0.02) * 1000) / 1000
      tracker.present(stateAt(time))
      presented.push(time)
    }
    requestAnimationFrame(tick)
    return presented
  }

  it('runs one update in every display frame, however the presents fall', () => {
    const { tracker } = mount()
    tracker.present(stateAt(10))
    env.frame()
    const presented = hostClock(tracker)
    const perFrame: number[] = []
    for (let i = 0; i < 24; i++) {
      const before = control.inputs.length
      env.frame()
      perFrame.push(control.inputs.length - before)
    }
    expect(perFrame).toEqual(Array(24).fill(1))
    // Every frame the host presented in is taken in once, at most a frame late.
    const times = control.inputs.slice(1).map((i) => i.time)
    expect(new Set(times).size).toBe(times.length)
    expect(presented.slice(0, -1).every((t) => times.includes(t))).toBe(true)
    // Each display frame is its own animation frame to the director.
    const frames = control.inputs.slice(1).map((i) => i.nowMs)
    expect(frames).toEqual(frames.map((_, i) => frames[0]! + 16 * i))
  })

  it('keeps ticking while playing with nothing new, and draws only when the director paints', () => {
    const { host, tracker } = mount()
    tracker.present(stateAt(10))
    env.frame()
    tracker.present(stateAt(10.04))
    // Let any fade the step started run out.
    for (let i = 0; i < 300; i++) env.frame()
    const updates = control.inputs.length
    const draws = env.draws(host)
    for (let i = 0; i < 30; i++) {
      env.frame()
      expect(env.queued()).toBe(1)
    }
    expect(control.inputs.length - updates).toBe(30)
    expect(control.outputs.slice(-30).every((o) => !o.paint)).toBe(true)
    expect(env.draws(host)).toBe(draws)
  })

  it('stops asking for frames once the host pauses', () => {
    const { tracker } = mount()
    tracker.present(stateAt(10))
    env.frame()
    expect(env.queued()).toBe(1)
    tracker.present(stateAt(10.04, false))
    env.settle()
    expect(env.queued()).toBe(0)
    tracker.present(stateAt(10.08))
    env.frame()
    expect(env.queued()).toBe(1)
  })

  it('stops while the tab is hidden, and runs again when it is back', () => {
    const { tracker } = mount()
    tracker.present(stateAt(10))
    env.frame()
    env.setVisibility('hidden')
    env.settle()
    expect(env.queued()).toBe(0)
    const updates = control.inputs.length
    env.setVisibility('visible')
    env.frame()
    env.frame()
    expect(control.inputs.length - updates).toBe(2)
    expect(env.queued()).toBe(1)
  })

  it('stops while out of view, and runs again when back in view', () => {
    const { tracker } = mount()
    tracker.present(stateAt(10))
    env.frame()
    for (const observer of FakeIntersectionObserver.live) observer.fire(false)
    env.settle()
    expect(env.queued()).toBe(0)
    const updates = control.inputs.length
    for (const observer of FakeIntersectionObserver.live) observer.fire(true)
    env.frame()
    env.frame()
    expect(control.inputs.length - updates).toBe(2)
    expect(env.queued()).toBe(1)
  })

  it('leaves live mode to ask only when something arrives or animates', () => {
    const host = makeHost()
    const live = createMatchTracker(host, { mode: 'live', layersStorageKey: null })
    mounted.push(live)
    env.resize(host, 1280, 760)
    live.push(message(0, { withBall: true }))
    env.settle()
    expect(env.queued()).toBe(0)
  })
})
