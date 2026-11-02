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
 * - `mode` is fixed for a tracker's life: changing it makes a new tracker,
 *   so the exposed `overlay` is then a new element.
 * - Every other prop is a `MatchTrackerOptions` field. A change, in place or
 *   not, goes to `setOptions` with that one field, so a change to one prop
 *   never takes back what another set, nor the layers chosen in the menu.
 * - The tracker's `zoom`, `layers` and `moment` events are emitted as they are.
 * - `push`, `present`, `reset`, `trigger` and `overlay` are exposed on the
 *   component's ref (see MatchTrackerHandle). Before mount and after unmount
 *   they do nothing, `trigger` returns false and `overlay` is null.
 */
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import {
  createMatchTracker,
  type MatchTracker as Tracker,
  type MatchTrackerOptions,
  type ReplayMoment,
  type ReplayState,
  type TeamId,
  type TrackerEvents,
} from './index.js'

export type * from './index.js'

/** What the component's ref exposes: the tracker's input, and its overlay once mounted. */
export interface MatchTrackerHandle {
  push(message: unknown): void
  present(state: ReplayState): void
  reset(): void
  trigger(moment: ReplayMoment, team?: TeamId): boolean
  /** The tracker's overlay element, or null while there is no tracker. */
  readonly overlay: HTMLElement | null
}

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
  /** null keeps nothing; left out, the default key. */
  layersStorageKey: { type: String as PropType<string | null>, default: undefined },
  formatAction: { type: Function as Prop<'formatAction'>, default: undefined },
} satisfies Record<OptionKey, unknown>

const OPTION_KEYS = Object.keys(optionProps) as OptionKey[]

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
  },
  setup(props, { emit, expose }) {
    const host = ref<HTMLElement | null>(null)
    let tracker: Tracker | null = null

    function options(): MatchTrackerOptions {
      const out: Partial<Record<OptionKey, unknown>> = {}
      for (const key of OPTION_KEYS) if (props[key] !== undefined) out[key] = props[key]
      return { ...(out as Omit<MatchTrackerOptions, 'mode'>), mode: props.mode }
    }

    function start(): void {
      if (!host.value) return
      tracker = createMatchTracker(host.value, options())
      tracker.on('zoom', (value) => emit('zoom', value))
      tracker.on('layers', (value) => emit('layers', value))
      tracker.on('moment', (value) => emit('moment', value))
    }

    function stop(): void {
      tracker?.destroy()
      tracker = null
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
    for (const key of OPTION_KEYS) {
      watch(
        () => props[key],
        (value) => tracker?.setOptions({ [key]: value }),
        { deep: true },
      )
    }

    const handle: MatchTrackerHandle = {
      push: (message) => tracker?.push(message),
      present: (state) => tracker?.present(state),
      reset: () => tracker?.reset(),
      trigger: (moment, team) => tracker?.trigger(moment, team) ?? false,
      get overlay() {
        return tracker?.overlay ?? null
      },
    }
    expose(handle)

    return () => h('div', { ref: host })
  },
})
