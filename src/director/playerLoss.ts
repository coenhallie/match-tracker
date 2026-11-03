/**
 * The attack over a player loss, which the reference does not have. When the
 * pipeline loses track of players (analysis/playerLoss.ts), the pitch is left
 * with most of them gone. Rather than show that, the attack is shown over it,
 * for the team the ball is heading for the other team's goal with: the
 * attack's shade, its label and its pulsing ring round the ball, everyone
 * faded out (attackIndicator.ts). The ball is not held, as an attack holds
 * it: play carries on underneath, and the ball is seen moving with it.
 *
 * It starts once fewer than PLAYER_LOSS_BELOW players have been tracked for
 * LOSS_START_S of playback, so a record or two short of players does not
 * flash it on. Which team:
 *
 *  - the one attacking the way the ball is going, along the pitch, over the
 *    last HEADING_WINDOW_S, if it went at least HEADING_MIN_METRES that way;
 *  - otherwise the team that last had the ball;
 *  - otherwise none yet: it is tried again on every record while the loss
 *    lasts.
 *
 * Which way each team attacks is the phase's (teamPhase.ts), and the last
 * one it knew is kept for as long as play runs on, as a long loss can lose
 * the keepers it is read from. The team is chosen once, at the start.
 *
 * It stays for as long as the loss lasts, and goes once a record with enough
 * players has held for LOSS_END_S, fading out over ATTACK_OUT_MS. Waiting on
 * such a record, rather than on time since the last short one, keeps it up
 * while the data stalls on a frame with players missing.
 *
 * It only plays during playback. Anything that means someone wants the real
 * frame stops it, a goal or a corner takes over from it, and an
 * attack the phase calls is shown instead of it, not over it.
 */
import { trackedPlayers, PLAYER_LOSS_BELOW } from '../analysis/playerLoss.js'
import type { TeamId } from '../analysis/teamPhase.js'
import type { Frame } from '../model/types.js'
import { ATTACK_IN_MS, ATTACK_OUT_MS, ATTACK_PULSE_MS, type AttackIndicator } from '../render/attackIndicator.js'
import { resolvePitchDimensions } from '../render/pitchGeometry.js'
import type { AttackTarget } from './attack.js'
import { shownBall } from './ballRoll.js'
import type { Moment, MomentContext, MomentStep } from './moment.js'

/** How long, in seconds of playback, a loss lasts before it is covered. */
export const LOSS_START_S = 0.3
/** How long, in seconds of playback, enough players are back before the cover goes. */
export const LOSS_END_S = 0.5
/** How far back, in seconds, the ball's path says which way it is heading. */
export const HEADING_WINDOW_S = 0.6
/** How far along the pitch, in metres, the ball has to go over that window to be heading somewhere. */
export const HEADING_MIN_METRES = 1
/** A ball sample this far past the pitch's lines, in metres, is the tracking's mistake, not the ball. */
const PITCH_MARGIN_METRES = 3
/** Further than this between two samples, in metres, the tracked ball jumped, and its path starts again. */
const BALL_JUMP_METRES = 3
/** The ball's path needs at least this much time in it, in seconds, to say anything. */
const HEADING_MIN_SPAN_S = 0.2

const TEAMS: readonly TeamId[] = [0, 1]

interface Sample {
  x: number
  y: number
  at: number
}

interface Showing extends AttackTarget {
  startedMs: number | null
  elapsedMs: number
  /** When it started to fade out, in ms from its start; null until then. */
  leavingFromMs: number | null
}

/** What a player loss on the record on screen is, for the debug badge. */
export interface PlayerLossState {
  /** The players tracked on the record on screen. */
  players: number
  /** The team whose attack covers it, or null when none does. */
  cover: TeamId | null
}

export class PlayerLoss implements Moment {
  private cover: Showing | null = null
  /** The replay time the loss under way began at, during playback, or null. */
  private lossSince: number | null = null
  /** While covering, the replay time enough players came back at, or null. */
  private fullSince: number | null = null
  /** The ball's recent path on the pitch, oldest first. */
  private path: Sample[] = []
  private lastPossession: TeamId | null = null
  private lastAttacks: Record<TeamId, 1 | -1 | null> = { 0: null, 1: null }

  constructor(private readonly ctx: MomentContext) {}

  get active(): boolean {
    return this.cover !== null
  }

  /**
   * Note the players, the ball and the phase on `frame`, a new record, and
   * whether the loss under way is to be covered now, and by whom. Called for
   * every new record, after the attack; `blocked` is any other moment but a
   * throw-in showing.
   */
  detect(frame: Frame, now: number, blocked: boolean): AttackTarget | null {
    if (!this.ctx.playback()) {
      this.forget()
      return null
    }
    this.notePhase()
    this.noteBall(frame, now)
    const loss = trackedPlayers(frame) < PLAYER_LOSS_BELOW
    if (loss) {
      this.lossSince ??= now
      this.fullSince = null
    } else {
      this.lossSince = null
      if (this.cover) this.fullSince ??= now
    }
    if (!loss || this.cover || blocked || !this.ctx.layers().playerLoss) return null
    if (now - this.lossSince! < LOSS_START_S) return null
    return this.target()
  }

