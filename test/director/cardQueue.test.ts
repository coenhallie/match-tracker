import { describe, it, expect } from 'vitest'
import { CardQueue } from '../../src/director/cardQueue'
import type { CardLabel } from '../../src/analysis/cardLabels'

const red = (uuid: string | null, number = 3): CardLabel => ({ key: 'redCard', uuid, team: 0, number })
const yellow = (uuid: string | null, number = 4): CardLabel => ({ key: 'yellowCard', uuid, team: 1, number })
const drain = (queue: CardQueue) => {
  const out: CardLabel[] = []
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
})
