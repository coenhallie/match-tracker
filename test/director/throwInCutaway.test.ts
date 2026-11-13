import { describe, it, expect } from 'vitest'
import type { Frame, FrameAction, RecordValidity } from '../../src/model/types'
import { FakeReplay } from './harness'

// The throw-in's two looks (Figma "Game Animation Visualizer", viewport/eventThrowIn and
// viewport/eventThrowInExclusive): the small band along the bottom touchline when play goes on on
// camera, and a card across the middle, with a pulse on the touchline where the ball went out, when
// the camera cuts away. The live stream says which as the throw-in is labelled: its lookahead says
// when the next invalid record is due.

const PITCH = { length: 105, width: 68 }

/** A record: the ball at (x, y), or lost, and the labels it carries. */
const frameAt = (ball: { x: number; y: number } | null, labels: FrameAction[] = []): Frame =>
  ({
    pitch_dimensions: PITCH,
    teams: [{ team_id: 0, players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x: 3, y: 2 } }] }],
    balls: ball ? [{ projected_coordinates: ball }] : [],
    state: { actions: labels },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

const THROW_IN: FrameAction = { action_type: 'Throw in', action_origin: 'human' }
/** As production labels a throw-in: the team's backend id, its side and its name. */
const AUSTRALIA_THROW_IN = { ...THROW_IN, team_id: 807, is_home: 'away', team_name: 'Australia' } as FrameAction

const valid = (nextInvalidInS: number | null = null): RecordValidity => ({ invalid: false, nextInvalidInS, nextValidInS: 0 })
const invalid = (nextValidInS: number | null = null): RecordValidity => ({ invalid: true, nextInvalidInS: 0, nextValidInS })

const BALL = { x: -20, y: 30 }

/** Live play, valid, the ball at BALL. */
function live(): FakeReplay {
  const replay = new FakeReplay()
  replay.set({ time: 10, frame: frameAt(BALL), validity: valid() })
  replay.play()
  return replay
}

/** The next record, 40 ms on. */
const record = (replay: FakeReplay, validity: RecordValidity | undefined, labels: FrameAction[] = [], ball: { x: number; y: number } | null = BALL) =>
  replay.set({ time: replay.time + 0.04, frame: frameAt(ball, labels), ...(validity ? { validity } : {}) })

/** `n` records of 40 ms, each with an animation frame. */
function records(replay: FakeReplay, n: number, validity: RecordValidity | undefined, ball: { x: number; y: number } | null = BALL): void {
  for (let i = 0; i < n; i++) {
    record(replay, validity, [], ball)
    replay.animate(40)
  }
}

const card = (replay: FakeReplay) => replay.last()?.throwInCard
const band = (replay: FakeReplay) => replay.last()?.throwIn

describe('which throw-in', () => {
  it('is the small band when play goes on on camera: no invalid record due within 3 s', () => {
    const replay = live()
    record(replay, valid(), [THROW_IN])
    replay.animate(600)
    expect(band(replay)).toBeDefined()
    expect(card(replay)).toBeUndefined()
    const later = live()
    record(later, valid(4), [THROW_IN])
    later.animate(600)
    expect(band(later)).toBeDefined()
  })

  it('is the card when the camera cuts away: an invalid record due within 3 s', () => {
    const replay = live()
    record(replay, valid(2.5), [THROW_IN])
    replay.animate(600)
    expect(card(replay)).toBeDefined()
    expect(band(replay)).toBeUndefined()
  })

  it('is the card on a throw-in labelled on an invalid record', () => {
    const replay = live()
    record(replay, invalid(), [THROW_IN])
    replay.animate(600)
    expect(card(replay)).toBeDefined()
  })

  it('is the small band where the records say nothing of their validity, as replay data does not', () => {
    const replay = new FakeReplay()
    replay.set({ time: 10, frame: frameAt(BALL) })
    replay.play()
    record(replay, undefined, [THROW_IN])
    replay.animate(600)
    expect(band(replay)).toBeDefined()
    expect(card(replay)).toBeUndefined()
  })
})

