/**
 * The flashback in live mode (on screen, "REPLAY"): the clips of live play kept, what is spotted
 * in it, the controller that says when a clip plays, and the second Director that plays it. The
 * widget feeds it every live record (`see`) and steps it on every animation frame (`tick`), and
 * paints what it gives back in place of live play while a clip plays.
 *
 * The clip director is made on the first clip, so a widget that never plays one has one director,
 * as before flashbacks. It never covers invalid frames, nor plays the penalty: the viewer saw that
 * live, and the clip shows the kick as it was played (`flashbackClip`), so a "Penalty scored" plays
 * no goal in it either, unless the penalty's layer is off. It is driven as replay mode drives its
 * director: the clip record at the clip's own clock, playing, with the phase and the trail worked
 * out over the clip's own records. Its records never go through the halves' `see`: `shown` turns
 * them for the second half by their own time, so a clip from the first half shows that half's ends.
 *
 * Its view is its own: its camera (the goal's, the zoom near goal) is never live play's, and live
 * play's is never its. Only the viewer's own zoom and pan go to both (`setView`); a director made
 * later starts from the last of them.
 */
import { deriveAt, phaseAt, windowAt } from '../analysis/derive.js'
import type { BallTrail } from '../analysis/ballTrail.js'
import type { SecondHalf } from '../analysis/secondHalf.js'
import type { TeamPhase } from '../analysis/teamPhase.js'
import {
  Director,
  type DirectorCamera,
  type DirectorOptions,
  type DirectorOutput,
  type DirectorView,
} from '../director/director.js'
import { Flashback, type FlashbackFrame, type FlashbackLive, type FlashbackShot } from '../director/flashback.js'
import { FlashbackSpotter } from '../director/flashbackSpotter.js'
import { ClipStore } from '../history/clipStore.js'
import type { ReplayLayers } from '../model/replayLayers.js'
import type { RecordValidity, TrackerRecord } from '../model/types.js'
import { flashbackSide, type FlashbackIndicator } from '../render/flashback.js'
import type { FlashbackDebug } from './hud.js'

/** What one animation frame of the stage gives the widget. */
export interface FlashbackTick {
  /** The clip director's output while a clip plays, to paint in place of live play's; null otherwise. */
  out: DirectorOutput | null
  /** The stroke and tab to draw over whatever is painted, or null while there are none. */
  indicator: FlashbackIndicator | null
  /** The clip's phase while a clip plays, for the row above the pitch; null otherwise. */
  phase: TeamPhase | null
  events: FlashbackFrame['events']
}

const WHOLE_PITCH: DirectorCamera = { zoom: 1, panX: 0, panY: 0 }

const cameraOf = (view: DirectorCamera): DirectorCamera => ({ zoom: view.zoom, panX: view.panX, panY: view.panY })

export class FlashbackStage {
  private readonly store = new ClipStore()
  private readonly spotter = new FlashbackSpotter()
  private readonly controller: Flashback
  private director: Director | null = null
  /** The viewer's own last zoom and pan, which a clip director made later starts from. */
  private viewer: DirectorCamera = WHOLE_PITCH
  /** The shot of the last step, while it plays. */
  private shot: FlashbackShot | null = null
  /** The phase and trail of the record a shot shows, worked out once for it. */
  private derived: { record: TrackerRecord; from: number | null; phase: TeamPhase; trail: BallTrail | null } | null =
    null
  /** Where the tab sat, and how much of the clip was left, as the last clip played: kept while it fades out. */
  private side: FlashbackIndicator['side'] = 'left'
  private leftShare = 0
  private agoS: number | null = null
  /** The `at` of the replay the host was told started and not yet that it ended. */
  private open: number | null = null

  constructor(private readonly options: () => DirectorOptions) {
    this.controller = new Flashback(this.store, () => this.options().reducedMotion())
  }

  /** Whether a clip is playing, and so is what is painted. */
  get active(): boolean {
    return this.controller.active
  }

  /** Whether the next animation frame has anything to show. */
  get animating(): boolean {
    return this.controller.animating
  }

  /** The clip director's view, or null before it is made. */
  get clipView(): DirectorView | null {
    return this.director?.view ?? null
  }

  /** The `at` of a replay whose `start` the host has had and not its `end`, or null. */
  get openAt(): number | null {
    return this.open
  }

  /**
   * Take in a live record, as it arrives, after the live history took it, with what the live
   * history takes it for (LiveHistory.validityOf).
   */
  see(record: TrackerRecord, state: RecordValidity | null, liveWindow: readonly TrackerRecord[]): void {
    this.store.add(record, state)
    if (state?.invalid) return
    // The live window is already the one at its own last record: at any other, it is made again.
    const window = liveWindow.at(-1) === record ? liveWindow : windowAt(liveWindow, record)
    const phase = phaseAt(window, record)
    const moment = this.spotter.spot(record, phase)
    if (moment) this.store.note(moment)
  }