  /** Cover the loss with `target`'s attack. */
  start(target: AttackTarget): void {
    this.cover = { ...target, startedMs: null, elapsedMs: 0, leavingFromMs: null }
  }

  step(ms: number): MomentStep {
    const cover = this.cover
    if (!cover) return 'stop'
    if (cover.startedMs === null) cover.startedMs = ms
    cover.elapsedMs = ms - cover.startedMs
    const over = this.fullSince !== null && this.ctx.shown().time - this.fullSince >= LOSS_END_S
    if (cover.leavingFromMs === null && over) {
      if (this.ctx.reducedMotion()) return 'stop'
      cover.leavingFromMs = cover.elapsedMs
    }
    if (cover.leavingFromMs !== null && cover.elapsedMs - cover.leavingFromMs >= ATTACK_OUT_MS) return 'stop'
    return 'paint'
  }

  /** End it at once, back to the frame as it is. */
  stop(): boolean {
    if (!this.cover) return false
    this.cover = null
    this.fullSince = null
    return true
  }

  /** What is drawn for it now: the attack's look, with the ball left to play. */
  value(): AttackIndicator | undefined {
    const m = this.cover
    if (!m) return undefined
    const e = m.elapsedMs
    const still = this.ctx.reducedMotion()
    const coming = Math.min(1, e / ATTACK_IN_MS)
    const leaving = !still && m.leavingFromMs !== null
    const going = leaving ? Math.max(0, 1 - (e - m.leavingFromMs!) / ATTACK_OUT_MS) : 1
    return {
      team: m.team,
      color: m.color,
      name: this.ctx.teamName(m.team),
      direction: m.direction,
      intensity: still ? 1 : leaving ? going : coming,
      leaving,
      playersFade: still ? 1 : leaving ? going : Math.max(0, coming * 2 - 1),
      ...(still ? {} : { pulse: (e / ATTACK_PULSE_MS) % 1 }),
    }
  }

  /** The loss on `frame`, the record on screen, if it is one: its players, and who covers it. */
  state(frame: Frame): PlayerLossState | null {
    const players = trackedPlayers(frame)
    if (players >= PLAYER_LOSS_BELOW) return null
    return { players, cover: this.cover?.team ?? null }
  }

  reset(): void {
    this.cover = null
    this.forget()
  }

  /** The team to cover with, as the top says, or null when nothing says yet. */
  private target(): AttackTarget | null {
    const attacks = { ...this.lastAttacks }
    // One team's direction gives the other's.
    if (attacks[0] === null && attacks[1] !== null) attacks[0] = attacks[1] === 1 ? -1 : 1
    if (attacks[1] === null && attacks[0] !== null) attacks[1] = attacks[0] === 1 ? -1 : 1
    const heading = this.heading()
    const team = heading !== null ? (TEAMS.find((t) => attacks[t] === heading) ?? null) : this.lastPossession
    if (team === null) return null
    const direction = attacks[team]
    if (direction === null) return null
    return { team, direction, color: this.ctx.teamColor(team) }
  }

  /** Which way along the pitch the ball is going, or null when it is not clearly going either way. */
  private heading(): 1 | -1 | null {
    const newest = this.path.at(-1)
    if (!newest) return null
    const oldest = this.path.find((s) => newest.at - s.at <= HEADING_WINDOW_S)!
    if (newest.at - oldest.at < HEADING_MIN_SPAN_S) return null
    const dx = newest.x - oldest.x
    return Math.abs(dx) >= HEADING_MIN_METRES ? (dx > 0 ? 1 : -1) : null
  }

  private notePhase(): void {
    const phase = this.ctx.shown().phase
    if (!phase) return
    if (phase.possession !== null) this.lastPossession = phase.possession
    for (const team of TEAMS) {
      const direction = phase.attacks[team]
      if (direction !== null) this.lastAttacks[team] = direction
    }
  }

  private noteBall(frame: Frame, now: number): void {
    // Only the last window matters, ball or no ball.
    this.path = this.path.filter((s) => now - s.at <= HEADING_WINDOW_S)
    const ball = shownBall(frame, undefined)
    if (!ball) return
    const R = resolvePitchDimensions(frame.pitch_dimensions)
    const onPitch =
      Math.abs(ball.x) <= R.length.value / 2 + PITCH_MARGIN_METRES &&
      Math.abs(ball.y) <= R.width.value / 2 + PITCH_MARGIN_METRES
    if (!onPitch) return
    const last = this.path.at(-1)
    if (last && Math.hypot(ball.x - last.x, ball.y - last.y) > BALL_JUMP_METRES) this.path = []
    this.path.push({ x: ball.x, y: ball.y, at: now })
  }

  /** Forget the loss, the ball's path and the phase it knew: after a seek, or for a new match. */
  forget(): void {
    this.lossSince = null
    this.fullSince = null
    this.path = []
    this.lastPossession = null
    this.lastAttacks = { 0: null, 1: null }
  }
}
