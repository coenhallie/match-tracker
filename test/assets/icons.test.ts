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
    expect(icons.corner).toBe(images[0])
    expect(icons.freeKick).toBe(images[1])
    expect(icons.varCheck).toBe(images[2])
    expect(icons.goalDisallowed).toBe(images[3])
    expect(icons.yellowCard).toBe(images[4])
    expect(icons.redCard).toBe(images[5])
    expect(icons.substitution).toBe(images[6])
    expect(icons.substitutionOut).toBe(images[7])
    expect(icons.substitutionIn).toBe(images[8])
    expect(icons.scorer).toBe(images[9])
    expect(icons.throwIn).toBe(images[10])
    expect(images).toHaveLength(17)
    for (const image of images) expect(image.src).toMatch(/^data:image\/svg\+xml,/)
    expect(svgOf(images[0]!.src)).toContain('<g id="corner">')
    expect(svgOf(images[1]!.src)).toContain('<g id="free_kick">')
    expect(svgOf(images[2]!.src)).toContain('viewBox="0 0 175.5 94.25"')
    expect(svgOf(images[3]!.src)).toContain('viewBox="0 0 149.5 149.5"')
    // The goal-net icon is drawn only by the parity test's reference card, so it is not loaded.
    expect(icons).not.toHaveProperty('goal')
    expect(images.some((image) => svgOf(image.src).includes('shot_on_goal'))).toBe(false)
  })

  it("loads the penalty's six pictures", async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    const icons = await loadIcons()
    const sizes = {
      penalty: [11, 64, 64],
      penaltyGoal: [12, 484, 242],
      penaltyKeeper: [13, 192, 194],
      penaltyKeeperDive: [14, 273, 273],
      penaltyBallSpin: [15, 128, 128],
      penaltyBall: [16, 106, 106],
    } as const
    for (const [key, [index, width, height]] of Object.entries(sizes)) {
      expect(icons[key as keyof typeof sizes]).not.toBeNull()
      expect(icons[key as keyof typeof sizes]).toBe(images[index]!)
      const svg = svgOf(images[index]!.src)
      expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`)
      // Pure vector, and none of Figma's frame around the picture.
      expect(svg).not.toMatch(/<image|<foreignObject|#1E1E1E|9747FF/)
    }
  })

  it('loads one hand-and-card icon per card, filled in its colour', async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    const icons = await loadIcons()
    const yellow = svgOf((icons.yellowCard as unknown as { src: string }).src)
    const red = svgOf((icons.redCard as unknown as { src: string }).src)
    for (const svg of [yellow, red]) expect(svg).toContain('viewBox="0 0 208 208"')
    expect(yellow).toContain('fill="#EAB308"')
    expect(red).toContain('fill="#EF4444"')
    expect(yellow.replace('#EAB308', '#EF4444')).toBe(red)
  })

  it('loads the arrows icon and the two badges', async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    const icons = await loadIcons()
    const svg = (image: unknown) => svgOf((image as { src: string }).src)
    expect(svg(icons.substitution)).toContain('viewBox="0 0 208 208"')
    expect(svg(icons.substitution)).toContain('fill="#FDE047"')
    expect(svg(icons.substitutionOut)).toContain('viewBox="0 0 56 56"')
    expect(svg(icons.substitutionOut)).toContain('fill="#E95151"')
    expect(svg(icons.substitutionIn)).toContain('viewBox="0 0 56 56"')
    expect(svg(icons.substitutionIn)).toContain('fill="#22C55E"')
  })

  it("loads the scorer's icon as Figma exports it for the goal's scorer", async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    const icons = await loadIcons()
    const svg = svgOf((icons.scorer as unknown as { src: string }).src)
    // viewport/eventGoalScorerInfo's playerInfo (136:3659): the vector in its 56 px badge, in the line colour.
    expect(svg).toContain('viewBox="0 0 41.1129 39.319"')
    expect(svg).toContain('fill="#E2E8F0"')
  })

  it("loads the throw-in card's icon as Figma exports it", async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    const icons = await loadIcons()
    const svg = svgOf((icons.throwIn as unknown as { src: string }).src)
    // viewport/eventThrowInExclusive's banner icon (136:2337): 123.5 by 156, in its 208 px slot.
    expect(svg).toContain('viewBox="0 0 123.5 156"')
    expect(svg).toContain('<g id="throw_in">')
  })

  it('loads the free kick icon video-annotation had, which the design draws 3.25 times as large', async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    await loadIcons()
    const svg = svgOf(images[1]!.src)
    expect(svg).toContain('viewBox="0 0 45.5 40.9498"')
    // The ball's arrow in gold, the ball and the wall in the line colour, as the design has them.
    expect(svg).toContain('fill="#FDE047"')
    expect(svg.match(/fill="#E2E8F0"/g)).toHaveLength(3)
  })

  it('draws the corner icon in the box the card gives its icon', async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    await loadIcons()
    expect(svgOf(images[0]!.src)).toContain('viewBox="0 0 45.5 40.95"')
  })

  it('loads them once for the page', async () => {
    const { loadIcons } = await import('../../src/assets/icons')
    const [a, b] = await Promise.all([loadIcons(), loadIcons()])
    expect(a).toBe(b)
    expect(images).toHaveLength(17)
  })

  it('gives null for an icon that fails to load', async () => {
    failing = true
    const { loadIcons } = await import('../../src/assets/icons')
    expect(await loadIcons()).toEqual({ corner: null, freeKick: null, varCheck: null, goalDisallowed: null, yellowCard: null, redCard: null, substitution: null, substitutionOut: null, substitutionIn: null, scorer: null, throwIn: null, penalty: null, penaltyGoal: null, penaltyKeeper: null, penaltyKeeperDive: null, penaltyBallSpin: null, penaltyBall: null })
  })

  it('gives null for every icon where there is no Image', async () => {
    vi.stubGlobal('Image', undefined)
    const { loadIcons } = await import('../../src/assets/icons')
    expect(await loadIcons()).toEqual({ corner: null, freeKick: null, varCheck: null, goalDisallowed: null, yellowCard: null, redCard: null, substitution: null, substitutionOut: null, substitutionIn: null, scorer: null, throwIn: null, penalty: null, penaltyGoal: null, penaltyKeeper: null, penaltyKeeperDive: null, penaltyBallSpin: null, penaltyBall: null })
  })
})
