import { HISTORY_S, windowAt } from '../analysis/derive.js'
import { hasBall, heldRecord } from '../model/heldRecord.js'
import type { RecordValidity, TrackerRecord } from '../model/types.js'
import { carriedValidity, type CarriedValidity } from '../model/validity.js'

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
 * A record that says nothing about its validity is what the stream last said, carried forward
 * and aged by record time (carriedValidity): on the default socket some copies come without
 * `raw_data` in the middle of an invalid run, and their positions are as made up as the
 * others'. While the stream has said nothing at all, as replay data and older streams do not,
 * every record is valid, and for them nothing changes.
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
  /** What `shown()` gave for an invalid newest record with nothing valid to hold it on. */
  private carryingFor: { record: TrackerRecord; shown: TrackerRecord } | null = null
  /** The newest record that said anything about its validity, and what it said. */
  private said: CarriedValidity | null = null
  /** What each held record stood for, said or carried: decided once, as it arrived. */
  private validity = new WeakMap<TrackerRecord, RecordValidity | null>()

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

    const stated = record.validity
    if (stated && (!this.said || record.t >= this.said.t)) this.said = { t: record.t, validity: stated }
    this.validity.set(record, stated ?? this.carried(record.t))
    let at = this.held.length
    while (at > 0 && this.held[at - 1]!.t > record.t) at--
    this.held.splice(at, 0, record)
    this.frames.add(record.frameCount)

    if (this.isValid(record) && (!this.lastValid || record.t >= this.lastValid.t)) this.lastValid = record
    if (this.isValid(record) && hasBall(record.frame) && (!this.lastBall || record.t >= this.lastBall.t)) {
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
    if (!newest || this.isValid(newest)) return newest
    if (!lastValid) return this.carrying(newest)
    const lastBall = this.lastBall
    const cached = this.shownFor
    if (cached && cached.newest === newest && cached.lastValid === lastValid && cached.lastBall === lastBall) {
      return cached.shown
    }
    const ballFrom =
      !hasBall(lastValid.frame) && lastBall && lastBall.t >= lastValid.t - HISTORY_S ? lastBall : lastValid
    const shown = heldRecord(newest, lastValid, ballFrom.frame.balls, this.validity.get(newest) ?? undefined)
    this.shownFor = { newest, lastValid, lastBall, shown }
    return shown
  }

  /**
   * The records the last valid one derives its phase and trail from: `windowAt` over the valid
   * records held, at the last valid one. Empty when there is none.
   */
  window(): TrackerRecord[] {
    if (!this.lastValid) return []
    const isValid = (record: TrackerRecord) => this.isValid(record)
    return windowAt(this.held.every(isValid) ? this.held : this.held.filter(isValid), this.lastValid)
  }

  clear(): void {
    this.held = []
    this.frames.clear()
    this.newest = null
    this.lastValid = null
    this.lastBall = null
    this.shownFor = null
    this.said = null
    this.validity = new WeakMap()
    this.carryingFor = null
  }

  /**
   * What a record at `t` that says nothing stands for: what the stream last said, carried
   * forward, but only for as far as that word reached (its lookahead's horizon, or HISTORY_S
   * without one). Past that the stream has stopped saying anything, and the record is valid,
   * as on a stream that never said anything: a carry that never ran out would hold the
   * picture still for good.
   */
  private carried(t: number): RecordValidity | null {
    const said = this.said
    if (!said || t - said.t > (said.validity.horizonS ?? HISTORY_S)) return null
    return carriedValidity(said, t)
  }

  /**
   * An invalid record shown as it is, with nothing valid yet to hold it on: with the
   * validity it carries when it said none itself, so what is drawn over it knows. Made
   * once per record, so it keeps its identity.
   */
  private carrying(record: TrackerRecord): TrackerRecord {
    if (record.validity) return record
    const cached = this.carryingFor
    if (cached && cached.record === record) return cached.shown
    const shown: TrackerRecord = { ...record, validity: this.validity.get(record)! }
    this.carryingFor = { record, shown }
    return shown
  }

  /** Whether a held record is valid, as it said or as what it carried says. */
  private isValid(record: TrackerRecord): boolean {
    return this.validity.get(record)?.invalid !== true
  }

  /** Drop the records older than `from`, which sit at the front. */
  private prune(from: number): void {
    let n = 0
    while (n < this.held.length && this.held[n]!.t < from) this.frames.delete(this.held[n++]!.frameCount)
    if (n > 0) this.held.splice(0, n)
  }
}
