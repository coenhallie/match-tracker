import { labelCard } from '../model/labelCards.js'
import type { Ball, Frame, Player, ProjectedCoordinates, TrackerRecord } from '../model/types.js'
import { humanLabelNames } from './actionLabels.js'

/**
 * The second half: the teams change ends at half time, and the widget turns
 * the pitch round with them, from the first human label that says the first
 * half is over or the second has started. These are the half time's and the
 * second half's own card labels (labelCards.ts), so whatever plays either card
 * also turns the pitch: the labelling tool's "Half Time" button, which sends
 * "End first half", and its "Second Half" button, which sends "Start second
 * half". The AI's labels, and those without an origin, turn nothing, as they
 * play nothing (isHumanLabel).
 *
 * Turned is half round the centre spot, x and y both: the teams swap ends but
 * the camera stays on its touchline, so a team's left wing, on the far side
 * attacking one way, is on the near side attacking the other. The ball's
 * height is kept.
 *
 * Either label starts the second half, and the earlier of the two is where it
 * starts. A label never turns the pitch back: pressing both buttons, or one
 * twice, turns it once. The turn happens under the half time's or the second
 * half's card, which fades the pitch out, so the players' jump to the other
 * end is not seen.
 *
 * What is remembered is the time the second half starts, and every record from
 * that time on is turned, however the widget reaches it, by playing or by
 * seeking either way. It is remembered from the labels this widget has seen,
 * and from the host (`secondHalfFrom`), which keeps what the widget told it
 * (the `secondHalf` event) for its match: a replay seeking into the second half
 * without having played past either label, or a live widget joining or reset
 * after both, knows of the second half only from the host. The earlier of the
 * two is where it starts.
 */

/** The bare label names (actionName) that end the first half or start the second. */
const HALF_LABELS: ReadonlySet<string> = new Set([...labelCard('halfTime').labels, ...labelCard('secondHalf').labels])

/**
 * A record as the widget shows it. `turned` is set on a second-half one, its
 * frame turned half round the centre spot: its positions are turned, but a
 * label naming a place on the pitch, as a corner's does, still names it as the
 * camera sees it (cornerLabel). Not a host's: hosts never see a turned record.
 * Any TrackerRecord is one, unturned, and a copy made by spreading one keeps it.
 */
export interface ShownRecord extends TrackerRecord {
  turned?: true
}

const turnPoint = (p: ProjectedCoordinates): ProjectedCoordinates => ({ ...p, x: -p.x, y: -p.y })

function turnPerson<T extends Player | Ball>(person: T): T {
  const p = person.projected_coordinates
  return p ? { ...person, projected_coordinates: turnPoint(p) } : person
}

/** `frame` turned half round the centre spot: every player and ball at -x, -y. The frame itself is left alone. */
export function turnFrame(frame: Frame): Frame {
  return {
    ...frame,
    teams: frame.teams.map((team) => ({ ...team, players: team.players.map(turnPerson) })),
    balls: frame.balls?.map(turnPerson),
  }
}

export class SecondHalf {
  /** Where the labels seen say the second half starts. */
  private start: number | null = null
  /** Where the host says it starts (`secondHalfFrom`), from the labels it was told of before. */
  private known: number | null = null
  /**
   * Each record's turned copy, made once: a replay host hands the same records
   * over many display frames, and the window around them over many records.
   */
  private turned = new WeakMap<TrackerRecord, ShownRecord>()

  /** When the second half starts, in record time: the earlier of the host's start and the labels', or null while neither says. */
  get from(): number | null {
    if (this.start === null) return this.known
    return this.known === null ? this.start : Math.min(this.start, this.known)
  }

  /** When the labels this has seen say the second half starts, or null while none has. */
  get labelled(): number | null {
    return this.start
  }

  /**
   * The start the host knows of, in record time, or null for none. It is kept
   * through a reset, which forgets only the labels seen. Anything but a finite
   * number is taken for none.
   */
  setKnown(from: number | null): void {
    this.known = typeof from === 'number' && Number.isFinite(from) ? from : null
  }

  /**
   * The records whose labels have been read. A replay host hands the whole
   * lookback over again for every new record, so all but the newest are known.
   */
  private read = new WeakSet<TrackerRecord>()

  /**
   * Take note of `record`'s labels: a half label puts the start of the second
   * half at its time, or earlier. True when that moved where the labels say it starts.
   */
  see(record: TrackerRecord): boolean {
    if (this.read.has(record)) return false
    this.read.add(record)
    if (this.start !== null && record.t >= this.start) return false
    if (!humanLabelNames(record.frame).some((name) => HALF_LABELS.has(name))) return false
    this.start = record.t
    return true
  }

  /** Whether a record at `t` is in the second half. */
  private covers(t: number): boolean {
    const from = this.from
    return from !== null && t >= from
  }

  /** `record` as it is shown: turned round in the second half, as it is before. */
  shown(record: TrackerRecord): ShownRecord {
    return this.covers(record.t) ? this.turn(record) : record
  }

  /**
   * `records`, the window `at` is worked out from, as it is shown with `at`:
   * all turned or none, as `at` is, so a phase or a ball trail never reads
   * across the turn.
   */
  window(records: readonly TrackerRecord[], at: TrackerRecord): readonly ShownRecord[] {
    return this.covers(at.t) ? records.map((r) => this.turn(r)) : records
  }

  /** Forget the labels seen, for a reconnect or a new match. The host's start stays until the host changes it. */
  reset(): void {
    this.start = null
    this.read = new WeakSet()
    this.turned = new WeakMap()
  }

  private turn(record: TrackerRecord): ShownRecord {
    let turned = this.turned.get(record)
    if (!turned) {
      turned = { ...record, frame: turnFrame(record.frame), turned: true }
      this.turned.set(record, turned)
    }
    return turned
  }
}
