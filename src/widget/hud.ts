/**
 * The HUD's attacking/defending row and zoom badge, ported from
 * PipelineOutputSurface.vue (6f14d1f): the row's template (`:1503-1550`)
 * with `phaseLabels` and `phaseDescription` (`:627-666`), and the zoom badge
 * (`:1756-1761`). Styles are in styles.ts.
 *
 * The row is kept and changed in place, as Vue patches the reference's keyed
 * labels, so a label filling with its team's colour fades as it does there.
 */
import type { TeamId, TeamPhase, TeamState } from '../analysis/teamPhase.js'
import type { PlayerLossState } from '../director/director.js'
import { formatText, type TrackerText } from '../i18n/text.js'

/** What the row says the teams are, and how it draws them. */
export interface PhaseLook {
  text: TrackerText
  teamName: (team: TeamId) => string
  teamColor: (team: TeamId) => string
}

const TEAMS: readonly TeamId[] = [0, 1]

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  el.className = className
  return el
}

interface TeamLabel {
  el: HTMLDivElement
  name: HTMLSpanElement
  state: HTMLSpanElement
}

/** What the row shows, to tell a change from the same again. */
interface Shown {
  names: Record<TeamId, string>
  colors: Record<TeamId, string>
  states: Record<TeamId, TeamState | null>
  text: TrackerText
}

/**
 * The team phase row, above the pitch: each team's name and state either
 * side of "vs", the attacking team filled in its colour. Nothing is shown
 * before there is a phase, or while its layer is off.
 */
export class PhaseRow {
  /** Where the row goes: a box spanning the HUD above it, which the row centres in. */
  readonly box: HTMLDivElement
  private readonly row: HTMLDivElement
  private readonly vs: HTMLSpanElement
  private readonly labels: Record<TeamId, TeamLabel>
  private shown: Shown | null = null

  constructor() {
    this.box = element('div', 'mt-phase-box')
    this.row = element('div', 'mt-phase')
    this.row.setAttribute('role', 'group')
    this.vs = element('span', 'mt-phase-vs')
    this.vs.setAttribute('aria-hidden', 'true')
    const label = (team: TeamId): TeamLabel => {
      const el = element('div', 'mt-phase-team')
      el.dataset.team = String(team)
      // The group's label says it all for a screen reader.
      el.setAttribute('aria-hidden', 'true')
      return { el, name: element('span', 'mt-phase-name'), state: element('span', 'mt-phase-state') }
    }
    this.labels = { 0: label(0), 1: label(1) }
    this.row.append(this.labels[0].el, this.vs, this.labels[1].el)
  }

  /** Show `phase` as `look` says, or nothing when there is no phase or `on` is false. */
  update(phase: TeamPhase | null, on: boolean, look: PhaseLook): void {
    if (!phase || !on) {
      this.row.remove()
      this.shown = null
      return
    }
    const next: Shown = {
      names: { 0: look.teamName(0), 1: look.teamName(1) },
      colors: { 0: look.teamColor(0), 1: look.teamColor(1) },
      states: { 0: phase.states[0], 1: phase.states[1] },
      text: look.text,
    }
    if (!this.shown || !sameShown(this.shown, next)) this.render(next)
    this.shown = next
    if (this.row.parentNode !== this.box) this.box.append(this.row)
  }

  private render({ names, colors, states, text }: Shown): void {
    const stateText = (state: TeamState | null) =>
      state === 'attacking' ? text.attacking : state === 'defending' ? text.defending : null
    this.row.title = text.phaseTooltip
    this.vs.textContent = text.versus
    for (const team of TEAMS) {
      const { el, name, state } = this.labels[team]
      const words = stateText(states[team])
      el.dataset.state = states[team] ?? 'none'
      el.title = names[team]
      el.style.borderColor = colors[team]
      // Only an attacking team is filled: a team that merely has the ball,
      // or nobody clearly having it, leaves both labels plain.
      el.style.backgroundColor = states[team] === 'attacking' ? colors[team] : ''
      name.textContent = names[team]
      state.textContent = words ?? ''
      // Mirrored for team 1, so both states sit either side of "vs".
      const parts = words === null ? [name] : team === 0 ? [name, state] : [state, name]
      if (el.childNodes.length !== parts.length || parts.some((part, i) => el.childNodes[i] !== part)) {
        el.replaceChildren(...parts)
      }
    }
    this.row.setAttribute('aria-label', describe(names, states, text))
  }
}

/** The row for a screen reader: each team by name, with its state, team 0 first (`phaseDescription`). */
function describe(names: Record<TeamId, string>, states: Record<TeamId, TeamState | null>, text: TrackerText): string {
  const part = (team: TeamId) => {
    const state = states[team]
    if (state === 'attacking') return formatText(text.phaseAttackingAria, { team: names[team] })
    if (state === 'defending') return formatText(text.phaseDefendingAria, { team: names[team] })
    return names[team]
  }
  return formatText(text.phaseAria, { home: part(0), away: part(1) })
}

const sameShown = (a: Shown, b: Shown) =>
  a.text === b.text &&
  TEAMS.every((t) => a.names[t] === b.names[t] && a.colors[t] === b.colors[t] && a.states[t] === b.states[t])

/** The zoom, bottom right, while the view is zoomed in. */
export class ZoomBadge {
  private readonly el = element('div', 'mt-zoom')

  constructor(private readonly parent: HTMLElement) {}

  update(zoom: number, text: TrackerText): void {
    if (!(zoom > 1)) {
      this.el.remove()
      return
    }
    const label = formatText(text.zoomLevel, { zoom: zoom.toFixed(1) })
    if (this.el.textContent !== label) this.el.textContent = label
    if (this.el.parentNode !== this.parent) this.parent.append(this.el)
  }
}

/**
 * The debug badge, top left, while too few players are tracked on the
 * frame on screen: how many are, and whose attack covers the loss when one
 * does (the `debug` option). Nothing is in the DOM while it is off or there
 * is no loss.
 */
export class LossBadge {
  private readonly el = element('div', 'mt-loss')

  constructor(private readonly parent: HTMLElement) {}

  update(loss: PlayerLossState | null, on: boolean, text: TrackerText, teamName: (team: TeamId) => string): void {
    if (!on || !loss) {
      this.el.remove()
      return
    }
    const players = String(loss.players)
    const label =
      loss.cover === null
        ? formatText(text.playerLoss, { players })
        : formatText(text.playerLossCover, { players, team: teamName(loss.cover) })
    if (this.el.textContent !== label) this.el.textContent = label
    this.el.dataset.cover = loss.cover === null ? 'none' : String(loss.cover)
    if (this.el.parentNode !== this.parent) this.parent.append(this.el)
  }
}
