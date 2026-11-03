import type { Frame } from '../model/types.js'

/**
 * Whether play is stopped, as a set piece is prepared: the corner's, taken
 * from what the reference's free kick (6f14d1f :802-905) held itself by. A
 * set piece is usually prepared off camera: the broadcast cuts away, and the
 * data stops moving, either holding everyone where they were or stopping
 * altogether.
 */

/**
 * Play counts as stopped once nobody has moved for this long, in seconds of
 * replay time, or while the ball is not tracked. In play the tracking moves
 * someone in every record, 25 a second; off camera it repeats the last
 * positions exactly, or has no records, and it loses the ball first, as the
 * broadcast goes to a close-up.
 */
export const PLAY_STALL_S = 0.3

/**
 * A label counts as still on until it has been off for this long, in seconds
 * of replay time: it drops out for a record or two at a time, and the
 * broadcast often cuts away just as it goes, before play can be seen to stop.
 */
export const LABEL_HOLD_S = 0.5

const POSITION_EPSILON_METRES = 1e-6

/** Everyone's position in the frame, and the ball's, by who they are. */
function positions(frame: Frame): Map<string, { x: number; y: number }> {
  const at = new Map<string, { x: number; y: number }>()
  for (const team of frame.teams ?? []) {
    ;(team.players ?? []).forEach((player, i) => {
      const c = player.projected_coordinates
      if (typeof c?.x !== 'number' || typeof c?.y !== 'number') return
      at.set(`${team.team_id}:${player.track_id ?? `#${i}`}`, { x: c.x, y: c.y })
    })
  }
  ;(frame.balls ?? []).forEach((ball, i) => {
    const c = ball.projected_coordinates
    if (typeof c?.x === 'number' && typeof c?.y === 'number') at.set(`ball:${i}`, { x: c.x, y: c.y })
  })
  return at
}

/**
 * Whether anyone, or the ball, is somewhere else in `next` than in `prev`:
 * moved, appeared or gone. Two frames with nobody in either have not moved.
 */
export function playMoved(prev: Frame, next: Frame): boolean {
  const a = positions(prev)
  const b = positions(next)
  if (a.size !== b.size) return true
  for (const [key, p] of b) {
    const q = a.get(key)
    if (!q) return true
    if (Math.abs(p.x - q.x) > POSITION_EPSILON_METRES || Math.abs(p.y - q.y) > POSITION_EPSILON_METRES) {
      return true
    }
  }
  return false
}
