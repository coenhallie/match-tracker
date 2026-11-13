/**
 * Flashbacks in the live widget: while the live camera is away for a run of
 * 5 s or more, an earlier clip of live play is drawn in place of the held
 * frame, marked as a replay, and live play takes over again at once.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, type MatchTracker, type MatchTrackerOptions } from '../../src/index'
import { carriedValidity, type CarriedValidity } from '../../src/model/validity'
import { parseRecord } from '../../src/model/parseRecord'
import type { Frame, RecordValidity, TrackerRecord } from '../../src/model/types'
import type { FrameLayers } from '../../src/render/renderer'
import { FakeIntersectionObserver, installEnv, makeHost, type Env } from './env'
import { control } from './recording'
import { message } from './messages'
import { SCORER_WAIT_S } from '../../src/director/goal'
import { STYLES } from '../../src/widget/styles'

vi.mock('../../src/director/director', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/director/director')>()
  const { recordingDirector } = await import('./recording')
  return { ...real, Director: recordingDirector(real.Director) }
})
vi.mock('../../src/render/renderer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/render/renderer')>()
  const { recordingRenderer } = await import('./recording')
  return { ...real, createRenderer: recordingRenderer(real.createRenderer) }
})

/** The fonts, loading until a test says they are in. */
const fonts = vi.hoisted(() => {
  const gate = {
    resolve: () => {},
    promise: Promise.resolve(),
    reset() {
      gate.promise = new Promise<void>((done) => {
        gate.resolve = done
      })
    },
  }
  return gate
})
vi.mock('../../src/assets/fonts', () => ({ ensureFonts: () => fonts.promise, fontGeneration: () => 0 }))

/** The lookahead's horizon as the staging stream sends it: never exactly 10. */
const HORIZON = 9.999999999990905
const T0 = 2700
const FIRST_FRAME = 55149

let env: Env
const mounted: MatchTracker[] = []

function mount(options: Partial<MatchTrackerOptions> = {}) {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...options })
  mounted.push(tracker)
  env.resize(host, 1280, 760)
  return { host, tracker }
}

/** Valid, valid with an invalid record due in `invalidIn` s, a run of 10 s or more, a run ending in `validIn` s, or no validity. */
type State = 'valid' | 'long' | 'none' | { validIn: number } | { invalidIn: number }

interface Shape {
  /** The ball's x, in metres from the centre spot. */
  ballX?: number
  /** The team with a player on the ball. */
  carrier?: 0 | 1
  /** Human labels on the record: a name, or the label as a whole, with a team say. */
  labels?: Array<string | Record<string, unknown>>
}

function rawData(state: Exclude<State, 'none'>) {
  const invalid = state === 'long' || (typeof state === 'object' && 'validIn' in state)
  const nextValid = state === 'long' ? null : typeof state === 'object' && 'validIn' in state ? state.validIn : 0
  const nextInvalid = invalid ? 0 : typeof state === 'object' && 'invalidIn' in state ? state.invalidIn : null
  return {
    source_frame: { frame_state: invalid ? 'invalid' : 'valid' },
    agentic: { lookahead: { horizon_s: HORIZON, next_invalid_in_s: nextInvalid, next_valid_in_s: nextValid } },
  }
}

/** Message `i`, at record time `t`, in `state`, shaped as `shape` says. */
function msg(i: number, t: number, state: State, shape: Shape = {}): string {
  const parsed = JSON.parse(message(i, { withBall: true, t })) as {
    match: {
      balls: Array<{ projected_coordinates: { x: number } }>
      teams: Array<{ team_id: number; players: Array<{ in_possession?: boolean }> }>
      state?: unknown
    }
    raw_data?: unknown
  }
  if (shape.ballX !== undefined) parsed.match.balls[0]!.projected_coordinates.x = shape.ballX
  if (shape.carrier !== undefined) {
    const team = parsed.match.teams.find((tm) => tm.team_id === shape.carrier)!
    team.players[1]!.in_possession = true
  }
  if (shape.labels) {
    parsed.match.state = {
      actions: shape.labels.map((label) =>
        typeof label === 'string' ? { action_type: label, action_origin: 'human' } : { action_origin: 'human', ...label },
      ),
    }
  }
  if (state !== 'none') parsed.raw_data = rawData(state)
  return JSON.stringify(parsed)
}

/** A live stream at 25 Hz, one animation frame of 40 ms after each record. */
class Stream {
  i = 0
  constructor(
    readonly tracker: MatchTracker,
    readonly stepS = 0.04,
  ) {}

  /** The record time of record `i`. */
  t(i = this.i): number {
    return T0 + i * this.stepS
  }

  /** `n` records in `state`, each shaped by `shape(i)`. */
  push(n: number, state: State, shape: (i: number) => Shape = () => ({})): void {
    for (let k = 0; k < n; k++) {
      this.tracker.push(msg(this.i, this.t(), state, shape(this.i)))
      this.i++
      env.frame(this.stepS * 1000)
    }
  }
}

