import { describe, it, expect } from 'vitest'
import type { TeamPhase } from '../../src/analysis/teamPhase'
import { GOAL_SEQUENCE_MS } from '../../src/analysis/goalSequence'
import type { Frame, FrameAction } from '../../src/model/types'
import { LABEL_CARD_DEMO_MS, LABEL_CARD_IN_MS, LABEL_CARD_OUT_MS, LABEL_CARD_SHOW_MS } from '../../src/render/labelCard'
import { FakeReplay } from './harness'

/** A record: the ball at `ballX` along the pitch, and the labels it carries. */
/** A human's label: its name, or the label as a whole, a team on it say. */
type Label = string | FrameAction

const frameAt = (labels: Label[] = [], ballX = 40, origin = 'human'): Frame =>
  ({
    pitch_dimensions: { length: 105, width: 68 },
    teams: [
      {
        team_id: 0,
        players: [{ track_id: 4, person_type: 'PersonType.PLAYER', projected_coordinates: { x: 3, y: 2 } }],
      },
    ],
    balls: [{ projected_coordinates: { x: ballX, y: 3 } }],
    state: {
      actions: labels.map((label) =>
        typeof label === 'string' ? { action_type: label, action_origin: origin } : { action_origin: origin, ...label },
      ),
    },
    frame_data: [{ frame_count: 1 }],
  }) as Frame

const VAR = ['VAR check']
const NOBODY: TeamPhase = { possession: null, attacks: { 0: 1, 1: -1 }, states: { 0: null, 1: null } }
/** Blue attacks the left goal, so an attack shows with the ball in that half. */
const BLUE_ATTACKING: TeamPhase = { possession: 1, attacks: { 0: 1, 1: -1 }, states: { 0: 'defending', 1: 'attacking' } }

function ready(): FakeReplay {
  const replay = new FakeReplay()
  replay.set({ time: 10, frame: frameAt(), phase: NOBODY })
  replay.play()
  return replay
}

const record = (replay: FakeReplay, labels: Label[] = [], step = 0.04, ballX = 40) =>
  replay.set({ time: replay.time + step, frame: frameAt(labels, ballX) })
const animate = (replay: FakeReplay, ms: number) => replay.animate(ms, true)
const card = (replay: FakeReplay) => replay.last()?.labelCard
/** Replay time goes on with the animation frames, three to a record: no label, unless `labels` carry it on. */
function play(replay: FakeReplay, ms: number, labels: string[] = []) {
  for (let t = 0; t < ms; t += 50) {
    record(replay, labels, 0.05)
    animate(replay, 50)
  }
}

/** `seconds` of replay time by playback, the label off: steps small enough not to count as seeks. */
function offFor(replay: FakeReplay, seconds: number) {
  for (let t = 0; t < seconds; t += 0.04) record(replay)
}

describe('a label card, by its label', () => {
  it.each(['VAR check', 'var check', 'VAR_CHECK', 'EventType.VAR_CHECK', 'Var-Check'])(
    'plays on %j, in any case and however it is written',
    (label) => {
      const replay = ready()
      record(replay, [label])
      animate(replay, 100)
      expect(card(replay)?.key).toBe('varCheck')
    },
  )

  it('does not play on a label the AI gave', () => {
    const replay = ready()
    replay.set({ time: replay.time + 0.04, frame: frameAt(VAR, 40, 'ai') })
    animate(replay, 100)
    expect(card(replay)).toBeUndefined()
  })

  it('fades in, stays, and fades out once the label is off, leaving the view as it is', () => {
    const replay = ready()
    const from = replay.outputs.length
    record(replay, VAR)
    animate(replay, LABEL_CARD_IN_MS / 2)
    const early = card(replay)!.intensity
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(1)
    play(replay, LABEL_CARD_IN_MS)
    expect(card(replay)).toEqual({ key: 'varCheck', intensity: 1 })
    expect(replay.last()?.corner).toBeUndefined()
    expect(replay.outputs.slice(from).every((o) => o.camera === null)).toBe(true)
    // On screen for 600 ms so far; the label went off long before the 2 s are up.
    play(replay, LABEL_CARD_SHOW_MS - 600 + 120)
    expect(card(replay)!.intensity).toBeLessThan(1)
    play(replay, LABEL_CARD_OUT_MS + 40)
    expect(card(replay)).toBeUndefined()
    expect(replay.outputs.at(-1)!.animating).toBe(false)
  })

  it('is held for as long as its label is on', () => {
    const replay = ready()
    play(replay, LABEL_CARD_SHOW_MS * 3, VAR)
    expect(card(replay)).toEqual({ key: 'varCheck', intensity: 1 })
    play(replay, 500 + LABEL_CARD_OUT_MS + 80)
    expect(card(replay)).toBeUndefined()
  })

  it('is not held by play being stopped, once the label is off', () => {
    const replay = ready()
    record(replay, VAR)
    // The same positions in every record: nobody moves, the label gone.
    play(replay, LABEL_CARD_SHOW_MS + LABEL_CARD_OUT_MS + 600)
    expect(card(replay)).toBeUndefined()
  })

  it('plays once for a label that flickers, and again for a new one', () => {
    const replay = ready()
    play(replay, LABEL_CARD_SHOW_MS + LABEL_CARD_OUT_MS + 600, VAR)
    play(replay, LABEL_CARD_SHOW_MS + LABEL_CARD_OUT_MS + 1000)
    expect(card(replay)).toBeUndefined()
    // Off for 14.4 s in all, by playback: the same event.
    offFor(replay, 11)
    record(replay, VAR)
    animate(replay, 100)
    expect(card(replay)).toBeUndefined()
    // Off for over 15 s: a new one.
    offFor(replay, 15.1)
    record(replay, VAR)
    animate(replay, 100)
    expect(card(replay)?.key).toBe('varCheck')
  })

  it('does not play on a labelled frame landed on by a seek, or after it while the label stays on', () => {
    const replay = ready()
    replay.pause()
    replay.set({ time: 500, frame: frameAt(VAR) })
    animate(replay, 100)
    expect(card(replay)).toBeUndefined()
    replay.play()
    play(replay, 200, VAR)
    expect(card(replay)).toBeUndefined()
  })

  it('stops on pause and on a seek, and stays off while its layer is off', () => {
    const paused = ready()
    record(paused, VAR)
    animate(paused, 100)
    paused.pause()
    expect(card(paused)).toBeUndefined()

    const sought = ready()
    record(sought, VAR)
    animate(sought, 100)
    sought.set({ time: 900, frame: frameAt() })
    expect(card(sought)).toBeUndefined()

    const off = ready()
    off.toggle({ varCheck: false })
    record(off, VAR)
    animate(off, 100)
    expect(card(off)).toBeUndefined()
  })

  it('ends when its layer is switched off', () => {
    const replay = ready()
    record(replay, VAR)
    animate(replay, 100)
    replay.toggle({ varCheck: false })
    expect(card(replay)).toBeUndefined()
  })

  it('shows at full strength, without fading, under reduced motion', () => {
    const replay = ready()
    replay.reducedMotion = true
    record(replay, VAR)
    animate(replay, 20)
    expect(card(replay)).toEqual({ key: 'varCheck', intensity: 1 })
    play(replay, LABEL_CARD_SHOW_MS + 600)
    expect(card(replay)).toBeUndefined()
  })
})

