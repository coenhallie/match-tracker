/**
 * The goal sequence, ported from PipelineOutputSurface.vue (6f14d1f)
 * :439-552 and its part of the frame watcher, :1280-1289.
 *
 * When playback runs into a frame the pipeline labels GOAL, a ball is shot
 * into the net and settles there, in place of the tracked ball (see
 * goalSequence.ts). As it reaches the net the goal's card comes up, fixed to
 * the frame while the view zooms behind it (goalBanner.ts).
 *
 * It only ever plays during playback, and anything that means someone wants
 * the real frame stops it at once. While it plays, the view zooms in on the
 * shot and the net and eases back out to the view the user had. Stopping it
 * puts that view straight back; zooming or panning during it hands the view
 * to the user for good.
 *
 * With the zoom near goal on, the goal moves no camera of its own: the zoom
 * near goal keeps the view, and follows the goal's ball into the net. The
 * reference's camera lunges in over 400 ms, and back out at the end.
 *
 * ## The scorer
 *
 * The labelling tool labels a goal twice: "Goal" (or "Penalty scored"), which
 * names the team, and a few seconds later "Player scored", which names the
 * player (scorerLabel.ts). The scorer and their team are written under the
 * goal's banner (goalBanner.ts). The reference has no scorer.
 *
 * Live, a goal label waits up to `scorerWaitS` of the clock for its scorer, and
 * plays then, with them; with none by then, it plays without. The shot is
 * planned from the goal's own record, as by the scorer's the ball has gone on.
 * In replay the wait is 0: the goal plays on its label, as the reference's
 * does. Either way, a scorer that comes while their goal plays is written under
 * it, fading in, and one that comes after it is over plays nothing; a scorer
 * with no goal labelled in the SCORER_AFTER_GOAL_S before plays a goal of its
 * own. A scorer of the other team than the goal's is not its scorer.
 */
import { GOAL_SEQUENCE_MS, goalCamera, goalCameraWeight, goalLabelTeam, goalStateAt, isGoalFrame, planGoal, type GoalPlan, type GoalState } from '../analysis/goalSequence.js'
import { scorerLabel, type ScorerLabel } from '../analysis/scorerLabel.js'
import type { TeamId } from '../analysis/teamPhase.js'
import type { Frame } from '../model/types.js'
import { goalBannerIntensity, goalBannerSlide, type GoalBanner, type GoalScorer } from '../render/goalBanner.js'
import type { GoalOverlay } from '../render/renderer.js'
import { cameraFromView } from '../render/viewTransform.js'
import { blendCamera } from './camera.js'
import type { Moment, MomentContext, MomentStep } from './moment.js'
import type { Camera } from '../model/pitch.js'

/**
 * How long a goal's label waits for its scorer's live, in seconds of the clock. On staging the
 * scorer came 2.4 and 4.8 s after the goal (2026-11-13): a few seconds more than the later.
 */
export const SCORER_WAIT_S = 6

/**
 * A scorer's label belongs to a goal labelled up to this long before it, in seconds of the clock:
 * it plays no goal of its own, though the goal has been and gone.
 */
export const SCORER_AFTER_GOAL_S = 15

/** How long a scorer coming while their goal plays takes to fade in under it. */
export const GOAL_SCORER_IN_MS = 400

/** What a goal starts from: the record its shot is planned on, its team, and its scorer, if known. */
export interface GoalStart {
  frame: Frame
  team: TeamId | null
  scorer: ScorerLabel | null
}

/** A goal's label, waiting for its scorer since `at` on the clock. */
interface Waiting {
  frame: Frame
  team: TeamId | null
  at: number
}

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))

/** Whether `scorer` can be the scorer of a goal by `team`: unless both name a team, and not the same one. */
const scorerOf = (team: TeamId | null, scorer: ScorerLabel) => team === null || scorer.team === null || team === scorer.team

interface Running {
  plan: GoalPlan
  /** The team its label gave, if any. */
  team: TeamId | null
  /** Who scored, in the words drawn, once known. */
  scorer: GoalScorer | null
  /** When the scorer came, in ms into the sequence, for one who came while it played; null for one known from the start. */
  scorerFromMs: number | null
  /** The first animation frame's timestamp, once it has had one. */
  startedMs: number | null
  elapsedMs: number
  /**
   * The user's view and the goal's framing. Null once the user takes the view
   * over, and with reduced motion, when the view does not move at all.
   */
  camera: { from: Camera; to: Camera } | null
}

