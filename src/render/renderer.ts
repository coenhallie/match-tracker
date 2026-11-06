// Vendored from datalabelling-frontend/src/lib/vis/ on 2026-08-22. Keep edits
// minimal so the two copies stay diffable. Deliberate differences from the
// vendored copy:
//  1. This copy is ported from video-annotation (src/lib/vis/useRenderer2D.ts at
//     6f14d1f), with the function renamed from useRenderer2D to createRenderer.
//     The differences below are that file's own, from datalabelling-frontend.
//  2. The unused frameCount parameter of draw2DOverlay is named _frameCount, because
//     noUnusedParameters is on here. The signature and the call are unchanged.
//  3. Theming and text fitting (theme.ts, fitText.ts). createRenderer takes a
//     RenderTheme, and setTheme swaps it: the people's colours, the words on
//     the canvas ("GOAL", "CORNER", "THROW IN", "Attack"), the
//     fonts they are written in, the cards' icons when a layer brings none, and
//     formatAction for the bottom-left action text. DEFAULT_THEME draws what
//     the reference draws, in the bundled faces' private family names
//     ("MatchTracker Montserrat", "MatchTracker Inter") with a CJK fallback
//     after each. Every card title, the attack's word and the team's name
//     shrink to fit their card (fitFontPx), to no less than 60% of their
//     size. At the reference's sizes every English word fits, so nothing
//     shrinks. A team name is shrunk as the reference shrinks it, but where
//     the reference has no floor, a name still too long at 60% is cut short
//     with a trailing "…" (fitText). A card's title is drawn exactly where the
//     reference draws it when it is the design's English word; any other
//     title, a translation or an override, is centred on the middle of that
//     word, as the design centres it (TitleLayout, eventBanner.ts).
//  - the unused FRAME_W import was dropped, because it lints as an error here.
//  - draw2DOverlay no longer draws the frame-count label. It is drawn onto the
//    canvas bitmap, which is zoomed and panned, so the label slid off-screen
//    under zoom. PipelineOutputSurface.vue draws its own fixed frame label.
//  - zoom/pan is applied here via setView() rather than as a CSS transform on
//    the canvas element. The element has to stay unscaled so a drawing layer
//    can share its coordinate system; see viewTransform.ts.
//  - the canvas bitmap is whatever size the surface gives it - one pixel per
//    device pixel - and drawing is scaled from frame units into it. The pitch
//    cache is built at that size through the current view, and rebuilt when
//    either changes, instead of once at 1280x720 and then magnified.
//  - players are coloured by role from fixed colours (constants.ts,
//    PERSON_COLORS): home red, away blue, goalkeepers yellow ringed in their
//    team's colour, officials black. The vendored copy coloured each team
//    from the kit colours the pipeline detected; that resolver is gone.
//  - players further than FOCUS_METRES from the ball are faded
//    (DIMMED_PLAYER_ALPHA) and drawn underneath the rest, and while a team has
//    the ball the carrier and their teammates within NEARBY_METRES are
//    outlined in white.
//  - goals (posts and a faint net) are drawn on every frame, and renderFrame
//    takes an optional goal-sequence overlay whose ball replaces the tracked
//    one (goalNets.ts, goalSequence.ts), and an optional attack indicator:
//    the pitch shaded behind the attack, with a label, under the players,
//    everyone faded out, and a pulsing ring round the ball (attackIndicator.ts).
//  - the reference's free kick banner is gone: the widget does not show the
//    free kick.
//  - renderFrame takes an optional throw-in indicator along the bottom
//    touchline, fading in where it stands, or as its inPlace says sliding in
//    as the reference's does (throwIn.ts), and the goal's card over the goal
//    sequence, fixed to the frame (goalBanner.ts).
//  - renderFrame takes an optional corner, which the reference does not have:
//    the corner it is taken from lit up as a cone under the players, and a
//    card like the reference's free kick card over everything, everyone and
//    the ball faded out (corner.ts).
//  - renderFrame takes an optional label card, which the reference does not
//    have: a title over an icon across the middle of the pitch (labelCard.ts).
//  - renderFrame takes an optional ball trail, drawn over the players: the
//    path the tracked ball took, with a dot wherever it turned (ballTrail.ts).
//  - players are not labelled with their tracking id: it is the tracker's
//    bookkeeping, not anything about the player. Their shirt number is drawn
//    only on the player with the ball, with the possession ring, and that
//    player is drawn bigger (CARRIER_GROWTH).
//  - the ball is drawn as a football, of radius BALL_RADIUS rather than 4 px, and
//    renderFrame takes how it is turned, for a caller that rolls it
//    (football.ts).

