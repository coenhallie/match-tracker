import { fontGeneration } from '../assets/fonts.js'

/**
 * The smallest a piece of canvas text is drawn, as a share of its size: below
 * this it stops reading as a title, so text still too long overflows instead,
 * or, drawn through fitText, is cut short.
 */
export const MIN_FIT = 0.6

/** The ellipsis fitText ends cut-short text with. */
export const ELLIPSIS = '…'

/**
 * How far over its width, as a share of it, text at the smallest size may
 * measure and still count as fitting: a size scaled to fit can measure a
 * rounding error over.
 */
export const FIT_TOLERANCE = 1e-6

/** The most widths kept for a context: a timer shows a new text every second, for as long as it runs. */
const MAX_WIDTHS = 256

/** Each context's widths, by font and text, as measured while `generation` faces had loaded. */
const measured = new WeakMap<CanvasRenderingContext2D, { generation: number; widths: Map<string, number> }>()

/**
 * How wide `text` is in `font`. The context's font is left as it was.
 *
 * The cards and the replay's timer measure the same few texts on every animation frame, so each
 * width is kept, for its context, until a bundled face loads (fontGeneration), which can change
 * them all: text measured in a fallback font before is measured again in the face.
 */
export function measureWidth(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  const generation = fontGeneration()
  let memo = measured.get(ctx)
  if (!memo || memo.generation !== generation) {
    memo = { generation, widths: new Map() }
    measured.set(ctx, memo)
  }
  const key = `${font}\0${text}`
  const known = memo.widths.get(key)
  if (known !== undefined) return known
  const before = ctx.font
  ctx.font = font
  const width = ctx.measureText(text).width
  ctx.font = before
  if (memo.widths.size >= MAX_WIDTHS) memo.widths.clear()
  memo.widths.set(key, width)
  return width
}

/**
 * The font size to draw `text` at so it is at most `maxWidth` wide: `basePx`
 * if it fits at that, otherwise the size that makes it exactly `maxWidth`,
 * but never less than MIN_FIT of `basePx`. `font` makes the font shorthand for
 * a size; `maxWidth` is in the units the context measures in.
 *
 * One measurement, scaled: a canvas measures text in proportion to its size.
 * The attack's label shrinks a long team name the same way in the reference.
 * The context's font is left as it was.
 */
export function fitFontPx(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: (px: number) => string,
  basePx: number,
  maxWidth: number,
): number {
  const width = measureWidth(ctx, text, font(basePx))
  if (!(width > maxWidth)) return basePx
  return Math.max(basePx * MIN_FIT, basePx * (maxWidth / width))
}

/**
 * The size and the text to draw so it is at most `maxWidth` wide: shrunk as
 * fitFontPx shrinks it, and only if it is still too wide at the smallest size,
 * cut to the longest start of it that fits with a trailing ELLIPSIS. Above
 * the smallest size the text fits as it is, and is drawn whole. Characters
 * are taken whole, by code point, and spaces before the ellipsis dropped; if
 * not even one character fits, it is the ellipsis alone. Widths are compared
 * with FIT_TOLERANCE. The context's font is left as it was.
 */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: (px: number) => string,
  basePx: number,
  maxWidth: number,
): { px: number; text: string } {
  const px = fitFontPx(ctx, text, font, basePx, maxWidth)
  if (px > basePx * MIN_FIT) return { px, text }
  const shorthand = font(px)
  const limit = maxWidth + Math.abs(maxWidth) * FIT_TOLERANCE
  const fits = (s: string) => !(measureWidth(ctx, s, shorthand) > limit)
  if (fits(text)) return { px, text }
  const chars = Array.from(text)
  const cut = (n: number) => `${chars.slice(0, n).join('').trimEnd()}${ELLIPSIS}`
  // The longest start that fits: wider the more of it there is.
  let lo = 0
  let hi = chars.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(cut(mid))) lo = mid
    else hi = mid - 1
  }
  return { px, text: cut(lo) }
}

/**
 * `text` as lines at most `maxWidth` wide: each of its own lines, broken at
 * spaces. A single word too wide for a line has the line to itself and runs
 * over. At most `maxLines` lines; if there would be more, the last one kept
 * ends in an ELLIPSIS. The context's font is left as it was.
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = []
  for (const own of text.split('\n')) {
    let line = ''
    for (const word of own.trim().split(/\s+/)) {
      const longer = line ? `${line} ${word}` : word
      if (line && measureWidth(ctx, longer, font) > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = longer
      }
    }
    lines.push(line)
  }
  if (lines.length <= maxLines) return lines
  return [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]}${ELLIPSIS}`]
}
