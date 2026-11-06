/**
 * The widget: a match tracker mounted in a shadow root on a host element,
 * driving one Director from either a live stream (`push`) or a replay host's
 * clock (`present`), and drawing what the director paints.
 *
 * Ported from PipelineOutputSurface.vue (video-annotation 6f14d1f): the
 * sizing and pixel-ratio watch (`:214-290`), font loading and the repaint
 * after it (`:1321-1345`), the overlay's pointerdown, which stops every
 * moment (`:1471`) unless it lands in an element the host marked
 * `data-match-tracker-keep`, and the moments that can be played
 * (`:1020-1036`). Live mode is the widget's own (spec, "Feeding it").
 *
 * ## The loop
 *
 * One animation frame loop, run only when something asks: an input, a moment
 * or fade still animating, a return to view. Each frame is one director
 * update, and the canvas is drawn only when the director paints. All the
 * paints of one call land in one display frame, so only the last is drawn,
 * with its own frame, layers and view; the goldens prove at the director
 * that its paints are the reference's, in order. In replay, while the host's
 * clock plays, the loop asks for every display frame, so a host presenting
 * from its own animation frames is taken in each frame rather than every
 * other one; a frame with nothing new updates and draws nothing. The fonts or icons arriving
 * and an options change repaint at once, through the director (`setLayers`
 * with the layers in force paints and changes nothing else); a resize goes
 * in as a view change (`setView`), as the reference's pushView paints.
 *
 * ## The view
 *
 * The widget holds the user's zoom and pan and passes them with every call.
 * The user's own wheel, pinch, drag and double-click (zoomPan.ts) take the
 * view over from a goal's camera (`releaseCamera`) and go in through
 * `setView`. A goal's camera comes back as `camera`, which the widget takes
 * as its own view; either way it says so with `zoom`. Each drawn paint
 * carries the view it was made in, which the renderer is given before it
 * draws.
 *
 * While the tab is hidden or the widget is out of view nothing is updated or
 * drawn; `push` still records. Coming back is a seek in live mode, so nothing
 * stale plays on.
 *
 * ## The HUD
 *
 * Over the pitch box: the attacking/defending row above it, the layers menu
 * top right and the zoom badge bottom right (hud.ts, layersMenu.ts). The row
 * follows the phase of each update; all of it follows the options, in place.
 *
 * ## The overlay
 *
 * The one node the widget puts in the host's light DOM: a div with
 * `slot="overlay"`, which the shadow root's overlay box (the canvas's box)
 * projects. Being the page's own, it and what the host mounts in it take the
 * page's CSS (Tailwind, Vue scoped styles), as they did in the reference's
 * slot. Its inline style, set through the CSSOM, fills the box and lets
 * pointer events through, against whatever the page's CSS says of divs.
 */
import { deriveAt, windowAt } from '../analysis/derive.js'
import type { BallTrail } from '../analysis/ballTrail.js'
import type { TeamId, TeamPhase } from '../analysis/teamPhase.js'
import { ensureFonts } from '../assets/fonts.js'
import { loadIcons } from '../assets/icons.js'
import { LABEL_CARD_KEYS, iconCardRecord, labelCardRecord } from '../model/labelCards.js'
import {
  Director,
  type DirectorCamera,
  type DirectorInput,
  type DirectorOutput,
  type DirectorPaint,
  type DirectorView,
  type MomentAvailability,
  type PlayerLossState,
} from '../director/director.js'
import { nextPlayback } from '../director/playback.js'
import { LiveHistory } from '../history/liveHistory.js'
import { parseRecord } from '../model/parseRecord.js'
import type { ReplayLayerKey, ReplayLayers, ReplayMoment } from '../model/replayLayers.js'
import type { TrackerRecord } from '../model/types.js'
import { createRenderer } from '../render/renderer.js'
import type { RenderTheme } from '../render/theme.js'
import type { FrameBox } from '../render/viewTransform.js'
import { MATCH_TRACKER_VERSION } from '../version.js'
import { Emitter, MomentWatch, type TrackerBox, type TrackerEvents } from './events.js'
import { measureBox, pixelRatio, place, sameBox, sizeBitmap } from './layout.js'
import { LossBadge, PhaseRow, ZoomBadge } from './hud.js'
import { LayersMenu } from './layersMenu.js'
import { FrameLoop } from './loop.js'
import {
  canonicalLayers,
  directorOptions,
  initialLayers,
  layersMenuOn,
  resolveOptions,
  storeLayers,
  themeFor,
  type MatchTrackerOptions,
  type MutableOptions,
  type SettableOptions,
  type Resolved,
} from './options.js'
import { STYLES } from './styles.js'
import { ZoomPan } from './zoomPan.js'

