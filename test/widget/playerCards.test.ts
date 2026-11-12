/**
 * The player cards through the widget: a pushed card label plays its card, the host hears it, the
 * player is named from the `teams` option, and the layers menu switches it off. The director's
 * cases are in test/director/playerCards.test.ts, the drawing's in test/render/labelCard.test.ts.
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

/** Message `i`, carrying a card a human gave, as the live stream sends it. */
function carded(i: number, kind: 'yellow' | 'red', uuid: string, team = 0, number = 3): string {
  const parsed = JSON.parse(message(i, { withBall: true })) as { match: Record<string, unknown> }
  parsed.match.state = {
    actions: [{ action_type: `Player ${kind} card`, action_origin: 'human', uuid, team_id: team, player_number: number }],
  }
  return JSON.stringify(parsed)
}

/**
 * `carded`, with the player's name where the live stream has sent it since 2026-11-12: only in the
 * label's own copy, `raw_data.labels.human_label.items`, and not in `state.actions`.
 */
function named(i: number, kind: 'yellow' | 'red', uuid: string, name: string | null, team = 0, number = 3): string {
  const parsed = JSON.parse(carded(i, kind, uuid, team, number)) as Record<string, unknown>
  parsed.raw_data = {
    labels: {
      human_label: {
        uuid,
        frame_match: 'current',
        action_name: `Player ${kind} card`,
        obj: 'player',
        items: { team_id: team, player_name: name, team_name: 'Team Home', player: 23, number },
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

describe('a player card through the widget', () => {
  it('plays a pushed card label and tells the host', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(carded(5, 'red', 'u1'))
    env.frame()
    env.frame()
    expect(log).toEqual(['redCard:start'])
    env.settle()
    expect(log).toEqual(['redCard:start', 'redCard:end'])
  })

  it('plays a card whose record the next one hid before the display frame', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(carded(5, 'yellow', 'u1'))
    tracker.push(message(6, { withBall: true }))
    env.frame()
    expect(log).toEqual(['yellowCard:start'])
  })

  it('names the player from teams.home.players, and follows setOptions', () => {
    const { host, tracker } = mount({ teams: { home: { name: 'Ajax', players: { 3: 'Name' } } } })
    playing(tracker)
    written(host)
    tracker.push(carded(5, 'red', 'u1'))
    frames(200)
    expect(written(host)).toEqual(expect.arrayContaining(['RED CARD', 'Ajax', 'Name']))
    env.settle()
    tracker.setOptions({ teams: { home: { name: 'Ajax', players: { 3: 'New' } } } })
    playing(tracker, 6, 8)
    written(host)
    tracker.push(carded(8, 'red', 'u2'))
    frames(200)
    expect(written(host)).toEqual(expect.arrayContaining(['RED CARD', 'Ajax', 'New']))
  })

  it("names the player from the label's name, when the host does not name the number", () => {
    const { host, tracker } = mount({ teams: { home: { name: 'Ajax' } } })
    playing(tracker)
    written(host)
    tracker.push(named(5, 'yellow', 'u1', 'Lando Fring'))
    frames(200)
    expect(written(host)).toEqual(expect.arrayContaining(['YELLOW CARD', 'Ajax', 'Lando Fring']))
  })

  it("names the player as the host does over the label's name", () => {
    const { host, tracker } = mount({ teams: { home: { players: { 3: 'Name' } } } })
    playing(tracker)
    written(host)
    tracker.push(named(5, 'red', 'u1', 'Lando Fring'))
    frames(200)
    const texts = written(host)
    expect(texts).toEqual(expect.arrayContaining(['RED CARD', 'Name']))
    expect(texts).not.toContain('Lando Fring')
  })

  it('writes the number for a label with no name, as the stream sends a substitution', () => {
    const { host, tracker } = mount()
    playing(tracker)
    written(host)
    tracker.push(named(5, 'red', 'u1', 'None'))
    frames(200)
    expect(written(host)).toEqual(expect.arrayContaining(['RED CARD', '#3']))
  })

  it('switches the yellow card off in the layers menu', () => {
    const { host, tracker, log } = mount()
    playing(tracker)
    const shadow = host.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mt-layers-toggle')!.click()
    const option = [...shadow.querySelectorAll<HTMLElement>('[data-layer]')].find((el) => el.dataset.layer === 'yellowCard')
    expect(option?.textContent).toContain('Yellow card')
    option!.click()
    tracker.push(carded(5, 'yellow', 'u1'))
    env.settle()
    expect(log).toEqual([])
  })
})
