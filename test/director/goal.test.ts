import { describe, it, expect } from 'vitest'
import { GOAL_SEQUENCE_MS, goalCamera, planGoal } from '../../src/analysis/goalSequence'
import { blendCamera, takesCamera } from '../../src/director/camera'
import { Director, type DirectorInput, type DirectorView } from '../../src/director/director'
import { DEFAULT_REPLAY_LAYERS } from '../../src/model/replayLayers'
import type { Frame } from '../../src/model/types'
import { viewFromCamera } from '../../src/render/viewTransform'
import { FakeReplay, VIEW } from './harness'

// The goal sequence's cases from pipelineOutputSurface.test.ts (:668-891, and the layers menu's :2517 and
// :2528), with the surface's fake replay as FakeReplay: `tick` is one playback step that brings a record,
// `animate` runs animation frames as the reference's does, `setView` stands for the renderer's.

/** A frame with the ball, or none, and the labels it carries (reference :722-730). */
const goalFrame = (labels: string[], ball: { x: number; y: number } | null = { x: 30, y: 5 }): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68, goal_width: 7.32 },
    teams: [],
    balls: ball ? [{ projected_coordinates: ball }] : [],
    state: { actions: labels.map((action_type) => ({ action_type })) },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

/** Mounted the way load() leaves it, then playing at 10 s (reference :735-746). */
function playing(): FakeReplay {
  const replay = new FakeReplay()
  replay.set({ time: 10, frame: goalFrame(['other']), playing: true })
  return replay
}

/** One playback tick: the clock moves on a frame and the next record shows. */
const tick = (replay: FakeReplay, frame: Frame, step = 0.04) => replay.step(frame, step)

const lastOverlay = (replay: FakeReplay) => replay.last()?.goal

