import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRenderer, type FrameLayers } from '../../src/render/renderer'
import { DEFAULT_THEME, type RenderTheme } from '../../src/render/theme'
import { PERSON_COLORS } from '../../src/render/constants'
import type { Frame } from '../../src/model/types'
import { fakeCanvas, stubOffscreenCanvas, type Op } from '../helpers/recordingCtx'
import { normalizeCalls } from '../helpers/normalize'

const PITCH = { length: 105, width: 68 }

/** Home has the ball at (-10, 4), away has a player near it, and the frame carries `actions`. */
function frame(actions: string[] = [], origin: string | undefined = 'human'): Frame {
  return {
    pitch_dimensions: PITCH,
    teams: [
      {
        team_id: 0,
        players: [
          {
            track_id: 7,
            person_type: 'PersonType.PLAYER',
            projected_coordinates: { x: -10, y: 4 },
            player_number: 7,
            in_possession: true,
          },
        ],
      },
      {
        team_id: 1,
        players: [
          { track_id: 21, person_type: 'PersonType.PLAYER', projected_coordinates: { x: -8, y: 6 }, player_number: 21 },
        ],
      },
    ],
    balls: [{ projected_coordinates: { x: -10, y: 4 } }],
    state: { actions: actions.map((action_type) => ({ action_type, action_origin: origin })) },
  } as unknown as Frame
}

const ATTACK = {
  team: 0 as const,
  color: '#e51a1a',
  name: 'Home',
  direction: 1 as const,
  intensity: 1,
  playersFade: 0,
}

const EVERY_MOMENT: FrameLayers = {
  attack: ATTACK,
  corner: { intensity: 1, playersFade: 0, ballFade: 0, corner: { x: -1, y: 1 }, sections: [1, 1, 1] },
  throwIn: { intensity: 1, slide: 1, side: null },
  // Half way in, so the people it fades out are still drawn, in the theme's colours.
  labelCard: { key: 'varCheck', intensity: 0.5 },
  smallLabelCard: { key: 'foul', intensity: 1 },
  goalBanner: { intensity: 1 },
}

let offscreen: ReturnType<typeof stubOffscreenCanvas>

beforeEach(() => {
  offscreen = stubOffscreenCanvas()
})

afterEach(() => {
  offscreen.restore()
})

function render(theme: RenderTheme | undefined, f: Frame, layers?: FrameLayers): Op[] {
  const { canvas, ops } = fakeCanvas()
  createRenderer(canvas, theme).renderFrame(f, layers)
  return ops
}

const texts = (ops: Op[]) => ops.filter((o) => o.op === 'fillText')
const textOf = (ops: Op[], text: string) => texts(ops).find((o) => o.args[0] === text)

