/**
 * The free kick, the widget's own (freeKick.ts in render): video-annotation's, a card across the
 * middle, was dropped in 0.2.0. Built on the corner's timing and fade (setPiece.ts, corner.ts).
 *
 * When playback runs into a frame a human labelled a free kick, the card fades in in the half of
 * the pitch without the ball, that half is shaded, and a pulse marks where the ball was, as
 * everyone on the pitch and the ball fade out. The ball is the one on the labelled record, or,
 * with none tracked there, the last one tracked within BALL_MEMORY_S before it, as the throw-in
 * goes by; with neither, the card is shown alone across the middle. Where it was is kept: the
 * pulse does not follow the ball. The team taking it is written under the card when its label
 * says which (`team_id`).
 *
 * It is held as the corner is: for at least CORNER_SHOW_MS, and after that for as long as the
 * label is on or play is stopped. It is shown once per free kick as the label flickers
 * (CORNER_REARM_S), only during playback, and anything that means someone wants the real frame
 * stops it at once. Played by hand, it is on screen for CORNER_DEMO_MS whatever play does, at the
 * ball on screen, for the team the label on screen gives, else the one it was played for.
 */
import { freeKickTeam, isFreeKickFrame } from '../analysis/freeKickLabel.js'
import type { TeamId } from '../analysis/teamPhase.js'
import type { TrackerRecord } from '../model/types.js'
import { CORNER_REARM_S, cornerSections } from '../render/corner.js'
import type { FreeKickBanner } from '../render/freeKick.js'
import { shownBall } from './ballRoll.js'
import { clockIntensity, startClock, stepClock, type SetPieceClock } from './setPiece.js'
import { BALL_MEMORY_S } from './throwIn.js'
import { teamWords, type Moment, type MomentContext, type MomentStep } from './moment.js'

interface Showing extends SetPieceClock {
  ball: FreeKickBanner['ball']
  /** The name of the team taking it, as drawn, or null for none. */
  team: string | null
}

export class FreeKick implements Moment {
  private freeKick: Showing | null = null

  constructor(private readonly ctx: MomentContext) {}

  get active(): boolean {
    return this.freeKick !== null
  }

  /**
   * Whether `record` is a free kick that playback has just run into. Called for every new record,
   * after the goal and the corner have had theirs; `blocked` is a goal showing. The director stops
   * what it takes over from, then calls `start`.
   */
  detect(record: TrackerRecord, now: number, blocked: boolean): boolean {
    const memory = this.ctx.memory()
    const labelled = isFreeKickFrame(record.frame)
    // Landed on by a seek or a step: a free kick under way has been seen.
    if (!this.ctx.playback()) {
      memory.freeKickLabelAt = labelled ? now : null
      return false
    }
    if (!labelled) return false
    const fresh = memory.freeKickLabelAt === null || now - memory.freeKickLabelAt > CORNER_REARM_S
    memory.freeKickLabelAt = now
    return fresh && this.ctx.layers().freeKickBanner && !blocked && !this.freeKick
  }

  /**
   * Show it for `record`, at `now`: at the ball on it, or the last one tracked shortly before,
   * for the team its label gives. Played by hand, for `team` when the label on screen gives none.
   */
  start(record: TrackerRecord, now: number, byHand = false, team: TeamId | null = null): void {
    const here = shownBall(record.frame, undefined)
    const { lastBall } = this.ctx.memory()
    const recent = lastBall && now - lastBall.at <= BALL_MEMORY_S ? { x: lastBall.x, y: lastBall.y } : null
    const label = freeKickTeam(record.frame)
    const said = label.team !== null || label.teamName !== null
    const taking = said ? label : { team: byHand ? team : null, teamName: null }
    this.freeKick = {
      ...startClock(byHand),
      ball: here ? { x: here.x, y: here.y } : recent,
      team: teamWords(this.ctx, taking),
    }
  }

  step(ms: number): MomentStep {
    return this.freeKick ? stepClock(this.ctx, this.freeKick, this.ctx.memory().freeKickLabelAt, ms) : 'stop'
  }

  /** End it at once, back to the frame as it is. */
  stop(): boolean {
    if (!this.freeKick) return false
    this.freeKick = null
    return true
  }

  /** What is drawn for it now, with the theme's icon. */
  value(): FreeKickBanner | undefined {
    const m = this.freeKick
    if (!m) return undefined
    const intensity = clockIntensity(this.ctx, m)
    return {
      intensity,
      playersFade: intensity,
      ballFade: intensity,
      ball: m.ball,
      team: m.team,
      rings: cornerSections(m.elapsedMs, this.ctx.reducedMotion()),
    }
  }

  reset(): void {
    this.freeKick = null
  }
}
