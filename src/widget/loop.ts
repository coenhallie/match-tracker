/**
 * One animation frame loop: at most one frame requested at a time, and none
 * at all unless something asks for one. The widget asks after an input, and
 * again from a frame while the director says something is still animating;
 * otherwise the loop stops by itself.
 */
export class FrameLoop {
  private id: number | null = null
  private stopped = false

  constructor(private readonly tick: (nowMs: number) => void) {}

  /** Run `tick` at the next animation frame, unless it is already due to run then. */
  request(): void {
    if (this.stopped || this.id !== null || typeof requestAnimationFrame !== 'function') return
    this.id = requestAnimationFrame(this.run)
  }

  /** Run the frame due now, if one is, rather than at the next animation frame. */
  flush(nowMs: number): void {
    if (this.stopped || this.id === null) return
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.id)
    this.id = null
    this.tick(nowMs)
  }

  /** Cancel the frame due, and never request another. */
  stop(): void {
    this.stopped = true
    if (this.id !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.id)
    this.id = null
  }

  private readonly run = (nowMs: number): void => {
    this.id = null
    if (this.stopped) return
    this.tick(nowMs)
  }
}
