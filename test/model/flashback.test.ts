import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { KIND_RANK, carriedValidity } from '../../src/model/flashback'
import { parseRecord } from '../../src/model/parseRecord'

describe('carriedValidity', () => {
  it('ages an invalid countdown by record time', () => {
    const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: 6, horizonS: 10 } }
    expect(carriedValidity(last, 102)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: 4, horizonS: 10 })
  })
  it('flips to valid once the invalid countdown has run out', () => {
    const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: 1 } }
    expect(carriedValidity(last, 101.5)).toEqual({ invalid: false, nextInvalidInS: null, nextValidInS: 0 })
  })
  it('keeps a null countdown null', () => {
    const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: null, horizonS: 10 } }
    expect(carriedValidity(last, 130)?.nextValidInS).toBeNull()
    expect(carriedValidity(last, 130)?.invalid).toBe(true)
  })
  it('flips to invalid as a guess, with no horizon', () => {
    const last = { t: 100, validity: { invalid: false, nextInvalidInS: 0.5, nextValidInS: 0, horizonS: 10 } }
    expect(carriedValidity(last, 101)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: null })
  })
  it('drops the horizon of a null countdown once it has aged past it', () => {
    const horizon = 9.999999999990905
    const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: null, horizonS: horizon } }
    expect(carriedValidity(last, 109.9)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: null, horizonS: horizon })
    // The pipeline promised no valid record within its horizon, and no more: past it, nothing is known.
    expect(carriedValidity(last, 100 + horizon)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: null })
    expect(carriedValidity(last, 180)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: null })
  })
  it('counts a countdown aged to exactly 0 as run out', () => {
    const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: 1 } }
    expect(carriedValidity(last, 101)).toEqual({ invalid: false, nextInvalidInS: null, nextValidInS: 0 })
  })
  it('ages a valid countdown by record time, without flipping before it runs out', () => {
    const last = { t: 100, validity: { invalid: false, nextInvalidInS: 3, nextValidInS: 0, horizonS: 10 } }
    expect(carriedValidity(last, 101)).toEqual({ invalid: false, nextInvalidInS: 2, nextValidInS: 0, horizonS: 10 })
  })
  it('says nothing before anything was said', () => {
    expect(carriedValidity(null, 5)).toBeNull()
  })
})

describe('KIND_RANK', () => {
  it('ranks goal over corner over shot over attack', () => {
    const kinds = ['attack', 'shot', 'goal', 'corner'] as const
    expect([...kinds].sort((a, b) => KIND_RANK[a] - KIND_RANK[b])).toEqual(['goal', 'corner', 'shot', 'attack'])
  })
})

describe('the staging validity fixture', () => {
  it('has a run of 5 s or more, one over 10 s, a short valid gap, and copies with no validity', () => {
    const lines = gunzipSync(readFileSync(resolve(process.cwd(), 'test/fixtures/staging-validity.jsonl.gz')))
      .toString()
      .split('\n')
      .filter(Boolean)
    const records = lines.map((line) => parseRecord(line))
    expect(records.every((record) => record !== null)).toBe(true)
    const validities = records.map((record) => record?.validity)
    expect(validities.some((v) => v && v.invalid && v.nextValidInS !== null && v.nextValidInS >= 5)).toBe(true)
    expect(validities.some((v) => v && v.invalid && v.nextValidInS === null && Math.round(v.horizonS ?? 0) === 10)).toBe(true)
    expect(
      validities.some((v) => v && !v.invalid && v.nextInvalidInS !== null && v.nextInvalidInS < 1.5),
    ).toBe(true)
    expect(validities.some((v) => v === undefined)).toBe(true)
  })
})