describe('a label card among the other moments', () => {
  it('takes over from a throw-in and an attack', () => {
    const replay = ready()
    replay.set({ time: replay.time + 0.04, frame: frameAt(['Throw in'], -40), phase: BLUE_ATTACKING })
    animate(replay, 100)
    expect(replay.last()?.throwIn).toBeDefined()
    expect(replay.last()?.attack).toBeDefined()
    record(replay, VAR, 0.04, -40)
    expect(replay.last()?.throwIn).toBeUndefined()
    expect(replay.last()?.attack).toBeUndefined()
    animate(replay, 100)
    expect(card(replay)?.key).toBe('varCheck')
  })

  it('holds back a throw-in and an attack while it shows', () => {
    const replay = ready()
    record(replay, VAR, 0.04, -40)
    animate(replay, 100)
    replay.set({ time: replay.time + 0.04, frame: frameAt(['Throw in'], -40), phase: BLUE_ATTACKING })
    animate(replay, 100)
    expect(card(replay)?.key).toBe('varCheck')
    expect(replay.last()?.throwIn).toBeUndefined()
    expect(replay.last()?.attack).toBeUndefined()
  })

  it('takes over from the attack over a player loss, and holds it back while it shows', () => {
    // Every frame here has too few players, and the ball runs towards a goal, which says whose attack covers it.
    let x = 0
    const replay = new FakeReplay({ playerLoss: true })
    const on = (labels: string[] = []) => {
      x += 1
      replay.set({ time: replay.time + 0.04, frame: frameAt(labels, x) })
      animate(replay, 40)
    }
    replay.set({ time: 10, frame: frameAt([], x), phase: NOBODY })
    replay.play()
    for (let i = 0; i < 12; i++) on()
    expect(replay.last()?.attack).toBeDefined()
    on(VAR)
    expect(replay.last()?.attack).toBeUndefined()
    expect(card(replay)?.key).toBe('varCheck')
    for (let i = 0; i < 12; i++) on(VAR)
    expect(card(replay)?.key).toBe('varCheck')
    expect(replay.last()?.attack).toBeUndefined()
  })

  it('gives way to a corner, and does not go over one', () => {
    const replay = ready()
    record(replay, VAR)
    animate(replay, 100)
    record(replay, ['Corner'])
    expect(card(replay)).toBeUndefined()
    expect(replay.last()?.corner).toBeDefined()
    // The corner's still up: a new VAR label waits behind it.
    record(replay, VAR)
    animate(replay, 100)
    expect(card(replay)).toBeUndefined()
    expect(replay.last()?.corner).toBeDefined()
  })

  it('gives way to a goal, and plays on the first labelled frame after it when the label stays on', () => {
    const replay = ready()
    record(replay, ['Goal', ...VAR])
    animate(replay, 200)
    expect(replay.last()?.goal).toBeDefined()
    expect(card(replay)).toBeUndefined()
    play(replay, GOAL_SEQUENCE_MS + 200, VAR)
    expect(replay.last()?.goal).toBeUndefined()
    expect(card(replay)?.key).toBe('varCheck')
  })
})

