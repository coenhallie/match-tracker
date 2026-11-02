/**
 * The baseline snapshots (test/render/baseline.test.ts) record the renderer's
 * draw calls as the reference draws them. Theming changes how fonts are named
 * (a private family and a CJK fallback after each bundled one), and nothing
 * else about the drawing, so the calls are compared with font families reduced
 * to the reference's own names.
 */

/** Families that only exist as the CJK fallback after a bundled family. */
const CJK_FALLBACKS = new Set(['PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC'])

/** The private family names the bundled fonts go by. */
const PRIVATE_FAMILIES = new Map([
  ['MatchTracker Montserrat', 'Montserrat'],
  ['MatchTracker Inter', 'Inter'],
])

/** Split a family list on its commas, leaving a comma inside quotes alone. */
function splitFamilies(list: string): string[] {
  const families: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = null
      current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === ',') {
      families.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  families.push(current.trim())
  return families
}

const unquote = (family: string) => family.replace(/^(["'])(.*)\1$/, '$2')

/**
 * A canvas font shorthand with its family list reduced: "MatchTracker X" read
 * as "X", and the CJK fallbacks dropped. A value without a size is not a font
 * shorthand the renderer writes, and is left as it is.
 */
function normalizeFont(font: string): string {
  const match = /^(.*?\d(?:\.\d+)?px)\s+(.*)$/.exec(font)
  if (!match) return font
  const [, head, list] = match
  const families = splitFamilies(list ?? '')
    .map(unquote)
    .filter((family) => !CJK_FALLBACKS.has(family))
    .map((family) => PRIVATE_FAMILIES.get(family) ?? family)
  return `${head} ${families.join(', ')}`
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      out[key] = key === 'font' && typeof inner === 'string' ? normalizeFont(inner) : normalizeValue(inner)
    }
    return out
  }
  return value
}

/**
 * Recorded draw calls with every `font` value's family list normalised. Nothing
 * else is changed.
 */
export function normalizeCalls(calls: unknown[]): unknown[] {
  return calls.map(normalizeValue)
}
