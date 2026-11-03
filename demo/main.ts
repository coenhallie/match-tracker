/**
 * The demo page (`npm run dev`): the test fixtures played through two
 * widgets, one live and one in replay, with every control the widget has a
 * host for. Also the hooks the size and performance checks use, on
 * `window.demo`.
 */
import {
  createMatchTracker,
  logMatchTrackerBanner,
  parseRecord,
  type MatchTracker,
  type ReplayMoment,
  type TeamId,
} from '../src/index.js'
import type { TrackerRecord } from '../src/model/types.js'
import { HISTORY_S, deriveAt, windowAt } from '../src/analysis/derive.js'
import { Director, type DirectorInput, type DirectorPaint } from '../src/director/director.js'
import { DEFAULT_REPLAY_LAYERS } from '../src/model/replayLayers.js'
import { createRenderer } from '../src/render/renderer.js'
import { measureBox, sizeBitmap } from '../src/widget/layout.js'
import { directorOptions, resolveOptions, themeFor } from '../src/widget/options.js'
import { loadIcons } from '../src/assets/icons.js'

// ── Timing every animation frame the widgets ask for ─────────────────────────

/** The page's own clock and timers use the browser's rAF; the widgets get this timed one. */
const nativeRaf = window.requestAnimationFrame.bind(window)

interface FrameSample {
  /** The rAF timestamp, in ms. */
  at: number
  /** How long the widget's callback took, in ms. */
  took: number
}

const perf = {
  recording: false,
  samples: [] as FrameSample[],
  start() {
    perf.samples = []
    perf.recording = true
  },
  /** Callback times and the gaps between frames, while recording. */
  stop() {
    perf.recording = false
    const took = perf.samples.map((s) => s.took).toSorted((a, b) => a - b)
    const gaps = perf.samples.slice(1).map((s, i) => s.at - perf.samples[i]!.at)
    return {
      frames: perf.samples.length,
      took: stats(took),
      gaps: stats(gaps.toSorted((a, b) => a - b)),
      samples: perf.samples,
    }
  },
}

function stats(sorted: number[]) {
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const mean = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)
  return { n: sorted.length, mean, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0 }
}

window.requestAnimationFrame = (callback) =>
  nativeRaf((at) => {
    const t0 = performance.now()
    callback(at)
    if (perf.recording) perf.samples.push({ at, took: performance.now() - t0 })
  })

// ── Data ──────────────────────────────────────────────────────────────────────

interface Source {
  /** What the socket would send, one message per record. */
  messages: string[]
  records: TrackerRecord[]
  /**
   * When each record comes in the demo, in seconds from the first: its own
   * time, with every gap over GAP_S (the excerpt is stretches of a match,
   * minutes apart) cut to GAP_S.
   */
  at: number[]
  teamNames: [string, string] | null
  /**
   * Made up rather than recorded: the golden goal has six players throughout,
   * which would be a player loss from start to end, so its attack over lost
   * players is off.
   */
  synthetic: boolean
}

const GAP_S = 1

function timeline(records: TrackerRecord[]): number[] {
  const at: number[] = []
  records.forEach((r, i) => {
    const prev = records[i - 1]
    at.push(prev ? at[i - 1]! + Math.min(GAP_S, Math.max(0, r.t - prev.t)) : 0)
  })
  return at
}

async function loadSource(name: string): Promise<Source> {
  if (name === 'excerpt' || name === 'loss') {
    const file = name === 'excerpt' ? 'excerpt.json' : 'player-loss.json'
    const messages = (await (await fetch(`/demo/fixtures/${file}`)).json()) as string[]
    const records = messages.map((m) => parseRecord(m)).filter((r): r is TrackerRecord => r !== null)
    return { messages, records, at: timeline(records), teamNames: null, synthetic: false }
  }
  const golden = (await (await fetch('/demo/fixtures/goal.json')).json()) as {
    records: TrackerRecord[]
    teamNames: [string, string]
  }
  // The recording's frames carry no frame_uuid, which is where a socket message has its time.
  const messages = golden.records.map((r) =>
    JSON.stringify({
      match: {
        ...r.frame,
        frame_data: [{ frame_count: r.frameCount, frame_uuid: [{ timestamp: r.t, uuid: `${r.frameCount}` }] }],
      },
    }),
  )
  return {
    messages,
    records: golden.records,
    at: timeline(golden.records),
    teamNames: golden.teamNames,
    synthetic: true,
  }
}

// ── The page ──────────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const liveHost = $<HTMLDivElement>('live')
const replayHost = $<HTMLDivElement>('replay')

