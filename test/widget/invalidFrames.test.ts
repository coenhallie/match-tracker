/**
 * Invalid records in live mode: the director sees the last valid record's
 * positions in their place, with the phase and trail of the last valid
 * record, and covers them with the attack over a player loss. Replay never.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, type MatchTracker, type MatchTrackerOptions } from '../../src/index'
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

function mount(options: Partial<MatchTrackerOptions> = {}) {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...options })
  mounted.push(tracker)
  env.resize(host, 1280, 760)
  return { host, tracker }
}

/** Message `i`, with `raw_data` saying whether its frame is valid, the ball at `x` when it is not, and these labels. */
function withState(
  i: number,
  state: 'valid' | 'invalid',
  x = -40,
  actions?: Array<{ action_type: string; action_origin: string }>,
): string {
  const parsed = JSON.parse(message(i, { withBall: true })) as {
    match: { balls: Array<{ projected_coordinates: { x: number } }>; state?: unknown }
    raw_data?: unknown
  }
  if (state === 'invalid') parsed.match.balls[0]!.projected_coordinates.x = x
  if (actions) parsed.match.state = { actions }
  parsed.raw_data = {
    source_frame: { frame_state: state },
    agentic: { lookahead: { next_invalid_in_s: state === 'invalid' ? 0 : null, next_valid_in_s: state === 'invalid' ? 3 : 0 } },
  }
  return JSON.stringify(parsed)
}

const ballX = () => control.inputs.at(-1)?.record?.frame.balls?.[0]?.projected_coordinates?.x

beforeEach(() => {
  env = installEnv()
  control.reset()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('invalid records in live mode', () => {
  it('has the director cover invalid frames in live mode only', () => {
    mount()
    mount({ mode: 'replay' })
    expect(control.options.map((o) => o.coverInvalidFrames)).toEqual([true, false])
  })

  it('shows the last valid positions in place of an invalid record, at its own frame', () => {
    const { tracker } = mount()
    tracker.push(withState(0, 'valid'))
    env.settle()
    expect(ballX()).toBe(BALL.x)
    const phase = control.inputs.at(-1)?.phase
    tracker.push(withState(1, 'invalid'))
    env.settle()
    const input = control.inputs.at(-1)!
    expect(input.record?.frameCount).toBe(55150)
    expect(input.record?.validity?.invalid).toBe(true)
    expect(ballX()).toBe(BALL.x)
    // Worked out at the last valid record, not the made-up one.
    expect(input.phase).toEqual(phase)
    tracker.push(withState(2, 'valid'))
    env.settle()
    expect(ballX()).toBe(BALL.x)
    expect(control.inputs.at(-1)?.record?.frameCount).toBe(55151)
  })

  it('shows an invalid record as it is when nothing valid came before it', () => {
    const { tracker } = mount()
    tracker.push(withState(0, 'invalid', -40))
    env.settle()
    expect(ballX()).toBe(-40)
  })
})

describe('invalid records in the second half', () => {
  const HALF_TIME = [{ action_type: 'End FirstHalf', action_origin: 'human' }]

  it('holds an invalid record on the last valid positions, turned round', () => {
    const { tracker } = mount({ layers: { halfTime: false } })
    tracker.push(withState(0, 'valid', undefined, HALF_TIME))
    tracker.push(withState(1, 'invalid'))
    env.settle()
    expect(control.inputs.at(-1)!.record?.validity?.invalid).toBe(true)
    expect(ballX()).toBe(-BALL.x)
  })

  it('turns the held frame and the phase together when the half label lands on an invalid record', () => {
    const { tracker } = mount({ layers: { halfTime: false } })
    for (let i = 0; i < 5; i++) tracker.push(withState(i, 'valid'))
    env.settle()
    const before = control.inputs.at(-1)!.phase!.attacks
    expect(before[0]).not.toBeNull()
    tracker.push(withState(5, 'invalid', -40, HALF_TIME))
    env.settle()
    const input = control.inputs.at(-1)!
    expect(ballX()).toBe(-BALL.x)
    expect(input.phase!.attacks).toEqual({ 0: before[0] === null ? null : -before[0], 1: before[1] === null ? null : -before[1] })
  })
})

