/**
 * The director: the replay's state machine, taken out of
 * PipelineOutputSurface.vue (video-annotation 6f14d1f) with no framework
 * under it. Given what is on screen, the playback clock and whether play is
 * running, it decides what is drawn over the data: the moments (goal, attack,
 * free kick, throw-in), the rings and the "received" covers, how the ball is
 * turned, and where the view is while a goal moves it. It owns no DOM and no
 * clock; its caller drives it.
 *
 * ## One update is one flush of the reference's watchers
 *
 * The surface reacts to its replay through Vue watchers. `update` runs the
 * same reactions, in the same order, against the input before it:
 *
 *  1. The playback flag (`:562-581`, flush sync). Only when `time` changed:
 *     the flag becomes `input.playback`, and when that is false every moment
 *     stops and the label and ball memory is forgotten. A stop paints, and it
 *     paints with the record, phase and trail of the update before: the
 *     reference's sync watcher runs while the old record is still on screen.
 *  2. Pause (`:583-594`, flush pre). When `playing` went from true to false:
 *     every moment stops, the rings settle, and it paints, with the new record.
 *  3. The view (`:213`, flush post, the first post watcher): when the zoom and
 *     pan moved (a goal's stop puts the user's view back), the renderer is
 *     given the new view and it paints.
 *  4. The frame watcher (`:1268-1309`, flush post). When the record, phase,
 *     time or trail changed and there is a record: on a new record, label
 *     detection (in the reference's order: goal, free kick, throw-in, attack);
 *     then the rings and covers move on by `dt = time - previous time` on a
 *     playback step while playing without reduced motion, or settle; then it
 *     paints if the record, phase or trail changed, or a fade was or is
 *     running.
 *  5. Ready (`:1311-1319`, flush post). The director has no loading state:
 *     the first record it is given stands for the replay becoming ready. On
 *     that record the frame watcher first attaches the renderer, which pushes
 *     the view and paints before anything else (`ensureRenderer`,
 *     `:1239-1255`), and the ready watcher paints once more after it.
 *  6. The moments' animation frames, when this update is a new animation
 *     frame: see "The moments" below. Each is a callback of its own, and the
 *     view (3) is flushed after each, as a goal frame moves the camera: its
 *     own paint still has the old view, and the view's push paints again.
 *
 * Identity decides "changed", as for Vue refs. A caller hands over the same
 * record object while it stands. Phase and trail may come fresh on every
 * update (deriveAt makes new ones): an equal one (samePhase, sameTrail) is
 * taken as the one already seen, as the replay's setHistory keeps its refs.
 *
 * Every reference `paint()` is a paint here (`paint` below): it turns the
 * ball (ballRoll.ts), which is why a paint has to happen exactly where the
 * reference's does and nowhere else, and it takes a copy of everything it
 * draws. `DirectorOutput.paints` lists a call's paints in order, each with
 * the frame it drew and the view the renderer had for it; `paint` says
 * whether there was one, and `layers` is the last paint ever made: what the
 * canvas shows. A call that paints nothing must draw nothing, as the golden
 * steps with no calls are clock ticks that drew nothing.
 *
 * ## The view
 *
 * The reference keeps the user's zoom and pan in refs, which its gestures
 * and the goal's camera both write, and hands them to the renderer when they
 * change. The director keeps the same two things: the user's view (`view`)
 * and the view each paint is drawn in (`DirectorPaint.view`).
 *
 *  - The caller's own changes (a wheel, a pan, a double click, a resize) go
 *    in through `setView`, which pushes and paints, as the reference's
 *    gesture handlers and `applyBitmapSize` do. Before a gesture that takes
 *    the view over from a goal (camera.ts, `takesCamera`), call
 *    `releaseCamera`.
 *  - The view passed to `update` and `trigger` is the caller's view as it
 *    holds it. It is taken as a change, and pushed as `setView` would, only
 *    when it differs both from the view the director has and from the view
 *    last passed to `update` or `trigger`. So a caller that adopts `camera`,
 *    and one that passes the same view throughout and makes its changes
 *    through `setView`, both work.
 *  - `camera` in an output is the view a sequence moved to since the last
 *    output. The director has already drawn in it; a caller that keeps its
 *    own zoom and pan takes it as theirs.
 *
 * ## Golden steps and calls
 *
 * The golden recordings (video-annotation's goldens, Task 1) have one step
 * per reference paint, and a flush can paint several times. In
 * `seek-mid-goal`, steps 172 to 174 are one seek: 172 is the stop-paint at
 * the new time with the old record (and the goal's view), 173 the view
 * pushed back (3 above) with the new record, 174 the frame watcher. Steps 64
 * to 66 of the same file are one animation frame: the replay's tick, the
 * goal's frame with the old view, and its view's push. The parity test
 * (test/parity/goldens.test.ts) groups steps into calls and compares
 * `paints` in order.
 *
 * ## The moments
 *
 * Each moment is a module of its own (`goal.ts`, `attack.ts`, `freeKick.ts`,
 * `throwIn.ts`) behind the narrow interface in moment.ts, reading and acting
 * through the `MomentContext` the director lends it. The director holds one
 * of each, and does what crosses between them: which takes over from which,
 * and every paint.
 *
 *  - An animation frame is an update whose `nowMs` is later than the last
 *    one's. The moments due in it are those requested before it began, in
 *    request order, as the browser runs rAF callbacks: a moment started
 *    during a frame gets its first frame at the next one, and a moment's
 *    `startedMs` is that first frame. The replay's clock is taken as the
 *    frame's first callback, as it is in the reference whenever play runs.
 *  - `step(nowMs)` is the moment's callback: it painted and goes on
 *    ('paint', requested again), or it is over ('stop': the director stops
 *    it, which paints, as `stopX` does).
 *  - `stop()` ends it at once and says whether it was active; the director
 *    then paints and cancels its request. The goal's stop puts the user's
 *    view back first, which reaches the renderer at the next view flush.
 *  - What each draws is read at paint time.
 *  - Label and ball memory that a seek forgets lives in `memory`, so step 1
 *    can clear it without knowing the modules.
 */
