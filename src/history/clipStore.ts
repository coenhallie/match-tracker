import { HISTORY_S } from '../analysis/derive.js'
import { KIND_RANK, type Clip, type SpottedMoment } from '../model/flashback.js'
import type { Ball, Frame, FrameAction, Player, RecordValidity, Team, TrackerRecord } from '../model/types.js'

/** How far before its moment a clip starts, and how far after it ends. */
export const CLIP_LEAD_S = 8
export const CLIP_TAIL_S = 4
/** The most clips kept at once. */
export const CLIP_CAP = 8
/** A clip is dropped this long after its moment. */
export const CLIP_EXPIRY_S = 900

/**
 * A copy of `record` with only what the renderer, the director and the analysis read of a frame:
 * what the pipeline sends beside it (occlusion, bounding boxes, colours, probabilities) is not
 * stored. A clip drawn from it paints what the full record paints.
 */
export function slimRecord(record: TrackerRecord): TrackerRecord {
  const { frame } = record
  const slimmed: Frame = {
    teams: (frame.teams ?? []).map(slimTeam),
  }
  if (frame.pitch_dimensions) slimmed.pitch_dimensions = frame.pitch_dimensions
  if (frame.frame_data) slimmed.frame_data = frame.frame_data
  if (frame.state) {
    slimmed.state = { actions: (frame.state.actions ?? []).map(slimAction) }
  }
  if (frame.balls) slimmed.balls = frame.balls.map(slimBall)
  const out: TrackerRecord = { t: record.t, frameCount: record.frameCount, frame: slimmed }
  if (record.validity) out.validity = record.validity
  return out
}

function slimTeam(team: Team): Team {
  return { team_id: team.team_id, players: (team.players ?? []).map(slimPlayer) }
}

function slimPlayer(player: Player): Player {
  const out: Player = {}
  if (player.track_id !== undefined) out.track_id = player.track_id
  if (player.person_type !== undefined) out.person_type = player.person_type
  if (player.projected_coordinates !== undefined) out.projected_coordinates = player.projected_coordinates
  if (player.player_number !== undefined) out.player_number = player.player_number
  // Every reader takes it as true or not, so the common false is left out.
  if (player.in_possession) out.in_possession = true
  return out
}

function slimBall(ball: Ball): Ball {
  const out: Ball = {}
  if (ball.projected_coordinates !== undefined) out.projected_coordinates = ball.projected_coordinates
  if (ball.is_high_ball !== undefined) out.is_high_ball = ball.is_high_ball
  return out
}

/**
 * What the moments read of a label: its name and origin, and what a human's says about who. A
 * corner or a card names its team, a card its player, a substitution who went off and who came on,
 * in a clip as live; a card's `uuid` tells one label seen on several records from another.
 */
const ACTION_KEYS = [
  'action_type',
  'action_origin',
  'uuid',
  'team_id',
  'player_number',
  'player_name',
  'player_name_out',
  'from',
  'to',
] as const satisfies readonly (keyof FrameAction)[]

function slimAction(action: FrameAction): FrameAction {
  const out: Record<string, unknown> = {}
  for (const key of ACTION_KEYS) if (action[key] !== undefined) out[key] = action[key]
  return out as FrameAction
}

interface Kept {
  record: TrackerRecord
  /** Its length as JSON, once bytes() has measured it. */
  size?: number
  /** Cut down to what the phase and the trail read: it is only some clip's lookback. */
  thin: boolean
}

/**
 * What `deriveAt` reads of a record, and nothing else: the ball, and of the players only the
 * goalkeepers (which end a team attacks) and whoever has the ball (possession). It is never drawn.
 */
function thinRecord(record: TrackerRecord): TrackerRecord {
  const teams = (record.frame.teams ?? []).map((team) => ({
    team_id: team.team_id,
    players: (team.players ?? []).filter(
      (p) =>
        p.in_possession ||
        String(p.person_type ?? '')
          .toUpperCase()
          .includes('GOALKEEPER'),
    ),
  }))
  const frame: Frame = { teams }
  if (record.frame.balls) frame.balls = record.frame.balls
  const out: TrackerRecord = { t: record.t, frameCount: record.frameCount, frame }
  if (record.validity) out.validity = record.validity
  return out
}

