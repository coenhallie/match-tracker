/**
 * The pitch turned round for the second half, in the widget: from a human half
 * label on, live and in replay, what the director, the phase and the trail are
 * given and what is drawn are the frames turned half round the centre spot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, parseRecord, type MatchTracker, type MatchTrackerOptions, type TrackerRecord } from '../../src/index'
import { turnFrame } from '../../src/analysis/secondHalf'
import { installEnv, makeHost, type Env } from './env'
import { control } from './recording'
import { BALL, message } from './messages'

vi.mock('../../src/director/director', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/director/director')>()
  const { recordingDirector } = await import('./recording')
  return { ...real, Director: recordingDirector(real.Director) }
})

let env: Env
const mounted: MatchTracker[] = []

/** The cards off, so that what is drawn under them is compared, not the card. */
const NO_CARDS = { layers: { halfTime: false, secondHalf: false } }

function mount(options: Partial<MatchTrackerOptions>) {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...NO_CARDS, ...options })
  mounted.push(tracker)
  env.resize(host, 800, 450)
  return { host, tracker }
}

/** Message `i` with a ball, at 40 ms steps, with these labels on its frame. */
function labelled(i: number, actions: Array<{ action_type: string; action_origin?: string }> = []): string {
  const parsed = JSON.parse(message(i, { withBall: true })) as { match: { state?: unknown } }
  parsed.match.state = { actions }
  return JSON.stringify(parsed)
}

const HALF_TIME = [{ action_type: 'End FirstHalf', action_origin: 'human' }]
const SECOND_HALF = [{ action_type: 'Start second half', action_origin: 'human' }]

const ballOf = (record: TrackerRecord | null | undefined) => record?.frame.balls?.[0]?.projected_coordinates
const lastInput = () => control.inputs.at(-1)!