import { sameTrail, type BallTrail } from '../analysis/ballTrail.js'
import { samePhase, type TeamId, type TeamPhase } from '../analysis/teamPhase.js'
import type { ReplayLayers, ReplayMoment } from '../model/replayLayers.js'
import type { Frame, TrackerRecord } from '../model/types.js'
import { planGoal } from '../analysis/goalSequence.js'
import type { FrameLayers } from '../render/renderer.js'
import { viewFromCamera, type Camera } from '../render/viewTransform.js'
import { Attack } from './attack.js'
import { BallRoll, shownBall } from './ballRoll.js'
import { FreeKick } from './freeKick.js'
import { Goal } from './goal.js'
import type { Moment, MomentContext, MomentMemory, ShownReplay } from './moment.js'
import { ThrowIn } from './throwIn.js'
import { Rings } from './rings.js'

export type { Moment, MomentContext, MomentMemory, MomentStep } from './moment.js'

export interface DirectorInput {
  /** The animation frame's timestamp, in ms: what moments time themselves by. */
  nowMs: number
  /** The playback clock, in seconds. */
  time: number
  playing: boolean
  /** Whether this step continues playback; false is a seek. See nextPlayback in playback.ts. */
  playback: boolean
  /** The record on screen, or null before there is one. */
  record: TrackerRecord | null
  phase: TeamPhase | null
  trail: BallTrail | null
}

export interface DirectorView {
  zoom: number
  panX: number
  panY: number
  renderedWidth: number
}

/** The user's zoom and pan, as a sequence sets them. */
export interface DirectorCamera {
  zoom: number
  panX: number
  panY: number
}