let locale: 'en' | 'zh' = 'en'
let source: Source | null = null
let live: MatchTracker | null = null
let replay: MatchTracker | null = null

const MOMENTS: Array<{ label: string; moment: ReplayMoment; team?: TeamId }> = [
  { label: 'Goal', moment: 'goal' },
  { label: 'Home attack', moment: 'attack', team: 0 },
  { label: 'Away attack', moment: 'attack', team: 1 },
  { label: 'Free kick', moment: 'freeKick' },
  { label: 'Corner', moment: 'corner' },
  { label: 'Throw-in', moment: 'throwIn' },
]

/** Draws per widget: each renderFrame clears the canvas once. */
const draws = { live: 0, replay: 0 }

function countDraws(host: HTMLElement, key: keyof typeof draws): void {
  const ctx = host.shadowRoot?.querySelector('canvas')?.getContext('2d')
  if (!ctx) return
  const clearRect = ctx.clearRect.bind(ctx)
  ctx.clearRect = (...args: Parameters<CanvasRenderingContext2D['clearRect']>) => {
    draws[key]++
    clearRect(...args)
  }
}

/** When each widget's last trigger button was pressed, so a screenshot says how far into its moment it is. */
const pressed: Record<keyof typeof draws, number | null> = { live: null, replay: null }

function showDraws(): void {
  $('draws').textContent = `draws: live ${draws.live}, replay ${draws.replay}`
  for (const key of ['live', 'replay'] as const) {
    const at = pressed[key]
    $(`${key}-since`).textContent = at === null ? '' : `${Math.round(performance.now() - at)} ms since the trigger`
  }
  nativeRaf(showDraws)
}

function teams() {
  const names = source?.teamNames
  return names ? { home: { name: names[0] }, away: { name: names[1] } } : {}
}

/** Newest first; a run of lines of one kind (a zoom easing back) is one line, the latest. */
function log(id: string, line: string, kind = line): void {
  const el = $(id)
  const lines = (el.textContent ?? '').split('\n').filter(Boolean)
  if (el.dataset.kind === kind) lines.shift()
  el.dataset.kind = kind
  el.textContent = [line, ...lines].slice(0, 6).join('\n')
}

/** Every moment event, for the checks: which widget, what, and when (performance.now). */
const events: Array<{ widget: string; moment: ReplayMoment; phase: 'start' | 'end'; at: number }> = []

/** The trigger buttons of each widget, which its moment availability enables. */
const buttons: Record<keyof typeof draws, HTMLButtonElement[]> = { live: [], replay: [] }

function mount(host: HTMLElement, mode: 'live' | 'replay', status: string, key: keyof typeof draws): MatchTracker {
  const tracker = createMatchTracker(host, {
    mode,
    locale,
    teams: teams(),
    layersStorageKey: null,
    debug: $<HTMLInputElement>('debug').checked,
    ...(source?.synthetic ? { layers: { playerLoss: false } } : {}),
  })
  // Mounted in the overlay and styled by this page's stylesheet: the pitch's box, as the tracker reports it.
  const badge = document.createElement('div')
  badge.className = 'demo-badge'
  badge.dataset.testid = 'overlay-badge'
  const showBox = () => {
    const box = tracker.box
    badge.textContent = box ? `box ${Math.round(box.width)}×${Math.round(box.height)} at ${Math.round(box.left)},${Math.round(box.top)}` : 'no box'
  }
  showBox()
  tracker.overlay.append(badge)
  tracker.on('box', showBox)
  if (mode === 'replay') {
    // The page's own transport over the pitch, kept: pressing it neither ends a moment nor pans or resets the zoom.
    const transport = document.createElement('button')
    transport.type = 'button'
    transport.className = 'demo-transport'
    transport.dataset.testid = 'overlay-transport'
    transport.setAttribute('data-match-tracker-keep', '')
    transport.textContent = clock.playing ? 'Pause' : 'Play'
    transport.addEventListener('click', togglePlay)
    tracker.overlay.append(transport)
  }
  const enable = () => {
    const can = tracker.availability()
    for (const button of buttons[key]) {
      const [moment, team] = (button.dataset.moment ?? '').split('-') as [ReplayMoment, string | undefined]
      button.disabled = !(moment === 'attack' ? can.attack[Number(team) as TeamId] : can[moment])
    }
  }
  enable()
  tracker.on('availability', enable)
  tracker.on('moment', ({ moment, phase }) => {
    events.push({ widget: key, moment, phase, at: performance.now() })
    log(status, `${moment} ${phase}`)
  })
  tracker.on('zoom', ({ zoom }) => log(status, `zoom ${zoom.toFixed(2)}`, 'zoom'))
  tracker.on('layers', () => log(status, 'layers changed'))
  countDraws(host, key)
  return tracker
}

