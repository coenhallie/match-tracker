/**
 * The widget's events, and how it tells a moment starting or ending from the
 * director's paints.
 */
import type { MomentAvailability } from '../director/director.js'
import { LABEL_CARD_KEYS } from '../model/labelCards.js'
import type { ReplayLayers, ReplayMoment } from '../model/replayLayers.js'
import type { FrameLayers } from '../render/renderer.js'

/** Where the pitch is drawn: the canvas's box, in CSS px from the host element's top-left corner. */
export interface TrackerBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface TrackerEvents {
  /** The view's zoom changed: by the user, or by a sequence's camera. */
  zoom: { zoom: number }
  /** The layers in force changed. */
  layers: ReplayLayers
  /** A moment came on screen, or went. */
  moment: { moment: ReplayMoment; phase: 'start' | 'end' }
  /** The pitch's box moved or changed size (`MatchTracker.box`). */
  box: TrackerBox
  /** Which moments can be played on the frame on screen changed (`MatchTracker.availability`). */
  availability: MomentAvailability
}

type Listener<T> = (value: T) => void

export class Emitter<E extends object> {
  private readonly listeners = new Map<keyof E, Set<Listener<never>>>()

  on<K extends keyof E>(event: K, listener: Listener<E[K]>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener<never>)
    return () => {
      set.delete(listener as Listener<never>)
    }
  }

  emit<K extends keyof E>(event: K, value: E[K]): void {
    // A copy: a listener may unsubscribe while this goes through them.
    for (const listener of Array.from(this.listeners.get(event) ?? [])) {
      try {
        ;(listener as Listener<E[K]>)(value)
      } catch (error) {
        // One host listener throwing must not leave the widget half-way through a frame.
        reportError(error)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}

function reportError(error: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error)
  else setTimeout(() => {
    throw error
  })
}

/** In the order the director stops them. */
const MOMENTS: readonly ReplayMoment[] = ['goal', 'attack', 'corner', 'throwIn', ...LABEL_CARD_KEYS]

/**
 * Whether a paint shows `moment`. Each moment's value is drawn from its
 * start to its end (the reference's `xValue()` is defined exactly while its
 * state is), and a stop paints without it, so a paint shows a moment exactly
 * while the moment runs.
 */
function shows(layers: FrameLayers, moment: ReplayMoment): boolean {
  switch (moment) {
    case 'goal':
      return layers.goal !== undefined || layers.goalBanner !== undefined
    case 'attack':
      return layers.attack !== undefined
    case 'corner':
      return layers.corner !== undefined
    case 'throwIn':
      return layers.throwIn !== undefined
    default:
      return layers.labelCard?.key === moment || layers.smallLabelCard?.key === moment
  }
}

/** The moments on screen, from paint to paint: what came on and what went at each. */
export class MomentWatch {
  private readonly showing = new Set<ReplayMoment>()

  /** What `layers` starts and ends, ends first, against the paint before. */
  next(layers: FrameLayers): Array<{ moment: ReplayMoment; phase: 'start' | 'end' }> {
    const changes: Array<{ moment: ReplayMoment; phase: 'start' | 'end' }> = []
    for (const moment of MOMENTS) {
      if (this.showing.has(moment) && !shows(layers, moment)) {
        this.showing.delete(moment)
        changes.push({ moment, phase: 'end' })
      }
    }
    for (const moment of MOMENTS) {
      if (!this.showing.has(moment) && shows(layers, moment)) {
        this.showing.add(moment)
        changes.push({ moment, phase: 'start' })
      }
    }
    return changes
  }

  /** Everything on screen ends, as a reset stops every moment without a paint. */
  clear(): Array<{ moment: ReplayMoment; phase: 'end' }> {
    const ended = MOMENTS.filter((m) => this.showing.has(m)).map((moment) => ({ moment, phase: 'end' as const }))
    this.showing.clear()
    return ended
  }
}
