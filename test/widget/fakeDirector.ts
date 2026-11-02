/**
 * A stand-in for the Director while its goal is still idle (Task 8 fills
 * it): a goal that plays for GOAL_MS once triggered, with the reference's
 * stop rules, so the widget's wiring around a running moment can be tested.
 *
 *  - A step of the clock that is not playback stops it, painting the record
 *    on screen before the step, as the director's playback watcher does.
 *  - A pause stops it.
 *  - stopAll stops it.
 *  - Each update steps it: its first frame starts its clock, and it paints
 *    every frame until GOAL_MS have gone, then stops, which paints.
 *  - While it plays it drives the camera.
 *
 * Records paint when they change, as the frame watcher does. Nothing else of
 * the director is modelled. Every test file that uses it mocks
 * src/director/director with `switchable`, and turns it on with
 * `control.fake = true`.
 */
import type {
  Director,
  DirectorCamera,
  DirectorInput,
  DirectorOptions,
  DirectorOutput,
  DirectorView,
} from '../../src/director/director'
import type { ReplayLayers, ReplayMoment } from '../../src/model/replayLayers'
import type { TrackerRecord } from '../../src/model/types'
import type { TeamId } from '../../src/analysis/teamPhase'
import type { FrameLayers } from '../../src/render/renderer'

export const GOAL_MS = 3000
export const GOAL_CAMERA: DirectorCamera = { zoom: 2, panX: 40, panY: -10 }

/** What the tests switch, and what they read back. */
export const control = {
  /** Make the next tracker's director a FakeGoalDirector rather than the real one. */
  fake: false,
  /** The options every director was made with, real or fake, in order. */
  options: [] as DirectorOptions[],
  /** Every update input, in order, real or fake. */
  inputs: [] as DirectorInput[],
  /** How many times stopAll was called. */
  stopAll: 0,
  reset() {
    control.fake = false
    control.options = []
    control.inputs = []
    control.stopAll = 0
  },
}

export class FakeGoalDirector {
  private layers: ReplayLayers
  private seen: { time: number; playing: boolean; record: TrackerRecord | null } = {
    time: 0,
    playing: false,
    record: null,
  }
  private shown: TrackerRecord | null = null
  private goal: { startedMs: number | null } | null = null
  private painted: FrameLayers | null = null
  private paints: FrameLayers[] = []

  constructor(options: DirectorOptions) {
    this.layers = { ...options.layers }
  }

  update(input: DirectorInput, _view: DirectorView): DirectorOutput {
    control.inputs.push(input)
    this.paints = []
    const before = this.seen
    this.seen = { time: input.time, playing: input.playing, record: input.record }
    if (input.time !== before.time && !input.playback) this.stopGoal()
    this.shown = input.record
    if (before.playing && !input.playing) this.stopGoal()
    if (input.record && input.record !== before.record) this.paint()
    if (this.goal) {
      this.goal.startedMs ??= input.nowMs
      if (input.nowMs - this.goal.startedMs >= GOAL_MS) this.stopGoal()
      else this.paint()
    }
    return this.output()
  }

  trigger(moment: ReplayMoment, _team: TeamId, input: DirectorInput, _view: DirectorView): DirectorOutput | null {
    this.paints = []
    if (!input.record) return null
    if (moment === 'goal') {
      this.goal = { startedMs: null }
      this.paint()
    }
    return this.output()
  }

  stopAll(): DirectorOutput {
    control.stopAll++
    this.paints = []
    this.stopGoal()
    return this.output()
  }

  setLayers(layers: ReplayLayers): DirectorOutput {
    this.paints = []
    this.layers = { ...layers }
    if (!layers.goal) this.stopGoal()
    this.paint()
    return this.output()
  }

  setOptions(): void {}

  releaseCamera(): void {}

  reset(): void {
    this.goal = null
    this.seen = { time: 0, playing: false, record: null }
    this.shown = null
    this.painted = null
    this.paints = []
  }

  private stopGoal(): void {
    if (!this.goal) return
    this.goal = null
    this.paint()
  }

  private paint(): void {
    if (!this.shown) return
    const layers: FrameLayers = {
      goal: this.goal ? { ball: { x: 0, y: 0 }, trail: [], net: { side: 1, y: 0, metres: 0 } } : undefined,
      fadeFar: this.layers.farFade,
    }
    this.painted = layers
    this.paints.push(layers)
  }

  private output(): DirectorOutput {
    return {
      layers: this.painted,
      paint: this.paints.length > 0,
      paints: this.paints,
      camera: this.goal ? GOAL_CAMERA : null,
      animating: this.goal !== null,
    }
  }
}

/**
 * A Director constructor that makes the real one, or the fake while
 * `control.fake` is on, and notes the options and update inputs of either.
 */
export function switchable(Real: typeof Director): typeof Director {
  function Switchable(options: DirectorOptions) {
    control.options.push(options)
    if (control.fake) return new FakeGoalDirector(options)
    const real = new Real(options)
    const update = real.update.bind(real)
    real.update = (input, view) => {
      control.inputs.push(input)
      return update(input, view)
    }
    const stopAll = real.stopAll.bind(real)
    real.stopAll = () => {
      control.stopAll++
      return stopAll()
    }
    return real
  }
  return Switchable as unknown as typeof Director
}
