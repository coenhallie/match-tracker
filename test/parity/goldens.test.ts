import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveAt, windowAt } from '../../src/analysis/derive'
import type { TeamId } from '../../src/analysis/teamPhase'
import { takesCamera, type ViewGesture } from '../../src/director/camera'
import {
  Director,
  type DirectorCamera,
  type DirectorInput,
  type DirectorOutput,
  type DirectorView,
} from '../../src/director/director'
import { nextPlayback } from '../../src/director/playback'
import type { ReplayLayers, ReplayMoment } from '../../src/model/replayLayers'
import type { TrackerRecord } from '../../src/model/types'
import { FRAME_H, FRAME_W, PERSON_COLORS } from '../../src/render/constants'
import { createRenderer } from '../../src/render/renderer'
import { DEFAULT_THEME } from '../../src/render/theme'
import { withinRounding } from '../helpers/close'
import { normalizeCalls } from '../helpers/normalize'
import { recordingCtx, stubOffscreenCanvas } from '../helpers/recordingCtx'

/**
 * The golden recordings of video-annotation's 2D replay (its branch
 * test/match-tracker-goldens, recordGoldens.test.ts): for each scenario,
 * every paint the reference surface and renderer made, with everything that
 * went into it. Here the Director and the renderer are driven with the same
 * inputs, and each paint's canvas calls must be the reference's.
 *
 * The fixtures are kept as the recorder wrote them, brotli-compressed JSON
 * (`<scenario>.json.br`): decompressed they come to 4 to 61 MB each.
 *
 * ## From steps to calls
 *
 * A golden step is one reference paint, or a clock tick or an input that
 * painted nothing (`calls: []`). The director is driven by flushes, so the
 * steps are cut into the calls that made them:
 *
 *  - the load: the first steps, up to the first input or trigger, which the
 *    surface paints four times. The director's first update makes three (the
 *    renderer attaching, the frame watcher, the ready watcher), on the
 *    1280x720 bitmap the surface gives the canvas before it is measured, with
 *    no width yet; the fourth is the measure, which sizes the bitmap to the
 *    box and pushes the view with its width (`setView`).
 *  - an input (a step with `input`): the gestures that take the view from a
 *    goal release it (camera.ts), and a view the user moved is pushed with
 *    `setView`. The zoom and pan come from the step's `userView`: what they
 *    do to the view is the widget's own work, outside the director.
 *  - a trigger (a step with `trigger`): `trigger`.
 *  - an update: an animation frame (a new `nowMs`), or something done after
 *    a frame's callbacks at the same `nowMs`, a seek (a new `time`) or a
 *    pause (`playing` gone false). Its record and lookback are the last
 *    step's, as a seek paints its stop with the record it leaves, and its
 *    playback flag comes from the steps with nextPlayback.
 *
 * Each call's paints must be the group's painted steps, in order, each
 * drawing the step's record in the step's view; a group of empty steps must
 * paint nothing. The user's view after each call must be the last step's.
 */

interface UserInput {
  kind: ViewGesture
  deltaY?: number
  clientX?: number
  clientY?: number
  ctrlKey?: boolean
}

interface GoldenStep {
  nowMs: number
  time: number
  playing: boolean
  recordIndex: number | null
  lookback: number[]
  view: DirectorView
  userView: DirectorCamera
  trigger?: { moment: ReplayMoment; team: TeamId }
  input?: UserInput[]
  calls: unknown[]
}

interface GoldenFile {
  scenario: string
  box: { width: number; height: number; dpr: number }
  reducedMotion: boolean
  layers: ReplayLayers
  teamNames: [string, string]
  records: TrackerRecord[]
  steps: GoldenStep[]
}

const FIXTURES = resolve(process.cwd(), 'test/fixtures/goldens')

function readGolden(name: string): GoldenFile {
  return JSON.parse(brotliDecompressSync(readFileSync(resolve(FIXTURES, `${name}.json.br`))).toString('utf8'))
}

/** The renderer's calls as the recorder saved them: through JSON, so NaN reads as null, the pitch cache as its size. */
const asSaved = (calls: unknown[]): unknown[] => normalizeCalls(JSON.parse(JSON.stringify(calls)))

/** The steps one director call made: see "From steps to calls". */
interface Group {
  kind: 'load' | 'input' | 'trigger' | 'update'
  steps: GoldenStep[]
}

function groups(steps: GoldenStep[]): Group[] {
  const out: Group[] = []
  for (const step of steps) {
    const current = out.at(-1)
    const last = current?.steps.at(-1)
    const sameFlush = last && step.nowMs === last.nowMs && step.time === last.time && step.playing === last.playing
    if (step.input) out.push({ kind: 'input', steps: [step] })
    else if (step.trigger) out.push({ kind: 'trigger', steps: [step] })
    else if (!current) out.push({ kind: 'load', steps: [step] })
    else if (sameFlush) current.steps.push(step)
    else out.push({ kind: 'update', steps: [step] })
  }
  return out
}

const sameCamera = (a: DirectorCamera, b: DirectorCamera) => a.zoom === b.zoom && a.panX === b.panX && a.panY === b.panY

/**
 * The live history's window rule against the reference's: at every step on a
 * record, `windowAt` over all the scenario's records gives the lookback the
 * reference's replay handed its phase and trail, record for record and in
 * its order, ties included.
 */
function checkLookbacks(golden: GoldenFile): void {
  const index = new Map(golden.records.map((record, i) => [record, i]))
  golden.steps.forEach((step, i) => {
    if (step.recordIndex === null) return
    const window = windowAt(golden.records, golden.records[step.recordIndex]!).map((record) => index.get(record))
    expect(window, `step ${i}: lookback of record ${step.recordIndex}`).toEqual(step.lookback)
  })
}

