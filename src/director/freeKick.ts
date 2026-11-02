/**
 * The free kick, ported from PipelineOutputSurface.vue (6f14d1f) :802-905.
 *
 * When playback runs into a frame the pipeline labels a free kick, "FREE
 * KICK" is shown across the middle of the pitch, fading in as everyone on the
 * pitch fades out (freeKick.ts in render).
 *
 * A free kick is usually prepared off camera, and while the broadcast is away
 * the data stops: it loses the ball, then repeats everyone's last positions,
 * or has no records at all, and the pitch stands still. So the banner stays
 * for at least FREE_KICK_SHOW_MS, and after that for as long as the label is
 * on or play is stopped; once neither is true, with everyone moving and the
 * ball back, it fades out onto play as it is.
 *
 * The label flickers on and off over a few records around one free kick, so
 * it is shown once, the first time it is seen after being off for
 * FREE_KICK_REARM_S. It only ever plays during playback, anything that means
 * someone wants the real frame stops it at once, and a free kick a seek or a
 * step lands in is not shown when play then carries on. Played by hand, it is
 * on screen for FREE_KICK_DEMO_MS whatever play does.
 */
import type { Frame } from '../model/types'
import {
  FREE_KICK_DEMO_MS,
  FREE_KICK_IN_MS,
  FREE_KICK_LABEL_HOLD_S,
  FREE_KICK_OUT_MS,
  FREE_KICK_REARM_S,
  FREE_KICK_SHOW_MS,
  FREE_KICK_STALL_S,
  isFreeKickFrame,
  playMoved,
  type FreeKickBanner,
} from '../render/freeKick'
import { shownBall } from './ballRoll'
import type { Moment, MomentContext, MomentStep } from './moment'

interface Showing {
  startedMs: number | null
  elapsedMs: number
  /** When it started to fade out, in ms from its start; null until then. */
  leavingFromMs: number | null
  /** Played by hand: on screen for FREE_KICK_DEMO_MS, whatever play does. */
  byHand: boolean
}

export class FreeKick implements Moment {
  private freeKick: Showing | null = null

  constructor(private readonly ctx: MomentContext) {}

  get active(): boolean {
    return this.freeKick !== null
  }

  /**
   * `freeKickUnderWay`: whether the free kick is still being taken: its label
   * is on, nobody has moved for FREE_KICK_STALL_S of replay time, or the ball
   * is not tracked.
   */
  underWay(): boolean {
    const { time: now, record } = this.ctx.shown()
    const { freeKickLabelAt, playMovedAt } = this.ctx.memory()
    const labelOn = freeKickLabelAt !== null && now - freeKickLabelAt < FREE_KICK_LABEL_HOLD_S
    const ballGone = !record || shownBall(record.frame, undefined) === null
    return labelOn || ballGone || now - playMovedAt >= FREE_KICK_STALL_S
  }

  /**
   * `updateFreeKick`, up to its start: note whether play moved on `frame`,
   * and whether it is a free kick that playback has just run into. Called for
   * every new record, after the goal has had its say; `goalShowing` holds it
   * back. The director stops the attack and the throw-in, then calls `start`.
   */
  detect(frame: Frame, prevFrame: Frame | null, now: number, goalShowing: boolean): boolean {
    const memory = this.ctx.memory()
    const playback = this.ctx.playback()
    if (!playback || !prevFrame || playMoved(prevFrame, frame)) memory.playMovedAt = now
    const labelled = isFreeKickFrame(frame)
    // Landed on by a seek or a step: a free kick under way has been seen.
    if (!playback) {
      memory.freeKickLabelAt = labelled ? now : null
      return false
    }
    if (!labelled) return false
    const fresh = memory.freeKickLabelAt === null || now - memory.freeKickLabelAt > FREE_KICK_REARM_S
    memory.freeKickLabelAt = now
    return fresh && this.ctx.layers().freeKick && !goalShowing && !this.freeKick
  }

  /** `startFreeKick`. */
  start(byHand = false): void {
    this.freeKick = { startedMs: null, elapsedMs: 0, leavingFromMs: null, byHand }
  }

  /** `freeKickStep`. */
  step(ms: number): MomentStep {
    const freeKick = this.freeKick
    if (!freeKick) return 'stop'
    if (freeKick.startedMs === null) freeKick.startedMs = ms
    freeKick.elapsedMs = ms - freeKick.startedMs
    const still = this.ctx.reducedMotion()
    const over = freeKick.byHand
      ? freeKick.elapsedMs >= FREE_KICK_DEMO_MS - (still ? 0 : FREE_KICK_OUT_MS)
      : freeKick.elapsedMs >= FREE_KICK_SHOW_MS && !this.underWay()
    if (freeKick.leavingFromMs === null && over) {
      if (this.ctx.reducedMotion()) return 'stop'
      freeKick.leavingFromMs = freeKick.elapsedMs
    }
    if (freeKick.leavingFromMs !== null && freeKick.elapsedMs - freeKick.leavingFromMs >= FREE_KICK_OUT_MS) {
      return 'stop'
    }
    return 'paint'
  }

  /** `stopFreeKick`: end it at once, back to the frame as it is. */
  stop(): boolean {
    if (!this.freeKick) return false
    this.freeKick = null
    return true
  }

  /** `freeKickValue`: what is drawn for it now, with the theme's icon. */
  value(): FreeKickBanner | undefined {
    const m = this.freeKick
    if (!m) return undefined
    const intensity = this.ctx.reducedMotion()
      ? 1
      : m.leavingFromMs !== null
        ? Math.max(0, 1 - (m.elapsedMs - m.leavingFromMs) / FREE_KICK_OUT_MS)
        : Math.min(1, m.elapsedMs / FREE_KICK_IN_MS)
    return { intensity, playersFade: intensity }
  }

  reset(): void {
    this.freeKick = null
  }
}
