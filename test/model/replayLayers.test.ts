import { describe, it, expect } from 'vitest'
import { en } from '../../src/i18n/en'
import {
  DEFAULT_REPLAY_LAYERS,
  REPLAY_LAYERS,
  readReplayLayers,
  writeReplayLayers,
  type ReplayLayers,
} from '../../src/model/replayLayers'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  }
}

describe('replay layers', () => {
  it('lists every layer once, each with a name and a hint', () => {
    const keys = REPLAY_LAYERS.map((l) => l.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.sort()).toEqual(Object.keys(DEFAULT_REPLAY_LAYERS).sort())
    for (const layer of REPLAY_LAYERS) {
      expect(en.layers[layer.key].label.length).toBeGreaterThan(0)
      expect(en.layers[layer.key].hint.length).toBeGreaterThan(0)
    }
  })

  it('shows everything by default', () => {
    expect(Object.values(DEFAULT_REPLAY_LAYERS).every(Boolean)).toBe(true)
  })

  it('reads the defaults with nothing stored, or no storage at all', () => {
    expect(readReplayLayers(memoryStorage())).toEqual(DEFAULT_REPLAY_LAYERS)
    expect(readReplayLayers(null)).toEqual(DEFAULT_REPLAY_LAYERS)
  })

  it('reads back what was written', () => {
    const storage = memoryStorage()
    const layers: ReplayLayers = { ...DEFAULT_REPLAY_LAYERS, attack: false, farFade: false }
    writeReplayLayers(storage, layers)
    expect(readReplayLayers(storage)).toEqual(layers)
  })

  // A stored choice from an older or newer version, or a damaged entry, must
  // never hide a layer nobody chose to hide.
  it('keeps the default for anything stored that it does not recognise', () => {
    const storage = memoryStorage({
      'perspecto.replayLayers': JSON.stringify({ goal: false, attack: 'no', attackArrows: false }),
    })
    expect(readReplayLayers(storage)).toEqual({ ...DEFAULT_REPLAY_LAYERS, goal: false })
    expect(readReplayLayers(memoryStorage({ 'perspecto.replayLayers': '{not json' }))).toEqual(DEFAULT_REPLAY_LAYERS)
  })

  it('does not throw when storage refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readReplayLayers(refusing)).toEqual(DEFAULT_REPLAY_LAYERS)
    expect(() => writeReplayLayers(refusing, DEFAULT_REPLAY_LAYERS)).not.toThrow()
  })
})
