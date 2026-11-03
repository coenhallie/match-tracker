import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// loadIcons keeps its images for the page, so each test loads the module afresh.

let images: { src: string }[]
let failing: boolean

beforeEach(() => {
  vi.resetModules()
  images = []
  failing = false
  vi.stubGlobal(
    'Image',
    class {
      #listeners = new Map<string, () => void>()
      #src = ''
      constructor() {
        images.push(this)
      }
      addEventListener(type: string, listener: () => void) {
        this.#listeners.set(type, listener)
      }
      get src() {
        return this.#src
      }
      set src(value: string) {
        this.#src = value
        queueMicrotask(() => this.#listeners.get(failing ? 'error' : 'load')?.())
      }
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const svgOf = (src: string) => decodeURIComponent(src.replace(/^data:image\/svg\+xml,/, ''))

describe('loadIcons', () => {
  it('loads every card icon from SVG inside the bundle', async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    const icons = await loadIcons()
    expect(icons.freeKick).toBe(images[0])
    expect(icons.goal).toBe(images[1])
    expect(icons.corner).toBe(images[2])
    for (const image of images) expect(image.src).toMatch(/^data:image\/svg\+xml,/)
    expect(svgOf(images[0]!.src)).toContain('<g id="free_kick">')
    expect(svgOf(images[1]!.src)).toContain('<g id="shot_on_goal">')
    expect(svgOf(images[2]!.src)).toContain('<g id="corner">')
  })

  it('draws the corner icon in the box the free kick card gives its icon', async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    await loadIcons()
    expect(svgOf(images[2]!.src)).toContain('viewBox="0 0 45.5 40.95"')
  })

  it('loads them once for the page', async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    const [a, b] = await Promise.all([loadIcons(), loadIcons()])
    expect(a).toBe(b)
    expect(images).toHaveLength(3)
  })

  it('gives null for an icon that fails to load', async () => {
    failing = true
    const { loadIcons } = await import('../../src/assets/icons')
    expect(await loadIcons()).toEqual({ freeKick: null, goal: null, corner: null })
  })

  it('gives null for every icon where there is no Image', async () => {
    vi.stubGlobal('Image', undefined)
    const { loadIcons } = await import('../../src/assets/icons')
    expect(await loadIcons()).toEqual({ freeKick: null, goal: null, corner: null })
  })
})