/** What a replay host hands over on each tick of its clock. */
export interface ReplayState {
  /** The replay clock, in seconds. */
  time: number
  playing: boolean
  /** The record on screen at `time`, or null before the first. */
  record: TrackerRecord | null
  /** The records the host holds from `time` minus the lookback up to `time`, in time order. */
  lookback: readonly TrackerRecord[]
}

export interface MatchTracker {
  /** The package version this widget runs, as on its root's `data-match-tracker-version`. */
  readonly version: string
  /**
   * An element over the pitch, in the canvas's own box, for a host's drawing
   * layer and anything it anchors to the pitch. It is a child of the host, in
   * the page's light DOM with `slot="overlay"`, so the page's CSS reaches it
   * and what is mounted in it. Pointer events pass through it unless the
   * host turns them on; pressing on it stops every moment, so what is drawn
   * on is the data. An element marked `data-match-tracker-keep` (a
   * transport bar, a frame badge) is the host's own: a press inside it stops
   * nothing and starts no pan, and a double-click there leaves the zoom. A
   * ctrl/⌘ + wheel or a pinch over it still zooms the pitch.
   */
  readonly overlay: HTMLElement
  /**
   * The canvas's box, in CSS px from the host's top-left corner, below the
   * attacking/defending row. Null until the widget has been laid out with a
   * size, and after destroy. `box` says when it changes.
   */
  readonly box: TrackerBox | null
  /** Which moments `trigger` can play on the frame on screen. `availability` says when it changes. */
  availability(): MomentAvailability
  /** Live: one websocket message, in any form parseRecord reads. Anything unreadable is ignored. */
  push(message: unknown): void
  /** Replay: the state at the host's clock. */
  present(state: ReplayState): void
  /** Forget everything seen, for a reconnect or a new match. What follows is a seek. */
  reset(): void
  /** Play `moment` now, for `team` when it is an attack (default 0). False when nothing can be played. */
  trigger(moment: ReplayMoment, team?: TeamId): boolean
  /** Change any option but `mode` and `layersStorageKey`, which are fixed at mount: given anyway, they are ignored. */
  setOptions(options: SettableOptions): void
  on<K extends keyof TrackerEvents>(event: K, listener: (value: TrackerEvents[K]) => void): () => void
  /** Stop everything, and take the widget out of its host. Every method is a no-op after. */
  destroy(): void
}

type Renderer = ReturnType<typeof createRenderer>

/** Whether `moment` can be played for `team` on the frame on screen. */
function playable(availability: MomentAvailability, moment: ReplayMoment, team: TeamId): boolean {
  return moment === 'attack' ? availability.attack[team] : availability[moment]
}

/** Nothing can be played: before the first frame, and after a reset. */
const NOTHING_AVAILABLE: MomentAvailability = {
  goal: false,
  attack: { 0: false, 1: false },
  corner: false,
  throwIn: false,
  ...labelCardRecord(() => false),
}

const copyAvailability = (a: MomentAvailability): MomentAvailability => ({ ...a, attack: { ...a.attack } })

const sameAvailability = (a: MomentAvailability, b: MomentAvailability) =>
  a.goal === b.goal &&
  a.attack[0] === b.attack[0] &&
  a.attack[1] === b.attack[1] &&
  a.corner === b.corner &&
  a.throwIn === b.throwIn &&
  LABEL_CARD_KEYS.every((key) => a[key] === b[key])

const samePublicBox = (a: TrackerBox, b: TrackerBox | null) =>
  b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height

const sameView = (a: DirectorView, b: DirectorView | null) =>
  b !== null && a.zoom === b.zoom && a.panX === b.panX && a.panY === b.panY && a.renderedWidth === b.renderedWidth

/** The shadow roots trackers made, which a tracker may mount in again once the one before is destroyed. */
const ownRoots = new WeakSet<ShadowRoot>()
/** The shadow roots a tracker is mounted in now. */
const mountedRoots = new WeakSet<ShadowRoot>()

