import type { Frame, Transform2D } from '../model/types.js'
import { labelCard, labelCardTextKey, type IconCardKey, type LabelCardKey } from '../model/labelCards.js'
import { frameHasAction } from '../analysis/actionLabels.js'
import { drawEventTitle, interBaselinePx, type CardBox, type TitleLayout } from './eventBanner.js'
import { fitText, measureWidth, wrapText } from './fitText.js'
import { designUnit } from './pitchGeometry.js'
import { drawSmallCard } from './smallCard.js'
import type { PitchDimensions } from '../model/types.js'
import { DEFAULT_THEME, type RenderTheme } from './theme.js'
import { THROW_IN_IN_MS, THROW_IN_REARM_S, THROW_IN_SHOW_MS } from './throwIn.js'
import { FRAME_W, worldToPx } from '../model/pitch.js'

/**
 * A label card (labelCards.ts in model), as the match-summary design shows it
 * (Figma "Game Animation Visualizer", viewport/eventVarCheck, banner 75:2246,
 * viewport/eventGoalDisallowed, banner 80:3853, and viewport/eventHalfTime,
 * banner 81:4327): a title over an icon or a short text on a dark band centred
 * on the pitch. The band hugs its title, so any card's words fit it; only the
 * words and what is under them change from card to card. Everyone on the pitch,
 * the ball and its trail fade out as it fades in, as for the corner, and back
 * as it goes (renderer.ts).
 */
export interface LabelCardIndicator {
  key: LabelCardKey
  /**
   * 0 to 1: how far it has faded in, or, leaving, how much of it is left. It is
   * also how far everyone on the pitch and the ball have faded out.
   */
  intensity: number
  /** Its icon, if it has one, once it has loaded. Until then it is drawn without it. Default the theme's. */
  icon?: CanvasImageSource | null
  /** For a card about a team (goalDisallowed): the team's name under the band, when its label names one. */
  team?: string
  /** For a card about a player (yellowCard, redCard): the team and the player under the band. */
  player?: LabelCardPlayer
  /** For the substitution card: the team and its substitutions under the band. */
  substitution?: LabelCardSubstitution
}

/**
 * Who a card is for, in the words drawn: the team's name, and the player's name or shirt number,
 * each null when the label does not say it, and the card's colour, for the small card before the
 * player.
 */
export interface LabelCardPlayer {
  team: string | null
  player: string | null
  color: string
}

/** A substitution on the card: the player going off and the one coming on, null for one not named; and how far it has faded in. */
export interface SubstitutionRow {
  out: string | null
  in: string | null
  intensity: number
}

/**
 * A substitution card's team and rows, oldest first. `rowsShown` is how many rows the card is
 * sized for, between whole numbers as it glides up for a row joining.
 */
export interface LabelCardSubstitution {
  team: string | null
  rows: SubstitutionRow[]
  rowsShown: number
}

/**
 * How a substitution card is shown: at least SUBSTITUTION_SHOW_MS from its last row joining, a row
 * fading in over SUBSTITUTION_ROW_IN_MS, the card gliding to its new height over
 * SUBSTITUTION_LIFT_MS, and at most SUBSTITUTION_MAX_ROWS rows.
 */
export const SUBSTITUTION_SHOW_MS = 5000
export const SUBSTITUTION_ROW_IN_MS = 400
export const SUBSTITUTION_LIFT_MS = 400
export const SUBSTITUTION_MAX_ROWS = 5

/**
 * How a small label card is shown: as the throw-in is (throwIn.ts), fading in
 * over SMALL_CARD_IN_MS, staying until SMALL_CARD_SHOW_MS from the start whatever
 * its label does, and fading out over LABEL_CARD_OUT_MS. It counts as a new one
 * after SMALL_CARD_REARM_S off, as fouls and the like come close together.
 */
export const SMALL_CARD_IN_MS = THROW_IN_IN_MS
export const SMALL_CARD_SHOW_MS = THROW_IN_SHOW_MS
export const SMALL_CARD_REARM_S = THROW_IN_REARM_S