/** One reference `paint()`: what the renderer is given to draw. */
export interface DirectorPaint {
  frame: Frame
  layers: FrameLayers
  /** The view the renderer has for this paint. */
  view: DirectorView
}

export interface DirectorOutput {
  /** The last paint ever made, which the canvas shows; null before the first. */
  layers: FrameLayers | null
  /** Whether this call painted: the canvas is drawn only then. */
  paint: boolean
  /** This call's paints, in order. `layers` is the last of them when there are any. */
  paints: readonly DirectorPaint[]
  /** The user's view as a sequence moved it since the last output, or null when none did. */
  camera: DirectorCamera | null
  /** True while any moment or fade needs another tick. */
  animating: boolean
}

export interface DirectorOptions {
  layers: ReplayLayers
  /** Asked afresh at every use, as the reference queries the media query each time. */
  reducedMotion: () => boolean
  teamName: (team: TeamId) => string
  teamColor: (team: TeamId) => string
}

/** Which moments can be played by hand on the frame on screen (`momentAvailability`, `:1020-1036`). */
export interface MomentAvailability {
  /** The goal it goes in is the one in the ball's half: none without a ball. */
  goal: boolean
  /** Without a direction there is no telling which goal a team attacks. */
  attack: Record<TeamId, boolean>
  freeKick: boolean
  throwIn: boolean
}

/** The reference's refs as the surface mounts: the clock at 0, paused, nothing on screen. */
const NOTHING_SEEN: ShownReplay = { time: 0, playing: false, record: null, phase: null, trail: null }

const freshMemory = (): MomentMemory => ({
  freeKickLabelAt: null,
  throwInLabelAt: null,
  lastBall: null,
  playMovedAt: 0,
})

/** The zoom and pan the surface mounts with: the whole pitch. */
const WHOLE_PITCH: DirectorCamera = { zoom: 1, panX: 0, panY: 0 }

/** As the view watcher compares its sources, each with Object.is. */
const sameCamera = (a: DirectorCamera, b: DirectorCamera) =>
  Object.is(a.zoom, b.zoom) && Object.is(a.panX, b.panX) && Object.is(a.panY, b.panY)
const sameView = (a: DirectorView, b: DirectorView) => sameCamera(a, b) && Object.is(a.renderedWidth, b.renderedWidth)
const cameraOf = (view: DirectorCamera): DirectorCamera => ({ zoom: view.zoom, panX: view.panX, panY: view.panY })

/** A moment's request for the next animation frame. Cancelled when it stops. */
interface FrameRequest {
  moment: Moment
  live: boolean
}

export class Director {
  private options: DirectorOptions
  private layers: ReplayLayers
  private readonly rings = new Rings()
  private readonly roll = new BallRoll()
  private readonly context: MomentContext
  private readonly goal: Goal
  private readonly attack: Attack
  private readonly freeKick: FreeKick
  private readonly throwIn: ThrowIn
  /** The moments' requests for the next animation frame, in the order they were made. */
  private requests: FrameRequest[] = []
  /** The requests due in the frame now running, so a stop can cancel one not yet called. */
  private due: FrameRequest[] = []
  /** The last animation frame's timestamp. */
  private frameMs = -Infinity
  private memory: MomentMemory = freshMemory()
  /** The input of the update before. */
  private seen: ShownReplay = NOTHING_SEEN
  /** The replay's refs as the watchers running now read them. */
  private shown: ShownReplay = NOTHING_SEEN
  private lastStepWasPlayback = false
  /** Whether the first record has been drawn: the stand-in for the replay's ready state. */
  private ready = false
  private painted: FrameLayers | null = null
  private paints: DirectorPaint[] = []
  /** The user's zoom and pan: the reference's refs. */
  private userView: DirectorCamera = WHOLE_PITCH
  /** The width the frame is drawn at, in CSS px: the reference's `renderedWidth()`. */
  private renderedWidth = 0
  /** The zoom and pan as the view watcher last saw them. */
  private flushedView: DirectorCamera = WHOLE_PITCH
  /** The view the renderer was last given. */
  private rendered: DirectorView = { ...WHOLE_PITCH, renderedWidth: 0 }
  /** The view the caller last passed, or null before it passed one. */
  private passedView: DirectorView | null = null
  /** The view a sequence moved to since the last output. */
  private movedTo: DirectorCamera | null = null