// ---------------------------------------------------------------------------
// 2D canvas rendering composable.
// Ported from render2DFrame(), draw2DPlayer(), draw2DBall(), draw2DOverlay()
// in the original index.html (lines 552-631).
//
// Usage:
//   const { renderFrame, invalidateCache } = createRenderer(canvas)
// ---------------------------------------------------------------------------

import type { Player, Ball, Frame, FrameAction, Transform2D } from '../model/types.js'
import { isHumanLabel } from '../analysis/actionLabels.js'
import {
  FRAME_W,
  FRAME_H,
  PLAYER_RADIUS,
  CARRIER_GROWTH,
  BALL_RADIUS,
  DIMMED_PLAYER_ALPHA,
  FOCUS_METRES,
  NEARBY_OUTLINE,
  NEARBY_METRES,
} from './constants.js'
import { build2DTransform, worldToPx, buildPitchCache, fillGrass, PITCH_LINE_ALPHA } from './pitchGeometry.js'
import { drawGoalNets, type NetBulge } from './goalNets.js'
import {
  ballRingAlpha,
  drawAttackIndicator,
  BALL_OUTER_RING_ALPHA,
  BALL_OUTER_RING_GAP_PX,
  BALL_OUTER_RING_PX,
  BALL_PULSE_GROWTH_PX,
  BALL_RING_PX,
  BALL_RING_SWELL_PX,
  type AttackIndicator,
} from './attackIndicator.js'
import { trailOpacity, type BallTrail, type TrailPoint } from '../analysis/ballTrail.js'
import { drawLabelCard, type LabelCardIndicator } from './labelCard.js'
import { drawThrowInIndicator, type ThrowInIndicator } from './throwIn.js'
import { drawCornerCard, drawCornerCone, type CornerBanner } from './corner.js'
import { drawGoalBanner, type GoalBanner } from './goalBanner.js'
import { footballPatches, UPRIGHT, type Spin } from '../analysis/football.js'
import { computeViewMatrix, IDENTITY_VIEW, type PipelineView, type ViewMatrix } from './viewTransform.js'
import { DEFAULT_THEME, type RenderTheme } from './theme.js'

/**
 * What the goal sequence draws over a frame: its own ball, where that ball just
 * was, and the net it hit. Positions in pitch metres. See goalSequence.ts.
 */
export interface GoalOverlay {
  ball: { x: number; y: number }
  trail: { x: number; y: number }[]
  net: NetBulge
}

/** The player with the ball in this frame and their team, or null. */
function ballCarrier(frame: Frame): { teamId: number; x: number; y: number } | null {
  for (const team of frame.teams ?? []) {
    const tid = team.team_id ?? -1
    if (tid === -1) continue
    const player = (team.players ?? []).find((p) => p.in_possession)
    if (!player) continue
    const { x, y } = player.projected_coordinates ?? {}
    // Possession still counts without a usable position; only "nearby" needs one.
    return { teamId: tid, x: x ?? NaN, y: y ?? NaN }
  }
  return null
}

function isNearCarrier(player: Player, carrier: { x: number; y: number } | null): boolean {
  const x = player.projected_coordinates?.x
  const y = player.projected_coordinates?.y
  if (!carrier || x == null || y == null) return false
  return Math.hypot(x - carrier.x, y - carrier.y) <= NEARBY_METRES
}

/** A player's tracking id, which the export gives as a number or a string. */
export type TrackId = NonNullable<Player['track_id']>

/**
 * The track ids of the players near the ball: the carrier and their teammates
 * within NEARBY_METRES of them. These are the players ringed in white.
 */
export function nearbyTrackIds(frame: Frame): Set<TrackId> {
  const ids = new Set<TrackId>()
  const carrier = ballCarrier(frame)
  if (!carrier) return ids
  for (const team of frame.teams ?? []) {
    if ((team.team_id ?? -1) !== carrier.teamId) continue
    for (const player of team.players ?? []) {
      if (player.track_id != null && isNearCarrier(player, carrier)) ids.add(player.track_id)
    }
  }
  return ids
}