/**
 * How a label card is shown: it fades in over LABEL_CARD_IN_MS, stays for at
 * least LABEL_CARD_SHOW_MS from the start and after that for as long as its
 * label is on, then fades out over LABEL_CARD_OUT_MS. Played by hand, it is
 * on screen for LABEL_CARD_DEMO_MS, fading in and out included. A card that
 * stays until the next label does so however it was played, for as long as
 * that takes, and then fades out over LABEL_CARD_OUT_MS.
 */
export const LABEL_CARD_IN_MS = 400
export const LABEL_CARD_SHOW_MS = 2000
export const LABEL_CARD_OUT_MS = 400
export const LABEL_CARD_DEMO_MS = 4000

/**
 * The label can flicker on and off over one event: it has to have been off
 * for this long, in seconds of replay time, before it counts as a new one.
 */
export const LABEL_CARD_REARM_S = 15

/** Whether a human labelled this frame with one of `names`, however the export writes it (actionName). */
export function isLabelCardFrame(frame: Frame, names: readonly string[]): boolean {
  return names.some((name) => frameHasAction(frame, name))
}

/**
 * The card's layout, in design pixels (designUnit), as the design's auto
 * layout has it: 190 either side of the title and 16 above it, below the icon
 * and between the two. The title is 92 px on a 128 px line; the icon's slot
 * is 208 px square, centred. A short text starts 16 px down in that slot: Inter
 * Semi Bold at 40 px on 48 px lines, wrapped to 480 px, each line centred, with
 * room for as many lines as fit above the card's foot.
 */
const PADDING_X_PX = 190
const PADDING_Y_PX = 16
const GAP_PX = 16
const TITLE_PX = 92
const TITLE_LINE_PX = 128
const ICON_SLOT_PX = 208
const SLOT_TOP_PX = PADDING_Y_PX + TITLE_LINE_PX + GAP_PX
const CARD_HEIGHT_PX = SLOT_TOP_PX + ICON_SLOT_PX + PADDING_Y_PX
const TEXT_TOP_PX = SLOT_TOP_PX + 16
const TEXT_PX = 40
const TEXT_LINE_PX = 48
const TEXT_WIDTH_PX = 480
const TEXT_MAX_LINES = Math.floor((CARD_HEIGHT_PX - TEXT_TOP_PX) / TEXT_LINE_PX)

/**
 * Where each card's icon goes in its slot, in design pixels from the slot's
 * top left corner, as its design places it. The VAR check's eye: inset 19.92%
 * from the top and 7.81% each side. The goal disallowed's struck-through goal:
 * centred, its 149.5 px inset 14.06% all round. The player cards' hand and card: the whole slot.
 */
const LABEL_CARD_ICON_BOXES: Record<IconCardKey, CardBox> = {
  varCheck: { left: 16.25, top: 41.436, width: 175.5, height: 94.25 },
  goalDisallowed: { left: 29.25, top: 29.25, width: 149.5, height: 149.5 },
  yellowCard: { left: 0, top: 0, width: 208, height: 208 },
  redCard: { left: 0, top: 0, width: 208, height: 208 },
  substitution: { left: 0, top: 0, width: 208, height: 208 },
}

const TITLE_BASELINE_PX = PADDING_Y_PX + interBaselinePx(TITLE_PX, TITLE_LINE_PX)

/**
 * The lines under a player card's band (Figma "Game Animation Visualizer", viewport/eventYellowCard
 * and eventRedCard), in design pixels from the band's foot: the team's name in Inter Black, 48 px,
 * its baseline 78.5 below; then the player row, Inter Semi Bold, 40 px, its baseline 168.55 below: a
 * small card 32 by 44 in the card's colour, its middle on the middle of the capitals, the text 37
 * after it, which puts its letters' ink 40 after it, as the design has them. Both white; the team
 * centred on the pitch, the row as a whole 6 right of the middle, as both of the design's frames
 * have it. The fonts and shadows are the design's; the places were measured from its frames.
 *
 * The team's line is where every frame that has one puts it, the corner's, the goal disallowed's,
 * the cards' and the substitutions': a 58 px line whose top is 32 below the band's foot (774 on
 * the 1100 px frame), which puts its baseline 78.5 below the foot, 270.5 below the pitch's middle.
 * The player's row, and a substitution card's first, is a 64 px box whose top is 122 below the
 * foot (864 on the frame), its 40 px text centred on a 64 px line: its baseline 168.55 below.
 */
