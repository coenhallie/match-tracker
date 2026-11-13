import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, type MatchTracker, type MatchTrackerOptions } from '../../src/index'
import { LiveHistory } from '../../src/history/liveHistory'
import { PERSON_COLORS } from '../../src/render/constants'
import { FakeIntersectionObserver, FakeMediaQuery, installEnv, makeHost, type Env } from './env'
import { GOAL_SEQUENCE_MS } from '../../src/analysis/goalSequence'
import { control } from './recording'
import { FIXTURE_MESSAGES, message } from './messages'

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

/** A tracker with a goal playing on the real director, a few frames in. */
function goalRunning() {
  const mountedTracker = mount()
  const log = momentLog(mountedTracker.tracker)
  mountedTracker.tracker.push(message(0, { withBall: true }))
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
    // The first record paints three times (the renderer attaching, the frame watcher, ready),
    // all in one display frame: only the last is drawn.
    const first = env.draws(host)
    expect(first).toBe(1)
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

  it('takes the first record after a reset as a seek, with a frame due at the reset', () => {
    const { tracker } = mount()
    for (let i = 0; i < 5; i++) tracker.push(message(i))
    env.settle()
    tracker.push(message(5))
    expect(env.queued()).toBe(1)
    tracker.reset()
    // The frame queued before the reset runs with nothing held: it is not what the seek is for.
    env.frame()
    tracker.push(message(6))
    env.frame()
    const withRecord = control.inputs.filter((input) => input.record !== null)
    expect(withRecord.at(-1)?.record?.frameCount).toBe(55155)
    expect(withRecord.at(-1)?.playback).toBe(false)
    tracker.push(message(7))
    env.frame()
    expect(control.inputs.at(-1)?.playback).toBe(true)
  })

  it('takes the stream starting again from an earlier t as a seek, and draws on', () => {
    const { host, tracker } = mount()
    for (let i = 0; i < 5; i++) {
      tracker.push(message(i))
      env.frame()
    }
    expect(control.inputs.at(-1)?.playback).toBe(true)
    const draws = env.draws(host)
    // The pipeline restarted with the socket open: t starts again near 0.
    for (let i = 0; i < 3; i++) {
      tracker.push(message(100 + i, { t: 0.04 * (i + 1) }))
      env.frame()
    }
    expect(control.inputs.slice(-3).map((input) => [input.record?.frameCount, input.playback])).toEqual([
      [55249, false],
      [55250, true],
      [55251, true],
    ])
    expect(env.draws(host)).toBe(draws + 3)
  })

  it('draws nothing zoomed in after a reset in the middle of a goal camera ease', () => {
    // The goal's camera alone, which hands the whole pitch back: the zoom near goal would keep the view in.
    const { tracker } = mount({ layers: { goalZoom: false } })
    const zooms: number[] = []
    tracker.on('zoom', ({ zoom }) => zooms.push(zoom))
    tracker.push(message(0, { withBall: true }))
    env.settle()
    expect(tracker.trigger('goal')).toBe(true)
    // Into the camera's ease in, where it moves on every frame.
    const moving = () => {
      const [a, b] = control.outputs.slice(-2).map((out) => out.camera)
      return a && b && b.zoom > 1 && (a.zoom !== b.zoom || a.panX !== b.panX || a.panY !== b.panY)
    }
    for (let i = 0; i < 100 && !moving(); i++) env.frame()
    expect(moving()).toBe(true)
    expect(zooms.at(-1)).toBeGreaterThan(1)

    tracker.reset()
    // The host hears of the whole pitch at once, not at the next record.
    expect(zooms.at(-1)).toBe(1)
    const views = control.views.length
    const outputs = control.outputs.length
    tracker.push(message(1, { withBall: true }))
    env.settle()
    const drawn = control.outputs.slice(outputs).flatMap((out) => out.paints.map((paint) => paint.view.zoom))
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn.every((zoom) => zoom === 1)).toBe(true)
    expect(control.views.slice(views).every((view) => view.zoom === 1)).toBe(true)
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

  it('goes on with a goal when a frame of it fails to draw, and reports the error once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { log } = goalRunning()
    control.failRenders = 1
    expect(() => env.frame()).not.toThrow()
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.at(-1))).toContain('the renderer failed')
    // The same failure again is not reported again; another is.
    control.failRenders = 2
    env.frame()
    env.frame()
    expect(error).toHaveBeenCalledTimes(1)
    control.failRenders = 1
    control.failMessage = 'another failure'
    env.frame()
    expect(error).toHaveBeenCalledTimes(2)
    env.settle()
    expect(log).toEqual(['goal:start', 'goal:end'])
    expect(env.queued()).toBe(0)
  })

  it('says when a goal starts and when it ends', () => {
    const { log } = goalRunning()
    const frames = env.settle()
    expect(frames).toBeGreaterThanOrEqual(Math.floor(GOAL_SEQUENCE_MS / 16) - 3)
    expect(log).toEqual(['goal:start', 'goal:end'])
    expect(env.queued()).toBe(0)
  })

  it("draws a goal in its camera's view, zoomed in, and hands the whole pitch back", () => {
    // The goal's camera alone, which hands the whole pitch back: the zoom near goal would keep the view in.
    const { tracker } = mount({ layers: { goalZoom: false } })
    const zooms: number[] = []
    tracker.on('zoom', ({ zoom }) => zooms.push(zoom))
    tracker.push(message(0, { withBall: true }))
    env.settle()
    expect(control.views.at(-1)?.zoom).toBe(1)
    expect(tracker.trigger('goal')).toBe(true)
    for (let i = 0; i < 60; i++) env.frame()
    // Partway in, the renderer draws zoomed in, and the host hears of it.
    const during = control.views.at(-1)!
    expect(during.zoom).toBeGreaterThan(1)
    expect(during.renderedWidth).toBeGreaterThan(0)
    expect(zooms.at(-1)).toBeGreaterThan(1)
    env.settle()
    expect(control.views.at(-1)).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
    expect(zooms.at(-1)).toBe(1)
    expect(env.queued()).toBe(0)
  })

  it('plays every moment by hand on a frame with a ball, each taking over from the one before', () => {
    const { tracker } = mount()
    const log = momentLog(tracker)
    tracker.push(message(0, { withBall: true }))
    env.settle()
    const plays = [['goal'], ['attack', 0], ['attack', 1], ['corner'], ['freeKick'], ['throwIn'], ['varCheck'], ['goalDisallowed'], ['halfTime'], ['secondHalf'], ['fullTime'], ['foul'], ['shotOnGoal'], ['headerOnGoal']] as const
    for (const [moment, team] of plays) {
      expect(tracker.trigger(moment, team)).toBe(true)
      env.frame()
    }
    tracker.overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(log).toEqual([
      'goal:start',
      'goal:end',
      'attack:start',
      'attack:end',
      'attack:start',
      'attack:end',
      'corner:start',
      'corner:end',
      'freeKick:start',
      'freeKick:end',
      'throwIn:start',
      'throwIn:end',
      'varCheck:start',
      'varCheck:end',
      'goalDisallowed:start',
      'goalDisallowed:end',
      'halfTime:start',
      'halfTime:end',
      'secondHalf:start',
      'secondHalf:end',
      'fullTime:start',
      'fullTime:end',
      'foul:start',
      'foul:end',
      'shotOnGoal:start',
      'shotOnGoal:end',
      'headerOnGoal:start',
      'headerOnGoal:end',
    ])
    env.settle()
    expect(env.queued()).toBe(0)
  })

  it("runs the frame due before a moment played by hand at the last animation frame's time, not the clock's", () => {
    const { tracker } = mount()
    tracker.push(message(0, { withBall: true }))
    env.settle()
    const frameMs = env.now
    // The clock moves on between frames, as it does in a click handler.
    env.now += 8
    tracker.push(message(1, { withBall: true }))
    expect(env.queued()).toBe(1)
    expect(tracker.trigger('throwIn')).toBe(true)
    const flushed = control.inputs.at(-1)!
    expect(flushed.record?.frameCount).toBe(55150)
    expect(flushed.nowMs).toBe(frameMs)
    // The next animation frame is a frame of its own, and the moment steps in it.
    env.frame()
    expect(control.inputs.at(-1)!.nowMs).toBeGreaterThan(frameMs)
  })

  it('plays nothing by hand before there is a record', () => {
    const { tracker } = mount()
    expect(tracker.trigger('goal')).toBe(false)
  })

  it('plays no goal on a frame with no ball, and draws nothing for it', () => {
    const { host, tracker } = mount()
    const log = momentLog(tracker)
    tracker.push(message(0))
    env.settle()
    const draws = env.draws(host)
    expect(tracker.trigger('goal')).toBe(false)
    expect(env.draws(host)).toBe(draws)
    expect(log).toEqual([])
    expect(env.queued()).toBe(0)
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

  it('makes one media query for reduced motion, however often it is asked', () => {
    const asks = () => FakeMediaQuery.all.filter((q) => q.media.includes('prefers-reduced-motion')).length
    const before = asks()
    mount()
    const options = control.options.at(-1)!
    for (let k = 0; k < 5; k++) options.reducedMotion()
    expect(asks() - before).toBe(1)
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
