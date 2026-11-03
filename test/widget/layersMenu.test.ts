/**
 * The layers menu, ported from PipelineOutputSurface.vue's "layers menu"
 * tests (:2347-2566) and replayLayers.test.ts's stored-choice cases, plus the
 * widget's own: the storage key, the locale, Escape only from inside the
 * widget (spec, deliberate change 8), and the menu kept inside the box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, type MatchTracker, type MatchTrackerOptions } from '../../src/index'
import { en } from '../../src/i18n/en'
import { zh } from '../../src/i18n/zh'
import { DEFAULT_REPLAY_LAYERS, REPLAY_LAYERS, type ReplayLayers } from '../../src/model/replayLayers'
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

function mount(options: Partial<MatchTrackerOptions> = {}, host = makeHost()) {
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...options })
  mounted.push(tracker)
  env.resize(host, 800, 450)
  tracker.push(message(0, { withBall: true }))
  env.settle()
  return { host, tracker }
}

const shadow = (host: HTMLElement) => host.shadowRoot!
const button = (host: HTMLElement) => shadow(host).querySelector<HTMLButtonElement>('.mt-layers-toggle')!
const menu = (host: HTMLElement) => shadow(host).querySelector<HTMLElement>('.mt-layers-menu')
const options = (host: HTMLElement) => [...shadow(host).querySelectorAll<HTMLButtonElement>('.mt-layer-option')]
const option = (host: HTMLElement, key: string) =>
  shadow(host).querySelector<HTMLButtonElement>(`.mt-layer-option[data-layer="${key}"]`)!
const checked = (host: HTMLElement, key: string) => option(host, key).getAttribute('aria-pressed')

function open(host: HTMLElement) {
  if (!menu(host)) button(host).click()
}
function toggle(host: HTMLElement, key: string) {
  open(host)
  option(host, key).click()
}
const escape = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
/** How many updates the director has had: a frame each. */
const updates = () => control.inputs.length

beforeEach(() => {
  env = installEnv()
  control.reset()
  localStorage.clear()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  localStorage.clear()
  env.restore()
})

