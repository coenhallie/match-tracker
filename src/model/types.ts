// ---------------------------------------------------------------------------
// Type definitions for the pipeline frames and the parsed records the tracker reads.
// ---------------------------------------------------------------------------

/** Raw projected coordinates as they appear in the JSONL data. */
export interface ProjectedCoordinates {
  x: number
  y: number
  z?: number
}

/** A single player entry inside a team. */
export interface Player {
  track_id?: number | string
  person_type?: string
  projected_coordinates?: ProjectedCoordinates
  player_number?: number | string
  in_possession?: boolean
  team_id?: number
}

/** A single team entry inside a frame. */
export interface Team {
  team_id: number
  team_name?: string
  /** Flat array of colour channel values (r,g,b repeated per colour). */
  colors?: number[]
  /** Weight per colour (length = colors.length / 3). */
  color_weights?: number[]
  /**
   * Ordered colour triplets: [fill, outline, text].
   * Each element is a 3-element array [r, g, b] in 0-1 or 0-255 range.
   */
  ordered_colors?: number[][]
  /** Primary shirt colour as [r, g, b] in 0-1 or 0-255 range. */
  color_rgb?: number[]
  /** Human-readable shirt colour name (e.g. "White", "Red"). */
  color_name?: string
  /** Detector confidence for color_rgb / color_name, 0-1. */
  color_confidence?: number
  players: Player[]
  /** Player-level actions reported for this team. */
  actions?: FrameAction[]
}

/** A ball entry inside a frame. */
export interface Ball {
  projected_coordinates?: ProjectedCoordinates
  /** The pipeline calls it a high ball: in the air, `z` metres up. */
  is_high_ball?: boolean
}

/** Pitch dimension metadata (metres). */
export interface PitchDimensions {
  length: number
  width: number
  penalty_area_length: number
  penalty_area_width: number
  goal_area_length: number
  goal_area_width: number
  goal_width: number
  goal_height?: number
  center_circle_radius: number
  penalty_mark_distance: number
}

/** Frame-level action entry (e.g. "pass", "shot"). */
export interface FrameAction {
  action_type?: string
  /** Who reported the action: the AI pipeline or a human analyst. */
  action_origin?: 'ai' | 'human' | string
}

/** Frame-level metadata carried inside `frame_data`. */
export interface FrameDataEntry {
  frame_count?: number
}

/** Top-level JSON object for a single JSONL line / frame. */
export interface Frame {
  match_id?: string | number
  pitch_dimensions?: Partial<PitchDimensions>
  frame_data?: FrameDataEntry[]
  state?: {
    actions?: FrameAction[]
  }
  teams: Team[]
  balls?: Ball[]
}

/** Resolved CSS-friendly colour set for a team. */
export interface TeamColors {
  /** CSS colour string for the player fill. */
  fill: string
  /** CSS colour string for the player outline / stroke. */
  outline: string
  /** CSS colour string for jersey number text. */
  text: string
  /** RGB tuple (0-255) of the fill colour. */
  fillRgb: [number, number, number]
}

/**
 * 2D canvas coordinate transform.
 * Maps world (pitch) coordinates to pixel positions on a FRAME_W x FRAME_H canvas.
 */
export interface Transform2D {
  /** Pixel offset X (centres the pitch horizontally). */
  ox: number
  /** Pixel offset Y (centres the pitch vertically). */
  oy: number
  /** Scale factor (world metres -> pixels). */
  sc: number
  /** Pitch length in metres. */
  pl: number
  /** Pitch width in metres. */
  pw: number
}

/**
 * Whether the pipeline could see the match for a record, from the message's
 * `raw_data`, which the live stream sends beside `match`. While the camera is
 * away the pipeline keeps sending every player and the ball, but simulated,
 * not tracked. The countdowns come from `raw_data.agentic.lookahead`, which
 * sees 10 s ahead; they are relative to the record, so any clock fits them.
 */
export interface RecordValidity {
  /** `raw_data.source_frame.frame_state` is `'invalid'`: the positions are made up. */
  invalid: boolean
  /** Seconds until the next invalid record: 0 while invalid, null when none is due within the horizon. */
  nextInvalidInS: number | null
  /** Seconds until the next valid record: 0 while valid, null when none is due within the horizon. */
  nextValidInS: number | null
  /** How far ahead the lookahead sees, in seconds (10 on the staging stream); absent when not given. */
  horizonS?: number
}

/** One parsed pipeline message, reduced to what the tracker reads. */
export interface TrackerRecord {
  /** Absolute record timestamp in seconds. Not zero-based. */
  t: number
  /** The pipeline's own frame number. Not zero-based. */
  frameCount: number
  /** The normalised frame, with `frame_data` reduced to `[{ frame_count }]`. */
  frame: Frame
  /** Absent when the message says nothing about it, as replay data and older streams do not. */
  validity?: RecordValidity
}