/**
 * The shadow root to mount in on `host`: one a tracker made there before, or
 * a new one. Never someone else's, which mounting would wipe.
 */
function shadowRootFor(host: HTMLElement): ShadowRoot {
  const existing = host.shadowRoot
  if (existing && mountedRoots.has(existing)) {
    throw new Error('match-tracker: this host already has a match tracker. Destroy it before mounting another.')
  }
  if (existing && ownRoots.has(existing)) return existing
  const notPlain =
    'match-tracker: the host must be a plain element without a shadow root, as the tracker mounts in a shadow root of its own.'
  if (existing) throw new Error(notPlain)
  let root: ShadowRoot
  try {
    root = host.attachShadow({ mode: 'open' })
  } catch (cause) {
    // A closed shadow root, or an element that cannot have one.
    throw new Error(notPlain, { cause })
  }
  ownRoots.add(root)
  return root
}

/** The widget's stylesheet, made once and shared by every instance, where the browser can. */
let sharedSheet: CSSStyleSheet | null = null

function adoptStyles(shadow: ShadowRoot): boolean {
  if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in shadow)) return false
  try {
    if (!sharedSheet) {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(STYLES)
      sharedSheet = sheet
    }
    shadow.adoptedStyleSheets = [sharedSheet]
    return true
  } catch {
    return false
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className
  return el
}

/**
 * The overlay, for the host's light DOM: projected into the shadow root's
 * overlay box by its slot, and filling it. Styled inline through the CSSOM,
 * which a Content Security Policy does not block, so the page's rules for
 * divs cannot move it, size it or have it take the pointer.
 */
function lightOverlay(doc: Document): HTMLDivElement {
  const el = doc.createElement('div')
  el.slot = 'overlay'
  const { style } = el
  style.position = 'absolute'
  style.top = '0px'
  style.right = '0px'
  style.bottom = '0px'
  style.left = '0px'
  style.width = 'auto'
  style.height = 'auto'
  style.margin = '0px'
  style.padding = '0px'
  style.border = '0px none'
  style.display = 'block'
  style.pointerEvents = 'none'
  return el
}

/** The widget's DOM, in `shadow`, as the reference's template lays out the stage. */
function build(shadow: ShadowRoot) {
  const root = div('mt-root')
  root.setAttribute('data-match-tracker-version', MATCH_TRACKER_VERSION)
  const viewport = div('mt-viewport')
  const canvas = document.createElement('canvas')
  canvas.className = 'mt-canvas'
  // One picture to a screen reader, named in the locale (renderHud).
  canvas.setAttribute('role', 'img')
  const overlayLayer = div('mt-overlay-layer')
  // The host's overlay element is projected here, in the canvas's box.
  const overlayBox = div('mt-overlay')
  const slot = document.createElement('slot')
  slot.name = 'overlay'
  overlayBox.append(slot)
  overlayLayer.append(overlayBox)
  viewport.append(canvas, overlayLayer)
  const hudLayer = div('mt-hud-layer')
  const hud = div('mt-hud')
  hudLayer.append(hud)
  root.append(viewport, hudLayer)
  const nodes: Node[] = [root]
  if (!adoptStyles(shadow)) {
    const style = document.createElement('style')
    style.textContent = STYLES
    nodes.unshift(style)
  }
  shadow.replaceChildren(...nodes)
  return { root, viewport, canvas, overlayBox, hudLayer, hud }
}

function rendererFor(canvas: HTMLCanvasElement, theme: RenderTheme): Renderer | null {
  try {
    // No 2D context (a test DOM, or a browser that refuses one): the widget
    // still mounts and takes its input; only drawing is skipped.
    if (!canvas.getContext('2d')) return null
  } catch {
    return null
  }
  return createRenderer(canvas, theme)
}

class Tracker implements MatchTracker {
  readonly version = MATCH_TRACKER_VERSION
  readonly overlay: HTMLElement

