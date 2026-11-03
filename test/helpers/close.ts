import { expect } from 'vitest'

const NUMBER = /-?\d+\.\d+(?:e[+-]?\d+)?/gi
const TOLERANCE = 1e-9

/**
 * A string that is `text` but for the decimals in it, which may be off by 1e-9.
 * A canvas gradient is recorded as a string with its coordinates in it.
 */
function closeText(text: string) {
  const numbers = (s: string) => (s.match(NUMBER) ?? []).map(Number)
  const skeleton = (s: string) => s.replace(NUMBER, '#')
  return {
    asymmetricMatch(other: unknown): boolean {
      if (typeof other !== 'string' || skeleton(other) !== skeleton(text)) return false
      const a = numbers(other)
      const b = numbers(text)
      return a.length === b.length && a.every((n, i) => Math.abs(n - b[i]!) <= TOLERANCE)
    },
    toString: () => text,
    toAsymmetricMatcher: () => text,
  }
}

/**
 * `value` with every number, and every decimal inside a string, turned into a
 * matcher that allows 1e-9 either way.
 *
 * The goldens hold the numbers the reference computed. The last digit of a
 * power (the director eases the zoom with `**`) differs between JavaScript
 * engine versions, Node 22 and Node 24 for one, by a unit in the last place:
 * about 1e-16 of a zoom, and no pixel. Nothing visible moves, so the goldens
 * are compared exactly first, and within this margin when that fails.
 */
export function withinRounding<T>(value: T): T {
  if (typeof value === 'number') return expect.closeTo(value, 9) as T
  if (typeof value === 'string') return (value.search(NUMBER) >= 0 ? closeText(value) : value) as T
  if (Array.isArray(value)) return value.map(withinRounding) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, withinRounding(inner)])) as T
  }
  return value
}
