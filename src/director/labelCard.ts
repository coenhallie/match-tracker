/**
 * A label card (labelCards.ts in model), which the reference does not have:
 * one class for them all, built on the corner's timing and its fading out
 * everyone on the pitch and the ball, which the renderer does by the card's
 * intensity.
 *
 * When playback runs into a frame a human gave one of the card's labels, the
 * card fades in across the middle of the pitch, stays for at least
 * LABEL_CARD_SHOW_MS and after that for as long as the label is on, then fades
 * out. Not as long as play is stopped, as the corner is: play can stay stopped
 * for minutes after a card's event.
 *
 * A card that stays until the next label (half time) does not time out at all.
 * It stays, asking for no animation frames, until a human gives a label it has
 * not been seeing, whatever that label is, then fades out. The new label's own
 * moment, if it has one, plays as the card goes. A pause does not end it, nor
 * does coming back to a hidden tab in live mode, but a seek and a press still
 * do: it would no longer say anything about the frame someone has gone to.
 *
 * A small card is shown as a throw-in is: it fades in along the bottom
 * touchline, stays for SMALL_CARD_SHOW_MS whatever its label does, and fades out,
 * with the pitch left as it is. An attack shows alongside it, and it takes over
 * from a throw-in or another small card, and they from it. It does not go over a
 * centre card, which takes over from it.
 *
 * It is shown once per run of the label, however it flickers
 * (LABEL_CARD_REARM_S, or SMALL_CARD_REARM_S). A label seen while another moment blocks the card does
 * not use its one showing up: a VAR check is usually called just as a goal is
 * being shown, so the card plays on the first labelled frame after the goal.
 * It only plays during playback, anything that means someone wants the real
 * frame stops it at once, and a goal, a corner or another label card takes
 * over from it: a goal disallowed answers the VAR check before it, however
 * short its label, so it does not wait behind it. Played by hand, it is on screen for LABEL_CARD_DEMO_MS whatever the label does.
 */
import { humanLabelNames } from '../analysis/actionLabels.js'
import { LABEL_HOLD_S } from '../analysis/stoppage.js'
import type { LABEL_CARDS, LabelCardKey } from '../model/labelCards.js'
import type { Frame } from '../model/types.js'
import {
  LABEL_CARD_DEMO_MS,
  LABEL_CARD_IN_MS,
  LABEL_CARD_OUT_MS,
  LABEL_CARD_REARM_S,
  LABEL_CARD_SHOW_MS,
  SMALL_CARD_IN_MS,
  SMALL_CARD_REARM_S,
  SMALL_CARD_SHOW_MS,
  isLabelCardFrame,
  type LabelCardIndicator,
  type LabelCardPlayer,
  type LabelCardSubstitution,
  SUBSTITUTION_LIFT_MS,
  SUBSTITUTION_MAX_ROWS,
  SUBSTITUTION_ROW_IN_MS,
  SUBSTITUTION_SHOW_MS,
} from '../render/labelCard.js'
import type { SubstitutionLabel } from '../analysis/substitutionLabels.js'
import type { TeamId } from '../analysis/teamPhase.js'
import type { QueuedLabel } from './cardQueue.js'

/** A substitution on the card, as drawn: its label, and the two players' words, null for one not named. */
export interface SubstitutionOnCard {
  label: SubstitutionLabel
  out: string | null
  in: string | null
}

/** Who a card is about, and the labels it was played from, to queue again if it is cut short. */
export interface CardAbout {
  /** For a player card: who it is for, as drawn. */
  player?: LabelCardPlayer
  labels?: QueuedLabel[]
  /** For the substitution card: its team, its name as drawn, and its rows so far. */
  substitution?: { team: TeamId | null; teamName: string | null; rows: SubstitutionOnCard[] }
}

/** A row on a substitution card showing, and when it joined, in ms from the card's start. */
interface Row extends SubstitutionOnCard {
  joinedMs: number
}
import type { LabelRun, Moment, MomentContext, MomentStep } from './moment.js'

interface Showing {
  /** How strongly it starts: 0, or the strength of the card it took over from, so the band does not blink. */
  fromIntensity: number
  startedMs: number | null
  elapsedMs: number
  /** When it started to fade out, in ms from its start; null until then. */
  leavingFromMs: number | null
  /** How strongly it was drawn as it started to fade out. */
  leavingFromIntensity: number
  /** The next label has come: it starts to fade out at its next step. */
  leaveAsked: boolean
  /** Stayed as it is since its last step, which said 'hold'. */
  idle: boolean
  /** The other labels it has been seeing, by name, and when each was last seen: not news when they carry on. */
  labelsSeen: Map<string, number>
  /** Played by hand: on screen for LABEL_CARD_DEMO_MS, whatever the label does. */
  byHand: boolean
  /** For a player card: who it is for, as drawn. */
  player: LabelCardPlayer | undefined
  /** The labels it was played from, to queue again if it is cut short: none for one played by hand. */
  labels: QueuedLabel[]
  /** For the substitution card: its team and rows, and how it is gliding to its height. */
  substitution: {
    team: TeamId | null
    teamName: string | null
    rows: Row[]
    /** When the last row joined, in ms from the start: what its time runs from. */
    lastJoinMs: number
    /** The rows it was sized for as it started gliding, and when. */
    glideFrom: number
    glideStartMs: number
  } | null
}

