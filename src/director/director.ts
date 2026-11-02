/**
 * The director: the replay's state machine, taken out of
 * PipelineOutputSurface.vue (video-annotation 6f14d1f) with no framework
 * under it. Given what is on screen, the playback clock and whether play is
 * running, it decides what is drawn over the data: the moments (goal, attack,
 * free kick, throw-in), the rings and the "received" covers, and how the ball
 * is turned. It owns no DOM and no clock; its caller drives it.
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
 *  2. Pause (`:583-594`). When `playing` went from true to false: every
 *     moment stops, the rings settle, and it paints, with the new record.
 *  3. The frame watcher (`:1268-1309`). When the record, phase, time or
 *     trail changed and there is a record: on a new record, label detection
 *     (in the reference's order: goal, free kick, throw-in, attack); then the
 *     rings and covers move on by `dt = time - previous time` on a playback
 *     step while playing without reduced motion, or settle; then it paints if
 *     the record, phase or trail changed, or a fade was or is running.
 *  4. Ready (`:1311-1319`). The director has no loading state: the first
 *     record it is given stands for the replay becoming ready, and paints
 *     once more, as the reference's ready watcher does after its frame
 *     watcher.
 *  5. The moments' animation frames (`goalStep` and the like): see below.
 *
 * Identity decides "changed", as for Vue refs. A caller hands over the same
 * record object while it stands. Phase and trail may come fresh on every
 * update (deriveAt makes new ones): an equal one (samePhase, sameTrail) is
 * taken as the one already seen, as the replay's setHistory keeps its refs.
 *
 * Every reference `paint()` is a paint here (`paint` below): it turns the
 * ball (ballRoll.ts), which is why a paint has to happen exactly where the
 * reference's does and nowhere else, and it takes a copy of everything it
 * draws. `DirectorOutput.paints` lists an update's paints in order, `paint`
 * says whether there was one, and `layers` is the last paint ever made: what
 * the canvas shows. An update that paints nothing must draw nothing, as the
 * golden steps with no calls are clock ticks that drew nothing.
 *
 * ## Golden steps and updates
 *
 * The golden recordings (video-annotation's goldens, Task 1) have one step
 * per reference paint, and a flush can paint several times. In
 * `seek-mid-goal`, steps 172 to 174 are one seek: 172 is the stop-paint at
 * the new time with the old record (and the goal's view), 173 the view
 * pushed back with the new record, 174 the frame watcher. Steps 64 to 66 of
 * the same file are one animation frame in three callbacks: the replay's
 * tick, `goalStep`, and the view `goalStep` set reaching the renderer. A
 * harness replaying the goldens therefore has to group steps into flushes
 * and callbacks, and compare `paints` in order, rather than treat every step
 * as an update.
 *
 * ## The moment seam
 *
 * Each moment is a module of its own (`goal.ts` in Task 8; `attack.ts`,
 * `freeKick.ts`, `throwIn.ts` in Task 9) behind the narrow interfaces below,
 * and the director holds one of each in a slot. In this task every slot is
 * idle: nothing shows and nothing starts.
 *
 *  - `active` is the reference's `x !== null || xRaf !== null`.
 *  - `step(nowMs)` is the moment's animation frame callback. It says whether
 *    it painted ('paint'), is over ('stop': the director stops it, which
 *    paints, as `stopX` does) or had no frame due ('wait'). The director
 *    steps active moments after the watchers, in `order`: the order their
 *    animation frames were requested, which is the order they started. A
 *    moment's `startedMs` is the first frame after its start, so a moment
 *    should not step at the `nowMs` it was started at.
 *  - `stop()` ends it at once and says whether it was active; the director
 *    then paints, as `stopX` does. The goal's stop also hands back the view
 *    it started from (`camera`), which the director must output before that
 *    paint.
 *  - What each draws is read at paint time: `overlay`/`banner` for the goal,
 *    `value` for the others, and the attack's `moment()`, whose trail and
 *    spin replace the replay's while it is showing (`:184-212`).
 *  - Starting is each module's own, from the director's label detection in
 *    step 3 and from `trigger`. Starting a moment must push it onto `order`;
 *    `stopMoment` takes it off.
 *  - Label and ball memory that a seek forgets lives in `memory`, so step 1
 *    can clear it without knowing the modules.
 */
