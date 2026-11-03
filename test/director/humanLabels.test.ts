import { describe, it, expect } from 'vitest'
import type { Frame } from '../../src/model/types'
import { FakeReplay } from './harness'

// The moments play only on a human's labels: a label the pipeline's AI gave (action_origin "ai"), or one
// from an export too old to say (no origin), plays nothing. Whole animation frames, as the moments' tests.

type Origin = 'human' | 'ai' | undefined

/** A frame with the ball at `ball`, someone near it, and `label` given by `origin`. */
const frameWith = (label: string | null, origin: Origin, ball = { x: 30, y: 5 }): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68, goal_width: 7.32 },
    teams: [{ team_id: 0, players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x: 3, y: 2 } }] }],
    balls: [{ projected_coordinates: ball }],
    state: { actions: label ? [{ action_type: label, ...(origin ? { action_origin: origin } : {}) }] : [] },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

/** Playback running into `label`, then a second of animation frames. */
function playInto(label: string, origin: Origin) {
  const replay = new FakeReplay()
  replay.set({ time: 10, frame: frameWith(null, undefined), playing: true })
  replay.step(frameWith(label, origin))
  replay.animate(1000, true)
  return replay.outputs.flatMap((o) => o.paints.map((p) => p.layers))
}

const MOMENTS = [
  { label: 'GOAL', shown: (l: ReturnType<typeof playInto>[number]) => l.goal ?? l.goalBanner },
  { label: 'Corner', shown: (l: ReturnType<typeof playInto>[number]) => l.corner },
  { label: 'Throw in', shown: (l: ReturnType<typeof playInto>[number]) => l.throwIn },
] as const

describe('the moments, on who gave the label', () => {
  for (const { label, shown } of MOMENTS) {
    it(`plays the ${label} on a human’s label`, () => {
      expect(playInto(label, 'human').some((l) => shown(l))).toBe(true)
    })

    it(`plays nothing on the AI’s ${label} label, or one with no origin`, () => {
      for (const origin of ['ai', undefined] as const) {
        const paints = playInto(label, origin)
        expect(paints.length).toBeGreaterThan(0)
        expect(paints.some((l) => l.goal ?? l.goalBanner ?? l.corner ?? l.throwIn)).toBe(false)
      }
    })
  }
})
