
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
