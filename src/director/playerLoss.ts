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
 *
 * ## Over invalid frames
 *
 * In live mode (`coverInvalidFrames`) it also covers the records the pipeline
 * marks invalid (RecordValidity): while its camera is away it sends every
 * player and the ball, but made up. The widget shows the last valid record's
 * positions instead (LiveHistory.shown), and this covers them. A run of 5 s or
 * more plays flashbacks instead, earlier clips of live play, while the
 * `flashback` layer is on (src/director/flashback.ts). This attack is the
 * fallback under them, for a run with no clip ready and for the rest of a run
 * once its clips run out, and the cover for shorter runs.
 *
 *  - It starts on an invalid record that says the run lasts MIN_STRETCH_S or
 *    more (its lookahead's `next_valid_in_s`), or does not say: a shorter run
 *    is left uncovered, on the last valid positions the widget holds. Not
 *    sooner, though the lookahead warns of a run before it starts: only its
 *    first record tells how long it is. No LOSS_START_S wait either: the
 *    pipeline says what it is, it is not guessed from a record or two.
 *  - The team is chosen as above, from real records only, and failing both,
 *    from the last valid frame: the team attacking the half the ball is in.
 *  - It goes, fading out, from the first valid record with no invalid one due
 *    within MERGE_GAP_S, so a short valid gap between two stretches does not
 *    blink it off and on, however short the next run. An invalid record while
 *    it fades starts it again, if that run is long enough.
 *
 * `state` tells the debug badge which of the two it covers.
 */
import { trackedPlayers, PLAYER_LOSS_BELOW } from '../analysis/playerLoss.js'
import type { TeamId } from '../analysis/teamPhase.js'
import type { Frame, RecordValidity, TrackerRecord } from '../model/types.js'
import { ATTACK_IN_MS, ATTACK_OUT_MS, ATTACK_PULSE_MS, type AttackIndicator } from '../render/attackIndicator.js'
import type { AttackTarget } from './attack.js'
import { shownBall } from './ballRoll.js'
import type { Moment, MomentContext, MomentStep } from './moment.js'
import { resolvePitchDimensions } from '../model/pitch.js'

/** How long, in seconds of playback, a loss lasts before it is covered. */
export const LOSS_START_S = 0.3
/** How long, in seconds of playback, enough players are back before the cover goes. */
export const LOSS_END_S = 0.5
/** A run of invalid records shorter than this, in seconds, is not covered, unless covered already. */
export const MIN_STRETCH_S = 1
/** A run of valid records shorter than this, in seconds, between two invalid ones stays covered. */
export const MERGE_GAP_S = 1.5
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

/** What it covers: too few players tracked, or the records the pipeline marks invalid. */
export type LossCause = 'playerLoss' | 'invalidFrames'

interface Showing extends AttackTarget {
  cause: LossCause
  startedMs: number | null
  elapsedMs: number
  /** When it started to fade out, in ms from its start; null until then. */
  leavingFromMs: number | null
}

/** What a player loss on the record on screen is, for the debug badge. */
export interface PlayerLossState {
  /** Why: too few players, or an invalid record (or the attack over invalid ones fading in or out). */
  cause: LossCause
  /** The players tracked on the record on screen. */
  players: number
  /**
   * While the record on screen is invalid: seconds until the next valid one, or null when none
   * is due within `horizonS`. Absent otherwise.
   */
  validInS?: number | null
  /** How far ahead `validInS` sees, when the record says. */
  horizonS?: number
  /** The run of invalid records is shorter than MIN_STRETCH_S, and so not covered. */
  short?: true
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
  /** Whether the last record needs covering for invalid frames: one, or one coming soon. */
  private invalidDue = false

  /** `coverInvalidFrames`: cover invalid records too, as only live mode has them. */
  constructor(
    private readonly ctx: MomentContext,
    private readonly coverInvalidFrames = false,
  ) {}

  get active(): boolean {
    return this.cover !== null
  }

  /**
   * Note the players, the ball and the phase on `record`, a new one, and
   * whether the loss under way is to be covered now, and by whom. Called for
   * every new record, after the attack; `blocked` is any other moment but a
   * throw-in showing.
   */
  detect(record: TrackerRecord, now: number, blocked: boolean): (AttackTarget & { cause: LossCause }) | null {
    if (!this.ctx.playback()) {
      this.forget()
      return null
    }
    const frame = record.frame
    this.invalidDue = this.coverInvalidFrames && this.dueInvalid(record.validity)
    // Made-up positions say nothing about where play is going.
    if (!(this.coverInvalidFrames && record.validity?.invalid)) {
      this.notePhase()
      this.noteBall(frame, now)
    }
    const loss = trackedPlayers(frame) < PLAYER_LOSS_BELOW
    if (loss) {
      this.lossSince ??= now
      this.fullSince = null
    } else {
      this.lossSince = null
      if (this.cover) this.fullSince ??= now
    }
    // A loss that outlasts the invalid frames is a loss again, and goes as one.
    if (this.cover) this.cover.cause = this.invalidDue ? 'invalidFrames' : loss ? 'playerLoss' : this.cover.cause
    if (this.cover || blocked || !this.ctx.layers().playerLoss) return null
    if (this.invalidDue) {
      const target = this.target() ?? this.ballHalf(frame)
      return target && { ...target, cause: 'invalidFrames' }
    }
    if (!loss || now - this.lossSince! < LOSS_START_S) return null
    const target = this.target()
    return target && { ...target, cause: 'playerLoss' }
  }

  /** Cover the loss with `target`'s attack. */
  start(target: AttackTarget & { cause?: LossCause }): void {
    this.cover = { cause: 'playerLoss', ...target, startedMs: null, elapsedMs: 0, leavingFromMs: null }
  }

  step(ms: number): MomentStep {
    const cover = this.cover
    if (!cover) return 'stop'
    if (cover.startedMs === null) cover.startedMs = ms
    cover.elapsedMs = ms - cover.startedMs
    // Invalid frames end on the record that says so; a loss once enough players have held for LOSS_END_S.
    const over =
      !this.invalidDue &&
      (cover.cause === 'invalidFrames'
        ? this.lossSince === null
        : this.fullSince !== null && this.ctx.shown().time - this.fullSince >= LOSS_END_S)
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

  /**
   * The loss on `record`, the record on screen, if it is one: why, its players, and who covers
   * it. An invalid record, or the attack over invalid ones still showing, comes first.
   */
  state(record: TrackerRecord): PlayerLossState | null {
    const players = trackedPlayers(record.frame)
    const cover = this.cover?.team ?? null
    const invalid = this.coverInvalidFrames && record.validity?.invalid === true
    if (invalid) {
      const { nextValidInS, horizonS } = record.validity!
      const short = !this.cover && nextValidInS !== null && nextValidInS < MIN_STRETCH_S
      return {
        cause: 'invalidFrames',
        players,
        cover,
        validInS: nextValidInS,
        ...(horizonS ? { horizonS } : {}),
        ...(short ? { short } : {}),
      }
    }
    if (this.cover?.cause === 'invalidFrames') return { cause: 'invalidFrames', players, cover }
    if (players >= PLAYER_LOSS_BELOW) return null
    return { cause: 'playerLoss', players, cover }
  }

  reset(): void {
    this.cover = null
    this.forget()
  }

  /** The team to cover with, as the top says, or null when nothing says yet. */
  private target(): AttackTarget | null {
    const attacks = this.knownAttacks()
    const heading = this.heading()
    const team = heading !== null ? (TEAMS.find((t) => attacks[t] === heading) ?? null) : this.lastPossession
    if (team === null) return null
    const direction = attacks[team]
    if (direction === null) return null
    return { team, direction, color: this.ctx.teamColor(team) }
  }

  /**
   * Whether `validity` asks for the attack over invalid frames: an invalid record of a run of
   * MIN_STRETCH_S or more, or of any run while that attack shows; or, while it shows, a valid
   * record with an invalid one due within MERGE_GAP_S.
   */
  private dueInvalid(validity: RecordValidity | undefined): boolean {
    if (!validity) return false
    const covering = this.cover?.cause === 'invalidFrames' && this.cover.leavingFromMs === null
    if (validity.invalid) {
      return covering || validity.nextValidInS === null || validity.nextValidInS >= MIN_STRETCH_S
    }
    return covering && validity.nextInvalidInS !== null && validity.nextInvalidInS < MERGE_GAP_S
  }

  /** The team attacking the half the ball is in on `frame`, or null with no ball on it or no way known. */
  private ballHalf(frame: Frame): AttackTarget | null {
    const ball = shownBall(frame, undefined)
    if (!ball || ball.x === 0 || !Number.isFinite(ball.x)) return null
    const attacks = this.knownAttacks()
    const towards = ball.x > 0 ? 1 : -1
    const team = TEAMS.find((t) => attacks[t] === towards)
    return team === undefined ? null : { team, direction: towards, color: this.ctx.teamColor(team) }
  }

  /** Which way each team attacks, as last known; one team's way gives the other's. */
  private knownAttacks(): Record<TeamId, 1 | -1 | null> {
    const attacks = { ...this.lastAttacks }
    if (attacks[0] === null && attacks[1] !== null) attacks[0] = attacks[1] === 1 ? -1 : 1
    if (attacks[1] === null && attacks[0] !== null) attacks[1] = attacks[0] === 1 ? -1 : 1
    return attacks
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
    this.invalidDue = false
    this.path = []
    this.lastPossession = null
    this.lastAttacks = { 0: null, 1: null }
  }
}
