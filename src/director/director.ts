/**
 * The director: the replay's state machine, taken out of
 * PipelineOutputSurface.vue (video-annotation 6f14d1f) with no framework
 * under it. Given what is on screen, the playback clock and whether play is
 * running, it decides what is drawn over the data: the moments (goal, attack,
 * corner, throw-in, and the attack over a player loss), the rings and the
 * "received" covers, how the ball is turned, and where the view is while a
 * goal moves it. The reference's free kick is not shown. It owns no DOM and no
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
 *     detection (in the reference's order: goal, throw-in, attack, with the
 *     corner, which the reference does not have, after the goal, where the
 *     reference's free kick was, and the attack over a player loss, which it
 *     does not have either, last);
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
 * ## The zoom near goal
 *
 * The widget's own, with its layer (`goalZoom`): video-annotation has none,
 * so with the layer off the director is the reference, and the goldens run
 * it so. With it on, as the ball nears a goal the view eases in on it
 * (goalZoom.ts), and a goal moves no camera of its own (goal.ts): the view
 * follows the goal's ball into the net, as it follows the tracked one.
 *
 * It moves the view only while the view is not the user's. The user takes it
 * by moving it: a view of theirs that is zoomed in, or a gesture that takes
 * the camera (`releaseCamera`) while zoomed in. Back at the whole pitch (a
 * double click, or zoomed all the way out) the view is the zoom's again. A
 * view that comes in with the same zoom and pan, from a resize, changes
 * nothing. It leaves the view to a goal's camera (the reference's, which a
 * goal has only with the layer off as it started), and does nothing with
 * reduced motion, where it puts the whole pitch back. While a corner, a
 * throw-in, most label cards or an attack shows, it eases out to the whole
 * pitch their cards and the attack's label are laid out for (the renderer
 * keeps the cards whole on the frame meanwhile), and back in once they have
 * gone. It steps once in each
 * animation frame, after the moments, and its move goes through the view's
 * push, which paints.
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
 * Each moment is a module of its own (`goal.ts`, `attack.ts`, `corner.ts`,
 * `throwIn.ts`, `labelCard.ts`, `playerLoss.ts`) behind the narrow interface in
 * moment.ts, reading and acting through the `MomentContext` the director
 * lends it. The director holds one
 * of each, one `LabelCard` per card in LABEL_CARDS, and does what crosses between them: which takes over from which,
 * and every paint.
 *
 *  - An animation frame is an update whose `nowMs` is later than the last
 *    one's. The moments due in it are those requested before it began, in
 *    request order, as the browser runs rAF callbacks: a moment started
 *    during a frame gets its first frame at the next one, and a moment's
 *    `startedMs` is that first frame. The replay's clock is taken as the
 *    frame's first callback, as it is in the reference whenever play runs.
 *  - `step(nowMs)` is the moment's callback: it painted and goes on
 *    ('paint', requested again), it painted and stays as it is with nothing to
 *    animate ('hold', not requested again until something changes it), or it
 *    is over ('stop': the director stops it, which paints, as `stopX` does).
 *  - `stop()` ends it at once and says whether it was active; the director
 *    then paints and cancels its request. The goal's stop puts the user's
 *    view back first, which reaches the renderer at the next view flush.
 *  - What each draws is read at paint time.
 *  - Label and ball memory that a seek forgets lives in `memory`, so step 1
 *    can clear it without knowing the modules.
 */
import { sameTrail, type BallTrail } from '../analysis/ballTrail.js'
import { samePhase, type TeamId, type TeamPhase } from '../analysis/teamPhase.js'
import { LABEL_CARDS, isLabelCardKey, isPlayerCardKey, labelCardRecord, playerCardColor, type LabelCardKey } from '../model/labelCards.js'
import { cardLabels, type CardLabel } from '../analysis/cardLabels.js'
import { CardQueue } from './cardQueue.js'
import type { ReplayLayers, ReplayMoment } from '../model/replayLayers.js'
import type { Frame, TrackerRecord } from '../model/types.js'
import { planGoal } from '../analysis/goalSequence.js'
import type { FrameLayers } from '../render/renderer.js'
import { cameraFromView, viewFromCamera } from '../render/viewTransform.js'
import { WHOLE_PITCH_CAMERA } from '../analysis/goalApproach.js'
import { Attack } from './attack.js'
import { BallRoll, shownBall } from './ballRoll.js'
import { MIN_ZOOM } from './camera.js'
import { Corner } from './corner.js'
import { Goal } from './goal.js'
import { GoalZoom } from './goalZoom.js'
import { LabelCard } from './labelCard.js'
import { LABEL_CARD_SHOW_MS, type LabelCardPlayer } from '../render/labelCard.js'
import { PlayerLoss, type PlayerLossState } from './playerLoss.js'
import type { Moment, MomentContext, MomentMemory, ShownReplay } from './moment.js'
import { ThrowIn } from './throwIn.js'
import { Rings } from './rings.js'
import type { Camera } from '../model/pitch.js'