/** The ops of the latest paint on `host`'s canvas. */
function lastPaint(host: HTMLElement) {
  const ops = env.ops(host)
  return ops.slice(ops.map((o) => o.op).lastIndexOf('clearRect'))
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

describe('live', () => {
  it('shows the first half as the pipeline sends it', () => {
    const { tracker } = mount({})
    for (let i = 0; i < 3; i++) tracker.push(labelled(i))
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject(BALL)
  })

  it.each([
    ['half time', HALF_TIME],
    ['second half', SECOND_HALF],
  ])('turns the pitch round from the human %s label on', (_, label) => {
    const { tracker } = mount({})
    tracker.push(labelled(0))
    env.settle()
    tracker.push(labelled(1, label))
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject({ x: -BALL.x, y: -BALL.y })
    tracker.push(labelled(2))
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject({ x: -BALL.x, y: -BALL.y })
  })

  it("leaves it as it is on the AI's half labels", () => {
    const { tracker } = mount({})
    tracker.push(labelled(0, [{ action_type: 'End FirstHalf', action_origin: 'ai' }]))
    tracker.push(labelled(1))
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject(BALL)
  })

  it('turns once for both labels', () => {
    const { tracker } = mount({})
    tracker.push(labelled(0, HALF_TIME))
    tracker.push(labelled(1, SECOND_HALF))
    tracker.push(labelled(2, HALF_TIME))
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject({ x: -BALL.x, y: -BALL.y })
  })

  it('works out the phase from the turned frames, its window and all', () => {
    const { tracker } = mount({})
    for (let i = 0; i < 5; i++) tracker.push(labelled(i))
    env.settle()
    const before = lastInput().phase!.attacks
    tracker.push(labelled(5, HALF_TIME))
    env.settle()
    const after = lastInput().phase!.attacks
    expect(before[0]).not.toBeNull()
    expect(after).toEqual({ 0: before[0] === null ? null : -before[0], 1: before[1] === null ? null : -before[1] })
  })

  it('draws a second-half frame as the same frame turned round', () => {
    const turned = (i: number) => {
      const parsed = JSON.parse(labelled(i)) as { match: Record<string, unknown> }
      const record = parseRecord(labelled(i))!
      const { teams, balls } = turnFrame(record.frame)
      parsed.match = { ...parsed.match, teams, balls }
      return JSON.stringify(parsed)
    }
    const a = mount({})
    a.tracker.push(labelled(0, HALF_TIME))
    a.tracker.push(labelled(1))
    const b = mount({})
    b.tracker.push(turned(0))
    b.tracker.push(turned(1))
    env.settle()
    const paint = lastPaint(a.host)
    expect(paint.some((o) => o.op === 'arc')).toBe(true)
    expect(paint).toEqual(lastPaint(b.host))
  })

  it('forgets the second half on reset', () => {
    const { tracker } = mount({})
    tracker.push(labelled(0, HALF_TIME))
    env.settle()
    tracker.reset()
    tracker.push(labelled(1))
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject(BALL)
  })
})

describe('replay', () => {
  const records = Array.from({ length: 20 }, (_, i) => parseRecord(labelled(i, i === 10 ? HALF_TIME : []))!)
  const stateAt = (at: number, playing = true) => ({
    time: records[at]!.t,
    playing,
    record: records[at]!,
    lookback: records.slice(0, at + 1),
  })

  function replay() {
    const host = makeHost()
    const tracker = createMatchTracker(host, { mode: 'replay', layersStorageKey: null, ...NO_CARDS })
    mounted.push(tracker)
    env.resize(host, 800, 450)
    return tracker
  }

  it('turns the pitch round from the label on, as it plays past it', () => {
    const tracker = replay()
    const xs: number[] = []
    for (let at = 8; at < 13; at++) {
      tracker.present(stateAt(at))
      env.frame()
      xs.push(ballOf(lastInput().record)!.x)
    }
    expect(xs).toEqual([BALL.x, BALL.x, -BALL.x, -BALL.x, -BALL.x])
  })

  it('turns it on a seek to a frame with the label in its lookback', () => {
    const tracker = replay()
    tracker.present(stateAt(14, false))
    env.frame()
    expect(ballOf(lastInput().record)).toMatchObject({ x: -BALL.x, y: -BALL.y })
  })

  it('keeps the first half as it is on a seek back past the label', () => {
    const tracker = replay()
    tracker.present(stateAt(14, false))
    env.frame()
    tracker.present(stateAt(9, false))
    env.frame()
    expect(ballOf(lastInput().record)).toMatchObject(BALL)
    tracker.present(stateAt(19, false))
    env.frame()
    expect(ballOf(lastInput().record)).toMatchObject({ x: -BALL.x, y: -BALL.y })
  })
})

describe("the host's start", () => {
  /** Message `i`'s record time, as the widget reads it. */
  const timeOf = (i: number) => parseRecord(labelled(i))!.t

  it('turns the frames from `secondHalfFrom` on, without a label', () => {
    const { tracker } = mount({ secondHalfFrom: timeOf(2) })
    tracker.push(labelled(1))
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject(BALL)
    tracker.push(labelled(2))
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject({ x: -BALL.x, y: -BALL.y })
  })

  it('keeps it through a reset, as for a reconnect', () => {
    const { tracker } = mount({ secondHalfFrom: timeOf(0) })
    tracker.push(labelled(0))
    env.settle()
    tracker.reset()
    tracker.push(labelled(1))
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject({ x: -BALL.x, y: -BALL.y })
  })

  it('turns the frame on screen when setOptions gives it, and back when it takes it away', () => {
    const { tracker } = mount({})
    tracker.push(labelled(0))
    env.settle()
    tracker.setOptions({ secondHalfFrom: timeOf(0) })
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject({ x: -BALL.x, y: -BALL.y })
    tracker.setOptions({ secondHalfFrom: null })
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject(BALL)
  })

  it('turns the frame on screen in a paused replay too', () => {
    const host = makeHost()
    const tracker = createMatchTracker(host, { mode: 'replay', layersStorageKey: null, ...NO_CARDS })
    mounted.push(tracker)
    env.resize(host, 800, 450)
    const record = parseRecord(labelled(0))!
    tracker.present({ time: record.t, playing: false, record, lookback: [record] })
    env.frame()
    tracker.setOptions({ secondHalfFrom: record.t })
    env.frame()
    expect(ballOf(lastInput().record)).toMatchObject({ x: -BALL.x, y: -BALL.y })
  })

  it('ignores a value that is not a finite number', () => {
    const { tracker } = mount({ secondHalfFrom: Number.NaN })
    tracker.push(labelled(0))
    env.settle()
    expect(ballOf(lastInput().record)).toMatchObject(BALL)
  })
})

describe('the secondHalf event', () => {
  it('says where a half label it sees starts the second half, once', () => {
    const { tracker } = mount({})
    const heard: number[] = []
    tracker.on('secondHalf', ({ from }) => heard.push(from))
    tracker.push(labelled(0))
    tracker.push(labelled(1, HALF_TIME))
    tracker.push(labelled(2, HALF_TIME))
    tracker.push(labelled(3, SECOND_HALF))
    env.settle()
    expect(heard).toEqual([parseRecord(labelled(1))!.t])
  })

  it('says it again for an earlier label, and not for the start the host gave', () => {
    const { tracker } = mount({ secondHalfFrom: 1 })
    const heard: number[] = []
    tracker.on('secondHalf', ({ from }) => heard.push(from))
    tracker.push(labelled(5, SECOND_HALF))
    tracker.push(labelled(3, HALF_TIME))
    env.settle()
    expect(heard).toEqual([parseRecord(labelled(5))!.t, parseRecord(labelled(3))!.t])
  })

  it('is heard in replay, from a label in the lookback', () => {
    const host = makeHost()
    const tracker = createMatchTracker(host, { mode: 'replay', layersStorageKey: null, ...NO_CARDS })
    mounted.push(tracker)
    env.resize(host, 800, 450)
    const heard: number[] = []
    tracker.on('secondHalf', ({ from }) => heard.push(from))
    const records = [parseRecord(labelled(0, HALF_TIME))!, parseRecord(labelled(1))!]
    tracker.present({ time: records[1]!.t, playing: false, record: records[1]!, lookback: records })
    env.frame()
    expect(heard).toEqual([records[0]!.t])
  })

  it('is heard again after a reset, for the same label', () => {
    const { tracker } = mount({})
    const heard: number[] = []
    tracker.on('secondHalf', ({ from }) => heard.push(from))
    tracker.push(labelled(1, HALF_TIME))
    tracker.reset()
    tracker.push(labelled(1, HALF_TIME))
    env.settle()
    expect(heard).toHaveLength(2)
  })
})

