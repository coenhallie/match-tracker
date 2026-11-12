/**
 * The substitution card through the widget: pushed substitutions play one card, the host hears it
 * once, the players are named from the `teams` option, and the layers menu switches it off. The
 * director's cases are in test/director/substitutions.test.ts, the drawing's in
 * test/render/labelCard.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMatchTracker, type MatchTracker, type MatchTrackerOptions } from '../../src/index'
import { installEnv, makeHost, type Env } from './env'
import { message } from './messages'

let env: Env
const mounted: MatchTracker[] = []

function mount(options: Partial<MatchTrackerOptions> = {}) {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...options })
  mounted.push(tracker)
  env.resize(host, 800, 450)
  const log: string[] = []
  tracker.on('moment', ({ moment, phase }) => log.push(`${moment}:${phase}`))
  return { host, tracker, log }
}

/** Message `i`, carrying a substitution a human gave, as the live stream sends it. */
function subbed(i: number, uuid: string, from: number, to: number, team = 0): string {
  const parsed = JSON.parse(message(i, { withBall: true })) as { match: Record<string, unknown> }
  parsed.match.state = { actions: [{ action_type: 'substitute', action_origin: 'human', uuid, team_id: team, from, to }] }
  return JSON.stringify(parsed)
}

/**
 * `subbed`, with the two players' names where the live stream has sent them since 2026-11-12: only in
 * the label's own copy, `raw_data.labels.human_label.items`, `player_name` for the player coming on and
 * `player_name_out` for the one going off.
 */
function named(i: number, uuid: string, from: number, to: number, out: string | null, on: string | null, team = 0): string {
  const parsed = JSON.parse(subbed(i, uuid, from, to, team)) as Record<string, unknown>
  parsed.raw_data = {
    labels: {
      human_label: {
        uuid,
        frame_match: 'current',
        action_name: 'substitute',
        obj: 'subst',
        items: { team_id: team, player_name: on, player_name_out: out, team_name: 'Team Home', from, to },
      },
    },
  }
  return JSON.stringify(parsed)
}

/** Live play, up to a frame before the card. */
function playing(tracker: MatchTracker, from = 0, to = 5) {
  for (let i = from; i < to; i++) {
    tracker.push(message(i, { withBall: true }))
    env.frame()
  }
}

/** Animation frames for `ms`: long enough for a card to fade in some way. */
function frames(ms: number) {
  for (let t = 0; t < ms; t += 16) env.frame()
}

/** Every text the canvas wrote since the last call. */
const written = (host: HTMLElement) =>
  env
    .drain(host)
    .filter((o) => o.op === 'fillText')
    .map((o) => String(o.args[0]))

beforeEach(() => {
  env = installEnv()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('the substitution card through the widget', () => {
  it('plays pushed substitutions as one card and tells the host once', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(subbed(5, 'a', 1, 16))
    frames(200)
    playing(tracker, 6, 50)
    tracker.push(subbed(50, 'b', 2, 17))
    env.settle()
    expect(log).toEqual(['substitution:start', 'substitution:end'])
  })

  it('names the players from teams.home.players', () => {
    const { host, tracker } = mount({ teams: { home: { name: 'Arsenal', players: { 1: 'Off Name', 16: 'On Name' } } } })
    playing(tracker)
    written(host)
    tracker.push(subbed(5, 'a', 1, 16))
    frames(600)
    expect(written(host)).toEqual(expect.arrayContaining(['SUBSTITUTION', 'Arsenal', 'Off Name', 'On Name']))
  })

  it("names the players from the label's names, when the host does not name them", () => {
    const { host, tracker } = mount({ teams: { home: { name: 'Arsenal', players: { 16: 'On Name' } } } })
    playing(tracker)
    written(host)
    tracker.push(named(5, 'a', 20, 16, 'Charles Windu', 'Han Tano'))
    frames(600)
    const texts = written(host)
    expect(texts).toEqual(expect.arrayContaining(['SUBSTITUTION', 'Arsenal', 'Charles Windu', 'On Name']))
    expect(texts).not.toContain('Han Tano')
  })

  it('names a roster id the label names, and writes the number for a name the label has not', () => {
    const { host, tracker } = mount()
    playing(tracker)
    written(host)
    tracker.push(named(5, 'a', 91001, 30, 'Charles Windu', null))
    frames(600)
    expect(written(host)).toEqual(expect.arrayContaining(['SUBSTITUTION', 'Charles Windu', '#30']))
  })

  it('switches it off in the layers menu', () => {
    const { host, tracker, log } = mount()
    playing(tracker)
    const shadow = host.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mt-layers-toggle')!.click()
    const option = [...shadow.querySelectorAll<HTMLElement>('[data-layer]')].find((el) => el.dataset.layer === 'substitution')
    expect(option?.textContent).toContain('Substitution')
    option!.click()
    tracker.push(subbed(5, 'a', 1, 16))
    env.settle()
    expect(log).toEqual([])
  })
})
