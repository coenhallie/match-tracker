# match-tracker

`@coenhallie/match-tracker` is a white-label 2D match tracker widget, sold for
embedding in other people's pages. Two apps of ours use it: accio-match-share
(live mode) and video-annotation (replay mode). Published to GitHub Packages.

## Parity contract

The reference is video-annotation's 2D replay. What a viewer sees must match it.
- `test/fixtures/goldens` and the baseline snapshots must keep passing.
- A change to what viewers see is deliberate, and is described in `CHANGELOG.md`.
- Never update a snapshot or golden without saying why, in the commit message.
- Moments play only on human labels (`action_origin: 'human'`), and the bottom-left action text
  lists only those unless `aiLabels` is on. The goldens' and baseline snapshots' labels have no
  origin, so their tests mark them human as they load them.

## Layers

`src/` is layered. `model` imports nothing from the others, and `widget` sits on top
of all of them, so keep dependencies pointing down towards `model`.
- `model`: the tracking data types and parsing, and the frame's coordinate system (`pitch.ts`: the
  pitch dimensions, frame units and the transform between them).
- `analysis`: derived football facts (action labels, team phase, goal sequence, ball trail, player loss,
  the second half, which turns the frames round from a human half label on).
- `render`: canvas drawing of the pitch, players, ball and cards.
- `director`: moments (goal, attack, corner, free kick, throw-in, the label cards, and the attack
  over a player loss), camera and playback. The two player cards (yellow, red) are label cards that
  name the team and the player from the label; they wait their turn in a queue (`cardQueue.ts`),
  as their label sits on one record. So does the substitution card, which lists a team's
  substitutions, a later one for the team joining it while it is up. The corner, the free kick, the label cards, the player loss cover and the goal
  on a penalty scored label are ours alone; video-annotation has none of them. Its own free kick, a card
  across the middle, is not shown, and its two goldens are retired. The corner and the free kick are set
  pieces, held alike (`setPiece.ts`). A label card (`src/model/labelCards.ts`) is played
  by a label, either across the middle (a title over an icon or a short text, the pitch faded out) or small
  on the bottom touchline (the title alone, the pitch left as it is). A new one is a registry entry and its words,
  plus its icon if it has one.
- `history`: the record buffer for live mode (capped to the lookback window).
- `widget`: the shadow-root DOM, HUD, input, lifecycle. Public entry is `src/index.ts`.
- `vue.ts`: the Vue component over the widget. Vue is an optional peer.

## Commands

```sh
npm test           # vitest, against src
npm run typecheck
npm run lint       # oxlint --deny-warnings
npm run build      # dist/, pruned declarations, scripts/check-dist.mjs, then test/dist
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
- No globals, no polyfills. The only requests are for its own font files, which ship beside
  `dist/index.js`; the icons are inlined and nothing else is fetched. Several instances per page.
- Document listeners only as the README lists them (`visibilitychange`, and
  `pointerdown` in capture while the layers menu is open), all removed on `destroy()`.
- Fonts and icons are bundled; both font licences ship beside the fonts.
- `dist` is three files, `index.js`, `vue.js` and `banner.js`; `index.js` never imports Vue.
  `banner.js` (`/banner`) imports nothing and holds no widget code, and `index.js` imports
  the banner from it, so its once-per-page guard is one variable. scripts/check-dist.mjs checks it.

## Commits

No agent attribution (no `Co-Authored-By` trailer). No em dashes anywhere, in
messages, docs or comments; use a plain "-".
