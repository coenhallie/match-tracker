import type { Frame } from '../model/types.js'

/**
 * Who is attacking and who is defending, worked out from the pipeline's own
 * per-frame data. None of it is reported by the pipeline: it is derived here,
 * and anything that shows it should read as derived.
 *
 * Two things go into it, each measured on a full match before being chosen:
 *
 *  - Possession. The raw per-frame carrier flips about six times a minute, and
 *    most frames (61%) have no carrier at all. A team takes possession once it
 *    has been the carrier for POSSESSION_HOLD_S with no carrier from the other
 *    team in between; frames without a carrier change nothing, until the
 *    team has gone POSSESSION_FORGET_S without the ball, when nobody has it.
 *    That brings it down to about 2.4 changes a minute.
 *  - Direction. The export has no attacking-direction field, and the teams do
 *    not swap ends where a fixed per-half rule would expect (on the February
 *    export the keepers swap at about minute 16). So a team attacks away from
 *    its own keeper, read from the frames themselves. Nothing here needs it
 *    to say who is attacking; it is for drawing which way they attack.
 *
 * A team is attacking once it has kept possession for ATTACK_HOLD_S, and the
 * other team is then defending, wherever the ball is. Before that neither has
 * a state: keeping the ball is not the same as attacking, and a team can play
 * it around at the back. Measured on the February export, 3 s puts an attack
 * on screen 2.6 times a minute for a median 5 s, leaves out the 18% of
 * possessions that are shorter, and has attacking shown on 54% of frames
 * (5 s was tried first, and felt too slow to call an attack).
 *
 * Everything is computed from the frames within PHASE_LOOKBACK_S of the frame
 * asked about, and nothing older. That bounded memory is what makes a frame's
 * answer the same however the replay arrived at it, by playing or by seeking.
 * It reaches back further than anything that can still affect the answer
 * (taking possession, then keeping it for the attack hold, with quiet spells
 * of up to the forget time), so the answer is also what unlimited memory
 * would give. A shorter window made long attacks drop out halfway through
 * whenever its start fell in a quiet spell.
 */

/** How long a team must keep the ball before possession passes to it. */
export const POSSESSION_HOLD_S = 1
/** How long a team must keep possession before it counts as attacking. */
export const ATTACK_HOLD_S = 3
/** How long a team keeps possession without touching the ball. */
export const POSSESSION_FORGET_S = 5
/** How far back the calculation looks: past everything that can still matter. */
export const PHASE_LOOKBACK_S = POSSESSION_HOLD_S + ATTACK_HOLD_S + POSSESSION_FORGET_S + 1
/** A keeper this close to the halfway line says nothing about which end is theirs. */
const KEEPER_MIN_ABS_X = 15
/** Slack for timestamps that land a hair short of a whole hold time. */
const EPSILON_S = 1e-6

export type TeamId = 0 | 1
export type TeamState = 'attacking' | 'defending'

export interface TeamPhase {
  /** The team in possession, or null when nobody clearly is. */
  possession: TeamId | null
  /** The direction along x each team attacks in, or null when unknown. */
  attacks: Record<TeamId, 1 | -1 | null>
  /** Each team's state, or null for both until a possession becomes an attack. */
  states: Record<TeamId, TeamState | null>
}

/**
 * Whether two phases say the same thing. A phase is worked out afresh for
 * every frame, but holds for seconds at a time, so whatever shows it can keep
 * the one it has rather than redraw for an identical copy.
 */
export function samePhase(a: TeamPhase, b: TeamPhase): boolean {
  return (
    a.possession === b.possession && TEAMS.every((k) => a.attacks[k] === b.attacks[k] && a.states[k] === b.states[k])
  )
}

/** The two parts of a replay record the calculation reads. */
export interface PhaseRecord {
  t: number
  frame: Frame
}

const TEAMS: TeamId[] = [0, 1]

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function carrierTeam(frame: Frame): TeamId | null {
  for (const team of frame.teams ?? []) {
    if (team.team_id !== 0 && team.team_id !== 1) continue
    if ((team.players ?? []).some((p) => p.in_possession)) return team.team_id
  }
  return null
}

function keeperX(frame: Frame, teamId: TeamId): number | null {
  const team = (frame.teams ?? []).find((t) => t.team_id === teamId)
  for (const p of team?.players ?? []) {
    const x = p.projected_coordinates?.x
    if (
      String(p.person_type ?? '')
        .toUpperCase()
        .includes('GOALKEEPER') &&
      finite(x)
    ) {
      return Math.abs(x) >= KEEPER_MIN_ABS_X ? x : null
    }
  }
  return null
}

/** Each team attacks away from its own keeper, or towards the other team's. */
function directions(frame: Frame): Record<TeamId, 1 | -1 | null> {
  const own = { 0: keeperX(frame, 0), 1: keeperX(frame, 1) }
  const out: Record<TeamId, 1 | -1 | null> = { 0: null, 1: null }
  for (const k of TEAMS) {
    const mine = own[k]
    const theirs = own[k === 0 ? 1 : 0]
    if (mine !== null) out[k] = mine > 0 ? -1 : 1
    else if (theirs !== null) out[k] = theirs > 0 ? 1 : -1
  }
  return out
}

/**
 * The phase at `records[index]`, from that record and those before it within
 * PHASE_LOOKBACK_S. `records` must be in time order; anything older than the
 * lookback is never read.
 */
export function teamPhaseAt(records: readonly PhaseRecord[], index: number): TeamPhase {
  const now = records[index]
  const none: TeamPhase = {
    possession: null,
    attacks: { 0: null, 1: null },
    states: { 0: null, 1: null },
  }
  if (!now) return none

  let start = index
  while (start > 0 && (records[start - 1]?.t ?? -Infinity) >= now.t - PHASE_LOOKBACK_S) start--

  let possession: TeamId | null = null
  let possessionSince = 0
  let lastTouch = 0
  let candidate: TeamId | null = null
  let candidateSince = 0
  const attacks: Record<TeamId, 1 | -1 | null> = { 0: null, 1: null }

  for (let i = start; i <= index; i++) {
    const record = records[i]
    if (!record) continue
    const { t, frame } = record

    const carrier = carrierTeam(frame)
    if (possession !== null && carrier !== possession && t - lastTouch > POSSESSION_FORGET_S) {
      possession = null
    }
    if (carrier !== null) {
      if (carrier === possession) {
        candidate = null
        lastTouch = t
      } else {
        if (candidate !== carrier) {
          candidate = carrier
          candidateSince = t
        }
        if (t - candidateSince >= POSSESSION_HOLD_S - EPSILON_S) {
          possession = carrier
          possessionSince = t
          lastTouch = t
          candidate = null
        }
      }
    }

    const dir = directions(frame)
    for (const k of TEAMS) if (dir[k] !== null) attacks[k] = dir[k]
  }

  if (possession === null) return { ...none, attacks }
  if (now.t - possessionSince < ATTACK_HOLD_S - EPSILON_S) {
    return { ...none, possession, attacks }
  }

  const states: Record<TeamId, TeamState> =
    possession === 0 ? { 0: 'attacking', 1: 'defending' } : { 0: 'defending', 1: 'attacking' }
  return { possession, attacks, states }
}
