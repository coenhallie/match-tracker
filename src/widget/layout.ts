/**
 * Where the pitch sits in the widget, and the bitmap it is drawn in, ported
 * from PipelineOutputSurface.vue's sizing (`:214-290`). The canvas, the
 * overlay and the HUD are all placed from one computed box, and the canvas
 * bitmap is sized to that box in device pixels; see fitFrameBox for why CSS
 * could do neither.
 */
import { FRAME_H, FRAME_W } from '../render/constants.js'
import { fitFrameBox, type FrameBox } from '../render/viewTransform.js'

/**
 * A row kept clear above the pitch for the team phase labels, so they never
 * sit over it: anything on the near touchline would be hidden under them.
 */
export const LABEL_ROW_PX = 40

/** The device pixel ratio, or 1 where there is none. */
export function pixelRatio(): number {
  return (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1
}

/**
 * The box for a viewport measured at `rect`, below the label row, or null
 * when it measures as nothing. A hidden widget measures as nothing, and its
 * caller keeps the box it had rather than collapse the bitmap to zero, which
 * has nothing to draw into.
 */
export function measureBox(rect: { left: number; top: number; width: number; height: number }, dpr: number) {
  const fitted = fitFrameBox(
    {
      left: rect.left,
      top: rect.top + LABEL_ROW_PX,
      width: rect.width,
      height: Math.max(0, rect.height - LABEL_ROW_PX),
    },
    dpr,
  )
  // fitFrameBox places the box within the area it was given, below the row.
  const next: FrameBox = { ...fitted, top: fitted.top + LABEL_ROW_PX }
  if (next.pixelWidth < 1 || next.pixelHeight < 1) return null
  return next
}

export const sameBox = (a: FrameBox | null, b: FrameBox | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.pixelWidth === b.pixelWidth &&
    a.pixelHeight === b.pixelHeight)

/** Put `el` in `box`. */
export function place(el: HTMLElement, box: FrameBox): void {
  el.style.left = `${box.left}px`
  el.style.top = `${box.top}px`
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
}

/**
 * Size `canvas`'s bitmap for `box`, or to the frame's own size while there is
 * no box yet. Returns whether it changed: assigning a canvas's size clears
 * it, even to the size it has, so it is assigned only when it differs.
 */
export function sizeBitmap(canvas: HTMLCanvasElement, box: FrameBox | null): boolean {
  const width = box?.pixelWidth ?? FRAME_W
  const height = box?.pixelHeight ?? FRAME_H
  if (canvas.width === width && canvas.height === height) return false
  canvas.width = width
  canvas.height = height
  return true
}