  constructor(options: DirectorOptions) {
    this.options = { ...options }
    this.layers = { ...options.layers }
    this.context = {
      shown: () => this.shown,
      playback: () => this.lastStepWasPlayback,
      layers: () => this.layers,
      memory: () => this.memory,
      spin: () => this.roll.spin,
      view: () => this.view,
      reducedMotion: () => this.options.reducedMotion(),
      teamName: (team) => this.options.teamName(team),
      teamColor: (team) => this.options.teamColor(team),
      showCamera: (camera) => this.showCamera(camera),
    }
    this.goal = new Goal(this.context)
    this.attack = new Attack(this.context)
    this.freeKick = new FreeKick(this.context)
    this.throwIn = new ThrowIn(this.context)
  }

  /** The user's view: their zoom and pan, or where a sequence has put them, and the width drawn at. */
  get view(): DirectorView {
    return { ...this.userView, renderedWidth: this.renderedWidth }
  }

  /** Take in one flush of the replay, and one animation frame when `nowMs` is a new one: see the top. */
  update(input: DirectorInput, view: DirectorView): DirectorOutput {
    this.paints = []
    this.takeView(view)
    // Due from here, before the flush: a moment the flush stops has its
    // request for this frame cancelled, as cancelAnimationFrame cancels a
    // callback of the frame running that has not been called yet.
    this.due = this.beginFrame(input.nowMs)
    try {
      this.flush(input)
      this.runFrame(input.nowMs)
    } finally {
      // A frame an exception cut short: the requests it had not called yet,
      // and the one it was calling, go on to the next frame, so no moment is
      // left running with nothing to step it.
      this.requests = [...this.due.filter((request) => request.live), ...this.requests]
      this.due = []
    }
    return this.output()
  }

  /**
   * The caller's own view changed: a wheel, a pan, a double click or a
   * resize. It is pushed to the renderer and the frame is drawn again, as the
   * reference's view watcher and `applyBitmapSize` do.
   */
  setView(view: DirectorView): DirectorOutput {
    this.paints = []
    this.applyView(view)
    return this.output()
  }

  /**
   * Play `moment` now, by hand (`triggerMoment`, `:1038-1063`); for an
   * attack, `team`'s. It takes over from whatever is showing and runs as it
   * would on its label, during playback or not, except the free kick: with
   * no label or cutaway to wait on, it is on screen for FREE_KICK_DEMO_MS. A
   * seek or a step ends any of them, as it ends the others.
   *
   * `input` and `view` are the replay and the view as they are now, taken in
   * first as an update would, but not as an animation frame. Null when there
   * is no record on screen, as the reference plays nothing without a frame.
   * A moment that cannot be played here (see `availability`) paints nothing;
   * one that plays paints once.
   */
  trigger(moment: ReplayMoment, team: TeamId, input: DirectorInput, view: DirectorView): DirectorOutput | null {
    this.paints = []
    this.takeView(view)
    this.flush(input)
    const { record, phase, time: now } = this.shown
    if (!record) return null
    const frame = record.frame
    if (moment === 'goal') {
      if (!planGoal(frame)) return this.output()
      this.stopSequences()
      if (this.goal.start(frame)) this.request(this.goal)
    } else if (moment === 'attack') {
      const direction = phase?.attacks[team]
      if (direction == null) return this.output()
      this.stopSequences()
      // Seen, so it does not play again by itself once this one is over.
      this.attack.markSeen(team, direction)
      this.attack.start({ team, direction, color: this.options.teamColor(team) }, shownBall(frame, undefined))
      this.request(this.attack)
    } else if (moment === 'freeKick') {
      this.stopSequences()
      this.memory.freeKickLabelAt = now
      this.freeKick.start(true)
      this.request(this.freeKick)
    } else {
      this.stopSequences()
      this.memory.throwInLabelAt = now
      this.throwIn.start(now)
      this.request(this.throwIn)
    }
    this.paint()
    this.flushView()
    return this.output()
  }