  private readonly mode: MatchTrackerOptions['mode']
  private options: MutableOptions
  private resolved: Resolved
  private icons: RenderTheme['icons'] = { goal: null, corner: null, ...iconCardRecord(() => null) }
  private layers: ReplayLayers
  private readonly doc: Document
  private readonly host: HTMLElement
  private readonly shadow: ShadowRoot
  private readonly viewport: HTMLElement
  private readonly canvas: HTMLCanvasElement
  /** The shadow root's box the overlay's slot is in, placed with the canvas. */
  private readonly overlayBox: HTMLElement
  private readonly hud: HTMLElement
  private readonly phaseRow = new PhaseRow()
  private readonly layersMenu: LayersMenu
  private readonly zoomBadge: ZoomBadge
  private readonly lossBadge: LossBadge
  /** The player loss on the frame on screen, as the director last said, for the debug badge. */
  private loss: PlayerLossState | null = null
  private readonly zoomPan: ZoomPan
  /** The phase of the last update, which the HUD's row shows. */
  private phase: TeamPhase | null = null
  private readonly renderer: Renderer | null
  private readonly director: Director
  private readonly emitter = new Emitter<TrackerEvents>()
  private readonly moments = new MomentWatch()
  private readonly loop: FrameLoop
  private readonly resizeObserver: ResizeObserver | null = null
  private readonly intersectionObserver: IntersectionObserver | null = null
  private dprQuery: MediaQueryList | null = null
  private destroyed = false

  private frameBox: FrameBox | null = null
  /** The frame box as the host sees it, from its own top-left corner. */
  private hostBox: TrackerBox | null = null
  /** What `trigger` could play on the frame of the last update. */
  private available: MomentAvailability = NOTHING_AVAILABLE
  /** The user's zoom and pan, or where a sequence has moved them. */
  private view: DirectorCamera = { zoom: 1, panX: 0, panY: 0 }
  /** The view the renderer was last given, or null before it was given one. */
  private rendererView: DirectorView | null = null

  /** Whether the tab was hidden since the last frame drawn: coming back is then a seek. */
  private wasHidden: boolean
  /** Whether the widget is in view, as the intersection observer last said. In view until it says otherwise. */
  private onScreen = true
  /** Live: whether the next record shown is a seek. True at mount, after a reset, on coming back into view, and when the stream breaks. */
  private resumed = true
  /** Live: that seek is only coming back after being hidden or scrolled away (DirectorInput.rejoining). */
  private rejoining = false

  private readonly history = new LiveHistory()
  /** Bumped on every record the history takes, so the derived phase and trail are worked out once per change. */
  private historyVersion = 0
  private presented: ReplayState | null = null
  /** Replay: the clock and playback flag of the update before (nextPlayback). */
  private flag: { time: number; playback: boolean } | null = null
  private derived: { keys: readonly unknown[]; phase: TeamPhase | null; trail: BallTrail | null } | null = null

  /** The input of the last update: what the director has seen. */
  private lastInput: DirectorInput | null = null
  /** Whether the canvas is behind the director: a paint went undrawn, or the bitmap was cleared. */
  private stale = false

