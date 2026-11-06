import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// happy-dom has neither FontFace nor document.fonts, so both are stood in for
// here. ensureFonts keeps its registration for the page, so each test loads
// the module afresh.

interface FakeFace {
  family: string
  source: string
  descriptors: FontFaceDescriptors
  load: () => Promise<FakeFace>
}

let faces: FakeFace[]
let added: FakeFace[]
let failing: Set<string>

beforeEach(() => {
  vi.resetModules()
  faces = []
  added = []
  failing = new Set()
  vi.stubGlobal(
    'FontFace',
    class {
      family: string
      source: string
      descriptors: FontFaceDescriptors
      constructor(family: string, source: string, descriptors: FontFaceDescriptors) {
        this.family = family
        this.source = source
        this.descriptors = descriptors
        faces.push(this as unknown as FakeFace)
      }
      load() {
        const key = `${this.family} ${this.descriptors.style ?? 'normal'} ${this.descriptors.weight}`
        return failing.has(key) ? Promise.reject(new Error('network')) : Promise.resolve(this)
      }
    },
  )
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add: (face: FakeFace) => void added.push(face) },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'fonts')
})

const describeFace = (f: FakeFace) => `${f.family} ${f.descriptors.style ?? 'normal'} ${f.descriptors.weight}`

describe('ensureFonts', () => {
  it('registers each bundled face on the page once, however often it is called', async () => {
    const { ensureFonts } = await import('../../src/assets/fonts')
    await Promise.all([ensureFonts(), ensureFonts()])
    await ensureFonts()
    expect(added.map(describeFace).sort()).toEqual([
      'MatchTracker Inter italic 900',
      'MatchTracker Inter normal 600',
      'MatchTracker Montserrat normal 400',
      'MatchTracker Montserrat normal 600',
      'MatchTracker Montserrat normal 700',
    ])
    expect(faces).toHaveLength(5)
  })

  it('loads each face from its own woff2 file, not from inside the script', async () => {
    const { ensureFonts } = await import('../../src/assets/fonts')
    await ensureFonts()
    for (const face of added) {
      expect(face.source).toMatch(/^url\(".*\.woff2(\?no-inline)?"\) format\("woff2"\)$/)
      expect(face.source).not.toContain('data:')
      expect(face.descriptors.unicodeRange).toContain('U+0000-00FF')
    }
  })

  it('still resolves when a face fails to load', async () => {
    failing.add('MatchTracker Inter italic 900')
    failing.add('MatchTracker Montserrat normal 600')
    const { ensureFonts } = await import('../../src/assets/fonts')
    await expect(ensureFonts()).resolves.toBeUndefined()
    expect(added).toHaveLength(5)
  })

  it('resolves at once where the page has no FontFace API', async () => {
    vi.stubGlobal('FontFace', undefined)
    const { ensureFonts } = await import('../../src/assets/fonts')
    await expect(ensureFonts()).resolves.toBeUndefined()
    expect(added).toHaveLength(0)
  })
})
