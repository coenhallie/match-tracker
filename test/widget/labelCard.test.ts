/**
 * A label card through the widget: pushed messages carrying a human's label
 * play the card, the host hears it start and end, the loop stops after, and
 * the layers menu switches it off. The director's own cases are in
 * test/director/labelCard.test.ts, and the drawing's in
 * test/render/labelCard.test.ts.
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

/** Message `i`, with `label` on its frame as a human gave it. */
function labelled(i: number, label: string, origin = 'human'): string {
  const parsed = JSON.parse(message(i, { withBall: true })) as { match: Record<string, unknown> }
  parsed.match.state = { actions: [{ action_type: label, action_origin: origin }] }
  return JSON.stringify(parsed)
}

beforeEach(() => {
  env = installEnv()
  control.reset()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('a label card through the widget', () => {
  /** Live play, up to a frame before the label. */
  function playing(tracker: MatchTracker) {
    for (let i = 0; i < 5; i++) {
      tracker.push(message(i, { withBall: true }))
      env.frame()
    }
  }

  it.each(['VAR check', 'var check', 'VAR_CHECK'])('plays on a pushed %j, tells the host, and goes quiet after', (label) => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(labelled(5, label))
    env.frame()
    env.frame()
    expect(log).toEqual(['varCheck:start'])
    expect(control.outputs.at(-1)!.layers?.labelCard?.key).toBe('varCheck')
    env.settle()
    expect(log).toEqual(['varCheck:start', 'varCheck:end'])
    expect(env.queued()).toBe(0)
  })

  it('plays the goal disallowed card on its own label, in place of the VAR check, with no goal', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(labelled(5, 'VAR check'))
    env.frame()
    env.frame()
    tracker.push(labelled(6, 'goal_disallowed'))
    env.frame()
    env.frame()
    expect(log).toEqual(['varCheck:start', 'varCheck:end', 'goalDisallowed:start'])
    expect(control.outputs.at(-1)!.layers?.labelCard?.key).toBe('goalDisallowed')
    env.settle()
    expect(log.at(-1)).toBe('goalDisallowed:end')
    expect(env.queued()).toBe(0)
  })

  it('plays the second half on a pushed label, in place of a resting half time, and goes by itself', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(labelled(5, 'Half time'))
    env.settle()
    tracker.push(labelled(6, 'SECOND_HALF'))
    env.frame()
    env.frame()
    expect(log).toEqual(['halfTime:start', 'halfTime:end', 'secondHalf:start'])
    expect(control.outputs.at(-1)!.layers?.labelCard?.key).toBe('secondHalf')
    env.settle()
    expect(log.at(-1)).toBe('secondHalf:end')
    expect(env.queued()).toBe(0)
  })

  it('plays the half time and the second half on the names the labelling tool sends for them', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(labelled(5, 'End FirstHalf'))
    env.settle()
    expect(log).toEqual(['halfTime:start'])
    tracker.push(labelled(6, 'Start second half'))
    env.frame()
    env.frame()
    expect(log).toEqual(['halfTime:start', 'halfTime:end', 'secondHalf:start'])
    expect(control.outputs.at(-1)!.layers?.labelCard?.key).toBe('secondHalf')
  })

  it('rests on full time with the loop stopped, until a pushed human label sends it off', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(labelled(5, 'Full time'))
    env.settle()
    expect(log).toEqual(['fullTime:start'])
    expect(env.queued()).toBe(0)
    tracker.push(labelled(6, 'Substitution', 'ai'))
    env.settle()
    expect(log).toEqual(['fullTime:start'])
    tracker.push(labelled(7, 'Substitution'))
    env.settle()
    expect(log).toEqual(['fullTime:start', 'fullTime:end'])
  })

  it('rests on half time with the loop stopped, until a pushed label sends it off', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(labelled(5, 'Half time'))
    env.settle()
    // No fade-out by itself, and the widget is not drawing while it rests.
    expect(log).toEqual(['halfTime:start'])
    expect(env.queued()).toBe(0)
    expect(control.outputs.at(-1)!.layers?.labelCard).toEqual({ key: 'halfTime', intensity: 1 })
    for (let i = 6; i < 40; i++) {
      tracker.push(message(i, { withBall: true }))
      env.settle()
    }
    expect(log).toEqual(['halfTime:start'])
    expect(control.outputs.at(-1)!.layers?.labelCard).toEqual({ key: 'halfTime', intensity: 1 })
    tracker.push(labelled(40, 'Substitution'))
    env.settle()
    expect(log).toEqual(['halfTime:start', 'halfTime:end'])
    expect(env.queued()).toBe(0)
  })

  it('keeps half time through a hidden tab, while any other moment ends as a seek', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(labelled(5, 'Half time'))
    env.settle()
    env.setVisibility('hidden')
    tracker.push(message(6, { withBall: true }))
    env.setVisibility('visible')
    env.settle()
    expect(log).toEqual(['halfTime:start'])
    expect(control.outputs.at(-1)!.layers?.labelCard).toEqual({ key: 'halfTime', intensity: 1 })
    tracker.push(labelled(7, 'Substitution'))
    env.settle()
    expect(log).toEqual(['halfTime:start', 'halfTime:end'])

    tracker.push(labelled(60, 'VAR check', 'human'))
    env.frame()
    env.frame()
    expect(log.at(-1)).toBe('varCheck:start')
    env.setVisibility('hidden')
    tracker.push(message(61, { withBall: true }))
    env.setVisibility('visible')
    env.frame()
    expect(log.at(-1)).toBe('varCheck:end')
  })

  it.each([
    ['Shot on goal', 'shotOnGoal'],
    ['HEADER_ON_GOAL', 'headerOnGoal'],
  ] as const)('plays on a pushed %j, and tells the host', (label, moment) => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(labelled(5, label))
    env.frame()
    env.frame()
    expect(log).toEqual([`${moment}:start`])
    expect(control.outputs.at(-1)!.layers?.smallLabelCard?.key).toBe(moment)
    env.settle()
    expect(log).toEqual([`${moment}:start`, `${moment}:end`])
  })

  it('plays the foul card on its own label, and goes quiet after', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(labelled(5, 'FOUL'))
    env.frame()
    env.frame()
    expect(log).toEqual(['foul:start'])
    expect(control.outputs.at(-1)!.layers?.smallLabelCard?.key).toBe('foul')
    env.settle()
    expect(log).toEqual(['foul:start', 'foul:end'])
    expect(env.queued()).toBe(0)
  })

  it('stays off for a label the AI gave', () => {
    const { tracker, log } = mount()
    playing(tracker)
    tracker.push(labelled(5, 'VAR check', 'ai'))
    env.settle()
    expect(log).toEqual([])
  })

  it('is a layer in the menu that switches it off', () => {
    const { host, tracker, log } = mount()
    playing(tracker)
    const shadow = host.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mt-layers-toggle')!.click()
    const option = [...shadow.querySelectorAll<HTMLElement>('[data-layer]')].find((el) => el.dataset.layer === 'varCheck')
    expect(option?.textContent).toContain('VAR check')
    option!.click()
    tracker.push(labelled(5, 'VAR check'))
    env.settle()
    expect(log).toEqual([])
  })
})
