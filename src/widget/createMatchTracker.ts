/**
 * The widget: a match tracker mounted in a shadow root on a host element,
 * driving one Director from either a live stream (`push`) or a replay host's
 * clock (`present`), and drawing what the director paints.
 *
 * Ported from PipelineOutputSurface.vue (video-annotation 6f14d1f): the
 * sizing and pixel-ratio watch (`:214-290`), font loading and the repaint
 * after it (`:1321-1345`), and the overlay's pointerdown, which stops every
 * moment (`:1471`). Live mode is the widget's own (spec, "Feeding it").
 *
 * ## The loop
 *
 * One animation frame loop, run only when something asks: an input, a moment
 * or fade still animating, a return to view. Each frame is one director
 * update, and the canvas is drawn only when the director paints. All the
 * paints of one call land in one display frame, so only the last is drawn,
 * with its own frame, layers and view; the goldens prove at the director
 * that its paints are the reference's, in order. The fonts or icons arriving
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
 */
import { deriveAt, windowAt } from '../analysis/derive.js'
import type { BallTrail } from '../analysis/ballTrail.js'
import type { TeamId, TeamPhase } from '../analysis/teamPhase.js'
import { ensureFonts } from '../assets/fonts.js'
import { loadIcons } from '../assets/icons.js'
import {
  Director,
  type DirectorCamera,
  type DirectorInput,
  type DirectorOutput,
  type DirectorPaint,
  type DirectorView,
  type MomentAvailability,
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
import { Emitter, MomentWatch, type TrackerEvents } from './events.js'
import { measureBox, pixelRatio, place, sameBox, sizeBitmap } from './layout.js'
import { PhaseRow, ZoomBadge } from './hud.js'
import { LayersMenu } from './layersMenu.js'
import { FrameLoop } from './loop.js'
import {
  directorOptions,
  initialLayers,
  resolveOptions,
  storeLayers,
  themeFor,
  type MatchTrackerOptions,
  type MutableOptions,
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
   * layer. Pointer events pass through it unless the host turns them on;
   * pressing on it stops every moment, so what is drawn on is the data.
   */
  readonly overlay: HTMLElement
  /** Live: one websocket message, in any form parseRecord reads. Anything unreadable is ignored. */
  push(message: unknown): void
  /** Replay: the state at the host's clock. */
  present(state: ReplayState): void
  /** Forget everything seen, for a reconnect or a new match. What follows is a seek. */
  reset(): void
  /** Play `moment` now, for `team` when it is an attack (default 0). False when nothing can be played. */
  trigger(moment: ReplayMoment, team?: TeamId): boolean
  setOptions(options: Partial<MutableOptions>): void
  on<K extends keyof TrackerEvents>(event: K, listener: (value: TrackerEvents[K]) => void): () => void
  /** Stop everything, and take the widget out of its host. Every method is a no-op after. */
  destroy(): void
}

type Renderer = ReturnType<typeof createRenderer>

/** Whether `moment` can be played for `team` on the frame on screen. */
function playable(availability: MomentAvailability, moment: ReplayMoment, team: TeamId): boolean {
  return moment === 'attack' ? availability.attack[team] : availability[moment]
}

const sameView = (a: DirectorView, b: DirectorView | null) =>
  b !== null && a.zoom === b.zoom && a.panX === b.panX && a.panY === b.panY && a.renderedWidth === b.renderedWidth

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

/** The widget's DOM, in `shadow`, as the reference's template lays out the stage. */
function build(shadow: ShadowRoot) {
  const root = div('mt-root')
  root.setAttribute('data-match-tracker-version', MATCH_TRACKER_VERSION)
  const viewport = div('mt-viewport')
  const canvas = document.createElement('canvas')
  canvas.className = 'mt-canvas'
  const overlayLayer = div('mt-overlay-layer')
  const overlay = div('mt-overlay')
  overlayLayer.append(overlay)
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
  return { root, viewport, canvas, overlay, hud }
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
  private icons: RenderTheme['icons'] = { freeKick: null, goal: null }
  private layers: ReplayLayers
  private readonly doc: Document
  private readonly shadow: ShadowRoot
  private readonly viewport: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly hud: HTMLElement
  private readonly phaseRow = new PhaseRow()
  private readonly layersMenu: LayersMenu
  private readonly zoomBadge: ZoomBadge
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

  private box: FrameBox | null = null
  /** The user's zoom and pan, or where a sequence has moved them. */
  private view: DirectorCamera = { zoom: 1, panX: 0, panY: 0 }
  /** The view the renderer was last given, or null before it was given one. */
  private rendererView: DirectorView | null = null

  /** Whether the tab was hidden since the last frame drawn: coming back is then a seek. */
  private wasHidden: boolean
  /** Whether the widget is in view, as the intersection observer last said. In view until it says otherwise. */
  private onScreen = true
  /** Live: whether the next update is a seek. True at mount, after a reset, and on coming back into view. */
  private resumed = true

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
    const { mode, ...rest } = options
    this.mode = mode
    this.options = rest
    this.resolved = resolveOptions(rest)
    this.layers = initialLayers(rest)
    this.doc = host.ownerDocument
    this.wasHidden = this.doc.visibilityState === 'hidden'

    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    const dom = build(this.shadow)
    this.viewport = dom.viewport
    this.canvas = dom.canvas
    this.overlay = dom.overlay
    this.hud = dom.hud
    this.layersMenu = new LayersMenu(this.shadow, this.onLayerToggle)
    this.zoomBadge = new ZoomBadge(this.hud)
    this.hud.append(this.phaseRow.box, this.layersMenu.el)
    this.layersMenu.setText(this.resolved.text)
    this.layersMenu.setLayers(this.layers)
    this.renderHud()

    this.renderer = rendererFor(this.canvas, themeFor(this.resolved, this.icons))
    // Frame size is a sane bitmap until the box arrives, as in the reference.
    if (this.renderer) sizeBitmap(this.canvas, null)
    this.director = new Director({ layers: this.layers, ...directorOptions(this.resolved) })
    this.loop = new FrameLoop(this.tick)

    this.overlay.addEventListener('pointerdown', this.onOverlayPointerDown, { capture: true })
    this.zoomPan = new ZoomPan(this.viewport, {
      view: () => this.view,
      takeCamera: () => this.director.releaseCamera(),
      setView: this.setUserView,
    })
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
    if (!record || !this.history.add(record)) return
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
    this.lastInput = null
    this.resumed = true
    // The director stops its moments without a paint.
    for (const change of this.moments.clear()) this.emitter.emit('moment', change)
  }

  trigger(moment: ReplayMoment, team: TeamId = 0): boolean {
    if (this.destroyed) return false
    // A frame due now is run first, so the moment plays on what is on screen by now.
    this.loop.flush(performance.now())
    const input = this.lastInput
    // What the director can play is read from the frame it was last given,
    // which is `input`: taking it in again inside trigger changes nothing.
    if (!input || !playable(this.director.availability(), moment, team)) return false
    const out = this.director.trigger(moment, team, input, this.directorView())
    if (!out) return false
    this.show(out)
    return true
  }

  setOptions(options: Partial<MutableOptions>): void {
    if (this.destroyed) return
    // The mode is fixed at mount; a caller passing it anyway is ignored.
    const { mode: _mode, ...rest } = options as Partial<MatchTrackerOptions>
    this.options = { ...this.options, ...rest }
    this.resolved = resolveOptions(this.options)
    this.renderer?.setTheme(themeFor(this.resolved, this.icons))
    this.director.setOptions(directorOptions(this.resolved))
    this.layersMenu.setText(this.resolved.text)
    this.renderHud()
    const layers = rest.layers ? { ...this.layers, ...rest.layers } : this.layers
    if (Object.entries(layers).some(([key, on]) => this.layers[key as keyof ReplayLayers] !== on)) {
      this.applyLayers(layers, false)
    } else {
      this.repaint()
    }
  }

  on<K extends keyof TrackerEvents>(event: K, listener: (value: TrackerEvents[K]) => void): () => void {
    if (this.destroyed) return () => {}
    return this.emitter.on(event, listener)
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

  /** The HUD as the phase, the layers, the view and the options are now. */
  private renderHud(): void {
    this.phaseRow.update(this.phase, this.layers.phaseLabels, this.resolved)
    this.renderZoom()
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
    const input = this.nextInput(nowMs)
    if (!input) return
    this.lastInput = input
    this.show(this.director.update(input, this.directorView()))
    if (this.destroyed) return
    this.phase = input.phase
    this.renderHud()
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
      this.resumed = false
      return { nowMs, time: performance.now() / 1000, playing: true, playback, record, phase, trail }
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
    for (const paint of out.paints) {
      for (const change of this.moments.next(paint.layers)) this.emitter.emit('moment', change)
    }
    const last = out.paints.at(-1)
    if (last) this.draw(last)
    if (out.animating) this.loop.request()
  }

  /** Draw `paint` as the director made it: its frame and layers, in its view. */
  private draw(paint: DirectorPaint): void {
    if (!this.renderer) return
    if (!this.box || !this.visible()) {
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
    if (!this.box || !this.visible()) {
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
    return { ...this.view, renderedWidth: this.box?.width ?? 0 }
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
    const next = measureBox(this.viewport.getBoundingClientRect(), pixelRatio())
    // A hidden widget measures as nothing: the box it had stands.
    if (!next) return
    const moved = !sameBox(next, this.box)
    this.box = next
    for (const el of [this.canvas, this.overlay, this.hud]) place(el, next)
    this.layersMenu.setBox(next)
    const cleared = this.renderer ? sizeBitmap(this.canvas, next) : false
    // A new width changes how a pan in screen pixels lands, so it goes in as
    // a view change, which pushes the view and paints.
    if (moved || cleared) this.show(this.director.setView(this.directorView()))
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
    if (this.mode === 'live') this.resumed = true
    this.stale = true
    this.loop.request()
  }

  /** Someone wants the real frame, and their own view: every moment ends. */
  private readonly onOverlayPointerDown = (): void => {
    if (this.destroyed) return
    this.show(this.director.stopAll())
  }
}

/** Mount a match tracker in `host`'s shadow root. */
export function createMatchTracker(host: HTMLElement, options: MatchTrackerOptions): MatchTracker {
  return new Tracker(host, options)
}
