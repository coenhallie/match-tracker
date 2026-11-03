/**
 * `@coenhallie/match-tracker/vue`: the tracker as a Vue 3 component, one to
 * one over createMatchTracker. Only this entry imports Vue; the
 * framework-free entry never does.
 *
 * ```vue
 * <MatchTracker ref="tracker" mode="live" :locale="locale" :teams="teams" style="height: 360px" />
 * ```
 *
 * - The component renders one `div`, the tracker's host. The tracker fills
 *   it, so give it a size (a class or style on the component lands on it).
 * - The default slot is rendered into the tracker's overlay (a Teleport), so
 *   its content lies over the pitch, in the canvas's box, styled by the
 *   page's CSS and the parent's scoped styles.
 * - `mode` is fixed for a tracker's life: changing it makes a new tracker,
 *   so the exposed `overlay` is then a new element, and the slot's content
 *   moves into it. `layersStorageKey` is fixed at mount too, and a change to
 *   it is ignored.
 * - Every other prop is a `MatchTrackerOptions` field. A change, in place or
 *   not, goes to `setOptions` with that one field, so a change to one prop
 *   never takes back what another set, nor the layers chosen in the menu.
 *   A prop is compared by what it holds, not by identity: a parent that
 *   renders an inline object again (`:layers="{ ballTrail: true }"`) has
 *   changed nothing, and setOptions is not called. The tracker is given a
 *   copy of each, never the parent's reactive object.
 * - The tracker's `zoom`, `layers`, `moment`, `box` and `availability`
 *   events are emitted as they are. `box` and `availability` are also
 *   emitted when a new tracker starts with values other than the last ones
 *   emitted, so a parent hears of the box the tracker measured at mount.
 * - `push`, `present`, `reset`, `trigger`, `availability`, `overlay` and
 *   `box` are exposed on the component's ref (see MatchTrackerHandle).
 *   `box` and `availability()` are reactive: a template or computed that
 *   reads them follows them. Before mount and after unmount they do nothing,
 *   `trigger` returns false, `overlay` and `box` are null, and nothing is
 *   available.
 */
import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  Teleport,
  toRaw,
  watch,
  type PropType,
} from 'vue'
import {
  createMatchTracker,
  type MatchTracker as Tracker,
  type MatchTrackerOptions,
  type MomentAvailability,
  type ReplayMoment,
  type ReplayState,
  type TeamId,
  type TrackerBox,
  type TrackerEvents,
} from './index.js'

// Every type of the main entry but `MatchTracker`, which here is the
// component: the tracker instance is `MatchTrackerInstance` in both.
export type * from './index.js'
// The console banner, the main entry's own, so one guard holds for both entries.
export { logMatchTrackerBanner, matchTrackerBanner } from './index.js'

/** What the component's ref exposes: the tracker's input, and its overlay and box once mounted. */
export interface MatchTrackerHandle {
  push(message: unknown): void
  present(state: ReplayState): void
  reset(): void
  trigger(moment: ReplayMoment, team?: TeamId): boolean
  /** Which moments `trigger` can play now; nothing while there is no tracker. Reactive. */
  availability(): MomentAvailability
  /** The tracker's overlay element, or null while there is no tracker. */
  readonly overlay: HTMLElement | null
  /** The pitch's box from the host's top-left corner, or null while there is none. Reactive. */
  readonly box: TrackerBox | null
}

const NOTHING_AVAILABLE: MomentAvailability = {
  goal: false,
  attack: { 0: false, 1: false },
  corner: false,
  throwIn: false,
}

const sameBox = (a: TrackerBox | null, b: TrackerBox | null) =>
  a === b ||
  (a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)

type OptionKey = Exclude<keyof MatchTrackerOptions, 'mode'>

type Prop<K extends OptionKey> = PropType<NonNullable<MatchTrackerOptions[K]>>

/**
 * Every option but the mode, each a prop of its own. An option added to
 * MatchTrackerOptions without a prop here fails to compile.
 */
const optionProps = {
  locale: { type: String as Prop<'locale'>, default: undefined },
  text: { type: Object as Prop<'text'>, default: undefined },
  teams: { type: Object as Prop<'teams'>, default: undefined },
  colors: { type: Object as Prop<'colors'>, default: undefined },
  layers: { type: Object as Prop<'layers'>, default: undefined },
  // `default: undefined`, or Vue would take a left-out Boolean prop as false and hide the menu.
  layersMenu: { type: Boolean, default: undefined },
  debug: { type: Boolean, default: undefined },
  /** null keeps nothing; left out, the default key. */
  layersStorageKey: { type: String as PropType<string | null>, default: undefined },
  formatAction: { type: Function as Prop<'formatAction'>, default: undefined },
} satisfies Record<OptionKey, unknown>

const OPTION_KEYS = Object.keys(optionProps) as OptionKey[]

