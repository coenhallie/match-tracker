/**
 * The penalty through the widget, live: pushed messages carrying a human's labels play it, and a
 * hidden tab leaves the scene waiting for its kick up, unless a label came while the tab was away.
 * The director's own cases are in test/director/penalty.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, type MatchTracker } from '../../src/index'
import { installEnv, makeHost, type Env } from './env'
import { message } from './messages'
import { control } from './recording'

vi.mock('../../src/director/director', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/director/director')>()
  const { recordingDirector } = await import('./recording')
  return { ...real, Director: recordingDirector(real.Director) }
})
vi.mock('../../src/render/renderer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/render/renderer')>()
  const { recordingRenderer } = await import('./recording')
  return { ...real, createRenderer: recordingRenderer(real.createRenderer) }
})

let env: Env
const mounted: MatchTracker[] = []

function mount() {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null })
  mounted.push(tracker)
  env.resize(host, 800, 450)
  const log: string[] = []
  tracker.on('moment', ({ moment, phase }) => log.push(`${moment}:${phase}`))
  return { host, tracker, log }
}

/** Message `i`, with `labels` on its frame as a human gave them. */
function labelled(i: number, ...labels: string[]): string {
  const parsed = JSON.parse(message(i, { withBall: true })) as { match: Record<string, unknown> }
  parsed.match.state = { actions: labels.map((action_type) => ({ action_type, action_origin: 'human' })) }
  return JSON.stringify(parsed)
}

/** What the last paint drew of the penalty. */
const penalty = () => control.outputs.at(-1)!.layers?.penalty

beforeEach(() => {
  env = installEnv()
  control.reset()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('the penalty through the widget', () => {
  /** Live play, then a penalty, on until its scene is in and waiting. */
  function waiting(tracker: MatchTracker) {
    for (let i = 0; i < 5; i++) {
      tracker.push(message(i, { withBall: true }))
      env.frame()
    }
    tracker.push(labelled(5, 'Penalty'))
    // Its time starts on its first frame: the card, 2.4 s, then the scene coming in over 0.5 s.
    for (let i = 0; i < 5; i++) env.frame(1000)
    expect(penalty()).toMatchObject({ scene: 1, result: null })
  }

  // The user's report (2026-11-14): on match-share, switching to another tab and back put the live
  // pitch back while the penalty was still waiting for its kick.
  it('keeps the scene waiting through a hidden tab', () => {
    const { tracker, log } = mount()
    waiting(tracker)
    env.setVisibility('hidden')
    tracker.push(message(6, { withBall: true }))
    tracker.push(message(7, { withBall: true }))
    env.setVisibility('visible')
    env.frame()
    env.frame()
    expect(penalty()).toMatchObject({ scene: 1, result: null })
    expect(log).toEqual(['penalty:start'])
    // Its result, once back, plays its kick.
    tracker.push(labelled(8, 'Penalty scored'))
    // The record's frame, the kick's first frame, then the kick's 0.7 s.
    env.frame()
    env.frame()
    env.frame(1000)
    expect(penalty()).toMatchObject({ result: 'scored', kick: 1 })
  })

  it('ends on coming back when its result came while the tab was hidden, playing no late kick', () => {
    const { tracker, log } = mount()
    waiting(tracker)
    env.setVisibility('hidden')
    tracker.push(labelled(6, 'Penalty missed'))
    tracker.push(message(7, { withBall: true }))
    env.setVisibility('visible')
    env.frame()
    env.frame()
    expect(penalty()).toBeUndefined()
    expect(log).toEqual(['penalty:start', 'penalty:end'])
  })

  it('ends on coming back when another label came while the tab was hidden', () => {
    const { tracker } = mount()
    waiting(tracker)
    env.setVisibility('hidden')
    tracker.push(labelled(6, 'Throw in'))
    tracker.push(message(7, { withBall: true }))
    env.setVisibility('visible')
    env.frame()
    env.frame()
    expect(penalty()).toBeUndefined()
  })
})
