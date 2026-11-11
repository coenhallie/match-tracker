import { describe, it, expect } from 'vitest'
import { APPROACH_MAX_ZOOM, approachCamera, WHOLE_PITCH_CAMERA } from '../../src/analysis/goalApproach'
import { GOAL_SEQUENCE_MS } from '../../src/analysis/goalSequence'
import { BALL_HOLD_S } from '../../src/director/goalZoom'
import type { DirectorOutput } from '../../src/director/director'
import type { Frame } from '../../src/model/types'
import { cameraFromView } from '../../src/render/viewTransform'
import { FakeReplay, VIEW } from './harness'
import type { Camera } from '../../src/model/pitch'

// The zoom near goal: the widget's own, so none of this is ported. The harness keeps it off for the
// reference's cases; here it is on.

const PITCH = { length: 105, width: 68, goal_width: 7.32 }

const ballFrame = (ball: { x: number; y: number } | null, labels: string[] = []): Frame =>
  ({
    pitch_dimensions: PITCH,
    teams: [],
    balls: ball ? [{ projected_coordinates: ball }] : [],
    state: { actions: labels.map((action_type) => ({ action_type, action_origin: 'human' })) },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

/** Mounted, playing at 10 s, with the ball at `ball`, and the zoom near goal on. */
function playing(ball: { x: number; y: number } | null = { x: 0, y: 0 }): FakeReplay {
  const replay = new FakeReplay({ goalZoom: true })
  replay.set({ time: 10, frame: ballFrame(ball), playing: true })
  return replay
}

const camera = (replay: FakeReplay): Camera => cameraFromView(replay.director.view)

const FRAME_MS = 1000 / 60

/** `count` animation frames with nothing new, and the view after each. */
function frames(replay: FakeReplay, count: number): Camera[] {
  const cameras: Camera[] = []
  for (let i = 0; i < count; i++) {
    replay.animate(FRAME_MS)
    cameras.push(camera(replay))
  }
  return cameras
}

/**
 * Every 25 fps record for `seconds`, the ball at `at(t)` (t from 0 to 1), on a 60 Hz screen: each record
 * in an animation frame of its own, then one or two frames with nothing new. The view after each frame.
 */
function play(replay: FakeReplay, seconds: number, at: (t: number) => { x: number; y: number } | null): Camera[] {
  const records = Math.round(seconds * 25)
  const cameras: Camera[] = []
  for (let i = 1; i <= records; i++) {
    replay.frame({ time: replay.time + 0.04, frame: ballFrame(at(i / records)) })
    cameras.push(camera(replay), ...frames(replay, i % 2 === 0 ? 1 : 2))
  }
  return cameras
}

/** Animation frames until the view stops moving, or `ms` runs out. */
function settle(replay: FakeReplay, ms = 10_000): DirectorOutput[] {
  const outputs: DirectorOutput[] = []
  for (let t = 0; t < ms; t += FRAME_MS) {
    const [out] = replay.animate(FRAME_MS)
    outputs.push(out!)
    if (!out!.animating) break
  }
  return outputs
}

const zoomSteps = (cameras: Camera[]) => cameras.slice(1).map((c, i) => Math.abs(Math.log(c.zoom / cameras[i]!.zoom)))

describe('the zoom near goal', () => {
  it('leaves the whole pitch alone with the ball far from goal, and asks for no frames', () => {
    const replay = playing({ x: 0, y: 0 })
    play(replay, 2, (t) => ({ x: -10 + 25 * t, y: 5 }))
    expect(replay.director.view).toEqual({ ...VIEW })
    expect(replay.animate(FRAME_MS).at(-1)!.animating).toBe(false)
  })

  it('eases in as the ball nears the goal, a little more the nearer it gets', () => {
    const replay = playing({ x: 10, y: 0 })
    const cameras = play(replay, 3, (t) => ({ x: 10 + 32 * t, y: 3 }))
    const zooms = cameras.map((c) => c.zoom)
    expect(zooms.at(-1)!).toBeGreaterThan(1.3)
    for (let i = 1; i < zooms.length; i++) expect(zooms[i]!).toBeGreaterThanOrEqual(zooms[i - 1]! - 1e-12)
    // Looking towards the goal the ball is heading for.
    expect(cameras.at(-1)!.x).toBeGreaterThan(640)
  })

  it('moves the view by under 2% a frame, and sets off at rest', () => {
    const replay = playing({ x: 0, y: 0 })
    // The ball jumps straight to the penalty spot: the most the view is ever asked to move at once.
    replay.frame({ time: 10.04, frame: ballFrame({ x: 41.5, y: 0 }) })
    const cameras = [camera(replay), ...frames(replay, 120)]
    const steps = zoomSteps(cameras)
    expect(Math.max(...steps)).toBeLessThan(0.02)
    const moving = steps.findIndex((s) => s > 0)
    expect(steps[moving]!).toBeLessThan(Math.max(...steps) / 4)
  })

  it('comes to rest where the ball puts it, and stops asking for frames', () => {
    const replay = playing({ x: 40, y: -4 })
    const outputs = settle(replay)
    expect(outputs.at(-1)!.animating).toBe(false)
    const target = approachCamera({ x: 40, y: -4 }, PITCH)
    expect(camera(replay).zoom).toBeCloseTo(target.zoom, 3)
    expect(camera(replay).x).toBeCloseTo(target.x, 1)
    expect(camera(replay).y).toBeCloseTo(target.y, 1)
    // Still, it paints nothing more.
    expect(replay.animate(500).every((out) => !out.paint)).toBe(true)
  })

  it('rides over a ball that jitters from record to record', () => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    const cameras = play(replay, 2, (t) => ({ x: 40 + (Math.round(t * 50) % 2 ? 1.5 : -1.5), y: 0 }))
    const xs = cameras.map((c) => c.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(3)
  })

  it('holds the view while the ball is briefly lost, and lets go of it after a while', () => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    const zoomed = camera(replay).zoom
    expect(zoomed).toBeGreaterThan(1.3)
    play(replay, BALL_HOLD_S - 0.5, () => null)
    expect(camera(replay).zoom).toBeCloseTo(zoomed, 6)
    play(replay, 3, () => null)
    expect(camera(replay).zoom).toBeLessThan(1.01)
  })

  it('leaves the view to the user once they zoom, and takes it back at the whole pitch', () => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay, 400)
    replay.wheel()
    const theirs = replay.director.view
    play(replay, 2, (t) => ({ x: 40 - 40 * t, y: 0 }))
    expect(replay.director.view).toEqual(theirs)
    // A double click: the whole pitch, and the zoom near goal's again.
    replay.director.releaseCamera()
    replay.director.setView({ ...VIEW })
    play(replay, 3, () => ({ x: 42, y: 0 }))
    expect(camera(replay).zoom).toBeGreaterThan(1.3)
  })

  it('is taken by a press that pans, but not by one at the whole pitch', () => {
    const replay = playing({ x: 0, y: 0 })
    // At the whole pitch: a double click there, or a wheel out, leaves the view to it.
    replay.director.releaseCamera()
    play(replay, 3, () => ({ x: 42, y: 0 }))
    const zoomed = replay.director.view
    expect(zoomed.zoom).toBeGreaterThan(1.3)
    // Zoomed in, a press starts a pan, and the view is the user's from there.
    replay.director.releaseCamera()
    play(replay, 2, () => ({ x: 0, y: 0 }))
    expect(replay.director.view).toEqual(zoomed)
  })

  it('carries on through a resize, which keeps the zoom and pan', () => {
    const replay = playing({ x: 40, y: 0 })
    replay.animate(300)
    replay.director.setView({ ...replay.director.view, renderedWidth: 640 })
    settle(replay)
    expect(camera(replay).zoom).toBeCloseTo(approachCamera({ x: 40, y: 0 }, PITCH).zoom, 3)
  })

  it('never moves the view with reduced motion, and puts the whole pitch back if it had', () => {
    const still = playing({ x: 0, y: 0 })
    still.reducedMotion = true
    play(still, 2, () => ({ x: 42, y: 0 }))
    expect(still.director.view).toEqual({ ...VIEW })

    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    replay.reducedMotion = true
    replay.animate(FRAME_MS)
    expect(replay.director.view).toEqual({ ...VIEW })
    expect(replay.lastView()).toEqual({ ...VIEW })
  })

  it('puts the whole pitch back at once when switched off, and draws it', () => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    const out = replay.toggle({ goalZoom: false })
    expect(replay.director.view).toEqual({ ...VIEW })
    expect(out.paints.at(-1)!.view).toEqual({ ...VIEW })
    expect(out.camera).toEqual({ zoom: 1, panX: 0, panY: 0 })
    play(replay, 2, () => ({ x: 42, y: 0 }))
    expect(replay.director.view).toEqual({ ...VIEW })
  })

  it('is off for the reference: with the layer off, a ball by the goal moves nothing', () => {
    const replay = new FakeReplay()
    replay.set({ time: 10, frame: ballFrame({ x: 42, y: 0 }), playing: true })
    play(replay, 2, () => ({ x: 42, y: 0 }))
    expect(replay.director.view).toEqual({ ...VIEW })
  })

  it('sets off gently after a still spell with no animation frames, however long', () => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    // Paused, at rest: nothing animates, and the loop stops asking for frames.
    replay.pause()
    replay.idle(5000)
    const still = camera(replay)
    replay.set({ time: 30, frame: ballFrame({ x: -5, y: 0 }) })
    const cameras = [still, camera(replay), ...frames(replay, 60)]
    expect(Math.max(...zoomSteps(cameras))).toBeLessThan(0.02)
    // And a hitch of a few frames moves it no further than a short one would.
    replay.idle(400)
    const before = camera(replay)
    const after = frames(replay, 1)
    expect(Math.abs(Math.log(after[0]!.zoom / before.zoom))).toBeLessThan(0.05)
  })

  it('goes on from where the view is after a seek, without a jump', () => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    const before = camera(replay)
    replay.set({ time: 200, frame: ballFrame({ x: -5, y: 0 }) })
    expect(camera(replay)).toEqual(before)
    const cameras = [before, ...frames(replay, 180)]
    expect(Math.max(...zoomSteps(cameras))).toBeLessThan(0.02)
    expect(cameras.at(-1)!.zoom).toBeLessThan(1.01)
    settle(replay)
    expect(camera(replay)).toEqual(WHOLE_PITCH_CAMERA)
  })
})