describe('the goal disallowed card', () => {
  const DISALLOWED = ['Goal disallowed']

  it.each(['Goal disallowed', 'goal disallowed', 'GOAL_DISALLOWED', 'EventType.GOAL_DISALLOWED', 'Goal-Disallowed'])(
    'plays on %j, and no goal plays on it',
    (label) => {
      const replay = ready()
      record(replay, [label])
      animate(replay, 100)
      expect(card(replay)?.key).toBe('goalDisallowed')
      expect(replay.last()?.goal).toBeUndefined()
      expect(replay.last()?.goalBanner).toBeUndefined()
    },
  )

  it('takes over from the VAR check it answers, on a label of a single record', () => {
    const replay = ready()
    play(replay, 600, VAR)
    expect(card(replay)).toEqual({ key: 'varCheck', intensity: 1 })
    record(replay, DISALLOWED)
    animate(replay, 100)
    expect(card(replay)?.key).toBe('goalDisallowed')
  })

  /** Every card drawn on screen from output `from` on: the last paint of each output is what the canvas shows. */
  const shownFrom = (replay: FakeReplay, from: number) => replay.outputs.slice(from).map((o) => o.layers?.labelCard)

  it('does not blink: the band stays up at full strength when it takes over from a card fully in', () => {
    const replay = ready()
    play(replay, 600, VAR)
    const from = replay.outputs.length
    record(replay, DISALLOWED)
    animate(replay, 300)
    for (const shown of shownFrom(replay, from)) expect(shown).toEqual({ key: 'goalDisallowed', intensity: 1 })
  })

  it('carries on from where a card still fading in had got to', () => {
    const replay = ready()
    record(replay, VAR)
    animate(replay, 200)
    const was = card(replay)!.intensity
    expect(was).toBeGreaterThan(0.2)
    expect(was).toBeLessThan(0.8)
    const from = replay.outputs.length
    record(replay, DISALLOWED)
    animate(replay, 500)
    const shown = shownFrom(replay, from)
    let last = was
    for (const value of shown) {
      expect(value?.key).toBe('goalDisallowed')
      expect(value!.intensity).toBeGreaterThanOrEqual(last)
      last = value!.intensity
    }
    expect(last).toBe(1)
  })

  it('still stays its full time when it takes over at full strength', () => {
    const replay = ready()
    play(replay, 600, VAR)
    record(replay, DISALLOWED)
    play(replay, LABEL_CARD_SHOW_MS - 100)
    expect(card(replay)).toEqual({ key: 'goalDisallowed', intensity: 1 })
    play(replay, 200 + LABEL_CARD_OUT_MS + 50)
    expect(card(replay)).toBeUndefined()
  })

  it('fades in from nothing when no card is showing', () => {
    const replay = ready()
    record(replay, DISALLOWED)
    animate(replay, 100)
    expect(card(replay)!.intensity).toBeGreaterThan(0)
    expect(card(replay)!.intensity).toBeLessThan(0.5)
  })

  it('does not blink when played by hand over the other card either', () => {
    const replay = ready()
    replay.trigger('varCheck')
    animate(replay, 600)
    const from = replay.outputs.length
    replay.trigger('goalDisallowed')
    animate(replay, 100)
    // Played by hand, it names the team it was played for: 0, Red, by default.
    for (const shown of shownFrom(replay, from)) expect(shown).toEqual({ key: 'goalDisallowed', intensity: 1, team: 'Red' })
  })

  it('names the team its label gives, as the host names it, and none for a label without one', () => {
    for (const [team_id, team] of [[0, 'Red'], [1, 'Blue']] as const) {
      const replay = ready()
      record(replay, [{ action_type: 'Goal disallowed', team_id }])
      animate(replay, 600)
      expect(card(replay)).toEqual({ key: 'goalDisallowed', intensity: 1, team })
    }
    // The exports' labels give no team, and anything but 0 or 1 is none.
    for (const label of ['Goal disallowed', { action_type: 'Goal disallowed', team_id: -1 }]) {
      const replay = ready()
      record(replay, [label])
      animate(replay, 600)
      expect(card(replay)).toEqual({ key: 'goalDisallowed', intensity: 1 })
    }
  })

  it('names the team its label on screen gives when played by hand, else the team it was played for', () => {
    // Paused, so the label does not play the card itself: only the trigger does.
    const labelled = ready()
    labelled.pause()
    labelled.set({ time: labelled.time + 0.04, frame: frameAt([{ action_type: 'Goal disallowed', team_id: 1 }]) })
    animate(labelled, 100)
    expect(card(labelled)).toBeUndefined()
    labelled.trigger('goalDisallowed', 0)
    animate(labelled, 600)
    expect(card(labelled)).toMatchObject({ key: 'goalDisallowed', team: 'Blue' })
    const bare = ready()
    bare.trigger('goalDisallowed', 1)
    animate(bare, 600)
    expect(card(bare)).toMatchObject({ key: 'goalDisallowed', team: 'Blue' })
  })

  it('is the only card that names a team: a VAR check with one on its label names none', () => {
    const replay = ready()
    record(replay, [{ action_type: 'VAR check', team_id: 1 }])
    animate(replay, 600)
    expect(card(replay)).toEqual({ key: 'varCheck', intensity: 1 })
  })

  it('does not hand back to the VAR check while both labels stay on', () => {
    const replay = ready()
    record(replay, VAR)
    animate(replay, 100)
    play(replay, 3000, [...VAR, ...DISALLOWED])
    expect(card(replay)).toEqual({ key: 'goalDisallowed', intensity: 1 })
  })

  it('plays, not the VAR check, on a frame with both labels, whichever comes first on it', () => {
    for (const labels of [[...VAR, ...DISALLOWED], [...DISALLOWED, ...VAR]]) {
      const replay = ready()
      record(replay, labels)
      animate(replay, 100)
      expect(card(replay)?.key).toBe('goalDisallowed')
    }
  })

  it('is its own layer: off, the VAR check still plays and it does not', () => {
    const replay = ready()
    replay.toggle({ goalDisallowed: false })
    record(replay, DISALLOWED)
    animate(replay, 100)
    expect(card(replay)).toBeUndefined()
    record(replay, VAR)
    animate(replay, 100)
    expect(card(replay)?.key).toBe('varCheck')
  })

  it('ends with its own layer, not with the other card\'s', () => {
    const replay = ready()
    record(replay, DISALLOWED)
    animate(replay, 100)
    replay.toggle({ varCheck: false })
    expect(card(replay)?.key).toBe('goalDisallowed')
    replay.toggle({ goalDisallowed: false })
    expect(card(replay)).toBeUndefined()
  })

  it('can be played by hand, taking over from the other card', () => {
    const replay = ready()
    expect(replay.director.availability().goalDisallowed).toBe(true)
    replay.trigger('varCheck')
    animate(replay, 100)
    replay.trigger('goalDisallowed')
    animate(replay, 100)
    expect(card(replay)?.key).toBe('goalDisallowed')
  })
})

