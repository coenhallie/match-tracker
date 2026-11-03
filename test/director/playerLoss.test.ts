import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
import { deriveAt, windowAt } from '../../src/analysis/derive'
import { PLAYER_LOSS_BELOW, trackedPlayers } from '../../src/analysis/playerLoss'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import { LOSS_END_S, LOSS_START_S } from '../../src/director/playerLoss'
import { parseRecord } from '../../src/model/parseRecord'
import type { Frame } from '../../src/model/types'
import { ATTACK_OUT_MS } from '../../src/render/attackIndicator'
import { FakeReplay } from './harness'

// The attack over a player loss is the widget's own: the reference has none. Whole animation frames, as in
// the other moments' tests, with the layer on.

/** A record with `players` players tracked, half a team each, the ball at `ball` unless it is lost. */
const frameWith = (players: number, ball: { x: number; y: number } | null, labels: string[] = []): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [0, 1].map((team) => ({
      team_id: team,
      players: Array.from({ length: team === 0 ? Math.ceil(players / 2) : Math.floor(players / 2) }, (_, i) => ({
        track_id: team * 100 + i,
        person_type: 'PersonType.PLAYER',
        projected_coordinates: { x: (team === 0 ? -1 : 1) * (5 + i * 3), y: -20 + i * 4 },
      })),
    })),
    balls: ball ? [{ projected_coordinates: ball }] : [],
    state: { actions: labels.map((action_type) => ({ action_type })) },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

/** Team 0 attacks towards -x, team 1 towards +x; nobody in possession, nobody attacking. */
const ENDS: TeamPhase = { possession: null, attacks: { 0: -1, 1: 1 }, states: { 0: null, 1: null } }
const STEP_S = 0.04

/** The pitch played on record by record, the attack over a player loss on. */
class Pitch {
  readonly replay = new FakeReplay({ playerLoss: true })
  ball: { x: number; y: number } | null = { x: 0, y: 0 }

  constructor(reducedMotion = false) {
    this.replay.reducedMotion = reducedMotion
    this.replay.set({ time: 10, frame: frameWith(22, this.ball), phase: ENDS })
    this.replay.play()
  }

  /** The next record by playback, the ball moved on by `dx` metres, then its 40 ms of animation frames. */
  record(players: number, { dx = 0, phase = ENDS, labels = [] as string[] } = {}) {
    if (this.ball) this.ball = { x: this.ball.x + dx, y: this.ball.y }
    this.replay.set({ time: this.replay.time + STEP_S, frame: frameWith(players, this.ball, labels), phase })
    return this.replay.animate(STEP_S * 1000, true)
  }

  /** `n` records in a row. */
  records(n: number, players: number, options: Parameters<Pitch['record']>[1] = {}) {
    for (let i = 0; i < n; i++) this.record(players, options)
  }

  attack() {
    return this.replay.last()?.attack
  }

  loss() {
    return this.replay.outputs.at(-1)?.loss
  }
}

const recordsFor = (seconds: number) => Math.ceil(seconds / STEP_S)

describe('players tracked', () => {
  it('counts both teams’ players with a position, keepers included, officials not', () => {
    const frame = {
      teams: [
        { team_id: -1, players: [{ projected_coordinates: { x: 0, y: 0 } }] },
        {
          team_id: 0,
          players: [
            { person_type: 'PersonType.GOALKEEPER', projected_coordinates: { x: -50, y: 0 } },
            { projected_coordinates: { x: 1, y: 2 } },
            { projected_coordinates: { x: Number.NaN, y: 2 } },
            { projected_coordinates: {} },
          ],
        },
        { team_id: 1, players: [{ projected_coordinates: { x: 3, y: 4 } }] },
      ],
    } as unknown as Frame
    expect(trackedPlayers(frame)).toBe(3)
    expect(PLAYER_LOSS_BELOW).toBe(18)
  })
})

