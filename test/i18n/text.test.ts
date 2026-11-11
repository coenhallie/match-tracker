import { describe, it, expect } from 'vitest'
import { formatText, resolveText } from '../../src/i18n/text'
import { en } from '../../src/i18n/en'
import { zh } from '../../src/i18n/zh'
import { REPLAY_LAYERS } from '../../src/model/replayLayers'

/** Every key path in a nested object of strings, sorted. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value)
    .flatMap(([key, inner]) => keyPaths(inner, prefix ? `${prefix}.${key}` : key))
    .sort()
}

/** Every string in a nested object of strings. */
function strings(value: unknown): unknown[] {
  if (value === null || typeof value !== 'object') return [value]
  return Object.values(value).flatMap(strings)
}

describe('resolveText', () => {
  it('gives the built-in text for the locale', () => {
    expect(resolveText('zh').goal).toBe('进球')
    expect(resolveText('en').goal).toBe('GOAL')
    expect(resolveText('en')).toEqual(en)
    expect(resolveText('zh')).toEqual(zh)
  })

  it('reads a language tag as the built-in text for its language, and anything else as English', () => {
    for (const tag of ['zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant-HK', 'ZH', 'zh_CN']) expect(resolveText(tag)).toEqual(zh)
    for (const tag of ['en-GB', 'en-US', 'EN', 'fr', 'de-DE', '', 'zhx', 'english']) expect(resolveText(tag)).toEqual(en)
  })

  it('lets overrides win over the locale', () => {
    const text = resolveText('zh', { goal: 'GOAL!', versus: 'v' })
    expect(text.goal).toBe('GOAL!')
    expect(text.versus).toBe('v')
    expect(text.corner).toBe('角球')
  })

  it('takes a layer override word by word: a new label keeps the layer\'s own hint', () => {
    const text = resolveText('zh', { layers: { goal: { label: 'Goals' }, ballTrail: { hint: 'Where it went' } } })
    expect(text.layers.goal).toEqual({ label: 'Goals', hint: zh.layers.goal.hint })
    expect(text.layers.ballTrail).toEqual({ label: zh.layers.ballTrail.label, hint: 'Where it went' })
    expect(text.layers.attack).toEqual(zh.layers.attack)
    expect(zh.layers.goal.label).not.toBe('Goals')
  })

  it('leaves the built-in text unchanged', () => {
    resolveText('en', { goal: 'changed' }).red = 'changed too'
    expect(en.goal).toBe('GOAL')
    expect(en.red).toBe('Red')
  })
})

describe('formatText', () => {
  it('puts each value in its place, once or many times', () => {
    expect(formatText('{team} attacking', { team: 'Red' })).toBe('Red attacking')
    expect(formatText('{a}, {b}, {a}', { a: '1', b: '2' })).toBe('1, 2, 1')
  })

  it('takes a value as it is, with no replacement patterns read in it', () => {
    expect(formatText('{team} attacking', { team: "$& $' $1" })).toBe("$& $' $1 attacking")
  })

  it('leaves a placeholder it has no value for', () => {
    expect(formatText('{team} {state}', { team: 'Red' })).toBe('Red {state}')
  })
})

