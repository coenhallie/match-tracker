/**
 * jsdom has no canvas backend, so the 2D drawing code is driven against a
 * recording context instead. Every op is captured together with the style state
 * in force when it ran, which is what the drawing tests assert on.
 */
export interface Op {
  op: string
  fillStyle: string
  strokeStyle: string
  lineDash: number[]
  globalAlpha: number
  font: string
  textAlign: string
  lineWidth: number
  args: unknown[]
}

export function recordingCtx() {
  const ops: Op[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    lineDash: [] as number[],
    setLineDash(d: number[]) {
      ctx.lineDash = d
    },
    getLineDash() {
      return ctx.lineDash
    },
    snap(op: string, args: unknown[] = []) {
      ops.push({
        op,
        fillStyle: String(ctx.fillStyle),
        strokeStyle: String(ctx.strokeStyle),
        lineDash: [...ctx.lineDash],
        globalAlpha: ctx.globalAlpha,
        font: ctx.font,
        textAlign: ctx.textAlign,
        lineWidth: ctx.lineWidth,
        args,
      })
    },
    beginPath() {},
    closePath() {},
    moveTo(...args: unknown[]) {
      ctx.snap('moveTo', args)
    },
    lineTo(...args: unknown[]) {
      ctx.snap('lineTo', args)
    },
    quadraticCurveTo(...args: unknown[]) {
      ctx.snap('quadraticCurveTo', args)
    },
    arcTo(...args: unknown[]) {
      ctx.snap('arcTo', args)
    },
    rect(...args: unknown[]) {
      ctx.snap('rect', args)
    },
    lineJoin: 'miter',
    arc(...args: unknown[]) {
      ctx.snap('arc', args)
    },
    fill() {
      ctx.snap('fill')
    },
    stroke() {
      ctx.snap('stroke')
    },
    fillRect(...args: unknown[]) {
      ctx.snap('fillRect', args)
    },
    shadowBlur: 0,
    shadowColor: '',
    // A gradient that records its geometry and stops, and reads back as a
    // string describing them, so a fillStyle set to it can be asserted on.
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
      const stops: Array<[number, string]> = []
      return {
        addColorStop(offset: number, color: string) {
          stops.push([offset, color])
        },
        toString() {
          return `gradient(${x0},${y0}->${x1},${y1}|${stops.map(([o, c]) => `${o}:${c}`).join(',')})`
        },
      }
    },
    createRadialGradient(...args: number[]) {
      const stops: Array<[number, string]> = []
      return {
        addColorStop(offset: number, color: string) {
          stops.push([offset, color])
        },
        toString() {
          return `radial(${args.join(',')}|${stops.map(([o, c]) => `${o}:${c}`).join(',')})`
        },
      }
    },
    // save and restore keep the style state, as a real context does, so code
    // that changes alpha or dash inside a save leaves nothing behind.
    stack: [] as Array<Pick<Op, 'fillStyle' | 'strokeStyle' | 'lineDash' | 'globalAlpha'>>,
    save() {
      ctx.snap('save')
      ctx.stack.push({
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
        lineDash: [...ctx.lineDash],
        globalAlpha: ctx.globalAlpha,
      })
    },
    restore() {
      ctx.snap('restore')
      const top = ctx.stack.pop()
      if (top) Object.assign(ctx, top)
    },
    clip() {
      ctx.snap('clip')
    },
    strokeRect(...args: unknown[]) {
      ctx.snap('strokeRect', args)
    },
    roundRect(...args: unknown[]) {
      ctx.snap('roundRect', args)
    },
    globalCompositeOperation: 'source-over',
    translate() {},
    scale() {},
    fillText(...args: unknown[]) {
      ctx.snap('fillText', args)
    },
    // No font metrics without a canvas: every character is taken as 0.6 of
    // the font size wide, which is enough to lay text out against.
    measureText(text: string) {
      const size = Number(/([\d.]+)px/.exec(ctx.font)?.[1] ?? 10)
      return { width: text.length * size * 0.6 }
    },
    drawImage(...args: unknown[]) {
      ctx.snap('drawImage', args)
    },
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    // Frame units drawn at their own size, as on a 1280x720 bitmap.
    getTransform() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    },
    // The renderer clears and sets the view matrix at the top of every frame.
    // Recorded rather than ignored so tests can assert the transform actually
    // applied.
    setTransform(...args: unknown[]) {
      ctx.snap('setTransform', args)
    },
    clearRect(...args: unknown[]) {
      ctx.snap('clearRect', args)
    },
  }
  return { ctx, ops }
}

/** A canvas whose 2D context records instead of drawing. */
export function fakeCanvas() {
  const { ctx, ops } = recordingCtx()
  const canvas = { width: 1280, height: 720, getContext: () => ctx }
  return { canvas: canvas as unknown as HTMLCanvasElement, ops }
}

/**
 * Replace OffscreenCanvas with one backed by a recording context, and hand back
 * the ops it collects. jsdom does not implement OffscreenCanvas at all, so the
 * pitch cache cannot be built without this.
 */
export function stubOffscreenCanvas(): {
  ops: Op[]
  /** The size each OffscreenCanvas was created at, in order. */
  sizes: Array<[number, number]>
  restore: () => void
} {
  const g = globalThis as Record<string, unknown>
  const original = g.OffscreenCanvas
  const { ctx, ops } = recordingCtx()
  const sizes: Array<[number, number]> = []
  g.OffscreenCanvas = class {
    width: number
    height: number
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
      sizes.push([width, height])
    }
    getContext() {
      return ctx
    }
  }
  return {
    ops,
    sizes,
    restore: () => {
      g.OffscreenCanvas = original
    },
  }
}
