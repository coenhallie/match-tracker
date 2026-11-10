/**
 * What package.json promises the apps that install the package: who may use
 * it, where it comes from, what it ships, and what a tool may read of it.
 */
import { describe, expect, it } from 'vitest'
import pkg from '../package.json'

describe('package.json', () => {
  it('says the package is not licensed for others, and where its source is', () => {
    expect(pkg.license).toBe('UNLICENSED')
    expect(pkg.repository).toEqual({ type: 'git', url: 'git+https://github.com/coenhallie/match-tracker.git' })
  })

  it('ships dist alone, and lets tools read package.json through exports', () => {
    expect(pkg.files).toEqual(['dist'])
    expect(pkg.exports).toMatchObject({ './package.json': './package.json' })
    expect(pkg.exports['./banner']).toEqual({ types: './dist/banner.d.ts', import: './dist/banner.js' })
    expect(Object.keys(pkg.exports)).toEqual(['.', './vue', './banner', './package.json'])
  })
})
