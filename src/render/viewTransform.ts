import { FRAME_H, FRAME_W, type Camera } from '../model/pitch.js'

export interface PipelineView {
  /** 1 = fit, >1 zoomed in. */
  zoom: number
  /** Pan in *screen* pixels, as the pointer produced it. */
  panX: number
  panY: number
  /**
   * Rendered width of the canvas element in screen pixels. The canvas is
   * letterboxed to fit, so one canvas pixel is `renderedWidth / FRAME_W` screen
   * pixels and a pan measured from pointer deltas has to be divided by that to
   * land in canvas space.
   */
  renderedWidth: number
}

/** The six values of a 2D affine matrix, in ctx.setTransform order. */
export interface ViewMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY_VIEW: ViewMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/**
 * Reproduce, in canvas space, the CSS transform this surface used to apply to
 * the canvas element: `translate(pan) scale(zoom)` about the element's centre.
 *
 * Doing it here rather than in CSS is what lets a drawing layer sit over the
 * canvas: the element stays put and unscaled, so a Fabric canvas on top of it
 * shares its coordinate system. With the transform on the element, Fabric would
 * compute pointer positions against a box it does not know is scaled, and every
 * stroke would land offset by the zoom factor.
 *
 * Scaling is about the frame centre because that is what `scale()` does to an
 * element already centred with `translate(-50%, -50%)`.
 */
export function computeViewMatrix(view: PipelineView): ViewMatrix {
  const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1

  // A zero or missing rendered width means the element has not been laid out
  // yet. Treating the scale as 1 keeps the matrix finite; the next render after
  // layout supplies the real value.
  const displayScale = Number.isFinite(view.renderedWidth) && view.renderedWidth > 0 ? view.renderedWidth / FRAME_W : 1

  const panX = Number.isFinite(view.panX) ? view.panX / displayScale : 0
  const panY = Number.isFinite(view.panY) ? view.panY / displayScale : 0

  const cx = FRAME_W / 2
  const cy = FRAME_H / 2

  // translate(cx + pan) · scale(zoom) · translate(-cx)
  return {
    a: zoom,
    b: 0,
    c: 0,
    d: zoom,
    e: cx + panX - zoom * cx,
    f: cy + panY - zoom * cy,
  }
}

/** Map a point in canvas space through a view matrix. */
export function applyViewMatrix(m: ViewMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

/** Where the frame sits inside its container, and the bitmap it needs. */
export interface FrameBox {
  /** Offset from the container's top-left, in CSS pixels. */
  left: number
  top: number
  /** Displayed size in CSS pixels. */
  width: number
  height: number
  /** Bitmap size: exactly one bitmap pixel per device pixel. */
  pixelWidth: number
  pixelHeight: number
}

/**
 * Fit the 16:9 frame inside a container, the way the canvas, the drawing
 * overlay and the HUD all have to agree on.
 *
 * Computed rather than left to CSS clamps, for two reasons. A canvas and a div
 * given the same clamps do not resolve to the same box once the container is
 * wider than 16:9: the canvas shrinks to keep its ratio and the div does not,
 * which put the drawing overlay and HUD out of line with the pitch. And the
 * bitmap has to match the displayed size in device pixels, with the box
 * starting on a device pixel, or the browser resamples it and it blurs however
 * many pixels it holds.
 *
 * Never wider than the frame itself, as before.
 */
export function fitFrameBox(
  container: { left: number; top: number; width: number; height: number },
  dpr: number,
): FrameBox {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  const fit = Math.max(0, Math.min(container.width, (container.height * FRAME_W) / FRAME_H, FRAME_W))
  const pixelWidth = Math.floor(fit * ratio)
  // Rounded, so the ratio is off by under half a device pixel, but never
  // taller than the container.
  const pixelHeight = Math.min(
    Math.round((pixelWidth * FRAME_H) / FRAME_W),
    Math.floor(Math.max(0, container.height) * ratio),
  )
  const width = pixelWidth / ratio
  const height = pixelHeight / ratio

  // Centred, then nudged onto the device grid in absolute terms: the
  // container itself may start partway through a device pixel.
  const snap = (origin: number, free: number) => Math.round((origin + free / 2) * ratio) / ratio - origin

  return {
    left: snap(container.left, container.width - width),
    top: snap(container.top, container.height - height),
    width,
    height,
    pixelWidth,
    pixelHeight,
  }
}

/**
 * The surface's zoom and screen-pixel pan that centre the view on a camera.
 *
 * The view scales about the frame centre and then pans (computeViewMatrix), so
 * a point p lands at zoom * (p - centre) + centre + pan. Putting the camera's
 * point at the centre gives pan = -zoom * (p - centre) in frame units, which
 * the rendered width converts to screen pixels.
 */
export function viewFromCamera(cam: Camera, renderedWidth: number): { zoom: number; panX: number; panY: number } {
  const scale = renderedWidth > 0 ? renderedWidth / FRAME_W : 1
  // `|| 0` turns a centred camera's -0 into 0, which is what "no pan" means.
  return {
    zoom: cam.zoom,
    panX: -cam.zoom * (cam.x - FRAME_W / 2) * scale || 0,
    panY: -cam.zoom * (cam.y - FRAME_H / 2) * scale || 0,
  }
}

/** The camera a surface view is showing: the inverse of viewFromCamera. */
export function cameraFromView(view: PipelineView): Camera {
  const scale = view.renderedWidth > 0 ? view.renderedWidth / FRAME_W : 1
  const zoom = view.zoom > 0 ? view.zoom : 1
  return {
    zoom,
    x: FRAME_W / 2 - view.panX / scale / zoom,
    y: FRAME_H / 2 - view.panY / scale / zoom,
  }
}