describe('the half time card', () => {
  const HALF = ['Half time']
  /** Fully in, with the label long gone: what a viewer watches through the break. */
  function resting(): FakeReplay {
    const replay = ready()
    record(replay, HALF)
    animate(replay, 500)
    play(replay, 1000)
    return replay
  }

  it.each(['Half time', 'half time', 'HALF TIME', 'half-time', 'HALF_TIME', 'Halftime', 'EventType.HALF_TIME', 'End FirstHalf', 'End first half'])(
    'plays on %j',
    (label) => {
      const replay = ready()
      record(replay, [label])
      animate(replay, 100)
      expect(card(replay)?.key).toBe('halfTime')
    },
  )

  it('does not play on a label the AI gave', () => {
    const replay = ready()
    replay.set({ time: replay.time + 0.04, frame: frameAt(HALF, 40, 'ai') })
    animate(replay, 100)
    expect(card(replay)).toBeUndefined()
  })

  it('fades in, then stays at full strength for as long as no other label comes', () => {
    const replay = ready()
    record(replay, HALF)
    animate(replay, 200)
    expect(card(replay)!.intensity).toBeLessThan(1)
    // 20 minutes of playback, at a record every 0.4 s, with no label on any of them.
    for (let i = 0; i < 3000; i++) {
      record(replay, [], 0.4)
      animate(replay, 20)
    }
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
  })

  it('asks for no animation frames while it rests, and paints nothing with no new record', () => {
    const replay = resting()
    expect(replay.outputs.at(-1)!.animating).toBe(false)
    const paints = replay.paintCount()
    animate(replay, 1000)
    expect(replay.paintCount()).toBe(paints)
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
  })

  it('fades out over its full time on any other label, however long it has rested', () => {
    const replay = resting()
    replay.idle(60 * 60 * 1000)
    record(replay, ['Kick off'])
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
    expect(replay.outputs.at(-1)!.animating).toBe(true)
    animate(replay, 200)
    const mid = card(replay)!.intensity
    expect(mid).toBeGreaterThan(0.2)
    expect(mid).toBeLessThan(0.8)
    animate(replay, 300)
    expect(card(replay)).toBeUndefined()
    expect(replay.outputs.at(-1)!.animating).toBe(false)
  })

  it('stays on its own label again, on a label the AI gave, and on no label', () => {
    const replay = resting()
    record(replay, HALF)
    replay.set({ time: replay.time + 0.04, frame: frameAt(['Throw in'], 40, 'ai') })
    record(replay)
    animate(replay, 500)
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
  })

  it('stays on a label already on as it started, dropping out for a record or two, and goes when that comes back later', () => {
    const replay = ready()
    record(replay, ['Half time', 'Free kick'])
    animate(replay, 500)
    record(replay, ['Free kick'])
    record(replay)
    record(replay, ['Free kick'])
    animate(replay, 100)
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
    play(replay, 1000)
    record(replay, ['Free kick'])
    animate(replay, 500)
    expect(card(replay)).toBeUndefined()
  })

  it('does not jump when the next label comes as it is still fading in', () => {
    const replay = ready()
    record(replay, HALF)
    animate(replay, 200)
    const was = card(replay)!.intensity
    const from = replay.outputs.length
    record(replay, ['Kick off'])
    animate(replay, 500)
    let last = was
    for (const output of replay.outputs.slice(from)) {
      const now = output.layers?.labelCard?.intensity ?? 0
      expect(now).toBeLessThanOrEqual(last + 0.05)
      last = now
    }
    expect(card(replay)).toBeUndefined()
  })

  it('lets a throw-in on the next label show as it goes, and holds it back until then', () => {
    const replay = resting()
    record(replay, ['Throw in'])
    expect(replay.last()?.throwIn).toBeDefined()
    expect(card(replay)?.key).toBe('halfTime')
    animate(replay, 500)
    expect(card(replay)).toBeUndefined()
    expect(replay.last()?.throwIn).toBeDefined()
  })

  it('holds back an attack until the next label', () => {
    const replay = resting()
    replay.set({ time: replay.time + 0.04, frame: frameAt([], -40), phase: BLUE_ATTACKING })
    animate(replay, 100)
    expect(replay.last()?.attack).toBeUndefined()
    expect(card(replay)?.key).toBe('halfTime')
  })

  it('fades out under a goal or a corner on the next label', () => {
    for (const [label, shown] of [['Goal', 'goal'], ['Corner', 'corner']] as const) {
      const replay = resting()
      record(replay, [label])
      expect(card(replay)?.intensity).toBe(1)
      expect(replay.last()?.[shown]).toBeDefined()
      animate(replay, 200)
      expect(card(replay)!.intensity).toBeLessThan(1)
      expect(card(replay)!.intensity).toBeGreaterThan(0)
      animate(replay, 300)
      expect(card(replay)).toBeUndefined()
      expect(replay.last()?.[shown]).toBeDefined()
    }
  })

  it('hands over to another label card with no gap in the band, and does not come back', () => {
    const replay = resting()
    const from = replay.outputs.length
    record(replay, VAR)
    animate(replay, 200)
    for (const output of replay.outputs.slice(from)) {
      expect(output.layers?.labelCard).toEqual({ key: 'varCheck', intensity: 1 })
    }
    record(replay, ['Half time', ...VAR])
    animate(replay, 100)
    expect(card(replay)?.key).toBe('varCheck')
  })

  it('takes over from another card, and plays over it on a frame with both labels', () => {
    const replay = ready()
    play(replay, 600, VAR)
    record(replay, [...VAR, ...HALF])
    animate(replay, 100)
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
    // The VAR label carrying on is not news.
    play(replay, 600, VAR)
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
  })

  it('stays until the next label when played by hand too', () => {
    const replay = ready()
    replay.trigger('halfTime')
    animate(replay, 10000)
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
    expect(replay.outputs.at(-1)!.animating).toBe(false)
    record(replay, ['Kick off'])
    animate(replay, 500)
    expect(card(replay)).toBeUndefined()
  })

  it('stays through a pause, and goes on the next label after it', () => {
    const replay = resting()
    replay.pause()
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
    animate(replay, 500)
    replay.play()
    play(replay, 500)
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
    record(replay, ['Kick off'])
    animate(replay, 500)
    expect(card(replay)).toBeUndefined()
  })

  it('finishes fading in through a pause', () => {
    const replay = ready()
    record(replay, HALF)
    animate(replay, 100)
    replay.pause()
    animate(replay, 500)
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
    expect(replay.outputs.at(-1)!.animating).toBe(false)
  })

  it('leaves other cards to stop on a pause, as every other moment does', () => {
    const replay = ready()
    record(replay, VAR)
    animate(replay, 100)
    replay.pause()
    expect(card(replay)).toBeUndefined()
  })

  it('ends on a seek, a press and its layer being switched off, as every moment does', () => {
    const sought = resting()
    sought.set({ time: 2000, frame: frameAt() })
    expect(card(sought)).toBeUndefined()
    const pressed = resting()
    pressed.stopAll()
    expect(card(pressed)).toBeUndefined()
    const off = resting()
    off.toggle({ halfTime: false })
    expect(card(off)).toBeUndefined()
  })

  it('under reduced motion stays at full strength, and goes at once on the next label', () => {
    const replay = ready()
    replay.reducedMotion = true
    record(replay, HALF)
    animate(replay, 20)
    expect(card(replay)).toEqual({ key: 'halfTime', intensity: 1 })
    expect(replay.outputs.at(-1)!.animating).toBe(false)
    record(replay, ['Kick off'])
    animate(replay, 20)
    expect(card(replay)).toBeUndefined()
  })

  it('plays again for a new half time after it has gone', () => {
    const replay = resting()
    record(replay, ['Kick off'])
    animate(replay, 500)
    offFor(replay, 15.1)
    record(replay, HALF)
    animate(replay, 100)
    expect(card(replay)?.key).toBe('halfTime')
  })
})