export class LabelCard implements Moment {
  private showing: Showing | null = null

  readonly key: LabelCardKey
  private readonly labels: readonly string[]
  private readonly until: (typeof LABEL_CARDS)[number]['until']
  /** A small card, along the touchline, rather than a centre card. */
  readonly small: boolean
  /** Whether the zoom near goal eases out to the whole pitch while it shows. */
  readonly makesWay: boolean
  private readonly inMs: number

  constructor(
    private readonly ctx: MomentContext,
    card: (typeof LABEL_CARDS)[number],
  ) {
    this.key = card.key
    this.labels = card.labels
    this.until = card.until
    this.small = card.size === 'small'
    this.makesWay = card.makesWay
    this.inMs = this.small ? SMALL_CARD_IN_MS : LABEL_CARD_IN_MS
  }

  get active(): boolean {
    return this.showing !== null
  }

  get idle(): boolean {
    return this.showing?.idle ?? false
  }

  /** The labels the card showing was played from, in order: none for one played by hand, or none showing. */
  get playedFrom(): QueuedLabel[] {
    return this.showing?.labels ?? []
  }

  /** Up, and not yet shown its time since it started or its last row joined: cut short, it is not a card played. */
  get cutShort(): boolean {
    const card = this.showing
    if (!card || !this.holdsBack) return false
    const sub = card.substitution
    return sub ? card.elapsedMs - sub.lastJoinMs < SUBSTITUTION_SHOW_MS : card.elapsedMs < LABEL_CARD_SHOW_MS
  }

  /** Whether a substitution for `team` can join the card: a substitution card up for that team, not full. */
  canJoin(team: TeamId | null): boolean {
    const sub = this.showing?.substitution
    return !!sub && this.holdsBack && !this.showing!.byHand && sub.team === team && sub.rows.length < SUBSTITUTION_MAX_ROWS
  }

  /** Add `row` to the substitution card up: it fades in, the card glides to fit it, and its time starts again. */
  join(row: SubstitutionOnCard): void {
    const card = this.showing
    const sub = card?.substitution
    if (!card || !sub) return
    sub.glideFrom = this.rowsShown(card)
    sub.glideStartMs = card.elapsedMs
    sub.rows.push({ ...row, joinedMs: card.elapsedMs })
    sub.lastJoinMs = card.elapsedMs
    card.labels.push(row.label)
  }

  /** Showing, and not on its way out: what holds back an attack or a throw-in. */
  get holdsBack(): boolean {
    const card = this.showing
    return card !== null && card.leavingFromMs === null && !card.leaveAsked
  }

  private get run(): LabelRun {
    return this.ctx.memory().labelCards[this.key]
  }

  /**
   * Whether `frame` is this card's label, come to by playback, with the card
   * not yet shown for this run of the label. Called for every new record;
   * `blocked` is a goal or a corner showing, which the card does not go over.
   */
  detect(frame: Frame, now: number, blocked: boolean): boolean {
    const run = this.run
    const labelled = isLabelCardFrame(frame, this.labels)
    // Landed on by a seek or a step: an event under way has been seen.
    if (!this.ctx.playback()) {
      run.seenAt = labelled ? now : null
      run.shown = labelled
      return false
    }
    if (!labelled) return false
    const rearm = this.small ? SMALL_CARD_REARM_S : LABEL_CARD_REARM_S
    if (run.seenAt === null || now - run.seenAt > rearm) run.shown = false
    run.seenAt = now
    return !run.shown && this.ctx.layers()[this.key] && !blocked && !this.showing
  }

  /** Showing until the next label, which has not come: what a pause, or coming back to a hidden tab, leaves up. */
  get staysOn(): boolean {
    return this.until === 'nextLabel' && this.holdsBack
  }

  /**
   * For a card that stays until the next label: whether a human gave `frame` a
   * label it has not been seeing, so that it goes. A label on it as it started,
   * or dropping out for a record or two, is not news, nor is its own. True when
   * it needs an animation frame it was not going to get.
   */
  notice(frame: Frame, now: number): boolean {
    const card = this.showing
    if (!card || this.until !== 'nextLabel' || !this.holdsBack) return false
    let news = false
    for (const name of humanLabelNames(frame)) {
      const seenAt = card.labelsSeen.get(name)
      if (!this.labels.includes(name) && (seenAt === undefined || now - seenAt >= LABEL_HOLD_S)) news = true
      card.labelsSeen.set(name, now)
    }
    if (!news) return false
    const wasIdle = card.idle
    card.leaveAsked = true
    card.idle = false
    return wasIdle
  }

