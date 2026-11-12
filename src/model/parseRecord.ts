import type { Frame, RecordValidity, TrackerRecord } from './types.js'

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
 * Returns null for anything that is not a usable record, a `t` or `frame_count` that is not a
 * finite number among them. It never throws.
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

  const frame = withLabelName(normalizeFrame(candidate), value.raw_data)

  const meta: unknown = Array.isArray(frame.frame_data) ? frame.frame_data[0] : undefined
  // Not finite (JSON reads 1e999 as Infinity): such a record can never be told apart from the next.
  if (!isRecord(meta) || typeof meta.frame_count !== 'number' || !Number.isFinite(meta.frame_count)) return null

  const uuids = meta.frame_uuid
  const last: unknown = Array.isArray(uuids) ? uuids[uuids.length - 1] : undefined
  const t = isRecord(last) ? last.timestamp : undefined
  if (typeof t !== 'number' || !Number.isFinite(t)) return null

  const record: TrackerRecord = {
    t,
    frameCount: meta.frame_count,
    frame: { ...frame, frame_data: [{ frame_count: meta.frame_count }] },
  }
  const validity = readValidity(value.raw_data)
  if (validity) record.validity = validity
  return record
}

/**
 * A player's name, trimmed, or null for none. The labelling tool sends `null` for a player it has
 * no name for, and its backend has written Python's `None` for one.
 */
export function plainName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return trimmed === '' || trimmed === 'None' || trimmed === 'null' ? null : trimmed
}

/**
 * `frame`, with the player's name from the record's human label on the label's own entry in
 * `state.actions`, the entry with its `uuid`. Since 2026-11-12 the labelling tool's `player_name`
 * reaches the stream only in `raw_data.labels.human_label.items`, and `raw_data` is dropped once
 * the record is read. The name is taken only from a label about one player (`obj: 'player'`, as a
 * card is): a substitution is about two, and its one `player_name` names neither. A name the entry
 * has of its own comes first. The entry is copied, never changed.
 */
function withLabelName(frame: Frame, raw: unknown): Frame {
  const label = isRecord(raw) && isRecord(raw.labels) ? raw.labels.human_label : undefined
  if (!isRecord(label) || label.obj !== 'player' || typeof label.uuid !== 'string' || !isRecord(label.items)) return frame
  const name = plainName(label.items.player_name)
  const actions = frame.state?.actions
  const at = actions?.findIndex((action) => action.uuid === label.uuid) ?? -1
  if (name === null || !actions || at < 0 || plainName(actions[at]!.player_name) !== null) return frame
  const named = actions.map((action, i) => (i === at ? { ...action, player_name: name } : action))
  return { ...frame, state: { ...frame.state, actions: named } }
}

/** A countdown in seconds: a finite number, 0 or more. */
const countdown = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

/**
 * The record's validity from the envelope's `raw_data`, or null when it has no
 * `source_frame.frame_state`. Nothing else of `raw_data` is kept: it holds
 * every detection, and the live history keeps seconds of records.
 *
 * `source_frame` is the frame `match` describes; `raw_data.frame` is another
 * one, and can be `'skipped'`. `agentic.is_valid_game_state` and
 * `invalid_block_active` only say that the next 10 s are all invalid.
 */
function readValidity(raw: unknown): RecordValidity | null {
  if (!isRecord(raw) || !isRecord(raw.source_frame)) return null
  const state = raw.source_frame.frame_state
  if (typeof state !== 'string') return null
  const lookahead = isRecord(raw.agentic) && isRecord(raw.agentic.lookahead) ? raw.agentic.lookahead : {}
  const validity: RecordValidity = {
    invalid: state === 'invalid',
    nextInvalidInS: countdown(lookahead.next_invalid_in_s),
    nextValidInS: countdown(lookahead.next_valid_in_s),
  }
  const horizon = lookahead.horizon_s
  if (typeof horizon === 'number' && Number.isFinite(horizon) && horizon > 0) validity.horizonS = horizon
  return validity
}
