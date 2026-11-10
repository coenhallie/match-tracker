import { describe, expect, it } from 'vitest'
import { carriedValidity } from '../../src/model/validity'

describe('carriedValidity', () => {
  it('says nothing before anything was said', () => {
    expect(carriedValidity(null, 5)).toBeNull()
  })

  it('ages an invalid countdown by record time, keeping the horizon', () => {
    const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: 6, horizonS: 10 } }
    expect(carriedValidity(last, 102)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: 4, horizonS: 10 })
  })

  it('ages a valid countdown by record time', () => {
    const last = { t: 100, validity: { invalid: false, nextInvalidInS: 3, nextValidInS: 0 } }
    expect(carriedValidity(last, 101)).toEqual({ invalid: false, nextInvalidInS: 2, nextValidInS: 0 })
  })

  it('flips to valid once the invalid countdown has run out, exactly 0 included', () => {
    const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: 1, horizonS: 10 } }
    expect(carriedValidity(last, 101)).toEqual({ invalid: false, nextInvalidInS: null, nextValidInS: 0 })
    expect(carriedValidity(last, 101.5)).toEqual({ invalid: false, nextInvalidInS: null, nextValidInS: 0 })
  })

  it('flips to invalid as a guess, with no horizon', () => {
    const last = { t: 100, validity: { invalid: false, nextInvalidInS: 0.5, nextValidInS: 0, horizonS: 10 } }
    expect(carriedValidity(last, 101)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: null })
  })

  it('keeps a null countdown null, and drops its horizon once aged past it', () => {
    const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: null, horizonS: 10 } }
    expect(carriedValidity(last, 105)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: null, horizonS: 10 })
    expect(carriedValidity(last, 110)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: null })
  })

  it('never ages backwards for a record older than the last that said anything', () => {
    const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: 6 } }
    expect(carriedValidity(last, 99)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: 6 })
  })
})