function triggers(key: keyof typeof draws, tracker: () => MatchTracker | null): void {
  const row = $(`${key}-triggers`)
  const status = `${key}-status`
  for (const { label, moment, team } of MOMENTS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.dataset.moment = team === undefined ? moment : `${moment}-${team}`
    button.disabled = true
    buttons[key].push(button)
    button.addEventListener('click', () => {
      pressed[key] = performance.now()
      const played = tracker()?.trigger(moment, team) ?? false
      log(status, `trigger ${label}: ${played ? 'played' : 'nothing to play'}`)
    })
    row.append(button)
  }
  const since = document.createElement('span')
  since.id = `${key}-since`
  since.className = 'status'
  row.append(since)
}

// ── Live: pushed on a timer, at the pace the records were made ───────────────

let liveTimer: ReturnType<typeof setTimeout> | undefined
let liveIndex = 0

function pushNext(): void {
  if (!source || !live) return
  const { messages, at } = source
  if (liveIndex >= messages.length) {
    // The fixture again from the top: a new match to the widget, so it forgets the last pass.
    liveIndex = 0
    live.reset()
  }
  live.push(messages[liveIndex])
  const now = at[liveIndex] ?? 0
  liveIndex++
  const next = at[liveIndex]
  const wait = next === undefined ? 1000 : (next - now) * 1000
  $('live-status').dataset.pushed = String(liveIndex)
  liveTimer = setTimeout(pushNext, wait)
}

// ── Replay: the page's clock, on the demo's timeline ─────────────────────────

const clock = { time: 0, playing: true, last: 0 }
const seek = $<HTMLInputElement>('seek')

/** The index of the last record in by `time`, or -1 before the first. */
function indexAt(at: number[], time: number): number {
  let lo = 0
  let hi = at.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (at[mid]! <= time) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

function present(): void {
  if (!source || !replay) return
  const { records, at } = source
  const record = records[indexAt(at, clock.time)] ?? null
  // The records the host holds back to the lookback, by the records' own time.
  const lookback = record ? records.filter((r) => r.t >= record.t - HISTORY_S && r.t <= record.t) : []
  replay.present({ time: clock.time, playing: clock.playing, record, lookback })
  seek.value = String(clock.time)
  $('clock').textContent = `${clock.time.toFixed(2)} s`
}

function replayTick(at: number): void {
  if (source && clock.playing) {
    const end = source.at.at(-1) ?? 0
    clock.time += clock.last ? Math.min(0.1, (at - clock.last) / 1000) : 0
    // Round again from the start, which the widget takes as a seek.
    if (clock.time > end) clock.time = 0
    present()
  }
  clock.last = at
  nativeRaf(replayTick)
}

/** Play or pause, from the button under the widget or the transport over its pitch. */
function togglePlay(): void {
  clock.playing = !clock.playing
  const label = clock.playing ? 'Pause' : 'Play'
  $('play').textContent = label
  const transport = replay?.overlay.querySelector('.demo-transport')
  if (transport) transport.textContent = label
  present()
}

$('play').addEventListener('click', togglePlay)
seek.addEventListener('input', () => {
  clock.time = Number(seek.value)
  present()
})

// ── Controls ──────────────────────────────────────────────────────────────────

async function start(name: string): Promise<void> {
  clearTimeout(liveTimer)
  live?.destroy()
  replay?.destroy()
  live = replay = null
  source = await loadSource(name)
  live = mount(liveHost, 'live', 'live-status', 'live')
  replay = mount(replayHost, 'replay', 'replay-status', 'replay')
  liveIndex = 0
  pushNext()
  seek.min = '0'
  seek.max = String(source.at.at(-1) ?? 0)
  clock.time = 0
  present()
}

function setWidth(width: number): void {
  for (const host of [liveHost, replayHost]) {
    host.style.width = `${width}px`
    // The pitch is 16:9 under the 40 px attacking/defending row.
    host.style.height = `${Math.round((width * 9) / 16) + 40}px`
  }
}

$<HTMLSelectElement>('source').addEventListener('change', (e) => void start((e.target as HTMLSelectElement).value))
$<HTMLSelectElement>('width').addEventListener('change', (e) => setWidth(Number((e.target as HTMLSelectElement).value)))
$('locale').addEventListener('click', () => {
  locale = locale === 'en' ? 'zh' : 'en'
  $('locale').textContent = `Locale: ${locale}`
  live?.setOptions({ locale })
  replay?.setOptions({ locale })
})

const HOSTILE = '* { box-sizing: content-box; font: 30px serif } canvas { filter: invert(1) }'
$<HTMLInputElement>('hostile').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked
  document.getElementById('hostile-css')?.remove()
  if (!on) return
  const style = document.createElement('style')
  style.id = 'hostile-css'
  style.textContent = HOSTILE
  document.head.append(style)
})