  constructor(host: HTMLElement, options: MatchTrackerOptions) {
    // First, before anything is changed: a host the tracker cannot mount on throws as it is.
    const shadow = shadowRootFor(host)
    const { mode, ...rest } = options
    this.mode = mode
    this.options = rest
    this.resolved = resolveOptions(rest)
    this.layers = initialLayers(rest)
    this.doc = host.ownerDocument
    this.wasHidden = this.doc.visibilityState === 'hidden'

    this.host = host
    this.shadow = shadow
    mountedRoots.add(shadow)
    const dom = build(this.shadow)
    this.viewport = dom.viewport
    this.canvas = dom.canvas
    this.overlayBox = dom.overlayBox
    this.overlay = lightOverlay(this.doc)
    host.append(this.overlay)
    this.hud = dom.hud
    this.layersMenu = new LayersMenu(this.shadow, this.onLayerToggle)
    this.zoomBadge = new ZoomBadge(this.hud)
    this.lossBadge = new LossBadge(this.hud)
    this.hud.append(this.phaseRow.box)
    this.layersMenu.setShown(this.hud, layersMenuOn(this.options))
    this.layersMenu.setText(this.resolved.text)
    this.layersMenu.setLayers(this.layers)
    this.renderHud()

    this.renderer = rendererFor(this.canvas, themeFor(this.resolved, this.icons))
    // Frame size is a sane bitmap until the box arrives, as in the reference.
    if (this.renderer) sizeBitmap(this.canvas, null)
    this.director = new Director({ layers: this.layers, ...directorOptions(this.resolved) })
    this.loop = new FrameLoop(this.tick, () => this.director.animating)

    this.overlay.addEventListener('pointerdown', this.onOverlayPointerDown, { capture: true })
    this.zoomPan = new ZoomPan(
      this.viewport,
      {
        view: () => this.view,
        takeCamera: () => this.director.releaseCamera(),
        setView: this.setUserView,
        keeps: (target) => this.keeps(target),
      },
      [dom.hudLayer],
    )
    this.doc.addEventListener('visibilitychange', this.onVisibilityChange)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.measure)
      this.resizeObserver.observe(this.viewport)
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(this.onIntersection)
      this.intersectionObserver.observe(host)
    }
    this.watchPixelRatio()
    this.measure()

    // The canvas does not wait for fonts or icons: until they arrive, text is
    // drawn in a fallback and cards without their icon, and nothing would
    // redraw a still frame once they have. So repaint when they are in.
    void ensureFonts().then(this.repaint, () => {})
    void loadIcons().then(
      (icons) => {
        if (this.destroyed) return
        this.icons = icons
        this.renderer?.setTheme(themeFor(this.resolved, this.icons))
        this.repaint()
      },
      () => {},
    )
  }

  push(message: unknown): void {
    if (this.destroyed || this.mode !== 'live') return
    const record = parseRecord(message)
    if (!record) return
    const breaks = this.history.breaks
    if (!this.history.add(record)) return
    // The stream broke and started again (LiveHistory.add): what it shows next is a seek.
    if (this.history.breaks !== breaks) {
      this.resumed = true
      this.rejoining = false
    }
    this.historyVersion++
    this.loop.request()
  }

  present(state: ReplayState): void {
    if (this.destroyed || this.mode !== 'replay' || !state) return
    this.presented = state
    this.loop.request()
  }

  reset(): void {
    if (this.destroyed) return
    this.history.clear()
    this.historyVersion++
    this.presented = null
    this.flag = null
    this.derived = null
    this.director.reset()
    // A goal's camera puts the user's view back as it stops: take it now, or
    // the next update would pass the camera's last view back in as the user's.
    this.adoptCamera(this.director.view)
    this.lastInput = null
    this.resumed = true
    this.rejoining = false
    // No phase until the next record: the row of the match before goes, and so does its player loss.
    this.phase = null
    this.loss = null
    this.renderHud()
    this.updateAvailability()
    // The director stops its moments without a paint.
    for (const change of this.moments.clear()) this.emitter.emit('moment', change)
  }

  trigger(moment: ReplayMoment, team: TeamId = 0): boolean {
    if (this.destroyed) return false
    // A frame due now is run first, so the moment plays on what is on screen by now.
    this.loop.flush()
    const input = this.lastInput
    // What the director can play is read from the frame it was last given,
    // which is `input`: taking it in again inside trigger changes nothing.
    if (!input || !playable(this.director.availability(), moment, team)) return false
    const out = this.director.trigger(moment, team, input, this.directorView())
    if (!out) return false
    this.show(out)
    return true
  }

  setOptions(options: SettableOptions): void {
    if (this.destroyed) return
    // The mode and the storage key are fixed at mount; a caller passing them anyway is ignored.
    const { mode: _mode, layersStorageKey: _key, ...rest } = options as Partial<MatchTrackerOptions>
    // Everything that can throw is worked out before anything changes, so
    // options that throw leave the tracker as it was, and it takes the next.
    const next = { ...this.options, ...rest }
    const resolved = resolveOptions(next)
    const theme = themeFor(resolved, this.icons)
    const layers = this.layersAfter(next, rest)
    this.options = next
    this.resolved = resolved
    this.renderer?.setTheme(theme)
    this.director.setOptions(directorOptions(this.resolved))
    this.layersMenu.setText(this.resolved.text)
    this.layersMenu.setShown(this.hud, layersMenuOn(this.options))
    this.renderHud()
    if (Object.entries(layers).some(([key, on]) => this.layers[key as keyof ReplayLayers] !== on)) {
      this.applyLayers(layers, false)
    } else {
      this.repaint()
    }
  }

  /**
   * The layers in force once the options are `next`, `changed` among them.
   * Without the menu they are always the canonical ones. Switching the menu
   * on reads the kept choice as at mount; otherwise new `layers` go over the
   * ones in force.
   */
  private layersAfter(next: MutableOptions, changed: Partial<MutableOptions>): ReplayLayers {
    const menuIs = layersMenuOn(next)
    if (menuIs !== layersMenuOn(this.options)) return initialLayers(next)
    if (!menuIs) return canonicalLayers(next)
    return changed.layers ? { ...this.layers, ...changed.layers } : this.layers
  }

  on<K extends keyof TrackerEvents>(event: K, listener: (value: TrackerEvents[K]) => void): () => void {
    if (this.destroyed) return () => {}
    return this.emitter.on(event, listener)
  }

  get box(): TrackerBox | null {
    return this.destroyed ? null : this.hostBox
  }

  availability(): MomentAvailability {
    return copyAvailability(this.destroyed ? NOTHING_AVAILABLE : this.available)
  }

  /** What the director can play now, said to the host when it changed. */
  private updateAvailability(): void {
    const next = this.director.availability()
    if (sameAvailability(next, this.available)) return
    this.available = copyAvailability(next)
    this.emitter.emit('availability', copyAvailability(next))
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.loop.stop()
    this.resizeObserver?.disconnect()
    this.intersectionObserver?.disconnect()
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange)
    this.dprQuery = null
    this.doc.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.overlay.removeEventListener('pointerdown', this.onOverlayPointerDown, { capture: true })
    this.layersMenu.destroy()
    this.zoomPan.destroy()
    this.emitter.clear()
    this.history.clear()
    this.presented = null
    this.shadow.replaceChildren()
    if ('adoptedStyleSheets' in this.shadow) this.shadow.adoptedStyleSheets = []
    // Taken out with what the host mounted in it, which stays the host's.
    this.overlay.remove()
    mountedRoots.delete(this.shadow)
  }

  /**
   * The layers in force, as the layers menu (Task 11) or setOptions switch
   * them: the director ends what was switched off and repaints, and `keep`
   * says whether the choice is kept under the storage key.
   */
  private applyLayers(layers: ReplayLayers, keep: boolean): void {
    this.layers = { ...layers }
    if (keep) storeLayers(this.options, this.layers)
    this.layersMenu.setLayers(this.layers)
    this.renderHud()
    this.show(this.director.setLayers(this.layers))
    this.emitter.emit('layers', { ...this.layers })
  }

  /** A layer switched in the menu: the user's own choice, so it is kept. */
  private readonly onLayerToggle = (key: ReplayLayerKey): void => {
    if (this.destroyed) return
    this.applyLayers({ ...this.layers, [key]: !this.layers[key] }, true)
  }

  /** The HUD as the phase, the layers, the view and the options are now, and the pitch's name. */
  /** The debug badge, in developer mode, while too few players are tracked on the frame on screen. */
  private renderLoss(): void {
    this.lossBadge.update(this.loss, this.options.debug === true, this.resolved.text, this.resolved.teamName)
  }

  private renderHud(): void {
    this.phaseRow.update(this.phase, this.layers.phaseLabels, this.resolved)
    this.renderZoom()
    this.renderLoss()
    const name = this.resolved.text.pitchLabel
    if (this.canvas.getAttribute('aria-label') !== name) this.canvas.setAttribute('aria-label', name)
  }

  /**
   * What shows the zoom: the badge, and on the viewport the grab cursor, the
   * tooltip on getting back, and the touches it takes. At the whole pitch
   * one finger scrolls the page up and down; zoomed in, every touch is the
   * widget's, to pan and pinch.
   */
  private renderZoom(): void {
    const zoomed = this.view.zoom > 1
    this.zoomBadge.update(this.view.zoom, this.resolved.text)
    this.viewport.classList.toggle('mt-zoomed', zoomed)
    this.viewport.style.touchAction = zoomed ? 'none' : 'pan-y'
    this.viewport.title = zoomed ? this.resolved.text.zoomReset : ''
  }

  // ── The loop ──────────────────────────────────────────────────────────────

  private readonly tick = (nowMs: number): void => {
    if (this.destroyed || !this.visible()) return
    // Replay while the host's clock plays: the next display frame too, asked
    // for before anything here can throw. A host presenting from its own
    // animation frame then always finds this one due, rather than asking for
    // the frame after. Paused, hidden or out of view, the loop stops.
    if (this.mode === 'replay' && this.presented?.playing) this.loop.request()
    const input = this.nextInput(nowMs)
    if (!input) return
    this.lastInput = input
    this.show(this.director.update(input, this.directorView()))
    if (this.destroyed) return
    this.phase = input.phase
    this.renderHud()
    this.updateAvailability()
    if (this.destroyed) return
    if (this.stale) this.repaint()
  }

  /** What the director is to see at `nowMs`, or null in replay before anything is presented. */
  private nextInput(nowMs: number): DirectorInput | null {
    if (this.mode === 'live') {
      const record = this.history.latest()
      const { phase, trail } = this.derive([this.historyVersion], () =>
        record ? deriveAt(this.history.window(), record) : null,
      )
      const playback = !this.resumed
      const rejoining = this.rejoining
      // The seek is for the first record shown: a frame with nothing held,
      // as one queued before a reset, leaves it for that record.
      if (record) {
        this.resumed = false
        this.rejoining = false
      }
      return { nowMs, time: performance.now() / 1000, playing: true, playback, rejoining, record, phase, trail }
    }
    const state = this.presented
    if (!state) return null
    const playback = nextPlayback(this.flag, state.time, state.playing)
    this.flag = { time: state.time, playback }
    const { record, lookback } = state
    const { phase, trail } = this.derive([record, lookback], () =>
      record ? deriveAt(windowAt(lookback, record), record) : null,
    )
    return { nowMs, time: state.time, playing: state.playing, playback, record, phase, trail }
  }

  /** The phase and trail, worked out again only when one of `keys` has changed. */
  private derive(
    keys: readonly unknown[],
    work: () => { phase: TeamPhase; trail: BallTrail | null } | null,
  ): { phase: TeamPhase | null; trail: BallTrail | null } {
    const cached = this.derived
    if (cached && cached.keys.length === keys.length && cached.keys.every((k, i) => k === keys[i])) return cached
    const result = work()
    this.derived = { keys, phase: result?.phase ?? null, trail: result?.trail ?? null }
    return this.derived
  }

  /**
   * Take in what the director did: the view a sequence moved to, the
   * moments its paints start and end, in order, and the last paint drawn.
   */
  private show(out: DirectorOutput): void {
    if (this.destroyed) return
    if (out.camera) this.adoptCamera(out.camera)
    this.loss = out.loss
    this.renderLoss()
    for (const paint of out.paints) {
      for (const change of this.moments.next(paint.layers)) this.emitter.emit('moment', change)
    }
    // Asked for before drawing, so a draw that throws leaves the moments going.
    if (out.animating) this.loop.request()
    const last = out.paints.at(-1)
    if (last) this.draw(last)
  }

  /** Draw `paint` as the director made it: its frame and layers, in its view. */
  private draw(paint: DirectorPaint): void {
    if (!this.renderer) return
    if (!this.frameBox || !this.visible()) {
      this.stale = true
      return
    }
    if (!sameView(paint.view, this.rendererView)) {
      this.rendererView = { ...paint.view }
      this.renderer.setView(this.rendererView)
    }
    this.renderer.renderFrame(paint.frame, paint.layers)
    this.stale = false
  }

  /** Draw again what is on screen, through the director, as the reference's pushView paints. */
  private readonly repaint = (): void => {
    if (this.destroyed || !this.renderer) return
    if (!this.frameBox || !this.visible()) {
      this.stale = true
      return
    }
    this.show(this.director.setLayers(this.layers))
  }

  private visible(): boolean {
    return this.onScreen && this.doc.visibilityState !== 'hidden'
  }

  // ── The view ──────────────────────────────────────────────────────────────

  private directorView(): DirectorView {
    return { ...this.view, renderedWidth: this.frameBox?.width ?? 0 }
  }

  /**
   * A sequence moved the view: it is the widget's view from here, passed
   * back with every call, and the host hears of a new zoom. The director has
   * drawn in it already; the renderer gets it with the paint.
   */
  private adoptCamera(camera: DirectorCamera): void {
    const { zoom } = this.view
    this.view = { zoom: camera.zoom, panX: camera.panX, panY: camera.panY }
    this.viewMoved(zoom)
  }

  /**
   * The user moved the view (zoomPan.ts, which has already taken it over
   * from any sequence): the director pushes it and paints, as the
   * reference's view watcher does.
   */
  private readonly setUserView = (view: DirectorCamera): void => {
    if (this.destroyed) return
    const { zoom } = this.view
    this.view = { zoom: view.zoom, panX: view.panX, panY: view.panY }
    this.show(this.director.setView(this.directorView()))
    this.viewMoved(zoom)
  }

  /** The view is where it now is: show its zoom, and tell the host when that changed from `zoom`. */
  private viewMoved(zoom: number): void {
    this.renderZoom()
    if (this.view.zoom !== zoom) this.emitter.emit('zoom', { zoom: this.view.zoom })
  }

  // ── Sizing ────────────────────────────────────────────────────────────────

  private readonly measure = (): void => {
    if (this.destroyed) return
    const rect = this.viewport.getBoundingClientRect()
    const next = measureBox(rect, pixelRatio())
    // A hidden widget measures as nothing: the box it had stands.
    if (!next) return
    const moved = !sameBox(next, this.frameBox)
    this.frameBox = next
    for (const el of [this.canvas, this.overlayBox, this.hud]) place(el, next)
    this.layersMenu.setBox(next)
    const cleared = this.renderer ? sizeBitmap(this.canvas, next) : false
    // A new width changes how a pan in screen pixels lands, so it goes in as
    // a view change, which pushes the view and paints.
    if (moved || cleared) this.show(this.director.setView(this.directorView()))
    this.updateHostBox(rect, next)
  }

  /** The frame box from the host's top-left corner, said to the host when it moved or changed size. */
  private updateHostBox(viewport: DOMRect, box: FrameBox): void {
    if (this.destroyed) return
    const host = this.host.getBoundingClientRect()
    const next: TrackerBox = Object.freeze({
      left: viewport.left - host.left + box.left,
      top: viewport.top - host.top + box.top,
      width: box.width,
      height: box.height,
    })
    if (samePublicBox(next, this.hostBox)) return
    this.hostBox = next
    this.emitter.emit('box', next)
  }

  /**
   * Moving the window to a display with a different pixel ratio changes the
   * bitmap the box needs without changing its CSS size, so a resize observer
   * never hears of it. A resolution media query does, once per ratio.
   */
  private watchPixelRatio(): void {
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange)
    this.dprQuery = null
    if (typeof matchMedia !== 'function') return
    this.dprQuery = matchMedia(`(resolution: ${pixelRatio()}dppx)`)
    this.dprQuery.addEventListener('change', this.onPixelRatioChange)
  }

  private readonly onPixelRatioChange = (): void => {
    if (this.destroyed) return
    this.measure()
    this.watchPixelRatio()
  }

  // ── Visibility and the overlay ────────────────────────────────────────────

  private readonly onVisibilityChange = (): void => {
    if (this.doc.visibilityState === 'hidden') {
      this.wasHidden = true
      return
    }
    if (!this.wasHidden) return
    this.wasHidden = false
    this.resumeAfterAbsence()
  }

  private readonly onIntersection = (entries: IntersectionObserverEntry[]): void => {
    const entry = entries.at(-1)
    if (!entry) return
    const back = entry.isIntersecting && !this.onScreen
    this.onScreen = entry.isIntersecting
    if (back) this.resumeAfterAbsence()
  }

  /** Back in view after being hidden or scrolled away: catch up, and in live mode take it as a seek. */
  private resumeAfterAbsence(): void {
    if (this.destroyed) return
    if (this.mode === 'live') {
      // Unless a seek for another reason is waiting already.
      if (!this.resumed) this.rejoining = true
      this.resumed = true
    }
    this.stale = true
    this.loop.request()
  }

  /**
   * Someone wants the real frame, and their own view: every moment ends.
   * Not for a press in the host's own controls, marked
   * `data-match-tracker-keep` within the overlay.
   */
  private readonly onOverlayPointerDown = (event: Event): void => {
    if (this.destroyed || this.keeps(event.target)) return
    this.show(this.director.stopAll())
  }

  /** Whether `target` is in an element of the overlay marked `data-match-tracker-keep`, or is one. */
  private keeps(target: EventTarget | null): boolean {
    const closest = (target as Element | null)?.closest
    if (typeof closest !== 'function') return false
    const marked = closest.call(target, '[data-match-tracker-keep]')
    return marked !== null && this.overlay.contains(marked)
  }
}

/**
 * Mount a match tracker in a shadow root on `host`, which must be a plain
 * element without one: a shadow root of the page's own is never taken over.
 * A host a tracker was destroyed on can have a new one.
 */
export function createMatchTracker(host: HTMLElement, options: MatchTrackerOptions): MatchTracker {
  return new Tracker(host, options)
}