import { sameTrail, type BallTrail } from '../analysis/ballTrail'
import type { Spin } from '../analysis/football'
import { samePhase, type TeamId, type TeamPhase } from '../analysis/teamPhase'
import type { ReplayLayers, ReplayMoment } from '../model/replayLayers'
import type { TrackerRecord } from '../model/types'
import type { AttackIndicator } from '../render/attackIndicator'
import type { FreeKickBanner } from '../render/freeKick'
import type { GoalBanner } from '../render/goalBanner'
import type { FrameLayers, GoalOverlay } from '../render/renderer'
import type { ThrowInIndicator } from '../render/throwIn'
import { BallRoll } from './ballRoll'
import { Rings } from './rings'

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

/** A view the director sets while a sequence drives it. */
export interface DirectorCamera {
  zoom: number
  panX: number
  panY: number
}

export interface DirectorOutput {
  /** The last paint ever made, which the canvas shows; null before the first. */
  layers: FrameLayers | null
  /** Whether this call painted: the canvas is drawn only then. */
  paint: boolean
  /** This call's paints, in order. `layers` is the last of them when there are any. */
  paints: readonly FrameLayers[]
  /** Set while a sequence drives the view. */
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

/** What a moment's animation frame did. */
export type MomentStep = 'paint' | 'stop' | 'wait'

/** A moment, as the director drives it. See "The moment seam" above. */
export interface Moment {
  readonly active: boolean
  step(nowMs: number): MomentStep
  stop(): boolean
}

export interface GoalMoment extends Moment {
  overlay(): GoalOverlay | undefined
  banner(): GoalBanner | undefined
  camera(): DirectorCamera | null
  releaseCamera(): void
}

export interface AttackMoment extends Moment {
  value(): AttackIndicator | undefined
  /** The ball's trail and spin as they were when the attack was shown, while it is. */
  moment(): { trail: BallTrail | null; spin: Spin } | null
}

export interface FreeKickMoment extends Moment {
  value(): FreeKickBanner | undefined
}

export interface ThrowInMoment extends Moment {
  value(): ThrowInIndicator | undefined
}

/** What a seek forgets (`:574-579`), shared by the free kick and throw-in modules. */
export interface MomentMemory {
  /** The replay time the free kick label was last seen at, or null. */
  freeKickLabelAt: number | null
  /** The replay time the throw-in label was last seen at, or null. */
  throwInLabelAt: number | null
  /** Where along the pitch the ball was last tracked, in metres, and when. */
  lastBall: { x: number; at: number } | null
  /** The replay time anyone on the pitch, or the ball, last moved at. */
  playMovedAt: number
}

/** What the replay's watchers last saw. */
interface Seen {
  time: number
  playing: boolean
  record: TrackerRecord | null
  phase: TeamPhase | null
  trail: BallTrail | null
}

/** The reference's refs as the surface mounts: the clock at 0, paused, nothing on screen. */
const NOTHING_SEEN: Seen = { time: 0, playing: false, record: null, phase: null, trail: null }

const IDLE = { active: false, step: (): MomentStep => 'wait', stop: () => false } as const

// The slots until Tasks 8 and 9 fill them: nothing shows, and nothing starts.
const idleGoal = (): GoalMoment => ({
  ...IDLE,
  overlay: () => undefined,
  banner: () => undefined,
  camera: () => null,
  releaseCamera: () => {},
})
const idleAttack = (): AttackMoment => ({ ...IDLE, value: () => undefined, moment: () => null })
const idleFreeKick = (): FreeKickMoment => ({ ...IDLE, value: () => undefined })
const idleThrowIn = (): ThrowInMoment => ({ ...IDLE, value: () => undefined })

const freshMemory = (): MomentMemory => ({ freeKickLabelAt: null, throwInLabelAt: null, lastBall: null, playMovedAt: 0 })

export class Director {
  private options: DirectorOptions
  private layers: ReplayLayers
  private readonly rings = new Rings()
  private readonly roll = new BallRoll()
  private readonly goal: GoalMoment = idleGoal()
  private readonly attack: AttackMoment = idleAttack()
  private readonly freeKick: FreeKickMoment = idleFreeKick()
  private readonly throwIn: ThrowInMoment = idleThrowIn()
  /** The active moments, in the order their animation frames were requested. */
  private readonly order: Moment[] = []
  private memory: MomentMemory = freshMemory()
  /** The input of the update before. */
  private seen: Seen = NOTHING_SEEN
  /** The replay's refs as the watchers running now read them. */
  private shown: Seen = NOTHING_SEEN
  private lastStepWasPlayback = false
  /** Whether the first record has been drawn: the stand-in for the replay's ready state. */
  private ready = false
  private painted: FrameLayers | null = null
  private paints: FrameLayers[] = []
  private lastView: DirectorView | null = null

