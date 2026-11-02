/**
 * Playback or seek: whether a step of the playback clock continues play.
 *
 * Moments only start on playback, and anything else stops them and forgets
 * what was seen before (PipelineOutputSurface.vue:562-581).
 */

/** Clock steps larger than this are a seek, not playback. */
export const MAX_PLAYBACK_STEP_S = 0.5

/** Whether the clock going from `before` to `now` while `playing` is playback: forward, by half a second at most. */
export function isPlaybackStep(before: number | null, now: number, playing: boolean): boolean {
  return playing && before !== null && now > before && now - before <= MAX_PLAYBACK_STEP_S
}

/**
 * The playback flag for a step to `time`, given the step before it.
 *
 * The reference works its flag out in its currentTime watcher, so only when
 * the clock moves: at an unchanged time the flag stays what it was, whatever
 * `playing` says. A goal frame paints twice at one time, and a seek paints
 * before its record arrives; taking either as a step of 0 would stop every
 * moment. With nothing before, it is a seek.
 */
export function nextPlayback(
  prev: { time: number; playback: boolean } | null,
  time: number,
  playing: boolean,
): boolean {
  if (prev && time === prev.time) return prev.playback
  return isPlaybackStep(prev?.time ?? null, time, playing)
}
