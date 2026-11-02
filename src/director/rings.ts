/**
 * The rings and the "received" covers, ported from PipelineOutputSurface.vue
 * (6f14d1f) :1067-1183.
 *
 * The white rings on the players near the ball (nearbyTrackIds) and the gold
 * possession ring on the carrier (possessionTrackIds). Who has the ball, and
 * so who is near it, changes many times a minute, and the data loses the
 * carrier for a frame or two at a time: rings snapping on and off with it were
 * jarring. So during playback each fades in and out over RING_FADE_S of replay
 * time. Anywhere else they show the frame's own rings at once, like the attack,
 * and reduced motion never fades.
 *
 * Receiving the ball: the ball sits on the circle of the player with it, over
 * their number. So during playback a player who receives it is drawn over it
 * for RECEIVE_SHOW_S, their number showing, and then fades over RECEIVE_FADE_S
 * to show the ball again. A player receives the ball when they get it having
 * not had it for RING_FADE_S: the data loses the carrier for a frame or two at
 * a time, which does not count. This is kept apart from the possession ring,
 * which does not fade with ring fades switched off. Anywhere else, and under
 * reduced motion, nobody is drawn over the ball.
 */
import type { Frame } from '../model/types.js'
import { POSSESSION_FADE_IN_S, RECEIVE_FADE_S, RECEIVE_SHOW_S, RING_FADE_S } from '../render/constants.js'
import { nearbyTrackIds, possessionTrackIds, type TrackId } from '../render/renderer.js'

/**
 * Fade `rings` toward `target` by `dt` seconds, or set them to it at once.
 * They fade in over `fadeIn` seconds and out over RING_FADE_S.
 */
export function fadeRings(
  rings: Map<TrackId, number>,
  target: Set<TrackId>,
  dt: number | null,
  fadeIn = RING_FADE_S,
): void {
  if (dt === null) {
    rings.clear()
    for (const id of target) rings.set(id, 1)
    return
  }
  for (const id of target) if (!rings.has(id)) rings.set(id, 0)
  for (const [id, strength] of rings) {
    const next = target.has(id) ? Math.min(1, strength + dt / fadeIn) : Math.max(0, strength - dt / RING_FADE_S)
    if (next > 0) rings.set(id, next)
    else rings.delete(id)
  }
}

/** Both kinds of ring, and who is drawn over the ball, as they move with the clock. */
export class Rings {
  /** How strong each ring is, by track id. Absent means no ring. */
  readonly nearby = new Map<TrackId, number>()
  readonly possession = new Map<TrackId, number>()
  /** Seconds since each player received the ball, while they are drawn over it. */
  readonly received = new Map<TrackId, number>()
  /** Seconds since each player last had the ball, for RING_FADE_S after. */
  readonly hadBall = new Map<TrackId, number>()

  /**
   * Rings partway through a fade, or a player drawn over the ball having just
   * received it, which need a repaint as the clock moves.
   */
  fading(): boolean {
    if (this.received.size > 0) return true
    for (const rings of [this.nearby, this.possession]) {
      for (const strength of rings.values()) if (strength < 1) return true
    }
    return false
  }

  /**
   * Fade both kinds of ring toward `frame`'s own by `dt` seconds, or set them,
   * and move on who is drawn over the ball by `receiveDt`: that plays whether
   * the rings fade or not. No frame has no rings.
   */
  update(frame: Frame | null, dt: number | null, receiveDt: number | null = dt): void {
    const withBall = frame ? possessionTrackIds(frame) : new Set<TrackId>()
    this.updateReceived(withBall, receiveDt)
    fadeRings(this.nearby, frame ? nearbyTrackIds(frame) : new Set(), dt)
    fadeRings(this.possession, withBall, dt, POSSESSION_FADE_IN_S)
  }

  /** Finish any fade at once: `frame` shows its own rings. */
  settle(frame: Frame | null): void {
    this.update(frame, null)
  }

  /** How strongly each player who has just received the ball is drawn over it. */
  covers(): Map<TrackId, number> {
    const covers = new Map<TrackId, number>()
    for (const [id, since] of this.received) {
      const fading = (since - RECEIVE_SHOW_S) / RECEIVE_FADE_S
      covers.set(id, fading <= 0 ? 1 : 1 - fading * fading * (3 - 2 * fading))
    }
    return covers
  }

  /** No rings and nobody drawn over the ball, as before anything was seen. */
  clear(): void {
    this.nearby.clear()
    this.possession.clear()
    this.received.clear()
    this.hadBall.clear()
  }

  /** Start and move on each player drawn over the ball, by `dt` seconds, or clear them. */
  private updateReceived(withBall: Set<TrackId>, dt: number | null): void {
    if (dt === null) {
      // Whoever has the ball here has had it: playing on, they did not just get it.
      this.received.clear()
      this.hadBall.clear()
      for (const id of withBall) this.hadBall.set(id, 0)
      return
    }
    for (const [id, since] of this.received) {
      if (since + dt >= RECEIVE_SHOW_S + RECEIVE_FADE_S) this.received.delete(id)
      else this.received.set(id, since + dt)
    }
    for (const [id, since] of this.hadBall) {
      if (since + dt > RING_FADE_S) this.hadBall.delete(id)
      else this.hadBall.set(id, since + dt)
    }
    for (const id of withBall) {
      if (!this.hadBall.has(id)) this.received.set(id, 0)
      this.hadBall.set(id, 0)
    }
  }
}