describe('goal sequence', () => {
  it('rolls its ball into the net', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(16)
    const before = replay.last()?.ballSpin
    replay.animate(400)
    expect(lastOverlay(replay)).toBeDefined()
    expect(replay.last()?.ballSpin).not.toEqual(before)
  })

  it('plays when playback runs into a GOAL label', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(1200)
    expect(lastOverlay(replay)).toBeDefined()
  })

  it('ends by itself and goes back to the tracked ball', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(GOAL_SEQUENCE_MS + 200)
    expect(lastOverlay(replay)).toBeUndefined()
  })

  // A seek is not a goal happening: it would replace the frame someone jumped to look at with an animation.
  it('does not play when a seek lands on a GOAL label', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']), 250)
    replay.animate(1200)
    expect(lastOverlay(replay)).toBeUndefined()
  })

  it('does not play while paused, for example when stepping a frame', () => {
    const replay = playing()
    replay.pause()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(1200)
    expect(lastOverlay(replay)).toBeUndefined()
  })

  it('stops and shows the real frame the moment playback pauses', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(500)
    replay.pause()
    expect(lastOverlay(replay)).toBeUndefined()
  })

  it('stops on a seek made while it plays', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(500)
    tick(replay, goalFrame(['other']), 120)
    expect(lastOverlay(replay)).toBeUndefined()
  })

  // A drawing stamped on a frame whose ball is the animation's would record something the pipeline never
  // produced. The widget calls stopAll for a press on its overlay.
  it('stops the moment someone presses on the drawing layer', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(500)
    replay.stopAll()
    expect(lastOverlay(replay)).toBeUndefined()
  })

  it('plays once per GOAL label, not again on its following frames', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(GOAL_SEQUENCE_MS + 200)
    tick(replay, goalFrame(['GOAL']))
    replay.animate(300)
    expect(lastOverlay(replay)).toBeUndefined()

    // A new label, after one without it, is a new goal.
    tick(replay, goalFrame(['other']))
    tick(replay, goalFrame(['GOAL']))
    replay.animate(300)
    expect(lastOverlay(replay)).toBeDefined()
  })

  it('zooms in on the goal while the sequence plays', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(1000)
    expect(replay.lastView()!.zoom).toBeGreaterThanOrEqual(1.4)
  })

  it('eases back out to the view it started from', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(GOAL_SEQUENCE_MS + 200)
    expect(replay.lastView()).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
  })

  it('snaps back to the view it started from the moment playback pauses', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(800)
    replay.pause()
    expect(replay.lastView()).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
  })

  it('hands the view over, and leaves it, when the user scrolls during it', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL']))
    replay.animate(800)
    const zoomed = replay.lastView()!.zoom
    replay.wheel()
    const own = replay.lastView()!.zoom
    expect(own).toBeCloseTo(zoomed + 0.15, 6)

    replay.animate(GOAL_SEQUENCE_MS)
    expect(replay.lastView()!.zoom).toBeCloseTo(own, 6)
    // The shot itself still finished.
    expect(lastOverlay(replay)).toBeUndefined()
  })

  it('does not play without a ball to tell which goal it went in', () => {
    const replay = playing()
    tick(replay, goalFrame(['GOAL'], null))
    replay.animate(500)
    expect(lastOverlay(replay)).toBeUndefined()
  })

  describe('layers', () => {
    // Reference :2517.
    it('does not play the goal animation when it is off', () => {
      const replay = new FakeReplay()
      replay.ready(goalFrame(['other']))
      replay.toggle({ goal: false })
      replay.play()
      tick(replay, goalFrame(['GOAL']))
      replay.animate(1000)
      expect(replay.last()?.goal).toBeUndefined()
    })

    // Reference :2528.
    it('stops a goal animation that is playing when it is switched off, view and all', () => {
      const replay = new FakeReplay()
      replay.ready(goalFrame(['other']))
      replay.play()
      tick(replay, goalFrame(['GOAL']))
      replay.animate(800)
      expect(replay.last()?.goal).toBeDefined()
      replay.toggle({ goal: false })
      expect(replay.last()?.goal).toBeUndefined()
      expect(replay.lastView()).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
    })
  })

  // Beyond the reference's cases: the order of its paints and views, which the golden recordings pin.
  describe('paints and views', () => {
    it('starts on the label, and is timed from the first animation frame after it', () => {
      const replay = playing()
      const labelled = tick(replay, goalFrame(['GOAL']))
      // The frame watcher paints the sequence at its start, the ball where the shot is taken from.
      expect(labelled.paints).toHaveLength(1)
      const start = labelled.layers?.goal?.ball
      expect(start).toEqual(planGoal(goalFrame(['GOAL']))!.start)
      expect(labelled.animating).toBe(true)
      // The first frame is the sequence's 0 ms: the ball still at the start, the view not moved.
      const [first, second] = replay.animate(33)
      expect(first!.paints).toHaveLength(1)
      expect(first!.layers?.goal?.ball).toEqual(start)
      expect(first!.camera).toEqual({ zoom: 1, panX: 0, panY: 0 })
      expect(second!.layers?.goal?.ball).not.toEqual(start)
    })

    // The reference's goalStep paints with the renderer's view, then the view watcher pushes the view it
    // moved to and paints again (golden seek-mid-goal steps 64 to 66).
    it('paints each frame in the view it had, then again in the view it moved to', () => {
      const replay = playing()
      tick(replay, goalFrame(['GOAL']))
      replay.animate(16)
      const [frame] = replay.animate(16)
      expect(frame!.paints).toHaveLength(2)
      const [own, pushed] = frame!.paints
      expect(own!.view).toEqual(VIEW)
      expect(pushed!.view.zoom).toBeGreaterThan(1)
      expect(pushed!.view).toEqual({ ...frame!.camera!, renderedWidth: VIEW.renderedWidth })
      expect(pushed!.layers).toEqual(own!.layers)
    })

    it('moves the view from where the user had it to the goal framed', () => {
      const replay = playing()
      const from: DirectorView = { zoom: 2, panX: 100, panY: -40, renderedWidth: 640 }
      replay.director.setView(from)
      const frame = goalFrame(['GOAL'])
      tick(replay, frame)
      // An update brings the caller's own view, which it has not changed: the director keeps its own.
      const outputs = replay.animate(1500)
      const framed = viewFromCamera(goalCamera(planGoal(frame)!, frame.pitch_dimensions), 640)
      expect(outputs.at(-1)!.camera!.zoom).toBeCloseTo(framed.zoom, 9)
      expect(outputs.at(-1)!.camera!.panX).toBeCloseTo(framed.panX, 9)
      replay.animate(GOAL_SEQUENCE_MS)
      expect(replay.lastView()).toEqual(from)
      expect(replay.director.view).toEqual(from)
    })

    // A seek mid-goal: the clock watcher's stop paints with the record it leaves and the goal's view, the
    // view watcher pushes the user's view back with the new record, then the frame watcher paints (golden
    // seek-mid-goal steps 172 to 174).
    it('stops on a seek with the old record and view, then puts the view back, then draws the new record', () => {
      const replay = playing()
      tick(replay, goalFrame(['GOAL']))
      replay.animate(1000)
      const goalView = replay.lastView()!
      const landed = goalFrame(['other'], { x: -10, y: 0 })
      const seek = tick(replay, landed, 3)
      expect(seek.paints.map((p) => p.view)).toEqual([goalView, VIEW, VIEW])
      expect(seek.paints[0]!.frame).not.toBe(landed)
      expect(seek.paints[0]!.layers.goal).toBeUndefined()
      expect(seek.paints[1]!.frame).toBe(landed)
      expect(seek.paints[2]!.frame).toBe(landed)
      expect(seek.camera).toEqual({ zoom: 1, panX: 0, panY: 0 })
    })

    it('ends on the frame its time runs out, putting the view back', () => {
      const replay = playing()
      tick(replay, goalFrame(['GOAL']))
      const outputs = replay.animate(GOAL_SEQUENCE_MS + 100)
      const end = outputs.findIndex((o) => !o.animating)
      expect(end).toBeGreaterThan(0)
      // goalStep's stop paints the frame without the goal. The camera has eased all the way back by then.
      const last = outputs[end]!
      expect(last.paints).toHaveLength(1)
      expect(last.paints[0]!.layers.goal).toBeUndefined()
      expect(last.paints[0]!.view).toEqual(VIEW)
      expect(outputs.slice(end + 1).every((o) => !o.paint)).toBe(true)
    })

    it('leaves the view where the user put it when they took it over', () => {
      const replay = playing()
      tick(replay, goalFrame(['GOAL']))
      replay.animate(800)
      replay.wheel()
      const own = replay.director.view
      const outputs = replay.animate(GOAL_SEQUENCE_MS)
      expect(outputs.every((o) => o.camera === null)).toBe(true)
      expect(replay.director.view).toEqual(own)
    })

    it('does not move the view under reduced motion, and shows the ball in the net and the card at once', () => {
      const replay = playing()
      replay.reducedMotion = true
      tick(replay, goalFrame(['GOAL']))
      const [first, second] = replay.animate(33)
      expect(first!.layers?.goalBanner).toEqual({ intensity: 1 })
      expect(first!.camera).toBeNull()
      expect(second!.paints).toHaveLength(1)
      const end = goalFrame(['GOAL'])
      const plan = planGoal(end)!
      expect(first!.layers?.goal?.ball.x).toBeCloseTo(plan.rest.x, 9)
      replay.animate(GOAL_SEQUENCE_MS)
      expect(replay.director.view).toEqual(VIEW)
    })

    it('takes a view passed with an update as the caller’s own change only when it is a new one', () => {
      const director = new Director({
        layers: DEFAULT_REPLAY_LAYERS,
        reducedMotion: () => false,
        teamName: () => 'Red',
        teamColor: () => '#e51a1a',
      })
      const record = { t: 10, frameCount: 1, frame: goalFrame(['other']) }
      const input: DirectorInput = { nowMs: 1000, time: 10, playing: false, playback: false, record, phase: null, trail: null }
      director.update(input, VIEW)
      // The same view again: nothing to push.
      expect(director.update({ ...input, nowMs: 1016 }, VIEW).paint).toBe(false)
      // A new one: pushed and drawn, as setView would.
      const zoomed = { ...VIEW, zoom: 2 }
      const pushed = director.update({ ...input, nowMs: 1032 }, zoomed)
      expect(pushed.paints.map((p) => p.view)).toEqual([zoomed])
      expect(director.view).toEqual(zoomed)
    })

    it('puts the view back on reset, and says so in the next output', () => {
      const replay = playing()
      tick(replay, goalFrame(['GOAL']))
      replay.animate(800)
      expect(replay.director.view.zoom).toBeGreaterThan(1)
      replay.director.reset()
      expect(replay.director.view).toEqual(VIEW)
      expect(replay.set({ time: 20 }).camera).toEqual({ zoom: 1, panX: 0, panY: 0 })
    })
  })
})

describe('camera', () => {
  it('blends the zoom geometrically and the centre linearly', () => {
    const from = { zoom: 1, x: 640, y: 360 }
    const to = { zoom: 4, x: 1000, y: 200 }
    expect(blendCamera(from, to, 0)).toEqual(from)
    expect(blendCamera(from, to, 1)).toEqual(to)
    const half = blendCamera(from, to, 0.5)
    expect(half.zoom).toBeCloseTo(2, 12)
    expect(half.x).toBe(820)
    expect(half.y).toBe(280)
  })

  // releaseSequenceCamera is called by the wheel and double-click handlers always, and by the press
  // handler only once it is past its return at the whole pitch (:307-368).
  it('hands the view to the user on a wheel or a double click, and on a press only zoomed in', () => {
    expect(takesCamera('wheel', 1)).toBe(true)
    expect(takesCamera('dblclick', 1)).toBe(true)
    expect(takesCamera('pointerdown', 1)).toBe(false)
    expect(takesCamera('pointerdown', 1.15)).toBe(true)
    expect(takesCamera('pointermove', 3)).toBe(false)
    expect(takesCamera('pointerup', 3)).toBe(false)
  })
})
