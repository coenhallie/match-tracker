/**
 * The goal's camera, ported from PipelineOutputSurface.vue (6f14d1f): how it
 * moves between two views (`blendCamera`, :498-504), and when the user takes
 * the view over from it (`releaseSequenceCamera`, :546-548, as the surface's
 * wheel, press and double-click handlers call it, :307-368).
 */
import type { Camera } from '../render/viewTransform.js'

/** The zoom the view is at when it is not zoomed in: the whole pitch. */
export const MIN_ZOOM = 1

/** Between two cameras: zoom eased geometrically, so it feels even both ways. */
export function blendCamera(from: Camera, to: Camera, k: number): Camera {
  return {
    zoom: from.zoom * (to.zoom / from.zoom) ** k,
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
  }
}

/** A gesture on the pitch that can hand the view to the user. */
export type ViewGesture = 'wheel' | 'pointerdown' | 'pointermove' | 'pointerup' | 'dblclick'

/**
 * Whether `gesture`, made with the view at `zoom`, takes the view over from a
 * sequence moving it, so it stays where the user puts it. A wheel and a double
 * click always do. A press does only when it starts a pan, which it does only
 * zoomed in: the reference's handler returns before releasing at the whole
 * pitch. A move or a release never does; the press before it already has.
 */
export function takesCamera(gesture: ViewGesture, zoom: number): boolean {
  if (gesture === 'wheel' || gesture === 'dblclick') return true
  return gesture === 'pointerdown' && zoom > MIN_ZOOM
}
