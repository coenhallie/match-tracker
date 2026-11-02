/**
 * Zoom and pan by hand, ported from PipelineOutputSurface.vue (6f14d1f): the
 * wheel, the pointer pan and the double-click reset (`:307-370`), each
 * handing the view over from a sequence (`releaseSequenceCamera`, as
 * camera.ts's takesCamera rules it), with the spec's deliberate change 6:
 *
 *  - A plain wheel scrolls the page; only ctrl/⌘ + wheel zooms, which is
 *    also what a trackpad pinch sends.
 *  - Two fingers pinch, about their midpoint, by the ratio of how far apart
 *    they are now to how far apart they started (this site's PitchView.vue,
 *    its `pointers` map and `pinch` state). A pinch hands the view over too.
 *  - The page scrolls under one finger at the whole pitch (`touch-action:
 *    pan-y`, set by the tracker); zoomed in, a finger pans.
 *
 * Pans are in CSS px from the centre of the stage, as in the reference, which
 * measures the cursor against the stage (here the viewport, which fills it).
 */
import { MIN_ZOOM, takesCamera } from '../director/camera'
import type { DirectorCamera } from '../director/director'

export const MAX_ZOOM = 6
export const ZOOM_STEP = 0.15

const WHOLE_PITCH: DirectorCamera = { zoom: 1, panX: 0, panY: 0 }

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/**
 * `view` zoomed to `zoom` about the point (`mx`, `my`) from the stage's
 * centre, which stays where it is on screen; the whole pitch, unpanned, at 1.
 */
export function zoomAbout(view: DirectorCamera, zoom: number, mx: number, my: number): DirectorCamera {
  if (zoom <= MIN_ZOOM) return { ...WHOLE_PITCH }
  const scale = zoom / view.zoom
  return { zoom, panX: mx - scale * (mx - view.panX), panY: my - scale * (my - view.panY) }
}

/** What the gestures move: the tracker's view, which goes to the director. */
export interface ZoomPanTarget {
  /** The view as it is now: the user's, or where a sequence has put it. */
  view(): DirectorCamera
  /** The user takes the view over from a sequence moving it (Director.releaseCamera). */
  takeCamera(): void
  /** The user moved the view. */
  setView(view: DirectorCamera): void
}

interface Point {
  x: number
  y: number
}

export class ZoomPan {
  /** The touches down, by pointer: two of them pinch. */
  private readonly touches = new Map<number, Point>()
  private pinch: { distance: number; zoom: number } | null = null
  /** A pan under way: the pointer, where it went down, and the pan then. */
  private pan: { pointerId: number; start: Point; origin: Point } | null = null

  constructor(
    private readonly el: HTMLElement,
    private readonly target: ZoomPanTarget,
  ) {
    // Not passive: a ctrl/⌘ + wheel has to be kept from zooming the page.
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerEnd)
    el.addEventListener('pointercancel', this.onPointerEnd)
    el.addEventListener('dblclick', this.onDoubleClick)
  }

  destroy(): void {
    this.el.removeEventListener('wheel', this.onWheel)
    this.el.removeEventListener('pointerdown', this.onPointerDown)
    this.el.removeEventListener('pointermove', this.onPointerMove)
    this.el.removeEventListener('pointerup', this.onPointerEnd)
    this.el.removeEventListener('pointercancel', this.onPointerEnd)
    this.el.removeEventListener('dblclick', this.onDoubleClick)
    this.touches.clear()
    this.pinch = null
    this.pan = null
  }

  /** Where (`x`, `y`) on screen is from the stage's centre. */
  private fromCentre(x: number, y: number): Point {
    const rect = this.el.getBoundingClientRect()
    return { x: x - rect.left - rect.width / 2, y: y - rect.top - rect.height / 2 }
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const view = this.target.view()
    if (takesCamera('wheel', view.zoom)) this.target.takeCamera()
    // A ctrl/⌘ + wheel straight across says nothing about which way to zoom.
    if (event.deltaY === 0) return
    const next = clampZoom(view.zoom + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP))
    if (next === view.zoom) return
    const m = this.fromCentre(event.clientX, event.clientY)
    if (next <= MIN_ZOOM && this.pan) {
      // The pan's start was taken at the press; without taking it again here,
      // the next move would work from it against the pan just reset to 0,
      // and the pitch would jump.
      this.pan.origin = { x: 0, y: 0 }
      this.pan.start = { x: event.clientX, y: event.clientY }
    }
    this.target.setView(zoomAbout(view, next, m.x, m.y))
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      // A third finger changes nothing.
      if (this.touches.size >= 2) return
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
      this.capture(event)
      if (this.touches.size === 2) {
        this.target.takeCamera()
        this.pinch = { distance: this.distance(), zoom: this.target.view().zoom }
        this.pan = null
        return
      }
    }
    const view = this.target.view()
    // At the whole pitch a press is not a pan, and leaves the view to a sequence.
    if (!takesCamera('pointerdown', view.zoom)) return
    this.target.takeCamera()
    this.pan = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: { x: view.panX, y: view.panY },
    }
    this.capture(event)
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (this.pinch) {
        this.pinchTo(this.pinch)
        return
      }
    }
    const pan = this.pan
    if (!pan || pan.pointerId !== event.pointerId) return
    this.target.setView({
      zoom: this.target.view().zoom,
      panX: pan.origin.x + (event.clientX - pan.start.x),
      panY: pan.origin.y + (event.clientY - pan.start.y),
    })
  }

  private readonly onPointerEnd = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId)
    if (this.touches.size < 2) this.pinch = null
    if (this.pan?.pointerId === event.pointerId) this.pan = null
  }

  private readonly onDoubleClick = (): void => {
    this.target.takeCamera()
    const view = this.target.view()
    if (view.zoom === 1 && view.panX === 0 && view.panY === 0) return
    this.target.setView({ ...WHOLE_PITCH })
  }

  /** The two fingers' zoom, about where they are now. */
  private pinchTo(pinch: { distance: number; zoom: number }): void {
    const [a, b] = [...this.touches.values()]
    if (!a || !b || pinch.distance === 0) return
    const view = this.target.view()
    const next = clampZoom(pinch.zoom * (this.distance() / pinch.distance))
    if (next === view.zoom) return
    const m = this.fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2)
    this.target.setView(zoomAbout(view, next, m.x, m.y))
  }

  private distance(): number {
    const [a, b] = [...this.touches.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  /** Keep hearing the pointer when it leaves the pitch mid-gesture. */
  private capture(event: PointerEvent): void {
    try {
      this.el.setPointerCapture(event.pointerId)
    } catch {
      // Not a pointer the browser knows as active (a synthetic event): nothing to capture.
    }
  }
}