/**
 * The track ids of the players with the ball: those drawn with the gold
 * possession ring.
 */
export function possessionTrackIds(frame: Frame): Set<TrackId> {
  const ids = new Set<TrackId>()
  for (const team of frame.teams ?? []) {
    for (const player of team.players ?? []) {
      if (player.in_possession && player.track_id != null) ids.add(player.track_id)
    }
  }
  return ids
}

/**
 * How strong each ring is, by track id, for a caller that fades them: the
 * white one on the players near the ball and the gold possession ring. A
 * player missing from a map has no such ring.
 */
export interface RingStrengths {
  nearby: ReadonlyMap<TrackId, number>
  possession: ReadonlyMap<TrackId, number>
}

/** Everything a frame can be drawn with besides its own data. */
export interface FrameLayers {
  /** The goal sequence's ball and net, drawn in place of the tracked ball. */
  goal?: GoalOverlay | undefined
  /** The attack: its shade and label under the players, its rings round the ball. */
  attack?: AttackIndicator | undefined
  /** The corner: its cone under the players, its card over everything on the pitch. */
  corner?: CornerBanner | undefined
  /** The throw-in indicator, over everything on the pitch, the players left as they are. */
  throwIn?: ThrowInIndicator | undefined
  /** The card a label plays (labelCard.ts), over everything on the pitch, the players left as they are. */
  labelCard?: LabelCardIndicator | undefined
  /** The goal's card, over everything, fixed to the frame while the view zooms. */
  goalBanner?: GoalBanner | undefined
  /** Ring strengths, for a caller that fades the rings in and out. */
  rings?: RingStrengths | undefined
  /** Whether players far from the ball are drawn faint. Default on. */
  fadeFar?: boolean | undefined
  /** The ball's trail: the path it took, and where that turned. */
  trail?: BallTrail | undefined
  /** How the ball is turned, for a caller that rolls it. Default upright. */
  ballSpin?: Spin | undefined
  /**
   * The players who have just received the ball, by track id, and how
   * strongly their circle and number are drawn over it, from 0 to 1. A player
   * missing from it is drawn under the ball as usual.
   */
  received?: ReadonlyMap<TrackId, number> | undefined
}

/** Size of a shirt number, in proportion to its circle: 10 px in 12 px. */
const NUMBER_PX_PER_RADIUS = 10 / 12

/** Colour of the ball's black patches. */
const BALL_PATCH = '#1a1a1a'

/**
 * How far the player with the ball has grown, from 0 to 1, at possession
 * strength `k`: eased in and out, so the circle neither starts nor stops
 * growing with a jolt.
 */
const growthAt = (k: number) => {
  const t = Math.min(1, Math.max(0, k))
  return t * t * (3 - 2 * t)
}

/**
 * Width of the ball trail and radius of the dots where it turns, in frame px.
 * Its opacity changes along it (trailOpacity), in steps of 1/TRAIL_ALPHA_STEPS:
 * each step is one stroke, rather than one per frame of the path.
 */
const TRAIL_LINE_PX = 2.5
const TRAIL_DOT_PX = 2.5
const TRAIL_ALPHA_STEPS = 40

/**
 * Create a 2D renderer bound to a specific canvas element, drawing in `theme`
 * (theme.ts).
 *
 * Returns:
 *  - `renderFrame(frame, layers)` — draws the given Frame, with any layers
 *     drawn over or under it (FrameLayers).
 *  - `invalidateCache()` — clears the cached pitch image and transform so
 *     they are rebuilt on the next render (call when switching back from 3D).
 *  - `setView(view)` - the zoom and pan for every later frame.
 *  - `setTheme(theme)` - the theme for every later frame.
 */