function replay(golden: GoldenFile) {
  const { ctx, ops } = recordingCtx()
  const canvas = { width: FRAME_W, height: FRAME_H, getContext: () => ctx } as unknown as HTMLCanvasElement
  // The parity theme: the reference's colours and English, its fonts, and no icons, as jsdom loads none.
  const renderer = createRenderer(canvas, { ...DEFAULT_THEME, icons: { freeKick: null, goal: null } })
  const director = new Director({
    layers: golden.layers,
    reducedMotion: () => golden.reducedMotion,
    teamName: (team) => golden.teamNames[team],
    teamColor: (team) => (team === 0 ? PERSON_COLORS.home : PERSON_COLORS.away).fill,
  })
  const { records } = golden
  /** The user's zoom and pan as this caller holds them, and the width drawn at. */
  let userView: DirectorCamera = { zoom: 1, panX: 0, panY: 0 }
  let renderedWidth = 0
  let previous: { time: number; playback: boolean } | null = null
  let lastInput: DirectorInput | null = null

  const view = (): DirectorView => ({ ...userView, renderedWidth })

  function input(group: Group): DirectorInput {
    const first = group.steps[0]!
    const last = group.steps.at(-1)!
    for (const step of group.steps) {
      if (step.time !== first.time || step.playing !== first.playing) {
        throw new Error(`steps ${group.steps.map((s) => golden.steps.indexOf(s)).join(',')} are not one flush`)
      }
    }
    const record = last.recordIndex === null ? null : records[last.recordIndex]!
    const derived = record ? deriveAt(last.lookback.map((i) => records[i]!), record) : null
    const playback = nextPlayback(previous, first.time, first.playing)
    previous = { time: first.time, playback }
    return {
      nowMs: first.nowMs,
      time: first.time,
      playing: first.playing,
      playback,
      record,
      phase: derived?.phase ?? null,
      trail: derived?.trail ?? null,
    }
  }

  /** Draw a call's paints, and check them against its group's steps. */
  function check(group: Group, outputs: DirectorOutput[]): void {
    const paints = outputs.flatMap((o) => o.paints)
    const painted = group.steps.filter((s) => s.calls.length > 0)
    const at = (step: GoldenStep) => `step ${golden.steps.indexOf(step)}`
    expect(paints.length, `${at(group.steps[0]!)}: paints in a ${group.kind} of ${group.steps.length} steps`).toBe(
      painted.length,
    )
    paints.forEach((paint, i) => {
      const step = painted[i]!
      if (group.kind === 'load' && i === paints.length - 1) {
        // The measure: the bitmap sized to the box, in device pixels.
        canvas.width = golden.box.width * golden.box.dpr
        canvas.height = golden.box.height * golden.box.dpr
      }
      expect(paint.view, `${at(step)}: view`).toEqual(withinRounding(step.view))
      expect(paint.frame === records[step.recordIndex!]!.frame, `${at(step)}: record ${step.recordIndex}`).toBe(true)
      renderer.setView(paint.view)
      renderer.renderFrame(paint.frame, paint.layers)
      const calls = asSaved(ops.splice(0))
      const expected = normalizeCalls(step.calls)
      if (JSON.stringify(calls) !== JSON.stringify(expected)) expect(calls, `${at(step)}: calls`).toEqual(withinRounding(expected))
    })
    const last = group.steps.at(-1)!
    expect(director.view, `${at(last)}: the user's view`).toEqual(withinRounding({ ...last.userView, renderedWidth }))
  }

  for (const group of groups(golden.steps)) {
    const first = group.steps[0]!
    if (group.kind === 'load') {
      const outputs = [director.update((lastInput = input(group)), view())]
      renderedWidth = golden.box.width
      outputs.push(director.setView(view()))
      check(group, outputs)
    } else if (group.kind === 'input') {
      for (const gesture of first.input!) if (takesCamera(gesture.kind, userView.zoom)) director.releaseCamera()
      const outputs: DirectorOutput[] = []
      if (!sameCamera(first.userView, userView)) {
        userView = { ...first.userView }
        outputs.push(director.setView(view()))
      }
      check(group, outputs)
    } else if (group.kind === 'trigger') {
      const { moment, team } = first.trigger!
      const output = director.trigger(moment, team, lastInput!, view())
      check(group, output ? [output] : [])
    } else {
      const output = director.update((lastInput = input(group)), view())
      if (output.camera) userView = { ...output.camera }
      check(group, [output])
    }
  }
}

/** Every fixture the recorder writes. */
const FIXTURE_NAMES = [
  'goal',
  'goal-zoomed-takeover',
  'seek-mid-goal',
  'reduced-motion-goal',
  'dpr2-goal',
  'rings-and-received',
  'ball-roll',
  'attack-team0',
  'attack-team1',
  'pause-mid-attack',
  'free-kick-held-through-cutaway',
  'real-free-kick',
  'throw-in-left',
  'throw-in-right',
  'throw-in-no-ball',
  'real-throw-in',
  'trigger-each-moment',
  'layers-off',
] as const

describe('golden recordings of the reference replay', () => {
  let offscreen: ReturnType<typeof stubOffscreenCanvas> | null = null
  afterEach(() => {
    offscreen?.restore()
    offscreen = null
  })

  it.each(FIXTURE_NAMES)(
    '%s',
    (name) => {
      offscreen = stubOffscreenCanvas()
      const golden = readGolden(name)
      expect(golden.scenario).toBe(name)
      checkLookbacks(golden)
      replay(golden)
    },
    120_000,
  )
})