describe('the full time card', () => {
  const FULL = ['Full time']
  function resting(): FakeReplay {
    const replay = ready()
    record(replay, FULL)
    animate(replay, 500)
    play(replay, 1000)
    return replay
  }

  it.each(['Full time', 'full time', 'FULL TIME', 'full-time', 'FULL_TIME', 'Fulltime', 'EventType.FULL_TIME', 'End SecondHalf', 'End second half'])('plays on %j', (label) => {
    const replay = ready()
    record(replay, [label])
    animate(replay, 100)
    expect(card(replay)?.key).toBe('fullTime')
  })

  it('does not play on a label the AI gave', () => {
    const replay = ready()
    replay.set({ time: replay.time + 0.04, frame: frameAt(FULL, 40, 'ai') })
    animate(replay, 100)
    expect(card(replay)).toBeUndefined()
  })

  it('stays at full strength for as long as no other label comes, asking for no frames', () => {
    const replay = ready()
    record(replay, FULL)
    for (let i = 0; i < 3000; i++) {
      record(replay, [], 0.4)
      animate(replay, 20)
    }
    expect(card(replay)).toEqual({ key: 'fullTime', intensity: 1 })
    expect(replay.outputs.at(-1)!.animating).toBe(false)
  })

  it('fades out on any other human label, but not on an AI one or its own', () => {
    const replay = resting()
    record(replay, FULL)
    replay.set({ time: replay.time + 0.04, frame: frameAt(['Kick off'], 40, 'ai') })
    animate(replay, 500)
    expect(card(replay)).toEqual({ key: 'fullTime', intensity: 1 })
    record(replay, ['Kick off'])
    animate(replay, 200)
    expect(card(replay)!.intensity).toBeLessThan(1)
    animate(replay, 300)
    expect(card(replay)).toBeUndefined()
  })

  it('stays through a pause, and ends on a seek or a press', () => {
    const paused = resting()
    paused.pause()
    expect(card(paused)).toEqual({ key: 'fullTime', intensity: 1 })
    const sought = resting()
    sought.set({ time: 2000, frame: frameAt() })
    expect(card(sought)).toBeUndefined()
    const pressed = resting()
    pressed.stopAll()
    expect(card(pressed)).toBeUndefined()
  })

  it('takes over from the second half with no gap in the band, and stays', () => {
    const replay = ready()
    play(replay, 600, ['Second half'])
    const from = replay.outputs.length
    record(replay, FULL)
    animate(replay, 200)
    for (const output of replay.outputs.slice(from)) {
      expect(output.layers?.labelCard).toEqual({ key: 'fullTime', intensity: 1 })
    }
    play(replay, 5000)
    expect(card(replay)).toEqual({ key: 'fullTime', intensity: 1 })
  })

  it('stays until the next label when played by hand too', () => {
    const replay = ready()
    replay.trigger('fullTime')
    animate(replay, 10000)
    expect(card(replay)).toEqual({ key: 'fullTime', intensity: 1 })
  })
})

