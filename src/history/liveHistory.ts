import { HISTORY_S, windowAt } from '../analysis/derive'
import type { TrackerRecord } from '../model/types'

/**
 * The records a live stream has delivered lately, enough for the phase and trail at the newest
 * one to derive as they do in replay, and no more.
 *
 * It holds the records from HISTORY_S before the newest up to the newest, in time order, with
 * equal times in arrival order. It is a mirror of the replay's cache, so `window()` is exactly
 * what `windowAt` gives over the records as they arrived.
 */
export class LiveHistory {
  /** Held records, oldest first. Records with one t are in arrival order. */
  private held: TrackerRecord[] = []
  private frames = new Set<number>()
  private newest: TrackerRecord | null = null

  /**
   * Take a record in. Returns false, and holds nothing new, for a frameCount already held and
   * for a record older than the newest minus HISTORY_S.
   *
   * A record with a t older than the newest goes in at its place in time and does not become
   * the newest. One with the same t as the newest does, as the stream's latest word.
   */
  add(record: TrackerRecord): boolean {
    if (this.frames.has(record.frameCount)) return false
    if (this.newest && record.t < this.newest.t - HISTORY_S) return false

    let at = this.held.length
    while (at > 0 && this.held[at - 1]!.t > record.t) at--
    this.held.splice(at, 0, record)
    this.frames.add(record.frameCount)

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

  /** The records the newest one derives its phase and trail from: `windowAt(held, latest)`. */
  window(): TrackerRecord[] {
    return this.newest ? windowAt(this.held, this.newest) : []
  }

  clear(): void {
    this.held = []
    this.frames.clear()
    this.newest = null
  }

  /** Drop the records older than `from`, which sit at the front. */
  private prune(from: number): void {
    let n = 0
    while (n < this.held.length && this.held[n]!.t < from) this.frames.delete(this.held[n++]!.frameCount)
    if (n > 0) this.held.splice(0, n)
  }
}