/**
 * The clips of live play kept for a flashback: a slimmed copy of the valid records around each
 * moment the spotter found, capped, aged, and bounded in memory.
 *
 * The records are held once, in time order, so overlapping clips share them. A record is kept
 * while a clip needs it (from HISTORY_S before the clip's start to its end, as the analysis
 * reads that far back) or while it is among the last CLIP_LEAD_S + HISTORY_S seconds, which is
 * what a moment found next will need. Invalid records are not kept, only their times.
 */
export class ClipStore {
  private kept: Kept[] = []
  private invalidTimes: number[] = []
  private newest: number | null = null
  private compactedAt = -Infinity
  private clipList: Clip[] = []
  private nextId = 1

  /**
   * Take a live record in, in arrival order, with what the live history takes it for
   * (LiveHistory.validityOf): what it said, or carries of what the stream last said.
   */
  add(record: TrackerRecord, state: RecordValidity | null): void {
    if (this.newest !== null && record.t < this.newest - HISTORY_S) this.clear()
    if (state?.invalid) {
      insertSorted(this.invalidTimes, record.t)
    } else {
      const slim = slimRecord(record)
      let at = this.kept.length
      while (at > 0 && this.kept[at - 1]!.record.t > record.t) at--
      this.kept.splice(at, 0, { record: slim, thin: false })
    }
    if (this.newest === null || record.t > this.newest) this.newest = record.t
    this.close()
    this.prune(this.expire())
  }

  /** Note a moment the spotter found on the record just added. */
  note(moment: SpottedMoment): void {
    const lastInvalid = lastBefore(this.invalidTimes, moment.at)
    // Never before the first record kept: a stream that began within the lead (a mount, a reset)
    // would otherwise start the clip on its first frame, held while the clock ran up to it.
    const lead = moment.at - CLIP_LEAD_S
    // Record times are sums of floats: a record this close to the lead is on it.
    const firstKept = this.kept.find((k) => k.record.t >= lead - 1e-9)
    let from = Math.max(lead, firstKept ? firstKept.record.t : moment.at)
    if (lastInvalid !== null) {
      const firstValid = this.kept.find((k) => k.record.t > lastInvalid)
      from = Math.max(from, firstValid ? firstValid.record.t : moment.at)
    }
    const rank = KIND_RANK[moment.kind]
    const clash = this.clipList.filter(
      (c) =>
        (moment.at >= c.at - CLIP_LEAD_S && moment.at <= c.at + CLIP_TAIL_S) ||
        (c.at >= moment.at - CLIP_LEAD_S && c.at <= moment.at + CLIP_TAIL_S),
    )
    // The more important of two moments in one window stays; on a tie, the one already here.
    if (clash.some((c) => KIND_RANK[c.kind] <= rank)) return
    this.clipList = this.clipList.filter((c) => !clash.includes(c))
    this.clipList.push({
      id: this.nextId++,
      kind: moment.kind,
      at: moment.at,
      frameCount: moment.frameCount,
      from,
      to: Math.min(moment.at + CLIP_TAIL_S, this.newest ?? moment.at),
      ready: false,
    })
    while (this.clipList.length > CLIP_CAP) {
      let drop = this.clipList[0]!
      for (const c of this.clipList) {
        const worse = KIND_RANK[c.kind] > KIND_RANK[drop.kind]
        if (worse || (KIND_RANK[c.kind] === KIND_RANK[drop.kind] && c.at < drop.at)) drop = c
      }
      this.clipList = this.clipList.filter((c) => c !== drop)
    }
    this.close()
    this.prune(true)
  }

  /** The most important ready clip, the newest of its kind. */
  next(): Clip | null {
    let best: Clip | null = null
    for (const c of this.clipList) {
      if (!c.ready) continue
      if (!best) best = c
      else {
        const [a, b] = [KIND_RANK[c.kind], KIND_RANK[best.kind]]
        if (a < b || (a === b && c.at > best.at)) best = c
      }
    }
    return best
  }

  /** Remove a clip: it has been played. */
  take(id: number): void {
    this.clipList = this.clipList.filter((c) => c.id !== id)
    this.prune(true)
  }

