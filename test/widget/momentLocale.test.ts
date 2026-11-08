/**
 * The words the moments write on the canvas, in `momentLocale`: a host can keep
 * them in one language while the HUD and the layers menu follow `locale`, as
 * match-share keeps them English for clients until a translation is approved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMatchTracker, type MatchTracker, type MatchTrackerOptions } from '../../src/index'
import { en } from '../../src/i18n/en'
import { zh } from '../../src/i18n/zh'
import { LABEL_CARD_KEYS, TEXT_CARD_KEYS, labelCardTextKey } from '../../src/model/labelCards'
import { installEnv, makeHost, type Env } from './env'
import { control } from './recording'

vi.mock('../../src/director/director', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/director/director')>()
  const { recordingDirector } = await import('./recording')
  return { ...real, Director: recordingDirector(real.Director) }
})
vi.mock('../../src/render/renderer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/render/renderer')>()
  const { recordingRenderer } = await import('./recording')
  return { ...real, createRenderer: recordingRenderer(real.createRenderer) }
})

let env: Env
const mounted: MatchTracker[] = []

function mount(options: Partial<MatchTrackerOptions> = {}) {
  const host = makeHost()
  const tracker = createMatchTracker(host, { mode: 'live', layersStorageKey: null, ...options })
  mounted.push(tracker)
  env.resize(host, 800, 450)
  return { host, tracker }
}

/** Every word the moments write on the canvas, as the renderer was last given them. */
function canvasWords() {
  const text = control.themes.at(-1)!.text
  return [
    text.goal,
    text.corner,
    text.throwIn,
    text.attack,
    ...LABEL_CARD_KEYS.map((key) => text[key]),
    ...TEXT_CARD_KEYS.map((key) => text[labelCardTextKey(key)]),
  ]
}
const wordsOf = (t: typeof en) => [
  t.goal,
  t.corner,
  t.throwIn,
  t.attack,
  ...LABEL_CARD_KEYS.map((key) => t[key]),
  ...TEXT_CARD_KEYS.map((key) => t[labelCardTextKey(key)]),
]
/** What the HUD calls the pitch for screen readers, in `locale`. */
const pitchLabel = (host: HTMLElement) => host.shadowRoot!.querySelector('canvas')!.getAttribute('aria-label')

beforeEach(() => {
  env = installEnv()
  control.reset()
})

afterEach(() => {
  for (const tracker of mounted.splice(0)) tracker.destroy()
  document.body.replaceChildren()
  env.restore()
})

describe('momentLocale', () => {
  it('follows locale when not given', () => {
    mount({ locale: 'zh' })
    expect(canvasWords()).toEqual(wordsOf(zh))
  })

  it('keeps the moments in English while the rest is in Chinese', () => {
    const { host } = mount({ locale: 'zh', momentLocale: 'en' })
    expect(canvasWords()).toEqual(wordsOf(en))
    expect(pitchLabel(host)).toBe(zh.pitchLabel)
  })

  it('switches with setOptions, as a developer link turning the translation on does, and with locale left alone', () => {
    const { host, tracker } = mount({ locale: 'zh', momentLocale: 'en' })
    tracker.setOptions({ momentLocale: 'zh' })
    expect(canvasWords()).toEqual(wordsOf(zh))
    tracker.setOptions({ momentLocale: 'en', locale: 'en' })
    expect(canvasWords()).toEqual(wordsOf(en))
    expect(pitchLabel(host)).toBe(en.pitchLabel)
    tracker.setOptions({ locale: 'zh' })
    expect(canvasWords()).toEqual(wordsOf(en))
    expect(pitchLabel(host)).toBe(zh.pitchLabel)
  })

  it('reads a language tag as locale does, and lets the host’s own words win', () => {
    mount({ locale: 'en', momentLocale: 'zh-CN', text: { foul: 'Foul!' } })
    const text = control.themes.at(-1)!.text
    expect(text.goal).toBe(zh.goal)
    expect(text.foul).toBe('Foul!')
  })
})
