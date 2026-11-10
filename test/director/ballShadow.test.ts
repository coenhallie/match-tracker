import { describe, expect, it } from 'vitest'
import type { Frame } from '../../src/model/types'
import { FakeReplay } from './harness'

// The shadow under a high ball is drawn by the renderer; the director only says whether its layer is on.

const frame = { pitch_dimensions: { length: 105, width: 68 }, teams: [], balls: [] } as unknown as Frame

describe('the ballShadow layer', () => {
  it('reaches every paint, and follows the layer as it is switched', () => {
    const replay = new FakeReplay({ ballShadow: true })
    replay.set({ time: 10, frame, playing: true })
    expect(replay.last()?.ballShadow).toBe(true)
    replay.toggle({ ballShadow: false })
    expect(replay.last()?.ballShadow).toBe(false)
  })
})