describe('the zoom near goal making way', () => {
  it.each(['corner', 'throwIn'] as const)('eases out to the whole pitch its %s card is laid out for', (moment) => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    expect(camera(replay).zoom).toBeGreaterThan(1.3)
    replay.trigger(moment)
    expect(replay.last()?.[moment]).toBeDefined()
    const cameras = [camera(replay), ...frames(replay, 120)]
    // Out within 2 s, while the card is still up, at the pace it follows the ball at.
    expect(cameras.at(-1)!.zoom).toBeLessThan(1.03)
    expect(Math.max(...zoomSteps(cameras))).toBeLessThan(0.02)
  })

  it.each(['varCheck', 'goalDisallowed', 'halfTime', 'secondHalf', 'fullTime'] as const)('eases out to the whole pitch for the %s card, and fades the pitch', (moment) => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    expect(camera(replay).zoom).toBeGreaterThan(1.3)
    replay.trigger(moment)
    expect(replay.last()?.labelCard?.key).toBe(moment)
    const cameras = [camera(replay), ...frames(replay, 120)]
    expect(cameras.at(-1)!.zoom).toBeLessThan(1.03)
    expect(Math.max(...zoomSteps(cameras))).toBeLessThan(0.02)
  })

  it('eases out to the whole pitch for a small card, which sits on the touchline', () => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    replay.trigger('foul')
    expect(replay.last()?.smallLabelCard?.key).toBe('foul')
    const cameras = [camera(replay), ...frames(replay, 120)]
    expect(cameras.at(-1)!.zoom).toBeLessThan(1.03)
  })

  it.each(['shotOnGoal', 'headerOnGoal'] as const)('stays in for the %s card, as a shot is what it is there for', (moment) => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    const before = camera(replay)
    expect(before.zoom).toBeGreaterThan(1.3)
    replay.trigger(moment)
    expect(replay.last()?.smallLabelCard?.key).toBe(moment)
    for (const after of frames(replay, 120)) expect(after).toEqual(before)
  })

  it('stays out through half time, asking for no frames once there, and eases back in after the next label', () => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    const zoomedIn = camera(replay).zoom
    replay.trigger('halfTime')
    settle(replay)
    expect(camera(replay)).toEqual(WHOLE_PITCH_CAMERA)
    expect(replay.outputs.at(-1)!.animating).toBe(false)
    expect(replay.last()?.labelCard).toEqual({ key: 'halfTime', intensity: 1 })
    replay.set({ time: replay.time + 0.04, frame: ballFrame({ x: 40, y: 0 }, ['Substitution']) })
    settle(replay)
    expect(replay.last()?.labelCard).toBeUndefined()
    expect(camera(replay).zoom).toBeCloseTo(zoomedIn, 2)
  })

  it('eases out to the whole pitch for an attack, whose label is laid out on it, and back in once it has gone', () => {
    const replay = playing({ x: 40, y: 0 })
    settle(replay)
    const zoomedIn = camera(replay).zoom
    expect(zoomedIn).toBeGreaterThan(1.3)
    // Nobody attacking, but each team's direction known, so an attack can be played.
    replay.set({ phase: { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } } })
    replay.trigger('attack', 0)
    const cameras = frames(replay, 120)
    expect(replay.last()?.attack).toBeDefined()
    expect(cameras.at(-1)!.zoom).toBeLessThan(1.03)
    // Out gently, as for the cards.
    expect(Math.max(...zoomSteps([{ ...camera(replay), zoom: zoomedIn }, ...cameras]))).toBeLessThan(0.02)
    settle(replay)
    expect(replay.last()?.attack).toBeUndefined()
    expect(camera(replay).zoom).toBeCloseTo(zoomedIn, 2)
  })

  it('eases out to the whole pitch for the attack over invalid frames', () => {
    const replay = new FakeReplay({ goalZoom: true, playerLoss: true }, { coverInvalidFrames: true })
    const phase = { possession: null, attacks: { 0: 1 as const, 1: -1 as const }, states: { 0: null, 1: null } }
    replay.set({ time: 10, frame: ballFrame({ x: 40, y: 0 }), playing: true, phase })
    settle(replay)
    expect(camera(replay).zoom).toBeGreaterThan(1.3)
    const invalid = { invalid: true, nextInvalidInS: 0, nextValidInS: 8 }
    // A valid record by playback notes which way each team attacks; the invalid one after it is covered.
    replay.set({ time: 10.04, frame: ballFrame({ x: 40, y: 0 }), validity: { ...invalid, invalid: false } })
    replay.set({ time: 10.08, frame: ballFrame({ x: 40, y: 0 }), validity: invalid })
    settle(replay)
    expect(replay.last()?.attack).toMatchObject({ team: 0 })
    expect(camera(replay)).toEqual(WHOLE_PITCH_CAMERA)
  })
})

