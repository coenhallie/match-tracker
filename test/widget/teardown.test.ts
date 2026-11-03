import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker } from '../../src/index'
import { FakeIntersectionObserver, FakeMediaQuery, FakeResizeObserver, installEnv, makeHost, type Env } from './env'
import { control } from './recording'
import { message } from './messages'

vi.mock('../../src/director/director', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/director/director')>()
  const { recordingDirector } = await import('./recording')
  return { ...real, Director: recordingDirector(real.Director) }
})

/** The fonts and the icons, loading until a test says they are in. */
const gates = vi.hoisted(() => {
  function gate<T>(value: T) {
    const g = {
      resolve: () => {},
      promise: Promise.resolve(value) as Promise<T>,
      reset() {
        g.promise = new Promise<T>((resolve) => {
          g.resolve = () => resolve(value)
        })
      },
    }
    return g
  }
  return { fonts: gate<void>(undefined), icons: gate({ freeKick: null, goal: null }) }
})
const { fonts, icons } = gates

vi.mock('../../src/assets/fonts', () => ({ ensureFonts: () => gates.fonts.promise }))
vi.mock('../../src/assets/icons', () => ({ loadIcons: () => gates.icons.promise }))

let env: Env

function mount() {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null })
  env.resize(host, 1280, 760)
  return { host, tracker }
}

/** Let promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface Listening {
  added: Array<[string, unknown]>
  removed: Array<[string, unknown]>
}

/** Note every listener added to and removed from `target`. */
function watchListeners(target: EventTarget): Listening {
  const seen: Listening = { added: [], removed: [] }
  const add = target.addEventListener.bind(target)
  const remove = target.removeEventListener.bind(target)
  vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
    seen.added.push([type, listener])
    add(type, listener, options)
  })
  vi.spyOn(target, 'removeEventListener').mockImplementation((type, listener, options) => {
    seen.removed.push([type, listener])
    remove(type, listener, options)
  })
  return seen
}

/** The listeners added and not removed since. */
function stillListening({ added, removed }: Listening): Array<[string, unknown]> {
  const left = [...added]
  for (const [type, listener] of removed) {
    const at = left.findIndex(([t, l]) => t === type && l === listener)
    if (at >= 0) left.splice(at, 1)
  }
  return left
}

const mediaListeners = () => FakeMediaQuery.all.reduce((n, q) => n + q.listeners.size, 0)

beforeEach(() => {
  env = installEnv()
  control.reset()
  fonts.reset()
  icons.reset()
})

afterEach(() => {
  document.body.replaceChildren()
  env.restore()
})

describe('destroy', () => {
  it('draws nothing more once destroyed in the middle of a goal', () => {
    const { host, tracker } = mount()
    tracker.push(message(0, { withBall: true }))
    env.settle()
    expect(tracker.trigger('goal')).toBe(true)
    env.frame()
    expect(env.queued()).toBe(1)
    const canvas = host.shadowRoot!.querySelector('canvas')!
    const ops = env.ops(canvas).length
    expect(ops).toBeGreaterThan(0)
    tracker.destroy()
    expect(env.queued()).toBe(0)
    for (let i = 0; i < 10; i++) env.frame()
    expect(env.ops(canvas)).toHaveLength(ops)
  })

  it.each([
    ['fonts', fonts],
    ['icons', icons],
  ])('repaints when the %s arrive, and not once destroyed', async (_name, gate) => {
    const a = mount()
    a.tracker.push(message(0))
    env.settle()
    const drawnA = env.draws(a.host)

    const b = mount()
    b.tracker.push(message(0))
    env.settle()
    const canvasB = b.host.shadowRoot!.querySelector('canvas')!
    const opsB = env.ops(canvasB).length
    b.tracker.destroy()

    gate.resolve()
    await flush()
    expect(env.draws(a.host)).toBe(drawnA + 1)
    expect(env.ops(canvasB)).toHaveLength(opsB)
    expect(env.queued()).toBe(0)
    a.tracker.destroy()
  })

  it('removes every listener it added to the window, the document and media queries', () => {
    const onWindow = watchListeners(window)
    const onDocument = watchListeners(document)
    const { host, tracker } = mount()
    tracker.push(message(0))
    env.settle()
    // Re-arm the resolution query once, and go through a hidden tab.
    globalThis.devicePixelRatio = 2
    FakeMediaQuery.all.findLast((q) => q.media.startsWith('(resolution'))!.dispatch()
    env.setVisibility('hidden')
    env.setVisibility('visible')
    env.settle()
    // Destroyed with the layers menu open, which listens on the document while it is.
    host.shadowRoot!.querySelector<HTMLButtonElement>('.mt-layers-toggle')!.click()
    expect(onDocument.added.some(([type]) => type === 'pointerdown')).toBe(true)
    expect(onDocument.added.length + mediaListeners()).toBeGreaterThan(0)

    tracker.destroy()
    expect(stillListening(onWindow)).toEqual([])
    expect(stillListening(onDocument)).toEqual([])
    expect(mediaListeners()).toBe(0)
    expect(host.shadowRoot?.childNodes).toHaveLength(0)
  })

  it('leaves no observer, listener or frame behind over 50 mounts', () => {
    const onWindow = watchListeners(window)
    const onDocument = watchListeners(document)
    for (let i = 0; i < 50; i++) {
      const { tracker } = mount()
      tracker.push(message(i))
      env.frame()
      tracker.destroy()
    }
    expect(FakeResizeObserver.live.size).toBe(0)
    expect(FakeIntersectionObserver.live.size).toBe(0)
    expect(stillListening(onWindow)).toEqual([])
    expect(stillListening(onDocument)).toEqual([])
    expect(mediaListeners()).toBe(0)
    expect(env.queued()).toBe(0)
  })

  it('does nothing when used after destroy', () => {
    const { host, tracker } = mount()
    tracker.push(message(0))
    env.settle()
    const canvas = host.shadowRoot!.querySelector('canvas')!
    tracker.destroy()
    const ops = env.ops(canvas).length
    expect(() => {
      tracker.push(message(1))
      tracker.present({ time: 1, playing: true, record: null, lookback: [] })
      expect(tracker.trigger('goal')).toBe(false)
      tracker.reset()
      tracker.setOptions({ locale: 'zh' })
      tracker.on('zoom', () => {})()
      tracker.destroy()
    }).not.toThrow()
    expect(env.queued()).toBe(0)
    expect(env.ops(canvas)).toHaveLength(ops)
  })

  it('can mount again on a host it was destroyed on', () => {
    const { host, tracker } = mount()
    tracker.destroy()
    const again = createMatchTracker(host, { mode: 'live', layersStorageKey: null })
    expect(host.shadowRoot?.querySelector('canvas')).not.toBeNull()
    again.destroy()
  })
})
