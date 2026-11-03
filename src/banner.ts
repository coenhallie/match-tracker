/**
 * The console banner: a small pitch in box-drawing characters with the
 * widget's version under it, for a page's developer console.
 *
 * Opt-in, always. The widget never prints on its own: a host that wants the
 * banner calls logMatchTrackerBanner, and it prints once per page however
 * many times it is called.
 *
 * This is also an entry of its own, `@coenhallie/match-tracker/banner`, so a
 * host can call it from its app entry without loading the widget. Keep its
 * imports to the version and the palette: scripts/check-dist.mjs fails the
 * build if dist/banner.js imports anything or holds renderer code. The main
 * entry and /vue import this very module, so the once-per-page guard below
 * is one variable however a page loads them.
 *
 * Every character is one column wide: box drawing, ASCII, `•` and `·`, and
 * no emoji or ambiguous-width glyph such as `●`. Each is in Menlo, the
 * console font of Chrome, Safari and Firefox on macOS, at the same advance.
 * The lines are drawn in the regular weight, since Menlo Bold has no
 * box-drawing glyphs and a fallback font would put them out of line.
 */
import { AWAY_FILL, HOME_FILL, PITCH_GRASS_MIDDLE } from './palette.js'
import { MATCH_TRACKER_VERSION } from './version.js'

/**
 * The pitch, with `h` for a home player, `a` for an away player and `b` for
 * the ball. Home plays left to right, on the ball, into the away half.
 */
const PITCH = [
  '┌──────────────┬──────────────┐',
  '│       h      │      a       │',
  '├───┐       ╭──┼──╮       ┌───┤',
  '│   │  h    │  │  │ hb  a │   │',
  '├───┘       ╰──┼──╯       └───┤',
  '│     h        │        a     │',
  '└──────────────┴──────────────┘',
]

const GLYPHS: Record<string, string> = { h: 'o', a: 'o', b: '•' }

/** What a character is drawn in. The spaces between the lines are drawn in the lines' ink. */
type Ink = 'line' | 'home' | 'away' | 'ball' | 'title'

/**
 * On the console's own background, light or dark, with no background of
 * their own: a background per run leaves seams between runs and rows. The
 * ball and the title take the console's text colour, so the ball is black on
 * a light console and white on a dark one.
 */
const STYLES: Record<Ink, string> = {
  line: `color:${PITCH_GRASS_MIDDLE};font-weight:normal`,
  home: `color:${HOME_FILL};font-weight:bold`,
  away: `color:${AWAY_FILL};font-weight:bold`,
  ball: 'font-weight:bold',
  title: 'font-weight:bold',
}

const INKS: Record<string, Ink> = { h: 'home', a: 'away', b: 'ball' }

interface Run {
  text: string
  ink: Ink
}

/** The banner's lines, each as runs of characters drawn in one ink. */
function lines(version: string): Run[][] {
  const title = `MATCH TRACKER  ·  v${version}`
  const width = Math.max(PITCH[0]!.length, title.length + 2)
  const titleLine = title.padStart(Math.floor((width + title.length) / 2)).padEnd(width)
  const pitch = PITCH.map((row) => {
    const out: Run[] = []
    for (const ch of row.padEnd(width)) {
      const ink = INKS[ch] ?? 'line'
      const text = GLYPHS[ch] ?? ch
      const last = out.at(-1)
      if (last?.ink === ink) last.text += text
      else out.push({ text, ink })
    }
    return out
  })
  return [...pitch, [{ text: titleLine, ink: 'title' }]]
}

/** The banner as plain text, every line the same width, with the version at the bottom. */
export function matchTrackerBanner(): string {
  return lines(MATCH_TRACKER_VERSION)
    .map((line) => line.map((run) => run.text).join(''))
    .join('\n')
}

/**
 * The banner, styled, as one `console.log`'s arguments: a format string with
 * a `%c` before every run, and that run's style for each.
 */
export function matchTrackerBannerLog(): [string, ...string[]] {
  const styles: string[] = []
  const format = lines(MATCH_TRACKER_VERSION)
    .map((line) =>
      line
        .map((run) => {
          styles.push(STYLES[run.ink])
          return `%c${run.text}`
        })
        .join(''),
    )
    .join('\n')
  return [format, ...styles]
}

let printed = false

/**
 * Print the banner to the page's console, once per page: a later call does
 * nothing. Opt-in, for a host to call; the widget never does. Without a
 * document or a console (rendering on a server), it does nothing.
 */
export function logMatchTrackerBanner(): void {
  if (printed) return
  if (typeof document === 'undefined' || typeof console === 'undefined' || typeof console.log !== 'function') return
  printed = true
  console.log(...matchTrackerBannerLog())
}
