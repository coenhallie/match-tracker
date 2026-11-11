/**
 * A browser for the widget tests, made of stubs happy-dom lacks or runs on
 * real time: an animation frame queue run by hand, a clock, resize and
 * intersection observers fired by hand, media queries that record their
 * listeners, element sizes, and canvases whose 2D context records what is
 * drawn (recordingCtx). Install it in beforeEach and remove it in afterEach.
 */
import { vi } from 'vitest'
import { recordingCtx, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'

type FrameCallback = (ms: number) => void

export class FakeResizeObserver {
  static live = new Set<FakeResizeObserver>()
  readonly targets = new Set<Element>()
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.live.add(this)
  }
  observe(target: Element) {
    this.targets.add(target)
  }
  unobserve(target: Element) {
    this.targets.delete(target)
  }
  disconnect() {
    this.targets.clear()
    FakeResizeObserver.live.delete(this)
  }
  fire() {
    if (this.targets.size === 0) return
    this.callback([], this as unknown as ResizeObserver)
  }
}

export class FakeIntersectionObserver {
  static live = new Set<FakeIntersectionObserver>()
  readonly targets = new Set<Element>()
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.live.add(this)
  }
  observe(target: Element) {
    this.targets.add(target)
  }
  unobserve(target: Element) {
    this.targets.delete(target)
  }
  disconnect() {
    this.targets.clear()
    FakeIntersectionObserver.live.delete(this)
  }
  takeRecords() {
    return []
  }
  fire(isIntersecting: boolean) {
    const entries = [...this.targets].map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry)
    if (entries.length) this.callback(entries, this as unknown as IntersectionObserver)
  }
}

/** A media query list that records who listens to it. */
export class FakeMediaQuery {
  static all: FakeMediaQuery[] = []
  readonly listeners = new Set<unknown>()
  added = 0
  removed = 0
  onchange = null
  /** `read` says whether it matches now: like a real MediaQueryList, it follows the setting. */
  constructor(
    readonly media: string,
    private readonly read: () => boolean,
  ) {
    FakeMediaQuery.all.push(this)
  }
  get matches(): boolean {
    return this.read()
  }
  addEventListener(_type: string, listener: unknown) {
    this.added++
    this.listeners.add(listener)
  }
  removeEventListener(_type: string, listener: unknown) {
    this.removed++
    this.listeners.delete(listener)
  }
  dispatch() {
    for (const listener of Array.from(this.listeners)) (listener as () => void)()
  }
}

export interface Env {
  /** The clock performance.now reads, in ms. */
  now: number
  /** Whether `(prefers-reduced-motion: reduce)` matches. */
  reducedMotion: boolean
  /** Run the animation frames queued now, at `now` after advancing it by `ms`. Returns how many ran. */
  frame(ms?: number): number
  /** Run frames until none is queued, at most `max`. Returns how many frames ran. */
  settle(max?: number): number
  /** How many animation frames are queued. */
  queued(): number
  /** Give `host` a size, then let every resize observer hear of it. */
  resize(host: HTMLElement, width: number, height: number): void
  /** The ops drawn on every canvas inside `host`'s shadow root, or on `canvas`. */
  ops(target: HTMLElement): Op[]
  /** The ops drawn on every canvas inside `host`'s shadow root since the last drain, forgotten once returned. */
  drain(host: HTMLElement): Op[]
  /** How many times the renderer drew a frame on `host`'s canvas. */
  draws(host: HTMLElement): number
  /** The visibility the document reports, and the event that says it changed. */
  setVisibility(state: 'visible' | 'hidden'): void
  restore(): void
}

export function installEnv(): Env {
  const queue = new Map<number, FrameCallback>()
  let nextId = 1
  const sizes = new WeakMap<Element, { width: number; height: number }>()
  const contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof recordingCtx>>()
  let visibility: 'visible' | 'hidden' = 'visible'
  FakeResizeObserver.live.clear()
  FakeIntersectionObserver.live.clear()
  FakeMediaQuery.all = []

  const env: Env = {
    now: 1000,
    reducedMotion: false,
    frame(ms = 16) {
      env.now += ms
      const due = [...queue.entries()]
      queue.clear()
      for (const [, callback] of due) callback(env.now)
      return due.length
    },
    settle(max = 2000) {
      let n = 0
      while (queue.size > 0 && n < max) {
        env.frame()
        n++
      }
      return n
    },
    queued: () => queue.size,
    resize(host, width, height) {
      sizes.set(host, { width, height })
      for (const observer of Array.from(FakeResizeObserver.live)) observer.fire()
    },
    ops(target) {
      const out: Op[] = []
      const canvases = target instanceof HTMLCanvasElement ? [target] : (target.shadowRoot?.querySelectorAll('canvas') ?? [])
      for (const canvas of canvases) {
        out.push(...(contexts.get(canvas)?.ops ?? []))
      }
      return out
    },
    drain(host) {
      const out: Op[] = []
      for (const canvas of host.shadowRoot?.querySelectorAll('canvas') ?? []) {
        out.push(...(contexts.get(canvas)?.ops.splice(0) ?? []))
      }
      return out
    },
    draws(host) {
      return env.ops(host).filter((o) => o.op === 'clearRect').length
    },
    setVisibility(state) {
      visibility = state
      document.dispatchEvent(new Event('visibilitychange'))
    },
    restore() {
      offscreen.restore()
      vi.unstubAllGlobals()
    },
  }

  const offscreen = stubOffscreenCanvas()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameCallback) => {
    const id = nextId++
    queue.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue.delete(id)
  })
  vi.spyOn(performance, 'now').mockImplementation(() => env.now)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('matchMedia', (media: string) => {
    const read = media.includes('prefers-reduced-motion') ? () => env.reducedMotion : () => media.includes('1dppx')
    return new FakeMediaQuery(media, read)
  })
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let recording = contexts.get(this)
    if (!recording) {
      recording = recordingCtx()
      contexts.set(this, recording)
    }
    return recording.ctx as unknown as CanvasRenderingContext2D
  } as unknown as HTMLCanvasElement['getContext'])
  // Every element in a host's shadow root is laid out over the whole host.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const root = this.getRootNode()
    const host = root instanceof ShadowRoot ? root.host : this
    const { width, height } = sizes.get(host) ?? { width: 0, height: 0 }
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect
  })
  return env
}

/** A fresh host element in the document. */
export function makeHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  return host
}
