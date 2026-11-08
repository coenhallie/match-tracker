/**
 * The shadow root's stylesheet without its comments, for the build and the
 * tests (vite.config.ts). The comments in src/widget/styles.ts say which of
 * the reference's Tailwind classes each rule stands for, which is worth
 * keeping in the source, but they are about two fifths of the stylesheet and
 * a host's minifier leaves a template string as it is.
 *
 * Only the comments inside the STYLES template are taken out, each with the
 * line it stands alone on. Should the template no longer be found, the build
 * fails, rather than shipping the comments without anyone noticing.
 */
const START = 'export const STYLES = `'

export function stripStylesComments(source: string): string {
  const start = source.indexOf(START)
  const end = start === -1 ? -1 : source.indexOf('`', start + START.length)
  if (end === -1) throw new Error('stripStylesComments: no STYLES template in src/widget/styles.ts')
  const css = source
    .slice(start + START.length, end)
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  return source.slice(0, start + START.length) + css + source.slice(end)
}
