/**
 * Zoom and pan by hand, ported from PipelineOutputSurface.vue's wheel, pan,
 * double-click and camera hand-over (`:307-370`, and its goal test "hands the
 * view over, and leaves it, when the user scrolls during it", `:865`), with
 * the spec's deliberate change 6: a plain wheel scrolls the page, ctrl/⌘ +
 * wheel zooms, and two fingers pinch (this site's PitchView.vue).
 *
 * The widget is 800 x 450, so the viewport (the reference's stage) is
 * centred on (400, 225), and the pitch box is 728 px wide.
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
const badge = (host: HTMLElement) => host.shadowRoot!.querySelector('.mt-zoom')

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
const zoomOut = (target: HTMLElement, init: WheelEventInit = {}) => wheel(target, { deltaY: 100, ctrlKey: true, ...init })

function pointerEvent(type: string, id: number, x: number, y: number, pointerType = 'mouse') {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType, clientX: x, clientY: y })
}

function pointer(target: HTMLElement, type: string, id: number, x: number, y: number, pointerType = 'mouse') {
  target.dispatchEvent(pointerEvent(type, id, x, y, pointerType))
}

/**
 * `event` on `el`, an element in the overlay, as the stage hears it. A
 * browser routes an event on a slotted element through its slot, so the
 * stage's listeners hear it with `el` as its target. happy-dom does not, so
 * here it is dispatched on the stage with `el` as its target.
 */
