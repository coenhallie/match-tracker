import type { Frame, TrackerRecord } from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : [])

/**
 * Coerce the collections the renderer iterates over into arrays of objects, so a
 * malformed frame renders partially instead of throwing on every frame.
 */
function normalizeFrame(raw: Record<string, unknown>): Frame {
  const teams = records(raw.teams).map((team) => ({
    ...team,
    players: records(team.players),
    actions: records(team.actions),
  }))
  const state = isRecord(raw.state) ? { ...raw.state, actions: records(raw.state.actions) } : undefined
  return { ...raw, teams, state, balls: records(raw.balls) } as unknown as Frame
}

/**
 * Read one pipeline message.
 *
 * The pipeline sends each frame as a JSON string whose content is itself a JSON string of
 * `{ uuid, timestamp, frame_id, match }`. Decode up to twice and unwrap `match`. A bare frame,
 * as stored in a JSONL file, is accepted too, as is an already decoded object.
 *
 * `frame_uuid` is dropped from the retained frame. It is a rolling window of roughly nine
 * `{ timestamp, uuid }` entries per record, it is the single largest field, and the renderer
 * never reads it. One timestamp is lifted out as `t` before it goes.
 *
 * It must be the LAST entry, not the first. The window holds the last ~9 frames, so entry 0
 * is the OLDEST, about 0.32 s stale, and the final entry is the frame this record actually
 * describes. While the window is still filling at the start of a run it is short, so the lag
 * varies exactly where replay time is measured from.
 *
 * Returns null for anything that is not a usable record. It never throws.
 */
export function parseRecord(message: unknown): TrackerRecord | null {
  let value: unknown = message
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!isRecord(value)) return null
  const candidate = isRecord(value.match) ? value.match : value
  if (!Array.isArray(candidate.teams)) return null

  const frame = normalizeFrame(candidate)

  const meta: unknown = Array.isArray(frame.frame_data) ? frame.frame_data[0] : undefined
  if (!isRecord(meta) || typeof meta.frame_count !== 'number') return null

  const uuids = meta.frame_uuid
  const last: unknown = Array.isArray(uuids) ? uuids[uuids.length - 1] : undefined
  const t = isRecord(last) ? last.timestamp : undefined
  if (typeof t !== 'number' || !Number.isFinite(t)) return null

  return {
    t,
    frameCount: meta.frame_count,
    frame: { ...frame, frame_data: [{ frame_count: meta.frame_count }] },
  }
}
