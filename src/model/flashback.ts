import type { RecordValidity } from './types.js'

/** What a flashback clip is of. */
export type FlashbackKind = 'goal' | 'corner' | 'shot' | 'attack'

/** Lower is more important. */
export const KIND_RANK: Readonly<Record<FlashbackKind, number>> = { goal: 0, corner: 1, shot: 2, attack: 3 }

/** A moment the spotter found. `at` is the record's `t`. */
export interface SpottedMoment {
  kind: FlashbackKind
  at: number
  frameCount: number
}

/** A stored clip. `from` and `to` are record times bounding what is shown, before any fitting. */
export interface Clip {
  id: number
  kind: FlashbackKind
  at: number
  frameCount: number
  from: number
  to: number
  ready: boolean
}

/** The validity the last record that said anything carried, and when it did. */
export interface CarriedValidity {
  t: number
  validity: RecordValidity
}

/**
 * What the stream says at record time `t`, from the last record that said anything.
 * Its countdowns are aged by `t - last.t`, and `horizonS` is kept. A countdown that has
 * run out flips the state. A flipped state is a guess, so it drops `horizonS`: its null
 * countdown then reads as "unknown", never as "10 s or more". A null countdown with a
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