function fromOverlay<E extends Event>(viewport: HTMLElement, el: Element, event: E): E {
  Object.defineProperty(event, 'target', { value: el })
  viewport.dispatchEvent(event)
  return event
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

describe('the wheel', () => {
  it('scrolls the page when it is a plain wheel, and zooms nothing', () => {
    const { host, viewport, zooms } = mount()
    const views = control.views.length
    const event = wheel(viewport, { deltaY: -100 })
    expect(event.defaultPrevented).toBe(false)
    expect(control.views).toHaveLength(views)
    expect(control.releases).toBe(0)
    expect(zooms).toEqual([])
    expect(badge(host)).toBeNull()
  })

  it('zooms in by one step about the cursor with ctrl or ⌘ held, and keeps the page from zooming', () => {
    const { host, viewport, zooms } = mount()
    // 100 px right of and 75 px below the stage's centre.
    const event = zoomIn(viewport, { clientX: 500, clientY: 300 })
    expect(event.defaultPrevented).toBe(true)
    // The reference's formula: pan = m - (next / old) * (m - pan).
    expect(view().zoom).toBeCloseTo(1.15, 12)
    expect(view().panX).toBeCloseTo(100 - 1.15 * 100, 12)
    expect(view().panY).toBeCloseTo(75 - 1.15 * 75, 12)
    expect(view().renderedWidth).toBe(728)
    expect(zooms).toEqual([view().zoom])
    expect(badge(host)?.textContent).toBe('1.1x')

    const before = { ...view() }
    zoomIn(viewport, { ctrlKey: false, metaKey: true, clientX: 300, clientY: 225 })
    const scale = (before.zoom + 0.15) / before.zoom
    expect(view().zoom).toBeCloseTo(1.3, 12)
    expect(view().panX).toBeCloseTo(-100 - scale * (-100 - before.panX), 12)
    expect(view().panY).toBeCloseTo(0 - scale * (0 - before.panY), 12)
  })

  it('zooms with ctrl or ⌘ over the HUD too, so the page never zooms there', () => {
    const { host, viewport } = mount()
    const phase = host.shadowRoot!.querySelector<HTMLElement>('.mt-phase')!
    const layers = host.shadowRoot!.querySelector<HTMLElement>('.mt-layers-toggle')!
    expect(viewport.contains(phase) || viewport.contains(layers)).toBe(false)
    expect(zoomIn(phase).defaultPrevented).toBe(true)
    expect(view().zoom).toBeCloseTo(1.15, 12)
    expect(zoomIn(layers, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true)
    expect(view().zoom).toBeCloseTo(1.3, 12)
    // A plain wheel over them still scrolls the page.
    const views = control.views.length
    expect(wheel(phase, { deltaY: -100 }).defaultPrevented).toBe(false)
    expect(control.views).toHaveLength(views)
  })

  it('holds to the zoom limits, and gives the whole pitch back at 1', () => {
    const { host, viewport, zooms } = mount()
    for (let i = 0; i < 40; i++) zoomIn(viewport, { clientX: 520, clientY: 260 })
    expect(view().zoom).toBe(6)
    expect(zooms.at(-1)).toBe(6)
    expect(badge(host)?.textContent).toBe('6.0x')
    const atMax = control.views.length
    zoomIn(viewport)
    expect(control.views).toHaveLength(atMax)

    for (let i = 0; i < 40; i++) zoomOut(viewport, { clientX: 300, clientY: 100 })
    expect(view()).toEqual({ zoom: 1, panX: 0, panY: 0, renderedWidth: 728 })
    expect(zooms.at(-1)).toBe(1)
    expect(badge(host)).toBeNull()
  })

  it('zooms through the director, without a frame of its own', () => {
    const { viewport } = mount()
    const updates = control.inputs.length
    zoomIn(viewport)
    expect(control.inputs).toHaveLength(updates)
    expect(env.queued()).toBe(0)
  })
})

describe('dragging', () => {
  it('does nothing at the whole pitch', () => {
    const { viewport } = mount()
    const views = control.views.length
    pointer(viewport, 'pointerdown', 1, 300, 200)
    pointer(viewport, 'pointermove', 1, 360, 150)
    pointer(viewport, 'pointerup', 1, 360, 150)
    expect(control.views).toHaveLength(views)
    expect(control.releases).toBe(0)
  })

  it('pans by the pointer moved, zoomed in', () => {
    const { viewport } = mount()
    // Two fingers from 100 to 200 px apart: zoom 2.
    fingers(viewport, [400, 225], [500, 225])
    pointer(viewport, 'pointermove', 12, 600, 225, 'touch')
    pointer(viewport, 'pointerup', 12, 600, 225, 'touch')
    pointer(viewport, 'pointerup', 11, 400, 225, 'touch')
    expect(view().zoom).toBe(2)
    const start = { ...view() }

    pointer(viewport, 'pointerdown', 1, 300, 200)
    pointer(viewport, 'pointermove', 1, 340, 170)
    expect(view()).toEqual({ ...start, panX: start.panX + 40, panY: start.panY - 30 })
    pointer(viewport, 'pointermove', 1, 250, 260)
    expect(view()).toEqual({ ...start, panX: start.panX - 50, panY: start.panY + 60 })
    pointer(viewport, 'pointerup', 1, 250, 260)
    const views = control.views.length
    pointer(viewport, 'pointermove', 1, 100, 100)
    expect(control.views).toHaveLength(views)
  })

  it('carries on from the whole pitch when a wheel zooms all the way out mid-drag', () => {
    const { viewport } = mount()
    zoomIn(viewport, { clientX: 500, clientY: 300 })
    pointer(viewport, 'pointerdown', 1, 300, 200)
    pointer(viewport, 'pointermove', 1, 320, 210)
    zoomOut(viewport, { clientX: 320, clientY: 210 })
    expect(view()).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
    pointer(viewport, 'pointermove', 1, 330, 230)
    // From where the wheel left it, not from where the drag began.
    expect(view()).toMatchObject({ zoom: 1, panX: 10, panY: 20 })
  })

  it('lets one finger scroll the page at the whole pitch, and takes every touch once zoomed in', () => {
    const { viewport } = mount()
    expect(viewport.style.touchAction).toBe('pan-y')
    expect(viewport.classList.contains('mt-zoomed')).toBe(false)
    zoomIn(viewport)
    expect(viewport.style.touchAction).toBe('none')
    expect(viewport.classList.contains('mt-zoomed')).toBe(true)
    viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(viewport.style.touchAction).toBe('pan-y')
    expect(viewport.classList.contains('mt-zoomed')).toBe(false)
  })
})

describe('double-click', () => {
  it('puts the whole pitch back', () => {
    const { host, viewport, zooms } = mount()
    zoomIn(viewport, { clientX: 600, clientY: 100 })
    zoomIn(viewport, { clientX: 600, clientY: 100 })
    viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(view()).toEqual({ zoom: 1, panX: 0, panY: 0, renderedWidth: 728 })
    expect(zooms.at(-1)).toBe(1)
    expect(badge(host)).toBeNull()
  })

  it('says how to get back while zoomed in, in the locale', () => {
    const { viewport, tracker } = mount()
    expect(viewport.title).toBe('')
    zoomIn(viewport)
    expect(viewport.title).toBe('Double-click to reset the zoom')
    tracker.setOptions({ locale: 'zh' })
    expect(viewport.title).toBe('双击恢复原始大小')
    viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(viewport.title).toBe('')
  })
})

describe("the host's own controls in the overlay", () => {
  /** Zoomed to 2, with a transport marked data-match-tracker-keep, and a Play button in it, over the pitch. */
  function zoomedWithTransport() {
    const mounted = mount()
    fingers(mounted.viewport, [400, 225], [500, 225])
    pointer(mounted.viewport, 'pointermove', 12, 600, 225, 'touch')
    pointer(mounted.viewport, 'pointerup', 12, 600, 225, 'touch')
    pointer(mounted.viewport, 'pointerup', 11, 400, 225, 'touch')
    expect(view().zoom).toBe(2)
    const transport = document.createElement('div')
    transport.setAttribute('data-match-tracker-keep', '')
    const play = document.createElement('button')
    transport.append(play)
    mounted.tracker.overlay.append(transport)
    const on = <E extends Event>(event: E) => fromOverlay(mounted.viewport, play, event)
    return { ...mounted, play, on }
  }

  it('leaves a press and drag on one to it: no pan, no capture, and its click fires', () => {
    const { viewport, play, on } = zoomedWithTransport()
    const capture = vi.spyOn(viewport, 'setPointerCapture')
    const clicks = vi.fn<() => void>()
    play.addEventListener('click', clicks)
    const zoomed = { ...view() }
    const views = control.views.length
    const releases = control.releases
    on(pointerEvent('pointerdown', 1, 300, 200))
    on(pointerEvent('pointermove', 1, 360, 150))
    pointer(viewport, 'pointermove', 1, 200, 300)
    on(pointerEvent('pointerup', 1, 300, 200))
    play.click()
    expect(control.views).toHaveLength(views)
    expect(view()).toEqual(zoomed)
    expect(control.releases).toBe(releases)
    // Captured by the stage, the press's click would go to the pitch, not the button.
    expect(capture).not.toHaveBeenCalled()
    expect(clicks).toHaveBeenCalledOnce()
    // A drag that starts on the pitch still pans.
    pointer(viewport, 'pointerdown', 2, 300, 200)
    pointer(viewport, 'pointermove', 2, 340, 170)
    expect(view()).toEqual({ ...zoomed, panX: zoomed.panX + 40, panY: zoomed.panY - 30 })
  })

  it('leaves a double-click on one to it, and does not reset the zoom', () => {
    const { host, on } = zoomedWithTransport()
    const views = control.views.length
    on(new MouseEvent('dblclick', { bubbles: true }))
    expect(control.views).toHaveLength(views)
    expect(view().zoom).toBe(2)
    expect(badge(host)?.textContent).toBe('2.0x')
  })

  it('still zooms the pitch on a ctrl or ⌘ + wheel over one, and keeps the page from zooming', () => {
    const { on } = zoomedWithTransport()
    expect(on(wheelEvent({ deltaY: -100, ctrlKey: true })).defaultPrevented).toBe(true)
    expect(view().zoom).toBeCloseTo(2.15, 12)
    expect(on(wheelEvent({ deltaY: 100, metaKey: true })).defaultPrevented).toBe(true)
    expect(view().zoom).toBeCloseTo(2, 12)
  })

  it('still pinches with a finger on one, without capturing that finger', () => {
    const { viewport, on } = zoomedWithTransport()
    const capture = vi.spyOn(viewport, 'setPointerCapture')
    on(pointerEvent('pointerdown', 21, 400, 225, 'touch'))
    expect(capture).not.toHaveBeenCalled()
    pointer(viewport, 'pointerdown', 22, 500, 225, 'touch')
    pointer(viewport, 'pointermove', 22, 600, 225, 'touch')
    expect(view().zoom).toBe(4)
  })
})

describe('pinching', () => {
  it('doubles the zoom when two fingers go from 100 to 200 px apart, about their midpoint', () => {
    const { viewport, zooms } = mount()
    fingers(viewport, [400, 275], [500, 275])
    pointer(viewport, 'pointermove', 12, 600, 275, 'touch')
    // The midpoint is (500, 275): 100 px right of and 50 px below the centre.
    expect(view().zoom).toBe(2)
    expect(view().panX).toBeCloseTo(100 - 2 * 100, 12)
    expect(view().panY).toBeCloseTo(50 - 2 * 50, 12)
    expect(zooms).toEqual([2])
  })

  it('holds to 1 and 6', () => {
    const { viewport } = mount()
    fingers(viewport, [400, 225], [500, 225])
    pointer(viewport, 'pointermove', 12, 450, 225, 'touch')
    expect(view()).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
    pointer(viewport, 'pointermove', 12, 2000, 225, 'touch')
    expect(view().zoom).toBe(6)
  })

  it('needs two touches: a mouse and a finger, or a third finger, do not pinch', () => {
    const { viewport } = mount()
    pointer(viewport, 'pointerdown', 1, 400, 225)
    pointer(viewport, 'pointerdown', 11, 500, 225, 'touch')
    pointer(viewport, 'pointermove', 11, 700, 225, 'touch')
    expect(control.releases).toBe(0)
    pointer(viewport, 'pointerup', 1, 400, 225)

    pointer(viewport, 'pointerdown', 12, 600, 225, 'touch')
    pointer(viewport, 'pointermove', 12, 800, 225, 'touch')
    const pinched = { ...view() }
    pointer(viewport, 'pointerdown', 13, 100, 100, 'touch')
    pointer(viewport, 'pointermove', 13, 50, 50, 'touch')
    expect(view()).toEqual(pinched)
  })

  it('stops when a finger lifts, and the other does not pan', () => {
    const { viewport } = mount()
    fingers(viewport, [400, 225], [500, 225])
    pointer(viewport, 'pointermove', 12, 600, 225, 'touch')
    pointer(viewport, 'pointerup', 12, 600, 225, 'touch')
    const views = control.views.length
    pointer(viewport, 'pointermove', 11, 300, 300, 'touch')
    expect(control.views).toHaveLength(views)
  })
})

describe('the goal camera', () => {
  /** A goal playing, a second in, with its camera zoomed in. */
  function goalZoomed() {
    const mountedTracker = mount()
    expect(mountedTracker.tracker.trigger('goal')).toBe(true)
    for (let i = 0; i < 60; i++) env.frame()
    expect(view().zoom).toBeGreaterThan(1.4)
    expect(control.outputs.some((out) => out.camera !== null)).toBe(true)
    return mountedTracker
  }

  it('drives the view until the user zooms, then leaves it where they put it', () => {
    const { host, viewport, zooms } = goalZoomed()
    const zoomed = view().zoom
    expect(badge(host)?.textContent).toBe(`${zoomed.toFixed(1)}x`)
    zoomIn(viewport)
    expect(control.releases).toBe(1)
    const own = { ...view() }
    expect(own.zoom).toBeCloseTo(zoomed + 0.15, 12)
    expect(zooms.at(-1)).toBe(own.zoom)

    const after = control.outputs.length
    env.settle()
    expect(control.outputs.length).toBeGreaterThan(after)
    expect(control.outputs.slice(after).every((out) => out.camera === null)).toBe(true)
    expect(view()).toEqual(own)
    expect(badge(host)?.textContent).toBe(`${own.zoom.toFixed(1)}x`)
  })

  it.each(['pinch', 'pan', 'dblclick'] as const)('is taken over by a %s too', (take) => {
    const { viewport } = goalZoomed()
    if (take === 'pinch') fingers(viewport, [400, 225], [500, 225])
    if (take === 'pan') pointer(viewport, 'pointerdown', 1, 300, 200)
    if (take === 'dblclick') viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    // Zoomed in by the goal, a pinch's first finger already starts a pan, which takes it over.
    expect(control.releases).toBeGreaterThan(0)
    const own = { ...view() }
    const after = control.outputs.length
    env.settle()
    expect(control.outputs.slice(after).every((out) => out.camera === null)).toBe(true)
    expect(view()).toEqual(own)
  })

  it('takes nothing over from a press at the whole pitch', () => {
    const { viewport } = mount()
    pointer(viewport, 'pointerdown', 1, 300, 200)
    expect(control.releases).toBe(0)
  })
})

describe('listening', () => {
  it('asks to cancel the wheel, which a passive listener could not', () => {
    const added = vi.spyOn(HTMLElement.prototype, 'addEventListener')
    mount()
    const onWheel = added.mock.calls.filter(([type]) => type === 'wheel')
    // On the pitch and on the HUD over it.
    expect(onWheel).toHaveLength(2)
    for (const call of onWheel) expect(call[2]).toMatchObject({ passive: false })
  })

  it('hears nothing after destroy', () => {
    const { host, tracker, viewport } = mount()
    const removed = vi.spyOn(viewport, 'removeEventListener')
    const hudLayer = host.shadowRoot!.querySelector<HTMLElement>('.mt-hud-layer')!
    const removedFromHud = vi.spyOn(hudLayer, 'removeEventListener')
    tracker.destroy()
    const types = removed.mock.calls.map(([type]) => type)
    for (const type of ['wheel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick']) {
      expect(types).toContain(type)
    }
    expect(removedFromHud.mock.calls.map(([type]) => type)).toContain('wheel')
    const views = control.views.length
    expect(() => {
      zoomIn(viewport)
      viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    }).not.toThrow()
    expect(control.views).toHaveLength(views)
  })
})
