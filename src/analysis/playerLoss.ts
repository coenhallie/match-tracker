import type { Frame } from '../model/types.js'

/**
 * Player loss: frames in which the pipeline has lost track of players. The
 * tracking gives every player a position in all but a few frames, extrapolating
 * those off camera: on the February export 98.5% of frames have all 22, and
 * fewer than PLAYER_LOSS_BELOW only in two stretches, of 0.4 s and 15.4 s, as
 * the tracking warms up. Those frames show a pitch with most of the players
 * gone, which the widget covers with an attack (playerLoss.ts in director).
 */

/** Fewer players than this tracked in a frame is a player loss. */
export const PLAYER_LOSS_BELOW = 18

/** A team's players in the frame, keepers included, that have a usable position. Officials do not count. */
export function trackedPlayers(frame: Frame): number {
  let count = 0
  for (const team of frame.teams ?? []) {
    if (team.team_id !== 0 && team.team_id !== 1) continue
    for (const player of team.players ?? []) {
      const { x, y } = player.projected_coordinates ?? {}
      if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) count++
    }
  }
  return count
}

/** Whether the frame is a player loss: fewer than PLAYER_LOSS_BELOW players tracked. */
export function isPlayerLoss(frame: Frame): boolean {
  return trackedPlayers(frame) < PLAYER_LOSS_BELOW
}
