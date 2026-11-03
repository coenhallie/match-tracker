/**
 * The event cards' icons, loaded from data URLs, so the widget fetches nothing
 * from the host. The goal's is video-annotation's src/assets/goal-net.svg at
 * 6f14d1f, copied byte for byte. The corner's is the widget's own, as the
 * reference has no corner (CORNER_SVG). The reference's free kick card, and
 * its icon, are not shown.
 */
const GOAL_SVG = `<svg preserveAspectRatio="none" overflow="visible" style="display: block;" width="46.9868" height="44.9362" viewBox="0 0 46.9868 44.9362" fill="none" xmlns="http://www.w3.org/2000/svg">
<g id="shot_on_goal">
<path id="Vector" d="M42.7302 15.4362C41.5302 19.9362 36.8302 22.6361 32.2302 21.3362C27.6302 20.0362 25.0302 15.4362 26.3302 10.9362C27.6302 6.43615 32.2302 3.73615 36.8302 5.03615C41.4302 6.33615 44.0302 10.9362 42.7302 15.4362ZM41.1302 15.0362L40.0302 15.5362L38.5302 13.0362L39.8302 10.4362L40.9302 10.8362C40.4302 9.43615 39.5302 8.33615 38.2302 7.53615L38.4302 8.73615L35.6302 9.43615L33.5302 7.43615L34.2302 6.53615C32.7302 6.53615 31.3302 7.13615 30.2302 8.03615L31.4302 8.23615L31.2302 11.1362L28.6302 12.5362L27.9302 11.5362C27.5302 12.9362 27.6302 14.4362 28.1302 15.8362L28.7302 14.8362L31.4302 15.9362L31.9302 18.8362L30.7302 19.1362C31.9302 19.9362 33.4302 20.3362 34.8302 20.2362L34.0302 19.3362L35.9302 17.1362L38.8302 17.5362V18.7362C39.9302 17.8362 40.7302 16.6362 41.1302 15.2362V15.0362ZM32.3302 15.0362L32.1302 11.7362L35.2302 10.5362L37.3302 13.1362L35.5302 15.9362L32.3302 15.0362Z" fill="#FDE047"/>
<path id="Vector_2" d="M1.13022 1.03615C1.13022 1.03615 32.8302 2.03615 34.9302 2.03615C37.0302 2.03615 43.1302 3.03615 45.1302 8.13615C47.1302 13.2362 45.1302 16.7362 44.1302 18.3362C43.1302 19.9362 17.5302 43.9362 17.5302 43.9362H6.23022L1.13022 1.03615Z" stroke-width="2" stroke-miterlimit="10" stroke="#E2E8F0"/>
<path id="Vector_3" d="M4.13022 26.0362L45.1302 12.0362" stroke-width="2" stroke-miterlimit="10" stroke-linecap="round" stroke="#E2E8F0"/>
<path id="Vector_4" d="M3.13022 13.0362L42.1302 5.03615" stroke-width="2" stroke-miterlimit="10" stroke="#E2E8F0"/>
<path id="Vector_5" d="M5.13022 39.0362L35.1302 27.0362" stroke-width="2" stroke-miterlimit="10" stroke="#E2E8F0"/>
<path id="Vector_6" d="M27.1302 2.03615C27.1302 2.03615 33.1302 6.03615 35.1302 9.03615C37.1302 12.0362 37.1302 15.0362 36.1302 18.0362C35.2302 20.7362 35.1302 27.0362 35.1302 27.0362" stroke-width="2" stroke-miterlimit="10" stroke-linecap="round" stroke="#E2E8F0"/>
<path id="Vector_7" d="M13.1302 2.03615C13.1302 2.03615 18.1302 7.03615 19.1302 15.0362C19.8302 21.0362 19.1302 28.0362 18.1302 32.0362C17.1302 36.0362 18.1302 43.0362 18.1302 43.0362" stroke-width="2" stroke-miterlimit="10" stroke-linecap="round" stroke="#E2E8F0"/>
</g>
</svg>
`

/**
 * The corner's icon, drawn for the widget in the goal icon's style: the
 * corner of the pitch in its line colour, its arc, and the goal icon's ball
 * (GOAL_SVG's first path, moved and scaled) in its gold. Its box is the one
 * the reference's free kick icon had, 45.5 by 40.95, which the card's icon
 * slot is laid out for (corner.ts in render).
 */
const CORNER_SVG = `<svg preserveAspectRatio="none" overflow="visible" style="display: block;" width="45.5" height="40.95" viewBox="0 0 45.5 40.95" fill="none" xmlns="http://www.w3.org/2000/svg">
<g id="corner">
<path id="Lines" d="M2 1.5V39.45H43.5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke="#E2E8F0"/>
<path id="Arc" d="M2 14.45A25 25 0 0 1 27 39.45" stroke-width="1" stroke="#E2E8F0"/>
<path id="Ball" transform="translate(12.8 29.6) scale(0.7) translate(-34.53 -13.19)" d="M42.7302 15.4362C41.5302 19.9362 36.8302 22.6361 32.2302 21.3362C27.6302 20.0362 25.0302 15.4362 26.3302 10.9362C27.6302 6.43615 32.2302 3.73615 36.8302 5.03615C41.4302 6.33615 44.0302 10.9362 42.7302 15.4362ZM41.1302 15.0362L40.0302 15.5362L38.5302 13.0362L39.8302 10.4362L40.9302 10.8362C40.4302 9.43615 39.5302 8.33615 38.2302 7.53615L38.4302 8.73615L35.6302 9.43615L33.5302 7.43615L34.2302 6.53615C32.7302 6.53615 31.3302 7.13615 30.2302 8.03615L31.4302 8.23615L31.2302 11.1362L28.6302 12.5362L27.9302 11.5362C27.5302 12.9362 27.6302 14.4362 28.1302 15.8362L28.7302 14.8362L31.4302 15.9362L31.9302 18.8362L30.7302 19.1362C31.9302 19.9362 33.4302 20.3362 34.8302 20.2362L34.0302 19.3362L35.9302 17.1362L38.8302 17.5362V18.7362C39.9302 17.8362 40.7302 16.6362 41.1302 15.2362V15.0362ZM32.3302 15.0362L32.1302 11.7362L35.2302 10.5362L37.3302 13.1362L35.5302 15.9362L32.3302 15.0362Z" fill="#FDE047"/>
</g>
</svg>
`

const dataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

export interface CardIcons {
  goal: HTMLImageElement | null
  corner: HTMLImageElement | null
}

let loading: Promise<CardIcons> | null = null

/** One image, or null if it fails to load. */
function load(svg: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image), { once: true })
    image.addEventListener('error', () => resolve(null), { once: true })
    image.src = dataUrl(svg)
  })
}

/**
 * Load every icon, once for the page. An icon that fails to load is null, and
 * its card is drawn without it, as video-annotation draws it until it loads.
 */
export function loadIcons(): Promise<CardIcons> {
  if (typeof Image === 'undefined') return Promise.resolve({ goal: null, corner: null })
  loading ??= Promise.all([load(GOAL_SVG), load(CORNER_SVG)]).then(([goal, corner]) => ({ goal, corner }))
  return loading
}
