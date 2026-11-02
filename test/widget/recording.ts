/**
 * The real Director and renderer, wrapped to note what the widget hands
 * them: every director's options and update inputs, the stopAll calls, and
 * every view the renderer is given. A test file mocks src/director/director
 * with `recordingDirector` and src/render/renderer with `recordingRenderer`,
 * and reads `control` back.
 */
import type { Director, DirectorInput, DirectorOptions, DirectorView } from '../../src/director/director'
import type { createRenderer } from '../../src/render/renderer'

/** What the tests read back. */
export const control = {
  /** The options every director was made with, in order. */
  options: [] as DirectorOptions[],
  /** Every update input, in order. */
  inputs: [] as DirectorInput[],
  /** How many times stopAll was called. */
  stopAll: 0,
  /** Every view a renderer was given, in order. */
  views: [] as DirectorView[],
  reset() {
    control.options = []
    control.inputs = []
    control.stopAll = 0
    control.views = []
  },
}

/** A Director constructor that makes the real one, and notes its options, update inputs and stopAll calls. */
export function recordingDirector(Real: typeof Director): typeof Director {
  function Recording(options: DirectorOptions) {
    control.options.push(options)
    const real = new Real(options)
    const update = real.update.bind(real)
    real.update = (input, view) => {
      control.inputs.push(input)
      return update(input, view)
    }
    const stopAll = real.stopAll.bind(real)
    real.stopAll = () => {
      control.stopAll++
      return stopAll()
    }
    return real
  }
  return Recording as unknown as typeof Director
}

/** createRenderer, making the real renderer, and noting every view it is given. */
export function recordingRenderer(real: typeof createRenderer): typeof createRenderer {
  return (canvas, theme) => {
    const renderer = real(canvas, theme)
    const setView = renderer.setView
    renderer.setView = (view) => {
      control.views.push({ ...view })
      setView(view)
    }
    return renderer
  }
}