const frameNo = (frame: Frame) => frame.frame_data?.[0]?.frame_count ?? -1
/** Every frame drawn from `from` on. */
const drawnSince = (from: number) => control.drawn.slice(from)

/** The flashback and moment events, as `flashback:start@at` and `moment:goal:start`. */
function events(tracker: MatchTracker): string[] {
  const out: string[] = []
  tracker.on('flashback', ({ phase, at }) => out.push(`flashback:${phase}@${at}`))
  tracker.on('moment', ({ moment, phase }) => out.push(`moment:${moment}:${phase}`))
  return out
}

/**
 * 20 s of valid play with a human goal at 4 s, then a long run: the clip is the goal's, and the
 * run starts at record `RUN`. Returns the goal's record time.
 */
const RUN = 500
const GOAL = 100
function goalThenRun(stream: Stream, runRecords = 50, shape: (i: number) => Shape = () => ({})): number {
  stream.push(RUN, 'valid', (i) => ({ ...shape(i), ...(i === GOAL ? { labels: ['goal'] } : {}) }))
  stream.push(runRecords, 'long', shape)
  return stream.t(GOAL)
}

/**
 * Goals as the labelling tool labels them: "Goal" on each record of `at`, and the scorer on the
 * record after it. A goal waits for its scorer live (goal.ts, "The scorer"): with them a record on,
 * it plays then, well clear of a run that starts soon after it.
 */
const scoredGoals =
  (...at: number[]) =>
  (i: number): Shape =>
    at.includes(i) ? { labels: ['goal'] } : at.includes(i - 1) ? { labels: ['Player scored'] } : {}

const isClip = (frame: Frame) => frameNo(frame) < FIRST_FRAME + RUN

/** Run one animation frame of `ms`: what was drawn in it, and whether director `index` painted in it. */
function frameOf(ms: number, index: number): { drawn: typeof control.drawn; painted: boolean } {
  const drawnFrom = control.drawn.length
  const updatesFrom = control.outputs.length
  env.frame(ms)
  const painted = control.outputs.some((out, k) => k >= updatesFrom && control.updatedBy[k] === index && out.paint)
  return { drawn: control.drawn.slice(drawnFrom), painted }
}
const press = (tracker: MatchTracker) => tracker.overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }))