describe('the built-in text', () => {
  it('has every English key in Chinese, and no other', () => {
    expect(keyPaths(zh)).toEqual(keyPaths(en))
  })

  it('names and describes every layer in the menu, in both', () => {
    for (const text of [en, zh]) {
      expect(Object.keys(text.layers).sort()).toEqual(REPLAY_LAYERS.map((l) => l.key).sort())
    }
  })

  it('has no empty string', () => {
    for (const text of [en, zh]) {
      for (const s of strings(text)) {
        expect(typeof s).toBe('string')
        expect((s as string).length).toBeGreaterThan(0)
      }
    }
  })

  it("is video-annotation's English, word for word", () => {
    expect(en).toMatchObject({
      goal: 'GOAL',
      throwIn: 'THROW IN',
      attack: 'Attack',
      attacking: 'Attacking',
      defending: 'Defending',
      versus: 'vs',
      red: 'Red',
      blue: 'Blue',
      layersButton: 'Layers',
      layersMenuLabel: 'Layers',
      layersTooltip: 'Show or hide what is drawn over the data',
      phaseTooltip:
        'Worked out from the tracking data: a team is attacking once it has kept the ball for 3 seconds, and the other team is then defending.',
    })
    // The phase row's ARIA label, "Red attacking, Blue defending": the reference
    // lowercases the state into it (phaseDescription), which a template keeps.
    expect(formatText(en.phaseAria, {
      home: formatText(en.phaseAttackingAria, { team: 'Red' }),
      away: formatText(en.phaseDefendingAria, { team: 'Blue' }),
    })).toBe('Red attacking, Blue defending')
    // The corner is the widget's own: the reference has none. So is the throw-in's hint, as the widget's
    // throw-in fades in where the reference's slides in from the ball's half. And so is the zoom near goal.
    const { corner, throwInBanner, playerLoss, flashback, goalZoom, ballShadow, varCheck, goalDisallowed, halfTime, secondHalf, fullTime, foul, shotOnGoal, headerOnGoal, ...referenceLayers } = en.layers
    expect(en.corner).toBe('CORNER')
    expect(corner).toEqual({
      label: 'Corner',
      hint: 'A banner and the corner lit up on a corner label, held while play is stopped',
    })
    expect(throwInBanner).toEqual({ label: 'Throw-in', hint: 'A banner along the bottom touchline on a throw-in label' })
    expect(goalZoom).toEqual({
      label: 'Zoom near goal',
      hint: 'The view eases in as the ball nears a goal, and into a goal',
    })
    // So are the label cards.
    expect(en.varCheck).toBe('VAR CHECK')
    expect(varCheck).toEqual({ label: 'VAR check', hint: 'A banner across the middle of the pitch on a VAR check label' })
    expect(en.goalDisallowed).toBe('GOAL DISALLOWED')
    expect(goalDisallowed).toEqual({
      label: 'Goal disallowed',
      hint: 'A banner across the middle of the pitch on a goal disallowed label',
    })
    expect(en.shotOnGoal).toBe('SHOT!')
    expect(shotOnGoal).toEqual({ label: 'Shot on goal', hint: 'A banner along the bottom touchline on a shot on goal label' })
    expect(en.headerOnGoal).toBe('HEADER!')
    expect(headerOnGoal).toEqual({ label: 'Header on goal', hint: 'A banner along the bottom touchline on a header on goal label' })
    expect(en.foul).toBe('FOUL')
    expect(foul).toEqual({ label: 'Foul', hint: 'A banner along the bottom touchline on a foul label' })
    expect(en.fullTime).toBe('FULL TIME')
    expect(en.fullTimeText).toBe('This match has ended.')
    expect(fullTime).toEqual({
      label: 'Full time',
      hint: 'A banner across the middle of the pitch on a full time label, until the next label',
    })
    expect(en.secondHalf).toBe('SECOND HALF')
    expect(en.secondHalfText).toBe('The match has restarted.')
    expect(secondHalf).toEqual({ label: 'Second half', hint: 'A banner across the middle of the pitch on a second half label' })
    expect(en.halfTime).toBe('HALF TIME')
    expect(en.halfTimeText).toBe('There is a break in play.\nCoverage will resume soon.')
    expect(halfTime).toEqual({
      label: 'Half time',
      hint: 'A banner across the middle of the pitch on a half time label, until the next label',
    })
    // So is the attack over a player loss or invalid frames, and its debug badge.
    expect(playerLoss).toEqual({
      label: 'Attack over lost players or invalid frames',
      hint: 'An attack while fewer than 18 players are tracked, or while the live camera is away',
    })
    // So is the flashback layer.
    expect(flashback).toEqual({
      label: 'Replays while the camera is away',
      hint: 'An earlier goal, corner, shot or attack near goal, each played once, while the live camera is away for 5 s or more',
    })
    // So is the shadow under a high ball.
    expect(ballShadow).toEqual({ label: 'High ball shadow', hint: 'A shadow on the pitch under a high ball, further off the higher it is' })
    expect(en.invalidFrames).toBe('Invalid frames, no attacker')
    expect(formatText(en.invalidFramesCover, { team: 'Red' })).toBe("Invalid frames: covered by Red's attack")
    expect(formatText(en.invalidFramesValidIn, { label: 'X', seconds: '3.2' })).toBe('X, valid in 3.2 s')
    expect(formatText(en.invalidFramesValidLater, { label: 'X', seconds: '10' })).toBe('X, valid in over 10 s')
    expect(formatText(en.invalidFramesShort, { seconds: '1' })).toBe('Invalid frames, under 1 s: not covered')
    expect(formatText(en.playerLoss, { players: '9' })).toBe('Player loss: 9 tracked')
    expect(formatText(en.playerLossCover, { players: '9', team: 'Red' })).toBe("Player loss: 9 tracked, covered by Red's attack")
    expect(referenceLayers).toEqual({
      goal: { label: 'Goal animation', hint: 'A shot into the net on a goal label' },
      attack: { label: 'Attack', hint: 'Worked out from possession: shade and team name' },
      ballTrail: { label: 'Ball trail', hint: "The ball's path, with a dot at each turn" },
      phaseLabels: { label: 'Attacking / defending', hint: 'Team labels above the pitch' },
      nearbyRings: { label: 'Players near the ball', hint: 'White rings within 15 m of the ball carrier' },
      farFade: { label: 'Fade distant players', hint: 'Players over 15 m from the ball drawn faint' },
      ringFades: { label: 'Smooth ring changes', hint: 'Rings fade in and out instead of snapping' },
    })
  })

  it('has the Chinese for the words given', () => {
    expect(zh).toMatchObject({
      goal: '进球',
      corner: '角球',
      throwIn: '界外球',
      attack: '进攻',
      attacking: '进攻中',
      defending: '防守中',
      versus: '对',
      red: '红队',
      blue: '蓝队',
    })
  })

  it('reads the phase row out in Chinese without English words', () => {
    const label = formatText(zh.phaseAria, {
      home: formatText(zh.phaseAttackingAria, { team: zh.red }),
      away: formatText(zh.phaseDefendingAria, { team: zh.blue }),
    })
    expect(label).toBe('红队进攻中，蓝队防守中')
  })

  it('has a place for the team in each state of the ARIA label, and for both teams in the whole', () => {
    for (const text of [en, zh]) {
      expect(text.phaseAttackingAria).toContain('{team}')
      expect(text.phaseDefendingAria).toContain('{team}')
      expect(text.phaseAria).toContain('{home}')
      expect(text.phaseAria).toContain('{away}')
    }
  })
})

describe('flashback text', () => {
  it('says REPLAY in both languages', () => {
    expect(en.flashback).toBe('REPLAY')
    expect(zh.flashback).toBe('回放')
    expect(formatText(en.flashbackAgo, { time: '2:47' })).toBe('2:47 AGO')
    expect(formatText(zh.flashbackAgo, { time: '2:47' })).toBe('2:47前')
    expect(formatText(en.flashbackDebug, { kind: en.goal, ago: '2:47' })).toBe('Replay: GOAL, 2:47 ago')
    expect(formatText(zh.flashbackDebug, { kind: zh.goal, ago: '2:47' })).toBe('回放：进球，2:47前')
  })
})
