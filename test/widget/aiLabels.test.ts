/**
 * The bottom-left action text and the `aiLabels` option: only the labels a
 * human gave by default, the AI's too when the option is on, and it follows
 * setOptions on the frame already on screen.
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

/** The fixture's message `i` with these labels on its frame. */
function labelled(actions: Array<{ action_type: string; action_origin?: string }>, i = 0): string {
  const parsed = JSON.parse(message(i)) as { match: { state?: unknown } }
  parsed.match.state = { actions }
  return JSON.stringify(parsed)
}

const LABELS = [
  { action_type: 'EventType.BALL_IN_PLAY', action_origin: 'ai' },
  { action_type: 'EventType.THROW_IN', action_origin: 'human' },
]

/** The bottom-left text on the latest paint, or undefined when there is none. */
function bottomLeft(host: HTMLElement): string | undefined {
  const ops = env.ops(host)
  const lastClear = ops.map((o) => o.op).lastIndexOf('clearRect')
  return ops
    .slice(lastClear)
    .filter((o) => o.op === 'fillText' && o.args[1] === 20 && o.font === '600 14px sans-serif')
    .at(-1)?.args[0] as string | undefined
}

beforeEach(() => {
  env = installEnv()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('the bottom-left labels', () => {
  it('lists only the human labels by default', () => {
    const { host, tracker } = mount({ formatAction: (a) => a.slice(a.indexOf('.') + 1) })
    tracker.push(labelled(LABELS))
    env.settle()
    expect(bottomLeft(host)).toBe('THROW_IN')
  })

  it("lists the AI's labels too with aiLabels, and follows setOptions", () => {
    const { host, tracker } = mount({ aiLabels: true, formatAction: (a) => a.slice(a.indexOf('.') + 1) })
    tracker.push(labelled(LABELS))
    env.settle()
    expect(bottomLeft(host)).toBe('BALL_IN_PLAY, THROW_IN')
    tracker.setOptions({ aiLabels: false })
    env.settle()
    expect(bottomLeft(host)).toBe('THROW_IN')
    tracker.setOptions({ aiLabels: true })
    env.settle()
    expect(bottomLeft(host)).toBe('BALL_IN_PLAY, THROW_IN')
  })

  it('lists a human label whose record the next one hid before the display frame', () => {
    const { host, tracker } = mount({ formatAction: (a) => a.slice(a.indexOf('.') + 1) })
    tracker.push(message(0))
    env.settle()
    tracker.push(labelled(LABELS, 1))
    tracker.push(message(2))
    env.frame()
    expect(bottomLeft(host)).toBe('THROW_IN')
  })

  it('lists a label once when the hidden record and the one shown both carry it', () => {
    const { host, tracker } = mount({ formatAction: (a) => a.slice(a.indexOf('.') + 1) })
    tracker.push(message(0))
    env.settle()
    tracker.push(labelled(LABELS, 1))
    tracker.push(labelled(LABELS, 2))
    env.frame()
    expect(bottomLeft(host)).toBe('THROW_IN')
  })

  it('does not list a label from a record hidden while the tab was away', () => {
    const { host, tracker } = mount({ formatAction: (a) => a.slice(a.indexOf('.') + 1) })
    tracker.push(message(0))
    env.settle()
    env.setVisibility('hidden')
    tracker.push(labelled(LABELS, 1))
    tracker.push(message(2))
    env.setVisibility('visible')
    env.frame()
    expect(bottomLeft(host)).toBeUndefined()
  })

  it('shows no text when no human gave a label', () => {
    const { host, tracker } = mount()
    tracker.push(labelled([{ action_type: 'EventType.BALL_IN_PLAY', action_origin: 'ai' }, { action_type: 'EventType.PASS' }]))
    env.settle()
    expect(bottomLeft(host)).toBeUndefined()
  })
})