describe('the throw-in card', () => {
  it('fades in, and everyone on the pitch and the ball fade out with it', () => {
    const replay = live()
    record(replay, valid(1), [THROW_IN])
    replay.animate(100)
    const early = card(replay)!
    expect(early.intensity).toBeGreaterThan(0)
    expect(early.intensity).toBeLessThan(1)
    replay.animate(600)
    expect(card(replay)).toMatchObject({ intensity: 1, playersFade: 1, ballFade: 1 })
  })

  it('stays while the camera is away, and fades out once it is back', () => {
    const replay = live()
    record(replay, valid(1), [THROW_IN])
    replay.animate(40)
    records(replay, 25, valid(1))
    // 20 s away: well past the 2 s it shows at least.
    records(replay, 500, invalid())
    expect(card(replay)?.intensity).toBe(1)
    records(replay, 3, valid())
    const leaving = card(replay)!.intensity
    expect(leaving).toBeLessThan(1)
    records(replay, 15, valid())
    expect(card(replay)).toBeUndefined()
  })

  it('waits for the cutaway it was played for, up to 3 s, though it shows at least 2 s', () => {
    const replay = live()
    record(replay, valid(2.8), [THROW_IN])
    replay.animate(40)
    // Valid for 2.8 s, past the 2 s it shows at least: it waits for the cutaway, and stays through it.
    records(replay, 70, valid(2.8))
    expect(card(replay)?.intensity).toBe(1)
    records(replay, 50, invalid())
    expect(card(replay)?.intensity).toBe(1)
  })

  it('goes after 2 s when the cutaway it was played for does not come by 3 s', () => {
    const replay = live()
    record(replay, valid(1), [THROW_IN])
    replay.animate(40)
    records(replay, 100, valid())
    expect(card(replay)).toBeUndefined()
  })

  it('marks where the ball went out on the touchline nearest it: along the pitch where the ball was', () => {
    const replay = live()
    record(replay, valid(1), [THROW_IN], { x: -20, y: 30 })
    replay.animate(300)
    expect(card(replay)?.spot).toEqual({ x: -20, y: PITCH.width / 2 })
    const top = live()
    record(top, valid(1), [THROW_IN], { x: 12, y: -25 })
    top.animate(300)
    expect(top.last()?.throwInCard?.spot).toEqual({ x: 12, y: -PITCH.width / 2 })
  })

  it('marks where the ball was last tracked, within 5 s, when it is lost on the throw-in', () => {
    const replay = live()
    records(replay, 10, valid(), { x: 30, y: -31 })
    record(replay, invalid(), [THROW_IN], null)
    replay.animate(300)
    expect(card(replay)?.spot).toEqual({ x: 30, y: -PITCH.width / 2 })
  })

  it('marks nothing with no ball to go by: the card alone', () => {
    const replay = new FakeReplay()
    replay.set({ time: 10, frame: frameAt(null), validity: valid() })
    replay.play()
    record(replay, invalid(), [THROW_IN], null)
    replay.animate(300)
    expect(card(replay)).toBeDefined()
    expect(card(replay)!.spot).toBeNull()
  })

  it("names the team its label gives under it, as production labels a throw-in", () => {
    const replay = live()
    record(replay, invalid(), [AUSTRALIA_THROW_IN])
    replay.animate(300)
    // The harness's names: the away side is Blue.
    expect(card(replay)?.team).toBe('Blue')
    const unnamed = live()
    record(unnamed, invalid(), [THROW_IN])
    unnamed.animate(300)
    expect(unnamed.last()?.throwInCard?.team).toBeNull()
  })

  it('lights its pulse up from the middle out, as the free kick does', () => {
    const replay = live()
    record(replay, invalid(), [THROW_IN])
    replay.animate(300)
    expect(card(replay)?.rings).toHaveLength(3)
  })

  it('plays once for a throw-in labelled on several records', () => {
    const replay = live()
    record(replay, invalid(), [THROW_IN])
    replay.animate(40)
    records(replay, 60, invalid())
    records(replay, 30, valid())
    expect(card(replay)).toBeUndefined()
    record(replay, valid(), [THROW_IN])
    replay.animate(600)
    expect(card(replay)).toBeUndefined()
    expect(band(replay)).toBeUndefined()
  })
})
