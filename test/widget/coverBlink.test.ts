/**
 * An invalid run on the default socket, where some copies of a message come without
 * `raw_data`: the widget must not take such a record for a valid one. Taking it so showed
 * its made-up positions and ended the attack over invalid frames, which the next invalid
 * record started again: the cover blinked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, type MatchTracker } from '../../src/index'
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

function mount() {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null })
  mounted.push(tracker)
  env.resize(host, 1280, 760)
  return tracker
}

/**
 * Message `i`, its ball at `x`, with `raw_data` saying it is valid or invalid with these
 * countdowns, or with no `raw_data` at all (`'unsaid'`).
 */
function msg(i: number, state: 'valid' | 'invalid' | 'unsaid', x: number, nextValidInS: number | null = 20): string {
  const parsed = JSON.parse(message(i, { withBall: true })) as {
    match: { balls: Array<{ projected_coordinates: { x: number } }> }
    raw_data?: unknown
  }
  parsed.match.balls[0]!.projected_coordinates.x = x
  if (state !== 'unsaid') {
    parsed.raw_data = {
      source_frame: { frame_state: state },
      agentic: {
        lookahead: {
          next_invalid_in_s: state === 'invalid' ? 0 : null,
          next_valid_in_s: state === 'invalid' ? nextValidInS : 0,
          horizon_s: 10,
        },
      },
    }
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

describe('an invalid run with copies that carry no validity', () => {
  it('keeps the attack over invalid frames up, without blinking, and never shows made-up positions', () => {
    const tracker = mount()
    const moments: string[] = []
    tracker.on('moment', (m) => moments.push(`${m.moment}:${m.phase}`))
    // Valid play to give the phase its ends, then an 8 s invalid run, one record in seven unsaid.
    let i = 0
    for (; i < 50; i++) {
      tracker.push(msg(i, 'valid', BALL.x))
      env.frame(40)
    }
    const shownDuring: Array<number | undefined> = []
    for (let k = 0; k < 200; k++, i++) {
      tracker.push(msg(i, k % 7 === 3 ? 'unsaid' : 'invalid', -40, 20 - k * 0.04))
      env.frame(40)
      shownDuring.push(ballX())
    }
    // The pitch stays on the last valid positions throughout: no made-up ball at x -40.
    expect(shownDuring.filter((x) => x !== BALL.x)).toEqual([])
    // At most one attack comes on for the run, and it does not go until the run ends.
    expect(moments.filter((m) => m === 'attack:start').length).toBeLessThanOrEqual(1)
    expect(moments.filter((m) => m === 'attack:end')).toEqual([])
    // And it goes once the run is over: valid records, some of them unsaid, show live play again.
    for (let k = 0; k < 50; k++, i++) {
      tracker.push(msg(i, k % 7 === 3 ? 'unsaid' : 'valid', 10))
      env.frame(40)
    }
    env.settle()
    expect(moments.filter((m) => m === 'attack:end')).toHaveLength(1)
    expect(ballX()).toBe(10)
  })
})