const TEAM_PX = 48
const TEAM_BASELINE_PX = 78.5
const PLAYER_PX = 40
const ROW_TOP_PX = 122
const ROW_LINE_PX = 64
const PLAYER_BASELINE_PX = ROW_TOP_PX + interBaselinePx(PLAYER_PX, ROW_LINE_PX)
const SMALL_CARD_W_PX = 32
const SMALL_CARD_H_PX = 44
const SMALL_CARD_GAP_PX = 37
/** How far right of the pitch's middle the player row's middle is. */
const PLAYER_ROW_SHIFT_PX = 6
/** Inter's capitals are 1490 of its 2048 units high. */
const INTER_CAP_HEIGHT = 1490 / 2048
/** Each line's shadow: 0 2px 4px, black, at 50% under the team and 25% under the player. */
const LINE_SHADOW_Y_PX = 2
const LINE_SHADOW_BLUR_PX = 4
export const TEAM_SHADOW = 'rgba(0, 0, 0, 0.5)'
export const PLAYER_SHADOW = 'rgba(0, 0, 0, 0.25)'

/**
 * The substitution card's rows (Figma "Game Animation Visualizer", viewport/eventSubstitution), in
 * design pixels: each 72 below the one before (a 64 px line and 8 between), the first where the
 * player cards' player is. Two 56 px badges either side of the pitch's middle, 24 apart; the player
 * going off right-aligned 24 before the first, the one coming on left-aligned 24 after the second,
 * both in Inter Regular, lighter than the player cards' player (measured against the frames).
 * Measured from the design's frames. The card rises so the last row's baseline is at most
 * SUBSTITUTION_BELOW_TOUCHLINE_PX below the bottom touchline, as the 5-row frame
 * (viewport/eventSubstitutionMore) has it: its last row's box top at 989, its baseline 46.55 into
 * it, and the touchline's middle, where the pitch's edge is, at 1028.
 */
const SUBSTITUTION_ROW_STEP_PX = 72
const BADGE_PX = 56
const BADGE_GAP_PX = 24
const NAME_GAP_PX = 24
const SUBSTITUTION_BELOW_TOUCHLINE_PX = 989 + interBaselinePx(PLAYER_PX, ROW_LINE_PX) - 1028

/** The band's colour, and its opacity across it: clear at each end, solid at its middle. */
const BAND_RGB = '12, 63, 47'
const BAND_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.19712, 0.95],
  [0.5, 1],
  [0.80288, 0.95],
  [1, 0],
]

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))

/**
 * How far a substitution card with `rows` rows is raised, in design pixels, so its last row's
 * baseline stays at most SUBSTITUTION_BELOW_TOUCHLINE_PX below the bottom touchline: 0 while it
 * fits where every centre card sits. Never so far that the band leaves the top of the frame: on a
 * pitch narrow for its length the last row then goes a little further below the touchline.
 */
export function substitutionLiftPx(t: Transform2D, rows: number): number {
  if (rows <= 0) return 0
  const u = designUnit(t)
  const [, cy] = worldToPx(0, 0, t)
  const touchline = Math.max(worldToPx(0, t.pw / 2, t)[1], worldToPx(0, -t.pw / 2, t)[1])
  const lastBaseline = cy + (CARD_HEIGHT_PX / 2 + PLAYER_BASELINE_PX + SUBSTITUTION_ROW_STEP_PX * (rows - 1)) * u
  const toTop = cy / u - CARD_HEIGHT_PX / 2
  return Math.min(toTop, Math.max(0, (lastBaseline - touchline) / u - SUBSTITUTION_BELOW_TOUCHLINE_PX))
}

/** The lift for a card sized for `rowsShown` rows, between whole numbers as it glides. */
function liftFor(t: Transform2D, rowsShown: number): number {
  const below = Math.floor(rowsShown)
  const k = rowsShown - below
  const from = substitutionLiftPx(t, below)
  return k === 0 ? from : from + (substitutionLiftPx(t, below + 1) - from) * k
}

/**
 * Draw a label card over everything else on the pitch, in frame units through
 * the context's current transform, in the theme's words, fonts and icon. The
 * band is never wider than the frame: a title too long for that is shrunk to
 * fit (drawEventTitle).
 */
