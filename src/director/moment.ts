/**
 * The seam between the director and its moments (goal.ts, attack.ts,
 * freeKick.ts, throwIn.ts): what a moment is to the director, and what the
 * director lends each moment to read and act through. See "The moments" in
 * director.ts.
 */
import type { BallTrail } from '../analysis/ballTrail.js'
import type { Spin } from '../analysis/football.js'
import type { TeamId, TeamPhase } from '../analysis/teamPhase.js'
import type { ReplayLayers } from '../model/replayLayers.js'
import type { TrackerRecord } from '../model/types.js'
import type { Camera, PipelineView } from '../render/viewTransform.js'

/** What a moment's animation frame did: painted and wants another frame, or is over. */
export type MomentStep = 'paint' | 'stop'

/** A moment, as the director drives it. */
export interface Moment {
  /** The reference's `x !== null || xRaf !== null`: showing, or waiting on its first frame. */
  readonly active: boolean
  /** Its animation frame callback, at the frame's timestamp. */
  step(nowMs: number): MomentStep
  /** End it at once; true when it was active, and the director then paints, as `stopX` does. */
  stop(): boolean
  /** Forget it, and anything it remembers, without a paint: for a new match. */
  reset(): void
}

/** The replay's refs, as the watchers running now read them. */
export interface ShownReplay {
  time: number
  playing: boolean
  record: TrackerRecord | null
  phase: TeamPhase | null
  trail: BallTrail | null
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

/** What the director lends a moment: the surface's state that the reference's moment code reads and writes. */
export interface MomentContext {
  shown(): ShownReplay
  /** `lastStepWasPlayback`: whether the clock's last move was playback. */
  playback(): boolean
  layers(): ReplayLayers
  memory(): MomentMemory
  /** How the ball is turned now (`ballSpin`). */
  spin(): Spin
  /** The user's view: the surface's zoom and pan, and the width the frame is drawn at. */
  view(): PipelineView
  /** Asked afresh at every use, as the reference queries the media query each time. */
  reducedMotion(): boolean
  teamName(team: TeamId): string
  teamColor(team: TeamId): string
  /** `showCamera`: put the user's view on `camera`. The view reaches the renderer at the next flush. */
  showCamera(camera: Camera): void
}