  /**
   * Show it, on `frame`; `byHand` for LABEL_CARD_DEMO_MS whatever the label
   * does, unless it stays until the next label. Taking over from another card,
   * `fromIntensity` is how strongly that was drawn: it fades in the rest of the
   * way from there, and stays its full time. `about` says who a player card or
   * the substitution card is about, and the labels it was played from.
   */
  start(now: number, frame: Frame, byHand = false, fromIntensity = 0, about: CardAbout = {}): void {
    const run = this.run
    run.seenAt = now
    run.shown = true
    this.showing = {
      fromIntensity,
      startedMs: null,
      elapsedMs: 0,
      leavingFromMs: null,
      leavingFromIntensity: 1,
      leaveAsked: false,
      idle: false,
      labelsSeen: new Map(humanLabelNames(frame).map((name) => [name, now])),
      byHand,
      player: about.player,
      labels: [...(about.labels ?? [])],
      substitution: about.substitution
        ? {
            team: about.substitution.team,
            teamName: about.substitution.teamName,
            rows: about.substitution.rows.map((row) => ({ ...row, joinedMs: 0 })),
            lastJoinMs: 0,
            glideFrom: about.substitution.rows.length,
            glideStartMs: 0,
          }
        : null,
    }
  }

  step(ms: number): MomentStep {
    const card = this.showing
    if (!card) return 'stop'
    if (card.startedMs === null) card.startedMs = ms
    const was = this.intensity(card)
    card.elapsedMs = ms - card.startedMs
    const still = this.ctx.reducedMotion()
    const { seenAt } = this.run
    const labelOn = seenAt !== null && this.ctx.shown().time - seenAt < LABEL_HOLD_S
    const over = this.isOver(card, labelOn, still)
    if (card.leavingFromMs === null && over) {
      if (still) return 'stop'
      card.leavingFromMs = card.elapsedMs
      card.leavingFromIntensity = was
    }
    if (card.leavingFromMs !== null && card.elapsedMs - card.leavingFromMs >= LABEL_CARD_OUT_MS) return 'stop'
    if (this.until === 'nextLabel' && card.leavingFromMs === null && (still || card.elapsedMs >= this.inMs)) {
      card.idle = true
      return 'hold'
    }
    return 'paint'
  }

  /** End it at once, back to the frame as it is. */
  stop(): boolean {
    if (!this.showing) return false
    this.showing = null
    return true
  }

  /** What is drawn for it now, with the theme's words and icon. */
  value(): LabelCardIndicator | undefined {
    const card = this.showing
    if (!card) return undefined
    return {
      key: this.key,
      intensity: this.intensity(card),
      ...(card.player ? { player: card.player } : {}),
      ...(card.substitution ? { substitution: this.substitution(card) } : {}),
    }
  }

  reset(): void {
    this.showing = null
  }

  /** The substitution card's team and rows as drawn now: each row fading in from when it joined, the card gliding to fit them. */
  private substitution(card: Showing): LabelCardSubstitution {
    const sub = card.substitution!
    const still = this.ctx.reducedMotion()
    return {
      team: sub.teamName,
      rows: sub.rows.map((row) => ({
        out: row.out,
        in: row.in,
        intensity: still || row.joinedMs === 0 ? 1 : Math.min(1, (card.elapsedMs - row.joinedMs) / SUBSTITUTION_ROW_IN_MS),
      })),
      rowsShown: still ? sub.rows.length : this.rowsShown(card),
    }
  }

  /** How many rows the card is sized for now, gliding from where it was to its rows, easing out. */
  private rowsShown(card: Showing): number {
    const sub = card.substitution!
    const k = Math.min(1, Math.max(0, (card.elapsedMs - sub.glideStartMs) / SUBSTITUTION_LIFT_MS))
    const eased = 1 - (1 - k) ** 3
    return sub.glideFrom + (sub.rows.length - sub.glideFrom) * eased
  }

  /** Whether it is time to go: at once under reduced motion, or else with room left to fade out when played by hand. */
  private isOver(card: Showing, labelOn: boolean, still: boolean): boolean {
    if (this.until === 'nextLabel') return card.leaveAsked
    if (this.until === 'time') return card.elapsedMs >= SMALL_CARD_SHOW_MS
    if (card.byHand) return card.elapsedMs >= LABEL_CARD_DEMO_MS - (still ? 0 : LABEL_CARD_OUT_MS)
    if (card.substitution) return card.elapsedMs - card.substitution.lastJoinMs >= SUBSTITUTION_SHOW_MS
    return card.elapsedMs >= LABEL_CARD_SHOW_MS && !labelOn
  }

  private intensity(card: Showing): number {
    if (this.ctx.reducedMotion()) return 1
    if (card.leavingFromMs !== null) {
      return card.leavingFromIntensity * Math.max(0, 1 - (card.elapsedMs - card.leavingFromMs) / LABEL_CARD_OUT_MS)
    }
    return Math.min(1, card.fromIntensity + (1 - card.fromIntensity) * (card.elapsedMs / this.inMs))
  }
}
