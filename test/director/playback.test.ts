import { describe, it, expect } from 'vitest'
import { MAX_PLAYBACK_STEP_S, isPlaybackStep, nextPlayback } from '../../src/director/playback'

describe('isPlaybackStep', () => {
  it('is half a second at most', () => {
    expect(MAX_PLAYBACK_STEP_S).toBe(0.5)
  })

  it('counts a step forward of up to half a second while playing', () => {
    expect(isPlaybackStep(10, 10.04, true)).toBe(true)
    expect(isPlaybackStep(10, 10.5, true)).toBe(true)
  })

  it('counts anything else as a seek', () => {
    expect(isPlaybackStep(10, 10.04, false)).toBe(false)
    expect(isPlaybackStep(null, 10, true)).toBe(false)
    expect(isPlaybackStep(10, 10, true)).toBe(false)
    expect(isPlaybackStep(10, 9.96, true)).toBe(false)
    expect(isPlaybackStep(10, 10.500001, true)).toBe(false)
  })
})

// The reference sets its flag only when the clock moves (PipelineOutputSurface.vue:562-581).
describe('nextPlayback', () => {
  it('is a seek with nothing before it', () => {
    expect(nextPlayback(null, 10, true)).toBe(false)
  })

  it('follows isPlaybackStep when the time changes', () => {
    expect(nextPlayback({ time: 10, playback: false }, 10.04, true)).toBe(true)
    expect(nextPlayback({ time: 10, playback: true }, 13, true)).toBe(false)
    expect(nextPlayback({ time: 10, playback: true }, 10.04, false)).toBe(false)
  })

  it('keeps the flag it had while the time stands still, whatever playing says', () => {
    expect(nextPlayback({ time: 10, playback: true }, 10, true)).toBe(true)
    expect(nextPlayback({ time: 10, playback: true }, 10, false)).toBe(true)
    expect(nextPlayback({ time: 10, playback: false }, 10, true)).toBe(false)
  })
})