describe('the second half card', () => {
  const SECOND = ['Second half']

  it.each(['Second half', 'second half', 'SECOND HALF', 'second-half', 'SECOND_HALF', 'EventType.SECOND_HALF', 'Start second half'])('plays on %j', (label) => {
    const replay = ready()
    record(replay, [label])
    animate(replay, 100)
    expect(card(replay)?.key).toBe('secondHalf')
  })

  it('does not play on a label the AI gave', () => {
    const replay = ready()
    replay.set({ time: replay.time + 0.04, frame: frameAt(SECOND, 40, 'ai') })
    animate(replay, 100)
    expect(card(replay)).toBeUndefined()
  })

  it('goes by itself with no other label, unlike the half time', () => {
    const replay = ready()
    record(replay, SECOND)
    play(replay, LABEL_CARD_SHOW_MS - 100)
    expect(card(replay)).toEqual({ key: 'secondHalf', intensity: 1 })
    play(replay, 100 + LABEL_CARD_OUT_MS + 100)
    expect(card(replay)).toBeUndefined()
    expect(replay.outputs.at(-1)!.animating).toBe(false)
  })

  it('stays for as long as its label is on, and asks for frames throughout', () => {
    const replay = ready()
    play(replay, LABEL_CARD_SHOW_MS * 2, SECOND)
    expect(card(replay)).toEqual({ key: 'secondHalf', intensity: 1 })
    expect(replay.outputs.at(-1)!.animating).toBe(true)
    play(replay, 500 + LABEL_CARD_OUT_MS + 100)
    expect(card(replay)).toBeUndefined()
  })

  it('ends on a pause, as every moment but the half time does', () => {
    const replay = ready()
    record(replay, SECOND)
    animate(replay, 100)
    replay.pause()
    expect(card(replay)).toBeUndefined()
  })

  it('takes over from the half time with no gap in the band, which does not come back after it', () => {
    const replay = ready()
    record(replay, ['Half time'])
    animate(replay, 500)
    play(replay, 1000)
    const from = replay.outputs.length
    record(replay, SECOND)
    animate(replay, 200)
    for (const output of replay.outputs.slice(from)) {
      expect(output.layers?.labelCard).toEqual({ key: 'secondHalf', intensity: 1 })
    }
    play(replay, LABEL_CARD_SHOW_MS + LABEL_CARD_OUT_MS + 100)
    expect(card(replay)).toBeUndefined()
  })

  it('plays, not the half time, on a frame with both labels', () => {
    const replay = ready()
    record(replay, ['Half time', ...SECOND])
    animate(replay, 100)
    expect(card(replay)?.key).toBe('secondHalf')
  })

  it('is on screen for LABEL_CARD_DEMO_MS when played by hand', () => {
    const replay = ready()
    replay.trigger('secondHalf')
    animate(replay, LABEL_CARD_DEMO_MS - LABEL_CARD_OUT_MS - 100)
    expect(card(replay)).toEqual({ key: 'secondHalf', intensity: 1 })
    animate(replay, 100 + LABEL_CARD_OUT_MS + 50)
    expect(card(replay)).toBeUndefined()
  })
})