  /** Which moments `trigger` can play on the frame on screen (`momentAvailability`, `:1020-1036`). */
  availability(): MomentAvailability {
    const { record, phase } = this.shown
    const ready = record !== null
    return {
      goal: ready && planGoal(record.frame) !== null,
      attack: { 0: ready && phase?.attacks[0] != null, 1: ready && phase?.attacks[1] != null },
      freeKick: ready,
      throwIn: ready,
    }
  }

  /** Someone wants the real frame and their own view: end every sequence (`stopSequences`). */
  stopAll(): DirectorOutput {
    this.paints = []
    this.stopSequences()
    this.flushView()
    return this.output()
  }

  /**
   * The layers in force, as the layers menu switches them (`toggleLayer`,
   * `:108-118`): a moment switched off mid-way ends now, putting the user's
   * view back, rings whose fades are switched off settle, and the frame is
   * drawn again.
   */
  setLayers(layers: ReplayLayers): DirectorOutput {
    this.paints = []
    const before = this.layers
    this.layers = { ...layers }
    if (before.goal && !layers.goal) this.stopMoment(this.goal)
    if (before.attack && !layers.attack) this.stopMoment(this.attack)
    if (before.freeKick && !layers.freeKick) this.stopMoment(this.freeKick)
    if (before.throwInBanner && !layers.throwInBanner) this.stopMoment(this.throwIn)
    if (before.ringFades && !layers.ringFades) this.rings.settle(this.shown.record?.frame ?? null)
    this.paint()
    this.flushView()
    return this.output()
  }

  /** Everything but the layers, which go through setLayers. Read at the next paint. */
  setOptions(options: Partial<Omit<DirectorOptions, 'layers'>>): void {
    this.options = { ...this.options, ...options }
  }

  /** The user has zoomed or panned: the view is theirs, and stays where they put it. */
  releaseCamera(): void {
    this.goal.releaseCamera()
  }

  /**
   * Forget everything, for a new match or a reconnect: as if just made, but
   * for the view. Draws nothing. A goal showing puts the user's view back,
   * which the next output reports as `camera`.
   */
  reset(): void {
    this.goal.stop()
    for (const moment of [this.goal, this.attack, this.freeKick, this.throwIn]) moment.reset()
    this.requests = []
    this.due = []
    this.rings.clear()
    this.roll.reset()
    this.memory = freshMemory()
    this.seen = NOTHING_SEEN
    this.shown = NOTHING_SEEN
    this.lastStepWasPlayback = false
    this.ready = false
    this.painted = null
    this.paints = []
  }

  /** Steps 1 to 5 of "One update is one flush". */
  private flush(input: DirectorInput): void {
    const before = this.seen
    const next: ShownReplay = {
      time: input.time,
      playing: input.playing,
      record: input.record,
      // A phase and a trail are worked out afresh for every record, but hold
      // for many: as setHistory does (usePipelineReplay.ts:485-499), an equal
      // one keeps the one already seen, so it is not taken for a change.
      phase: before.phase && input.phase && samePhase(before.phase, input.phase) ? before.phase : input.phase,
      trail: sameTrail(before.trail, input.trail) ? before.trail : input.trail,
    }
    this.seen = next
    // 1. The clock, before the record it brought in: still showing the old one.
    this.shown = { ...before, time: next.time, playing: next.playing }
    if (next.time !== before.time) this.clockMoved(input.playback)
    this.shown = next
    // 2. Pause.
    if (before.playing && !next.playing) {
      this.stopSequences()
      this.rings.settle(next.record?.frame ?? null)
      this.paint()
    }
    // 3. The view.
    this.flushView()
    // 4. The frame watcher.
    if (
      next.record !== before.record ||
      next.phase !== before.phase ||
      next.time !== before.time ||
      next.trail !== before.trail
    ) {
      this.frameChanged(before)
    }
    // 5. Ready.
    if (!this.ready && next.record) {
      this.ready = true
      this.paint()
    }
  }

