import type { Frame } from '../model/types.js'
import type { PhaseRecord } from './teamPhase.js'

/**
 * The ball's trail: the path the tracked ball took over the last
 * TRAIL_HISTORY_S, ending at the ball, with a mark wherever it turned. Like
 * the team phase it is worked out here from the pipeline's own frames, not
 * reported by the pipeline.
 *
 * It is drawn from the ball's own positions, frame by frame, and nothing else.
 * An earlier trail drew each pass as a straight line from the player who
 * played it to the ball, and ended it when the next player was flagged with
 * the ball. The export flags possession on about one frame in ten, so most
 * passes never ended: when the ball turned, the line swung round its start to
 * follow it (15 of the 27 passes in two minutes of Manchester City vs PSG, by
 * up to 121 degrees). A point on this trail is where the ball was, so once
 * drawn it never moves; it only fades as it gets older.
 *
 * Where the ball turned is worked out from where it went either side of each
 * point: the direction it came from over the last TURN_ARM_METRES, and the
 * direction it left in over the next. Measured over a distance rather than a
 * number of frames, a ball standing still, which jitters by a few centimetres
 * a frame, has no direction to turn from. A turn of TURN_MIN_DEGREES or more
 * is marked once, at the point where the path bends most tightly: where the
 * points TURN_ARM_METRES before and after it, measured along the path the
 * ball travelled, are closest together. (Measured straight-line, every point
 * within TURN_ARM_METRES of where a ball was sent back the way it came turns
 * the same 180 degrees, so that alone cannot pick the point.) The mark only
 * appears once the ball has gone TURN_ARM_METRES past it, and since nothing
 * after that can change it, it then stays where it is.
 *
 * The path is broken where the ball was not tracked for longer than
 * MAX_GAP_S, rather than drawn straight across a stretch the export knows
 * nothing about: a cutaway can lose the ball for seconds. It is also broken
 * where the tracked ball jumps faster than MAX_BALL_SPEED, which no ball can:
 * the tracker has lost it and picked up something else. A jump for one frame
 * that comes straight back is left out, and the path carries on. The
 * Manchester City vs PSG export never jumps (31.5 m/s at most over two
 * minutes); the February export does, 159 times in four minutes, some by
 * hundreds of metres, each a line drawn across the pitch to nowhere.
 *
 * Only frames within TRAIL_LOOKBACK_S of the frame asked about are read, so
 * the answer is the same whether the replay played into the frame or seeked
 * to it.
 */

/** How long the ball's path stays on screen. */
export const TRAIL_HISTORY_S = 2.1
/** How long the oldest of it takes to fade out, at the end of TRAIL_HISTORY_S. */
export const TRAIL_FADE_S = 0.525
/** Opacity of the path at the ball, and of the oldest of it before it fades out. */
export const TRAIL_HEAD_ALPHA = 0.92
export const TRAIL_TAIL_ALPHA = 0.3
/** Untracked for longer than this, the path is broken rather than joined. */
export const MAX_GAP_S = 0.12
/**
 * Faster than this, in m/s, the tracked ball has jumped rather than moved: a
 * hard shot is about 35 m/s. Measured over at least MIN_STEP_S, as the
 * February export stamps some frames with the time of the one before.
 */
export const MAX_BALL_SPEED = 45
const MIN_STEP_S = 0.04
/** How far either side of a point the ball's direction is measured over. */
export const TURN_ARM_METRES = 2
/** The least change of direction marked as a turn. */
export const TURN_MIN_DEGREES = 35
/**
 * How far back the trail reads: the TRAIL_HISTORY_S it shows, and before that
 * room for the direction the ball came from at the oldest of it.
 */
export const TRAIL_LOOKBACK_S = TRAIL_HISTORY_S + 4

/** A point on the ball's path, and how long before the frame the ball was there. */
export interface TrailPoint {
  x: number
  y: number
  /** Seconds. */
  age: number
}

export interface BallTrail {
  /**
   * The ball's path, oldest first, in stretches broken where it was not
   * tracked. The newest ends at the ball, or where it was last tracked.
   */
  runs: TrailPoint[][]
  /** Where the path turned, oldest first. */
  turns: TrailPoint[]
}

/**
 * How strongly the path is drawn where the ball was `age` seconds ago: most
 * strongly at the ball, less so further back, fading out over the last
 * TRAIL_FADE_S of TRAIL_HISTORY_S. Zero beyond that.
 */
export function trailOpacity(age: number): number {
  const steady = TRAIL_HISTORY_S - TRAIL_FADE_S
  if (age <= steady) {
    const k = Math.max(0, age) / steady
    return TRAIL_HEAD_ALPHA + (TRAIL_TAIL_ALPHA - TRAIL_HEAD_ALPHA) * k
  }
  return Math.max(0, (TRAIL_TAIL_ALPHA * (TRAIL_HISTORY_S - age)) / TRAIL_FADE_S)
}

const samePoints = (a: TrailPoint[], b: TrailPoint[]) =>
  a.length === b.length &&
  a.every((p, i) => {
    const q = b[i]!
    return p.x === q.x && p.y === q.y && p.age === q.age
  })

/** Whether two trails draw the same, so a caller can keep the one it has. */
export function sameTrail(a: BallTrail | null, b: BallTrail | null): boolean {
  if (a === null || b === null) return a === b
  return (
    samePoints(a.turns, b.turns) &&
    a.runs.length === b.runs.length &&
    a.runs.every((run, i) => samePoints(run, b.runs[i]!))
  )
}