const isPlain = (value: unknown): value is Record<string, unknown> | unknown[] => {
  if (Array.isArray(value)) return true
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** A prop as it is now, out of Vue's reactivity: plain objects and arrays copied all the way down, anything else as it is. */
function snapshot(value: unknown): unknown {
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(snapshot)
  if (!isPlain(raw)) return raw
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(raw)) out[key] = snapshot(inner)
  return out
}

/** Whether two snapshots hold the same: plain objects and arrays by what they hold, anything else (a function) by identity. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!isPlain(a) || !isPlain(b) || Array.isArray(a) !== Array.isArray(b)) return false
  const [x, y] = [a as Record<string, unknown>, b as Record<string, unknown>]
  const keys = Object.keys(x)
  if (keys.length !== Object.keys(y).length) return false
  return keys.every((key) => Object.hasOwn(y, key) && same(x[key], y[key]))
}

export const MatchTracker = defineComponent({
  name: 'MatchTracker',
  props: {
    mode: { type: String as PropType<MatchTrackerOptions['mode']>, required: true },
    ...optionProps,
  },
  emits: {
    zoom: (_value: TrackerEvents['zoom']) => true,
    layers: (_value: TrackerEvents['layers']) => true,
    moment: (_value: TrackerEvents['moment']) => true,
    box: (_value: TrackerEvents['box']) => true,
    availability: (_value: TrackerEvents['availability']) => true,
  },
  setup(props, { emit, expose, slots }) {
    const host = ref<HTMLElement | null>(null)
    let tracker: Tracker | null = null
    /** The tracker's overlay, where the default slot is teleported, and its box and availability, for the ref. */
    const overlay = shallowRef<HTMLElement | null>(null)
    const box = shallowRef<TrackerBox | null>(null)
    const availability = shallowRef<MomentAvailability>(NOTHING_AVAILABLE)
    /** What was last emitted, so a new tracker with the same box or availability says nothing. */
    let emittedBox: TrackerBox | null = null
    let emittedAvailability: MomentAvailability = NOTHING_AVAILABLE

    function takeBox(value: TrackerBox | null): void {
      box.value = value
      if (value === null || sameBox(value, emittedBox)) return
      emittedBox = value
      emit('box', value)
    }

    function takeAvailability(value: MomentAvailability): void {
      availability.value = value
      const was = emittedAvailability
      if (
        value.goal === was.goal &&
        value.attack[0] === was.attack[0] &&
        value.attack[1] === was.attack[1] &&
        value.corner === was.corner &&
        value.throwIn === was.throwIn
      ) {
        return
      }
      emittedAvailability = value
      emit('availability', value)
    }
    /** What the tracker was last given for each option: what a prop is compared with. */
    let sent: Partial<Record<OptionKey, unknown>> = {}

    function options(): MatchTrackerOptions {
      sent = {}
      for (const key of OPTION_KEYS) sent[key] = snapshot(props[key])
      const out: Partial<Record<OptionKey, unknown>> = {}
      for (const key of OPTION_KEYS) if (sent[key] !== undefined) out[key] = sent[key]
      return { ...(out as Omit<MatchTrackerOptions, 'mode'>), mode: props.mode }
    }

    function start(): void {
      if (!host.value) return
      tracker = createMatchTracker(host.value, options())
      tracker.on('zoom', (value) => emit('zoom', value))
      tracker.on('layers', (value) => emit('layers', value))
      tracker.on('moment', (value) => emit('moment', value))
      tracker.on('box', takeBox)
      tracker.on('availability', takeAvailability)
      overlay.value = tracker.overlay
      takeBox(tracker.box)
      takeAvailability(tracker.availability())
    }

    function stop(): void {
      tracker?.destroy()
      tracker = null
      overlay.value = null
      box.value = null
      availability.value = NOTHING_AVAILABLE
    }

    onMounted(start)
    onBeforeUnmount(stop)

    watch(
      () => props.mode,
      () => {
        stop()
        start()
      },
    )
    // The storage key is fixed at mount, as setOptions has it.
    for (const key of OPTION_KEYS.filter((k) => k !== 'layersStorageKey')) {
      watch(
        () => props[key],
        (value) => {
          if (!tracker) return
          const next = snapshot(value)
          if (same(next, sent[key])) return
          sent[key] = next
          tracker.setOptions({ [key]: next })
        },
        { deep: true },
      )
    }

    const handle: MatchTrackerHandle = {
      push: (message) => tracker?.push(message),
      present: (state) => tracker?.present(state),
      reset: () => tracker?.reset(),
      trigger: (moment, team) => tracker?.trigger(moment, team) ?? false,
      availability: () => {
        const { attack, ...rest } = availability.value
        return { ...rest, attack: { ...attack } }
      },
      get overlay() {
        return tracker?.overlay ?? null
      },
      get box() {
        return box.value
      },
    }
    expose(handle)

    // The default slot goes into the overlay, which the tracker put in the
    // host: Vue owns only the Teleport's anchors among the host's children.
    return () => {
      const target = overlay.value
      const content = slots.default && target ? [h(Teleport, { to: target }, slots.default())] : []
      return h('div', { ref: host }, content)
    }
  },
})