  /** The slimmed records of a clip, from HISTORY_S before its start to its end, in time order. */
  records(id: number): readonly TrackerRecord[] {
    const clip = this.clipList.find((c) => c.id === id)
    if (!clip) return []
    const lo = clip.from - HISTORY_S
    return this.kept.filter((k) => k.record.t >= lo && k.record.t <= clip.to).map((k) => k.record)
  }

  clips(): readonly Clip[] {
    return this.clipList
  }

  /**
   * The size of the kept records, as JSON: a proxy for the memory they take, for the tests.
   * Each is measured once, when first asked for, so nothing is spent on it otherwise.
   */
  bytes(): number {
    let total = 0
    for (const k of this.kept) total += k.size ??= JSON.stringify(k.record).length
    return total
  }

  clear(): void {
    this.kept = []
    this.invalidTimes = []
    this.newest = null
    this.compactedAt = -Infinity
    this.clipList = []
  }

  /** Fix `to` for clips the stream has moved past, and mark them ready. */
  private close(): void {
    const newest = this.newest
    if (newest === null) return
    for (const c of this.clipList) {
      if (c.ready) continue
      const firstInvalid = firstAfter(this.invalidTimes, c.at)
      if (firstInvalid !== null) {
        const lastValid = lastKeptBefore(this.kept, firstInvalid)
        c.to = Math.min(c.at + CLIP_TAIL_S, lastValid ?? c.at)
        c.ready = true
      } else if (newest >= c.at + CLIP_TAIL_S) {
        c.to = c.at + CLIP_TAIL_S
        c.ready = true
      } else {
        c.to = newest
      }
    }
  }

  /** Drop the clips that are too old. True when it dropped any. */
  private expire(): boolean {
    if (this.newest === null) return false
    const cutoff = this.newest - CLIP_EXPIRY_S
    const before = this.clipList.length
    this.clipList = this.clipList.filter((c) => c.at >= cutoff)
    return this.clipList.length < before
  }

  /**
   * Drop the records nothing needs. The front goes at every record; records between the
   * clips are swept when the clips change and once per second of record time.
   */
  private prune(clipsChanged = false): void {
    const newest = this.newest
    if (newest === null) return
    const keepFrom = newest - (CLIP_LEAD_S + HISTORY_S)
    this.invalidTimes = this.invalidTimes.slice(sortedIndex(this.invalidTimes, keepFrom - CLIP_TAIL_S))
    const sweep = clipsChanged || newest - this.compactedAt >= 1
    const oldestNeeded = this.clipList.reduce((lo, c) => Math.min(lo, c.from - HISTORY_S), keepFrom)
    if (!sweep) {
      this.dropFront(oldestNeeded)
      return
    }
    this.compactedAt = newest
    const shown = this.clipList.map((c) => [c.from, c.ready ? c.to : Infinity] as const)
    const lookback = this.clipList.map((c) => [c.from - HISTORY_S, c.from] as const)
    const next: Kept[] = []
    for (const k of this.kept) {
      const t = k.record.t
      if (t >= keepFrom || within(shown, t)) {
        next.push(k)
      } else if (within(lookback, t)) {
        next.push(k.thin ? k : { record: thinRecord(k.record), thin: true })
      }
    }
    this.kept = next
  }

  private dropFront(before: number): void {
    let n = 0
    while (n < this.kept.length && this.kept[n]!.record.t < before) n++
    if (n > 0) this.kept.splice(0, n)
  }
}

function within(ranges: readonly (readonly [number, number])[], t: number): boolean {
  return ranges.some(([lo, hi]) => t >= lo && t <= hi)
}

function insertSorted(list: number[], t: number): void {
  let at = list.length
  while (at > 0 && list[at - 1]! > t) at--
  list.splice(at, 0, t)
}

/** The index of the first entry of the sorted `list` that is >= `t`. */
function sortedIndex(list: readonly number[], t: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid]! < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

function lastBefore(list: readonly number[], t: number): number | null {
  const i = sortedIndex(list, t)
  return i > 0 ? list[i - 1]! : null
}

function firstAfter(list: readonly number[], t: number): number | null {
  for (let i = sortedIndex(list, t); i < list.length; i++) if (list[i]! > t) return list[i]!
  return null
}

function lastKeptBefore(kept: readonly Kept[], t: number): number | null {
  for (let i = kept.length - 1; i >= 0; i--) if (kept[i]!.record.t < t) return kept[i]!.record.t
  return null
}