export function drawLabelCard(
  ctx: CanvasRenderingContext2D,
  t: Transform2D,
  card: LabelCardIndicator,
  theme: RenderTheme = DEFAULT_THEME,
): void {
  const alpha = clamp01(card.intensity)
  if (alpha <= 0) return
  const u = designUnit(t)
  const title = theme.text[card.key]
  const font = theme.fonts.title
  const titleWidthPx = measureWidth(ctx, title, `italic 900 ${TITLE_PX * u}px ${font}`) / u
  const spec = labelCard(card.key)
  const contentPx = Math.max(titleWidthPx, spec.below === 'icon' ? ICON_SLOT_PX : TEXT_WIDTH_PX)
  const widthPx = Math.min(FRAME_W / u, contentPx + 2 * PADDING_X_PX)
  const [cx, cy] = worldToPx(0, 0, t)
  const left = cx - (widthPx / 2) * u
  const lift = card.substitution ? liftFor(t, card.substitution.rowsShown) : 0
  const top = cy - (CARD_HEIGHT_PX / 2 + lift) * u
  const width = widthPx * u

  ctx.save()
  ctx.globalAlpha = alpha
  fillBand(ctx, left, top, width, CARD_HEIGHT_PX * u)
  const layout: TitleLayout = { word: null, leftPx: 0, centrePx: widthPx / 2, bandWidthPx: widthPx, insetPx: PADDING_X_PX }
  drawEventTitle(ctx, t, title, left, top + TITLE_BASELINE_PX * u, TITLE_PX, layout, font)
  if (spec.below === 'icon') {
    const icon = card.icon ?? theme.icons[spec.key]
    if (icon) {
      const box = LABEL_CARD_ICON_BOXES[spec.key]
      const slotLeft = cx - (ICON_SLOT_PX / 2) * u
      const slotTop = top + SLOT_TOP_PX * u
      ctx.drawImage(icon, slotLeft + box.left * u, slotTop + box.top * u, box.width * u, box.height * u)
    }
  } else if (spec.below === 'text') {
    const textFont = `600 ${TEXT_PX * u}px ${font}`
    const text = theme.text[labelCardTextKey(spec.key)]
    ctx.font = textFont
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#ffffff'
    wrapText(ctx, text, textFont, TEXT_WIDTH_PX * u, TEXT_MAX_LINES).forEach((line, i) => {
      ctx.fillText(line, cx, top + (TEXT_TOP_PX + i * TEXT_LINE_PX + interBaselinePx(TEXT_PX, TEXT_LINE_PX)) * u)
    })
  }
  if (card.team) drawTeamUnderBand(ctx, card.team, cx, top + (CARD_HEIGHT_PX / 2) * u, u, font)
  if (card.player) drawPlayerLines(ctx, card.player, cx, top + CARD_HEIGHT_PX * u, u, font)
  if (card.substitution) drawSubstitutionLines(ctx, card.substitution, cx, top + CARD_HEIGHT_PX * u, u, font, theme.icons)
  ctx.restore()
}

/** A card's band, clear at each end and solid at its middle, at the context's alpha. */
function fillBand(ctx: CanvasRenderingContext2D, left: number, top: number, width: number, height: number): void {
  const band = ctx.createLinearGradient(left, 0, left + width, 0)
  for (const [at, opacity] of BAND_STOPS) band.addColorStop(at, `rgba(${BAND_RGB}, ${opacity})`)
  ctx.fillStyle = band
  ctx.fillRect(left, top, width, height)
}

/** A card laid out as a label card with an icon is, for a moment of its own (the free kick's, freeKick.ts). */
export interface IconCard {
  title: string
  /** The title's and the team's family list. */
  font: string
  /** Its icon once loaded; until then it is drawn without it. */
  icon: CanvasImageSource | null | undefined
  /** Where the icon's drawing goes in its 208 px slot, in design pixels from the slot's top left corner. */
  iconBox: CardBox
  /** Either side of the title, in design pixels. */
  paddingXPx: number
  /** The widest the band may be, in design pixels: a title too long for it is shrunk to fit. */
  maxWidthPx: number
  /** The team's name under the band, or nothing. */
  team: string | null | undefined
}

