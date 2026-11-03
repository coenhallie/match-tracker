# match-tracker

`@coenhallie/match-tracker` is a white-label 2D match tracker widget, sold for
embedding in other people's pages. Two apps of ours use it: accio-match-share
(live mode) and video-annotation (replay mode). Published to GitHub Packages.

## Parity contract

The reference is video-annotation's 2D replay. What a viewer sees must match it.
- `test/fixtures/goldens` and the baseline snapshots must keep passing.
- A change to what viewers see is deliberate, and is described in `CHANGELOG.md`.
- Never update a snapshot or golden without saying why, in the commit message.

## Layers

`src/` is layered. `model` imports nothing from the others, and `widget` sits on top
of all of them, so keep dependencies pointing down towards `model`.
- `model`: the tracking data types and parsing.
- `analysis`: derived football facts (action labels, team phase, goal sequence, ball trail).
- `render`: canvas drawing of the pitch, players, ball and cards.
- `director`: moments (goal, attack, free kick, corner, throw-in), camera and playback.
  The corner is ours alone; video-annotation has none.
- `history`: the record buffer for live mode (capped to the lookback window).
- `widget`: the shadow-root DOM, HUD, input, lifecycle. Public entry is `src/index.ts`.
- `vue.ts`: the Vue component over the widget. Vue is an optional peer.

## Commands

```sh
npm run dev        # demo page, http://127.0.0.1:5180/
npm test           # vitest
npm run typecheck
npm run lint       # oxlint --deny-warnings
npm run build      # dist/, then scripts/check-dist.mjs
npm run size       # fails over 60 kB gzipped for dist/index.js, or 2 kB for dist/banner.js
```

## Style

No semicolons, single quotes, strict TypeScript, `oxlint --deny-warnings` clean.
Lint, type errors and flaky tests are defects, not noise.

## Releasing

1. Move the changelog's `Unreleased` notes under the new version and commit it.
2. `npm version <x.y.z>` (needs a clean tree; commits and tags `v<x.y.z>`).
3. `git push --follow-tags`.
4. CI (`.github/workflows/release.yml`) checks the tag equals `v` + the
   `package.json` version, runs the checks, and publishes.
5. Bump the exact pin in both apps:
   `npm install --save-exact @coenhallie/match-tracker@<x.y.z>`.

## Embedding guarantees not to break

The README's Embedding section is the full list. Never regress these:
- All DOM and CSS live in one shadow root; nothing goes into `document.head`.
  The one exception is the overlay, a `div` with `slot="overlay"` the widget
  appends to the host (so the page's CSS reaches what is mounted in it), and
  removes on `destroy()`. Nothing else goes in the light DOM.
- No globals, no polyfills, no network requests. Several instances per page.
- Document listeners only as the README lists them (`visibilitychange`, and
  `pointerdown` in capture while the layers menu is open), all removed on `destroy()`.
- Fonts and icons are bundled; both font licences ship beside the fonts.
- `dist` is three files, `index.js`, `vue.js` and `banner.js`; `index.js` never imports Vue.
  `banner.js` (`/banner`) imports nothing and holds no widget code, and `index.js` imports
  the banner from it, so its once-per-page guard is one variable. scripts/check-dist.mjs checks it.

## Commits

No agent attribution (no `Co-Authored-By` trailer). No em dashes anywhere, in
messages, docs or comments; use a plain "-".
