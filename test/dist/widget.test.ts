/**
 * The built widget against its source. dist/index.js is minified (vite.config.ts),
 * and the other tests run against src, so this is what shows the minified code
 * still does what the source does: the two are mounted side by side, played the
 * same real match data, and must draw the same canvas calls frame by frame, build
 * the same shadow DOM, report the same boxes and moments, and fire the same events.
 *
 * `npm run test:dist`, the last step of `npm run build`: it needs a fresh dist.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as source from '../../src/index'
import type { Op } from '../helpers/recordingCtx'
import { installEnv, makeHost, type Env } from '../widget/env'

type Widget = typeof source
type Options = Parameters<Widget['createMatchTracker']>[1]

const DIST = resolve(process.cwd(), 'dist/index.js')
if (!existsSync(DIST)) throw new Error('test/dist runs against dist/index.js: run `npm run build` first')
const built = (await import(/* @vite-ignore */ pathToFileURL(DIST).href)) as Widget

const FIXTURES = resolve(process.cwd(), 'test/fixtures')

/** A websocket recording, one raw message per line (test/fixtures/*.jsonl.gz). */
function messages(file: string): string[] {
  const text = gunzipSync(readFileSync(resolve(FIXTURES, file))).toString('utf8')
  return text.split('\n').filter((line) => line.trim())
}

/** A golden's records, its labels marked human, as test/parity/goldens.test.ts reads them. */
function goldenRecords(name: string): source.TrackerRecord[] {
  const golden = JSON.parse(brotliDecompressSync(readFileSync(resolve(FIXTURES, `goldens/${name}.json.br`))).toString('utf8')) as {
    records: source.TrackerRecord[]
  }
  for (const record of golden.records) {
    const actions = record.frame.state?.actions
    if (actions) record.frame.state!.actions = actions.map((a) => ({ ...a, action_origin: a.action_origin ?? 'human' }))
  }
  return golden.records
}

let env: Env
const mounted: source.MatchTracker[] = []

/** The source's widget and the built one, mounted alike, with what each has fired. */
function mountPair(options: Options) {
  const mount = (widget: Widget) => {
    const host = makeHost()
    const tracker = widget.createMatchTracker(host, { layersStorageKey: null, ...options })
    mounted.push(tracker)
    const events: unknown[] = []
    tracker.on('moment', (event) => events.push(['moment', event]))
    tracker.on('box', (event) => events.push(['box', event]))
    env.resize(host, 1280, 760)
    return { host, tracker, events }
  }
  return [mount(source), mount(built)] as const
}
type Pair = ReturnType<typeof mountPair>

/** Where two op lists first part, or null if they are the same. */
function firstDifference(want: Op[], got: Op[]): string | null {
  const n = Math.max(want.length, got.length)
  for (let i = 0; i < n; i++) {
    const a = JSON.stringify(want[i])
    const b = JSON.stringify(got[i])
    if (a !== b) return `op ${i} of ${want.length} (built has ${got.length}): source ${a}, built ${b}`
  }
  return null
}

let compared = 0

/** The pair drew the same since the last check, and their DOM, box and moments are the same. */
function expectSame([src, dist]: Pair, at: string) {
  const want = env.drain(src.host)
  const got = env.drain(dist.host)
  expect(firstDifference(want, got), at).toBeNull()
  compared += want.length
  expect(dist.host.shadowRoot!.innerHTML, at).toBe(src.host.shadowRoot!.innerHTML)
  expect(dist.tracker.overlay.outerHTML, at).toBe(src.tracker.overlay.outerHTML)
  expect(dist.tracker.box, at).toEqual(src.tracker.box)
  expect(dist.tracker.availability(), at).toEqual(src.tracker.availability())
}

beforeEach(() => {
  env = installEnv()
  compared = 0
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('dist/index.js', () => {
  it('is the source, by its exports', () => {
    expect(Object.keys(built).toSorted()).toEqual(Object.keys(source).toSorted())
    expect(built.MATCH_TRACKER_VERSION).toBe(source.MATCH_TRACKER_VERSION)
    expect(built.REPLAY_LOOKBACK_S).toBe(source.REPLAY_LOOKBACK_S)
    expect(built.DEFAULT_PERSON_COLORS).toEqual(source.DEFAULT_PERSON_COLORS)
    expect(built.matchTrackerBanner()).toBe(source.matchTrackerBanner())
  })

  it('parses every message of a real match as the source does', () => {
    for (const file of ['excerpt.jsonl.gz', 'player-loss.jsonl.gz']) {
      for (const message of messages(file)) expect(built.parseRecord(message)).toEqual(source.parseRecord(message))
    }
  })

  it('draws a real stretch of match live as the source does', () => {
    const pair = mountPair({ mode: 'live' })
    for (const [i, message] of messages('excerpt.jsonl.gz').entries()) {
      for (const { tracker } of pair) tracker.push(message)
      env.frame(40)
      expectSame(pair, `excerpt message ${i}`)
    }
    expect(compared).toBeGreaterThan(100_000)
    expect(pair[1].events).toEqual(pair[0].events)
  })

  it('draws lost players live, in Chinese, as the source does', () => {
    const pair = mountPair({ mode: 'live', locale: 'zh', debug: true })
    for (const [i, message] of messages('player-loss.jsonl.gz').entries()) {
      for (const { tracker } of pair) tracker.push(message)
      env.frame(40)
      expectSame(pair, `player-loss message ${i}`)
    }
    expect(compared).toBeGreaterThan(10_000)
    expect(pair[1].events).toEqual(pair[0].events)
  })

  it('replays a goal, then every moment it can play, as the source does', () => {
    const records = goldenRecords('goal')
    const pair = mountPair({ mode: 'replay' })
    for (const [i, record] of records.entries()) {
      const state = { time: record.t, playing: true, record, lookback: records.slice(0, i + 1) }
      for (const { tracker } of pair) tracker.present(state)
      env.frame(40)
      expectSame(pair, `goal record ${i}`)
    }
    for (let n = 0; n < 200 && env.queued() > 0; n++) {
      env.frame()
      expectSame(pair, `after the goal, frame ${n}`)
    }
    const availability = pair[0].tracker.availability()
    const moments = (Object.keys(availability) as source.ReplayMoment[]).filter((moment) =>
      moment === 'attack' ? availability.attack[0] || availability.attack[1] : availability[moment],
    )
    expect(moments.length).toBeGreaterThan(3)
    for (const moment of moments) {
      for (const team of [0, 1] as const) {
        const played = pair.map(({ tracker }) => tracker.trigger(moment, team))
        expect(played[1], `${moment} for team ${team}`).toBe(played[0])
        for (let n = 0; n < 400 && env.queued() > 0; n++) {
          env.frame()
          expectSame(pair, `${moment} for team ${team}, frame ${n}`)
        }
      }
    }
    expect(pair[1].events).toEqual(pair[0].events)
    expect(pair[0].events.length).toBeGreaterThan(moments.length)
  })
})
