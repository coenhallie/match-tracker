/**
 * The player cards and the substitutions waiting to play (labelCards.ts in model), which the
 * reference does not have.
 *
 * A card's label sits on one record of the live stream, so a card that cannot play as its label
 * comes (a goal or a corner showing, or another centre card) would never see its label again, as
 * the other label cards do once nothing blocks them. So each card label waits here, and the
 * director plays them in the order they came, each its full time, the next as soon as nothing
 * blocks it. A label is one card however many records carry it: by its `uuid`, or, as replay data
 * has none, by its card, team and shirt number, with the label cards' re-arm (LABEL_CARD_REARM_S):
 * seen again within that of the last time, it is the same card. Two players booked together are
 * two cards either way. A substitution is told apart the same way, by its team and its two players.
 */
import type { CardLabel } from '../analysis/cardLabels.js'
import type { SubstitutionLabel } from '../analysis/substitutionLabels.js'
import type { TeamId } from '../analysis/teamPhase.js'
import type { PlayerCardKey } from '../model/labelCards.js'
import { LABEL_CARD_REARM_S } from '../render/labelCard.js'

/** A label waiting to play: a card for a player, or a substitution. */
export type QueuedLabel = CardLabel | SubstitutionLabel

export class CardQueue {
  private waiting: QueuedLabel[] = []
  /** The labels seen, queued or skipped, by uuid. */
  private uuids = new Set<string>()
  /** For labels with no uuid: when each card for each player was last seen, in replay seconds. */
  private lastSeen = new Map<string, number>()

  /** Queue `label`, seen at `now`, unless it has been seen before. */
  add(label: QueuedLabel, now: number): void {
    if (this.seen(label, now)) this.push(label)
  }

  /** Note `label`, seen at `now`, as one not to play: landed on by a seek, it is under way. */
  skip(label: QueuedLabel, now: number): void {
    this.seen(label, now)
  }

  /** Note `label` as seen at `now`; whether it is news. A substitution that joins a card is noted, not queued. */
  seen(label: QueuedLabel, now: number): boolean {
    if (label.uuid !== null) {
      if (this.uuids.has(label.uuid)) return false
      this.uuids.add(label.uuid)
      return true
    }
    const who = label.key === 'substitution' ? `${label.key} ${label.team} ${label.from} ${label.to}` : `${label.key} ${label.team} ${label.number}`
    const last = this.lastSeen.get(who)
    this.lastSeen.set(who, now)
    return last === undefined || now - last > LABEL_CARD_REARM_S
  }

  /** Queue `label`, seen already. */
  push(label: QueuedLabel): void {
    this.waiting.push(label)
  }

  peek(): QueuedLabel | undefined {
    return this.waiting[0]
  }

  take(): QueuedLabel | undefined {
    return this.waiting.shift()
  }

  /**
   * The substitutions for `team` waiting at the head, in order, up to `max`, taken: those that
   * go on one card with the substitution just taken.
   */
  takeSubstitutions(team: TeamId | null, max: number): SubstitutionLabel[] {
    const taken: SubstitutionLabel[] = []
    while (taken.length < max) {
      const next = this.waiting[0]
      if (next?.key !== 'substitution' || next.team !== team) break
      taken.push(next)
      this.waiting.shift()
    }
    return taken
  }

  /** Back at the head: a card cut short before it had stayed its time. */
  putBack(label: QueuedLabel): void {
    this.waiting.unshift(label)
  }

  /** Let go of the labels waiting under `key`, as its layer goes off. */
  drop(key: PlayerCardKey | 'substitution'): void {
    this.waiting = this.waiting.filter((label) => label.key !== key)
  }

  /** Forget everything: after a seek or a reset, a label is news again. */
  clear(): void {
    this.waiting = []
    this.uuids.clear()
    this.lastSeen.clear()
  }
}