describe('DEFAULT_THEME', () => {
  it("is the reference's colours, words and action text, with no icons until they load", () => {
    expect(DEFAULT_THEME.colors).toEqual(PERSON_COLORS)
    expect(DEFAULT_THEME.text).toEqual({
      goal: 'GOAL',
      corner: 'CORNER',
      freeKick: 'FREE KICK',
      throwIn: 'THROW IN',
      attack: 'Attack',
      flashback: 'REPLAY',
      flashbackAgo: '{time} AGO',
      varCheck: 'VAR CHECK',
      goalDisallowed: 'GOAL DISALLOWED',
      halfTime: 'HALF TIME',
      halfTimeText: 'There is a break in play.\nCoverage will resume soon.',
      secondHalf: 'SECOND HALF',
      secondHalfText: 'The match has restarted.',
      fullTime: 'FULL TIME',
      fullTimeText: 'This match has ended.',
      foul: 'FOUL',
      shotOnGoal: 'SHOT!',
      headerOnGoal: 'HEADER!',
      yellowCard: 'YELLOW CARD',
      redCard: 'RED CARD',
      substitution: 'SUBSTITUTION',
    })
    expect(DEFAULT_THEME.icons).toEqual({ corner: null, freeKick: null, varCheck: null, goalDisallowed: null, yellowCard: null, redCard: null, substitution: null, substitutionOut: null, substitutionIn: null, scorer: null })
    expect(DEFAULT_THEME.formatAction('EventType.FREE_KICK')).toBe('EventType.FREE_KICK')
    expect(DEFAULT_THEME.aiLabels).toBe(false)
  })

  it('is frozen, with colours of its own, so no host or instance can change what the next one reads', () => {
    expect(DEFAULT_THEME.colors).not.toBe(PERSON_COLORS)
    expect(Object.isFrozen(DEFAULT_THEME)).toBe(true)
    for (const part of [DEFAULT_THEME.colors, DEFAULT_THEME.text, DEFAULT_THEME.fonts, DEFAULT_THEME.icons]) {
      expect(Object.isFrozen(part)).toBe(true)
    }
    for (const role of Object.keys(PERSON_COLORS) as Array<keyof typeof PERSON_COLORS>) {
      expect(DEFAULT_THEME.colors[role]).not.toBe(PERSON_COLORS[role])
      expect(Object.isFrozen(DEFAULT_THEME.colors[role])).toBe(true)
    }
    expect(() => {
      DEFAULT_THEME.colors.home.fill = '#00ff00'
    }).toThrow(TypeError)
    expect(PERSON_COLORS.home.fill).toBe('#e51a1a')
  })

  it('names the bundled families, each followed by the CJK fallback', () => {
    const fallback = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    expect(DEFAULT_THEME.fonts.label).toBe(`"MatchTracker Montserrat", ${fallback}`)
    expect(DEFAULT_THEME.fonts.title).toBe(`"MatchTracker Inter", ${fallback}`)
  })

  // The baseline snapshots (baseline.test.ts) are the full proof. This pins
  // that passing the default theme is the same as passing none.
  it('draws exactly what the renderer draws with no theme given', () => {
    const f = frame(['Pass'])
    expect(render(DEFAULT_THEME, f, EVERY_MOMENT)).toEqual(render(undefined, f, EVERY_MOMENT))
  })

  it("draws the canvas text in the reference's fonts, once the families are normalised", () => {
    const ops = normalizeCalls(render(DEFAULT_THEME, frame(), EVERY_MOMENT)) as Op[]
    expect(textOf(ops, 'Home')!.font).toMatch(/^600 [\d.]+px Montserrat, sans-serif$/)
    expect(textOf(ops, 'Attack')!.font).toMatch(/^700 [\d.]+px Montserrat, sans-serif$/)
    for (const title of ['CORNER', 'THROW IN', 'GOAL']) {
      expect(textOf(ops, title)!.font).toMatch(/^italic 900 [\d.]+px Inter, sans-serif$/)
    }
  })
})

