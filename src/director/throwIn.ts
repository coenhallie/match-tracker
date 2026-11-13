/**
 * The throw-in, ported from PipelineOutputSurface.vue (6f14d1f) :937-1016.
 *
 * When playback runs into a frame the pipeline labels a throw-in, a small
 * "THROW IN" band fades in along the bottom touchline, stays until
 * THROW_IN_SHOW_MS from the start, and fades out (throwIn.ts in render). The
 * players are left as they are.
 *
 * The reference's slides in, and back out, from the side of the half the ball
 * is in, as the export does not say which team takes a throw-in: the ball on
 * the frame, or the last one tracked within BALL_MEMORY_S, as the ball is
 * often lost as it goes out. With no ball to go by it fades in where it
 * stands. The widget's always fades in where it stands, but still works out
 * the side, which its value carries (`inPlace`), so the parity test can draw
 * the reference's from it.
 *
 * Shown once per throw-in, as the label flickers (THROW_IN_REARM_S). It only
 * plays during playback, anything that means someone wants the real frame
 * stops it, and a corner or a goal takes over from it.
 *
 * ## The card, for a throw-in the camera cuts away from
 *
 * The widget's own (Figma "Game Animation Visualizer", viewport/eventThrowInExclusive): a throw-in
 * can be taken at once, or take a while, and then the camera often cuts away. Live, the record the
 * throw-in is labelled on says which: its lookahead says when the next invalid record is due. With
 * one due within THROW_IN_CUTAWAY_S, or the record itself invalid, the throw-in is a card across the
 * middle instead of the band, "THROW IN" over its icon, with the team its label gives under it, and
 * a pulse on the touchline where the ball went out, as everyone on the pitch and the ball fade out.
 * Where the ball went out is the ball on the record, or the last one tracked within BALL_MEMORY_S,
 * on the touchline nearest it; with neither, the card shows alone. It is held as a set piece is
 * (setPiece.ts), for at least CORNER_SHOW_MS, and after that for as long as the camera is away, or
 * the cutaway it was played for is still to come, up to THROW_IN_CUTAWAY_S after its label. Replay
 * data says nothing of its validity, so there the throw-in is always the band, the reference's.
 */
import { labelTeam } from '../analysis/cardLabels.js'
import { resolvePitchDimensions } from '../model/pitch.js'
import type { Frame, TrackerRecord } from '../model/types.js'
import { cornerSections } from '../render/corner.js'
import {
  THROW_IN_IN_MS,
  THROW_IN_OUT_MS,
  THROW_IN_REARM_S,
  THROW_IN_SHOW_MS,
  THROW_IN_LABELS,
  isThrowInFrame,
  type ThrowInIndicator,
} from '../render/throwIn.js'
import type { ThrowInCard } from '../render/throwInCard.js'
import { shownBall } from './ballRoll.js'
import { clockIntensity, startClock, stepClock, type SetPieceClock } from './setPiece.js'
import { teamWords, type Moment, type MomentContext, type MomentStep } from './moment.js'

/** How long, in seconds of replay time, the last tracked ball says which half play is in. */
export const BALL_MEMORY_S = 5

/**
 * A throw-in is the card when the camera cuts away within this, in seconds of the clock, of its
 * label: an invalid record is due by then, as the record's lookahead says, or the record is one.
 */
export const THROW_IN_CUTAWAY_S = 3

/** The card showing: where the ball went out, the team, and when its label came. */
interface CardShowing extends SetPieceClock {
  spot: ThrowInCard['spot']
  team: string | null
  labelAt: number
  /** Whether the camera has been away since it started. */
  cutawaySeen: boolean
}

interface Showing {
  side: -1 | 1 | null
  startedMs: number | null
  elapsedMs: number
}

export class ThrowIn implements Moment {
  private throwIn: Showing | null = null
  private card: CardShowing | null = null

  constructor(private readonly ctx: MomentContext) {}

  get active(): boolean {
    return this.throwIn !== null || this.card !== null
  }

  /**
   * `updateThrowIn`, up to its start: note where the ball is on `frame`, and
   * whether it is a throw-in that playback has just run into. Called for
   * every new record, after the corner has had its say; `blocked` is a
   * goal or a corner showing.
   */
  detect(frame: Frame, now: number, blocked: boolean): boolean {
    const memory = this.ctx.memory()
    const ball = shownBall(frame, undefined)
    if (ball) memory.lastBall = { x: ball.x, y: ball.y, at: now }
    const labelled = isThrowInFrame(frame)
    // Landed on by a seek or a step: a throw-in under way has been seen.
    if (!this.ctx.playback()) {
      memory.throwInLabelAt = labelled ? now : null
      return false
    }
    if (!labelled) return false
    const fresh = memory.throwInLabelAt === null || now - memory.throwInLabelAt > THROW_IN_REARM_S
    memory.throwInLabelAt = now
    return fresh && this.ctx.layers().throwInBanner && !blocked && !this.active
  }

