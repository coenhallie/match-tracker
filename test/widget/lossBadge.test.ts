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
    loss.update({ cause: 'playerLoss', players: 9, cover: 1 }, true, en, name)
    expect(parent.textContent).toBe("Player loss: 9 tracked, covered by Blue's attack")
    expect(parent.querySelector<HTMLElement>('.mt-loss')?.dataset.cover).toBe('1')
    loss.update({ cause: 'playerLoss', players: 9, cover: null }, true, en, name)
    expect(parent.textContent).toBe('Player loss: 9 tracked')
    loss.update(null, true, en, name)
    expect(parent.children).toHaveLength(0)
  })

  it('says an attack covers invalid frames, or that no side could be chosen for them', () => {
    const parent = document.createElement('div')
    const loss = new LossBadge(parent)
    const name = (team: 0 | 1) => (team === 0 ? 'Red' : 'Blue')
    loss.update({ cause: 'invalidFrames', players: 22, cover: 0 }, true, en, name)
    expect(parent.textContent).toBe("Invalid frames: covered by Red's attack")
    expect(parent.querySelector<HTMLElement>('.mt-loss')?.dataset.cause).toBe('invalidFrames')
    loss.update({ cause: 'invalidFrames', players: 22, cover: null }, true, en, name)
    expect(parent.textContent).toBe('Invalid frames, no attacker')
    loss.update({ cause: 'playerLoss', players: 9, cover: null }, true, en, name)
    expect(parent.querySelector<HTMLElement>('.mt-loss')?.dataset.cause).toBe('playerLoss')
  })

  it('counts down to the frames being valid again', () => {
    const parent = document.createElement('div')
    const loss = new LossBadge(parent)
    const name = (team: 0 | 1) => (team === 0 ? 'Red' : 'Blue')
    loss.update({ cause: 'invalidFrames', players: 22, cover: 0, validInS: 3.24, horizonS: 10 }, true, en, name)
    expect(parent.textContent).toBe("Invalid frames: covered by Red's attack, valid in 3.2 s")
    loss.update({ cause: 'invalidFrames', players: 22, cover: null, validInS: 0.04 }, true, en, name)
    expect(parent.textContent).toBe('Invalid frames, no attacker, valid in 0.0 s')
    loss.update({ cause: 'invalidFrames', players: 22, cover: 0, validInS: null, horizonS: 10 }, true, en, name)
    expect(parent.textContent).toBe("Invalid frames: covered by Red's attack, valid in over 10 s")
    // The pipeline's horizon is 9.999999999990905: whole seconds.
    loss.update({ cause: 'invalidFrames', players: 22, cover: 1, validInS: null, horizonS: 9.999999999990905 }, true, en, name)
    expect(parent.textContent).toBe("Invalid frames: covered by Blue's attack, valid in over 10 s")
    loss.update({ cause: 'invalidFrames', players: 22, cover: null, validInS: 0.8, short: true }, true, en, name)
    expect(parent.textContent).toBe('Invalid frames, under 1 s: not covered, valid in 0.8 s')
    // Beyond a horizon the record did not give, there is nothing to say.
    loss.update({ cause: 'invalidFrames', players: 22, cover: 0, validInS: null }, true, en, name)
    expect(parent.textContent).toBe("Invalid frames: covered by Red's attack")
  })

  it('says so in live mode while the frame on screen is invalid', () => {
    const { host, tracker } = mount({ debug: true })
    const at = (state: 'valid' | 'invalid') => {
      const parsed = JSON.parse(withPlayers(22)) as { raw_data?: unknown }
      parsed.raw_data = {
        source_frame: { frame_state: state },
        agentic: { lookahead: { horizon_s: 10, next_invalid_in_s: state === 'invalid' ? 0 : null, next_valid_in_s: state === 'invalid' ? 3 : 0 } },
      }
      tracker.push(JSON.stringify(parsed))
      env.settle()
    }
    at('valid')
    expect(badge(host)).toBeNull()
    at('invalid')
    expect(badge(host)?.textContent).toMatch(/^Invalid frames.*, valid in 3\.0 s$/)
    at('valid')
    env.settle()
    expect(badge(host)).toBeNull()
  })

  it('says what replay is playing, in developer mode', () => {
    const { host, tracker } = mount({ debug: true })
    const at = (i: number, state: 'valid' | 'long', labels?: string[]) => {
      const parsed = JSON.parse(message(sent++, { withBall: true, t: 2700 + i * 0.04 })) as {
        match: { state?: unknown }
        raw_data?: unknown
      }
      if (labels) parsed.match.state = { actions: labels.map((action_type) => ({ action_type, action_origin: 'human' })) }
      parsed.raw_data = {
        source_frame: { frame_state: state === 'valid' ? 'valid' : 'invalid' },
        agentic: {
          lookahead: {
            horizon_s: 9.999999999990905,
            next_invalid_in_s: state === 'valid' ? null : 0,
            next_valid_in_s: state === 'valid' ? 0 : null,
          },
        },
      }
      tracker.push(JSON.stringify(parsed))
      env.frame(40)
    }
    // A human goal 16 s before a long run: the run replays it.
    for (let i = 0; i < 500; i++) at(i, 'valid', i === 100 ? ['goal'] : undefined)
    for (let i = 500; i < 525; i++) at(i, 'long')
    expect(badge(host)?.textContent).toBe('Replay of a goal from 0:16 ago')
    expect(badge(host)?.dataset.cause).toBe('flashback')
    at(525, 'valid')
    expect(badge(host)?.dataset.cause).not.toBe('flashback')
    env.settle()
    expect(badge(host)).toBeNull()
  })
})