describe('a custom theme', () => {
  const custom = (over: Partial<RenderTheme>): RenderTheme => ({ ...DEFAULT_THEME, ...over })

  it("fills the home players in the theme's home colour", () => {
    const theme = custom({
      colors: { ...DEFAULT_THEME.colors, home: { fill: '#00ff00', outline: '#003300', text: '#111111' } },
    })
    const ops = render(theme, frame())
    // The home player's circle, at their position.
    const fills = ops.filter((o) => o.op === 'fill').map((o) => o.fillStyle)
    expect(fills).toContain('#00ff00')
    expect(fills).not.toContain(PERSON_COLORS.home.fill)
    // The away player keeps the default.
    expect(fills).toContain(PERSON_COLORS.away.fill)
    // The shirt number is in the home text colour.
    expect(textOf(ops, '7')!.fillStyle).toBe('#111111')
  })

  it("writes the theme's words on the cards and the attack label", () => {
    const theme = custom({ text: { goal: '进球', corner: '角球', freeKick: '任意球', throwIn: '界外球', attack: '进攻', flashback: '回放', flashbackAgo: '{time}前', varCheck: 'VAR 检查', goalDisallowed: '进球无效', halfTime: '中场休息', halfTimeText: '比赛暂停中。', secondHalf: '下半场', secondHalfText: '比赛已重新开始。', fullTime: '全场结束', fullTimeText: '本场比赛已结束。', foul: '犯规', shotOnGoal: '射门！', headerOnGoal: '头球！', yellowCard: '黄牌', redCard: '红牌', substitution: '换人' } })
    const words = texts(render(theme, frame(), EVERY_MOMENT)).map((o) => o.args[0])
    expect(words).toEqual(expect.arrayContaining(['进球', '角球', '界外球', '进攻', 'VAR 检查', '犯规']))
    expect(words).not.toContain('GOAL')
    expect(words).not.toContain('CORNER')
    expect(words).not.toContain('THROW IN')
    expect(words).not.toContain('Attack')
    // The goal card's title in particular.
    expect(textOf(render(theme, frame(), { goalBanner: { intensity: 1 } }), '进球')).toBeDefined()
  })

  it('draws the bottom-left action text through formatAction', () => {
    const theme = custom({ formatAction: (a) => (a === 'EventType.FREE_KICK' ? 'Free kick' : a.toLowerCase()) })
    const ops = render(theme, frame(['EventType.FREE_KICK', ' PASS ']))
    const action = texts(ops).at(-1)!
    expect(action.args[0]).toBe('Free kick, pass')
    // Where and how the reference draws it.
    expect(action.args.slice(1)).toEqual([20, 700])
    expect(action.font).toBe('600 14px sans-serif')
  })

  it('lists only the labels a human gave, unless the theme asks for the AI\'s too', () => {
    const mixed: Frame = {
      ...frame(),
      state: {
        actions: [
          { action_type: 'EventType.BALL_IN_PLAY', action_origin: 'ai' },
          { action_type: 'EventType.THROW_IN', action_origin: 'Human ' },
          { action_type: 'EventType.PASS' },
        ],
      },
    }
    const bottomLeft = (ops: Op[]) => texts(ops).find((o) => o.args[1] === 20 && o.args[2] === 700)?.args[0]
    expect(bottomLeft(render(custom({}), mixed))).toBe('EventType.THROW_IN')
    expect(bottomLeft(render(custom({ aiLabels: true }), mixed))).toBe('EventType.BALL_IN_PLAY, EventType.THROW_IN, EventType.PASS')
    // Nothing a human gave: no text at all.
    expect(bottomLeft(render(custom({}), frame(['EventType.BALL_IN_PLAY'], 'ai')))).toBeUndefined()
  })

  it("draws in the theme's fonts", () => {
    const theme = custom({ fonts: { label: 'Label Face, serif', title: 'Title Face, serif' } })
    const ops = render(theme, frame(), EVERY_MOMENT)
    expect(textOf(ops, 'Home')!.font).toMatch(/^600 [\d.]+px Label Face, serif$/)
    expect(textOf(ops, 'Attack')!.font).toMatch(/^700 [\d.]+px Label Face, serif$/)
    expect(textOf(ops, 'GOAL')!.font).toMatch(/^italic 900 [\d.]+px Title Face, serif$/)
  })

  it("draws the theme's icons on the cards, unless the layer brings its own", () => {
    const fromTheme = { from: 'theme' } as unknown as CanvasImageSource
    const fromLayer = { from: 'layer' } as unknown as CanvasImageSource
    const theme = custom({ icons: { corner: fromTheme, freeKick: null, varCheck: null, goalDisallowed: null, yellowCard: null, redCard: null, substitution: null, substitutionOut: null, substitutionIn: null, scorer: null } })
    const images = (ops: Op[]) => ops.filter((o) => o.op === 'drawImage').map((o) => o.args[0])
    const corner = { intensity: 1, playersFade: 0, ballFade: 0, corner: null, sections: [] }
    const themed = images(
      render(theme, frame(), {
        corner,
        goalBanner: { intensity: 1 },
      }),
    )
    // The corner's from the theme; the reference's goal card has none of its own there.
    expect(themed.filter((i) => i === fromTheme)).toHaveLength(1)
    const own = images(
      render(theme, frame(), {
        corner: { ...corner, icon: fromLayer },
        goalBanner: { intensity: 1, icon: fromLayer },
      }),
    )
    expect(own.filter((i) => i === fromLayer)).toHaveLength(2)
    expect(own).not.toContain(fromTheme)
  })
})

describe('setTheme', () => {
  it('changes the colours and words of the next frame, without redrawing the cached pitch', () => {
    const { canvas, ops } = fakeCanvas()
    const renderer = createRenderer(canvas)
    renderer.renderFrame(frame(), EVERY_MOMENT)
    expect(textOf(ops, 'GOAL')).toBeDefined()
    const cachesBuilt = offscreen.sizes.length
    const pitchOps = offscreen.ops.length

    renderer.setTheme({
      ...DEFAULT_THEME,
      colors: { ...DEFAULT_THEME.colors, away: { fill: '#abcdef', outline: '#000000', text: '#ffffff' } },
      text: { ...DEFAULT_THEME.text, goal: '进球' },
    })
    ops.length = 0
    renderer.renderFrame(frame(), EVERY_MOMENT)

    expect(textOf(ops, '进球')).toBeDefined()
    expect(textOf(ops, 'GOAL')).toBeUndefined()
    expect(ops.some((o) => o.op === 'fill' && o.fillStyle === '#abcdef')).toBe(true)
    expect(offscreen.sizes.length).toBe(cachesBuilt)
    expect(offscreen.ops.length).toBe(pitchOps)
  })
})