export class Goal implements Moment {
  private goal: Running | null = null
  /** A goal's label waiting for its scorer, live. */
  private pending: Waiting | null = null
  /** The label usually stays on for many frames: only its first one is a goal. */
  private labelSeen = false
  /** Likewise for the scorer's. */
  private scorerSeen = false
  /** The clock when a goal was last labelled, or null since a seek. */
  private goalLabelAt: number | null = null

  /** `scorerWaitS`: how long a goal's label waits for its scorer, in seconds of the clock; 0 plays it at once. */
  constructor(
    private readonly ctx: MomentContext,
    private readonly scorerWaitS = 0,
  ) {}

  get active(): boolean {
    return this.goal !== null
  }

  /** Whether a goal's label is waiting for its scorer's, live. */
  get waiting(): boolean {
    return this.pending !== null
  }

  /** Whether it is moving the view: the reference's camera, with the zoom near goal off. */
  get movesCamera(): boolean {
    return this.goal?.camera != null
  }

  /**
   * The frame watcher's goal check, on each new record (`:1280-1289`), at
   * `time` on the clock: the goal that starts on `frame`, if one does. Notes
   * whether it is labelled either way. A goal's label waits for its scorer
   * (see "The scorer" above): the goal starts on the scorer's record, or on
   * the first record after the wait. A scorer coming while their goal plays
   * is written under it here. The director stops the other moments, then
   * calls `start`.
   */
  detect(frame: Frame, time: number): GoalStart | null {
    const labelled = isGoalFrame(frame)
    const scorer = scorerLabel(frame)
    const newGoal = labelled && !this.labelSeen
    const newScorer = scorer !== null && !this.scorerSeen
    this.labelSeen = labelled
    this.scorerSeen = scorer !== null
    if (!this.ctx.layers().goal || !this.ctx.playback()) return null
    if (newGoal && !this.goal && !this.pending) {
      this.goalLabelAt = time
      const team = goalLabelTeam(frame)
      if (newScorer && scorerOf(team, scorer)) return { frame, team, scorer }
      if (this.scorerWaitS <= 0) return { frame, team, scorer: null }
      this.pending = { frame, team, at: time }
      return null
    }
    const waiting = this.pending
    if (newScorer && waiting) {
      this.pending = null
      return { frame: waiting.frame, team: waiting.team, scorer: scorerOf(waiting.team, scorer) ? scorer : null }
    }
    if (newScorer) return this.lateScorer(frame, time, scorer)
    if (waiting && !(time - waiting.at < this.scorerWaitS)) {
      this.pending = null
      return { frame: waiting.frame, team: waiting.team, scorer: null }
    }
    return null
  }

  /**
   * `startGoal`: plan the shot on `frame`, the camera moving from the user's
   * view to the goal, unless the zoom near goal has the view, with the team
   * and scorer `from` gives, if any. False with no ball, when there is no
   * telling which goal it went in: better no sequence than one at the wrong end.
   */
  start(frame: Frame, from: Partial<Omit<GoalStart, 'frame'>> = {}): boolean {
    const plan = planGoal(frame)
    if (!plan) return false
    const team = from.team ?? null
    this.pending = null
    this.goal = {
      plan,
      team,
      scorer: from.scorer ? this.named(from.scorer, team) : null,
      scorerFromMs: null,
      startedMs: null,
      elapsedMs: 0,
      camera:
        this.ctx.reducedMotion() || this.ctx.layers().goalZoom
          ? null
          : { from: cameraFromView(this.ctx.view()), to: goalCamera(plan, frame.pitch_dimensions) },
    }
    return true
  }

  /** `goalStep`: move the sequence, and the camera, on to `ms`. */
  step(ms: number): MomentStep {
    const goal = this.goal
    if (!goal) return 'stop'
    if (goal.startedMs === null) goal.startedMs = ms
    goal.elapsedMs = ms - goal.startedMs
    if (goal.elapsedMs >= GOAL_SEQUENCE_MS) return 'stop'
    if (goal.camera) {
      const { from, to } = goal.camera
      this.ctx.showCamera(blendCamera(from, to, goalCameraWeight(goal.elapsedMs)))
    }
    return 'paint'
  }