describe('the layers menu', () => {
  it('opens from its button, which says what it does', () => {
    const { host } = mount()
    expect(button(host).textContent?.trim()).toBe('Layers')
    expect(button(host).getAttribute('title')).toBe(en.layersTooltip)
    // A disclosure: the button says whether what it shows is open, and which it is while it is.
    expect(button(host).hasAttribute('aria-haspopup')).toBe(false)
    expect(button(host).getAttribute('aria-expanded')).toBe('false')
    expect(button(host).hasAttribute('aria-controls')).toBe(false)
    expect(menu(host)).toBeNull()
    button(host).click()
    expect(button(host).getAttribute('aria-expanded')).toBe('true')
    const id = button(host).getAttribute('aria-controls')
    expect(id).toBeTruthy()
    expect(shadow(host).getElementById(id!)).toBe(menu(host))
    expect(menu(host)?.getAttribute('role')).toBe('group')
    expect(menu(host)?.getAttribute('aria-label')).toBe(en.layersMenuLabel)
    button(host).click()
    expect(menu(host)).toBeNull()
    expect(button(host).getAttribute('aria-expanded')).toBe('false')
    expect(button(host).hasAttribute('aria-controls')).toBe(false)
  })

  it('lists every layer in order, all shown by default, with its name and hint', () => {
    const { host } = mount()
    open(host)
    const listed = options(host)
    expect(listed.map((o) => o.dataset.layer)).toEqual(REPLAY_LAYERS.map((l) => l.key))
    // Toggle buttons, each pressed while its layer is on.
    expect(listed.every((o) => o.tagName === 'BUTTON' && !o.hasAttribute('role'))).toBe(true)
    expect(listed.every((o) => !o.hasAttribute('aria-checked'))).toBe(true)
    expect(listed.every((o) => o.getAttribute('aria-pressed') === 'true')).toBe(true)
    for (const o of listed) {
      const { label, hint } = en.layers[o.dataset.layer as keyof ReplayLayers]
      expect(o.querySelector('.mt-layer-label')?.textContent).toBe(label)
      expect(o.querySelector('.mt-layer-hint')?.textContent).toBe(hint)
    }
  })

  it('speaks Chinese, from the start or from a change, without a remount', () => {
    const first = mount({ locale: 'zh' })
    open(first.host)
    expect(button(first.host).textContent?.trim()).toBe(zh.layersButton)
    expect(options(first.host).map((o) => o.querySelector('.mt-layer-label')?.textContent)).toEqual(
      REPLAY_LAYERS.map((l) => zh.layers[l.key].label),
    )

    const second = mount()
    open(second.host)
    const items = options(second.host)
    second.tracker.setOptions({ locale: 'zh' })
    expect(options(second.host)).toEqual(items)
    expect(options(second.host)[0]).toBe(items[0])
    expect(items.map((o) => o.querySelector('.mt-layer-hint')?.textContent)).toEqual(
      REPLAY_LAYERS.map((l) => zh.layers[l.key].hint),
    )
    expect(button(second.host).getAttribute('title')).toBe(zh.layersTooltip)
    expect(menu(second.host)?.getAttribute('aria-label')).toBe(zh.layersMenuLabel)
  })

  it('switches a layer, tells the host, and draws without it', () => {
    const { host, tracker } = mount()
    const changes: ReplayLayers[] = []
    tracker.on('layers', (layers) => changes.push(layers))
    const before = updates()
    toggle(host, 'ballTrail')
    expect(checked(host, 'ballTrail')).toBe('false')
    expect(changes).toEqual([{ ...DEFAULT_REPLAY_LAYERS, ballTrail: false }])
    toggle(host, 'ballTrail')
    expect(checked(host, 'ballTrail')).toBe('true')
    expect(changes.at(-1)).toEqual(DEFAULT_REPLAY_LAYERS)
    // Through the director's setLayers, not a frame of its own.
    expect(updates()).toBe(before)
    // The menu stays open for the next one, as the reference's does.
    expect(menu(host)).not.toBeNull()
  })

  it('hides the attacking and defending row, and leaves it to its own layer', () => {
    const { host } = mount()
    expect(shadow(host).querySelector('.mt-phase')).not.toBeNull()
    toggle(host, 'attack')
    expect(shadow(host).querySelector('.mt-phase')).not.toBeNull()
    toggle(host, 'phaseLabels')
    expect(shadow(host).querySelector('.mt-phase')).toBeNull()
    expect(checked(host, 'phaseLabels')).toBe('false')
  })

  it('keeps the choice under the storage key', () => {
    const { host } = mount({ layersStorageKey: 'perspecto.replayLayers' })
    toggle(host, 'farFade')
    expect(JSON.parse(localStorage.getItem('perspecto.replayLayers')!)).toEqual({
      ...DEFAULT_REPLAY_LAYERS,
      farFade: false,
    })
    expect(localStorage.getItem('match-tracker.layers')).toBeNull()

    const byDefault = mount({ layersStorageKey: undefined })
    toggle(byDefault.host, 'ringFades')
    expect(JSON.parse(localStorage.getItem('match-tracker.layers')!)).toMatchObject({ ringFades: false })
  })

  it('keeps the storage key it was mounted with, whatever setOptions says later', () => {
    const { host, tracker } = mount({ layersStorageKey: 'first.key' })
    tracker.setOptions({ layersStorageKey: 'second.key' } as Parameters<MatchTracker['setOptions']>[0])
    tracker.setOptions({ layersStorageKey: null } as Parameters<MatchTracker['setOptions']>[0])
    toggle(host, 'farFade')
    expect(JSON.parse(localStorage.getItem('first.key')!)).toMatchObject({ farFade: false })
    expect(localStorage.getItem('second.key')).toBeNull()
    // Switching the menu off and on reads the kept choice from that key too.
    tracker.setOptions({ layersMenu: false })
    tracker.setOptions({ layersMenu: true })
    open(host)
    expect(checked(host, 'farFade')).toBe('false')
  })

  it('keeps nothing when the storage key is null', () => {
    const { host } = mount({ layersStorageKey: null })
    toggle(host, 'farFade')
    expect(checked(host, 'farFade')).toBe('false')
    expect(localStorage.length).toBe(0)
  })

  it('remembers the choice for the next time the widget opens', () => {
    const first = mount({ layersStorageKey: undefined })
    toggle(first.host, 'ballTrail')
    first.tracker.destroy()
    const second = mount({ layersStorageKey: undefined })
    open(second.host)
    expect(checked(second.host, 'ballTrail')).toBe('false')
    expect(checked(second.host, 'goal')).toBe('true')
  })

  it('falls back to the defaults for anything stored that it does not recognise', () => {
    localStorage.setItem('match-tracker.layers', JSON.stringify({ goal: false, attack: 'no', attackArrows: false }))
    const first = mount({ layersStorageKey: undefined })
    open(first.host)
    expect(options(first.host).map((o) => [o.dataset.layer, o.getAttribute('aria-pressed')])).toEqual(
      REPLAY_LAYERS.map((l) => [l.key, l.key === 'goal' ? 'false' : 'true']),
    )

    localStorage.setItem('match-tracker.layers', '{not json')
    const second = mount({ layersStorageKey: undefined })
    open(second.host)
    expect(options(second.host).every((o) => o.getAttribute('aria-pressed') === 'true')).toBe(true)

    localStorage.setItem('match-tracker.layers', JSON.stringify(['goal']))
    const third = mount({ layersStorageKey: undefined })
    open(third.host)
    expect(options(third.host).every((o) => o.getAttribute('aria-pressed') === 'true')).toBe(true)
  })

  it('stops a goal that is playing when it is switched off, view and all', () => {
    const { host, tracker } = mount()
    const log: string[] = []
    tracker.on('moment', ({ moment, phase }) => log.push(`${moment}:${phase}`))
    expect(tracker.trigger('goal')).toBe(true)
    for (let i = 0; i < 40; i++) env.frame()
    expect(log).toEqual(['goal:start'])
    expect(control.views.at(-1)!.zoom).toBeGreaterThan(1)

    toggle(host, 'goal')
    expect(log).toEqual(['goal:start', 'goal:end'])
    expect(control.views.at(-1)).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
    env.settle()
    expect(log).toEqual(['goal:start', 'goal:end'])
  })

  it('closes on Escape while focus is in it, and gives the focus back to its button', () => {
    const { host } = mount()
    open(host)
    const first = options(host)[0]!
    first.focus()
    expect(shadow(host).activeElement).toBe(first)
    first.dispatchEvent(escape())
    expect(menu(host)).toBeNull()
    expect(shadow(host).activeElement).toBe(button(host))
  })

  it('keeps an Escape it closes on from the host page', () => {
    const { host } = mount()
    const heard: Event[] = []
    const listener = (event: Event) => heard.push(event)
    document.addEventListener('keydown', listener)
    try {
      open(host)
      options(host)[0]!.focus()
      options(host)[0]!.dispatchEvent(escape())
      expect(menu(host)).toBeNull()
      expect(heard).toEqual([])
      // With the menu closed, Escape is the page's.
      button(host).dispatchEvent(escape())
      expect(heard).toHaveLength(1)
    } finally {
      document.removeEventListener('keydown', listener)
    }
  })

  it('stays open on an Escape the page gets with focus outside the widget', () => {
    const { host } = mount()
    const outside = document.createElement('button')
    document.body.append(outside)
    open(host)
    outside.focus()
    document.dispatchEvent(escape())
    outside.dispatchEvent(escape())
    expect(menu(host)).not.toBeNull()
  })

  it('lets a click on the host page through while it is open, and closes', () => {
    const { host } = mount()
    const outside = document.createElement('button')
    document.body.append(outside)
    const clicks: Event[] = []
    outside.addEventListener('click', (event) => clicks.push(event))
    open(host)
    const down = new PointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true })
    outside.dispatchEvent(down)
    outside.click()
    expect(menu(host)).toBeNull()
    expect(down.defaultPrevented).toBe(false)
    expect(clicks).toHaveLength(1)
    expect(clicks[0]!.defaultPrevented).toBe(false)
  })

  it('covers nothing outside itself: nothing in the widget is fixed over the page', async () => {
    const { host } = mount()
    open(host)
    const { STYLES } = await import('../../src/widget/styles')
    expect(STYLES.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/position:\s*fixed/)
    // Only the button and the menu itself are in it.
    expect([...shadow(host).querySelector('.mt-layers')!.children].map((el) => el.className)).toEqual([
      'mt-layers-toggle',
      'mt-layers-menu',
    ])
    // Its z-index is the widget's own, and never competes with the page's.
    expect(getComputedStyle(shadow(host).querySelector('.mt-root')!).isolation).toBe('isolate')
  })

  it('closes on a press elsewhere in the widget, but not on one in it or on its button', () => {
    const { host } = mount()
    open(host)
    const press = (el: Element) =>
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true }))
    press(option(host, 'goal'))
    expect(menu(host)).not.toBeNull()
    option(host, 'goal').click()
    expect(checked(host, 'goal')).toBe('false')
    expect(menu(host)).not.toBeNull()
    press(button(host))
    expect(menu(host)).not.toBeNull()
    press(shadow(host).querySelector('canvas')!)
    expect(menu(host)).toBeNull()
  })

  it('stays usable inside a closed shadow root the page cannot see into', () => {
    const outer = makeHost()
    const closed = outer.attachShadow({ mode: 'closed' })
    const host = document.createElement('div')
    const sibling = document.createElement('button')
    closed.append(host, sibling)
    const { tracker } = mount({}, host)
    expect(tracker).toBeDefined()
    const press = (el: Element) =>
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true }))
    open(host)
    press(option(host, 'goal'))
    expect(menu(host)).not.toBeNull()
    press(shadow(host).querySelector('canvas')!)
    expect(menu(host)).toBeNull()
    open(host)
    const outside = document.createElement('button')
    document.body.append(outside)
    press(outside)
    expect(menu(host)).toBeNull()
  })

  it('closes when the focus leaves it for the page, and not while it moves inside it', () => {
    const { host } = mount()
    const outside = document.createElement('button')
    document.body.append(outside)
    open(host)
    options(host)[0]!.focus()
    options(host)[1]!.focus()
    button(host).focus()
    expect(menu(host)).not.toBeNull()
    outside.focus()
    expect(menu(host)).toBeNull()
  })

  it('listens on the page only while it is open', () => {
    const { host, tracker } = mount()
    const added = vi.spyOn(document, 'addEventListener')
    const removed = vi.spyOn(document, 'removeEventListener')
    const downs = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'pointerdown').map(([, fn]) => fn)
    open(host)
    expect(downs(added)).toHaveLength(1)
    button(host).click()
    expect(downs(removed)).toEqual(downs(added))
    open(host)
    tracker.setOptions({ layersMenu: false })
    expect(downs(removed)).toEqual(downs(added))
    tracker.setOptions({ layersMenu: true })
    open(host)
    tracker.destroy()
    expect(downs(added)).toHaveLength(3)
    expect(downs(removed)).toEqual(downs(added))
  })

  it('keeps inside the pitch box, scrolling if it has to', () => {
    const { host } = mount()
    open(host)
    // 800 x 450 puts the box at 728 x 410. The menu starts 44 px down (an 8 px
    // inset, the 28 px button, an 8 px gap) and keeps 8 px clear of the bottom.
    expect(menu(host)?.style.maxHeight).toBe(`${410 - 52}px`)
    expect(menu(host)?.style.maxWidth).toBe(`${728 - 16}px`)
    env.resize(host, 320, 220)
    expect(menu(host)?.style.maxHeight).toBe(`${180 - 52}px`)
    expect(menu(host)?.style.maxWidth).toBe(`${320 - 16}px`)
  })

  it('leaves no listener on its shadow root after destroy, and works again on a remount', () => {
    const host = makeHost()
    const added = vi.spyOn(ShadowRoot.prototype, 'addEventListener')
    const removed = vi.spyOn(ShadowRoot.prototype, 'removeEventListener')
    const first = mount({}, host)
    open(host)
    first.tracker.destroy()
    // The listeners on this host's root, by type: keydown always, pointerdown while the menu is open.
    const on = (spy: typeof added, type: string) =>
      spy.mock.calls.filter(([t], i) => t === type && spy.mock.contexts[i] === host.shadowRoot).map(([, fn]) => fn)
    for (const type of ['keydown', 'pointerdown']) {
      expect(on(added, type).length).toBeGreaterThan(0)
      expect(on(removed, type)).toEqual(on(added, type))
    }

    mount({}, host)
    open(host)
    options(host)[0]!.focus()
    options(host)[0]!.dispatchEvent(escape())
    expect(menu(host)).toBeNull()
  })
})

