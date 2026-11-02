import { describe, expect, it } from 'vitest'
import pkg from '../package.json'
import { MATCH_TRACKER_VERSION } from '../src/version'

describe('MATCH_TRACKER_VERSION', () => {
  it("equals package.json's version", () => {
    expect(MATCH_TRACKER_VERSION).toBe(pkg.version)
  })
})
