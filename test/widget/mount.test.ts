import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMatchTracker, MATCH_TRACKER_VERSION, type MatchTracker } from '../../src/index'
import { FakeMediaQuery, installEnv, makeHost, type Env } from './env'
import { message } from './messages'

let env: Env
const mounted: MatchTracker[] = []

function mount(host = makeHost()) {
  const tracker = createMatchTracker(host, { mode: 'live' })
  mounted.push(tracker)
  return { host, tracker }
}

beforeEach(() => {
  env = installEnv()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  document.head.querySelectorAll('[data-test-style]').forEach((el) => el.remove())
  env.restore()
})

describe('mounting', () => {
  it('builds everything inside an open shadow root, and adds nothing to the head', () => {
    const head = document.head.innerHTML
    const { host, tracker } = mount()
    expect(host.shadowRoot).not.toBeNull()
    expect(host.shadowRoot!.mode).toBe('open')
    expect(host.children).toHaveLength(0)
    expect(host.shadowRoot!.querySelector('canvas')).not.toBeNull()
    expect(host.shadowRoot!.contains(tracker.overlay)).toBe(true)
    // Only font faces may be added to the page, and those go to document.fonts, not the head.
    expect(document.head.innerHTML).toBe(head)
  })

  it('marks its root with the version it runs', () => {
    const { host, tracker } = mount()
    const root = host.shadowRoot!.querySelector('[data-match-tracker-version]')
    expect(root?.getAttribute('data-match-tracker-version')).toBe(MATCH_TRACKER_VERSION)
    expect(tracker.version).toBe(MATCH_TRACKER_VERSION)
  })

  it('mounts in a host of 0x0 without throwing, and draws once it has a size', () => {
    const { host, tracker } = mount()
    expect(() => {
      tracker.push(message(0))
      env.settle()
    }).not.toThrow()
    expect(env.draws(host)).toBe(0)

    env.resize(host, 800, 450)
    expect(env.draws(host)).toBeGreaterThan(0)
    // The frame fits under the 40 px label row: 800 x 410 holds a 16:9 box 728 px wide.
    const canvas = host.shadowRoot!.querySelector('canvas')!
    expect([canvas.width, canvas.height]).toEqual([728, 410])
    expect(canvas.style.width).toBe('728px')
    expect(canvas.style.top).toBe('40px')
    expect(tracker.overlay.style.width).toBe('728px')
    expect(tracker.overlay.style.left).toBe(canvas.style.left)
  })

  it('keeps its box when it is measured at nothing', () => {
    const { host, tracker } = mount()
    env.resize(host, 800, 450)
    tracker.push(message(0))
    env.settle()
    const canvas = host.shadowRoot!.querySelector('canvas')!
    env.resize(host, 0, 0)
    expect([canvas.width, canvas.height]).toEqual([728, 410])
    expect(canvas.style.width).toBe('728px')
  })

  it('sizes the bitmap in device pixels, and hears of a new pixel ratio', () => {
    const { host, tracker } = mount()
    env.resize(host, 800, 450)
    tracker.push(message(0))
    env.settle()
    const canvas = host.shadowRoot!.querySelector('canvas')!
    expect(canvas.width).toBe(728)
    globalThis.devicePixelRatio = 2
    const draws = env.draws(host)
    // The resolution query for the old ratio fires once the ratio changes.
    const query = latestResolutionQuery()
    query.dispatch()
    // 410 px high at 2x: 728.9 CSS px wide, 1457 device pixels.
    expect([canvas.width, canvas.height]).toEqual([1457, 820])
    expect(canvas.style.width).toBe('728.5px')
    expect(env.draws(host)).toBe(draws + 1)
    // Re-armed for the new ratio, and the old one is let go.
    expect(query.listeners.size).toBe(0)
    expect(latestResolutionQuery().media).toBe('(resolution: 2dppx)')
    expect(latestResolutionQuery().listeners.size).toBe(1)
  })

  it('draws two instances on one page independently', () => {
    const a = mount()
    const b = mount()
    env.resize(a.host, 800, 450)
    env.resize(b.host, 640, 400)
    a.tracker.push(message(0))
    env.settle()
    expect(env.draws(a.host)).toBeGreaterThan(0)
    expect(env.draws(b.host)).toBe(0)
    const drawnA = env.draws(a.host)
    b.tracker.push(message(0))
    b.tracker.push(message(1))
    env.settle()
    expect(env.draws(a.host)).toBe(drawnA)
    expect(env.draws(b.host)).toBeGreaterThan(0)
    // Each sized to its own host.
    expect(a.host.shadowRoot!.querySelector('canvas')!.width).toBe(728)
    expect(b.host.shadowRoot!.querySelector('canvas')!.width).toBe(640)
  })

  it("is not reached by the host page's CSS", () => {
    const style = document.createElement('style')
    style.dataset.testStyle = ''
    style.textContent = 'canvas { display: none }'
    document.head.append(style)
    // The control: the rule does hide a canvas in the page itself.
    const outside = document.createElement('canvas')
    document.body.append(outside)
    expect(getComputedStyle(outside).display).toBe('none')

    const { host } = mount()
    const canvas = host.shadowRoot!.querySelector('canvas')!
    // Styles are computed in the shadow root at all: its own sheet places the canvas.
    expect(getComputedStyle(canvas).position).toBe('absolute')
    expect(getComputedStyle(canvas).display).toBe('block')
  })
})

function latestResolutionQuery(): FakeMediaQuery {
  const query = FakeMediaQuery.all.findLast((q) => q.media.startsWith('(resolution'))
  if (!query) throw new Error('no resolution query')
  return query
}

describe('the shadow root CSS', () => {
  it('sizes nothing in rem, which would follow the host page’s root font size into the widget', async () => {
    const { STYLES } = await import('../../src/widget/styles')
    // The comments keep the reference's Tailwind classes, rem and all.
    const rules = STYLES.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules.match(/\d(?:\.\d+)?rem\b/g) ?? []).toEqual([])
  })
})