describe('the layersMenu option', () => {
  const stored = (choice: Partial<ReplayLayers>) =>
    localStorage.setItem('match-tracker.layers', JSON.stringify({ ...DEFAULT_REPLAY_LAYERS, ...choice }))

  it('renders no button and no menu when it is false', () => {
    const { host } = mount({ layersMenu: false })
    expect(shadow(host).querySelector('button')).toBeNull()
    expect(shadow(host).querySelector('.mt-layers')).toBeNull()
    expect(menu(host)).toBeNull()
  })

  it('shows the button by default and when it is true', () => {
    expect(button(mount().host)).not.toBeNull()
    expect(button(mount({ layersMenu: true }).host)).not.toBeNull()
  })

  it('ignores a stored choice, and keeps the defaults over the host\'s layers', () => {
    stored({ goal: false, attack: false })
    mount({ layersMenu: false, layersStorageKey: undefined, layers: { ballTrail: false } })
    expect(control.options.at(-1)?.layers).toEqual({ ...DEFAULT_REPLAY_LAYERS, ballTrail: false })
    expect(control.options.at(-1)?.layers.goal).toBe(true)
  })

  it('neither reads nor writes storage when it is false', () => {
    stored({ goal: false })
    const read = vi.spyOn(Storage.prototype, 'getItem')
    const write = vi.spyOn(Storage.prototype, 'setItem')
    try {
      const { tracker } = mount({ layersMenu: false, layersStorageKey: undefined })
      tracker.setOptions({ layers: { farFade: false } })
      expect(read).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    } finally {
      read.mockRestore()
      write.mockRestore()
    }
  })

  it('adds and removes the button when setOptions toggles it', () => {
    const { host, tracker } = mount()
    expect(button(host)).not.toBeNull()
    tracker.setOptions({ layersMenu: false })
    expect(shadow(host).querySelector('.mt-layers')).toBeNull()
    expect(shadow(host).querySelector('button')).toBeNull()
    tracker.setOptions({ layersMenu: true })
    expect(shadow(host).querySelectorAll('.mt-layers-toggle')).toHaveLength(1)
    toggle(host, 'ballTrail')
    expect(checked(host, 'ballTrail')).toBe('false')
  })

  it('closes an open menu when it is switched off, and opens closed when it is back', () => {
    const { host, tracker } = mount()
    open(host)
    tracker.setOptions({ layersMenu: false })
    expect(menu(host)).toBeNull()
    tracker.setOptions({ layersMenu: true })
    expect(menu(host)).toBeNull()
    expect(button(host).getAttribute('aria-expanded')).toBe('false')
  })

  it('goes back to the defaults over the host\'s layers when switched off', () => {
    const { host, tracker } = mount({ layers: { phaseLabels: false } })
    toggle(host, 'goal')
    const log: ReplayLayers[] = []
    tracker.on('layers', (layers) => log.push(layers))
    tracker.setOptions({ layersMenu: false })
    expect(log).toEqual([{ ...DEFAULT_REPLAY_LAYERS, phaseLabels: false }])
    expect(control.options.at(-1)?.layers.goal).toBe(true)
    expect(shadow(host).querySelector('.mt-phase')).toBeNull()
  })

  it('reads storage as at mount when switched on, and keeps the user\'s choices again', () => {
    const { host, tracker } = mount({ layersMenu: false, layersStorageKey: undefined })
    stored({ goal: false })
    const log: ReplayLayers[] = []
    tracker.on('layers', (layers) => log.push(layers))
    tracker.setOptions({ layersMenu: true })
    expect(log).toEqual([{ ...DEFAULT_REPLAY_LAYERS, goal: false }])
    open(host)
    expect(checked(host, 'goal')).toBe('false')
    toggle(host, 'farFade')
    expect(JSON.parse(localStorage.getItem('match-tracker.layers')!)).toMatchObject({ goal: false, farFade: false })
  })
})
