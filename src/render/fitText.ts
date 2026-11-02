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

/** How wide `text` is in `font`. The context's font is left as it was. */
export function measureWidth(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  const before = ctx.font
  ctx.font = font
  const width = ctx.measureText(text).width
  ctx.font = before
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
