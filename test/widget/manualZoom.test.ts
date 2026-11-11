/**
 * The viewer has no zoom or pan of their own: only the animations (a goal's camera, the zoom near
 * goal) move the view. A ctrl/⌘ + wheel, a pinch, a drag and a double-click on the pitch are the
 * page's, as on any other picture in it, and nothing on the widget says the view is zoomed.
 *
 * The widget is 800 x 450, so the viewport is centred on (400, 225).
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
  tracker.push(message(0, { withBall: true }))
  env.settle()
  const zooms: number[] = []
  tracker.on('zoom', ({ zoom }) => zooms.push(zoom))
  const viewport = host.shadowRoot!.querySelector<HTMLElement>('.mt-viewport')!
  return { host, tracker, viewport, zooms }
}

const view = () => control.views.at(-1)!

function wheelEvent(init: WheelEventInit) {
  const all = { clientX: 400, clientY: 225, ctrlKey: false, metaKey: false, ...init }
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...all })
  // happy-dom's WheelEvent leaves out what a browser's has from MouseEvent.
  for (const key of ['clientX', 'clientY', 'ctrlKey', 'metaKey'] as const) {
    Object.defineProperty(event, key, { value: all[key] })
  }
  return event
}

function wheel(target: HTMLElement, init: WheelEventInit) {
  const event = wheelEvent(init)
  target.dispatchEvent(event)
  return event
}
const zoomIn = (target: HTMLElement, init: WheelEventInit = {}) => wheel(target, { deltaY: -100, ctrlKey: true, ...init })

function pointerEvent(type: string, id: number, x: number, y: number, pointerType = 'mouse') {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType, clientX: x, clientY: y })
}

function pointer(target: HTMLElement, type: string, id: number, x: number, y: number, pointerType = 'mouse') {
  target.dispatchEvent(pointerEvent(type, id, x, y, pointerType))
}

/** Two fingers down at `a` and `b`. */
function fingers(target: HTMLElement, a: [number, number], b: [number, number]) {
  pointer(target, 'pointerdown', 11, ...a, 'touch')
  pointer(target, 'pointerdown', 12, ...b, 'touch')
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

describe('no zoom or pan by hand', () => {
  it('zooms nothing on a ctrl or ⌘ + wheel, on the pitch or the HUD, and leaves the page to zoom', () => {
    const { host, viewport, zooms } = mount()
    const views = control.views.length
    const hudLayer = host.shadowRoot!.querySelector<HTMLElement>('.mt-hud-layer')!
    for (const target of [viewport, hudLayer]) {
      expect(zoomIn(target).defaultPrevented).toBe(false)
      expect(zoomIn(target, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(false)
    }
    expect(control.views).toHaveLength(views)
    expect(zooms).toEqual([])
  })

  it('zooms nothing on a pinch, and pans nothing on a drag', () => {
    const { viewport, zooms } = mount()
    const views = control.views.length
    fingers(viewport, [400, 275], [500, 275])
    pointer(viewport, 'pointermove', 12, 600, 275, 'touch')
    pointer(viewport, 'pointerdown', 1, 300, 200)
    pointer(viewport, 'pointermove', 1, 400, 300)
    pointer(viewport, 'pointerup', 1, 400, 300)
    expect(control.views).toHaveLength(views)
    expect(zooms).toEqual([])
  })

  it('leaves the view to a goal camera through a wheel, a pinch, a drag and a double-click', () => {
    const { tracker, viewport } = mount()
    expect(tracker.trigger('goal')).toBe(true)
    for (let i = 0; i < 30; i++) env.frame()
    zoomIn(viewport)
    fingers(viewport, [400, 225], [500, 225])
    pointer(viewport, 'pointermove', 12, 600, 225, 'touch')
    pointer(viewport, 'pointerdown', 1, 300, 200)
    pointer(viewport, 'pointermove', 1, 400, 300)
    viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(control.releases).toBe(0)
    const after = control.outputs.length
    for (let i = 0; i < 30; i++) env.frame()
    expect(control.outputs.slice(after).some((out) => out.camera !== null)).toBe(true)
  })

  it('says nothing of the zoom while a goal camera has it: no badge, cursor, tooltip or touch rule', () => {
    const { host, tracker, viewport } = mount()
    expect(tracker.trigger('goal')).toBe(true)
    for (let i = 0; i < 60; i++) env.frame()
    expect(view().zoom).toBeGreaterThan(1.4)
    expect(host.shadowRoot!.querySelector('.mt-zoom')).toBeNull()
    expect(viewport.classList.contains('mt-zoomed')).toBe(false)
    expect(viewport.title).toBe('')
    expect(viewport.style.touchAction).toBe('')
  })

  it('listens for no wheel, double-click or pointer move', () => {
    const added = vi.spyOn(HTMLElement.prototype, 'addEventListener')
    mount()
    const types = added.mock.calls.map(([type]) => type)
    for (const type of ['wheel', 'dblclick', 'pointermove', 'pointerup', 'pointercancel']) expect(types).not.toContain(type)
  })
})
