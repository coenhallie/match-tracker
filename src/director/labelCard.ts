/**
 * A label card (labelCards.ts in model), which the reference does not have:
 * one class for them all, built on the corner's timing and the throw-in's
 * leaving the players as they are.
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
 * It is shown once per run of the label, however it flickers
 * (LABEL_CARD_REARM_S). A label seen while another moment blocks the card does
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
  isLabelCardFrame,
  type LabelCardIndicator,
} from '../render/labelCard.js'
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
}

export class LabelCard implements Moment {
  private showing: Showing | null = null

  readonly key: LabelCardKey
  private readonly labels: readonly string[]
  private readonly until: (typeof LABEL_CARDS)[number]['until']

  constructor(
    private readonly ctx: MomentContext,
    card: (typeof LABEL_CARDS)[number],
  ) {
    this.key = card.key
    this.labels = card.labels
    this.until = card.until
  }

  get active(): boolean {
    return this.showing !== null
  }

  get idle(): boolean {
    return this.showing?.idle ?? false
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
    if (run.seenAt === null || now - run.seenAt > LABEL_CARD_REARM_S) run.shown = false
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
   * way from there, and stays its full time.
   */
  start(now: number, frame: Frame, byHand = false, fromIntensity = 0): void {
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
    const over =
      this.until === 'nextLabel'
        ? card.leaveAsked
        : card.byHand
          ? card.elapsedMs >= LABEL_CARD_DEMO_MS - (still ? 0 : LABEL_CARD_OUT_MS)
          : card.elapsedMs >= LABEL_CARD_SHOW_MS && !labelOn
    if (card.leavingFromMs === null && over) {
      if (still) return 'stop'
      card.leavingFromMs = card.elapsedMs
      card.leavingFromIntensity = was
    }
    if (card.leavingFromMs !== null && card.elapsedMs - card.leavingFromMs >= LABEL_CARD_OUT_MS) return 'stop'
    if (this.until === 'nextLabel' && card.leavingFromMs === null && (still || card.elapsedMs >= LABEL_CARD_IN_MS)) {
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
    return { key: this.key, intensity: this.intensity(card) }
  }

  reset(): void {
    this.showing = null
  }

  private intensity(card: Showing): number {
    if (this.ctx.reducedMotion()) return 1
    if (card.leavingFromMs !== null) {
      return card.leavingFromIntensity * Math.max(0, 1 - (card.elapsedMs - card.leavingFromMs) / LABEL_CARD_OUT_MS)
    }
    return Math.min(1, card.fromIntensity + (1 - card.fromIntensity) * (card.elapsedMs / LABEL_CARD_IN_MS))
  }
}
