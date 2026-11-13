/**
 * The Vue export: a component that mounts one tracker in its own element,
 * hands its props to it, passes its events on, and exposes its input.
 */
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import type { MatchTracker as Tracker, MatchTrackerInstance, MatchTrackerOptions } from '../src/index'
import { MatchTracker, type MatchTrackerHandle, type MatchTrackerInstance as VueInstance } from '../src/vue'
import { installEnv, type Env } from './widget/env'
import { message } from './widget/messages'

/** Every tracker the component made, as createMatchTracker returned it, with what it was made with. */
const made: Array<{ host: HTMLElement; options: MatchTrackerOptions; tracker: Tracker }> = []

vi.mock('../src/widget/createMatchTracker', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/widget/createMatchTracker')>()
  return {
    ...real,
    createMatchTracker: (host: HTMLElement, options: MatchTrackerOptions) => {
      const tracker = real.createMatchTracker(host, options)
      made.push({ host, options, tracker })
      return tracker
    },
  }
})

let env: Env
const wrappers: VueWrapper[] = []

function mountTracker(props: Record<string, unknown> = {}) {
  const wrapper = mount(MatchTracker, {
    props: { mode: 'live', layersStorageKey: null, ...props },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  const host = wrapper.element as HTMLElement
  env.resize(host, 800, 450)
  return { wrapper, host, handle: wrapper.vm as unknown as MatchTrackerHandle }
}

const last = () => made.at(-1)!

beforeEach(() => {
  env = installEnv()
  made.length = 0
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
  env.restore()
})

describe('the Vue component', () => {
  it('renders a host div with the tracker in its shadow root', () => {
    const { host } = mountTracker()
    expect(host.tagName).toBe('DIV')
    expect(host.shadowRoot).not.toBeNull()
    expect(host.shadowRoot!.querySelector('canvas')).not.toBeNull()
    expect(made).toHaveLength(1)
    expect(last().host).toBe(host)
    expect(last().options.mode).toBe('live')
  })

  it('hands every option prop it is given to the tracker at mount', () => {
    const formatAction = (type: string) => type.toLowerCase()
    mountTracker({
      locale: 'zh',
      teams: { home: { name: 'Ajax' } },
      layers: { ballTrail: false },
      formatAction,
    })
    const { options } = last()
    expect(options).toMatchObject({ mode: 'live', locale: 'zh', teams: { home: { name: 'Ajax' } } })
    expect(options.layers).toEqual({ ballTrail: false })
    expect(options.formatAction).toBe(formatAction)
    expect(options.layersStorageKey).toBeNull()
  })

  it('calls setOptions with only the prop that changed', async () => {
    const { wrapper } = mountTracker({ locale: 'en' })
    const setOptions = vi.spyOn(last().tracker, 'setOptions')
    await wrapper.setProps({ locale: 'zh' })
    expect(setOptions).toHaveBeenCalledTimes(1)
    expect(setOptions).toHaveBeenCalledWith({ locale: 'zh' })
    // The HUD follows, in place.
    expect(made).toHaveLength(1)
  })

  it('calls setOptions when an object prop is changed in place', async () => {
    const teams = reactive({ home: { name: 'Ajax' }, away: { name: 'PSV' } })
    const Parent = defineComponent({
      setup: () => () => h(MatchTracker, { mode: 'live', layersStorageKey: null, teams }),
    })
    const wrapper = mount(Parent, { attachTo: document.body })
    wrappers.push(wrapper)
    const setOptions = vi.spyOn(last().tracker, 'setOptions')
    teams.home.name = 'Feyenoord'
    await nextTick()
    expect(setOptions).toHaveBeenCalledTimes(1)
    expect(setOptions.mock.calls[0]![0].teams?.home?.name).toBe('Feyenoord')
  })

  it('keeps the layer chosen in the menu when the parent renders an equal inline :layers again', async () => {
    const tick = ref(0)
    const Parent = defineComponent({
      setup: () => () =>
        h('div', { 'data-tick': tick.value }, [
          // A new object on every render, as an inline :layers="{ ... }" is.
          h(MatchTracker, { mode: 'live', layersStorageKey: null, layers: { ballTrail: true } }),
        ]),
    })
    const wrapper = mount(Parent, { attachTo: document.body })
    wrappers.push(wrapper)
    const host = wrapper.element.firstElementChild as HTMLElement
    host.shadowRoot!.querySelector<HTMLButtonElement>('.mt-layers-toggle')!.click()
    host.shadowRoot!.querySelector<HTMLButtonElement>('[data-layer="ballTrail"]')!.click()
    tick.value++
    await nextTick()
    expect(wrapper.element.getAttribute('data-tick')).toBe('1')
    const item = host.shadowRoot!.querySelector<HTMLButtonElement>('[data-layer="ballTrail"]')!
    expect(item.getAttribute('aria-pressed')).toBe('false')
  })

  it('calls no setOptions when the parent renders equal inline objects again, and one when they differ', async () => {
    const tick = ref(0)
    const home = ref('Ajax')
    const formatAction = (type: string) => type
    const Parent = defineComponent({
      setup: () => () =>
        h('div', { 'data-tick': tick.value }, [
          h(MatchTracker, {
            mode: 'live',
            layersStorageKey: null,
            teams: { home: { name: home.value, color: '#ff0000' }, away: { name: 'PSV' } },
            colors: { official: { fill: '#000' } },
            text: { layers: { goal: { label: 'Goals' } } },
            formatAction,
          }),
        ]),
    })
    const wrapper = mount(Parent, { attachTo: document.body })
    wrappers.push(wrapper)
    const setOptions = vi.spyOn(last().tracker, 'setOptions')
    tick.value++
    await nextTick()
    tick.value++
    await nextTick()
    expect(wrapper.element.getAttribute('data-tick')).toBe('2')
    expect(setOptions).not.toHaveBeenCalled()
    home.value = 'Feyenoord'
    await nextTick()
    expect(setOptions).toHaveBeenCalledTimes(1)
    expect(setOptions.mock.calls[0]![0]).toEqual({
      teams: { home: { name: 'Feyenoord', color: '#ff0000' }, away: { name: 'PSV' } },
    })
  })

  it('takes an in-place change to an object it has sent before, each time', async () => {
    const layers = reactive({ ballTrail: true })
    const Parent = defineComponent({
      setup: () => () => h(MatchTracker, { mode: 'live', layersStorageKey: null, layers }),
    })
    const wrapper = mount(Parent, { attachTo: document.body })
    wrappers.push(wrapper)
    const setOptions = vi.spyOn(last().tracker, 'setOptions')
    layers.ballTrail = false
    await nextTick()
    layers.ballTrail = true
    await nextTick()
    expect(setOptions.mock.calls.map(([options]) => options)).toEqual([
      { layers: { ballTrail: false } },
      { layers: { ballTrail: true } },
    ])
  })

  it('keeps the layer chosen in the menu when another prop changes', async () => {
    const { wrapper, host } = mountTracker({ layers: { ballTrail: true } })
    const layers: unknown[] = []
    last().tracker.on('layers', (value) => layers.push(value))
    host.shadowRoot!.querySelector<HTMLButtonElement>('.mt-layers-toggle')!.click()
    host.shadowRoot!.querySelector<HTMLButtonElement>('[data-layer="ballTrail"]')!.click()
    expect(layers.at(-1)).toMatchObject({ ballTrail: false })
    await wrapper.setProps({ locale: 'zh' })
    const item = host.shadowRoot!.querySelector<HTMLButtonElement>('[data-layer="ballTrail"]')!
    expect(item.getAttribute('aria-pressed')).toBe('false')
  })

  it('leaves the layers menu on when the layersMenu prop is left out, and hides it when false', async () => {
    const { wrapper, host } = mountTracker()
    expect(last().options).not.toHaveProperty('layersMenu')
    expect(host.shadowRoot!.querySelector('.mt-layers-toggle')).not.toBeNull()
    await wrapper.setProps({ layersMenu: false })
    expect(host.shadowRoot!.querySelector('.mt-layers-toggle')).toBeNull()
  })

  it('makes a new tracker when the mode changes, as the mode is fixed at mount', async () => {
    const { wrapper } = mountTracker()
    const first = last().tracker
    const destroy = vi.spyOn(first, 'destroy')
    await wrapper.setProps({ mode: 'replay' })
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(made).toHaveLength(2)
    expect(last().options.mode).toBe('replay')
  })

  it('destroys the tracker on unmount', () => {
    const { wrapper } = mountTracker()
    const destroy = vi.spyOn(last().tracker, 'destroy')
    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(env.queued()).toBe(0)
  })

  it('passes a push through the ref to the tracker, and draws it', () => {
    const { host, handle } = mountTracker()
    const push = vi.spyOn(last().tracker, 'push')
    handle.push(message(0))
    expect(push).toHaveBeenCalledWith(message(0))
    env.settle()
    expect(env.draws(host)).toBeGreaterThan(0)
  })

  it('delivers all of 20 pushes made in one tick', () => {
    const { handle } = mountTracker()
    const push = vi.spyOn(last().tracker, 'push')
    const messages = Array.from({ length: 20 }, (_, i) => message(i))
    for (const m of messages) handle.push(m)
    expect(push.mock.calls.map(([m]) => m)).toEqual(messages)
  })

  it('exposes present, reset, trigger and the overlay', () => {
    const { handle } = mountTracker({ mode: 'replay' })
    const { tracker } = last()
    const present = vi.spyOn(tracker, 'present')
    const reset = vi.spyOn(tracker, 'reset')
    const trigger = vi.spyOn(tracker, 'trigger')
    const state = { time: 0, playing: false, record: null, lookback: [] }
    handle.present(state)
    handle.reset()
    expect(handle.trigger('goal')).toBe(false)
    handle.trigger('attack', 1)
    expect(present).toHaveBeenCalledWith(state)
    expect(reset).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveBeenLastCalledWith('attack', 1)
    expect(handle.overlay).toBe(tracker.overlay)
  })

  it('emits the tracker’s zoom, layers and moment events', async () => {
    const zoom: unknown[] = []
    const layers: unknown[] = []
    const moment: unknown[] = []
    const { host, handle } = mountTracker({
      onZoom: (v: unknown) => zoom.push(v),
      onLayers: (v: unknown) => layers.push(v),
      onMoment: (v: unknown) => moment.push(v),
    })
    handle.push(message(0, { withBall: true }))
    env.settle()
    expect(handle.trigger('goal')).toBe(true)
    env.settle()
    expect(moment).toContainEqual({ moment: 'goal', phase: 'start' })
    expect(moment).toContainEqual({ moment: 'goal', phase: 'end' })
    expect(zoom.length).toBeGreaterThan(0)
    host.shadowRoot!.querySelector<HTMLButtonElement>('.mt-layers-toggle')!.click()
    host.shadowRoot!.querySelector<HTMLButtonElement>('[data-layer="ballTrail"]')!.click()
    expect(layers).toHaveLength(1)
  })

  it('hands secondHalfFrom over, null too, and emits the secondHalf event', async () => {
    const heard: unknown[] = []
    const { wrapper, handle } = mountTracker({ secondHalfFrom: 2700, onSecondHalf: (v: unknown) => heard.push(v) })
    expect(last().options.secondHalfFrom).toBe(2700)
    const setOptions = vi.spyOn(last().tracker, 'setOptions')
    await wrapper.setProps({ secondHalfFrom: null })
    expect(setOptions).toHaveBeenCalledWith({ secondHalfFrom: null })
    const parsed = JSON.parse(message(0)) as { timestamp: number; match: { state?: unknown } }
    parsed.match.state = { actions: [{ action_type: 'End FirstHalf', action_origin: 'human' }] }
    handle.push(JSON.stringify(parsed))
    env.settle()
    expect(heard).toEqual([{ from: parsed.timestamp }])
  })

  it('emits the flashback event', () => {
    const heard: unknown[] = []
    const { handle } = mountTracker({ onFlashback: (v: unknown) => heard.push(v) })
    const push = (i: number, invalid: boolean, labels?: string[]) => {
      const parsed = JSON.parse(message(i, { withBall: true, t: 2700 + i * 0.04 })) as {
        match: { state?: unknown }
        raw_data?: unknown
      }
      if (labels) parsed.match.state = { actions: labels.map((action_type) => ({ action_type, action_origin: 'human' })) }
      parsed.raw_data = {
        source_frame: { frame_state: invalid ? 'invalid' : 'valid' },
        agentic: {
          lookahead: { horizon_s: 9.999999999990905, next_invalid_in_s: invalid ? 0 : null, next_valid_in_s: invalid ? null : 0 },
        },
      }
      handle.push(JSON.stringify(parsed))
      env.frame(40)
    }
    // A human goal, then a long run of invalid frames: the goal is replayed, and live play takes over.
    for (let i = 0; i < 500; i++) push(i, false, i === 100 ? ['goal'] : undefined)
    for (let i = 500; i < 525; i++) push(i, true)
    push(525, false)
    expect(heard).toEqual([
      { phase: 'start', at: 2704 },
      { phase: 'end', at: 2704 },
    ])
  })

  it('does nothing through the ref before mount or after unmount', () => {
    const handle = ref<MatchTrackerHandle | null>(null)
    const Parent = defineComponent({
      setup: () => () => h(MatchTracker, { mode: 'live', layersStorageKey: null, ref: handle }),
    })
    const wrapper = mount(Parent, { attachTo: document.body })
    const exposed = handle.value!
    wrapper.unmount()
    expect(() => exposed.push(message(0))).not.toThrow()
    expect(exposed.trigger('goal')).toBe(false)
    expect(exposed.overlay).toBeNull()
  })

  it('names the tracker instance MatchTrackerInstance from both entries, as the component takes MatchTracker in /vue', () => {
    expectTypeOf<MatchTrackerInstance>().toEqualTypeOf<Tracker>()
    expectTypeOf<VueInstance>().toEqualTypeOf<Tracker>()
    mountTracker()
    const instance: VueInstance = last().tracker
    expect(instance.version).toBe(last().tracker.version)
  })
})

describe('the Vue component over the pitch', () => {
  it('renders its default slot into the tracker’s overlay', async () => {
    const wrapper = mount(MatchTracker, {
      props: { mode: 'live', layersStorageKey: null },
      slots: { default: () => h('div', { class: 'drawing absolute inset-0' }, 'drawn') },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await nextTick()
    const { tracker, host } = last()
    const drawing = host.querySelector('.drawing')
    expect(drawing?.parentElement).toBe(tracker.overlay)
    expect(drawing?.textContent).toBe('drawn')
    expect(tracker.overlay.parentElement).toBe(host)
    const slot = host.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="overlay"]')!
    expect(slot.assignedElements()).toEqual([tracker.overlay])
  })

  it('keeps the slot reactive, and moves it to the new overlay when the mode changes', async () => {
    const label = ref('one')
    const mode = ref<'live' | 'replay'>('live')
    const Parent = defineComponent({
      setup: () => () =>
        h(MatchTracker, { mode: mode.value, layersStorageKey: null }, { default: () => h('span', { class: 'badge' }, label.value) }),
    })
    const wrapper = mount(Parent, { attachTo: document.body })
    wrappers.push(wrapper)
    await nextTick()
    const host = wrapper.element as HTMLElement
    expect(host.querySelector('.badge')?.parentElement).toBe(last().tracker.overlay)
    label.value = 'two'
    await nextTick()
    expect(host.querySelector('.badge')?.textContent).toBe('two')

    const first = last().tracker
    mode.value = 'replay'
    await nextTick()
    await nextTick()
    expect(made).toHaveLength(2)
    const second = last().tracker
    expect(first.overlay.isConnected).toBe(false)
    expect(host.querySelectorAll('.badge')).toHaveLength(1)
    expect(host.querySelector('.badge')?.parentElement).toBe(second.overlay)
    expect([...host.children]).toEqual([second.overlay])
  })

  it('takes the slot away with the tracker on unmount', async () => {
    const wrapper = mount(MatchTracker, {
      props: { mode: 'live', layersStorageKey: null },
      slots: { default: () => h('div', { class: 'drawing' }) },
      attachTo: document.body,
    })
    await nextTick()
    const host = wrapper.element as HTMLElement
    wrapper.unmount()
    expect(host.querySelector('.drawing')).toBeNull()
    expect(host.children).toHaveLength(0)
  })

  it('exposes the box and the availability, and emits both as they change', async () => {
    const boxes: unknown[] = []
    const availability: unknown[] = []
    const { handle } = mountTracker({
      onBox: (v: unknown) => boxes.push(v),
      onAvailability: (v: unknown) => availability.push(v),
    })
    const { tracker } = last()
    expect(handle.box).toEqual(tracker.box)
    expect(handle.box).toMatchObject({ width: 728, height: 410 })
    expect(boxes).toEqual([tracker.box])
    expect(handle.availability()).toEqual(tracker.availability())
    expect(handle.availability().goal).toBe(false)

    handle.push(message(0, { withBall: true }))
    env.settle()
    expect(handle.availability().goal).toBe(true)
    expect(availability.at(-1)).toEqual(tracker.availability())
  })

  it('makes a template that reads the box and the availability render again', async () => {
    const handle = ref<MatchTrackerHandle | null>(null)
    const Parent = defineComponent({
      setup: () => () =>
        h('div', [
          h(MatchTracker, { mode: 'live', layersStorageKey: null, ref: handle }),
          h('p', { class: 'width' }, String(handle.value?.box?.width ?? 'none')),
          h('p', { class: 'goal' }, String(handle.value?.availability().goal ?? 'none')),
        ]),
    })
    const wrapper = mount(Parent, { attachTo: document.body })
    wrappers.push(wrapper)
    await nextTick()
    expect(wrapper.find('.width').text()).toBe('none')
    expect(wrapper.find('.goal').text()).toBe('false')
    const host = wrapper.element.firstElementChild as HTMLElement
    env.resize(host, 800, 450)
    await nextTick()
    expect(wrapper.find('.width').text()).toBe('728')
    handle.value!.push(message(0, { withBall: true }))
    env.settle()
    await nextTick()
    expect(wrapper.find('.goal').text()).toBe('true')
  })

  it('has no box and nothing available before mount and after unmount', () => {
    const handle = ref<MatchTrackerHandle | null>(null)
    const Parent = defineComponent({
      setup: () => () => h(MatchTracker, { mode: 'live', layersStorageKey: null, ref: handle }),
    })
    const wrapper = mount(Parent, { attachTo: document.body })
    const exposed = handle.value!
    wrapper.unmount()
    expect(exposed.box).toBeNull()
    expect(exposed.availability()).toEqual({
      goal: false,
      attack: { 0: false, 1: false },
      corner: false,
      freeKick: false,
      throwIn: false,
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
    })
  })
})