  constructor(options: DirectorOptions) {
    this.options = { ...options }
    this.layers = { ...options.layers }
  }

  /** The view the caller last gave, which a sequence's camera starts from. */
  get view(): DirectorView | null {
    return this.lastView
  }

  /** Take in one flush of the replay: see "One update is one flush" above. */
  update(input: DirectorInput, view: DirectorView): DirectorOutput {
    this.paints = []
    this.lastView = view
    const before = this.seen
    const next: Seen = {
      time: input.time,
      playing: input.playing,
      record: input.record,
      // A phase and a trail are worked out afresh for every record, but hold
      // for many: as setHistory does (usePipelineReplay.ts:485-499), an equal
      // one keeps the one already seen, so it is not taken for a change.
      phase:
        before.phase && input.phase && samePhase(before.phase, input.phase) ? before.phase : input.phase,
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
    // 3. The frame watcher.
    if (
      next.record !== before.record ||
      next.phase !== before.phase ||
      next.time !== before.time ||
      next.trail !== before.trail
    ) {
      this.frameChanged(before)
    }
    // 4. Ready.
    if (!this.ready && next.record) {
      this.ready = true
      this.paint()
    }
    // 5. The moments' animation frames.
    this.stepMoments(input.nowMs)
    return this.output()
  }

  /**
   * Play `moment` now; for an attack, `team`'s. False when it cannot be
   * played here. Task 9 ports triggerMoment (`:1038-1063`); until then no
   * moment can be played.
   */
  trigger(_moment: ReplayMoment, _team: TeamId, input: DirectorInput, view: DirectorView): boolean {
    this.lastView = view
    // The reference plays nothing without a frame on screen.
    if (!input.record) return false
    return false
  }

  /** Someone wants the real frame and their own view: end every sequence (`stopSequences`). */
  stopAll(): DirectorOutput {
    this.paints = []
    this.stopSequences()
    return this.output()
  }

  /**
   * The layers in force, as the layers menu switches them (`toggleLayer`,
   * `:108-118`): a moment switched off mid-way ends now, rings whose fades are
   * switched off settle, and the frame is drawn again.
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

  /** Forget everything, for a new match or a reconnect: as if just made. Draws nothing. */
  reset(): void {
    for (const moment of [this.goal, this.attack, this.freeKick, this.throwIn]) moment.stop()
    this.order.length = 0
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
  private frameChanged(before: Seen): void {
    const { record, phase, trail, time } = this.shown
    const playing = this.shown.playing && this.lastStepWasPlayback && !this.options.reducedMotion()
    if (!record) return
    if (record !== before.record) {
      // Label detection, in the reference's order (:1280-1293): the goal and
      // goalLabelSeen (Task 8, goal.ts), then updateFreeKick(frame, prevFrame,
      // now), updateThrowIn(frame, now) and maybeStartAttack(frame) (Task 9).
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

  /** Each active moment's animation frame, in the order they were requested. */
  private stepMoments(nowMs: number): void {
    // A copy: a moment that ends leaves `order` while this goes through it.
    for (const moment of this.order.slice()) {
      if (!moment.active) continue
      const result = moment.step(nowMs)
      if (result === 'paint') this.paint()
      else if (result === 'stop') this.stopMoment(moment)
    }
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
    const at = this.order.indexOf(moment)
    if (at >= 0) this.order.splice(at, 1)
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
    this.paints.push(layers)
  }

  private output(): DirectorOutput {
    const moments = [this.goal, this.attack, this.freeKick, this.throwIn]
    return {
      layers: this.painted,
      paint: this.paints.length > 0,
      paints: this.paints,
      camera: this.goal.camera(),
      animating: moments.some((m) => m.active) || this.rings.fading(),
    }
  }
}
