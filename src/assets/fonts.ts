import { LABEL_FAMILY, TITLE_FAMILY } from './fontFamilies.js'

/**
 * The faces the widget draws and lays out its text in, bundled as woff2 files
 * (Latin subsets, from @fontsource; see scripts/copy-fonts.mjs):
 *  - Montserrat 600 and 700, for the attack's label on the canvas, and with
 *    400 for the HUD, whose phase row is semibold and bold and whose layers
 *    menu is the page's normal weight, as in video-annotation.
 *  - Inter Black Italic, for the event cards' titles, and Semi Bold for a label
 *    card's short text.
 *
 * Each `new URL(..., import.meta.url)` is written out in full, so the bundler
 * ships each file as an asset of its own rather than inside the script. Vite
 * inlines every asset in library mode unless it is marked `?no-inline`, and
 * the relative `base` in vite.config.ts keeps the built URLs next to
 * dist/index.js.
 */
const FACES: ReadonlyArray<{ family: string; url: URL; weight: string; style: string }> = [
  {
    family: LABEL_FAMILY,
    url: new URL('./fonts/montserrat-latin-400-normal.woff2?no-inline', import.meta.url),
    weight: '400',
    style: 'normal',
  },
  {
    family: LABEL_FAMILY,
    url: new URL('./fonts/montserrat-latin-600-normal.woff2?no-inline', import.meta.url),
    weight: '600',
    style: 'normal',
  },
  {
    family: LABEL_FAMILY,
    url: new URL('./fonts/montserrat-latin-700-normal.woff2?no-inline', import.meta.url),
    weight: '700',
    style: 'normal',
  },
  {
    family: TITLE_FAMILY,
    url: new URL('./fonts/inter-latin-900-italic.woff2?no-inline', import.meta.url),
    weight: '900',
    style: 'italic',
  },
  {
    family: TITLE_FAMILY,
    url: new URL('./fonts/inter-latin-900-normal.woff2?no-inline', import.meta.url),
    weight: '900',
    style: 'normal',
  },
  {
    family: TITLE_FAMILY,
    url: new URL('./fonts/inter-latin-600-normal.woff2?no-inline', import.meta.url),
    weight: '600',
    style: 'normal',
  },
]

/** The characters the Latin subsets cover, as @fontsource declares them. */
const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'

let registered: Promise<void> | null = null
/** How many faces have loaded on the page: each can change how wide text in it measures. */
let loaded = 0

/** How many of the bundled faces have loaded so far: text measured before the last did is measured again. */
export function fontGeneration(): number {
  return loaded
}

/**
 * Register the bundled faces on the page, once however many widgets there
 * are, and load them. Resolves once every face has loaded or failed: a face
 * that fails is left to the fallback fonts, as video-annotation does, and the
 * text drawn meanwhile is drawn in them. The canvas does not wait for fonts,
 * so a caller repaints when this resolves.
 */
export function ensureFonts(): Promise<void> {
  if (registered) return registered
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (typeof FontFace === 'undefined' || !fonts) return Promise.resolve()
  const loads = FACES.map(({ family, url, weight, style }) => {
    const face = new FontFace(family, `url("${url.href}") format("woff2")`, {
      weight,
      style,
      unicodeRange: LATIN_RANGE,
      display: 'swap',
    })
    fonts.add(face)
    return face.load().then(() => {
      loaded++
    })
  })
  registered = Promise.allSettled(loads).then(() => undefined)
  return registered
}
