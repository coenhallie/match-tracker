/**
 * The debug badge for a player loss (the `debug` option), the widget's own:
 * in the shadow root, top left, while too few players are tracked on the
 * frame on screen, and nowhere otherwise.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMatchTracker, type MatchTracker, type MatchTrackerOptions } from '../../src/index'
import { en } from '../../src/i18n/en'
import { LossBadge } from '../../src/widget/hud'
import { installEnv, makeHost, type Env } from './env'
import { message } from './messages'

let env: Env
let sent = 0
const mounted: MatchTracker[] = []

function mount(options: Partial<MatchTrackerOptions> = {}) {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...options })
  mounted.push(tracker)
  env.resize(host, 800, 450)
  return { host, tracker }
}

/** The fixture's message, with only the first `players` of its players tracked. */
function withPlayers(players: number): string {
  const parsed = JSON.parse(message(sent++, { withBall: true })) as {
    match: { teams: Array<{ team_id: number; players: unknown[] }> }
  }
  let left = players
  for (const team of parsed.match.teams) {
    if (team.team_id !== 0 && team.team_id !== 1) continue
    team.players = team.players.slice(0, Math.max(0, left))
    left -= team.players.length
  }
  return JSON.stringify(parsed)
}

function show(tracker: MatchTracker, players: number) {
  tracker.push(withPlayers(players))
  env.settle()
}

const badge = (host: HTMLElement) => host.shadowRoot!.querySelector<HTMLElement>('.mt-loss')

beforeEach(() => {
  env = installEnv()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('the player loss badge', () => {
  it('says how many players are tracked while too few are, in developer mode', () => {
    const { host, tracker } = mount({ debug: true })
    show(tracker, 9)
    expect(badge(host)?.textContent).toBe('Player loss: 9 tracked')
    expect(badge(host)?.parentElement?.classList.contains('mt-hud')).toBe(true)
    show(tracker, 22)
    expect(badge(host)).toBeNull()
  })

  it('is not in the DOM outside developer mode, and follows the option', () => {
    const { host, tracker } = mount()
    show(tracker, 9)
    expect(badge(host)).toBeNull()
    tracker.setOptions({ debug: true })
    expect(badge(host)?.textContent).toBe('Player loss: 9 tracked')
    tracker.setOptions({ debug: false })
    expect(badge(host)).toBeNull()
  })

  it('speaks the locale, and goes on a reset and with the tracker', () => {
    const { host, tracker } = mount({ debug: true, locale: 'zh' })
    show(tracker, 17)
    expect(badge(host)?.textContent).toBe('球员丢失：仅跟踪到 17 人')
    tracker.reset()
    expect(badge(host)).toBeNull()
    show(tracker, 17)
    tracker.destroy()
    expect(host.shadowRoot?.querySelector('.mt-loss') ?? null).toBeNull()
  })

  it('names the team whose attack covers the loss', () => {
    const parent = document.createElement('div')
    const loss = new LossBadge(parent)
    const name = (team: 0 | 1) => (team === 0 ? 'Red' : 'Blue')
    loss.update({ players: 9, cover: 1 }, true, en, name)
    expect(parent.textContent).toBe("Player loss: 9 tracked, covered by Blue's attack")
    expect(parent.querySelector<HTMLElement>('.mt-loss')?.dataset.cover).toBe('1')
    loss.update({ players: 9, cover: null }, true, en, name)
    expect(parent.textContent).toBe('Player loss: 9 tracked')
    loss.update(null, true, en, name)
    expect(parent.children).toHaveLength(0)
  })
})
