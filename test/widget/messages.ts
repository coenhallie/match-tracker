import fixture from '../fixtures/pipeline-messages.json'

/** The fixture's three websocket messages, which all carry one frame. */
export const FIXTURE_MESSAGES: readonly string[] = fixture

const first = JSON.parse(fixture[0]!) as { match: Record<string, unknown> }

/** Where `withBall` puts the ball, in metres from the centre spot: in the right-hand half, short of the box. */
export const BALL = { x: 30, y: 4 }

/**
 * The fixture's first frame, as a message of frame 55149 + `i`, 40 ms after
 * the one before, and after the fixture's own. The fixture's ball has no
 * position, so no goal can be played on it; `withBall` puts one at BALL.
 */
export function message(i: number, { withBall = false } = {}): string {
  const t = 2700 + i * 0.04
  const balls = withBall
    ? [{ is_high_ball: false, probability: 1, projected_coordinates: { ...BALL, z: 0 } }]
    : first.match.balls
  const match = {
    ...first.match,
    balls,
    frame_data: [{ frame_count: 55149 + i, frame_uuid: [{ timestamp: t, uuid: `u${i}` }] }],
  }
  return JSON.stringify({ uuid: `u${i}`, timestamp: t, frame_id: 55149 + i, match })
}