describe('the foul card, a small card', () => {
  const FOUL = ['Foul']
  const small = (replay: FakeReplay) => replay.last()?.smallLabelCard

  it.each(['Foul', 'foul', 'FOUL', 'EventType.FOUL', ' Foul '])('plays on %j, in the small slot, not the centre one', (label) => {
    const replay = ready()
    record(replay, [label])
    animate(replay, 100)
    expect(small(replay)?.key).toBe('foul')
    expect(card(replay)).toBeUndefined()
  })

  it('does not play on a label the AI gave, or on one that only has the word in it', () => {
    const ai = ready()
    ai.set({ time: ai.time + 0.04, frame: frameAt(FOUL, 40, 'ai') })
    animate(ai, 100)
    expect(small(ai)).toBeUndefined()
    const other = ready()
    record(other, ['Foul throw'])
    animate(other, 100)
    expect(small(other)).toBeUndefined()
  })

  it('fades in over 0.5 s, and is gone by 2.4 s, whatever its label does, as a throw-in is', () => {
    const replay = ready()
    record(replay, FOUL)
    animate(replay, 250)
    const early = small(replay)!.intensity
    expect(early).toBeGreaterThan(0.3)
    expect(early).toBeLessThan(0.6)
    play(replay, 1000, FOUL)
    expect(small(replay)).toEqual({ key: 'foul', intensity: 1 })
    play(replay, 800, FOUL)
    expect(small(replay)!.intensity).toBeLessThan(1)
    play(replay, 500, FOUL)
    expect(small(replay)).toBeUndefined()
    expect(replay.outputs.at(-1)!.animating).toBe(false)
  })

  it('plays once for a label that flickers, and again after 5 s off', () => {
    const replay = ready()
    record(replay, FOUL)
    animate(replay, 2500)
    offFor(replay, 4)
    record(replay, FOUL)
    animate(replay, 100)
    expect(small(replay)).toBeUndefined()
    offFor(replay, 5.1)
    record(replay, FOUL)
    animate(replay, 100)
    expect(small(replay)?.key).toBe('foul')
  })

  it('leaves an attack showing, and lets one start beside it', () => {
    const showing = ready()
    showing.set({ time: showing.time + 0.04, frame: frameAt([], -40), phase: BLUE_ATTACKING })
    animate(showing, 100)
    expect(showing.last()?.attack).toBeDefined()
    record(showing, FOUL, 0.04, -40)
    animate(showing, 100)
    expect(small(showing)?.key).toBe('foul')
    expect(showing.last()?.attack).toBeDefined()

    const beside = ready()
    record(beside, FOUL, 0.04, -40)
    animate(beside, 100)
    beside.set({ time: beside.time + 0.04, frame: frameAt([], -40), phase: BLUE_ATTACKING })
    animate(beside, 100)
    expect(small(beside)?.key).toBe('foul')
    expect(beside.last()?.attack).toBeDefined()
  })

  it('takes over from a throw-in, and a throw-in from it, as they stand in one place', () => {
    const replay = ready()
    record(replay, ['Throw in'])
    animate(replay, 100)
    expect(replay.last()?.throwIn).toBeDefined()
    record(replay, FOUL)
    expect(replay.last()?.throwIn).toBeUndefined()
    animate(replay, 100)
    expect(small(replay)?.key).toBe('foul')
    offFor(replay, 5.1)
    record(replay, FOUL)
    animate(replay, 100)
    expect(small(replay)?.key).toBe('foul')
    record(replay, ['Throw in'])
    expect(small(replay)).toBeUndefined()
    expect(replay.last()?.throwIn).toBeDefined()
  })

  it('does not go over a centre card, which takes over from it, and waits while its label stays on', () => {
    const replay = ready()
    record(replay, VAR)
    animate(replay, 100)
    record(replay, FOUL)
    animate(replay, 100)
    expect(small(replay)).toBeUndefined()
    expect(card(replay)?.key).toBe('varCheck')
    // Up from nothing once the centre card has gone, its label still on.
    play(replay, LABEL_CARD_SHOW_MS + LABEL_CARD_OUT_MS + 200, FOUL)
    expect(card(replay)).toBeUndefined()
    expect(small(replay)?.key).toBe('foul')
    record(replay, ['Goal disallowed'])
    expect(small(replay)).toBeUndefined()
  })

  it('shows as half time fades out on it, both on screen for that long', () => {
    const replay = ready()
    record(replay, ['Half time'])
    animate(replay, 500)
    play(replay, 500)
    record(replay, FOUL)
    animate(replay, 200)
    expect(card(replay)?.key).toBe('halfTime')
    expect(card(replay)!.intensity).toBeLessThan(1)
    expect(small(replay)?.key).toBe('foul')
    animate(replay, 300)
    expect(card(replay)).toBeUndefined()
    expect(small(replay)?.key).toBe('foul')
  })

  it('gives way to a goal or a corner, and ends on a pause, a seek and its layer', () => {
    for (const label of ['Goal', 'Corner']) {
      const replay = ready()
      record(replay, FOUL)
      animate(replay, 100)
      record(replay, [label])
      expect(small(replay)).toBeUndefined()
    }
    const paused = ready()
    record(paused, FOUL)
    animate(paused, 100)
    paused.pause()
    expect(small(paused)).toBeUndefined()
    const sought = ready()
    record(sought, FOUL)
    animate(sought, 100)
    sought.set({ time: 900, frame: frameAt() })
    expect(small(sought)).toBeUndefined()
    const off = ready()
    record(off, FOUL)
    animate(off, 100)
    off.toggle({ foul: false })
    expect(small(off)).toBeUndefined()
    record(off, FOUL, 6)
    animate(off, 100)
    expect(small(off)).toBeUndefined()
  })

  it('under reduced motion shows at full strength, and goes when its time is up', () => {
    const replay = ready()
    replay.reducedMotion = true
    record(replay, FOUL)
    animate(replay, 20)
    expect(small(replay)).toEqual({ key: 'foul', intensity: 1 })
    animate(replay, 2050)
    expect(small(replay)).toBeUndefined()
  })

  it('can be played by hand, for the same time', () => {
    const replay = ready()
    expect(replay.director.availability().foul).toBe(true)
    replay.trigger('foul')
    animate(replay, 1500)
    expect(small(replay)).toEqual({ key: 'foul', intensity: 1 })
    animate(replay, 1000)
    expect(small(replay)).toBeUndefined()
  })
})

