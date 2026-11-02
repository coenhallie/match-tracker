import { describe, it, expect } from 'vitest'
import {
  computeViewMatrix,
  applyViewMatrix,
  IDENTITY_VIEW,
  fitFrameBox,
  viewFromCamera,
  cameraFromView,
} from '../../src/render/viewTransform'
import { FRAME_W, FRAME_H } from '../../src/render/constants'

const CX = FRAME_W / 2
const CY = FRAME_H / 2

/** The default: fit, no pan, laid out at exactly frame size. */
const fit = { zoom: 1, panX: 0, panY: 0, renderedWidth: FRAME_W }

describe('computeViewMatrix', () => {
  it('is the identity at zoom 1 with no pan', () => {
    expect(computeViewMatrix(fit)).toEqual(IDENTITY_VIEW)
  })

  // The surface resets pan to 0 whenever zoom returns to 1, so "fit" must be
  // pixel-identical to the untransformed render it replaced.
  it('is the identity at zoom 1 regardless of how the canvas is laid out', () => {
    expect(computeViewMatrix({ ...fit, renderedWidth: 640 })).toEqual(IDENTITY_VIEW)
    expect(computeViewMatrix({ ...fit, renderedWidth: 1920 })).toEqual(IDENTITY_VIEW)
  })

  it('scales about the frame centre, so the centre pixel does not move', () => {
    const m = computeViewMatrix({ ...fit, zoom: 3 })
    expect(applyViewMatrix(m, CX, CY)).toEqual({ x: CX, y: CY })
  })

  it('magnifies distances from the centre by the zoom factor', () => {
    const m = computeViewMatrix({ ...fit, zoom: 2 })
    const p = applyViewMatrix(m, CX + 100, CY + 50)
    expect(p.x).toBeCloseTo(CX + 200, 6)
    expect(p.y).toBeCloseTo(CY + 100, 6)
  })

  // Pan arrives as pointer deltas in screen pixels. When the canvas is drawn at
  // half size, dragging 100 screen pixels has to move 200 canvas pixels for the
  // image to track the cursor.
  it('converts screen-pixel pan into canvas pixels via the rendered width', () => {
    const m = computeViewMatrix({
      zoom: 2,
      panX: 100,
      panY: -40,
      renderedWidth: FRAME_W / 2,
    })
    const p = applyViewMatrix(m, CX, CY)
    expect(p.x).toBeCloseTo(CX + 200, 6)
    expect(p.y).toBeCloseTo(CY - 80, 6)
  })

  it('applies pan one-to-one when the canvas is drawn at frame size', () => {
    const m = computeViewMatrix({ ...fit, zoom: 2, panX: 30, panY: 70 })
    const p = applyViewMatrix(m, CX, CY)
    expect(p.x).toBeCloseTo(CX + 30, 6)
    expect(p.y).toBeCloseTo(CY + 70, 6)
  })

  // Called during the first render, before the element has a box.
  it('survives an unlaid-out canvas without producing NaN', () => {
    const m = computeViewMatrix({ zoom: 2, panX: 10, panY: 10, renderedWidth: 0 })
    for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true)
  })

  it('falls back to fit for a nonsensical zoom', () => {
    expect(computeViewMatrix({ ...fit, zoom: 0 })).toEqual(IDENTITY_VIEW)
    expect(computeViewMatrix({ ...fit, zoom: Number.NaN })).toEqual(IDENTITY_VIEW)
  })
})

describe('fitFrameBox', () => {
  const at = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
  })

  it('fills the width when the container is taller than 16:9', () => {
    const box = fitFrameBox(at(0, 0, 1096, 640), 2)
    expect(box.width).toBe(1096)
    expect(box.height).toBeCloseTo(616.5, 5)
  })

  // The case the old CSS clamps got wrong: the canvas shrank to keep its
  // ratio while a div carrying the same classes stayed 1280 wide.
  it('keeps 16:9 when the container is wider than it is tall', () => {
    const box = fitFrameBox(at(0, 0, 1468, 380), 2)
    // Height-bound, to within the device pixel lost to whole-pixel sizing.
    expect(box.height).toBeLessThanOrEqual(380)
    expect(box.height).toBeGreaterThanOrEqual(380 - 0.5)
    expect(Math.abs(box.width - (box.height * 16) / 9)).toBeLessThanOrEqual(0.5)
  })

  it('never grows past the frame width', () => {
    const box = fitFrameBox(at(0, 0, 3000, 2000), 1)
    expect(box.width).toBe(1280)
    expect(box.height).toBe(720)
  })

  it('sizes the bitmap in whole device pixels, at the display ratio', () => {
    const box = fitFrameBox(at(0, 0, 1096, 640), 2)
    expect(box.pixelWidth).toBe(2192)
    expect(box.pixelHeight).toBe(1233)
    expect(box.width * 2).toBe(box.pixelWidth)
    expect(box.height * 2).toBe(box.pixelHeight)
  })

  // A canvas whose edge falls between device pixels is resampled by the
  // browser, which blurs it no matter how many pixels its bitmap has.
  it('puts the box on the device pixel grid, wherever the container sits', () => {
    const container = at(24.3, 107.7, 1096, 640)
    const box = fitFrameBox(container, 2)
    for (const edge of [container.left + box.left, container.top + box.top]) {
      expect(Number.isInteger(Math.round(edge * 2 * 1e6) / 1e6)).toBe(true)
    }
    // Still centred, to within one device pixel.
    expect(Math.abs(box.left - (1096 - box.width) / 2)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(box.top - (640 - box.height) / 2)).toBeLessThanOrEqual(0.5)
  })

  it('reports an empty box for a container with no size', () => {
    const box = fitFrameBox(at(0, 0, 0, 0), 2)
    expect(box.pixelWidth).toBe(0)
  })
})

describe('viewFromCamera / cameraFromView', () => {
  // The surface pans in screen pixels; the view maps them back through the
  // rendered width. A camera centred on (x, y) must put that point mid-frame.
  it('pans so the camera centre lands in the middle of the frame', () => {
    const cam = { zoom: 1.8, x: 900, y: 300 }
    const view = viewFromCamera(cam, 640)
    const m = computeViewMatrix({ ...view, renderedWidth: 640 })
    const p = applyViewMatrix(m, 900, 300)
    expect(p.x).toBeCloseTo(CX, 6)
    expect(p.y).toBeCloseTo(CY, 6)
  })

  it('round-trips', () => {
    const cam = { zoom: 2.2, x: 700, y: 410 }
    const back = cameraFromView({ ...viewFromCamera(cam, 900), renderedWidth: 900 })
    expect(back.zoom).toBe(2.2)
    expect(back.x).toBeCloseTo(700, 6)
    expect(back.y).toBeCloseTo(410, 6)
  })

  it('reads the fit view as the whole frame', () => {
    expect(cameraFromView({ zoom: 1, panX: 0, panY: 0, renderedWidth: 1096 })).toEqual({
      zoom: 1,
      x: CX,
      y: CY,
    })
  })
})
