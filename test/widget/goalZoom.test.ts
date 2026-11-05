/**
 * The zoom near goal through the widget, on by default: the view eases in on
 * a ball near the goal, the host hears of each zoom, the loop stops once the
 * view is there, and the user's own zoom and pan take the view from it until
 * a double click gives the whole pitch back. The director's own cases are in
 * test/director/goalZoom.test.ts.
 *
 * The widget is 800 x 450; `message(i, { withBall: true })` puts the ball at
 * BALL, short of the box on the right, close enough to the goal to zoom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, type MatchTracker } from '../../src/index'
import { installEnv, makeHost, type Env } from './env'
import { message } from './messages'
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

let env: Env
const mounted: MatchTracker[] = []

function mount() {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null })
  mounted.push(tracker)
  env.resize(host, 800, 450)
  const zooms: number[] = []
  tracker.on('zoom', ({ zoom }) => zooms.push(zoom))
  const viewport = host.shadowRoot!.querySelector<HTMLElement>('.mt-viewport')!
  return { host, tracker, viewport, zooms }
}

const view = () => control.views.at(-1)!
const badge = (host: HTMLElement) => host.shadowRoot!.querySelector('.mt-zoom')

function zoomIn(target: HTMLElement) {
  const init = { clientX: 400, clientY: 225, ctrlKey: true, metaKey: false, deltaY: -100 }
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  // happy-dom's WheelEvent leaves out what a browser's has from MouseEvent.
  for (const key of ['clientX', 'clientY', 'ctrlKey', 'metaKey'] as const) {
    Object.defineProperty(event, key, { value: init[key] })
  }
  target.dispatchEvent(event)
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

describe('the zoom near goal', () => {
  it('eases in on a ball near the goal, says so to the host, and stops asking for frames once there', () => {
    const { host, tracker, zooms } = mount()
    tracker.push(message(0, { withBall: true }))
    env.frame()
    env.frame()
    const early = view().zoom
    expect(env.settle()).toBeLessThan(2000)
    expect(env.queued()).toBe(0)
    expect(view().zoom).toBeGreaterThan(early)
    expect(view().zoom).toBeGreaterThan(1.1)
    // Each step heard, in order, ending where it is drawn.
    expect(zooms.length).toBeGreaterThan(10)
    for (let i = 1; i < zooms.length; i++) expect(zooms[i]!).toBeGreaterThan(zooms[i - 1]!)
    expect(zooms.at(-1)).toBe(view().zoom)
    expect(badge(host)?.textContent).toBe(`${view().zoom.toFixed(1)}x`)
  })

  it('leaves the view to the user once they zoom, until a double click gives the whole pitch back', () => {
    const { tracker, viewport } = mount()
    tracker.push(message(0, { withBall: true }))
    env.settle()
    const eased = view().zoom
    zoomIn(viewport)
    const theirs = { ...view() }
    expect(theirs.zoom).toBeCloseTo(eased + 0.15, 9)
    for (let i = 1; i < 30; i++) {
      tracker.push(message(i, { withBall: true }))
      env.frame()
    }
    env.settle()
    expect(view()).toEqual(theirs)

    viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(view()).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
    tracker.push(message(30, { withBall: true }))
    env.settle()
    expect(view().zoom).toBeCloseTo(eased, 3)
  })

  it('puts the whole pitch back when switched off in the layers menu', () => {
    const { host, tracker, zooms } = mount()
    tracker.push(message(0, { withBall: true }))
    env.settle()
    expect(view().zoom).toBeGreaterThan(1.1)
    const shadow = host.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mt-layers-toggle')!.click()
    const option = [...shadow.querySelectorAll<HTMLElement>('[data-layer]')].find((el) => el.dataset.layer === 'goalZoom')
    expect(option?.textContent).toContain('Zoom near goal')
    option!.click()
    expect(view()).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
    expect(zooms.at(-1)).toBe(1)
    tracker.push(message(1, { withBall: true }))
    env.settle()
    expect(view().zoom).toBe(1)
  })
})