/**
 * Draw `card` centred on `cx` and on the pitch's middle, at `alpha`, in frame units through the
 * context's current transform: the band, the title over the icon, and the team under the band,
 * as a label card lays them out. The team is no wider than the band.
 */
export function drawIconCard(ctx: CanvasRenderingContext2D, t: Transform2D, cx: number, card: IconCard, alpha: number): void {
  if (alpha <= 0) return
  const u = designUnit(t)
  const titleWidthPx = measureWidth(ctx, card.title, `italic 900 ${TITLE_PX * u}px ${card.font}`) / u
  const widthPx = Math.min(card.maxWidthPx, Math.max(titleWidthPx, ICON_SLOT_PX) + 2 * card.paddingXPx)
  const [, cy] = worldToPx(0, 0, t)
  const left = cx - (widthPx / 2) * u
  const top = cy - (CARD_HEIGHT_PX / 2) * u
  ctx.save()
  ctx.globalAlpha = alpha
  fillBand(ctx, left, top, widthPx * u, CARD_HEIGHT_PX * u)
  const layout: TitleLayout = { word: null, leftPx: 0, centrePx: widthPx / 2, bandWidthPx: widthPx, insetPx: card.paddingXPx }
  drawEventTitle(ctx, t, card.title, left, top + TITLE_BASELINE_PX * u, TITLE_PX, layout, card.font)
  if (card.icon) {
    const box = card.iconBox
    const slotLeft = cx - (ICON_SLOT_PX / 2) * u
    ctx.drawImage(card.icon, slotLeft + box.left * u, top + (SLOT_TOP_PX + box.top) * u, box.width * u, box.height * u)
  }
  if (card.team) drawTeamUnderBand(ctx, card.team, cx, cy, u, card.font, widthPx * u)
  ctx.restore()
}

/** The lines' shadow geometry, in the bitmap's pixels whatever the transform, and their white, on the baseline. */
export function setLineShadow(ctx: CanvasRenderingContext2D, u: number): void {
  const scale = ctx.getTransform().a * u
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = LINE_SHADOW_Y_PX * scale
  ctx.shadowBlur = LINE_SHADOW_BLUR_PX * scale
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
}

/**
 * The team's name under a centre card, the card centred on `cy`, with its shadow, and nothing
 * else, centred on `cx`: where a label card's goes, whatever the card's own band (the corner's,
 * corner.ts, is the reference's, a little shorter).
 */
export function drawTeamUnderBand(
  ctx: CanvasRenderingContext2D,
  name: string,
  cx: number,
  cy: number,
  u: number,
  family: string,
  maxWidth = FRAME_W - 2 * PADDING_X_PX * u,
): void {
  setLineShadow(ctx, u)
  drawTeamLine(ctx, name, cx, cy + (CARD_HEIGHT_PX / 2) * u, u, family, maxWidth)
  ctx.shadowColor = 'transparent'
}

/**
 * The team's name under a card's band, whose foot is at `foot`, centred on `cx`, at most `maxWidth`
 * wide: a longer one is drawn smaller, then cut short (fitText). Nothing for no team.
 */
function drawTeamLine(
  ctx: CanvasRenderingContext2D,
  name: string | null,
  cx: number,
  foot: number,
  u: number,
  family: string,
  maxWidth = FRAME_W - 2 * PADDING_X_PX * u,
): void {
  if (name === null) return
  const teamFont = (px: number) => `900 ${px}px ${family}`
  const team = fitText(ctx, name, teamFont, TEAM_PX * u, maxWidth)
  ctx.font = teamFont(team.px)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = TEAM_SHADOW
  ctx.fillText(team.text, cx, foot + TEAM_BASELINE_PX * u)
}

/**
 * The team and a substitution card's rows under its band, whose foot is at `foot`, each row at its
 * own strength. Each name is at most as wide as the frame less the band's padding allows on its
 * side: a longer one is drawn smaller, then cut short (fitText). A side not named shows its badge
 * alone; a row with neither player is left out, and takes no place. A badge is drawn once its image
 * has loaded.
 */