describe('attack over a player loss', () => {
  it('covers a loss with the attack of the team the ball is heading for the other goal with', () => {
    const towardsPlus = new Pitch()
    towardsPlus.records(recordsFor(LOSS_START_S) + 2, 9, { dx: 0.5 })
    expect(towardsPlus.attack()).toMatchObject({ team: 1, direction: 1 })
    // Not held: play carries on underneath, with the ball.
    expect(towardsPlus.attack()!.ball).toBeUndefined()

    const towardsMinus = new Pitch()
    towardsMinus.records(recordsFor(LOSS_START_S) + 2, 9, { dx: -0.5 })
    expect(towardsMinus.attack()).toMatchObject({ team: 0, direction: -1 })
  })

  it('goes by the team that last had the ball while the ball is not going anywhere', () => {
    const pitch = new Pitch()
    pitch.record(22, { phase: { ...ENDS, possession: 1 } })
    pitch.records(recordsFor(LOSS_START_S) + 2, 9)
    expect(pitch.attack()).toMatchObject({ team: 1, direction: 1 })
  })

  it('waits while nothing says which team, and covers as soon as something does', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(2), 9)
    expect(pitch.attack()).toBeUndefined()
    expect(pitch.loss()).toEqual({ players: 9, cover: null })
    pitch.records(recordsFor(0.5), 9, { dx: -0.5 })
    expect(pitch.attack()).toMatchObject({ team: 0 })
    expect(pitch.loss()).toEqual({ players: 9, cover: 0 })
  })

  it('leaves a loss shorter than LOSS_START_S alone', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(LOSS_START_S) - 2, 9, { dx: 0.5 })
    pitch.records(recordsFor(1), 22, { dx: 0.5 })
    expect(pitch.replay.outputs.some((o) => o.layers?.attack)).toBe(false)
  })

  it('stays while the loss lasts, and the data stalls, then fades out once players are back', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(5), 9, { dx: 0.3 })
    expect(pitch.attack()).toMatchObject({ team: 1, intensity: 1, playersFade: 1 })
    // No records for 2 s: the frame with players missing stands, and so does the cover.
    for (let i = 0; i < recordsFor(2); i++) {
      pitch.replay.set({ time: pitch.replay.time + STEP_S })
      pitch.replay.animate(STEP_S * 1000, true)
    }
    expect(pitch.attack()).toMatchObject({ intensity: 1 })
    // Back, but not yet for LOSS_END_S.
    pitch.records(recordsFor(LOSS_END_S) - 2, 22)
    expect(pitch.attack()).toMatchObject({ intensity: 1 })
    expect(pitch.loss()).toBeNull()
    pitch.records(4, 22)
    const going = pitch.attack()!
    expect(going.leaving).toBe(true)
    expect(going.intensity).toBeLessThan(1)
    pitch.records(recordsFor(ATTACK_OUT_MS / 1000), 22)
    expect(pitch.attack()).toBeUndefined()
  })

  it('stays when players come back for less than LOSS_END_S', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(1), 9, { dx: 0.3 })
    pitch.records(recordsFor(LOSS_END_S) - 3, 22)
    pitch.records(recordsFor(1), 9)
    pitch.records(recordsFor(LOSS_END_S) - 3, 22)
    expect(pitch.attack()).toMatchObject({ intensity: 1, leaving: false })
  })

  it('keeps the way each team attacks when the phase loses it during the loss', () => {
    const pitch = new Pitch()
    pitch.record(22)
    const unknown: TeamPhase = { possession: null, attacks: { 0: null, 1: null }, states: { 0: null, 1: null } }
    pitch.records(recordsFor(LOSS_START_S) + 2, 9, { dx: 0.5, phase: unknown })
    expect(pitch.attack()).toMatchObject({ team: 1, direction: 1 })
  })

  it('takes no heading from a ball off the pitch, or across a jump', () => {
    const pitch = new Pitch()
    pitch.ball = { x: 10, y: 160 }
    pitch.records(recordsFor(1), 9, { dx: 0.5 })
    expect(pitch.attack()).toBeUndefined()
    // Back on the pitch with a jump, then still: nothing to go by yet.
    pitch.ball = { x: -30, y: 0 }
    pitch.records(recordsFor(1), 9)
    expect(pitch.attack()).toBeUndefined()
  })

  it('is not shown with its layer off, and ends when the layer is switched off', () => {
    const off = new Pitch()
    off.replay.toggle({ playerLoss: false })
    off.records(recordsFor(1), 9, { dx: 0.5 })
    expect(off.attack()).toBeUndefined()
    // The badge still says there is a loss.
    expect(off.loss()).toEqual({ players: 9, cover: null })

    const on = new Pitch()
    on.records(recordsFor(1), 9, { dx: 0.5 })
    expect(on.attack()).toBeDefined()
    on.replay.toggle({ playerLoss: false })
    expect(on.attack()).toBeUndefined()
  })

  it('ends on a pause and a seek, and covers a loss play then runs on in', () => {
    const paused = new Pitch()
    paused.records(recordsFor(1), 9, { dx: 0.5 })
    paused.replay.pause()
    expect(paused.attack()).toBeUndefined()

    const sought = new Pitch()
    sought.records(recordsFor(1), 9, { dx: 0.5 })
    sought.replay.set({ time: 60, frame: frameWith(9, sought.ball) })
    expect(sought.attack()).toBeUndefined()
    // It covers what is on the pitch, not an event seen once: play running on in a loss is covered again.
    sought.records(recordsFor(LOSS_START_S) + recordsFor(0.3) + 2, 9, { dx: 0.5 })
    expect(sought.attack()).toMatchObject({ team: 1 })
  })

  it('gives way to a goal and a corner', () => {
    const goal = new Pitch()
    goal.ball = { x: 40, y: 0 }
    goal.records(recordsFor(1), 9, { dx: 0.3 })
    expect(goal.attack()).toBeDefined()
    goal.record(9, { labels: ['GOAL'] })
    expect(goal.replay.last()!.goal ?? goal.replay.last()!.goalBanner).toBeDefined()
    expect(goal.attack()).toBeUndefined()

    const corner = new Pitch()
    corner.records(recordsFor(1), 9, { dx: 0.3 })
    corner.record(9, { labels: ['Corner'] })
    expect(corner.replay.last()!.corner).toBeDefined()
    expect(corner.attack()).toBeUndefined()
  })

  it('stands in for an attack the phase calls during it, which is then not shown again', () => {
    const pitch = new Pitch()
    pitch.records(recordsFor(1), 9, { dx: 0.3 })
    const attacking: TeamPhase = { ...ENDS, possession: 1, states: { 0: 'defending', 1: 'attacking' } }
    pitch.ball = { x: 20, y: 0 }
    pitch.records(recordsFor(1), 9, { dx: 0.3, phase: attacking })
    // Still the cover: the ball is not held, as an attack the phase calls holds it.
    expect(pitch.attack()).toMatchObject({ team: 1 })
    expect(pitch.attack()!.ball).toBeUndefined()
    pitch.records(recordsFor(LOSS_END_S + 1), 22, { dx: 0.3, phase: attacking })
    expect(pitch.attack()).toBeUndefined()
  })

  it('shows whole and still under reduced motion, and goes without a fade', () => {
    const pitch = new Pitch(true)
    pitch.records(recordsFor(LOSS_START_S) + 2, 9, { dx: 0.5 })
    expect(pitch.attack()).toMatchObject({ intensity: 1, playersFade: 1 })
    expect(pitch.attack()!.pulse).toBeUndefined()
    pitch.records(recordsFor(LOSS_END_S) + 1, 22)
    expect(pitch.attack()).toBeUndefined()
  })
})