describe.each([
  ['shotOnGoal', 'Shot on goal', ['shot on goal', 'SHOT ON GOAL', 'Shot_on_goal', 'EventType.SHOT_ON_GOAL']],
  ['headerOnGoal', 'Header on goal', ['header on goal', 'HEADER ON GOAL', 'Header-on-goal', 'EventType.HEADER_ON_GOAL']],
] as const)('the %s card, a small card', (key, label, spellings) => {
  const small = (replay: FakeReplay) => replay.last()?.smallLabelCard

  it.each(spellings)('plays on %j, and no goal plays on it', (spelling) => {
    const replay = ready()
    record(replay, [spelling])
    animate(replay, 100)
    expect(small(replay)?.key).toBe(key)
    expect(card(replay)).toBeUndefined()
    expect(replay.last()?.goal).toBeUndefined()
    expect(replay.last()?.goalBanner).toBeUndefined()
  })

  it('does not play on a label the AI gave', () => {
    const replay = ready()
    replay.set({ time: replay.time + 0.04, frame: frameAt([label], 40, 'ai') })
    animate(replay, 100)
    expect(small(replay)).toBeUndefined()
  })

  it('is on screen for as long as a throw-in, whatever its label does, with the pitch left to its own moments', () => {
    const replay = ready()
    play(replay, 1000, [label])
    expect(small(replay)).toEqual({ key, intensity: 1 })
    play(replay, 1600, [label])
    expect(small(replay)).toBeUndefined()
  })

  it('gives way at once to the goal that comes of it', () => {
    const replay = ready()
    record(replay, [label])
    animate(replay, 100)
    record(replay, ['Goal'])
    expect(small(replay)).toBeUndefined()
    expect(replay.last()?.goal).toBeDefined()
  })

  it('replaces the other small card, and is its own layer', () => {
    const replay = ready()
    record(replay, ['Foul'])
    animate(replay, 100)
    record(replay, [label])
    animate(replay, 100)
    expect(small(replay)?.key).toBe(key)
    const off = ready()
    off.toggle({ [key]: false })
    record(off, [label])
    animate(off, 100)
    expect(small(off)).toBeUndefined()
  })
})

describe('a label card, by hand', () => {
  it('is on screen for LABEL_CARD_DEMO_MS whatever the label does, and can be played anywhere there is a frame', () => {
    const replay = ready()
    expect(replay.director.availability().varCheck).toBe(true)
    replay.trigger('varCheck')
    animate(replay, LABEL_CARD_DEMO_MS - LABEL_CARD_OUT_MS - 100)
    expect(card(replay)).toEqual({ key: 'varCheck', intensity: 1 })
    animate(replay, 200)
    expect(card(replay)!.intensity).toBeLessThan(1)
    animate(replay, LABEL_CARD_OUT_MS)
    expect(card(replay)).toBeUndefined()
  })

  it('takes over from whatever is showing, and a seek ends it', () => {
    const replay = ready()
    record(replay, ['Corner'])
    animate(replay, 100)
    replay.trigger('varCheck')
    expect(replay.last()?.corner).toBeUndefined()
    animate(replay, 100)
    expect(card(replay)?.key).toBe('varCheck')
    replay.set({ time: 900, frame: frameAt() })
    expect(card(replay)).toBeUndefined()
  })
})
