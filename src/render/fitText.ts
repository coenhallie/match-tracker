/**
 * The smallest a piece of canvas text is drawn, as a share of its size: below
 * this it stops reading as a title, so text still too long overflows instead.
 */
export const MIN_FIT = 0.6

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
  const before = ctx.font
  ctx.font = font(basePx)
  const width = ctx.measureText(text).width
  ctx.font = before
  if (!(width > maxWidth)) return basePx
  return Math.max(basePx * MIN_FIT, basePx * (maxWidth / width))
}