  /** `stopGoal`: end it, putting the user's view back unless they took it over. A goal waiting for its scorer goes too. */
  stop(): boolean {
    this.pending = null
    const goal = this.goal
    if (!goal) return false
    this.goal = null
    if (goal.camera) this.ctx.showCamera(goal.camera.from)
    return true
  }

  /** `releaseSequenceCamera`: the user has zoomed or panned, so the view is theirs, and stays where they put it. */
  releaseCamera(): void {
    if (this.goal) this.goal.camera = null
  }

  /** What the sequence draws over the frame (`goalOverlay`): its ball, that ball's trail, and the net it hits. */
  overlay(): GoalOverlay | undefined {
    const state = this.state()
    if (!this.goal || !state) return undefined
    return {
      ball: state.ball,
      trail: state.trail,
      net: { side: this.goal.plan.side, y: this.goal.plan.impact.y, metres: state.netBulge },
    }
  }

  /**
   * The goal's banner (`goalBannerValue`): in as the ball reaches the net,
   * sliding in from the side away from the goal, and out as the camera eases
   * back. With reduced motion the ball is in the net from the start, and the
   * banner in place. The reference's card fades in where it stands, and has
   * no side (goalBanner.ts).
   */
  banner(): GoalBanner | undefined {
    const goal = this.goal
    if (!goal) return undefined
    const still = this.ctx.reducedMotion()
    const intensity = still ? 1 : goalBannerIntensity(goal.plan, goal.elapsedMs)
    if (!(intensity > 0)) return undefined
    const banner: GoalBanner = { intensity, side: goal.plan.side, slide: still ? 1 : goalBannerSlide(goal.plan, goal.elapsedMs) }
    if (goal.scorer) {
      const coming = still || goal.scorerFromMs === null ? 1 : clamp01((goal.elapsedMs - goal.scorerFromMs) / GOAL_SCORER_IN_MS)
      banner.scorer = { ...goal.scorer, intensity: Math.min(intensity, coming) }
    }
    return banner
  }

  /** A seek: the goals labelled before it are not the ones a scorer from here belongs to. */
  forget(): void {
    this.pending = null
    this.goalLabelAt = null
  }

  reset(): void {
    this.goal = null
    this.pending = null
    this.labelSeen = false
    this.scorerSeen = false
    this.goalLabelAt = null
  }

  /**
   * A scorer with no goal waiting for them: written under their goal if it plays, nothing if a
   * goal was labelled in the SCORER_AFTER_GOAL_S before, else a goal of their own, from their record.
   */
  private lateScorer(frame: Frame, time: number, scorer: ScorerLabel): GoalStart | null {
    const goal = this.goal
    if (goal) {
      if (!goal.scorer && scorerOf(goal.team, scorer)) {
        goal.scorer = this.named(scorer, goal.team)
        goal.scorerFromMs = goal.elapsedMs
      }
      return null
    }
    if (this.goalLabelAt !== null && Math.abs(time - this.goalLabelAt) <= SCORER_AFTER_GOAL_S) return null
    // Their goal, as if labelled: the same scorer labelled again soon after plays nothing.
    this.goalLabelAt = time
    return { frame, team: scorer.team, scorer }
  }

  /**
   * The scorer in the words drawn: their team's name, and their name or shirt number, as a carded
   * player's (DirectorOptions.playerName). Of the goal's team when their label names none.
   */
  private named(scorer: ScorerLabel, goalTeam: TeamId | null): GoalScorer {
    const team = scorer.team ?? goalTeam
    return {
      team: team === null ? null : this.ctx.teamName(team),
      player: team === null || scorer.number === null ? scorer.name : this.ctx.playerName(team, scorer.number, scorer.name),
    }
  }

  /** With reduced motion the ball is simply in the net. */
  private state(): GoalState | null {
    if (!this.goal) return null
    return goalStateAt(this.goal.plan, this.ctx.reducedMotion() ? GOAL_SEQUENCE_MS : this.goal.elapsedMs)
  }
}
