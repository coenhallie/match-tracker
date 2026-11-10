import type { Ball, Frame, RecordValidity, TrackerRecord } from './types.js'

/** Whether `frame` has a ball with a position, as the renderer draws one. */
export function hasBall(frame: Frame): boolean {
  return (frame.balls ?? []).some((ball) => {
    const { x, y } = ball.projected_coordinates ?? {}
    return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
  })
}

/**
 * What stands for an invalid record (RecordValidity), so that nothing reads
 * the positions the pipeline made up while its camera was away: the last valid
 * record's pitch and players, with the invalid record's time, frame number,
 * labels and validity. A human label on an invalid record still counts, as
 * labels are not positions.
 *
 * The ball is `balls`, by default the last valid record's. The tracking often
 * loses the ball in the last valid records, as the broadcast cuts away, so a
 * caller can give the last one a valid record had.
 *
 * The validity is `validity`, by default the record's own. A record that said
 * nothing stands for what the stream last said (carriedValidity), which the
 * caller gives here.
 */
export function heldRecord(
  record: TrackerRecord,
  lastValid: TrackerRecord,
  balls?: Ball[],
  validity: RecordValidity | undefined = record.validity,
): TrackerRecord {
  const held: TrackerRecord = {
    t: record.t,
    frameCount: record.frameCount,
    frame: {
      ...lastValid.frame,
      ...(balls ? { balls } : {}),
      state: record.frame.state,
      frame_data: record.frame.frame_data,
    },
  }
  if (validity) held.validity = validity
  return held
}
