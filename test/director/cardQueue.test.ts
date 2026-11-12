import { describe, it, expect } from 'vitest'
import { CardQueue } from '../../src/director/cardQueue'
import type { CardLabel } from '../../src/analysis/cardLabels'
import type { SubstitutionLabel } from '../../src/analysis/substitutionLabels'
import type { QueuedLabel } from '../../src/director/cardQueue'

const red = (uuid: string | null, number = 3): CardLabel => ({ key: 'redCard', uuid, team: 0, number })
const yellow = (uuid: string | null, number = 4): CardLabel => ({ key: 'yellowCard', uuid, team: 1, number })
const sub = (uuid: string | null, team: 0 | 1 = 0, from = 1, to = 16): SubstitutionLabel => ({ key: 'substitution', uuid, team, from, to })
const drain = (queue: CardQueue) => {
  const out: QueuedLabel[] = []
  for (let label = queue.take(); label; label = queue.take()) out.push(label)
  return out
}

describe('the cards waiting to play', () => {
  it('queues a label once, however often it is seen', () => {
    const queue = new CardQueue()
    queue.add(red('a'), 10)
    queue.add(red('a'), 10.04)
    queue.add(red('a'), 40)
    expect(drain(queue)).toEqual([red('a')])
    queue.add(red('a'), 41)
    expect(queue.peek()).toBeUndefined()
  })

  it('queues two labels in the order they came', () => {
    const queue = new CardQueue()
    queue.add(yellow('a'), 10)
    queue.add(red('b'), 10)
    expect(queue.peek()).toEqual(yellow('a'))
    expect(drain(queue)).toEqual([yellow('a'), red('b')])
  })

  it('takes a label with no uuid seen again within 15 s for the same card, and after that for a new one', () => {
    const queue = new CardQueue()
    queue.add(red(null), 10)
    queue.add(red(null), 20)
    queue.add(red(null), 34.9)
    expect(drain(queue)).toHaveLength(1)
    queue.add(red(null), 50)
    queue.add(yellow(null), 50)
    expect(drain(queue).map((l) => l.key)).toEqual(['redCard', 'yellowCard'])
  })

  it('tells two players apart without a uuid, by team and number', () => {
    const queue = new CardQueue()
    queue.add(yellow(null, 4), 10)
    queue.add(yellow(null, 9), 10)
    queue.add(yellow(null, 4), 10.04)
    expect(drain(queue).map((l) => (l as CardLabel).number)).toEqual([4, 9])
  })

  it('puts a card cut short back at the head', () => {
    const queue = new CardQueue()
    queue.add(red('a'), 10)
    queue.add(yellow('b'), 10)
    const first = queue.take()!
    queue.putBack(first)
    expect(drain(queue)).toEqual([red('a'), yellow('b')])
  })

  it("drops a card's waiting labels, and forgets everything on clear", () => {
    const queue = new CardQueue()
    queue.add(red('a'), 10)
    queue.add(yellow('b'), 10)
    queue.add(red('c'), 10)
    queue.drop('redCard')
    expect(drain(queue)).toEqual([yellow('b')])
    queue.add(red('d'), 11)
    queue.clear()
    expect(queue.peek()).toBeUndefined()
    // Cleared for a seek: a label seen again after it is news.
    queue.add(red('d'), 12)
    expect(queue.take()).toEqual(red('d'))
  })

  it('never queues a label it skipped, as one landed on by a seek', () => {
    const queue = new CardQueue()
    queue.skip(red('a'), 10)
    queue.add(red('a'), 10.04)
    queue.skip(red(null), 10)
    queue.add(red(null), 10.04)
    expect(queue.peek()).toBeUndefined()
  })

  it('queues substitutions with the cards, in the order they came', () => {
    const queue = new CardQueue()
    queue.add(sub('s1'), 10)
    queue.add(red('c1'), 10)
    queue.add(sub('s2', 1), 11)
    expect(drain(queue)).toEqual([sub('s1'), red('c1'), sub('s2', 1)])
  })

  it('tells two substitutions apart without a uuid by team and players', () => {
    const queue = new CardQueue()
    queue.add(sub(null, 0, 1, 16), 10)
    queue.add(sub(null, 0, 2, 17), 10)
    queue.add(sub(null, 1, 1, 16), 10)
    queue.add(sub(null, 0, 1, 16), 10.04)
    expect(drain(queue)).toHaveLength(3)
  })

  it('takes the substitutions for a team waiting at the head, up to the most a card holds', () => {
    const queue = new CardQueue()
    queue.add(sub('a'), 10)
    queue.add(sub('b'), 10)
    queue.add(red('c'), 10)
    queue.add(sub('d'), 10)
    expect(queue.takeSubstitutions(0, 4)).toEqual([sub('a'), sub('b')])
    expect(queue.takeSubstitutions(0, 4)).toEqual([])
    expect(drain(queue)).toEqual([red('c'), sub('d')])
    for (const id of ['e', 'f', 'g']) queue.add(sub(id), 20)
    queue.add(sub('h', 1), 20)
    expect(queue.takeSubstitutions(0, 2)).toEqual([sub('e'), sub('f')])
    expect(queue.takeSubstitutions(1, 4)).toEqual([])
  })

  it('says whether a label is news, and remembers it', () => {
    const queue = new CardQueue()
    expect(queue.seen(sub('a'), 10)).toBe(true)
    expect(queue.seen(sub('a'), 10.04)).toBe(false)
    expect(queue.peek()).toBeUndefined()
    queue.push(sub('a'))
    expect(queue.take()).toEqual(sub('a'))
  })

  it("drops the substitutions waiting when their layer goes off, and not the cards'", () => {
    const queue = new CardQueue()
    queue.add(sub('a'), 10)
    queue.add(red('b'), 10)
    queue.drop('substitution')
    expect(drain(queue)).toEqual([red('b')])
  })
})