describe('attack over a player loss, on the February export', () => {
  // test/fixtures/player-loss.jsonl.gz: 16 s from the start of its stream, 9 to 17 players tracked from
  // 1206.96 s to 1216.01 s, then 18 or more. The ball comes back onto the pitch at 1208.80 s, heading for
  // the left goal, which team 0 attacks.
  const lines = gunzipSync(readFileSync(resolve(process.cwd(), 'test/fixtures/player-loss.jsonl.gz')))
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim())
  const records = lines.map((line) => parseRecord(line)).filter((r) => r !== null)

  it('covers the loss with team 0’s attack, from when there is something to go by until players are back', () => {
    const replay = new FakeReplay({ playerLoss: true })
    const first = records[0]!
    replay.set({ time: first.t, frame: first.frame, phase: deriveAt(windowAt(records, first), first).phase })
    replay.play()
    const covered: Array<{ t: number; team: number | undefined; intensity: number | undefined }> = []
    // At 60 Hz, each record when its time comes, as the host's clock runs.
    for (const record of records.slice(1)) {
      const phase = deriveAt(windowAt(records, record), record).phase
      while (replay.time + 1 / 60 < record.t) {
        replay.frame({ time: replay.time + 1 / 60 })
      }
      replay.frame({ time: record.t, frame: record.frame, phase })
      // The cover leaves the ball to play; an attack the phase calls, as team 1's at 1222.45 s, holds it.
      const attack = replay.last()?.attack
      const cover = attack && attack.ball === undefined ? attack : undefined
      covered.push({ t: record.t, team: cover?.team, intensity: cover?.intensity })
    }
    const on = covered.filter((c) => c.team !== undefined)
    expect(on.length).toBeGreaterThan(0)
    expect(new Set(on.map((c) => c.team))).toEqual(new Set([0]))
    // From the first record the ball or possession says anything, a couple of seconds into the loss.
    expect(on[0]!.t).toBeGreaterThan(1208.7)
    expect(on[0]!.t).toBeLessThan(1209.2)
    // Through to the players coming back at 1216.05 s, then gone within LOSS_END_S and the fade.
    expect(covered.find((c) => c.t > 1215.9 && c.t < 1216.1)?.intensity).toBe(1)
    const last = on.at(-1)!.t
    expect(last).toBeGreaterThan(1216.05 + LOSS_END_S)
    expect(last).toBeLessThan(1216.05 + LOSS_END_S + ATTACK_OUT_MS / 1000 + 0.2)
  })
})