  /** The currentTime watcher (`:562-581`). */
  private clockMoved(playback: boolean): void {
    this.lastStepWasPlayback = playback
    if (playback) return
    this.stopSequences()
    // Wherever the clock went, nothing seen before counts from here: the
    // frame watcher notes the labels and the ball again from the new record.
    this.memory.freeKickLabelAt = null
    this.memory.throwInLabelAt = null
    this.memory.lastBall = null
    this.memory.playMovedAt = this.shown.time
  }

  /** The frame watcher (`:1268-1309`), with `before` what it last saw. */
  private frameChanged(before: ShownReplay): void {
    const { record, phase, trail, time } = this.shown
    const playing = this.shown.playing && this.lastStepWasPlayback && !this.options.reducedMotion()
    if (!record) return
    if (record !== before.record) {
      // ensureRenderer: the first record attaches the renderer, which is given the view and paints.
      if (!this.ready) this.pushView()
      const frame = record.frame
      if (this.goal.detect(frame)) {
        // The goal takes over from any other moment still showing.
        this.stopMoment(this.attack)
        this.stopMoment(this.freeKick)
        this.stopMoment(this.throwIn)
        if (this.goal.start(frame)) this.request(this.goal)
      }
      if (this.freeKick.detect(frame, before.record?.frame ?? null, time, this.goal.active)) {
        // A free kick takes over from an attack and a throw-in.
        this.stopMoment(this.attack)
        this.stopMoment(this.throwIn)
        this.freeKick.start()
        this.request(this.freeKick)
      }
      if (this.throwIn.detect(frame, time, this.goal.active || this.freeKick.active)) {
        this.throwIn.start(time)
        this.request(this.throwIn)
      }
      // An attack shows alongside a throw-in, but not over a goal or a free kick.
      const attack = this.attack.detect(frame, this.goal.active || this.freeKick.active)
      if (attack) {
        this.attack.start(attack.target, attack.ball)
        this.request(this.attack)
      }
    }
    // A fade that has just finished still needs the paint that shows its end.
    const wasFading = this.rings.fading()
    const step = playing ? Math.max(0, time - before.time) : null
    this.rings.update(record.frame, this.layers.ringFades ? step : null, step)
    if (
      record !== before.record ||
      phase !== before.phase ||
      trail !== before.trail ||
      wasFading ||
      this.rings.fading()
    ) {
      this.paint()
    }
  }

  /** The requests due in the frame at `nowMs`, if it is a new frame; none if not. */
  private beginFrame(nowMs: number): FrameRequest[] {
    if (!(nowMs > this.frameMs)) return []
    this.frameMs = nowMs
    const due = this.requests
    this.requests = []
    return due
  }

  /** Each moment's animation frame due, in the order requested, the view flushed after each. */
  private runFrame(nowMs: number): void {
    // Each request leaves `due` once called, and not before: see `update`.
    while (this.due.length > 0) {
      const request = this.due[0]!
      if (!request.live) {
        this.due.shift()
        continue
      }
      const { moment } = request
      if (moment.step(nowMs) === 'paint') {
        this.paint()
        this.due.shift()
        this.request(moment)
      } else {
        this.due.shift()
        this.stopMoment(moment)
      }
      this.flushView()
    }
  }

  private request(moment: Moment): void {
    this.requests.push({ moment, live: true })
  }

  /** `cancelAnimationFrame` on `moment`'s request, made for the next frame or due in this one. */
  private cancel(moment: Moment): void {
    for (const request of [...this.requests, ...this.due]) if (request.moment === moment) request.live = false
    this.requests = this.requests.filter((request) => request.live)
  }

