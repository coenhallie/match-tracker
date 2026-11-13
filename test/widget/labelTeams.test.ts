/**
 * The team a label names, through the widget, as production sends labels (2026-11-13): a label's
 * `team_id` is the team's id in production's backend (807 Australia, 772 Qatar in Qatar vs Australia),
 * which says no side, and only the label's own copy, `raw_data.labels.human_label.items`, says the side
 * (`is_home`) and the team's name (`team_name`). Every label that names a team names it.
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
  return { host, tracker }
}

/** The teams as production labels them: Qatar at home, Australia away. */
const QATAR = { team_id: 772, is_home: 'home', team_name: 'Qatar' }
const AUSTRALIA = { team_id: 807, is_home: 0, team_name: 'Australia' }

/**
 * Message `i` carrying one human label as production sends it: `entry` on `state.actions`, with the
 * team's backend id, and the label's copy in `raw_data` with the side and the name. A game label's
 * `is_home` is a word, a player's a number.
 */
function labelled(i: number, actionType: string, obj: 'game' | 'player' | 'subst', team: typeof QATAR | typeof AUSTRALIA, entry: Record<string, unknown> = {}, items: Record<string, unknown> = {}): string {
  const parsed = JSON.parse(message(i, { withBall: true })) as Record<string, unknown> & { match: Record<string, unknown> }
  const uuid = `label-${i}`
  parsed.match.state = { actions: [{ action_type: actionType, action_origin: 'human', action_id: 1, uuid, team_id: team.team_id, ...entry }] }
  parsed.raw_data = {
    labels: {
      human_label: { uuid, frame_match: 'current', action_name: actionType, obj, items: { ...team, player_name: null, ...items } },
    },
  }
  return JSON.stringify(parsed)
}

/** Live play up to the label, the label, and animation frames for a card to fade in. */
function play(tracker: MatchTracker, label: string): void {
  for (let i = 0; i < 5; i++) {
    tracker.push(message(i, { withBall: true }))
    env.frame()
  }
  tracker.push(label)
  for (let t = 0; t < 800; t += 16) env.frame()
}

/** Every text the canvas wrote. */
const written = (host: HTMLElement) =>
  env
    .ops(host)
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

describe("a production label's team", () => {
  const LABELS: Array<[string, string]> = [
    ['a yellow card', labelled(5, 'Player yellow card', 'player', AUSTRALIA, { player_number: 26 }, { is_home: 0, player_name: 'Tate Yengi', number: 26 })],
    ['a red card', labelled(5, 'Player red card', 'player', AUSTRALIA, { player_number: 4 }, { is_home: 0, number: 4 })],
    ['a substitution', labelled(5, 'substitute', 'subst', AUSTRALIA, { from: 118682, to: 118694 }, { is_home: 0, player_name: 'Kasey Bos', player_name_out: 'Aziz Behich' })],
    ['a free kick', labelled(5, 'Free kick', 'game', QATAR)],
    ['a corner', labelled(5, 'Corner kick - Top left', 'game', QATAR)],
    ['a goal disallowed', labelled(5, 'Goal Disallowed', 'game', QATAR)],
  ]

  it.each(LABELS)('names the team under %s by the name on its label, with no names from the host', (_, label) => {
    const { host, tracker } = mount()
    play(tracker, label)
    const team = label.includes('Australia') ? 'Australia' : 'Qatar'
    expect(written(host)).toContain(team)
  })

  it.each(LABELS)("names the team under %s by the host's name for its side first", (_, label) => {
    const { host, tracker } = mount({ teams: { home: { name: 'Al-Annabi' }, away: { name: 'Socceroos' } } })
    play(tracker, label)
    const team = label.includes('Australia') ? 'Socceroos' : 'Al-Annabi'
    expect(written(host)).toContain(team)
    expect(written(host)).not.toContain(label.includes('Australia') ? 'Australia' : 'Qatar')
  })

  it('names no team for a label about none, though production writes is_home 0 on it', () => {
    const { host, tracker } = mount({ teams: { home: { name: 'Al-Annabi' }, away: { name: 'Socceroos' } } })
    // Production's Kick off: no team_id, no team_name, and is_home 0. A goal disallowed shaped so names no one.
    play(tracker, labelled(5, 'Goal Disallowed', 'game', { team_id: null, is_home: 0, team_name: null } as unknown as typeof QATAR))
    expect(written(host)).not.toContain('Socceroos')
    expect(written(host)).not.toContain('Al-Annabi')
  })
})
