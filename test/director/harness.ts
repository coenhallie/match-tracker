import type { BallTrail } from '../../src/analysis/ballTrail'
import type { TeamId, TeamPhase } from '../../src/analysis/teamPhase'
import {
  Director,
  type DirectorInput,
  type DirectorOptions,
  type DirectorOutput,
  type DirectorView,
} from '../../src/director/director'
import { nextPlayback } from '../../src/director/playback'
import { DEFAULT_REPLAY_LAYERS, type ReplayLayers, type ReplayMoment } from '../../src/model/replayLayers'
import type { Frame, TrackerRecord } from '../../src/model/types'
import type { FrameLayers } from '../../src/render/renderer'

/** The view every test draws in: the reference's frame box, not zoomed. */
export const VIEW: DirectorView = { zoom: 1, panX: 0, panY: 0, renderedWidth: 1280 }

/** One animation frame, as the reference tests run them: 60 a second. */
const FRAME_MS = 1000 / 60

interface ReplayState {
  time: number
  playing: boolean
  record: TrackerRecord | null
  phase: TeamPhase | null
  trail: BallTrail | null
}

export interface Change {
  time?: number
  playing?: boolean
  frame?: Frame | null
  phase?: TeamPhase | null
  trail?: BallTrail | null
}

/**
 * A replay made of plain state driving a Director, like the reference test's
 * fake replay (pipelineOutputSurface.test.ts) drives the surface: the test
 * sets the clock, the frame, the phase or the trail, and the director sees
 * them all at once, as the surface's watchers see a tick's refs at the next
 * flush. Each `set` is one flush, and so one `update`.
 *
 * Each frame set is wrapped in a record of its own, so the record changes
 * identity on every set, as the reference's `frameWith` hands out a new
 * object each time. The playback flag is worked out as the widget will,
 * with nextPlayback.
 *
 * As in the reference tests, a `set` is not an animation frame: the clock
 * of the frames moves only in `animate`, and the moments step only there.
 */
export class FakeReplay {
  readonly director: Director
  /** Every output, in order. */
  readonly outputs: DirectorOutput[] = []
  reducedMotion = false
  private state: ReplayState = { time: 0, playing: false, record: null, phase: null, trail: null }
  private flag: { time: number; playback: boolean } | null = null
  private nowMs = 1000
  private frameCount = 0

  private layers: ReplayLayers

  constructor(layers: Partial<ReplayLayers> = {}, options: Partial<DirectorOptions> = {}) {
    this.layers = { ...DEFAULT_REPLAY_LAYERS, ...layers }
    this.director = new Director({
      layers: this.layers,
      reducedMotion: () => this.reducedMotion,
      teamName: (team) => (team === 0 ? 'Red' : 'Blue'),
      teamColor: (team) => (team === 0 ? '#e51a1a' : '#184fe7'),
      ...options,
    })
  }

  get time(): number {
    return this.state.time
  }

  /** Change what the replay holds, then let the director see it all at once. */
  set(change: Change): DirectorOutput {
    const next = { ...this.state }
    if (change.time !== undefined) next.time = change.time
    if (change.playing !== undefined) next.playing = change.playing
    if (change.phase !== undefined) next.phase = change.phase
    if (change.trail !== undefined) next.trail = change.trail
    if (change.frame !== undefined) {
      next.record = change.frame && { t: next.time, frameCount: ++this.frameCount, frame: change.frame }
    }
    this.state = next
    const playback = nextPlayback(this.flag, next.time, next.playing)
    this.flag = { time: next.time, playback }
    return this.push(this.director.update(this.input(playback), VIEW))
  }

  /**
   * Run animation frames for `ms`, as the reference tests' `animate` does:
   * 60 a second from where the last left off. `whole` is the free kick,
   * throw-in and by-hand blocks' loop, which stops a hair short of `ms` so a
   * duration is a whole number of frames however it rounds.
   */
  animate(ms: number, whole = false): DirectorOutput[] {
    const end = this.nowMs + ms
    const outputs: DirectorOutput[] = []
    while (whole ? this.nowMs < end - 1e-6 : this.nowMs < end) {
      this.nowMs += FRAME_MS
      outputs.push(this.push(this.director.update(this.input(), VIEW)))
    }
    return outputs
  }

  /** Play `moment` by hand, as the demo controls do. */
  trigger(moment: ReplayMoment, team: TeamId = 0): DirectorOutput | null {
    const output = this.director.trigger(moment, team, this.input(), VIEW)
    if (output) this.outputs.push(output)
    return output
  }

  /**
   * One wheel notch in over the middle of the stage, as the reference's
   * handler makes it (:307-341): the view handed to the user, then zoomed
   * about the middle, which scales the pan with the zoom.
   */
  wheel(): DirectorOutput {
    this.director.releaseCamera()
    const view = this.director.view
    const zoom = Math.min(6, view.zoom + 0.15)
    const scale = zoom / view.zoom
    return this.push(this.director.setView({ ...view, zoom, panX: view.panX * scale, panY: view.panY * scale }))
  }

  /** Someone presses on the drawing layer (`:1471`). */
  stopAll(): DirectorOutput {
    return this.push(this.director.stopAll())
  }

  private push(output: DirectorOutput): DirectorOutput {
    this.outputs.push(output)
    return output
  }

  /** The input the director was last given, as a caller would hand it to trigger. */
  input(playback = this.flag?.playback ?? false): DirectorInput {
    return { nowMs: this.nowMs, ...this.state, playback }
  }

  /** The replay ready on `frame`, at `time`, paused: what load() leaves. */
  ready(frame: Frame, time = 10, extra: Omit<Change, 'frame' | 'time'> = {}): DirectorOutput {
    return this.set({ time, frame, ...extra })
  }

  /** One step of the clock, `by` seconds on, showing a fresh record. */
  step(frame: Frame, by = 0.04): DirectorOutput {
    return this.set({ time: this.state.time + by, frame })
  }

  /** The clock alone moves on, as it does between records. */
  advance(by: number): DirectorOutput {
    return this.set({ time: this.state.time + by })
  }

  play(): DirectorOutput {
    return this.set({ playing: true })
  }

  pause(): DirectorOutput {
    return this.set({ playing: false })
  }

  /** Switch layers, as the layers menu does. */
  toggle(change: Partial<ReplayLayers>): DirectorOutput {
    this.layers = { ...this.layers, ...change }
    return this.push(this.director.setLayers(this.layers))
  }

  /** The view the renderer was last given, as the reference tests read `setView.mock.calls.at(-1)`. */
  lastView(): DirectorView | undefined {
    for (let i = this.outputs.length - 1; i >= 0; i--) {
      const paint = this.outputs[i]!.paints.at(-1)
      if (paint) return paint.view
    }
    return undefined
  }

  /** What was last drawn, as the reference tests read `renderFrame.mock.calls.at(-1)`. */
  last(): FrameLayers | undefined {
    return this.outputs.at(-1)?.layers ?? undefined
  }

  /** How many paints there have been, as the reference tests count `renderFrame` calls. */
  paintCount(): number {
    return this.outputs.reduce((n, o) => n + o.paints.length, 0)
  }
}
