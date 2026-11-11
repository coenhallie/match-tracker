/**
 * The HUD's attacking/defending row and zoom badge, ported from
 * PipelineOutputSurface.vue's "team phase labels" tests (:325-453), plus the
 * widget's own: the locale and the team names changing after mount, and the
 * row fitting a narrow widget.
 *
 * The phase is whatever deriveAt works out from the history; these tests put
 * the phase they need in its place, as the reference tests set the replay's
 * phase ref.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import { createMatchTracker, type MatchTracker, type MatchTrackerOptions } from '../../src/index'
import { PERSON_COLORS } from '../../src/render/constants'
import { en } from '../../src/i18n/en'
import { zh } from '../../src/i18n/zh'
import { installEnv, makeHost, type Env } from './env'
import { message } from './messages'

/** The phase deriveAt gives: undefined for its own, otherwise this one. */
const derived = vi.hoisted(() => ({ phase: undefined as TeamPhase | null | undefined }))

vi.mock('../../src/analysis/derive', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/analysis/derive')>()
  return {
    ...real,
    deriveAt: (...args: Parameters<typeof real.deriveAt>) => {
      const out = real.deriveAt(...args)
      return derived.phase === undefined ? out : { ...out, phase: derived.phase }
    },
  }
})

const RED_ATTACKING: TeamPhase = {
  possession: 0,
  attacks: { 0: 1, 1: -1 },
  states: { 0: 'attacking', 1: 'defending' },
}
const BLUE_ATTACKING: TeamPhase = {
  possession: 1,
  attacks: { 0: 1, 1: -1 },
  states: { 0: 'defending', 1: 'attacking' },
}
const BLUE_HAS_IT: TeamPhase = { possession: 1, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }
const NOBODY: TeamPhase = { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }

let env: Env
let sent = 0
const mounted: MatchTracker[] = []

function mount(options: Partial<MatchTrackerOptions> = {}, size: [number, number] = [800, 450]) {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...options })
  mounted.push(tracker)
  env.resize(host, ...size)
  return { host, tracker }
}

/** A new record, with `phase` as its phase, run through to the screen. */
function show(tracker: MatchTracker, phase: TeamPhase | null) {
  derived.phase = phase
  tracker.push(message(sent++, { withBall: true }))
  env.settle()
}

function withPhase(phase: TeamPhase | null, options: Partial<MatchTrackerOptions> = {}) {
  const mountedTracker = mount(options)
  show(mountedTracker.tracker, phase)
  return mountedTracker
}

const shadow = (host: HTMLElement) => host.shadowRoot!
const row = (host: HTMLElement) => shadow(host).querySelector<HTMLElement>('.mt-phase')
const label = (host: HTMLElement, team: 0 | 1) =>
  shadow(host).querySelector<HTMLElement>(`.mt-phase-team[data-team="${team}"]`)
/** The browser's form of a colour set in a style, to compare with one read back. */
function cssColor(color: string): string {
  const probe = document.createElement('div')
  probe.style.backgroundColor = color
  return probe.style.backgroundColor
}