  /** Forget every clip and all that was spotted, as the layer goes off; a clip playing is cut first. */
  forget(): void {
    this.store.clear()
    this.spotter.reset()
  }

  /** What the clips kept take up, about (ClipStore.bytes). */
  bytes(): number {
    return this.store.bytes()
  }

  /** One animation frame: what to paint, and what to tell the host. */
  tick(nowMs: number, live: FlashbackLive, halves: SecondHalf, renderedWidth: number): FlashbackTick {
    const frame = this.controller.step(nowMs, live)
    for (const event of frame.events) this.open = event.phase === 'start' ? event.at : null
    const started = frame.shot !== null && frame.shot.clip.id !== this.shot?.clip.id
    this.shot = frame.shot
    this.agoS = frame.agoS
    let out: DirectorOutput | null = null
    let phase: TeamPhase | null = null
    if (frame.shot) {
      const shot = frame.shot
      const record = halves.shown(shot.record)
      const derived = this.derive(shot, halves)
      phase = derived.phase
      const director = this.clipDirector()
      // A clip is a seek: it starts from the viewer's own view, never the camera of the clip before.
      if (started) director.setView({ ...this.viewer, renderedWidth })
      const view = { ...cameraOf(director.view), renderedWidth }
      const input = { nowMs, time: shot.time, playing: true, playback: shot.playback, record, phase, trail: derived.trail }
      out = director.update(input, view)
      this.side = flashbackSide(halves.shown(shot.event))
      this.leftShare = shot.leftShare
    }
    return { out, indicator: this.indicator(frame), phase, events: frame.events }
  }

  /** The layers in force, for clips too: the clip director's output, the clip drawn again, once it is made. */
  setLayers(layers: ReplayLayers): DirectorOutput | null {
    return this.director?.setLayers(layers) ?? null
  }

  /** The viewer's own zoom and pan, for clips too. */
  setView(view: DirectorView): DirectorOutput | null {
    this.viewer = cameraOf(view)
    return this.director?.setView(view) ?? null
  }

  /** The frame is drawn at a new width: the clip director's own view, at it. */
  resize(renderedWidth: number): DirectorOutput | null {
    const director = this.director
    return director ? director.setView({ ...cameraOf(director.view), renderedWidth }) : null
  }

  setOptions(options: Partial<Omit<DirectorOptions, 'layers' | 'coverInvalidFrames' | 'flashbackClip'>>): void {
    this.director?.setOptions(options)
  }

  /**
   * End the clip playing at once. With `holdOff`, for someone who wants the live frame, no other
   * starts until the live run ends (Flashback.cut). Its `end` comes with the next tick.
   */
  cut(nowMs: number, holdOff: boolean): void {
    this.controller.cut(nowMs, holdOff)
  }

  /** Forget every clip and all that was spotted, for a reconnect or a new match. Says nothing to the host. */
  reset(): void {
    this.store.clear()
    this.spotter.reset()
    this.controller.reset()
    this.director?.reset()
    this.shot = null
    this.derived = null
    this.agoS = null
    this.open = null
  }

  /** What is playing, and while the run is invalid its countdown, for the debug badge; null while nothing is. */
  debug(): FlashbackDebug | null {
    if (!this.controller.active || !this.shot || this.agoS === null) return null
    const debug: FlashbackDebug = { kind: this.shot.clip.kind, agoS: this.agoS }
    const run = this.controller.run
    if (run?.invalid) {
      debug.validInS = run.nextValidInS
      if (run.horizonS !== undefined) debug.horizonS = run.horizonS
    }
    return debug
  }

  /** The stroke and tab: on every paint of a clip, from its fade's first frame, and over live play while they fade out. */
  private indicator({ shot, alpha }: FlashbackFrame): FlashbackIndicator | null {
    if (!shot && !(alpha > 0)) return null
    return { alpha, side: this.side, agoS: this.agoS, leftShare: this.leftShare }
  }

  /** The phase and trail at the shot's record, over the clip's own records, turned as it is shown. */
  private derive(shot: FlashbackShot, halves: SecondHalf): { phase: TeamPhase; trail: BallTrail | null } {
    const cached = this.derived
    if (cached && cached.record === shot.record && cached.from === halves.from) return cached
    const window = halves.window(windowAt(shot.records, shot.record), shot.record)
    const { phase, trail } = deriveAt(window, halves.shown(shot.record))
    this.derived = { record: shot.record, from: halves.from, phase, trail }
    return this.derived
  }

  private clipDirector(): Director {
    this.director ??= new Director({ ...this.options(), coverInvalidFrames: false, flashbackClip: true })
    return this.director
  }
}
