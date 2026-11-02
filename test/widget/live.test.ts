import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, type MatchTracker, type MatchTrackerOptions } from '../../src/index'
import { LiveHistory } from '../../src/history/liveHistory'
import { PERSON_COLORS } from '../../src/render/constants'
import { FakeIntersectionObserver, installEnv, makeHost, type Env } from './env'
import { control, GOAL_CAMERA, GOAL_MS } from './fakeDirector'
import { FIXTURE_MESSAGES, message } from './messages'

vi.mock('../../src/director/director', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/director/director')>()
  const { switchable } = await import('./fakeDirector')
  return { ...real, Director: switchable(real.Director) }
})

let env: Env
const mounted: MatchTracker[] = []

function mount(options: Partial<MatchTrackerOptions> = {}) {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...options })
  mounted.push(tracker)
  env.resize(host, 1280, 760)
  return { host, tracker }
}

/** Every moment event, as `moment:phase`. */
function momentLog(tracker: MatchTracker): string[] {
  const log: string[] = []
  tracker.on('moment', ({ moment, phase }) => log.push(`${moment}:${phase}`))
  return log
}

/** A tracker with a goal playing on the fake director, a few frames in. */
function goalRunning() {
  control.fake = true
  const mountedTracker = mount()
  const log = momentLog(mountedTracker.tracker)
  mountedTracker.tracker.push(message(0))
  env.settle()
  expect(mountedTracker.tracker.trigger('goal')).toBe(true)
  env.frame()
  env.frame()
  expect(log).toEqual(['goal:start'])
  expect(env.queued()).toBe(1)
  return { ...mountedTracker, log }
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

describe('live input', () => {
  it('draws once per new frameCount, and not again for one already held', () => {
    const { host, tracker } = mount()
    // The fixture's three messages are one frame.
    for (const m of FIXTURE_MESSAGES) tracker.push(m)
    env.frame()
    // The first record also stands for the replay becoming ready, which paints once more, and
    // every paint is drawn.
    const first = env.draws(host)
    expect(first).toBe(2)
    expect(control.inputs.at(-1)?.record?.frameCount).toBe(55149)

    for (const m of FIXTURE_MESSAGES) tracker.push(m)
    env.frame()
    expect(env.draws(host)).toBe(first)

    for (let i = 1; i <= 5; i++) {
      tracker.push(message(i))
      env.frame()
      expect(env.draws(host)).toBe(first + i)
    }
  })

  it('adds every message of a burst that arrives in one tick', () => {
    const add = vi.spyOn(LiveHistory.prototype, 'add')
    const { tracker } = mount()
    for (let i = 0; i < 20; i++) tracker.push(message(i))
    expect(add).toHaveBeenCalledTimes(20)
    expect(add.mock.results.map((r) => r.value)).toEqual(Array<boolean>(20).fill(true))
    // One frame for the lot, with the newest on screen.
    expect(env.queued()).toBe(1)
    env.frame()
    expect(control.inputs).toHaveLength(1)
    expect(control.inputs[0]?.record?.frameCount).toBe(55149 + 19)
  })

  it('ignores a message it cannot read, and keeps the last frame', () => {
    const { host, tracker } = mount()
    tracker.push(message(0))
    env.settle()
    const draws = env.draws(host)
    const updates = control.inputs.length
    expect(() => {
      tracker.push('not json')
      tracker.push(null)
      tracker.push({ match: { teams: 'none' } })
      tracker.push(JSON.stringify({ match: { teams: [], frame_data: [{ frame_count: 3 }] } }))
    }).not.toThrow()
    expect(env.queued()).toBe(0)
    env.settle()
    expect(env.draws(host)).toBe(draws)
    expect(control.inputs).toHaveLength(updates)
  })

  it('schedules no animation frame while nothing is happening', () => {
    const { tracker } = mount()
    env.settle()
    expect(env.queued()).toBe(0)
    tracker.push(message(0))
    expect(env.queued()).toBe(1)
    env.settle()
    expect(env.queued()).toBe(0)
    env.now += 10_000
    expect(env.frame()).toBe(0)
  })

  it('drives the director on its own clock, playing, with the phase and trail of the newest record', () => {
    const { tracker } = mount()
    tracker.push(message(0))
    env.frame()
    tracker.push(message(1))
    env.frame()
    const [a, b] = control.inputs
    expect(a?.time).toBeCloseTo(a!.nowMs / 1000)
    expect(b!.time - a!.time).toBeCloseTo(0.016)
    expect([a?.playing, b?.playing]).toEqual([true, true])
    // Mounting is a seek, as a reset is; play carries on from there.
    expect([a?.playback, b?.playback]).toEqual([false, true])
    expect(b?.phase).not.toBeNull()
    expect(b?.record?.frameCount).toBe(55150)
  })

  it('takes coming back to a hidden tab as a seek, and stops a goal that was playing', () => {
    const { host, tracker, log } = goalRunning()
    const add = vi.spyOn(LiveHistory.prototype, 'add')
    env.setVisibility('hidden')
    const updates = control.inputs.length
    const draws = env.draws(host)
    env.frame()
    tracker.push(message(1))
    env.settle()
    // Nothing is drawn while hidden, but what arrives is kept.
    expect(control.inputs).toHaveLength(updates)
    expect(env.draws(host)).toBe(draws)
    expect(add).toHaveReturnedWith(true)

    env.setVisibility('visible')
    env.frame()
    expect(control.inputs).toHaveLength(updates + 1)
    expect(control.inputs.at(-1)?.playback).toBe(false)
    expect(control.inputs.at(-1)?.record?.frameCount).toBe(55150)
    expect(log).toEqual(['goal:start', 'goal:end'])
    expect(env.draws(host)).toBeGreaterThan(draws)
    tracker.push(message(2))
    env.frame()
    expect(control.inputs.at(-1)?.playback).toBe(true)
  })

  it('takes scrolling back into view as a seek', () => {
    const { tracker, log } = goalRunning()
    const [observer] = FakeIntersectionObserver.live
    observer!.fire(false)
    const updates = control.inputs.length
    env.settle()
    expect(control.inputs).toHaveLength(updates)
    tracker.push(message(1))
    env.settle()
    expect(control.inputs).toHaveLength(updates)

    observer!.fire(true)
    env.frame()
    expect(control.inputs.at(-1)?.playback).toBe(false)
    expect(log).toEqual(['goal:start', 'goal:end'])
  })

  it('does not take its first sighting by the intersection observer as a seek', () => {
    const { tracker } = mount()
    const [observer] = FakeIntersectionObserver.live
    observer!.fire(true)
    tracker.push(message(0))
    env.frame()
    tracker.push(message(1))
    observer!.fire(true)
    env.frame()
    expect(control.inputs.map((i) => i.playback)).toEqual([false, true])
  })

  it('clears the history on reset, and takes what comes next as a seek', () => {
    const { tracker } = mount()
    for (let i = 0; i < 5; i++) tracker.push(message(i))
    env.settle()
    tracker.push(message(5))
    env.frame()
    expect(control.inputs.at(-1)?.playback).toBe(true)

    tracker.reset()
    const add = vi.spyOn(LiveHistory.prototype, 'add')
    // A frame held before the reset is taken again, and a frame older than the newest held
    // before it becomes the newest: the history is empty.
    tracker.push(message(2))
    expect(add).toHaveLastReturnedWith(true)
    env.frame()
    expect(control.inputs.at(-1)?.record?.frameCount).toBe(55151)
    expect(control.inputs.at(-1)?.playback).toBe(false)
  })

  it('stops a goal when the overlay is pressed', () => {
    const { host, tracker, log } = goalRunning()
    const draws = env.draws(host)
    tracker.overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(control.stopAll).toBe(1)
    expect(log).toEqual(['goal:start', 'goal:end'])
    expect(env.draws(host)).toBe(draws + 1)
    env.settle()
    expect(env.queued()).toBe(0)
  })

  it('says when a goal starts and when it ends', () => {
    const { log } = goalRunning()
    const frames = env.settle()
    expect(frames).toBeGreaterThanOrEqual(Math.floor(GOAL_MS / 16) - 3)
    expect(log).toEqual(['goal:start', 'goal:end'])
    expect(env.queued()).toBe(0)
  })

  it("follows the goal's camera, and says how far it zoomed", () => {
    control.fake = true
    const { tracker } = mount()
    const zooms: number[] = []
    tracker.on('zoom', ({ zoom }) => zooms.push(zoom))
    tracker.push(message(0))
    env.settle()
    tracker.trigger('goal')
    env.frame()
    expect(zooms).toEqual([GOAL_CAMERA.zoom])
  })

  it('plays nothing by hand before there is a record', () => {
    const { tracker } = mount()
    expect(tracker.trigger('goal')).toBe(false)
  })

  it('colours the home team, and its attack, as the host asks', () => {
    const { host, tracker } = mount({ teams: { home: { color: '#00ff00' } } })
    tracker.push(message(0))
    env.settle()
    const fills = env.ops(host).filter((o) => o.op === 'fill').map((o) => o.fillStyle)
    expect(fills).toContain('#00ff00')
    expect(fills).not.toContain(PERSON_COLORS.home.fill)
    expect(fills).toContain(PERSON_COLORS.away.fill)
    const options = control.options.at(-1)!
    expect(options.teamColor(0)).toBe('#00ff00')
    expect(options.teamColor(1)).toBe(PERSON_COLORS.away.fill)
    // The shared constant is left as it was.
    expect(PERSON_COLORS.home.fill).toBe('#e51a1a')
  })

  it("names the teams after the host's names, or after their colours", () => {
    mount({ teams: { home: { name: 'Ajax' } } })
    const named = control.options.at(-1)!
    expect([named.teamName(0), named.teamName(1)]).toEqual(['Ajax', 'Blue'])
    mount({ locale: 'zh', text: { blue: 'Navy' } })
    const unnamed = control.options.at(-1)!
    expect(unnamed.teamName(1)).toBe('Navy')
  })

  it('asks for reduced motion afresh every time', () => {
    mount()
    const options = control.options.at(-1)!
    expect(options.reducedMotion()).toBe(false)
    env.reducedMotion = true
    expect(options.reducedMotion()).toBe(true)
  })

  it('starts with the layers kept under the storage key, over the host\'s, over the defaults', () => {
    localStorage.setItem('match-tracker.layers', JSON.stringify({ goal: false, attack: 'no' }))
    localStorage.setItem('elsewhere', JSON.stringify({ ballTrail: false }))
    try {
      mount({ layersStorageKey: undefined, layers: { attack: false, goal: true } })
      expect(control.options.at(-1)?.layers).toMatchObject({ goal: false, attack: false, ballTrail: true })
      mount({ layersStorageKey: null, layers: { attack: false } })
      expect(control.options.at(-1)?.layers).toMatchObject({ goal: true, attack: false, ballTrail: true })
      mount({ layersStorageKey: 'elsewhere' })
      expect(control.options.at(-1)?.layers).toMatchObject({ goal: true, attack: true, ballTrail: false })
    } finally {
      localStorage.clear()
    }
  })

  it('takes new options without a remount, and repaints', () => {
    const { host, tracker } = mount()
    tracker.push(message(0))
    env.settle()
    const draws = env.draws(host)
    tracker.setOptions({ teams: { home: { color: '#123456', name: 'Ajax' } } })
    expect(env.draws(host)).toBe(draws + 1)
    expect(env.ops(host).filter((o) => o.op === 'fill').map((o) => o.fillStyle)).toContain('#123456')

    const changes: unknown[] = []
    tracker.on('layers', (layers) => changes.push(layers))
    tracker.setOptions({ layers: { ballTrail: false } })
    tracker.setOptions({ layers: { ballTrail: false } })
    expect(changes).toEqual([expect.objectContaining({ ballTrail: false, goal: true })])
    // Not kept: only the user's own choice in the menu is.
    expect(localStorage.getItem('match-tracker.layers')).toBeNull()
  })
})