export type { Moment, MomentContext, MomentMemory, MomentStep } from './moment.js'
export type { PlayerLossState } from './playerLoss.js'

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
  /**
   * Live, back after being hidden or scrolled away: `playback` is false, as for
   * any seek, but nobody chose to go anywhere, so a card that stays until the
   * next label stays.
   */
  rejoining?: boolean
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
  /** A carded player's name, or shirt number, as the moments write it. */
  playerName: (team: TeamId, number: number) => string
  /** A substituted player's name, or shirt number, or null for a roster id with no name. */
  substitutionName: (team: TeamId | null, number: number | null) => string | null
  /**
   * Cover the records the pipeline marks invalid with the attack over a player loss
   * (playerLoss.ts). Live mode only: replay data has no such records, and replay must
   * stay the reference's whatever its data carries. Read once, when the director is made.
   */
  coverInvalidFrames?: boolean
}

/** Which moments can be played by hand on the frame on screen (`momentAvailability`, `:1020-1036`). */
export interface MomentAvailability extends Record<LabelCardKey, boolean> {
  /** The goal it goes in is the one in the ball's half: none without a ball. */
  goal: boolean
  /** Without a direction there is no telling which goal a team attacks. */
  attack: Record<TeamId, boolean>
  corner: boolean
  throwIn: boolean
}

/** The reference's refs as the surface mounts: the clock at 0, paused, nothing on screen. */
const NOTHING_SEEN: ShownReplay = { time: 0, playing: false, record: null, phase: null, trail: null }

