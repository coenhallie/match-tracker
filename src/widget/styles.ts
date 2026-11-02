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
 * Nothing is written to the host page.
 */
import { LABEL_FAMILY, familyList } from '../assets/fontFamilies'

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
 */
.mt-root {
  all: initial;
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
/* "absolute", placed in the computed box. */
.mt-canvas,
.mt-overlay,
.mt-hud {
  position: absolute;
}
/*
 * "pointer-events-none absolute inset-0": the overlay's and the HUD's layers.
 * The overlay inherits pointer-events: none, so zoom and pan still work
 * through it; a drawing layer mounted in it turns them back on for itself.
 */
.mt-overlay-layer,
.mt-hud-layer {
  pointer-events: none;
  position: absolute;
  inset: 0;
}
/* Mount points in the HUD (the phase row, the layers menu, the zoom badge): no box of their own until filled. */
.mt-slot {
  display: contents;
}
`