  /**
   * `startThrowIn`: note the half the ball is in, or was last tracked in, as of `now`. For a throw-in
   * labelled on `record` that the camera cuts away from, the card instead (see "The card" above).
   * Played by hand, with no `record`, the band.
   */
  start(now: number, record?: TrackerRecord): void {
    const { lastBall } = this.ctx.memory()
    const recent = lastBall && now - lastBall.at <= BALL_MEMORY_S ? lastBall : null
    if (record && cutAway(record)) {
      const team = labelTeam(record.frame, THROW_IN_LABELS)
      this.card = {
        ...startClock(false),
        spot: recent ? onTouchline(recent, record.frame) : null,
        team: teamWords(this.ctx, team),
        labelAt: now,
        cutawaySeen: false,
      }
      return
    }
    this.throwIn = { side: recent ? (recent.x < 0 ? -1 : 1) : null, startedMs: null, elapsedMs: 0 }
  }

  /** `throwInStep`. */
  step(ms: number): MomentStep {
    const card = this.card
    if (card) {
      if (cameraAway(this.ctx)) card.cutawaySeen = true
      return stepClock(this.ctx, card, card.labelAt, ms, () => this.cardUnderWay(card))
    }
    const throwIn = this.throwIn
    if (!throwIn) return 'stop'
    if (throwIn.startedMs === null) throwIn.startedMs = ms
    throwIn.elapsedMs = ms - throwIn.startedMs
    const end = this.ctx.reducedMotion() ? THROW_IN_SHOW_MS : THROW_IN_SHOW_MS + THROW_IN_OUT_MS
    return throwIn.elapsedMs >= end ? 'stop' : 'paint'
  }

  /** `stopThrowIn`: end it at once, back to the frame as it is. */
  stop(): boolean {
    if (!this.active) return false
    this.throwIn = null
    this.card = null
    return true
  }

  /** `throwInValue`: what is drawn for it now. */
  value(): ThrowInIndicator | undefined {
    const m = this.throwIn
    if (!m) return undefined
    if (this.ctx.reducedMotion()) return { intensity: 1, slide: 1, side: null, inPlace: true }
    const e = m.elapsedMs
    const k =
      e >= THROW_IN_SHOW_MS
        ? Math.max(0, 1 - (e - THROW_IN_SHOW_MS) / THROW_IN_OUT_MS)
        : Math.min(1, e / THROW_IN_IN_MS)
    return { intensity: k, slide: k, side: m.side, inPlace: true }
  }

  /** The card's value: what is drawn for it now, with the theme's icon. */
  cardValue(): ThrowInCard | undefined {
    const m = this.card
    if (!m) return undefined
    const intensity = clockIntensity(this.ctx, m)
    return {
      intensity,
      playersFade: intensity,
      ballFade: intensity,
      spot: m.spot,
      team: m.team,
      rings: cornerSections(m.elapsedMs, this.ctx.reducedMotion()),
    }
  }

  reset(): void {
    this.throwIn = null
    this.card = null
  }

  /**
   * Whether the card's throw-in is still under way: the camera is away, or the cutaway it was
   * played for is still to come, up to THROW_IN_CUTAWAY_S after its label.
   */
  private cardUnderWay(card: CardShowing): boolean {
    return cameraAway(this.ctx) || (!card.cutawaySeen && this.ctx.shown().time - card.labelAt < THROW_IN_CUTAWAY_S)
  }
}

/** Whether the camera is away: the record on screen is invalid. */
const cameraAway = (ctx: MomentContext) => ctx.shown().record?.validity?.invalid === true

/** Whether the camera cuts away from a throw-in labelled on `record`: it is invalid, or one is due within THROW_IN_CUTAWAY_S. */
function cutAway(record: TrackerRecord): boolean {
  const validity = record.validity
  if (!validity) return false
  if (validity.invalid) return true
  return validity.nextInvalidInS !== null && validity.nextInvalidInS <= THROW_IN_CUTAWAY_S
}

/** Where a ball at `ball` went out for a throw-in: along the pitch where it is, on the touchline nearest it. */
function onTouchline(ball: { x: number; y: number }, frame: Frame): { x: number; y: number } {
  const dims = resolvePitchDimensions(frame.pitch_dimensions)
  const halfLength = dims.length.value / 2
  const halfWidth = dims.width.value / 2
  return { x: Math.min(halfLength, Math.max(-halfLength, ball.x)), y: ball.y < 0 ? -halfWidth : halfWidth }
}
