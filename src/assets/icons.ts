import { ICON_CARD_KEYS, iconCardRecord, type IconCardKey } from '../model/labelCards.js'

/**
 * The event cards' icons, loaded from data URLs, so loading them makes no
 * request. The corner's is the widget's own, as the reference has no
 * corner (CORNER_SVG). The label cards' are their designs' (LABEL_CARD_ICONS).
 * The reference's goal card and its goal-net icon are drawn only by the parity
 * test, which brings the card no icon, and the reference's free kick card is not
 * shown, so neither icon is loaded.
 */
/**
 * The corner's icon, drawn for the widget in the style of video-annotation's
 * goal-net icon (src/assets/goal-net.svg at 6f14d1f): the corner of the pitch in
 * its line colour, its arc, and that icon's ball (its first path, moved and
 * scaled) in its gold. Its box is the one
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

/**
 * The VAR check card's eye, as Figma exports it for viewport/eventVarCheck
 * (node 75:2219), copied byte for byte. The design's mask on it is its whole
 * 208 px slot, which clips nothing, and is left out.
 */
const VAR_CHECK_SVG = `<svg preserveAspectRatio="none" overflow="visible" style="display: block;" width="175.5" height="94.25" viewBox="0 0 175.5 94.25" fill="none" xmlns="http://www.w3.org/2000/svg">
<g id="Group">
<path id="Vector" d="M171.635 42.8932C170.129 41.3647 144.677 5.34371 93.2721 0.146901C92.9207 0.146901 92.6194 0.197794 92.268 0.248743C89.256 -0.107901 86.1938 -0.0569514 83.1316 0.248743C82.8304 0.248743 82.5291 0.146901 82.2279 0.146901C30.8229 5.34371 5.32117 41.3647 3.86536 42.8932L0 46.8672L4.26697 50.3827C6.52599 52.2169 47.4894 94.25 84.0854 94.25C84.989 94.25 85.8926 94.199 86.7962 94.148C86.9468 94.148 87.1476 94.148 87.2982 94.148C87.6496 94.148 88.001 94.1481 88.4026 94.0972C89.4066 94.1481 90.4106 94.25 91.4146 94.25C128.011 94.25 169.024 52.2678 171.233 50.3827L175.5 46.8672L171.635 42.8932ZM117.569 67.5527C113.553 73.6666 107.931 78.3538 101.254 81.156C94.5772 83.9582 87.2982 84.6715 80.22 83.245C73.1417 81.8184 66.7161 78.3028 61.5956 73.157C56.4752 68.0111 53.0616 61.4387 51.656 54.2549C50.2504 47.071 50.9532 39.6834 53.7142 32.9072C56.4753 26.1309 61.0937 20.4246 67.1177 16.3487C73.1417 12.2728 80.1196 10.1329 87.3484 10.1329C97.0872 10.1329 106.224 13.9541 113.101 20.9341C119.979 27.9141 123.744 37.1869 123.744 47.071C123.744 54.4077 121.635 61.4896 117.619 67.6035L117.569 67.5527ZM50.5014 18.3866C46.1842 24.0929 43.1722 30.7164 41.7666 37.8492C39.9594 47.0201 40.863 56.4457 44.4272 65.0561C45.7826 68.3168 47.5396 71.3229 49.4974 74.176C30.823 65.158 23.2929 52.3188 15.2107 46.103C22.4897 39.7343 28.6643 26.9462 50.5014 18.3358V18.3866ZM124.798 74.7874C130.571 66.7884 133.733 57.159 133.733 47.071C133.733 37.6964 131.023 28.6785 125.902 20.8832C125.199 19.8133 124.396 18.8962 123.593 17.8773C146.133 26.4877 152.86 39.6325 160.289 46.154C152.057 52.4717 143.874 65.7694 124.798 74.7874Z" fill="#E2E8F0"/>
<path id="Vector_2" d="M87.75 55.25C93.1369 55.25 97.5 50.8869 97.5 45.5C97.5 40.1131 93.1369 35.75 87.75 35.75C82.3631 35.75 78 40.1131 78 45.5C78 50.8869 82.3631 55.25 87.75 55.25Z" fill="#E2E8F0"/>
</g>
</svg>
`

/**
 * The goal disallowed card's struck-through goal, as Figma exports it for
 * viewport/eventGoalDisallowed (node 80:3826), copied byte for byte.
 */
