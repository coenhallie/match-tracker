/**
 * One animation frame loop: at most one frame requested at a time, and none
 * at all unless something asks for one. The widget asks after an input, and
 * again from a frame while the director says something is still animating;
 * otherwise the loop stops by itself.
 *
 * A frame that throws does not stop the loop: the error is reported, once
 * for each distinct message, and while something is still animating the
 * next frame is asked for, so a moment goes on rather than freezing where
 * the error left it.
 */

/** How many distinct errors are reported before the loop goes quiet about new ones. */
const MAX_REPORTED = 20

export class FrameLoop {
  private id: number | null = null
  private stopped = false
  /** The timestamp of the last animation frame run, or null before the first. */
  private lastFrameMs: number | null = null
  private readonly reported = new Set<string>()

  constructor(
    private readonly tick: (nowMs: number) => void,
    /** Whether something still needs frames: asked after a frame that threw. */
    private readonly animating: () => boolean,
  ) {}

  /** Run `tick` at the next animation frame, unless it is already due to run then. */
  request(): void {
    if (this.stopped || this.id !== null || typeof requestAnimationFrame !== 'function') return
    this.id = requestAnimationFrame(this.run)
  }

  /**
   * Run the frame due now, if one is, rather than at the next animation
   * frame. It runs at the last animation frame's time, in the clock frames
   * are timed by: as part of that frame, not as a new one, so the moments
   * step at the next frame as they would have.
   */
  flush(): void {
    if (this.stopped || this.id === null) return
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.id)
    this.id = null
    try {
      this.tick(this.frameTime())
    } catch (error) {
      // The caller hears of it; the frames go on.
      this.again()
      throw error
    }
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
    this.lastFrameMs = nowMs
    try {
      this.tick(nowMs)
    } catch (error) {
      this.report(error)
      this.again()
    }
  }

  /** The last animation frame's timestamp; before there is one, the document timeline's, or the clock's. */
  private frameTime(): number {
    if (this.lastFrameMs !== null) return this.lastFrameMs
    const timeline = typeof document !== 'undefined' ? document.timeline?.currentTime : null
    return typeof timeline === 'number' ? timeline : performance.now()
  }

  /** After a frame that threw: the next one, if anything still animates. */
  private again(): void {
    if (this.animating()) this.request()
  }

  private report(error: unknown): void {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    if (this.reported.has(message) || this.reported.size >= MAX_REPORTED) return
    this.reported.add(message)
    console.error('match-tracker: a frame failed', error)
  }
}