beforeEach(() => {
  env = installEnv()
  derived.phase = undefined
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('the team phase row', () => {
  it('shows each team with its state, team 0 first and each state beside "vs"', () => {
    const { host } = withPhase(RED_ATTACKING)
    expect(label(host, 0)?.textContent).toMatch(/Red\s*Attacking/)
    expect(label(host, 1)?.textContent).toMatch(/Defending\s*Blue/)
    expect(label(host, 0)?.dataset.state).toBe('attacking')
    expect(label(host, 1)?.dataset.state).toBe('defending')
    // The reference's order: team 0, "vs", team 1, with team 1 mirrored.
    const parts = [...row(host)!.children].map((el) => el.textContent?.trim())
    expect(parts).toEqual(['RedAttacking', 'vs', 'DefendingBlue'])
    expect(row(host)?.children[1]?.getAttribute('aria-hidden')).toBe('true')
  })

  it("fills the attacking team's label in its colour, and only that one", () => {
    const { host } = withPhase(BLUE_ATTACKING)
    expect(label(host, 1)?.style.backgroundColor).toBe(cssColor(PERSON_COLORS.away.fill))
    expect(label(host, 0)?.style.backgroundColor).toBe('')
    expect(label(host, 0)?.style.borderColor).toBe(cssColor(PERSON_COLORS.home.fill))
  })

  it('does not fill the label of a team that has the ball but is not attacking yet', () => {
    const { host } = withPhase(BLUE_HAS_IT)
    expect(label(host, 1)?.style.backgroundColor).toBe('')
    expect(label(host, 1)?.textContent?.trim()).toBe('Blue')
  })

  it('shows both teams without a state when nobody is in possession', () => {
    const { host } = withPhase(NOBODY)
    expect(label(host, 0)?.textContent?.trim()).toBe('Red')
    expect(label(host, 1)?.textContent?.trim()).toBe('Blue')
    expect(label(host, 0)?.dataset.state).toBe('none')
  })

  it('describes the phase for screen readers, and says how it is worked out', () => {
    const { host } = withPhase(RED_ATTACKING)
    expect(row(host)?.getAttribute('role')).toBe('group')
    expect(row(host)?.getAttribute('aria-label')).toBe('Red attacking, Blue defending')
    expect(row(host)?.getAttribute('title')).toBe(en.phaseTooltip)
    expect(label(host, 0)?.getAttribute('aria-hidden')).toBe('true')
  })

  it("names the teams the host gives, in the teams' colours", () => {
    const { host } = withPhase(BLUE_ATTACKING, {
      teams: { home: { name: 'Manchester City', color: '#6cabdd' }, away: { name: 'PSG' } },
    })
    expect(label(host, 0)?.textContent).toMatch(/Manchester City\s*Defending/)
    expect(label(host, 1)?.textContent).toMatch(/Attacking\s*PSG/)
    expect(row(host)?.getAttribute('aria-label')).toBe('Manchester City defending, PSG attacking')
    expect(label(host, 0)?.style.borderColor).toBe(cssColor('#6cabdd'))
    expect(label(host, 1)?.style.backgroundColor).toBe(cssColor(PERSON_COLORS.away.fill))
  })

  it('shows a team name in full on hover', () => {
    const { host } = withPhase(NOBODY, { teams: { home: { name: 'Borussia Mönchengladbach' } } })
    expect(label(host, 0)?.getAttribute('title')).toBe('Borussia Mönchengladbach')
  })

  it('shows nothing before there is a phase', () => {
    const { host, tracker } = mount()
    expect(row(host)).toBeNull()
    show(tracker, null)
    expect(row(host)).toBeNull()
    show(tracker, NOBODY)
    expect(row(host)).not.toBeNull()
  })

  it('goes on a reset, and comes back with the next record', () => {
    const { host, tracker } = withPhase(RED_ATTACKING)
    expect(row(host)).not.toBeNull()
    tracker.reset()
    expect(row(host)).toBeNull()
    show(tracker, BLUE_ATTACKING)
    expect(row(host)?.getAttribute('aria-label')).toBe('Red defending, Blue attacking')
  })

  it('follows the phase in place, so a fill fades in as the reference does', () => {
    const { host, tracker } = withPhase(NOBODY)
    const before = { row: row(host), home: label(host, 0), away: label(host, 1) }
    show(tracker, RED_ATTACKING)
    expect(label(host, 0)?.style.backgroundColor).toBe(cssColor(PERSON_COLORS.home.fill))
    expect(label(host, 0)?.textContent).toMatch(/Red\s*Attacking/)
    expect(row(host)).toBe(before.row)
    expect(label(host, 0)).toBe(before.home)
    expect(label(host, 1)).toBe(before.away)
  })

  it('goes with its layer', () => {
    const { host, tracker } = withPhase(RED_ATTACKING)
    tracker.setOptions({ layers: { phaseLabels: false } })
    expect(row(host)).toBeNull()
    tracker.setOptions({ layers: { phaseLabels: true } })
    expect(row(host)?.getAttribute('aria-label')).toBe('Red attacking, Blue defending')
  })

  it('changes language without a remount', () => {
    const { host, tracker } = withPhase(RED_ATTACKING)
    const root = shadow(host).querySelector('.mt-root')
    const canvas = shadow(host).querySelector('canvas')
    const before = row(host)
    tracker.setOptions({ locale: 'zh' })
    expect(label(host, 0)?.textContent).toMatch(/红队\s*进攻中/)
    expect(label(host, 1)?.textContent).toMatch(/防守中\s*蓝队/)
    expect(row(host)?.children[1]?.textContent).toBe('对')
    expect(row(host)?.getAttribute('aria-label')).toBe('红队进攻中，蓝队防守中')
    expect(row(host)?.getAttribute('title')).toBe(zh.phaseTooltip)
    expect(shadow(host).querySelector('.mt-root')).toBe(root)
    expect(shadow(host).querySelector('canvas')).toBe(canvas)
    expect(row(host)).toBe(before)
    tracker.setOptions({ locale: 'en' })
    expect(label(host, 0)?.textContent).toMatch(/Red\s*Attacking/)
  })

  it('mounts in English for a locale it has no text for, and reads a language tag as its language', () => {
    const { host, tracker } = withPhase(RED_ATTACKING, { locale: 'fr' as 'en' })
    expect(label(host, 0)?.textContent).toMatch(/Red\s*Attacking/)
    tracker.setOptions({ locale: 'zh-CN' as 'zh' })
    expect(label(host, 0)?.textContent).toMatch(/红队\s*进攻中/)
    tracker.setOptions({ locale: 'en-GB' as 'en' })
    expect(label(host, 0)?.textContent).toMatch(/Red\s*Attacking/)
  })

  it('is left as it was by options that throw, and takes the next ones', () => {
    const { host, tracker } = withPhase(RED_ATTACKING)
    const poisoned = {} as { goal: string }
    Object.defineProperty(poisoned, 'goal', {
      enumerable: true,
      get() {
        throw new Error('a text the host cannot give')
      },
    })
    expect(() => tracker.setOptions({ text: poisoned, teams: { home: { name: 'Ajax' } } })).toThrow(
      'a text the host cannot give',
    )
    // Nothing of the bad call took: not the text, not the team name that came with it.
    expect(label(host, 0)?.textContent).toMatch(/Red\s*Attacking/)
    tracker.setOptions({ locale: 'zh' })
    expect(label(host, 0)?.textContent).toMatch(/红队\s*进攻中/)
    show(tracker, BLUE_ATTACKING)
    expect(label(host, 1)?.textContent).toMatch(/进攻中\s*蓝队/)
  })

  it('takes a text override for the ARIA label', () => {
    const { host } = withPhase(RED_ATTACKING, {
      text: { phaseAttackingAria: '{team} on the ball', phaseAria: '{home} / {away}' },
    })
    expect(row(host)?.getAttribute('aria-label')).toBe('Red on the ball / Blue defending')
  })

  it("takes a new team name in the row and in the next attack's label on the pitch", () => {
    const { host, tracker } = withPhase(RED_ATTACKING)
    tracker.setOptions({ teams: { home: { name: 'X' } } })
    expect(label(host, 0)?.textContent).toMatch(/^X\s*Attacking$/)
    expect(label(host, 0)?.getAttribute('title')).toBe('X')
    expect(row(host)?.getAttribute('aria-label')).toBe('X attacking, Blue defending')

    const drawn = env.ops(host).length
    expect(tracker.trigger('attack', 0)).toBe(true)
    // Into the attack's hold, where its label is drawn in full.
    for (let i = 0; i < 60; i++) env.frame()
    const texts = env
      .ops(host)
      .slice(drawn)
      .filter((o) => o.op === 'fillText')
      .map((o) => o.args[0])
    expect(texts).toContain('X')
    expect(texts).not.toContain('Red')
  })

  it('cuts a long name short at a 320 px widget, with the whole of it in the tooltip', () => {
    const long = 'Borussia Mönchengladbach Fußball-Club 19'
    expect(long).toHaveLength(40)
    const { host, tracker } = mount({ teams: { home: { name: long } } }, [320, 220])
    show(tracker, RED_ATTACKING)
    const phase = row(host)!
    // happy-dom lays nothing out, so this holds there whatever the CSS says:
    // the real check is in a browser (task report), at 320, 375, 768 and
    // 1280 px wide. What is pinned here is the markup it relies on.
    expect(phase.scrollWidth).toBeLessThanOrEqual(phase.clientWidth)
    expect(label(host, 0)?.getAttribute('title')).toBe(long)
    expect(phase.getAttribute('aria-label')).toBe(`${long} attacking, Blue defending`)
    expect(label(host, 0)?.querySelector('.mt-phase-name')?.textContent).toBe(long)
  })
})

/** The rules of STYLES inside `@container (<query>)`, by selector, comments left out. */
async function containerRules(query: string): Promise<Map<string, string>> {
  const { STYLES } = await import('../../src/widget/styles')
  const css = STYLES.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = css.indexOf(`@container (${query}) {`)
  if (start < 0) return new Map()
  let depth = 0
  let end = start
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const body = css.slice(css.indexOf('{', start) + 1, end)
  return new Map([...body.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!.replace(/\s+/g, ' ').trim()]))
}

describe('the team phase row on a narrow widget', () => {
  // happy-dom lays nothing out: what is pinned here is the CSS the row fits
  // by, and the markup it keeps for screen readers. The fit itself is
  // checked in a browser at 160, 200, 240 and 320 px, in English and Chinese.
  it('drops the state words below 260 px, and keeps them for screen readers', async () => {
    const rules = await containerRules('width < 260px')
    expect(rules.get('.mt-phase-state')).toContain('display: none')
    const { host } = withPhase(RED_ATTACKING)
    expect(row(host)?.getAttribute('aria-label')).toBe('Red attacking, Blue defending')
    expect(label(host, 0)?.querySelector('.mt-phase-state')?.textContent).toBe('Attacking')
  })

  it('drops "vs" too below 200 px, the two names sharing the row', async () => {
    const rules = await containerRules('width < 200px')
    expect(rules.get('.mt-phase-vs')).toContain('display: none')
    expect(rules.get('.mt-phase')).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)')
  })

  it('cuts the names short in their labels rather than letting them overflow', async () => {
    const rules = await containerRules('width < 360px')
    expect(rules.get('.mt-phase-team')).toContain('min-width: 0')
    const { STYLES } = await import('../../src/widget/styles')
    expect(STYLES).toMatch(/\.mt-phase-name \{[^}]*min-width: 0;[^}]*text-overflow: ellipsis;/)
    expect(STYLES).toMatch(/\.mt-phase-team \{[^}]*overflow: hidden;/)
  })
})
