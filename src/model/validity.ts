import type { RecordValidity } from './types.js'

/**
 * Records that say nothing about their validity. On the live stream's default socket about
 * one copy of a message in seven comes without `raw_data`, in the middle of runs whose other
 * records do say. Such a record is what the stream last said, carried forward; a stream that
 * has never said anything (replay data, older streams) carries nothing, and its records are
 * all valid, as before.
 */

/** The last record that said anything: its time, and what it said. */
export interface CarriedValidity {
  t: number
  validity: RecordValidity
}

/**
 * What the stream says at record time `t`, from the last record that said anything.
 * Its countdowns are aged by `t - last.t`, and `horizonS` is kept. A countdown that has
 * run out flips the state. A flipped state is a guess, so it drops `horizonS`: its null
 * countdown then reads as "unknown", never as "beyond the horizon". A null countdown with a
 * horizon only promised nothing within `horizonS`, so it drops `horizonS` too once its
 * age reaches it. Null when `last` is null.
 */
export function carriedValidity(last: CarriedValidity | null, t: number): RecordValidity | null {
  if (!last) return null
  const age = Math.max(0, t - last.t)
  const { validity } = last
  const aged = (seconds: number | null): number | null => (seconds === null ? null : seconds - age)
  const nextValidInS = aged(validity.nextValidInS)
  const nextInvalidInS = aged(validity.nextInvalidInS)
  // A countdown aged to exactly 0 has run out: the record it named is due now.
  if (validity.invalid && nextValidInS !== null && nextValidInS <= 0) {
    return { invalid: false, nextInvalidInS: null, nextValidInS: 0 }
  }
  if (!validity.invalid && nextInvalidInS !== null && nextInvalidInS <= 0) {
    return { invalid: true, nextInvalidInS: 0, nextValidInS: null }
  }
  const carried: RecordValidity = {
    invalid: validity.invalid,
    nextInvalidInS: validity.invalid ? 0 : nextInvalidInS,
    nextValidInS: validity.invalid ? nextValidInS : 0,
  }
  const countdown = validity.invalid ? validity.nextValidInS : validity.nextInvalidInS
  const spent = countdown === null && validity.horizonS !== undefined && age >= validity.horizonS
  if (validity.horizonS !== undefined && !spent) carried.horizonS = validity.horizonS
  return carried
}