// Developer mode: the player loss badge, which says when an attack is shown over lost players.
$<HTMLInputElement>('debug').addEventListener('change', (e) => {
  const debug = (e.target as HTMLInputElement).checked
  live?.setOptions({ debug })
  replay?.setOptions({ debug })
})

// The version banner in the console, which the widget prints only when its host asks.
logMatchTrackerBanner()
triggers('live', () => live)
triggers('replay', () => replay)
setWidth(768)
showDraws()
nativeRaf(replayTick)
void start('goal')

// ── The draw benchmark ────────────────────────────────────────────────────────

/**
 * The goal sequence's paints, drawn by the widget's own renderer on a canvas
 * the widget would size for `width` CSS px at this page's pixel ratio:
 * `cpu` is the main thread's time per draw over `rounds` passes, and
 * `withRaster` the time per draw of one more pass with the canvas read back
 * once at its end, which waits for the drawing to be done.
 */
async function bench(width = 1280, rounds = 3) {
  const golden = await loadSource('goal')
  const [home, away] = golden.teamNames!
  const resolved = resolveOptions({ teams: { home: { name: home }, away: { name: away } } })
  const director = new Director({ layers: { ...DEFAULT_REPLAY_LAYERS }, ...directorOptions(resolved) })
  const box = measureBox({ left: 0, top: 0, width, height: (width * 9) / 16 + 40 }, devicePixelRatio || 1)!
  const view = { zoom: 1, panX: 0, panY: 0, renderedWidth: box.width }
  const paints: DirectorPaint[] = []
  const records = golden.records
  let nowMs = 1000
  let previous: DirectorInput | null = null
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const { phase, trail } = deriveAt(windowAt(records, record), record)
    // Every record held for 40 ms of 60 Hz frames, as the replay would show it.
    for (let f = 0; f < 3; f++) {
      nowMs += 1000 / 60
      const time = record.t + f / 60
      const input: DirectorInput = { nowMs, time, playing: true, playback: previous !== null, record, phase, trail }
      const out = director.update(input, view)
      const last = out.paints.at(-1)
      if (last && (last.layers.goal || last.layers.goalBanner)) paints.push(last)
      previous = input
    }
  }
  const canvas = document.createElement('canvas')
  canvas.style.cssText = `position: fixed; left: 0; top: 0; opacity: 0.01`
  Object.assign(canvas.style, { width: `${box.width}px`, height: `${box.height}px` })
  document.body.append(canvas)
  sizeBitmap(canvas, box)
  const renderer = createRenderer(canvas, themeFor(resolved, await loadIcons()))
  const ctx = canvas.getContext('2d')!
  const cpu: number[] = []
  const withRaster: number[] = []
  for (let round = 0; round < rounds; round++) {
    for (const paint of paints) {
      renderer.setView(paint.view)
      const a = performance.now()
      renderer.renderFrame(paint.frame, paint.layers)
      cpu.push(performance.now() - a)
    }
    await new Promise((resolve) => nativeRaf(resolve))
  }
  // Last, as reading a canvas back can move Chrome to drawing it in software, which would slow every draw after.
  const t0 = performance.now()
  for (const paint of paints) {
    renderer.setView(paint.view)
    renderer.renderFrame(paint.frame, paint.layers)
  }
  ctx.getImageData(0, 0, 1, 1)
  withRaster.push((performance.now() - t0) / paints.length)
  canvas.remove()
  return {
    bitmap: `${canvas.width}x${canvas.height}`,
    dpr: devicePixelRatio,
    paints: paints.length,
    // The first draw also builds the pitch's cache, as after every mount or resize.
    first: cpu[0],
    // Draws over the 4 ms target, as [index of the draw, ms]: 193 a round.
    over4ms: cpu.flatMap((ms, i) => (ms > 4 ? [[i, ms]] : [])),
    cpu: stats(cpu.slice(1).toSorted((a, b) => a - b)),
    withRaster: withRaster[0],
  }
}

const demo = {
  get live() {
    return live
  },
  get replay() {
    return replay
  },
  draws,
  events,
  perf,
  bench,
  clock,
  start,
}
Object.assign(window, { demo })
