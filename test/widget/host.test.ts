/**
 * What a host builds on over the pitch: the overlay, a light-DOM element the
 * host's own CSS reaches, slotted into the pitch's box; the box itself; and
 * which moments can be played before a press.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createMatchTracker,
  DEFAULT_PERSON_COLORS,
  parseRecord,
  REPLAY_LOOKBACK_S,
  type MatchTracker,
  type MatchTrackerOptions,
  type MomentAvailability,
  type TrackerBox,
} from '../../src/index'
import { HISTORY_S } from '../../src/analysis/derive'
import { PERSON_COLORS } from '../../src/render/constants'
import { installEnv, makeHost, type Env } from './env'
import { message } from './messages'

let env: Env
const mounted: MatchTracker[] = []

function mount(options: Partial<MatchTrackerOptions> = {}, host = makeHost()) {
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...options })
  mounted.push(tracker)
  return { host, tracker }
}

/** The overlay's slot in `host`'s shadow root. (happy-dom has no `assignedSlot`.) */
const overlaySlot = (host: HTMLElement) => host.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="overlay"]')!

const NOTHING: MomentAvailability = {
  goal: false,
  attack: { 0: false, 1: false },
  corner: false,
  freeKick: false,
  throwIn: false,
  penalty: false,
  penaltyScored: false,
  penaltyMissed: false,
  varCheck: false,
  goalDisallowed: false,
  halfTime: false,
  secondHalf: false,
  fullTime: false,
  foul: false,
  shotOnGoal: false,
  headerOnGoal: false,
  yellowCard: false,
  redCard: false,
  substitution: false,
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

describe('the overlay', () => {
  it('is the one element the widget adds to its host, slotted into the box the canvas is in', () => {
    const { host, tracker } = mount()
    env.resize(host, 800, 450)
    expect([...host.children]).toEqual([tracker.overlay])
    expect(tracker.overlay.getAttribute('slot')).toBe('overlay')
    expect(host.shadowRoot!.contains(tracker.overlay)).toBe(false)

    const slot = overlaySlot(host)
    expect(slot.assignedElements()).toEqual([tracker.overlay])
    const canvas = host.shadowRoot!.querySelector('canvas')!
    const box = slot.parentElement!
    for (const side of ['left', 'top', 'width', 'height'] as const) expect(box.style[side]).toBe(canvas.style[side])
    expect(box.style.width).toBe('728px')
  })

  it('fills its box, lets pointer events through, and holds against the page’s CSS', () => {
    const style = document.createElement('style')
    style.setAttribute('data-test-style', '')
    style.textContent = 'div { position: static; margin: 12px; display: inline; pointer-events: auto }'
    document.head.append(style)
    const { tracker } = mount()
    const css = getComputedStyle(tracker.overlay)
    expect(css.position).toBe('absolute')
    expect([css.top, css.right, css.bottom, css.left]).toEqual(['0px', '0px', '0px', '0px'])
    expect(css.margin).toBe('0px')
    expect(css.display).toBe('block')
    expect(css.pointerEvents).toBe('none')
  })

  it('gives what the host mounts in it the page’s own styles', () => {
    const style = document.createElement('style')
    style.setAttribute('data-test-style', '')
    style.textContent =
      // Tailwind's inset-0 is `inset: 0px`; happy-dom computes the longhands only.
      '.absolute { position: absolute } .inset-0 { top: 0; right: 0; bottom: 0; left: 0 } .pointer-events-auto { pointer-events: auto } .tint { color: rgb(1, 2, 3) }'
    document.head.append(style)
    const { tracker } = mount()
    const layer = document.createElement('div')
    layer.className = 'absolute inset-0 pointer-events-auto tint'
    tracker.overlay.append(layer)
    const css = getComputedStyle(layer)
    expect(css.position).toBe('absolute')
    expect([css.top, css.right, css.bottom, css.left]).toEqual(['0px', '0px', '0px', '0px'])
    expect(css.pointerEvents).toBe('auto')
    expect(css.color).toBe('rgb(1, 2, 3)')
  })

  it('stops a goal when something mounted in it is pressed', () => {
    const { host, tracker } = mount()
    env.resize(host, 1280, 760)
    const log: string[] = []
    tracker.on('moment', ({ moment, phase }) => log.push(`${moment}:${phase}`))
    const layer = document.createElement('div')
    tracker.overlay.append(layer)
    tracker.push(message(0, { withBall: true }))
    env.settle()
    expect(tracker.trigger('goal')).toBe(true)
    for (let i = 0; i < 10; i++) env.frame()
    expect(log).toEqual(['goal:start'])
    layer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(log).toEqual(['goal:start', 'goal:end'])
    env.settle()
    expect(env.queued()).toBe(0)
  })

  it('leaves a goal running when a press is inside an element marked data-match-tracker-keep', () => {
    const { host, tracker } = mount()
    env.resize(host, 1280, 760)
    const log: string[] = []
    tracker.on('moment', ({ moment, phase }) => log.push(`${moment}:${phase}`))
    // A transport bar the host keeps its own, with a button in it, beside a plain layer.
    const transport = document.createElement('div')
    transport.setAttribute('data-match-tracker-keep', '')
    const play = document.createElement('button')
    transport.append(play)
    const layer = document.createElement('div')
    tracker.overlay.append(layer, transport)
    tracker.push(message(0, { withBall: true }))
    env.settle()
    expect(tracker.trigger('goal')).toBe(true)
    for (let i = 0; i < 10; i++) env.frame()
    const press = (el: Element) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    press(play)
    press(transport)
    for (let i = 0; i < 5; i++) env.frame()
    expect(log).toEqual(['goal:start'])
    press(layer)
    expect(log).toEqual(['goal:start', 'goal:end'])
  })

  it('still stops moments when the mark is on an ancestor outside the overlay', () => {
    const host = makeHost()
    host.setAttribute('data-match-tracker-keep', '')
    const { tracker } = mount({}, host)
    env.resize(host, 1280, 760)
    const log: string[] = []
    tracker.on('moment', ({ moment, phase }) => log.push(`${moment}:${phase}`))
    const layer = document.createElement('div')
    tracker.overlay.append(layer)
    tracker.push(message(0, { withBall: true }))
    env.settle()
    expect(tracker.trigger('goal')).toBe(true)
    env.frame()
    layer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(log).toEqual(['goal:start', 'goal:end'])
  })

  it('leaves the host on destroy, with whatever was mounted in it', () => {
    const { host, tracker } = mount()
    const layer = document.createElement('div')
    tracker.overlay.append(layer)
    tracker.destroy()
    expect(host.children).toHaveLength(0)
    expect(tracker.overlay.isConnected).toBe(false)
    // What the host mounted is still its own: the widget does not empty it.
    expect(layer.parentElement).toBe(tracker.overlay)
  })

  it('is added only once the host is known to be one the tracker can mount on', () => {
    const host = makeHost()
    host.attachShadow({ mode: 'open' })
    expect(() => createMatchTracker(host, { mode: 'live' })).toThrow(/plain element/)
    expect(host.children).toHaveLength(0)

    const again = makeHost()
    mount({}, again)
    expect(() => createMatchTracker(again, { mode: 'live' })).toThrow(/already has a match tracker/)
    expect(again.children).toHaveLength(1)
  })

  it('is a new element on a host mounted again', () => {
    const host = makeHost()
    const first = mount({}, host).tracker
    first.destroy()
    const second = mount({}, host).tracker
    expect(second.overlay).not.toBe(first.overlay)
    expect([...host.children]).toEqual([second.overlay])
  })
})

describe('the box', () => {
  it('is null until the widget has a size', () => {
    const { tracker } = mount()
    expect(tracker.box).toBeNull()
  })

  it('is the canvas’s box, relative to the host, and says when it changes', () => {
    const { host, tracker } = mount()
    const boxes: TrackerBox[] = []
    tracker.on('box', (box) => boxes.push(box))
    env.resize(host, 800, 450)
    const canvas = host.shadowRoot!.querySelector('canvas')!
    const css = (side: 'left' | 'top' | 'width' | 'height') => parseFloat(canvas.style[side])
    const expected = { left: css('left'), top: css('top'), width: css('width'), height: css('height') }
    expect(expected).toEqual({ left: 36, top: 40, width: 728, height: 410 })
    expect(tracker.box).toEqual(expected)
    expect(boxes).toEqual([expected])

    env.resize(host, 1280, 760)
    const after = { left: css('left'), top: css('top'), width: css('width'), height: css('height') }
    expect(after).not.toEqual(expected)
    expect(tracker.box).toEqual(after)
    expect(boxes).toEqual([expected, after])

    // The same size again moves nothing, and says nothing.
    env.resize(host, 1280, 760)
    expect(boxes).toHaveLength(2)
  })

  it('stays as it was when the widget measures as nothing', () => {
    const { host, tracker } = mount()
    env.resize(host, 800, 450)
    const before = tracker.box
    env.resize(host, 0, 0)
    expect(tracker.box).toEqual(before)
  })

  it('is a copy the host cannot change the widget’s through', () => {
    const { host, tracker } = mount()
    env.resize(host, 800, 450)
    const box = tracker.box as { width: number }
    expect(() => {
      box.width = 1
    }).toThrow(TypeError)
    expect(tracker.box?.width).toBe(728)
  })
})

describe('moment availability', () => {
  it('is nothing before the first frame, and flips when a record arrives', () => {
    const { host, tracker } = mount({ mode: 'replay' })
    env.resize(host, 1280, 760)
    const seen: MomentAvailability[] = []
    tracker.on('availability', (value) => seen.push(value))
    expect(tracker.availability()).toEqual(NOTHING)

    const record = parseRecord(message(0, { withBall: true }))!
    tracker.present({ time: 10, playing: false, record, lookback: [record] })
    env.frame()
    const now = tracker.availability()
    expect(now).toMatchObject({ goal: true, corner: true, throwIn: true })
    expect(seen).toEqual([now])

    // The same frame again changes nothing, and says nothing.
    tracker.present({ time: 10, playing: false, record, lookback: [record] })
    env.frame()
    expect(seen).toHaveLength(1)

    // A frame without a ball has no goal to play.
    const noBall = parseRecord(message(1))!
    tracker.present({ time: 10.04, playing: true, record: noBall, lookback: [record, noBall] })
    env.frame()
    expect(tracker.availability().goal).toBe(false)
    expect(seen).toHaveLength(2)
  })

  it('is what trigger plays, moment by moment', () => {
    const { host, tracker } = mount()
    env.resize(host, 1280, 760)
    tracker.push(message(0, { withBall: true }))
    env.settle()
    const available = tracker.availability()
    const plays = [
      ['goal', 0, available.goal],
      ['attack', 0, available.attack[0]],
      ['attack', 1, available.attack[1]],
      ['corner', 0, available.corner],
      ['throwIn', 0, available.throwIn],
      ['varCheck', 0, available.varCheck],
      ['goalDisallowed', 0, available.goalDisallowed],
      ['halfTime', 0, available.halfTime],
      ['secondHalf', 0, available.secondHalf],
      ['fullTime', 0, available.fullTime],
      ['foul', 0, available.foul],
      ['shotOnGoal', 0, available.shotOnGoal],
      ['headerOnGoal', 0, available.headerOnGoal],
    ] as const
    for (const [moment, team, can] of plays) expect(tracker.trigger(moment, team)).toBe(can)
  })

  it('goes back to nothing on a reset, and says so', () => {
    const { host, tracker } = mount()
    env.resize(host, 1280, 760)
    tracker.push(message(0, { withBall: true }))
    env.settle()
    const seen: MomentAvailability[] = []
    tracker.on('availability', (value) => seen.push(value))
    tracker.reset()
    expect(tracker.availability()).toEqual(NOTHING)
    expect(seen).toEqual([NOTHING])
  })

  it('hands out a copy each time', () => {
    const { tracker } = mount()
    const a = tracker.availability()
    a.attack[0] = true
    a.goal = true
    expect(tracker.availability()).toEqual(NOTHING)
  })
})

describe('the constants a host needs', () => {
  it('exports the lookback a replay host passes', () => {
    expect(REPLAY_LOOKBACK_S).toBe(HISTORY_S)
  })

  it('exports the default colours, frozen all the way down', () => {
    expect(DEFAULT_PERSON_COLORS).toEqual(PERSON_COLORS)
    expect(Object.isFrozen(DEFAULT_PERSON_COLORS)).toBe(true)
    for (const role of Object.values(DEFAULT_PERSON_COLORS)) expect(Object.isFrozen(role)).toBe(true)
    expect(DEFAULT_PERSON_COLORS.home).not.toBe(PERSON_COLORS.home)
  })
})
