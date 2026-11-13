/**
 * The corner, which the reference does not have: built on the reference's
 * free kick, which the widget does not show, on its card and held as it
 * was, with the corner it is taken from lit up as a cone (corner.ts in
 * render).
 *
 * When playback runs into a frame the pipeline labels a corner, "CORNER" is
 * shown across the middle of the pitch, fading in as everyone on the pitch
 * fades out, and the corner's sections light up one after another from the
 * flag outwards, again and again while it shows.
 *
 * The corner lit up is the one its label names (cornerLabel): the labelling
 * tool has a button for each. Where the ball is plays no part, as a corner is
 * mostly prepared off camera, with the ball lost or somewhere else. A label
 * that names no corner, as the exports' do, shows the card alone.
 *
 * The team taking it is written under the card, by the name the host gives it
 * (teamName), when its label says which team (cornerLabel): the labelling
 * tool's do, the exports' do not.
 *
 * A corner is usually prepared off camera, so it is held for at least
 * CORNER_SHOW_MS, and after that for as long as the label is on or play is
 * stopped (setPieceUnderWay, setPiece.ts). It is shown once per corner,
 * as the label flickers (CORNER_REARM_S), only during playback, and anything
 * that means someone wants the real frame stops it at once. Played by hand,
 * it is on screen for CORNER_DEMO_MS whatever play does.
 */
import type { Frame, TrackerRecord } from '../model/types.js'
import { cornerLabel, isCornerFrame } from '../analysis/cornerLabel.js'
import type { TeamId } from '../analysis/teamPhase.js'
import { CORNER_REARM_S, cornerSections, type CornerBanner } from '../render/corner.js'
import { playMoved } from '../analysis/stoppage.js'
import { clockIntensity, startClock, stepClock, type SetPieceClock } from './setPiece.js'
import type { Moment, MomentContext, MomentStep } from './moment.js'

interface Showing extends SetPieceClock {
  corner: CornerBanner['corner']
  /** The name of the team taking it, as drawn, or null for none. */
  team: string | null
}

export class Corner implements Moment {
  private corner: Showing | null = null

  constructor(private readonly ctx: MomentContext) {}

  get active(): boolean {
    return this.corner !== null
  }

  /**
   * Note whether play moved on `frame`, and whether it is a corner that
   * playback has just run into. Called for every new record, after the goal
   * has had its say; `blocked` is a goal showing. The director stops the
   * attack, the attack over a player loss and the throw-in, then calls
   * `start`.
   */
  detect(frame: Frame, prevFrame: Frame | null, now: number, blocked: boolean): boolean {
    const memory = this.ctx.memory()
    const playback = this.ctx.playback()
    if (!playback || !prevFrame || playMoved(prevFrame, frame)) memory.playMovedAt = now
    const labelled = isCornerFrame(frame)
    // Landed on by a seek or a step: a corner under way has been seen.
    if (!playback) {
      memory.cornerLabelAt = labelled ? now : null
      return false
    }
    if (!labelled) return false
    const fresh = memory.cornerLabelAt === null || now - memory.cornerLabelAt > CORNER_REARM_S
    memory.cornerLabelAt = now
    return fresh && this.ctx.layers().corner && !blocked && !this.corner
  }

  /**
   * Show it at the corner the label on `record` names, or as the card alone
   * when it names none, with the team the label names under it. Played by
   * hand, there is no label to go by unless the record on screen carries one:
   * the team is then `team`, the one it was played for.
   */
  start(record: TrackerRecord, byHand = false, team: TeamId | null = null): void {
    const label = cornerLabel(record)
    const taking = label?.team ?? (byHand ? team : null)
    this.corner = {
      ...startClock(byHand),
      corner: label?.side ?? null,
      team: taking === null ? null : this.ctx.teamName(taking),
    }
  }

  step(ms: number): MomentStep {
    return this.corner ? stepClock(this.ctx, this.corner, this.ctx.memory().cornerLabelAt, ms) : 'stop'
  }

  /** End it at once, back to the frame as it is. */
  stop(): boolean {
    if (!this.corner) return false
    this.corner = null
    return true
  }

  /** What is drawn for it now, with the theme's icon. */
  value(): CornerBanner | undefined {
    const m = this.corner
    if (!m) return undefined
    const still = this.ctx.reducedMotion()
    const intensity = clockIntensity(this.ctx, m)
    return {
      intensity,
      playersFade: intensity,
      ballFade: intensity,
      corner: m.corner,
      team: m.team,
      sections: cornerSections(m.elapsedMs, still),
    }
  }

  reset(): void {
    this.corner = null
  }
}
