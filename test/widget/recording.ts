/**
 * The real Director and renderer, wrapped to note what the widget hands
 * them: every director's options, update inputs and outputs, the stopAll and
 * releaseCamera calls, and every view and frame the renderer is given. A test file
 * mocks src/director/director with `recordingDirector` and
 * src/render/renderer with `recordingRenderer`, and reads `control` back.
 */
import type {
  Director,
  DirectorInput,
  DirectorOptions,
  DirectorOutput,
  DirectorView,
} from '../../src/director/director'
import type { Frame } from '../../src/model/types'
import type { FrameLayers, createRenderer } from '../../src/render/renderer'
import type { RenderTheme } from '../../src/render/theme'

/** What the tests read back. */
export const control = {
  /** The options every director was made with, in order. */
  options: [] as DirectorOptions[],
  /** Every director made, in order. */
  directors: [] as Director[],
  /** Which director made each entry of `inputs` and `outputs`: its index in `directors`. */
  updatedBy: [] as number[],
  /** Every frame a renderer drew, with the layers it was given, in order. */
  drawn: [] as Array<{ frame: Frame; layers: FrameLayers | undefined }>,
  /** Every update input, in order. */
  inputs: [] as DirectorInput[],
  /** What every update gave back, in order. */
  outputs: [] as DirectorOutput[],
  /** How many times releaseCamera was called. */
  releases: 0,
  /** How many times stopAll was called. */
  stopAll: 0,
  /** Every view a renderer was given, in order. */
  views: [] as DirectorView[],
  /** Every theme a renderer was made with or given, in order. */
  themes: [] as RenderTheme[],
  /** How many of the next renderFrame calls throw, and with what message. */
  failRenders: 0,
  failMessage: 'the renderer failed',
  reset() {
    control.options = []
    control.directors = []
    control.updatedBy = []
    control.drawn = []
    control.inputs = []
    control.outputs = []
    control.releases = 0
    control.stopAll = 0
    control.views = []
    control.themes = []
    control.failRenders = 0
    control.failMessage = 'the renderer failed'
  },
}

/** A Director constructor that makes the real one, and notes its options, update inputs and stopAll calls. */
export function recordingDirector(Real: typeof Director): typeof Director {
  function Recording(options: DirectorOptions) {
    control.options.push(options)
    const real = new Real(options)
    const index = control.directors.push(real) - 1
    const update = real.update.bind(real)
    real.update = (input, view) => {
      control.updatedBy.push(index)
      control.inputs.push(input)
      const out = update(input, view)
      control.outputs.push(out)
      return out
    }
    const releaseCamera = real.releaseCamera.bind(real)
    real.releaseCamera = () => {
      control.releases++
      releaseCamera()
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

/** createRenderer, making the real renderer, noting every view it is given, and failing when told to. */
export function recordingRenderer(real: typeof createRenderer): typeof createRenderer {
  return (canvas, theme) => {
    if (theme) control.themes.push(theme)
    const renderer = real(canvas, theme)
    const setTheme = renderer.setTheme
    renderer.setTheme = (next) => {
      control.themes.push(next)
      setTheme(next)
    }
    const setView = renderer.setView
    renderer.setView = (view) => {
      control.views.push({ ...view })
      setView(view)
    }
    const renderFrame = renderer.renderFrame
    renderer.renderFrame = (...args) => {
      if (control.failRenders > 0) {
        control.failRenders--
        throw new Error(control.failMessage)
      }
      control.drawn.push({ frame: args[0], layers: args[1] })
      renderFrame(...args)
    }
    return renderer
  }
}
