/**
 * The shadow root's CSS: PipelineOutputSurface.vue's Tailwind classes as
 * plain CSS, with the reference's values as defaults. Colours and fonts read
 * custom properties, which a host sets on the host element (custom
 * properties inherit into a shadow root, and nothing else of the page's CSS
 * reaches in):
 *
 *  - `--mt-stage-bg`: behind the pitch, in the letterbox. Default black (`bg-black`).
 *  - `--mt-hud-bg`: the HUD's badges and buttons. Default `rgb(0 0 0 / 0.6)` (`bg-black/60`).
 *  - `--mt-hud-text`: the HUD's text. Default white.
 *  - `--mt-font`: the HUD's font. Default the bundled Montserrat, then the CJK fallbacks.
 *
 * Nothing is written to the host page. Lengths are in px, the reference's
 * rem at its 16 px: a rem is the host page's root font size, which reaches
 * into a shadow root.
 */
import { LABEL_FAMILY, familyList } from '../assets/fontFamilies.js'

export const STYLES = `
:host {
  display: block;
}
:host([hidden]) {
  display: none;
}
/* Tailwind's preflight, as far as the reference relies on it. */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  border: 0 solid;
}
canvas {
  display: block;
}
/*
 * The stage: "relative flex h-full w-full items-center justify-center
 * overflow-hidden bg-black". Text the page sets on the host (font, colour,
 * spacing) would be inherited into the shadow root; "all: initial" stops it,
 * and leaves the custom properties, which "all" does not reset.
 *
 * "isolation: isolate" makes the root a stacking context of its own, so the
 * menu's z-index orders it within the widget and never against the page's.
 *
 * "all" leaves direction and unicode-bidi alone, so a right-to-left page
 * would flip the HUD (and the canvas text, whose direction is inherited):
 * the widget is laid out left to right wherever it is, its text isolated
 * from the page's.
 */
.mt-root {
  all: initial;
  direction: ltr;
  unicode-bidi: isolate;
  isolation: isolate;
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background-color: var(--mt-stage-bg, #000);
  color: var(--mt-hud-text, #fff);
  font-family: var(--mt-font, ${familyList(LABEL_FAMILY)});
  font-size: 16px;
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
}
/* "absolute inset-0 overflow-hidden" */
.mt-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
/* "cursor-grab" while zoomed in. Its touch-action is set with the zoom (createMatchTracker.ts). */
.mt-viewport.mt-zoomed {
  cursor: grab;
}
/* "absolute", placed in the computed box. */
.mt-canvas,
.mt-overlay,
.mt-hud {
  position: absolute;
}
/*
 * "pointer-events-none absolute inset-0": the overlay's and the HUD's layers.
 * The host's overlay element, slotted into .mt-overlay, sets pointer-events:
 * none on itself (createMatchTracker.ts), so zoom and pan still work through
 * it; a drawing layer mounted in it turns them back on for itself.
 */
.mt-overlay-layer,
.mt-hud-layer {
  pointer-events: none;
  position: absolute;
  inset: 0;
}

/* Tailwind's preflight for the HUD's controls and icons. */
button {
  font: inherit;
  font-feature-settings: inherit;
  font-variation-settings: inherit;
  letter-spacing: inherit;
  color: inherit;
  border-radius: 0;
  background-color: transparent;
  opacity: 1;
  padding: 0;
  appearance: button;
}
svg {
  display: block;
  vertical-align: middle;
}

/*
 * The attacking/defending row, in the row kept clear above the pitch
 * (LABEL_ROW_PX). The reference places the row itself "absolute inset-x-0
 * bottom-full mx-auto w-max"; here a box spanning the HUD does the placing,
 * so the row can ask how wide the HUD is (a container query) without the HUD
 * itself becoming a container, which would make it the containing block of
 * everything in it, the layers menu among them.
 */
.mt-phase-box {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  container-type: inline-size;
}
/*
 * "pointer-events-auto mx-auto mb-1.5 grid w-max max-w-full
 * grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2": two equal
 * columns either side of "vs", as wide as the longer label needs.
 */
.mt-phase {
  pointer-events: auto;
  display: grid;
  width: max-content;
  /* "max-w-full", less the HUD's 8 px inset either side, so a row of long names stops short of the edges. */
  max-width: calc(100% - 16px);
  margin: 0 auto 6px;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
/* "text-[10px] font-semibold uppercase tracking-widest text-white/60" */
.mt-phase-vs {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgb(255 255 255 / 0.6);
}
/*
 * "flex min-w-[9.5rem] items-center gap-3 whitespace-nowrap rounded-md
 * border-2 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider
 * text-white shadow-lg transition-colors duration-200", with "bg-black/60"
 * until the team attacks and its colour fills it (inline, as in the
 * reference), and "justify-end" for team 1.
 */
.mt-phase-team {
  display: flex;
  min-width: 152px;
  align-items: center;
  gap: 12px;
  /* The widget's own: nothing it holds ever shows past its border. */
  overflow: hidden;
  white-space: nowrap;
  border-radius: 6px;
  border-width: 2px;
  border-style: solid;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--mt-hud-text, #fff);
  background-color: var(--mt-hud-bg, rgb(0 0 0 / 0.6));
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 200ms;
}
.mt-phase-team[data-team="1"] {
  justify-content: flex-end;
}
/* "min-w-0 truncate font-bold": a name too long for its column is cut short, and shown in full on hover. */
.mt-phase-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}
/* "shrink-0 text-[10px] tracking-widest", with "ml-auto" for team 0 and "mr-auto" for team 1. */
.mt-phase-state {
  flex-shrink: 0;
  font-size: 10px;
  letter-spacing: 0.1em;
}
.mt-phase-team[data-team="0"] .mt-phase-state {
  margin-left: auto;
}
.mt-phase-team[data-team="1"] .mt-phase-state {
  margin-right: auto;
}
/*
 * The widget's own (spec, deliberate change 7): on a HUD narrower than the
 * reference's row (about 340 px), the labels give up their minimum width, so
 * the names are cut short rather than the row overflowing, and the spacing
 * tightens.
 */
@container (width < 360px) {
  .mt-phase {
    gap: 4px;
  }
  .mt-phase-team {
    min-width: 0;
    gap: 6px;
    padding-left: 6px;
    padding-right: 6px;
  }
}
/*
 * Narrower still, the states ("Attacking", "Defending") leave no room for a
 * name, so they go: the attacking team is still the one filled in its
 * colour, and the row's ARIA label still says both states.
 */
@container (width < 260px) {
  .mt-phase-state {
    display: none;
  }
}
/* At the narrowest, "vs" goes too, and the two names share the row. */
@container (width < 200px) {
  .mt-phase {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .mt-phase-vs {
    display: none;
  }
}

/* The layers menu: "pointer-events-auto absolute right-2 top-2". */
.mt-layers {
  pointer-events: auto;
  position: absolute;
  right: 8px;
  top: 8px;
}
/*
 * "flex h-7 items-center gap-1.5 rounded-full bg-black/60 px-2.5 text-[10px]
 * font-semibold uppercase tracking-widest text-white/80 shadow-lg ring-1
 * ring-white/10 transition-colors hover:text-white
 * focus-visible:outline-none focus-visible:ring-white/60"
 */
.mt-layers-toggle {
  display: flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  border-radius: 9999px;
  background-color: var(--mt-hud-bg, rgb(0 0 0 / 0.6));
  padding: 0 10px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgb(255 255 255 / 0.8);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.1),
    0 10px 15px -3px rgb(0 0 0 / 0.1),
    0 4px 6px -4px rgb(0 0 0 / 0.1);
  transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
@media (hover: hover) {
  .mt-layers-toggle:hover {
    color: var(--mt-hud-text, #fff);
  }
}
.mt-layers-toggle:focus-visible {
  outline-style: none;
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.6),
    0 10px 15px -3px rgb(0 0 0 / 0.1),
    0 4px 6px -4px rgb(0 0 0 / 0.1);
}
/* "h-3.5 w-3.5" */
.mt-layers-icon {
  width: 14px;
  height: 14px;
}
/*
 * "absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-md
 * border border-white/10 bg-gray-900/95 py-1 text-white shadow-xl". The
 * widget keeps it inside the pitch box (spec, deliberate change 7): its
 * maximum size is set from the box, and it scrolls past that.
 */
.mt-layers-menu {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 50;
  margin-top: 8px;
  width: 256px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 6px;
  border: 1px solid rgb(255 255 255 / 0.1);
  background-color: rgb(16 24 40 / 0.95);
  background-color: oklch(21% 0.034 264.665 / 0.95);
  padding: 4px 0;
  color: var(--mt-hud-text, #fff);
  box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
}
/*
 * "flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition-colors
 * hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none"
 */
.mt-layer-option {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 12px;
  text-align: left;
  transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
@media (hover: hover) {
  .mt-layer-option:hover {
    background-color: rgb(255 255 255 / 0.06);
  }
}
.mt-layer-option:focus-visible {
  background-color: rgb(255 255 255 / 0.06);
  outline-style: none;
}
/*
 * "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm
 * border", then "border-white bg-white text-gray-900" when on and
 * "border-white/40" when off, with the tick ("h-3 w-3") only when on.
 */
.mt-layer-check {
  margin-top: 2px;
  display: flex;
  height: 14px;
  width: 14px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: 1px solid rgb(255 255 255 / 0.4);
}
.mt-layer-check svg {
  width: 12px;
  height: 12px;
}
.mt-layer-option[aria-pressed="true"] .mt-layer-check {
  border-color: #fff;
  background-color: #fff;
  color: rgb(16 24 40);
  color: oklch(21% 0.034 264.665);
}
.mt-layer-option[aria-pressed="false"] .mt-layer-check svg {
  display: none;
}
/* "min-w-0", then "block text-[12px] leading-tight" and "block text-[10px] leading-tight text-white/50". */
.mt-layer-text {
  min-width: 0;
}
.mt-layer-label {
  display: block;
  font-size: 12px;
  line-height: 1.25;
}
.mt-layer-hint {
  display: block;
  font-size: 10px;
  line-height: 1.25;
  color: rgb(255 255 255 / 0.5);
}

/* The zoom badge: "absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white". */
.mt-zoom {
  position: absolute;
  bottom: 8px;
  right: 8px;
  border-radius: 4px;
  background-color: rgb(0 0 0 / 0.5);
  padding: 2px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 10px;
  color: var(--mt-hud-text, #fff);
}

/*
 * The debug badge for a player loss, top left: the widget's own, in the zoom
 * badge's type, on red so it reads as a warning about the data. It keeps
 * clear of the layers button, top right, at any width, wrapping rather than
 * cutting its text short.
 */
.mt-loss {
  position: absolute;
  top: 8px;
  left: 8px;
  max-width: calc(100% - 120px);
  border-radius: 4px;
  background-color: rgb(185 28 28 / 0.85);
  padding: 2px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 10px;
  line-height: 1.5;
  color: #fff;
  pointer-events: none;
}

/* "motion-reduce:transition-none" */
@media (prefers-reduced-motion: reduce) {
  .mt-phase-team,
  .mt-layers-toggle,
  .mt-layer-option {
    transition-property: none;
  }
}
`