function drawSubstitutionLines(
  ctx: CanvasRenderingContext2D,
  sub: LabelCardSubstitution,
  cx: number,
  foot: number,
  u: number,
  family: string,
  icons: RenderTheme['icons'],
): void {
  setLineShadow(ctx, u)
  drawTeamLine(ctx, sub.team, cx, foot, u, family)
  const nameFont = (px: number) => `400 ${px}px ${family}`
  const inner = (BADGE_GAP_PX / 2) * u
  const nameEdge = (BADGE_GAP_PX / 2 + BADGE_PX + NAME_GAP_PX) * u
  const maxName = FRAME_W / 2 - PADDING_X_PX * u - nameEdge
  const alpha = ctx.globalAlpha
  // A row that names no one takes no place: the next one is laid out where it would have been.
  sub.rows.filter((row) => row.out !== null || row.in !== null).forEach((row, i) => {
    const baseline = foot + (PLAYER_BASELINE_PX + SUBSTITUTION_ROW_STEP_PX * i) * u
    const badgeTop = baseline - (INTER_CAP_HEIGHT * PLAYER_PX * u) / 2 - (BADGE_PX / 2) * u
    ctx.globalAlpha = alpha * clamp01(row.intensity)
    ctx.shadowColor = 'transparent'
    if (icons.substitutionOut) ctx.drawImage(icons.substitutionOut, cx - inner - BADGE_PX * u, badgeTop, BADGE_PX * u, BADGE_PX * u)
    if (icons.substitutionIn) ctx.drawImage(icons.substitutionIn, cx + inner, badgeTop, BADGE_PX * u, BADGE_PX * u)
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = PLAYER_SHADOW
    for (const [name, align, x] of [
      [row.out, 'right', cx - nameEdge],
      [row.in, 'left', cx + nameEdge],
    ] as const) {
      if (name === null) continue
      const fit = fitText(ctx, name, nameFont, PLAYER_PX * u, maxName)
      ctx.font = nameFont(fit.px)
      ctx.textAlign = align
      ctx.fillText(fit.text, x, baseline)
    }
  })
  ctx.globalAlpha = alpha
  ctx.shadowColor = 'transparent'
}

/**
 * The team and the player under a card's band, whose foot is at `foot`, centred on `cx`. Each line
 * is at most as wide as the frame less the band's padding either side: a longer one is drawn
 * smaller, then cut short (fitText).
 */
function drawPlayerLines(
  ctx: CanvasRenderingContext2D,
  player: LabelCardPlayer,
  cx: number,
  foot: number,
  u: number,
  family: string,
): void {
  const maxWidth = FRAME_W - 2 * PADDING_X_PX * u
  setLineShadow(ctx, u)
  drawTeamLine(ctx, player.team, cx, foot, u, family)
  if (player.player !== null) {
    const nameFont = (px: number) => `600 ${px}px ${family}`
    const lead = (SMALL_CARD_W_PX + SMALL_CARD_GAP_PX) * u
    // The row sits right of the middle: it keeps clear of the frame's right edge as of its left.
    const name = fitText(ctx, player.player, nameFont, PLAYER_PX * u, maxWidth - lead - 2 * PLAYER_ROW_SHIFT_PX * u)
    const nameWidth = measureWidth(ctx, name.text, nameFont(name.px))
    const left = cx + PLAYER_ROW_SHIFT_PX * u - (lead + nameWidth) / 2
    const baseline = foot + PLAYER_BASELINE_PX * u
    const capMiddle = baseline - (INTER_CAP_HEIGHT * PLAYER_PX * u) / 2
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = player.color
    ctx.fillRect(left, capMiddle - (SMALL_CARD_H_PX / 2) * u, SMALL_CARD_W_PX * u, SMALL_CARD_H_PX * u)
    ctx.font = nameFont(name.px)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = PLAYER_SHADOW
    ctx.fillText(name.text, left + lead, baseline)
  }
  ctx.shadowColor = 'transparent'
}

/** Draw a small label card, in the theme's words and font (smallCard.ts). */
export function drawSmallLabelCard(
  ctx: CanvasRenderingContext2D,
  pd: Partial<PitchDimensions> | undefined,
  t: Transform2D,
  card: LabelCardIndicator,
  theme: RenderTheme = DEFAULT_THEME,
): void {
  drawSmallCard(ctx, pd, t, theme.text[card.key], theme.fonts.title, clamp01(card.intensity))
}
