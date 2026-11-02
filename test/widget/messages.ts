import fixture from '../fixtures/pipeline-messages.json'

/** The fixture's three websocket messages, which all carry one frame. */
export const FIXTURE_MESSAGES: readonly string[] = fixture

const first = JSON.parse(fixture[0]!) as { match: Record<string, unknown> }

/** The fixture's first frame, as a message of frame 55149 + `i`, 40 ms after the one before, and after the fixture's own. */
export function message(i: number): string {
  const t = 2700 + i * 0.04
  const match = {
    ...first.match,
    frame_data: [{ frame_count: 55149 + i, frame_uuid: [{ timestamp: t, uuid: `u${i}` }] }],
  }
  return JSON.stringify({ uuid: `u${i}`, timestamp: t, frame_id: 55149 + i, match })
}