beforeEach(() => {
  env = installEnv()
  control.reset()
  fonts.reset()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('flashbacks in live mode', () => {
  it('replays a goal while a long run is invalid, then goes back to live on the first valid record', () => {
    const { tracker } = mount()
    const log = events(tracker)
    const stream = new Stream(tracker)
    stream.push(RUN, 'valid', (i) => (i === GOAL ? { labels: ['goal'] } : {}))
    log.length = 0
    const from = control.drawn.length
    stream.push(50, 'long')
    const during = drawnSince(from)
    expect(during.length).toBeGreaterThan(0)
    expect(during.every(({ frame }) => isClip(frame))).toBe(true)
    const alphas = during.map(({ layers }) => layers?.flashback?.alpha ?? -1)
    expect(alphas.every((a) => a >= 0)).toBe(true)
    expect(alphas.every((a, k) => k === 0 || a >= alphas[k - 1]!)).toBe(true)
    expect(alphas.at(-1)).toBe(1)
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([`flashback:start@${stream.t(GOAL)}`])

    const back = control.drawn.length
    stream.push(1, 'valid')
    const live = drawnSince(back)
    expect(live.length).toBeGreaterThan(0)
    expect(frameNo(live[0]!.frame)).toBe(FIRST_FRAME + RUN + 50)
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([
      `flashback:start@${stream.t(GOAL)}`,
      `flashback:end@${stream.t(GOAL)}`,
    ])
  })

  it('holds a replay back while a goal waits for its scorer: the goal plays first, then the replay', () => {
    const { tracker } = mount()
    const stream = new Stream(tracker)
    // The camera goes away 2 s after a goal, before its scorer comes, as it does for the replays on
    // television: the goal waits for its scorer, SCORER_WAIT_S, and no replay starts meanwhile.
    const LATE = RUN - 50
    stream.push(RUN, 'valid', (i) => (i === GOAL || i === LATE ? { labels: ['goal'] } : {}))
    const log = events(tracker)
    // The goal and the replays alone: the attack covering the run comes and goes as it would.
    const shown = () => log.filter((e) => e.startsWith('flashback') || e.startsWith('moment:goal'))
    stream.push(Math.round((SCORER_WAIT_S - 2.2) / 0.04), 'long')
    expect(shown()).toEqual([])
    stream.push(250, 'long')
    // The first goal's clip: the late one is within LABEL_REARM_S of it, and is not a clip of its own.
    expect(shown().slice(0, 3)).toEqual(['moment:goal:start', 'moment:goal:end', `flashback:start@${stream.t(GOAL)}`])
  })

  it('cuts a replay playing as a goal is labelled, before its scorer comes: a human label goes first', () => {
    const { tracker } = mount()
    const stream = new Stream(tracker)
    const log = events(tracker)
    goalThenRun(stream, 25)
    const from = log.length
    const since = () => log.slice(from).filter((e) => e.startsWith('flashback') || e.startsWith('moment:goal'))
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([`flashback:start@${stream.t(GOAL)}`])
    // The camera still away, a goal is labelled on the held frame, and no scorer comes.
    stream.push(1, 'long', () => ({ labels: [{ action_type: 'Goal', team_id: 0 }] }))
    stream.push(1, 'long')
    expect(since()).toEqual([`flashback:end@${stream.t(GOAL)}`])
    // It plays once its wait is over, on the live frame.
    stream.push(Math.round(SCORER_WAIT_S / 0.04) + 5, 'long')
    expect(since()).toEqual([`flashback:end@${stream.t(GOAL)}`, 'moment:goal:start'])
  })

  it('names who a label names in a replay, as live: the corner’s team, the card’s player', () => {
    const { tracker } = mount({ teams: { home: { name: 'Ajax' }, away: { name: 'PSV' } } })
    const stream = new Stream(tracker)
    const CARD = GOAL - 50
    // Play moves on, so the live corner, held while play is stopped, ends before the run.
    const moving = (i: number): Shape => ({ ballX: -20 + (i % 200) * 0.2 })
    stream.push(RUN, 'valid', (i) => ({
      ...moving(i),
      ...(i === GOAL
        ? { labels: [{ action_type: 'Corner kick - Bottom right', uuid: 'c', team_id: 1 }] }
        : i === CARD
          ? { labels: [{ action_type: 'Player yellow card', uuid: 'y', team_id: 0, player_number: 9, player_name: 'Lando' }] }
          : {}),
    }))
    const from = control.drawn.length
    stream.push(200, 'long', moving)
    const during = drawnSince(from).filter(({ frame }) => isClip(frame))
    const card = during.find(({ layers }) => layers?.labelCard?.player)?.layers?.labelCard?.player
    expect(card).toMatchObject({ team: 'Ajax', player: 'Lando' })
    const corner = during.find(({ layers }) => layers?.corner)?.layers?.corner
    expect(corner).toMatchObject({ corner: { x: 1, y: 1 }, team: 'PSV' })
  })

  it('plays no replay over a live free kick held through a cutaway, as for a corner, and keeps the clip for the next', () => {
    const { tracker } = mount()
    const log = events(tracker)
    const stream = new Stream(tracker)
    // A goal kept as a clip, then a free kick just before the camera goes away.
    const KICK = RUN - 5
    const moving = (i: number): Shape => ({ ballX: -20 + (i % 200) * 0.2 })
    stream.push(RUN, 'valid', (i) => ({ ...moving(i), ...(i === GOAL ? { labels: ['goal'] } : i === KICK ? { labels: ['Freekick'] } : {}) }))
    expect(control.drawn.at(-1)!.layers?.freeKick).toBeDefined()
    log.length = 0
    // Live play holds its last valid frame through the cutaway, so the free kick, held while play is
    // stopped, stays: no replay plays over it, the whole run long.
    stream.push(200, 'long', moving)
    expect(control.drawn.at(-1)!.layers?.freeKick).toBeDefined()
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([])
    // Play back: the free kick goes, and the goal's clip plays at the next cutaway.
    stream.push(100, 'valid', moving)
    expect(log).toContain('moment:freeKick:end')
    stream.push(50, 'long', moving)
    expect(log.filter((e) => e.startsWith('flashback'))[0]).toBe(`flashback:start@${stream.t(GOAL)}`)
  })

  it('shows the clip phase in the row above the pitch during a replay', () => {
    const { host, tracker } = mount()
    const stream = new Stream(tracker)
    const row = () => host.shadowRoot!.querySelector<HTMLElement>('.mt-phase-team[data-team="0"]')?.dataset.state
    // Team 0 on the ball through the clip, team 1 from 10 s on: live play ends with team 1 attacking.
    goalThenRun(stream, 0, (i) => ({ carrier: i < 250 ? 0 : 1 }))
    expect(row()).toBe('defending')
    stream.push(150, 'long')
    const clipInputs = control.inputs.filter((_, k) => control.updatedBy[k] === 1)
    expect(clipInputs.at(-1)?.phase?.states[0]).toBe('attacking')
    expect(row()).toBe('attacking')
    // A press cuts the replay: the row is live play's at once, before the next frame.
    press(tracker)
    expect(row()).toBe('defending')
  })

  it('a resize, a font load or a layer change mid-replay redraws the clip, not live', async () => {
    const { host, tracker } = mount()
    const stream = new Stream(tracker)
    goalThenRun(stream, 25)
    const log = events(tracker)
    const from = control.drawn.length
    env.resize(host, 1000, 600)
    fonts.resolve()
    await new Promise<void>((done) => setTimeout(done, 0))
    tracker.setOptions({ layers: { ballTrail: false } })
    const drawn = drawnSince(from)
    expect(drawn.length).toBeGreaterThanOrEqual(3)
    expect(drawn.every(({ frame, layers }) => isClip(frame) && layers?.flashback !== undefined)).toBe(true)
    expect(log.filter((e) => e.startsWith('moment'))).toEqual([])
  })

  it('moves the timer and the progress line between clip records', () => {
    // No zoom near goal, which would have the clip director paint every frame as it eases.
    const { tracker } = mount({ layers: { goalZoom: false } })
    // Records 100 ms apart, as the default socket sends them.
    const stream = new Stream(tracker, 0.1)
    stream.push(200, 'valid', (i) => (i === 40 ? { labels: ['goal'] } : {}))
    stream.push(10, 'long')
    // Frames on which the clip director did not paint: the indicator alone is drawn again.
    const shares: number[] = []
    for (let k = 0; k < 24; k++) {
      const { drawn, painted } = frameOf(16, 1)
      expect(drawn).toHaveLength(1)
      if (!painted) shares.push(drawn[0]!.layers!.flashback!.leftShare)
    }
    expect(shares.length).toBeGreaterThanOrEqual(10)
    expect(shares.every((s, k) => k === 0 || s < shares[k - 1]!)).toBe(true)
  })

  it('fades the stroke and tab out over live play, drawing them again while live does not paint', () => {
    const { tracker } = mount({ layers: { playerLoss: false } })
    const stream = new Stream(tracker)
    goalThenRun(stream, 25)
    stream.push(1, 'valid')
    const liveFrame = FIRST_FRAME + RUN + 25
    const alphas: number[] = []
    for (let k = 0; k < 40 && env.queued() > 0; k++) {
      const { drawn, painted } = frameOf(16, 0)
      expect(painted).toBe(false)
      for (const { frame, layers } of drawn) {
        expect(frameNo(frame)).toBe(liveFrame)
        alphas.push(layers?.flashback?.alpha ?? 0)
      }
    }
    expect(alphas.length).toBeGreaterThanOrEqual(5)
    expect(alphas.every((a, k) => k === 0 || a < alphas[k - 1]!)).toBe(true)
    expect(alphas.at(-1)).toBe(0)
    expect(control.drawn.at(-1)!.layers).not.toHaveProperty('flashback')
  })

  it('keeps the layers button and the debug badge inside the stroke', () => {
    const { host, tracker } = mount()
    const hud = host.shadowRoot!.querySelector<HTMLElement>('.mt-hud')!
    expect(hud.classList.contains('mt-flashback')).toBe(false)
    const stream = new Stream(tracker)
    goalThenRun(stream, 25)
    expect(hud.classList.contains('mt-flashback')).toBe(true)
    // At 1280 CSS px a frame unit is a CSS px: the design's 12 px stroke.
    const u = (105 * Math.min((1280 - 80) / 105, (720 - 80) / 68)) / 1356
    expect(parseFloat(hud.style.getPropertyValue('--mt-flashback-stroke'))).toBeCloseTo(12 * u, 6)
    const css = STYLES.replace(/\s+/g, ' ')
    expect(css).toContain(
      '.mt-hud.mt-flashback .mt-layers { top: calc(8px + var(--mt-flashback-stroke, 0px)); right: calc(8px + var(--mt-flashback-stroke, 0px)); }',
    )
    expect(css).toContain(
      '.mt-hud.mt-flashback .mt-loss { top: calc(8px + var(--mt-flashback-stroke, 0px)); left: calc(8px + var(--mt-flashback-stroke, 0px)); }',
    )
  })

  it('moves the HUD controls to and from the stroke with a short transition, none with reduced motion', () => {
    const css = STYLES.replace(/\s+/g, ' ')
    // On the controls' own rule, not the flashback's, so they glide both ways: the style after a change decides.
    expect(css).toContain(
      '.mt-layers, .mt-loss { transition-property: top, right, bottom, left; transition-timing-function: ease-out; transition-duration: 200ms; }',
    )
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{ ([^}]*)\{ transition-property: none; \}/.exec(css)?.[1] ?? ''
    for (const control of ['.mt-layers,', '.mt-loss ']) expect(reduced).toContain(control)
  })

  it('puts the HUD controls back when the replay ends', () => {
    const { host, tracker } = mount()
    const hud = host.shadowRoot!.querySelector<HTMLElement>('.mt-hud')!
    const stream = new Stream(tracker)
    goalThenRun(stream, 25)
    stream.push(1, 'valid')
    // Kept while the stroke fades out over live play...
    expect(hud.classList.contains('mt-flashback')).toBe(true)
    env.settle()
    // ...and back where they were once it has gone.
    expect(control.drawn.at(-1)!.layers).not.toHaveProperty('flashback')
    expect(hud.classList.contains('mt-flashback')).toBe(false)
    expect(hud.style.getPropertyValue('--mt-flashback-stroke')).toBe('')

    // And at once on a reset.
    const again = mount()
    const hud2 = again.host.shadowRoot!.querySelector<HTMLElement>('.mt-hud')!
    goalThenRun(new Stream(again.tracker), 25)
    expect(hud2.classList.contains('mt-flashback')).toBe(true)
    again.tracker.reset()
    expect(hud2.classList.contains('mt-flashback')).toBe(false)
    expect(hud2.style.getPropertyValue('--mt-flashback-stroke')).toBe('')
  })

  it('a reset mid-replay leaves the last live frame, without the tab', () => {
    const { tracker } = mount()
    const log = events(tracker)
    const stream = new Stream(tracker)
    const at = goalThenRun(stream, 25)
    expect(isClip(control.drawn.at(-1)!.frame)).toBe(true)
    tracker.reset()
    const last = control.drawn.at(-1)!
    expect(frameNo(last.frame)).toBe(FIRST_FRAME + RUN - 1)
    expect(last.layers).not.toHaveProperty('flashback')
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([`flashback:start@${at}`, `flashback:end@${at}`])
  })

  it('each clip starts from the viewer view, not the last clip camera', () => {
    const { tracker } = mount()
    const stream = new Stream(tracker)
    // Two goals 20 s apart. The later one, with the ball in the box, plays first and its zoom near
    // goal moves its camera; the earlier one, with the ball at the centre spot, follows it.
    const LATER = 600
    stream.push(800, 'valid', (i) => ({
      ballX: i >= 400 && i < 700 ? 45 : 0,
      ...(i === GOAL || i === LATER ? { labels: ['goal'] } : {}),
    }))
    const clip = () => control.inputs.filter((_, k) => control.updatedBy[k] === 1)
    let zoomedInFirst = false
    for (let k = 0; k < 400; k++) {
      stream.push(1, 'long')
      const inputs = clip()
      const last = inputs.at(-1)
      if (last && last.record!.t > stream.t(400)) zoomedInFirst ||= control.directors[1]!.view.zoom > 1
      if (last && last.record!.t < stream.t(400)) {
        // The first frame of the second clip.
        expect(last.playback).toBe(false)
        expect(zoomedInFirst).toBe(true)
        expect(control.directors[1]!.view.zoom).toBe(1)
        return
      }
    }
    throw new Error('the second clip never started')
  })

  it('makes no second director until a clip plays', () => {
    const { tracker } = mount()
    expect(control.options).toHaveLength(1)
    const stream = new Stream(tracker)
    stream.push(RUN, 'valid', (i) => (i === GOAL ? { labels: ['goal'] } : {}))
    stream.push(25, { validIn: 3 })
    stream.push(25, 'valid')
    expect(control.options).toHaveLength(1)
    stream.push(5, 'long')
    expect(control.options).toHaveLength(2)
    expect(control.options[1]!.coverInvalidFrames).toBe(false)
  })

  it('sends no moment events for what plays in a clip', () => {
    const { tracker } = mount()
    const stream = new Stream(tracker)
    stream.push(RUN, 'valid', (i) => (i === GOAL ? { labels: ['goal'] } : {}))
    const log = events(tracker)
    const from = control.drawn.length
    stream.push(300, 'long')
    expect(drawnSince(from).some(({ frame, layers }) => isClip(frame) && layers?.goalBanner !== undefined)).toBe(true)
    expect(log).not.toContain('moment:goal:start')
  })

  it('does nothing with the layer off, as today', () => {
    const { tracker } = mount({ layers: { flashback: false } })
    const log = events(tracker)
    const stream = new Stream(tracker)
    const from = control.drawn.length
    goalThenRun(stream, 150)
    expect(control.options).toHaveLength(1)
    expect(log.some((e) => e.startsWith('flashback'))).toBe(false)
    const drawn = drawnSince(from)
    // Every frame drawn is a paint of the live director, as it made it.
    const painted = new Set<FrameLayers>(control.outputs.flatMap((out) => out.paints.map((p) => p.layers)))
    expect(drawn.every(({ layers }) => layers !== undefined && painted.has(layers))).toBe(true)
    expect(drawn.some(({ layers }) => 'flashback' in (layers ?? {}))).toBe(false)
    expect(drawn.at(-1)?.layers?.attack).toBeDefined()
  })

  it('stores nothing while the layer is off, and drops its clips when switched off', () => {
    const bytes = (tracker: MatchTracker) => (tracker as unknown as { flashback: { bytes(): number } }).flashback.bytes()
    const off = mount({ layers: { flashback: false } })
    const offLog = events(off.tracker)
    goalThenRun(new Stream(off.tracker), 150)
    expect(bytes(off.tracker)).toBe(0)
    expect(offLog.some((e) => e.startsWith('flashback'))).toBe(false)

    // Switched off mid-replay: the replay ends, and every clip goes with it.
    const { tracker } = mount()
    const log = events(tracker)
    const stream = new Stream(tracker)
    // Two goals 20 s apart: the later one plays, the earlier one waits in the store.
    stream.push(800, 'valid', scoredGoals(GOAL, 600))
    expect(bytes(tracker)).toBeGreaterThan(0)
    stream.push(25, 'long')
    const at = stream.t(600)
    tracker.setOptions({ layers: { flashback: false } })
    expect(bytes(tracker)).toBe(0)
    stream.push(2, 'long')
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([`flashback:start@${at}`, `flashback:end@${at}`])
    // Back on, it starts empty: live play, then another long run, plays nothing.
    tracker.setOptions({ layers: { flashback: true } })
    expect(bytes(tracker)).toBe(0)
    stream.push(50, 'valid')
    stream.push(150, 'long')
    expect(log.filter((e) => e.startsWith('flashback'))).toHaveLength(2)
  })

  it('drops every clip on destroy', () => {
    const bytes = (tracker: MatchTracker) => (tracker as unknown as { flashback: { bytes(): number } }).flashback.bytes()
    const { tracker } = mount()
    const stream = new Stream(tracker)
    stream.push(800, 'valid', (i) => (i === GOAL || i === 600 ? { labels: ['goal'] } : {}))
    stream.push(25, 'long')
    expect(bytes(tracker)).toBeGreaterThan(0)
    tracker.destroy()
    // A host that keeps its reference to a destroyed widget keeps no replays with it.
    expect(bytes(tracker)).toBe(0)
  })

  it('cuts the replay when the layer goes off or the widget comes back into view', () => {
    const { tracker } = mount()
    const log = events(tracker)
    const stream = new Stream(tracker)
    const at = goalThenRun(stream, 25)
    const off = control.drawn.length
    tracker.setOptions({ layers: { flashback: false } })
    expect(isClip(control.drawn.at(-1)!.frame)).toBe(false)
    stream.push(5, 'long')
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([`flashback:start@${at}`, `flashback:end@${at}`])
    expect(drawnSince(off).every(({ frame }) => !isClip(frame))).toBe(true)

    // A second widget, brought back into view mid-clip.
    control.reset()
    const second = mount()
    const log2 = events(second.tracker)
    const stream2 = new Stream(second.tracker)
    const at2 = goalThenRun(stream2, 25)
    for (const observer of Array.from(FakeIntersectionObserver.live)) {
      if ([...observer.targets].includes(second.host)) {
        observer.fire(false)
        observer.fire(true)
      }
    }
    const back = control.drawn.length
    stream2.push(5, 'long')
    expect(log2.filter((e) => e.startsWith('flashback'))).toEqual([`flashback:start@${at2}`, `flashback:end@${at2}`])
    expect(drawnSince(back).every(({ frame }) => !isClip(frame))).toBe(true)
  })

  it('a tab switch mid-run cuts the replay but lets the next one start', () => {
    const { tracker } = mount()
    const log = events(tracker)
    const stream = new Stream(tracker)
    // Two goals 20 s apart: the later one plays first.
    const LATER = 600
    stream.push(800, 'valid', scoredGoals(GOAL, LATER))
    stream.push(25, 'long')
    env.setVisibility('hidden')
    env.setVisibility('visible')
    // Back in view: a seek, so the replay on screen ends; nobody asked for the live frame, so the next may start.
    stream.push(5, 'long')
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([
      `flashback:start@${stream.t(LATER)}`,
      `flashback:end@${stream.t(LATER)}`,
      `flashback:start@${stream.t(GOAL)}`,
    ])
    expect(isClip(control.drawn.at(-1)!.frame)).toBe(true)
  })

  it('cuts the replay on a press, and trigger plays on the live frame', () => {
    const { tracker } = mount()
    const log = events(tracker)
    const stream = new Stream(tracker)
    const at = goalThenRun(stream, 25)
    press(tracker)
    expect(isClip(control.drawn.at(-1)!.frame)).toBe(false)
    stream.push(5, 'long')
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([`flashback:start@${at}`, `flashback:end@${at}`])

    control.reset()
    const second = mount()
    const log2 = events(second.tracker)
    const stream2 = new Stream(second.tracker)
    goalThenRun(stream2, 25)
    log2.length = 0
    expect(second.tracker.trigger('throwIn')).toBe(true)
    const last = control.drawn.at(-1)!
    expect(isClip(last.frame)).toBe(false)
    expect(last.layers?.throwIn).toBeDefined()
    expect(log2).toContain('moment:throwIn:start')
    stream2.push(2, 'long')
    expect(log2.filter((e) => e.startsWith('flashback'))).toEqual([`flashback:end@${stream2.t(GOAL)}`])
  })

  it('ends the replay and drops every clip when the stream restarts', () => {
    const { tracker } = mount()
    const log = events(tracker)
    const stream = new Stream(tracker)
    // Two goals, 20 s apart: the later one plays first.
    const SECOND = 600
    stream.push(800, 'valid', scoredGoals(GOAL, SECOND))
    stream.push(25, 'long')
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([`flashback:start@${stream.t(SECOND)}`])
    // The pipeline starts again, its clock 20 s back.
    const restart = stream.t() - 20
    tracker.push(msg(stream.i++, restart, 'long'))
    env.frame(40)
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([
      `flashback:start@${stream.t(SECOND)}`,
      `flashback:end@${stream.t(SECOND)}`,
    ])
    // Live play, then another long run: the first goal's clip went with the restart.
    for (let k = 1; k <= 50; k++) {
      tracker.push(msg(stream.i++, restart + k * 0.04, 'valid'))
      env.frame(40)
    }
    for (let k = 51; k <= 200; k++) {
      tracker.push(msg(stream.i++, restart + k * 0.04, 'long'))
      env.frame(40)
    }
    expect(log.filter((e) => e.startsWith('flashback'))).toHaveLength(2)
  })

  it('ends the replay once the stream has said nothing for longer than its lookahead reached', () => {
    const { tracker } = mount()
    const log = events(tracker)
    const stream = new Stream(tracker)
    // Two goals, 20 s apart, so a second clip is ready to follow the first.
    const SECOND = 600
    stream.push(800, 'valid', (i) => (i === GOAL || i === SECOND ? { labels: ['goal'] } : {}))
    // An invalid record with no valid one in sight, then 20 s of records with no raw_data. Past
    // the horizon live play is valid again, as the main picture has it, so the replay ends within
    // MERGE_GAP_S of it (a carried guess ends one no sooner), before its 12 s clip runs out.
    stream.push(1, 'long')
    const silentFrom = stream.i
    let endedAt = -1
    tracker.on('flashback', ({ phase }) => {
      if (phase === 'end') endedAt = stream.i
    })
    stream.push(500, 'none')
    const horizonPassed = silentFrom + Math.ceil(HORIZON / 0.04)
    expect(endedAt).toBeGreaterThan(horizonPassed)
    expect(endedAt).toBeLessThanOrEqual(horizonPassed + Math.ceil(1.5 / 0.04) + 1)
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([
      `flashback:start@${stream.t(SECOND)}`,
      `flashback:end@${stream.t(SECOND)}`,
    ])
    const last = control.drawn.at(-1)!
    expect(frameNo(last.frame)).toBeGreaterThan(FIRST_FRAME + silentFrom)
    expect(last.layers?.flashback?.alpha ?? 0).toBe(0)
  })

  it('keeps clips of play the stream said nothing about once its lookahead ran out', () => {
    const { tracker } = mount()
    const log = events(tracker)
    const stream = new Stream(tracker)
    stream.push(250, 'valid')
    stream.push(1, 'long')
    // 30 s with no raw_data, a goal 20 s in: valid play by then, so it is spotted and kept.
    const goal = stream.i + 500
    stream.push(750, 'none', (i) => (i === goal ? { labels: ['goal'] } : {}))
    stream.push(50, 'long')
    expect(log.filter((e) => e.startsWith('flashback'))).toEqual([`flashback:start@${stream.t(goal)}`])
  })

  it('goes back to live play at its own view, not the clip camera, when a press cuts the replay', () => {
    const { tracker } = mount()
    const stream = new Stream(tracker)
    // The clip's ball is in the box, so its own zoom near goal moves its camera; live play's is at the centre spot.
    goalThenRun(stream, 50, (i) => ({ ballX: i < 300 ? 45 : 0 }))
    expect(control.directors[1]!.view.zoom).toBeGreaterThan(1)
    expect(control.directors[0]!.view.zoom).toBe(1)
    press(tracker)
    expect(control.directors[0]!.view).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
    expect(control.views.at(-1)).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
  })

  it('shows a first half clip on the first half ends', () => {
    const { tracker } = mount({ layers: { halfTime: false } })
    let i = 0
    const push = (t: number, state: State, shape: Shape = {}) => {
      tracker.push(msg(i++, t, state, shape))
      env.frame(40)
    }
    for (let k = 0; k <= 400; k++) push(92 + k * 0.04, 'valid', Math.abs(92 + k * 0.04 - 100) < 1e-6 ? { labels: ['goal'] } : {})
    for (let k = 0; k <= 50; k++) push(200 + k * 0.04, 'valid', k === 0 ? { labels: ['End FirstHalf'] } : {})
    const from = control.drawn.length
    for (let k = 0; k <= 50; k++) push(300 + k * 0.04, 'long')
    const clip = drawnSince(from).filter(({ layers }) => layers?.flashback !== undefined && (layers.flashback.alpha ?? 0) > 0)
    expect(clip.length).toBeGreaterThan(0)
    const { frame, layers } = clip.at(-1)!
    expect(frame.balls?.[0]?.projected_coordinates?.x).toBe(30)
    expect(layers?.flashback?.side).toBe('left')
  })

  it('rides a split run without ending the replay', () => {
    const { tracker } = mount()
    const stream = new Stream(tracker)
    // Two goals 20 s apart, so both are kept.
    const LATER = 600
    stream.push(800, 'valid', scoredGoals(GOAL, LATER))
    const log = events(tracker)
    // A 6 s run with its exact countdown: the first clip is fitted to it and runs out at the gap.
    for (let k = 0; k < 150; k++) stream.push(1, { validIn: 6 - k * 0.04 })
    expect(log).toEqual([`flashback:start@${stream.t(LATER)}`])
    // A 0.3 s valid gap, then a long run.
    for (let k = 0; k < 8; k++) stream.push(1, { invalidIn: 0.3 - k * 0.04 })
    const gapEnd = log.length
    stream.push(150, 'long')
    // No end at the gap, and no live moment between the clips: the second follows the first.
    expect(log.slice(0, gapEnd)).toEqual([`flashback:start@${stream.t(LATER)}`])
    expect(log).toEqual([`flashback:start@${stream.t(LATER)}`, `flashback:start@${stream.t(GOAL)}`])
  })

  /** A seeded uniform draw in [0, 1): mulberry32. */
  const uniform = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  /** A seeded normal draw of deviation `sigma`: Box-Muller. */
  const normal = (seed: number, sigma: number) => {
    const draw = uniform(seed)
    return () => sigma * Math.sqrt(-2 * Math.log(1 - draw())) * Math.cos(2 * Math.PI * draw())
  }

  // One widget a seed, each its own test: a test keeps every widget it made until it ends.
  it.each(Array.from({ length: 20 }, (_, k) => k + 1))(
    'rides a split run whose records come late and jittered, seed %i',
    (seed) => {
      const { tracker } = mount()
      // Records 100 ms apart, as the default socket sends them; two goals 20 s apart, both kept.
      const stream = new Stream(tracker, 0.1)
      const LATER = 240
      stream.push(320, 'valid', scoredGoals(40, LATER))
      const log = events(tracker)
      // A 6 s run with its exact countdown, a 0.3 s valid gap, then a long run.
      const states: State[] = [
        ...Array.from({ length: 60 }, (_, k): State => ({ validIn: 6 - k * 0.1 })),
        ...Array.from({ length: 3 }, (_, k): State => ({ invalidIn: 0.3 - k * 0.1 })),
        ...Array.from({ length: 30 }, (): State => 'long'),
      ]
      // Each comes by its arrival time: 0.5% slower than record time, jittered by σ 40 ms, in order.
      const jitter = normal(seed, 40)
      const from = env.now
      let arrival = from
      const arrivals = states.map((state, k) => {
        arrival = Math.max(arrival, from + k * 100 * 1.005 + jitter())
        return { atMs: arrival, i: stream.i + k, state }
      })
      let next = 0
      while (next < arrivals.length) {
        while (next < arrivals.length && arrivals[next]!.atMs <= env.now + 16) {
          const { i, state } = arrivals[next++]!
          tracker.push(msg(i, stream.t(i), state))
        }
        env.frame(16)
      }
      // No end before the long run, and no live moment in the gap: the second clip follows the first.
      expect(log).toEqual([`flashback:start@${stream.t(LATER)}`, `flashback:start@${stream.t(40)}`])
    },
  )

  it('plays through the staging fixture without flicker', () => {
    const { tracker } = mount()
    const lines = gunzipSync(readFileSync(resolve(process.cwd(), 'test/fixtures/staging-validity.jsonl.gz')))
      .toString('utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
    const records = lines.map((line) => ({ line, record: parseRecord(JSON.parse(line)) as TrackerRecord }))
    let newest: TrackerRecord | null = null
    let carried: CarriedValidity | null = null
    const ends: Array<{ nowMs: number; state: RecordValidity | null }> = []
    const starts: Array<{ nowMs: number }> = []
    tracker.on('flashback', ({ phase }) => {
      if (phase === 'start') starts.push({ nowMs: env.now })
      else ends.push({ nowMs: env.now, state: newest && carriedValidity(carried, newest.t) })
    })
    // Paced by record time, in animation frames of 40 ms: the fixture is about 9 records a second.
    const first = records[0]!.record.t
    let next = 0
    for (let clock = first; next < records.length; clock += 0.04) {
      while (next < records.length && records[next]!.record.t <= clock) {
        const { line, record } = records[next++]!
        tracker.push(line)
        newest = record
        if (record.validity) carried = { t: record.t, validity: record.validity }
      }
      env.frame(40)
    }
    expect(starts.length).toBeGreaterThan(0)
    for (const end of ends) {
      // Every end follows from a known validity: a clip that ran out with the run still on, a
      // record that says it is valid, or a carried countdown that flipped to valid with no record
      // saying more for MERGE_GAP_S. All three are accepted; an end with nothing known about the
      // stream would be a flicker of its own.
      expect(end.state).not.toBeNull()
    }
    const all = [...starts.map((s) => ({ ...s, phase: 'start' })), ...ends.map((e) => ({ ...e, phase: 'end' }))].sort(
      (a, b) => a.nowMs - b.nowMs,
    )
    for (let k = 1; k < all.length; k++) {
      if (all[k - 1]!.phase === 'start' && all[k]!.phase === 'end') {
        expect(all[k]!.nowMs - all[k - 1]!.nowMs).toBeGreaterThanOrEqual(1000)
      }
      // A replay that ends and starts again within MERGE_GAP_S is the flicker of a split run.
      if (all[k - 1]!.phase === 'end' && all[k]!.phase === 'start') {
        expect(all[k]!.nowMs - all[k - 1]!.nowMs).toBeGreaterThanOrEqual(1500)
      }
    }
  })
})
