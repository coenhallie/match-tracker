/**
 * The layers button and menu, ported from PipelineOutputSurface.vue
 * (6f14d1f): the template (`:1678-1754`), and `layersOpen` with its Escape
 * handler (`:104-127`). What a toggle does (`toggleLayer`, `:108-118`) is the
 * tracker's: the director's setLayers keeps the reference's stop rules, and
 * the tracker keeps the choice and tells the host.
 *
 * Two changes from the reference (spec, deliberate changes 7 and 8):
 *  - Escape closes the menu only while focus is inside the widget: its
 *    listener is on the shadow root, never on the document.
 *  - The menu keeps inside the pitch box, scrolling past it (`setBox`).
 */
import type { TrackerText } from '../i18n/text'
import { REPLAY_LAYERS, type ReplayLayerKey, type ReplayLayers } from '../model/replayLayers'

const SVG = 'http://www.w3.org/2000/svg'

/** The reference's heroicons, as it inlines them. */
const LAYERS_ICON = 'M12 3 2 8l10 5 10-5-10-5ZM2 13l10 5 10-5M2 18l10 5 10-5'
const TICK_ICON = 'm5 13 4 4L19 7'

/**
 * How far down the pitch box the menu starts: the wrapper's 8 px inset
 * ("top-2"), the 28 px button ("h-7") and the 8 px gap ("mt-2").
 */
const MENU_TOP_PX = 44
/** What the menu leaves clear at the box's bottom and sides: the HUD's 8 px inset. */
const MENU_INSET_PX = 8

function icon(className: string, path: string, strokeWidth: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  if (className) svg.setAttribute('class', className)
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', strokeWidth)
  svg.setAttribute('aria-hidden', 'true')
  const line = document.createElementNS(SVG, 'path')
  line.setAttribute('stroke-linecap', 'round')
  line.setAttribute('stroke-linejoin', 'round')
  line.setAttribute('d', path)
  svg.append(line)
  return svg
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  el.className = className
  return el
}

interface Item {
  button: HTMLButtonElement
  label: HTMLSpanElement
  hint: HTMLSpanElement
}

export class LayersMenu {
  /** The button, with the menu under it while it is open. */
  readonly el: HTMLDivElement
  private readonly toggle: HTMLButtonElement
  private readonly toggleText: Text
  private readonly backdrop: HTMLDivElement
  private readonly menu: HTMLDivElement
  private readonly items = new Map<ReplayLayerKey, Item>()
  private open = false

  constructor(
    private readonly shadow: ShadowRoot,
    onToggle: (key: ReplayLayerKey) => void,
  ) {
    this.el = element('div', 'mt-layers')

    this.toggle = element('button', 'mt-layers-toggle')
    this.toggle.type = 'button'
    this.toggle.setAttribute('aria-haspopup', 'menu')
    this.toggle.setAttribute('aria-expanded', 'false')
    this.toggleText = document.createTextNode('')
    this.toggle.append(icon('mt-layers-icon', LAYERS_ICON, '2'), this.toggleText)
    this.toggle.addEventListener('click', () => this.setOpen(!this.open))

    this.backdrop = element('div', 'mt-layers-backdrop')
    this.backdrop.addEventListener('click', () => this.setOpen(false))

    this.menu = element('div', 'mt-layers-menu')
    this.menu.setAttribute('role', 'menu')
    for (const { key } of REPLAY_LAYERS) {
      const button = element('button', 'mt-layer-option')
      button.type = 'button'
      button.setAttribute('role', 'menuitemcheckbox')
      button.dataset.layer = key
      const check = element('span', 'mt-layer-check')
      check.setAttribute('aria-hidden', 'true')
      check.append(icon('', TICK_ICON, '3'))
      const words = element('span', 'mt-layer-text')
      const label = element('span', 'mt-layer-label')
      const hint = element('span', 'mt-layer-hint')
      words.append(label, hint)
      button.append(check, words)
      button.addEventListener('click', () => onToggle(key))
      this.menu.append(button)
      this.items.set(key, { button, label, hint })
    }

    this.el.append(this.toggle)
    this.shadow.addEventListener('keydown', this.onKeydown)
  }

  /** Every word in the button and the menu, in place, open or not. */
  setText(text: TrackerText): void {
    this.toggleText.data = text.layersButton
    this.toggle.title = text.layersTooltip
    this.menu.setAttribute('aria-label', text.layersMenuLabel)
    for (const [key, { label, hint }] of this.items) {
      label.textContent = text.layers[key].label
      hint.textContent = text.layers[key].hint
    }
  }

  /** Which layers are ticked. */
  setLayers(layers: ReplayLayers): void {
    for (const [key, { button }] of this.items) button.setAttribute('aria-checked', String(layers[key]))
  }

  /** The pitch box the menu has to keep inside, in CSS px. */
  setBox(box: { width: number; height: number }): void {
    this.menu.style.maxHeight = `${Math.max(0, box.height - MENU_TOP_PX - MENU_INSET_PX)}px`
    this.menu.style.maxWidth = `${Math.max(0, box.width - 2 * MENU_INSET_PX)}px`
  }

  destroy(): void {
    this.shadow.removeEventListener('keydown', this.onKeydown)
    this.setOpen(false)
  }

  private setOpen(open: boolean): void {
    this.open = open
    this.toggle.setAttribute('aria-expanded', String(open))
    if (open) this.el.append(this.backdrop, this.menu)
    else {
      this.backdrop.remove()
      this.menu.remove()
    }
  }

  /**
   * On the shadow root, so it hears only keys pressed with focus inside the
   * widget. Focus in the menu goes back to its button, rather than to the
   * page with the menu gone.
   */
  private readonly onKeydown = (event: Event): void => {
    if (!this.open || (event as KeyboardEvent).key !== 'Escape') return
    const focused = this.shadow.activeElement
    const inMenu = focused instanceof Node && this.menu.contains(focused)
    this.setOpen(false)
    if (inMenu) this.toggle.focus()
  }
}