const freshMemory = (): MomentMemory => ({
  cornerLabelAt: null,
  throwInLabelAt: null,
  labelCards: labelCardRecord(() => ({ seenAt: null, shown: false })),
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
  private readonly corner: Corner
  private readonly throwIn: ThrowIn
  private readonly labelCards: readonly LabelCard[]
  /** The player cards waiting to play, in turn (cardQueue.ts). */
  private readonly cardQueue = new CardQueue()
  private readonly playerLoss: PlayerLoss
  private readonly goalZoom = new GoalZoom()
  /** Whether the user has the view, so the zoom near goal leaves it where they put it. */
  private userHasView = false
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
      playerName: (team, number) => this.options.playerName(team, number),
      substitutionName: (team, number) => this.options.substitutionName(team, number),
      showCamera: (camera) => this.showCamera(camera),
    }
    this.goal = new Goal(this.context)
    this.attack = new Attack(this.context)
    this.corner = new Corner(this.context)
    this.throwIn = new ThrowIn(this.context)
    this.labelCards = LABEL_CARDS.map((card) => new LabelCard(this.context, card))
    this.playerLoss = new PlayerLoss(this.context, options.coverInvalidFrames)
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
    const newFrame = input.nowMs > this.frameMs
    this.due = this.beginFrame(input.nowMs)
    try {
      this.flush(input)
      this.runFrame(input.nowMs)
      if (newFrame) this.followBall(input.nowMs)
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
   * would on its label, during playback or not, except the corner: with no
   * label or cutaway to wait on, it is on screen for CORNER_DEMO_MS, and a
   * label card, likewise for LABEL_CARD_DEMO_MS. A seek
   * or a step ends any of them, as it ends the others.
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
    } else if (moment === 'corner') {
      this.stopSequences()
      this.memory.cornerLabelAt = now
      this.corner.start(frame, now, true)
      this.request(this.corner)
    } else if (isLabelCardKey(moment)) {
      const card = this.labelCards.find((c) => c.key === moment)!
      const strength = this.labelCardStrength(card.small)
      this.stopSequences()
      // By hand there is a team, but no player to name.
      const player = isPlayerCardKey(moment) ? { team: this.options.teamName(team), player: null, color: playerCardColor(moment) } : undefined
      card.start(now, frame, true, strength, player)
      this.request(card)
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
      corner: ready,
      throwIn: ready,
      ...labelCardRecord(() => ready),
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
    if (before.playerLoss && !layers.playerLoss) this.stopMoment(this.playerLoss)
    if (before.corner && !layers.corner) this.stopMoment(this.corner)
    if (before.throwInBanner && !layers.throwInBanner) this.stopMoment(this.throwIn)
    for (const card of this.labelCards) if (before[card.key] && !layers[card.key]) this.stopMoment(card)
    for (const card of this.labelCards) if (isPlayerCardKey(card.key) && !layers[card.key]) this.cardQueue.drop(card.key)
    if (before.ringFades && !layers.ringFades) this.rings.settle(this.shown.record?.frame ?? null)
    if (before.goalZoom && !layers.goalZoom) this.dropGoalZoom()
    this.paint()
    this.flushView()
    return this.output()
  }

  /** Everything but the layers, which go through setLayers. Read at the next paint. */
  setOptions(options: Partial<Omit<DirectorOptions, 'layers' | 'coverInvalidFrames'>>): void {
    this.options = { ...this.options, ...options }
  }

  /** The user has zoomed or panned: the view is theirs, and stays where they put it. */
  releaseCamera(): void {
    this.goal.releaseCamera()
    // At the whole pitch there is nothing of the zoom near goal to take: a
    // double click there, or a wheel out, leaves it the view.
    if (this.userView.zoom > MIN_ZOOM) this.takeFromGoalZoom()
  }

  /**
   * Forget everything, for a new match or a reconnect: as if just made, but
   * for the view. Draws nothing. A goal showing puts the user's view back,
   * which the next output reports as `camera`.
   */
  reset(): void {
    this.goal.stop()
    for (const moment of [this.goal, this.attack, this.playerLoss, this.corner, this.throwIn, ...this.labelCards]) {
      moment.reset()
    }
    this.requests = []
    this.due = []
    this.cardQueue.clear()
    this.goalZoom.reset()
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
    if (next.time !== before.time) this.clockMoved(input.playback, input.rejoining ?? false)
    this.shown = next
    // 2. Pause. A card that stays until the next label stays through it.
    if (before.playing && !next.playing) {
      this.stopSequences(true)
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
  private clockMoved(playback: boolean, rejoining: boolean): void {
    this.lastStepWasPlayback = playback
    if (playback) return
    this.stopSequences(rejoining)
    // Wherever the clock went, nothing seen before counts from here: the
    // frame watcher notes the labels and the ball again from the new record.
    this.memory.cornerLabelAt = null
    this.memory.throwInLabelAt = null
    this.memory.labelCards = freshMemory().labelCards
    this.cardQueue.clear()
    this.memory.lastBall = null
    this.memory.playMovedAt = this.shown.time
    this.playerLoss.forget()
    this.goalZoom.forgetBall()
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
      // First, so a card that goes on this label is on its way out as the label's own moment comes.
      for (const card of this.labelCards) if (card.notice(frame, time)) this.request(card)
      if (this.goal.detect(frame)) {
        // The goal takes over from any other moment still showing.
        this.stopMoment(this.attack)
        this.stopMoment(this.playerLoss)
        this.stopMoment(this.corner)
        this.stopMoment(this.throwIn)
        this.stopLabelCards(true)
        if (this.goal.start(frame)) this.request(this.goal)
      }
      if (this.corner.detect(frame, before.record?.frame ?? null, time, this.goal.active)) {
        // A corner takes over from an attack, the attack over a player loss, a throw-in and a label card.
        this.stopMoment(this.attack)
        this.stopMoment(this.playerLoss)
        this.stopMoment(this.throwIn)
        this.stopLabelCards(true)
        this.corner.start(frame, time)
        this.request(this.corner)
      }
      for (const card of this.labelCards) {
        // The player cards play from their queue, below.
        if (isPlayerCardKey(card.key)) continue
        // A small card does not go over a centre one.
        const blocked = this.goal.active || this.corner.active || (card.small && this.centreCardHoldsBack())
        if (card.detect(frame, time, blocked)) {
          // The latest card takes over from another of its size, as a goal disallowed answers the VAR check
          // before it, from the strength that one had, so the band does not blink.
          const strength = this.labelCardStrength(card.small)
          this.stopMoment(this.throwIn)
          if (card.small) {
            this.stopSmallCards()
          } else {
            // As a corner does: the card is laid across the pitch, and play is stopped for it.
            this.stopMoment(this.attack)
            this.stopMoment(this.playerLoss)
            this.stopLabelCards()
          }
          card.start(time, frame, false, strength)
          this.request(card)
        }
      }
      this.queueCards(frame, time)
      const setPiece = this.goal.active || this.corner.active || this.centreCardHoldsBack()
      if (this.throwIn.detect(frame, time, setPiece)) {
        // In the same place as a small card, which it takes over from.
        this.stopSmallCards()
        this.throwIn.start(time)
        this.request(this.throwIn)
      }
      // An attack shows alongside a throw-in, but not over a goal, a corner or a label card,
      // nor over the attack covering a player loss: the one there is stands in for it.
      const attack = this.attack.detect(frame, setPiece || this.playerLoss.active)
      if (attack) {
        this.attack.start(attack.target, attack.ball)
        this.request(this.attack)
      }
      // A player loss is covered when nothing but a throw-in is showing.
      const cover = this.playerLoss.detect(record, time, setPiece || this.attack.active)
      if (cover) {
        this.playerLoss.start(cover)
        this.request(this.playerLoss)
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
      const step = moment.step(nowMs)
      if (step !== 'stop') {
        this.paint()
        this.due.shift()
        if (step === 'paint') this.request(moment)
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

  /**
   * `stopSequences` (`:597-602`): every moment, in the reference's order. With
   * `keepStaying`, but for a card that stays until the next label, which has
   * had none: the reference has no such moment.
   */
  private stopSequences(keepStaying = false): void {
    this.stopMoment(this.goal)
    this.stopMoment(this.attack)
    this.stopMoment(this.playerLoss)
    this.stopMoment(this.corner)
    this.stopMoment(this.throwIn)
    for (const card of this.labelCards) if (!keepStaying || !card.staysOn) this.stopMoment(card)
    // A pause, a press, a seek or a moment by hand: the cards waiting go with the one showing.
    this.cardQueue.clear()
  }

  /** End the label cards at once; with `letFade`, one already fading out finishes doing so. */
  private stopLabelCards(letFade = false): void {
    for (const card of this.labelCards) {
      if (letFade && !card.holdsBack) continue
      // A player card cut short before it has stayed its time is not a card played: it goes first again.
      const label = card.playing
      if (label && card.holdsBack && card.shownMs < LABEL_CARD_SHOW_MS) this.cardQueue.putBack(label)
      this.stopMoment(card)
    }
  }

  /**
   * The player cards on `frame`, into their queue, and the first waiting card played if nothing
   * holds it back: a goal, a corner, or a centre card on screen, fading out included, so one card
   * goes before the next comes in. A card's label sits on one record, so a card waits its turn
   * rather than being missed (cardQueue.ts). Landed on by a seek, or seen while paused, a label is
   * under way, and is not played.
   */
  private queueCards(frame: Frame, time: number): void {
    const playing = this.shown.playing && this.lastStepWasPlayback
    for (const label of cardLabels(frame)) {
      if (!playing) this.cardQueue.skip(label, time)
      else if (this.layers[label.key]) this.cardQueue.add(label, time)
    }
    const centreCardUp = this.labelCards.some((card) => !card.small && card.active)
    if (!playing || this.goal.active || this.corner.active || centreCardUp) return
    const label = this.cardQueue.take()
    // Substitutions wait here too, but play as their own card (playSubstitutions).
    if (!label || label.key === 'substitution') return
    const card = this.labelCards.find((c) => c.key === label.key)!
    // As any centre card does: it takes over from the one fading out, and play is stopped for it.
    const strength = this.labelCardStrength(false)
    this.stopMoment(this.throwIn)
    this.stopMoment(this.attack)
    this.stopMoment(this.playerLoss)
    this.stopLabelCards()
    card.start(time, frame, false, strength, this.cardPlayer(label), label)
    this.request(card)
  }

  /** Who `label`'s card is for, in the words drawn. */
  private cardPlayer(label: CardLabel): LabelCardPlayer {
    const { team, number } = label
    return {
      team: team === null ? null : this.options.teamName(team),
      player: team === null || number === null ? null : this.options.playerName(team, number),
      color: playerCardColor(label.key),
    }
  }

  private stopSmallCards(): void {
    for (const card of this.labelCards) if (card.small) this.stopMoment(card)
  }

  /** Whether a centre card is up and not on its way out: what holds back what shows beside other moments. */
  private centreCardHoldsBack(): boolean {
    return this.labelCards.some((card) => !card.small && card.holdsBack)
  }

  /** How strongly the label card of that size showing is drawn: 0 when none is. */
  private labelCardStrength(small: boolean): number {
    return this.labelCards.find((card) => card.small === small && card.active)?.value()?.intensity ?? 0
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
      this.userHasView = view.zoom > MIN_ZOOM
      return
    }
    if (sameView(view, passed) || sameView(view, this.view)) return
    this.applyView(view)
  }

  /** The caller's view, as theirs: pushed, and drawn. */
  private applyView(view: DirectorView): void {
    // Back at the whole pitch the view is the zoom near goal's again; a zoom
    // or pan of the user's own is theirs; the same one, from a resize, is
    // whoever's it was.
    if (view.zoom <= MIN_ZOOM) this.userHasView = false
    else if (!sameCamera(view, this.userView)) this.userHasView = true
    // Wherever it came from, the zoom near goal sets off again from it.
    this.goalZoom.release()
    this.userView = cameraOf(view)
    this.renderedWidth = view.renderedWidth
    this.flushedView = cameraOf(view)
    this.pushView()
  }

  /** The zoom near goal's animation frame: see "The zoom near goal" above. */
  private followBall(nowMs: number): void {
    const record = this.shown.record
    // A goal moving the view, with the reference's camera, has it to itself.
    if (!this.layers.goalZoom || this.userHasView || this.goal.movesCamera || !record) {
      this.goalZoom.release()
      return
    }
    if (this.options.reducedMotion()) {
      this.dropGoalZoom()
      this.flushView()
      return
    }
    // The corner's card, the throw-in's banner, most label cards and the attack, its own or over a player loss or
    // invalid frames, are laid out for the whole pitch: the small cards sit on the touchline, and a centre card and
    // the attack's label sit in the middle of it, the attack's fading out what the view would be following.
    const makeWay =
      this.corner.active ||
      this.throwIn.active ||
      this.attack.active ||
      this.playerLoss.active ||
      this.labelCards.some((card) => card.active && card.makesWay)
    // The ball drawn: during a goal, its own, shot into the net.
    const ball = shownBall(record.frame, this.goal.overlay())
    const at = { ball, pitch: record.frame.pitch_dimensions, time: this.shown.time }
    const camera = this.goalZoom.step(at, cameraFromView(this.view), nowMs, makeWay)
    if (!camera) return
    this.showCamera(camera)
    this.flushView()
  }

  /** The user takes the view: the zoom near goal leaves it where it is. */
  private takeFromGoalZoom(): void {
    this.userHasView = true
    this.goalZoom.release()
  }

  /**
   * The zoom near goal stops moving the view: switched off, or reduced
   * motion. If it had the view in on a goal, the whole pitch goes back, as a
   * moment switched off puts the user's view back. Reaches the renderer at
   * the next view flush.
   */
  private dropGoalZoom(): void {
    this.goalZoom.release()
    if (!this.userHasView && !this.goal.movesCamera && this.userView.zoom > MIN_ZOOM) this.showCamera(WHOLE_PITCH_CAMERA)
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
    // The attack covering a player loss is drawn as an attack, with the ball left to play.
    const attackShown = this.attack.value() ?? this.playerLoss.value()
    const attackMoment = this.attack.moment()
    // The attack holds the ball, and the trail that leads to it, where they
    // were when it was shown, until it starts to go.
    const held = attackShown?.ball && !attackShown.leaving ? attackMoment : null
    const layers: FrameLayers = {
      goal,
      attack: attackShown,
      corner: this.corner.value(),
      throwIn: this.throwIn.value(),
      labelCard: this.labelCards.find((card) => !card.small && card.active)?.value(),
      smallLabelCard: this.labelCards.find((card) => card.small && card.active)?.value(),
      goalBanner: this.goal.banner(),
      rings: {
        nearby: this.layers.nearbyRings ? new Map(this.rings.nearby) : new Map(),
        possession: new Map(this.rings.possession),
      },
      fadeFar: this.layers.farFade,
      ballShadow: this.layers.ballShadow,
      trail: this.layers.ballTrail ? ((held ? held.trail : trail) ?? undefined) : undefined,
      ballSpin: attackMoment ? attackMoment.spin : this.roll.spin,
      received: this.rings.covers(),
    }
    this.painted = layers
    this.paints.push({ frame: record.frame, layers, view: { ...this.rendered } })
  }

  /** True while any moment or fade needs another tick: `animating` of the next output. */
  get animating(): boolean {
    const moments: Moment[] = [this.goal, this.attack, this.playerLoss, this.corner, this.throwIn, ...this.labelCards]
    return moments.some((m) => m.active && !m.idle) || this.rings.fading() || this.goalZoom.moving
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

  /**
   * The player loss on the record on screen, if it is one, and who covers it: for the debug badge,
   * which asks only while it shows, as it scans every player.
   */
  loss(): PlayerLossState | null {
    return this.shown.record ? this.playerLoss.state(this.shown.record) : null
  }
}