export function createRenderer(canvas: HTMLCanvasElement, initialTheme: RenderTheme = DEFAULT_THEME) {
  const ctx = canvas.getContext('2d')!

  // Colours, words, fonts and icons. The pitch cache uses none of them, so
  // changing the theme leaves it as it is.
  let theme = initialTheme

  // Zoom and pan live here rather than as a CSS transform on the canvas
  // element. The element has to stay unscaled so a drawing layer can sit over it
  // in the same coordinate system - see viewTransform.ts.
  let view: ViewMatrix = IDENTITY_VIEW

  // Internal (non-reactive) caches — rebuilt lazily on first render or after
  // invalidateCache().
  let transform2d: Transform2D | null = null
  let pitchCache: OffscreenCanvas | null = null
  // The bitmap size and matrix the cache was drawn for. A pan, a zoom or a
  // resize changes it, and only then is the pitch drawn again.
  let pitchKey = ''

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Render a single frame.  Draws the cached pitch background,
   * iterates teams/players/balls, and paints the HUD overlay.
   */
  function renderFrame(frame: Frame, layers: FrameLayers = {}): void {
    const { goal: overlay, attack, rings, trail } = layers
    const spin = layers.ballSpin ?? UPRIGHT
    const fadeFar = layers.fadeFar !== false
    if (!frame) return

    const pd = frame.pitch_dimensions

    if (!transform2d) transform2d = build2DTransform(pd)

    // Everything is drawn in frame units (1280x720). The bitmap is sized to
    // the display, so scale frame units into it, then apply the view.
    const sx = canvas.width / FRAME_W
    const sy = canvas.height / FRAME_H
    const matrix: [number, number, number, number, number, number] = [
      sx * view.a,
      sy * view.b,
      sx * view.c,
      sy * view.d,
      sx * view.e,
      sy * view.f,
    ]

    const key = `${canvas.width}x${canvas.height}:${matrix.join(',')}`
    if (!pitchCache || key !== pitchKey) {
      // The markings alone: the grass is drawn per frame, under them.
      pitchCache = buildPitchCache(pd, transform2d, {
        width: canvas.width,
        height: canvas.height,
        matrix,
        grass: false,
      })
      pitchKey = key
    }

    // Cleared to transparent, not filled: panning used to slide the canvas
    // element and reveal the stage behind it, and letting the stage show
    // through here keeps that looking the same.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    ctx.setTransform(...matrix)
    fillGrass(ctx, pd, transform2d)

    // The markings are already drawn through the view, pixel for pixel.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = PITCH_LINE_ALPHA
    ctx.drawImage(pitchCache, 0, 0)
    ctx.globalAlpha = 1

    ctx.setTransform(...matrix)

    // The attack's shade darkens the markings with the grass, as the design
    // does, and its label goes under everything that moves.
    if (attack) drawAttackIndicator(ctx as CanvasRenderingContext2D, pd, transform2d, attack, theme)
    // The corner's cone lights the grass under everyone, as the attack's shade does.
    if (layers.corner) drawCornerCone(ctx as CanvasRenderingContext2D, pd, transform2d, layers.corner)

    // Goals, on every frame; a struck net bows out while it is hit.
    drawGoalNets(ctx as CanvasRenderingContext2D, pd, transform2d, overlay?.net)

    // ── Teams + players ────────────────────────────────────────────────────
    // Players far from the ball are faded and drawn first, so the play around
    // the ball sits on top where markers overlap. Officials are never faded.
    // During the goal sequence the focus follows its ball, not the tracked one.
    const focus = overlay?.ball ?? trackedBall(frame)
    const carrier = ballCarrier(frame)
    const withBall = carrier?.teamId ?? null
    const people = (frame.teams ?? []).flatMap((team) => {
      const tid = team.team_id ?? -1
      return (team.players ?? []).map((player) => ({
        player,
        tid,
        faded: isFarFromBall(player, tid, focus),
      }))
    })
    // The rings: how strong each is, by track id, when the caller fades them
    // in and out; otherwise full on whoever has them in this frame.
    const nearbyOf = (p: { player: Player; tid: number }): number => {
      const id = p.player.track_id
      if (rings && id != null) return rings.nearby.get(id) ?? 0
      return p.tid === withBall && isNearCarrier(p.player, carrier) ? 1 : 0
    }
    const possessionOf = (p: { player: Player }): number => {
      const id = p.player.track_id
      if (rings && id != null) return rings.possession.get(id) ?? 0
      return p.player.in_possession ? 1 : 0
    }
    // During an attack or a corner everyone fades out, players and officials
    // alike. Everything drawn for a person goes through here.
    const fade = Math.max(attack?.playersFade ?? 0, layers.corner?.playersFade ?? 0)
    const shown = 1 - Math.min(1, Math.max(0, fade))
    // A corner fades out the ball and its trail too, leaving nothing of play
    // under its card. An attack keeps the ball, which it holds.
    const ballFade = layers.corner?.ballFade ?? 0
    const ballShown = 1 - Math.min(1, Math.max(0, ballFade))
    const alphaOf = (p: { faded: boolean }) => (p.faded && fadeFar ? DIMMED_PLAYER_ALPHA : 1) * shown
    // The player with the ball is drawn bigger, so on top of those around them.
    const order = [...people].sort((a, b) => Number(possessionOf(a) > 0) - Number(possessionOf(b) > 0))
    for (const faded of shown > 0 ? [true, false] : []) {
      for (const p of order) {
        if (p.faded !== faded) continue
        ctx.globalAlpha = alphaOf(p)
        draw2DPlayer(p.player, p.tid, nearbyOf(p), possessionOf(p))
      }
    }
    ctx.globalAlpha = 1

    // The goal sequence draws its own ball and trail in place of the tracked
    // ones, so the trail is left out while it plays.
    if (trail && !overlay && ballShown > 0) {
      ctx.globalAlpha = ballShown
      for (const run of trail.runs) drawTrailRun(run)
      for (const turn of trail.turns) drawTrailDot(turn)
      ctx.globalAlpha = 1
    }

    // The shirt number of the player with the ball, over the trail, which
    // always ends at them and would otherwise run across it.
    for (const p of shown > 0 ? people : []) {
      const possession = possessionOf(p)
      if (possession <= 0) continue
      ctx.globalAlpha = alphaOf(p) * possession
      draw2DNumber(p.player, p.tid, possession)
    }
    ctx.globalAlpha = 1

    // During the goal sequence its ball replaces the tracked one, which near a
    // goal tends to jump about or go straight through the net.
    if (overlay) {
      overlay.trail.forEach((p, i) => {
        draw2DBall({ projected_coordinates: p }, spin, 0.45 / (i + 1))
      })
      draw2DBall({ projected_coordinates: overlay.ball }, spin, 1, attack)
    } else {
      // During an attack the ball is held where it was when the attack was
      // shown, and the tracked one only fades back in as the attack goes.
      const held = attack?.ball
      const heldAlpha = held && attack.leaving ? Math.min(1, Math.max(0, attack.intensity)) : 1
      if ((!held || heldAlpha < 1) && ballShown > 0) {
        for (const ball of frame.balls ?? []) {
          draw2DBall(ball, spin, (1 - (held ? heldAlpha : 0)) * ballShown, held ? undefined : attack)
        }
      }
      if (held) draw2DBall({ projected_coordinates: held }, spin, heldAlpha, attack)
      // A player who has just received the ball is drawn over it for a
      // moment, so their number shows, then fades to show the ball again.
      for (const p of shown > 0 ? people : []) {
        const id = p.player.track_id
        const cover = id != null ? (layers.received?.get(id) ?? 0) : 0
        if (cover <= 0) continue
        const at = playerPx(p.player)
        if (!at) continue
        ctx.globalAlpha = alphaOf(p) * cover
        drawPlayerBody(at, carrierRadius(possessionOf(p)), p.player, p.tid, nearbyOf(p))
        draw2DNumber(p.player, p.tid, possessionOf(p))
      }
      ctx.globalAlpha = 1
    }

    // The throw-in's band, the corner's card and a label's card are laid out for the whole
    // pitch. In a view zoomed or panned, by the user or the zoom near goal,
    // they stay on the frame where the whole pitch has them, as the goal's
    // card does, rather than going partly out of view. In the whole pitch the
    // view is the frame's own, and they are drawn as they always were.
    const cards = layers.throwIn || layers.corner || layers.labelCard
    const moved = matrix.some((v, i) => v !== [sx, 0, 0, sy, 0, 0][i])
    if (cards && moved) ctx.setTransform(sx, 0, 0, sy, 0, 0)
    if (layers.throwIn) drawThrowInIndicator(ctx as CanvasRenderingContext2D, pd, transform2d, layers.throwIn, theme)
    if (layers.corner) drawCornerCard(ctx as CanvasRenderingContext2D, transform2d, layers.corner, theme)
    if (layers.labelCard) drawLabelCard(ctx as CanvasRenderingContext2D, transform2d, layers.labelCard, theme)
    if (cards && moved) ctx.setTransform(...matrix)
    if (layers.goalBanner) {
      // Fixed to the frame: the goal sequence zooms the view in on the net
      // behind it, and at that scale the card would cover the screen.
      ctx.setTransform(sx, 0, 0, sy, 0, 0)
      drawGoalBanner(ctx as CanvasRenderingContext2D, transform2d, layers.goalBanner, theme)
      ctx.setTransform(...matrix)
    }

    // ── Overlay HUD ────────────────────────────────────────────────────────
    const fc = frame.frame_data?.[0]?.frame_count ?? null
    const actions = frame.state?.actions ?? []
    draw2DOverlay(fc, actions)
  }

  /**
   * Clear cached pitch image and transform.  Call this when switching back
   * from 3D mode so the next render rebuilds everything.
   */
  function invalidateCache(): void {
    pitchCache = null
    transform2d = null
  }

  // ── Internal drawing helpers ──────────────────────────────────────────────

  /** The tracked ball's position, or null when the frame has none usable. */
  function trackedBall(frame: Frame): { x: number; y: number } | null {
    for (const ball of frame.balls ?? []) {
      const { x, y } = ball.projected_coordinates ?? {}
      if (x != null && y != null && !isNaN(x) && !isNaN(y)) return { x, y }
    }
    return null
  }

  /** A player, not an official, further than FOCUS_METRES from the ball. */
  function isFarFromBall(player: Player, teamId: number, ball: { x: number; y: number } | null): boolean {
    if (!ball || teamId === -1) return false
    if (
      String(player.person_type ?? '')
        .toUpperCase()
        .includes('OFFICIAL')
    )
      return false
    const x = player.projected_coordinates?.x
    const y = player.projected_coordinates?.y
    if (x == null || y == null) return false
    return Math.hypot(x - ball.x, y - ball.y) > FOCUS_METRES
  }

  /** Within NEARBY_METRES of the carrier, on the pitch (the carrier included). */
  /** A person's position on the canvas, or null when it has none usable. */
  function playerPx(player: Player): [number, number] | null {
    const coords = player.projected_coordinates
    const x = coords?.x
    const y = coords?.y
    if (x == null || y == null || isNaN(x) || isNaN(y)) return null
    if (!transform2d) return null
    return worldToPx(x, y, transform2d)
  }

  /**
   * A person's colours and outline. Fixed by role, from the theme; by default
   * PERSON_COLORS. Team 0 is home, team 1 away.
   */
  function personStyle(player: Player, teamId: number) {
    const pt = String(player.person_type ?? '').toUpperCase()
    const palette = theme.colors
    const team = teamId === 0 ? palette.home : teamId === 1 ? palette.away : null
    let colors = team ?? palette.unknown
    let outline = colors.outline
    let outlineWidth = 2
    if (pt.includes('GOALKEEPER')) {
      colors = palette.goalkeeper
      // Ringed in their team's colour, so which team they keep for still shows.
      outline = team?.fill ?? colors.outline
      outlineWidth = 3
    } else if (pt.includes('OFFICIAL') || teamId === -1) {
      colors = palette.official
      outline = colors.outline
    }
    return { colors, outline, outlineWidth }
  }

  /**
   * Draw a single player as a filled circle with shadow, outline, and, on the
   * player with the ball, the possession ring, grown by CARRIER_GROWTH at its
   * strength. Their number is drawn later, by draw2DNumber.
   */
  function draw2DPlayer(player: Player, teamId: number, ring = 0, possession = 0): void {
    const at = playerPx(player)
    if (!at) return
    const [px, py] = at
    const radius = carrierRadius(possession)

    // Shadow (offset 1px down-right)
    ctx.beginPath()
    ctx.arc(px + 1, py + 1, radius, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.fill()

    drawPlayerBody(at, radius, player, teamId, ring)

    // Possession ring (gold), at its strength
    if (possession > 0) {
      const alpha = ctx.globalAlpha
      ctx.globalAlpha = alpha * possession
      ctx.beginPath()
      ctx.arc(px, py, radius + 4, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffd700'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.globalAlpha = alpha
    }
  }

  /**
   * A player's circle at `at`, of `radius`: filled, and outlined, with the
   * white ring at strength `ring` on the players around the ball.
   */
  function drawPlayerBody(at: [number, number], radius: number, player: Player, teamId: number, ring: number): void {
    const [px, py] = at
    const { colors, outlineWidth, ...style } = personStyle(player, teamId)
    // White marks the players around the ball, and only them. Full on, it
    // replaces the outline; fading, it is laid over the outline at its strength.
    const ringOnly = ring >= 1
    const outline = ringOnly ? NEARBY_OUTLINE : style.outline
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fillStyle = colors.fill
    ctx.fill()
    ctx.strokeStyle = outline
    ctx.lineWidth = outlineWidth
    ctx.stroke()
    if (ring > 0 && !ringOnly) {
      const alpha = ctx.globalAlpha
      ctx.globalAlpha = alpha * ring
      ctx.strokeStyle = NEARBY_OUTLINE
      ctx.stroke()
      ctx.globalAlpha = alpha
    }
  }

  /** A player's radius, grown by CARRIER_GROWTH at possession strength `k`. */
  function carrierRadius(k: number): number {
    return PLAYER_RADIUS * (1 + CARRIER_GROWTH * growthAt(k))
  }

  /**
   * Draw a player's jersey number, centred inside their circle and growing
   * with it.
   */
  function draw2DNumber(player: Player, teamId: number, possession = 0): void {
    const at = playerPx(player)
    const num = player.player_number
    if (!at || num == null || !(Number(num) > 0)) return
    ctx.fillStyle = personStyle(player, teamId).colors.text
    ctx.font = `bold ${carrierRadius(possession) * NUMBER_PX_PER_RADIUS}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(Math.round(Number(num))), at[0], at[1])
  }

  /**
   * Draw a single ball, as a football turned by `spin` (football.ts). The
   * higher it is (z), the bigger it is drawn, and above half a metre its white
   * panels are tinted cyan. During an attack it is ringed in the attacking
   * team's colour.
   */
  function draw2DBall(ball: Ball, spin: Spin, alpha = 1, attack?: AttackIndicator): void {
    const coords = ball.projected_coordinates
    const x = coords?.x
    const y = coords?.y
    const z = coords?.z ?? 0
    if (x == null || y == null || isNaN(x) || isNaN(y)) return
    if (!transform2d) return

    const [px, py] = worldToPx(x, y, transform2d)
    // Grows with z, up to 6 m, and stays smaller than a player.
    const r = BALL_RADIUS + Math.min(6, Math.max(0, z)) * 0.4

    const before = ctx.globalAlpha
    if (attack) drawBallRings(px, py, r, attack)
    ctx.globalAlpha = alpha
    ctx.save()
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fillStyle = z <= 0.5 ? '#ffffff' : '#c8ffff'
    ctx.fill()
    ctx.clip()
    ctx.fillStyle = BALL_PATCH
    for (const patch of footballPatches(spin)) {
      ctx.beginPath()
      patch.forEach(([u, v], i) => {
        if (i === 0) ctx.moveTo(px + u * r, py + v * r)
        else ctx.lineTo(px + u * r, py + v * r)
      })
      ctx.closePath()
      ctx.fill()
    }
    // Lit from the top left, so it reads as round.
    const shade = ctx.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r)
    shade.addColorStop(0, 'rgba(255,255,255,0.35)')
    shade.addColorStop(1, 'rgba(0,0,0,0.3)')
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fillStyle = shade
    ctx.fill()
    ctx.restore()
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.globalAlpha = before
  }

  /**
   * The attacking team's border round a ball of radius `r` at (px, py): a
   * solid ring hugging it, swelling and settling with each pulse, and one
   * pulsing out from it, growing and fading, or both held still without a
   * pulse.
   */
  function drawBallRings(px: number, py: number, r: number, attack: AttackIndicator): void {
    const strength = ballRingAlpha(attack)
    if (strength <= 0) return
    const phase = attack.pulse === undefined ? null : ((attack.pulse % 1) + 1) % 1
    // 0 at the start and end of a pulse, 1 halfway, eased both ways.
    const swell = phase === null ? 0 : (1 - Math.cos(phase * Math.PI * 2)) / 2
    const width = BALL_RING_PX + BALL_RING_SWELL_PX * swell
    ctx.strokeStyle = attack.color
    ctx.globalAlpha = strength
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.arc(px, py, r + width / 2, 0, Math.PI * 2)
    ctx.stroke()
    const radius = phase === null ? r + BALL_OUTER_RING_GAP_PX : r + BALL_RING_PX + phase * BALL_PULSE_GROWTH_PX
    const alpha = phase === null ? BALL_OUTER_RING_ALPHA : (1 - phase) ** 2
    if (alpha <= 0) return
    ctx.globalAlpha = strength * alpha
    ctx.lineWidth = BALL_OUTER_RING_PX
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.stroke()
  }

  /**
   * One unbroken stretch of the ball trail, oldest first. Each stretch of it
   * between two points takes the opacity of the newer one. Neighbouring
   * stretches of the same opacity are one stroke, joined round; where the
   * opacity steps, butt ends meet, so no part of the line is drawn twice.
   */
  function drawTrailRun(run: TrailPoint[]): void {
    if (!transform2d) return
    const px = run.map((p) => worldToPx(p.x, p.y, transform2d!))
    const step = (i: number) => Math.round(trailOpacity(run[i]!.age) * TRAIL_ALPHA_STEPS)
    ctx.lineWidth = TRAIL_LINE_PX
    ctx.lineJoin = 'round'
    let i = 1
    while (i < run.length) {
      const alpha = step(i)
      let j = i
      while (j + 1 < run.length && step(j + 1) === alpha) j++
      if (alpha > 0) {
        ctx.beginPath()
        ctx.moveTo(...px[i - 1]!)
        for (let k = i; k <= j; k++) ctx.lineTo(...px[k]!)
        ctx.strokeStyle = `rgba(255,255,255,${alpha / TRAIL_ALPHA_STEPS})`
        ctx.stroke()
      }
      i = j + 1
    }
    ctx.lineJoin = 'miter'
  }

  /** The dot where the ball trail turns, as strong as the path there. */
  function drawTrailDot(at: TrailPoint): void {
    if (!transform2d || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return
    const [px, py] = worldToPx(at.x, at.y, transform2d)
    const before = ctx.globalAlpha
    ctx.globalAlpha = before * trailOpacity(at.age)
    ctx.beginPath()
    ctx.arc(px, py, TRAIL_DOT_PX, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.globalAlpha = before
  }

  /**
   * Draw the action-type text (bottom-left), each action as the theme's
   * formatAction writes it: only the labels a human gave, unless the theme
   * asks for the AI's too (`aiLabels`, the widget's own; the reference lists
   * every label).
   *
   * The frame-count label used to be drawn here too (top-left), but that put
   * it inside the canvas bitmap, which the surface's zoom/pan is a CSS
   * transform on - so it slid off-screen under zoom instead of staying put
   * like an overlay should. PipelineOutputSurface.vue now draws that label
   * itself, fixed outside the canvas. `_frameCount` stays a parameter so this
   * still mirrors the vendored signature.
   */
  function draw2DOverlay(_frameCount: number | null | undefined, actions: FrameAction[]): void {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 16px sans-serif'

    const at = actions
      .filter((a) => a.action_type && (theme.aiLabels || isHumanLabel(a)))
      .map((a) => theme.formatAction(String(a.action_type).trim()))
      .join(', ')

    if (at) {
      ctx.font = '600 14px sans-serif'
      ctx.textBaseline = 'bottom'
      ctx.fillText(at, 20, FRAME_H - 20)
    }
  }

  /**
   * Set the zoom/pan applied to every subsequent frame. Takes the surface's raw
   * view - screen-pixel pan included - and resolves it into canvas space.
   */
  function setView(next: PipelineView): void {
    view = computeViewMatrix(next)
  }

  /**
   * Draw every later frame in `next`. Only colours, words, fonts and icons
   * change, none of which the pitch cache holds, so nothing is invalidated.
   */
  function setTheme(next: RenderTheme): void {
    theme = next
  }

  return { renderFrame, invalidateCache, setView, setTheme }
}