const GOAL_DISALLOWED_SVG = `<svg preserveAspectRatio="none" overflow="visible" style="display: block;" width="149.5" height="149.5" viewBox="0 0 149.5 149.5" fill="none" xmlns="http://www.w3.org/2000/svg">
<g id="Group">
<path id="Vector" d="M25.675 101.4V54.925C25.675 53.3 26.9751 52 28.6001 52H121.225C122.85 52 124.15 53.3 124.15 54.925V101.4H128.7V54.925C128.7 51.025 125.45 47.775 121.55 47.775H28.925C25.025 47.775 21.775 51.025 21.775 54.925V101.4H26.3251H25.675Z" fill="#E2E8F0"/>
<path id="Vector_2" d="M37.7001 97.175V63.7V62.7455L37.1839 61.9425L28.4089 48.2925L22.9412 51.8075L31.2001 64.6546V97.175H37.7001Z" fill="#E2E8F0"/>
<path id="Vector_3" d="M111.8 97.175V63.7V62.7455L112.316 61.9425L121.091 48.2925L126.559 51.8075L118.3 64.6546V97.175H111.8Z" fill="#E2E8F0"/>
<path id="Vector_4" d="M51.35 50.05V97.175H44.85V50.05H51.35Z" fill="#E2E8F0"/>
<path id="Vector_5" d="M64.6751 50.05V97.175H58.1751V50.05H64.6751Z" fill="#E2E8F0"/>
<path id="Vector_6" d="M78 50.05V97.175H71.5V50.05H78Z" fill="#E2E8F0"/>
<path id="Vector_7" d="M91.3249 50.05V97.175H84.8249V50.05H91.3249Z" fill="#E2E8F0"/>
<path id="Vector_8" d="M104.65 50.05V97.175H98.15V50.05H104.65Z" fill="#E2E8F0"/>
<path id="Vector_9" d="M29.9 84.825H119.6V91.325H29.9V84.825Z" fill="#E2E8F0"/>
<path id="Vector_10" d="M29.9 71.5H119.6V78H29.9V71.5Z" fill="#E2E8F0"/>
<path id="Vector_11" d="M32.1751 58.175H117.325V64.675H32.1751V58.175Z" fill="#E2E8F0"/>
<path id="Vector_12" d="M74.75 105.625C90.0055 105.625 102.375 93.2555 102.375 78C102.375 62.7445 90.0055 50.375 74.75 50.375C59.4945 50.375 47.125 62.7445 47.125 78C47.125 93.2555 59.4945 105.625 74.75 105.625Z" fill="#0D3F30"/>
<path id="Vector_13" d="M92.3001 69.55C96.8501 79.3 92.6251 91 82.8751 95.55C73.1251 100.1 61.4251 95.875 56.8751 86.125C52.3251 76.375 56.5501 64.675 66.3001 60.125C76.0501 55.575 87.7501 59.8 92.3001 69.55ZM89.0501 71.175L88.0751 73.775L81.5751 71.825L79.9501 65.325L82.5501 64.35C79.6251 62.725 76.3751 62.075 72.8001 62.4L74.7501 64.35L70.8501 69.875H64.0251C64.0251 69.55 64.0251 66.625 64.0251 66.625C61.4251 68.9 59.8001 71.825 59.1501 75.075L61.4251 73.775L65.3251 79.3L62.7251 85.475L60.1251 84.825C61.4251 88.075 64.0251 90.35 66.9501 91.975L66.3001 89.375L72.8001 87.1L78.0001 91.325L76.3751 93.6C79.6251 93.275 82.8751 91.65 85.1501 89.375H82.5501V82.225L88.4001 78.65L90.0251 80.925C90.6751 77.675 90.0251 74.425 88.7251 71.175H89.0501ZM73.7751 84.5L68.5751 78.975L72.1501 72.475L79.6251 73.775L80.6001 81.25L73.7751 84.5Z" fill="#E2E8F0"/>
<path id="Vector_14" d="M21.7861 23.6683C23.0738 22.4179 25.1314 22.4482 26.3818 23.736L124.207 124.486C125.457 125.774 125.427 127.831 124.139 129.082C122.851 130.332 120.794 130.302 119.543 129.014L21.7184 28.264C20.468 26.9763 20.4983 24.9187 21.7861 23.6683Z" fill="#E2E8F0"/>
<path id="Vector_15" d="M149.5 74.75C149.5 95.1578 140.955 114.257 127.606 127.606C114.257 140.955 95.1578 149.5 74.75 149.5C54.3422 149.5 35.2427 140.955 21.8941 127.606C8.54546 114.257 0 95.1578 0 74.75C0 54.3422 8.54546 35.2427 21.8941 21.8941C35.2427 8.54546 54.3422 0 74.75 0C95.1578 0 114.257 8.54546 127.606 21.8941C140.955 35.2427 149.5 54.3422 149.5 74.75ZM123.01 26.4903C110.48 13.9608 93.8297 6.5 74.75 6.5C55.6703 6.5 39.0198 13.9608 26.4903 26.4903C13.9608 39.0198 6.5 55.6703 6.5 74.75C6.5 93.8297 13.9608 110.48 26.4903 123.01C39.0198 135.539 55.6703 143 74.75 143C93.8297 143 110.48 135.539 123.01 123.01C135.539 110.48 143 93.8297 143 74.75C143 55.6703 135.539 39.0198 123.01 26.4903Z" fill="#E2E8F0"/>
</g>
</svg>
`

/** Each label card's icon. Where it goes on the card is LABEL_CARD_ICON_BOXES (labelCard.ts in render). */
const LABEL_CARD_ICONS: Record<IconCardKey, string> = {
  varCheck: VAR_CHECK_SVG,
  goalDisallowed: GOAL_DISALLOWED_SVG,
}

const dataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

export type CardIcons = { corner: HTMLImageElement | null } & Record<
  IconCardKey,
  HTMLImageElement | null
>

/** No icon loaded yet: every card is drawn without its own. */
export const NO_ICONS: CardIcons = { corner: null, ...iconCardRecord(() => null) }

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
  if (typeof Image === 'undefined') return Promise.resolve(NO_ICONS)
  loading ??= Promise.all([load(CORNER_SVG), ...ICON_CARD_KEYS.map((key) => load(LABEL_CARD_ICONS[key]))]).then(
    ([corner, ...cards]) => ({
      corner: corner ?? null,
      ...iconCardRecord((key) => cards[ICON_CARD_KEYS.indexOf(key)] ?? null),
    }),
  )
  return loading
}
