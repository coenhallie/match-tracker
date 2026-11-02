/**
 * The attack, ported from PipelineOutputSurface.vue (6f14d1f) :668-800.
 *
 * When playback runs into an attack (see teamPhase.ts) with the ball in the
 * other team's half, the attack is shown for ATTACK_SHOW_MS: the pitch shaded
 * from the attacking team's own goal line to a toothed edge pointing at the
 * goal it attacks, with its name over "Attack" just behind that edge
 * (attackIndicator.ts). Everyone on the pitch fades out, and the ball is held
 * where it was when the attack was shown, its border pulsing. Play carries on
 * underneath; when the time is up it all fades out over ATTACK_OUT_MS onto
 * play as it now is.
 *
 * An attack is shown once, the first time it is seen in the other team's
 * half. It only ever plays during playback, anything that means someone
 * wants the real frame stops it at once, and an attack a seek or a step lands
 * in the middle of is not shown when play then carries on.
 */
import type { BallTrail } from '../analysis/ballTrail.js'
import type { Spin } from '../analysis/football.js'
import type { TeamId } from '../analysis/teamPhase.js'
import type { Frame } from '../model/types.js'
import {
  ATTACK_IN_MS,
  ATTACK_OUT_MS,
  ATTACK_PULSE_MS,
  ATTACK_SHOW_MS,
  type AttackIndicator,
} from '../render/attackIndicator.js'
import { shownBall } from './ballRoll.js'
import type { Moment, MomentContext, MomentStep } from './moment.js'

/** An attack under way: which team, which way, and in what colour. */
export interface AttackTarget {
  team: TeamId
  direction: 1 | -1
  color: string
}

interface Showing extends AttackTarget {
  /** The ball, its trail and how it was turned when the attack was shown. */
  ball: { x: number; y: number } | null
  trail: BallTrail | null
  spin: Spin
  startedMs: number | null
  elapsedMs: number
}

const seenKey = (team: TeamId, direction: 1 | -1) => `${team}:${direction}`

export class Attack implements Moment {
  private attack: Showing | null = null
  /** The attack last seen, as team and direction, so each is shown once; null while nobody is attacking. */
  private seen: string | null = null

  constructor(private readonly ctx: MomentContext) {}

  get active(): boolean {
    return this.attack !== null
  }

  /** `attackTarget`: the attack the current phase says is under way, if any. */
  target(): AttackTarget | null {
    const phase = this.ctx.shown().phase
    if (!phase) return null
    const team = phase.states[0] === 'attacking' ? 0 : phase.states[1] === 'attacking' ? 1 : null
    if (team === null) return null
    const direction = phase.attacks[team]
    // Without a direction there is no telling which half is the other team's.
    if (direction === null) return null
    return { team, direction, color: this.ctx.teamColor(team) }
  }

  /**
   * `maybeStartAttack`, up to its start: whether to show the attack on
   * `frame`, which has just reached the other team's half during playback.
   * Called for every new record, after the goal and the free kick. `blocked`
   * is a goal or a free kick showing. Notes the attack as seen either way,
   * and gives the attack and the ball to hold when it is to start.
   */
  detect(frame: Frame, blocked: boolean): { target: AttackTarget; ball: { x: number; y: number } } | null {
    const target = this.target()
    const key = target ? seenKey(target.team, target.direction) : null
    // Landed on by a seek or a step: whatever attack is under way has been
    // seen, and is not shown when play carries on.
    if (!this.ctx.playback() || key === null) {
      this.seen = key
      return null
    }
    if (!target || key === this.seen) return null
    const ball = shownBall(frame, undefined)
    // Not yet in the other team's half: not shown until it is.
    if (!ball || target.direction * ball.x <= 0) return null
    this.seen = key
    return this.ctx.layers().attack && !blocked && !this.attack ? { target, ball } : null
  }

  /** Seen, so it does not play again by itself: for one played by hand. */
  markSeen(team: TeamId, direction: 1 | -1): void {
    this.seen = seenKey(team, direction)
  }

  /** `startAttack`: show `target`, holding the ball at `ball`, and its trail and spin as they are now. */
  start(target: AttackTarget, ball: { x: number; y: number } | null): void {
    this.attack = {
      ...target,
      ball,
      trail: this.ctx.shown().trail,
      spin: this.ctx.spin(),
      startedMs: null,
      elapsedMs: 0,
    }
  }

  /** `attackStep`. */
  step(ms: number): MomentStep {
    const attack = this.attack
    if (!attack) return 'stop'
    if (attack.startedMs === null) attack.startedMs = ms
    attack.elapsedMs = ms - attack.startedMs
    const end = this.ctx.reducedMotion() ? ATTACK_SHOW_MS : ATTACK_SHOW_MS + ATTACK_OUT_MS
    return attack.elapsedMs >= end ? 'stop' : 'paint'
  }

  /** `stopAttack`: end it at once, back to the frame as it is. */
  stop(): boolean {
    if (!this.attack) return false
    this.attack = null
    return true
  }

  /** `attackValue`: what is drawn for it now. */
  value(): AttackIndicator | undefined {
    const m = this.attack
    if (!m) return undefined
    const e = m.elapsedMs
    const still = this.ctx.reducedMotion()
    const coming = Math.min(1, e / ATTACK_IN_MS)
    const leaving = !still && e >= ATTACK_SHOW_MS
    const going = leaving ? Math.max(0, 1 - (e - ATTACK_SHOW_MS) / ATTACK_OUT_MS) : 1
    const intensity = still ? 1 : leaving ? going : coming
    const playersFade = still ? 1 : leaving ? going : Math.max(0, coming * 2 - 1)
    return {
      team: m.team,
      color: m.color,
      name: this.ctx.teamName(m.team),
      direction: m.direction,
      intensity,
      leaving,
      playersFade,
      ...(m.ball ? { ball: m.ball } : {}),
      ...(still ? {} : { pulse: (e / ATTACK_PULSE_MS) % 1 }),
    }
  }

  /** The ball's trail and spin as they were when it was shown (`attackMoment`), while it is. */
  moment(): { trail: BallTrail | null; spin: Spin } | null {
    return this.attack && { trail: this.attack.trail, spin: this.attack.spin }
  }

  reset(): void {
    this.attack = null
    this.seen = null
  }
}
