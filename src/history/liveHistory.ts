import { HISTORY_S, windowAt } from '../analysis/derive.js'
import { hasBall, heldRecord } from '../model/heldRecord.js'
import type { TrackerRecord } from '../model/types.js'

const isValid = (record: TrackerRecord) => record.validity?.invalid !== true

/**
 * The records a live stream has delivered lately, enough for the phase and trail at the newest
 * one to derive as they do in replay, and no more.
 *
 * It holds the records from HISTORY_S before the newest up to the newest, in time order, with
 * equal times in arrival order. It is a mirror of the replay's cache, so `window()` is exactly
 * what `windowAt` gives over the records as they arrived.
 *
 * An invalid record (RecordValidity) is held too, so its frame number is taken once, but
 * nothing reads the positions the pipeline made up for it: the window leaves it out and ends
 * at the last valid record, and `shown()` puts the last valid record's positions under it
 * (heldRecord), with the last ball a valid record had, if it was seen within HISTORY_S of
 * the last valid record: the tracking often loses the ball just as the broadcast cuts away.
 * Records that say nothing about their validity, as replay data does not, are all valid, and
 * for them nothing changes.
 */
export class LiveHistory {
  /** Held records, oldest first. Records with one t are in arrival order. */
  private held: TrackerRecord[] = []
  private frames = new Set<number>()
  private newest: TrackerRecord | null = null
  /** The newest valid record, kept however long a run of invalid ones lasts. */
  private lastValid: TrackerRecord | null = null
  /** The newest valid record with a ball, kept as `lastValid` is. */
  private lastBall: TrackerRecord | null = null
  /** What `shown()` gave for the newest record, so it is made once and keeps its identity. */
  private shownFor: {
    newest: TrackerRecord
    lastValid: TrackerRecord
    lastBall: TrackerRecord | null
    shown: TrackerRecord
  } | null = null
  /** How many times the stream broke (see `add`): each started the history afresh. */
  breaks = 0

  /**
   * Take a record in. Returns false, and holds nothing new, for a frameCount already held and
   * for a t that is not finite.
   *
   * A record with a t older than the newest goes in at its place in time and does not become
   * the newest. One with the same t as the newest does, as the stream's latest word.
   *
   * A record more than HISTORY_S older than the newest cannot be a late one of this stream:
   * the stream broke (the pipeline restarted with the socket open, and its t started again
   * near 0; or a corrupt t far ahead made every record after it look old). Everything held is
   * forgotten, the record starts the history afresh, and `breaks` goes up, so the widget can
   * take what it shows next as a seek. Rejecting it instead would reject every record after
   * it, and the picture would freeze. A jump forward needs nothing of its own: the records it
   * leaves more than HISTORY_S behind are dropped as usual.
   */
  add(record: TrackerRecord): boolean {
    if (!Number.isFinite(record.t)) return false
    // Before the frameCount check: a restarted stream counts its frames again too.
    if (this.newest && record.t < this.newest.t - HISTORY_S) {
      this.clear()
      this.breaks++
    }
    if (this.frames.has(record.frameCount)) return false

    let at = this.held.length
    while (at > 0 && this.held[at - 1]!.t > record.t) at--
    this.held.splice(at, 0, record)
    this.frames.add(record.frameCount)

    if (isValid(record) && (!this.lastValid || record.t >= this.lastValid.t)) this.lastValid = record
    if (isValid(record) && hasBall(record.frame) && (!this.lastBall || record.t >= this.lastBall.t)) {
      this.lastBall = record
    }
    if (!this.newest || record.t >= this.newest.t) {
      this.newest = record
      this.prune(record.t - HISTORY_S)
    }
    return true
  }

  /** The newest record, or null when none is held. */
  latest(): TrackerRecord | null {
    return this.newest
  }

  /** The newest valid record, or null when there has been none since the history began. */
  latestValid(): TrackerRecord | null {
    return this.lastValid
  }

  /**
   * The record to show: the newest, or, while it is invalid, it held on the last valid record's
   * positions. With nothing valid to hold it on, the newest as it is.
   */
  shown(): TrackerRecord | null {
    const newest = this.newest
    const lastValid = this.lastValid
    if (!newest || isValid(newest) || !lastValid) return newest
    const lastBall = this.lastBall
    const cached = this.shownFor
    if (cached && cached.newest === newest && cached.lastValid === lastValid && cached.lastBall === lastBall) {
      return cached.shown
    }
    const ballFrom =
      !hasBall(lastValid.frame) && lastBall && lastBall.t >= lastValid.t - HISTORY_S ? lastBall : lastValid
    const shown = heldRecord(newest, lastValid, ballFrom.frame.balls)
    this.shownFor = { newest, lastValid, lastBall, shown }
    return shown
  }

  /**
   * The records the last valid one derives its phase and trail from: `windowAt` over the valid
   * records held, at the last valid one. Empty when there is none.
   */
  window(): TrackerRecord[] {
    if (!this.lastValid) return []
    return windowAt(this.held.every(isValid) ? this.held : this.held.filter(isValid), this.lastValid)
  }

  clear(): void {
    this.held = []
    this.frames.clear()
    this.newest = null
    this.lastValid = null
    this.lastBall = null
    this.shownFor = null
  }

  /** Drop the records older than `from`, which sit at the front. */
  private prune(from: number): void {
    let n = 0
    while (n < this.held.length && this.held[n]!.t < from) this.frames.delete(this.held[n++]!.frameCount)
    if (n > 0) this.held.splice(0, n)
  }
}
