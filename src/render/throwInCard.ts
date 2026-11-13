import type { Transform2D } from '../model/types.js'
import type { CardBox } from './eventBanner.js'
import { drawPulse } from './freeKick.js'
import { drawIconCard } from './labelCard.js'
import { designUnit } from './pitchGeometry.js'
import { DEFAULT_THEME, type RenderTheme } from './theme.js'
import { FRAME_W, worldToPx } from '../model/pitch.js'

/**
 * The card for a throw-in the camera cuts away from (Figma "Game Animation Visualizer",
 * viewport/eventThrowInExclusive, node 136:2310; director/throwIn.ts says when): "THROW IN" over
 * its icon on the label cards' band across the middle (banner 136:2337), the team under the band,
 * and a pulse on the touchline where the ball went out (pulse2Placeholder 136:2433, the free
 * kick's), as everyone on the pitch and the ball fade out (renderer.ts).
 */
export interface ThrowInCard {
  /** 0 to 1: how far it has faded in, or, leaving, how much of it is left. */
  intensity: number
  /** How far everyone on the pitch has faded out. */
  playersFade: number
  /** How far the ball has faded out. */
  ballFade: number
  /** Where the ball went out, on the touchline, in pitch metres; null with no ball to go by. */
  spot: { x: number; y: number } | null
  /** The name of the team taking it, as drawn, or null for none. */
  team: string | null
  /** 0 to 1 for each of the pulse's rings, from the middle out (cornerSections). */
  rings: readonly number[]
  /** Its icon, once loaded. Default the theme's. */
  icon?: CanvasImageSource | null
}

/** Either side of the title, as the label cards have it (the banner's 190 px padding). */
const PADDING_X_PX = 190

/**
 * The icon's drawing in its 208 px slot, as the design has it: inset 19.53% from the left and
 * 9.38% from the top, 123.5 by 156 (its SVG's box, icons.ts).
 */
const ICON_BOX: CardBox = { left: 208 * 0.1953, top: 208 * 0.0938, width: 123.5, height: 156 }

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))

/** Draw the card, centred on the pitch, in frame units through the context's current transform, in the theme's words and font. */
export function drawThrowInCard(ctx: CanvasRenderingContext2D, t: Transform2D, card: ThrowInCard, theme: RenderTheme = DEFAULT_THEME): void {
  const [cx] = worldToPx(0, 0, t)
  drawIconCard(
    ctx,
    t,
    cx,
    {
      title: theme.text.throwIn,
      font: theme.fonts.title,
      icon: card.icon ?? theme.icons.throwIn,
      iconBox: ICON_BOX,
      paddingXPx: PADDING_X_PX,
      maxWidthPx: FRAME_W / designUnit(t),
      team: card.team,
    },
    clamp01(card.intensity),
  )
}

/** Mark where the ball went out with the pulse, under the players. Nothing with no spot. */
export function drawThrowInPulse(ctx: CanvasRenderingContext2D, t: Transform2D, card: ThrowInCard): void {
  drawPulse(ctx, t, card.spot, card.rings, card.intensity)
}