describe('a goal with the zoom near goal on', () => {
  // No camera of its own: no lunge in, and no pull back out at the end. The view follows the goal's ball as
  // it follows the tracked one, and with that ball in the net it is as close in as the zoom near goal goes.
  it('moves no camera of its own: the view follows its ball into the net, and holds there', () => {
    const replay = playing({ x: 30, y: 4 })
    settle(replay)
    const from = camera(replay)
    expect(from.zoom).toBeGreaterThan(1.1)
    replay.step(ballFrame({ x: 30, y: 4 }, ['GOAL']))
    const cameras = [from, ...frames(replay, Math.ceil(GOAL_SEQUENCE_MS / FRAME_MS) - 2)]
    expect(replay.last()?.goal).toBeDefined()
    // In, gently, to the furthest it goes, and never past it.
    expect(Math.max(...zoomSteps(cameras))).toBeLessThan(0.02)
    expect(Math.max(...cameras.map((c) => c.zoom))).toBeLessThanOrEqual(APPROACH_MAX_ZOOM + 1e-9)
    expect(cameras.at(-1)!.zoom).toBeCloseTo(APPROACH_MAX_ZOOM, 2)
    // Only ever in: nothing pulls it back out while the goal plays.
    const zooms = cameras.map((c) => c.zoom)
    for (let i = 1; i < zooms.length; i++) expect(zooms[i]!).toBeGreaterThanOrEqual(zooms[i - 1]! - 1e-9)
  })

  it('leaves a goal’s own camera to the reference: with the layer off it lunges in and back out', () => {
    const replay = new FakeReplay({ goalZoom: false })
    replay.set({ time: 10, frame: ballFrame({ x: 30, y: 4 }), playing: true })
    replay.step(ballFrame({ x: 30, y: 4 }, ['GOAL']))
    const cameras = frames(replay, 30)
    expect(Math.max(...cameras.map((c) => c.zoom))).toBeGreaterThan(2)
  })

  // A real goal comes as the ball closes in, with the view still easing in after it: the view carries on into
  // the goal, with no stop and start, and on after it.
  it('carries the view on from the zoom near goal still easing in, without stopping', () => {
    const replay = playing({ x: 15, y: 3 })
    settle(replay)
    const cameras = play(replay, 0.6, (t) => ({ x: 15 + 25 * t, y: 3 }))
    const start = cameras.length
    replay.frame({ time: replay.time + 0.04, frame: ballFrame({ x: 40, y: 3 }, ['GOAL']) })
    cameras.push(camera(replay), ...frames(replay, Math.ceil((GOAL_SEQUENCE_MS + 1000) / FRAME_MS)))
    const steps = cameras.slice(1).map((c, i) => Math.log(c.zoom / cameras[i]!.zoom))
    // Into the goal: still zooming in at the speed it had, speeding up smoothly from there.
    const across = steps.slice(start - 4, start + 20)
    expect(Math.min(...across)).toBeGreaterThan(0)
    for (let i = 1; i < across.length; i++) expect(across[i]! / across[i - 1]!).toBeGreaterThan(0.85)
    for (let i = 1; i < across.length; i++) expect(across[i]! / across[i - 1]!).toBeLessThan(1.25)
    // Out of it and on: no frame moves much more than the one before it.
    const end = start + Math.round(GOAL_SEQUENCE_MS / FRAME_MS)
    const out = steps.slice(end - 30, end + 30).map(Math.abs)
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeLessThan(out[i - 1]! * 1.5 + 0.001)
  })

  it('hands back to the zoom near goal with no jump when it ends', () => {
    const replay = playing({ x: 30, y: 4 })
    settle(replay)
    replay.step(ballFrame({ x: 30, y: 4 }, ['GOAL']))
    replay.animate(GOAL_SEQUENCE_MS - 200)
    // Play goes on, and the ball heads back to the centre spot for the kick-off.
    const cameras = play(replay, 4, (t) => ({ x: 30 - 30 * t, y: 4 - 4 * t }))
    expect(Math.max(...zoomSteps(cameras))).toBeLessThan(0.03)
    settle(replay)
    expect(camera(replay)).toEqual(WHOLE_PITCH_CAMERA)
  })
})