  /** `stopSequences` (`:597-602`): every moment, in the reference's order. */
  private stopSequences(): void {
    this.stopMoment(this.goal)
    this.stopMoment(this.attack)
    this.stopMoment(this.freeKick)
    this.stopMoment(this.throwIn)
  }

  /** `stopGoal` and the like: end `moment` at once, and paint the frame as it is if it was showing. */
  private stopMoment(moment: Moment): void {
    if (!moment.stop()) return
    this.cancel(moment)
    this.paint()
  }

  /** A view passed with an update or a trigger: see "The view" above. */
  private takeView(view: DirectorView): void {
    const passed = this.passedView
    this.passedView = { ...view }
    if (passed === null) {
      // The first view: the one the renderer starts with.
      this.userView = cameraOf(view)
      this.renderedWidth = view.renderedWidth
      this.flushedView = cameraOf(view)
      this.rendered = { ...view }
      return
    }
    if (sameView(view, passed) || sameView(view, this.view)) return
    this.applyView(view)
  }

  /** The caller's view, as theirs: pushed, and drawn. */
  private applyView(view: DirectorView): void {
    this.userView = cameraOf(view)
    this.renderedWidth = view.renderedWidth
    this.flushedView = cameraOf(view)
    this.pushView()
  }

  /** `showCamera` (`:490-496`): the user's view on `camera`, until the view is next flushed. */
  private showCamera(camera: Camera): void {
    this.userView = viewFromCamera(camera, this.renderedWidth)
    this.movedTo = { ...this.userView }
  }

  /** The view watcher (`:213`): when the zoom or pan moved since it last ran, push them. */
  private flushView(): void {
    if (sameCamera(this.userView, this.flushedView)) return
    this.flushedView = { ...this.userView }
    this.pushView()
  }

  /** `pushView` (`:167-180`): the renderer gets the user's view, and the frame is drawn again in it. */
  private pushView(): void {
    this.rendered = this.view
    this.paint()
  }

  /**
   * `paint()` (`:184-212`): the frame on screen, with every moment over it.
   * Every repaint goes through here, so none of them can draw a frame
   * mid-sequence without it, and the ball turns only here.
   */
  private paint(): void {
    const { record, trail } = this.shown
    if (!record) return
    const goal = this.goal.overlay()
    this.roll.roll(record.frame, goal, this.shown.playing && this.lastStepWasPlayback, this.options.reducedMotion())
    const attackShown = this.attack.value()
    const attackMoment = this.attack.moment()
    // The attack holds the ball, and the trail that leads to it, where they
    // were when it was shown, until it starts to go.
    const held = attackShown?.ball && !attackShown.leaving ? attackMoment : null
    const layers: FrameLayers = {
      goal,
      attack: attackShown,
      freeKick: this.freeKick.value(),
      throwIn: this.throwIn.value(),
      goalBanner: this.goal.banner(),
      rings: {
        nearby: this.layers.nearbyRings ? new Map(this.rings.nearby) : new Map(),
        possession: new Map(this.rings.possession),
      },
      fadeFar: this.layers.farFade,
      trail: this.layers.ballTrail ? ((held ? held.trail : trail) ?? undefined) : undefined,
      ballSpin: attackMoment ? attackMoment.spin : this.roll.spin,
      received: this.rings.covers(),
    }
    this.painted = layers
    this.paints.push({ frame: record.frame, layers, view: { ...this.rendered } })
  }

  /** True while any moment or fade needs another tick: `animating` of the next output. */
  get animating(): boolean {
    const moments = [this.goal, this.attack, this.freeKick, this.throwIn]
    return moments.some((m) => m.active) || this.rings.fading()
  }

  private output(): DirectorOutput {
    const camera = this.movedTo
    this.movedTo = null
    return {
      layers: this.painted,
      paint: this.paints.length > 0,
      paints: this.paints,
      camera,
      animating: this.animating,
    }
  }
}