interface Sample {
  t: number
  x: number
  y: number
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The tracked ball's position, or null when the frame has none usable. */
function ballOf(frame: Frame): { x: number; y: number } | null {
  for (const ball of frame.balls ?? []) {
    const { x, y } = ball.projected_coordinates ?? {}
    if (finite(x) && finite(y)) return { x, y }
  }
  return null
}

const dist = (a: Sample, b: Sample) => Math.hypot(b.x - a.x, b.y - a.y)

/** The change of direction at `p`, coming from `from` and going on to `to`, in degrees. */
function turnAngle(from: Sample, p: Sample, to: Sample): number {
  const turn = Math.abs(Math.atan2(to.y - p.y, to.x - p.x) - Math.atan2(p.y - from.y, p.x - from.x))
  return ((turn > Math.PI ? 2 * Math.PI - turn : turn) * 180) / Math.PI
}

/**
 * How sharply the ball turned at each point of a run, in degrees, or null
 * while that is not known yet: the ball has not gone TURN_ARM_METRES past it,
 * and the run may still go on. A point the ball came to from less than
 * TURN_ARM_METRES away, or left by less than that before the run ended, did
 * not turn. Each point also gets the span its turn was measured over, and
 * how far apart the points TURN_ARM_METRES before and after it along the path
 * are, which is least where the path turns most tightly.
 */
function turnsOf(run: Sample[], open: boolean) {
  // How far along the path the ball had travelled at each point.
  const along = [0]
  for (let i = 1; i < run.length; i++) along.push(along[i - 1]! + dist(run[i - 1]!, run[i]!))
  return run.map((p, i) => {
    let a = i - 1
    while (a >= 0 && dist(run[a]!, p) < TURN_ARM_METRES) a--
    let b = i + 1
    while (b < run.length && dist(run[b]!, p) < TURN_ARM_METRES) b++
    if (b >= run.length) return { angle: open ? null : 0, chord: Infinity, a, b }
    if (a < 0) return { angle: 0, chord: Infinity, a, b }
    // Never further than the straight-line arms, so known whenever they are.
    // Placed exactly TURN_ARM_METRES along, between the points either side,
    // so how far apart the frames fall does not decide which point is tighter.
    const at = (d: number): Sample => {
      // The first step that reaches `d`: `along` only grows, so a binary search finds the one
      // a walk from the start would, without walking the run once a point.
      let k = 0
      let hi = run.length - 2
      while (k < hi) {
        const mid = (k + hi) >> 1
        if (along[mid + 1]! < d) k = mid + 1
        else hi = mid
      }
      const from = run[k]!
      const to = run[k + 1]!
      const f = (d - along[k]!) / (along[k + 1]! - along[k]! || 1)
      return { t: from.t, x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f }
    }
    const before = at(along[i]! - TURN_ARM_METRES)
    const after = at(along[i]! + TURN_ARM_METRES)
    return { angle: turnAngle(run[a]!, p, run[b]!), chord: dist(before, after), a, b }
  })
}

/** The trail at `records[index]`, from the records before it; null for none. */
export function ballTrailAt(records: readonly PhaseRecord[], index: number): BallTrail | null {
  const now = records[index]
  if (!now) return null

  // The tracked ball, in runs broken where it went untracked too long or
  // jumped, leaving out any jump for a single frame.
  let start = index
  while (start > 0 && (records[start - 1]?.t ?? -Infinity) >= now.t - TRAIL_LOOKBACK_S) start--
  const samples: Sample[] = []
  for (let i = start; i <= index; i++) {
    const record = records[i]
    const ball = record && ballOf(record.frame)
    if (record && ball) samples.push({ t: record.t, ...ball })
  }
  const follows = (a: Sample, b: Sample) =>
    b.t - a.t <= MAX_GAP_S && dist(a, b) <= MAX_BALL_SPEED * Math.max(b.t - a.t, MIN_STEP_S)
  const sampleRuns: Sample[][] = []
  samples.forEach((sample, i) => {
    const run = sampleRuns.at(-1)
    const last = run?.at(-1)
    if (run && last && follows(last, sample)) return run.push(sample)
    const next = samples[i + 1]
    if (run && last && next && follows(last, next) && !follows(sample, next)) return
    sampleRuns.push([sample])
  })

  const shown = (s: Sample) => now.t - s.t <= TRAIL_HISTORY_S
  const point = (s: Sample): TrailPoint => ({ x: s.x, y: s.y, age: now.t - s.t })
  const runs: TrailPoint[][] = []
  const turns: TrailPoint[] = []
  // The newest run can still go on, and so can the one before it while the
  // newest is a single point: that may yet turn out to be a one-frame jump.
  const lastRun = sampleRuns.length - 1
  const open = (r: number) => r === lastRun || (r === lastRun - 1 && sampleRuns[lastRun]!.length === 1)
  sampleRuns.forEach((run, r) => {
    const turn = turnsOf(run, open(r))
    run.forEach((s, i) => {
      const own = turn[i]!
      if (!shown(s) || own.angle === null || own.angle < TURN_MIN_DEGREES) return
      // The tightest point of the turn, the first of any as tight. Decided
      // only once every point it is measured against is known.
      for (let j = own.a + 1; j < own.b; j++) {
        if (j === i) continue
        const other = turn[j]!
        if (other.angle === null) return
        if (other.chord < own.chord || (other.chord === own.chord && j < i)) return
      }
      turns.push(point(s))
    })
    const visible = run.filter(shown).map(point)
    if (visible.length > 1) runs.push(visible)
  })
  return runs.length > 0 ? { runs, turns } : null
}
