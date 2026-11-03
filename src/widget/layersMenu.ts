/**
 * The layers button and menu, ported from PipelineOutputSurface.vue
 * (6f14d1f): the template (`:1678-1754`), and `layersOpen` with its Escape
 * handler (`:104-127`). What a toggle does (`toggleLayer`, `:108-118`) is the
 * tracker's: the director's setLayers keeps the reference's stop rules, and
 * the tracker keeps the choice and tells the host.
 *
 * Changes from the reference (spec, deliberate changes 7 and 8, and the
 * final review's B2, Bm2 and Bm5):
 *  - Escape closes the menu only while focus is inside the widget: its
 *    listener is on the shadow root, never on the document. An Escape it
 *    closes the menu on goes no further, so the page does not act on it too.
 *  - The menu keeps inside the pitch box, scrolling past it (`setBox`).
 *  - No backdrop over the page. The reference's "fixed inset-0" backdrop,
 *    in a widget embedded in someone else's page, would take every click
 *    meant for the page while the menu is open. Instead a press anywhere
 *    but in the button or the menu closes it, and lets the press through:
 *    the shadow root hears presses in the widget, and, only while the menu
 *    is open, the document hears presses in the page. Focus leaving for
 *    elsewhere closes it too.
 *  - It is a disclosure: the button says whether the menu is open
 *    (`aria-expanded`) and, while it is, which it is (`aria-controls`), and
 *    each layer is a toggle button, pressed while it is on.
 */
import type { TrackerText } from '../i18n/text.js'
import { REPLAY_LAYERS, type ReplayLayerKey, type ReplayLayers } from '../model/replayLayers.js'

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
/** The menu's id, for the button's `aria-controls`: ids are the shadow root's own, so one name serves every widget. */
const MENU_ID = 'mt-layers-menu'

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
  private readonly menu: HTMLDivElement
  private readonly items = new Map<ReplayLayerKey, Item>()
  private open = false
  /** The document listened on while the menu is open, or null. */
  private page: Document | null = null

  constructor(
    private readonly shadow: ShadowRoot,
    onToggle: (key: ReplayLayerKey) => void,
  ) {
    this.el = element('div', 'mt-layers')

    this.toggle = element('button', 'mt-layers-toggle')
    this.toggle.type = 'button'
    this.toggle.setAttribute('aria-expanded', 'false')
    this.toggleText = document.createTextNode('')
    this.toggle.append(icon('mt-layers-icon', LAYERS_ICON, '2'), this.toggleText)
    this.toggle.addEventListener('click', () => this.setOpen(!this.open))

    this.menu = element('div', 'mt-layers-menu')
    this.menu.id = MENU_ID
    this.menu.setAttribute('role', 'group')
    for (const { key } of REPLAY_LAYERS) {
      const button = element('button', 'mt-layer-option')
      button.type = 'button'
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
    this.el.addEventListener('focusout', this.onFocusOut)
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

  /** Which layers are ticked: their buttons are pressed. */
  setLayers(layers: ReplayLayers): void {
    for (const [key, { button }] of this.items) button.setAttribute('aria-pressed', String(layers[key]))
  }

  /** The pitch box the menu has to keep inside, in CSS px. */
  setBox(box: { width: number; height: number }): void {
    this.menu.style.maxHeight = `${Math.max(0, box.height - MENU_TOP_PX - MENU_INSET_PX)}px`
    this.menu.style.maxWidth = `${Math.max(0, box.width - 2 * MENU_INSET_PX)}px`
  }

  /** Take the button, and the menu if it is open, out of `hud`, or put the button back in. */
  setShown(hud: HTMLElement, shown: boolean): void {
    if (shown) {
      if (this.el.parentNode !== hud) hud.append(this.el)
    } else {
      this.setOpen(false)
      this.el.remove()
    }
  }

  destroy(): void {
    this.shadow.removeEventListener('keydown', this.onKeydown)
    this.el.removeEventListener('focusout', this.onFocusOut)
    this.setOpen(false)
  }

  private setOpen(open: boolean): void {
    this.open = open
    this.toggle.setAttribute('aria-expanded', String(open))
    if (open) {
      this.el.append(this.menu)
      // Only while the menu is in the tree, so it never names an element that is not there.
      this.toggle.setAttribute('aria-controls', MENU_ID)
      this.listen()
    } else {
      this.menu.remove()
      this.toggle.removeAttribute('aria-controls')
      this.unlisten()
    }
  }

  /** Hear presses, in the widget and on the page, while the menu is open. In capture, so the page cannot stop them first. */
  private listen(): void {
    if (this.page) return
    this.page = this.shadow.ownerDocument
    this.shadow.addEventListener('pointerdown', this.onWidgetPointerDown, true)
    this.page.addEventListener('pointerdown', this.onPagePointerDown, true)
  }

  private unlisten(): void {
    if (!this.page) return
    this.shadow.removeEventListener('pointerdown', this.onWidgetPointerDown, true)
    this.page.removeEventListener('pointerdown', this.onPagePointerDown, true)
    this.page = null
  }

  /** A press in the widget: anywhere but the button and the menu closes it. Never stopped, never prevented. */
  private readonly onWidgetPointerDown = (event: Event): void => {
    if (!event.composedPath().includes(this.el)) this.setOpen(false)
  }

  /**
   * A press the document hears. One in the widget is the shadow root's to
   * judge (`onWidgetPointerDown`). So is one whose path stops at a shadow
   * host the widget is inside: a closed shadow root the document cannot see
   * into, where the press may be in the widget. Any other closes the menu,
   * and goes on to the page as it would have.
   */
  private readonly onPagePointerDown = (event: Event): void => {
    const path = event.composedPath()
    if (path.includes(this.shadow.host)) return
    for (let root = this.shadow.host.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) {
      if (path[0] === root.host) return
    }
    this.setOpen(false)
  }

  /** The focus left the button and the menu for something else: the menu closes behind it. */
  private readonly onFocusOut = (event: Event): void => {
    // With nothing focused next (the window losing focus, or a press on
    // something that takes no focus), presses decide, not focus.
    const next = (event as FocusEvent).relatedTarget
    if (this.open && next instanceof Node && !this.el.contains(next)) this.setOpen(false)
  }

  /**
   * On the shadow root, so it hears only keys pressed with focus inside the
   * widget. Focus in the menu goes back to its button, rather than to the
   * page with the menu gone. (The button keeps it: a focusout to the button
   * stays inside.)
   */
  private readonly onKeydown = (event: Event): void => {
    if (!this.open || (event as KeyboardEvent).key !== 'Escape') return
    // The widget's: the page does not get it as well.
    event.stopPropagation()
    const focused = this.shadow.activeElement
    const inMenu = focused instanceof Node && this.menu.contains(focused)
    this.setOpen(false)
    if (inMenu) this.toggle.focus()
  }
}
