# @coenhallie/match-tracker

A live 2D match tracker for football streams. It draws players, ball and the
match's moments (goals, attacks, free kicks, throw-ins) on a pitch, from the
tracking pipeline's frames, inside any element you give it. It is the 2D
replay from video-annotation, taken out of Vue: the same picture, timing and
behaviour for the same data, with zoom and pan, the attacking/defending row and
the layers menu.

- **Framework-free.** One function, `createMatchTracker`, and plain DOM. A thin
  Vue 3 component is a separate entry, `@coenhallie/match-tracker/vue`.
- **Contained.** Everything lives in a shadow root. Fonts and icons come with
  the package, so the widget needs nothing from the host page and leaves
  nothing in it.
- **Two inputs.** In live mode you push websocket messages as they arrive. In
  replay mode you present the state at your own clock (play, pause, seek).
- **English and Chinese,** and any text you want to override.

The running version is on the widget's root element as
`data-match-tracker-version`, and is exported as `MATCH_TRACKER_VERSION`.

## Install

The package is private, on GitHub Packages. Add this line to the project's
`.npmrc`:

```
@coenhallie:registry=https://npm.pkg.github.com
```

You also need a GitHub token with the `read:packages` scope, wherever you install:

```
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Keep that line in your user `~/.npmrc` or in CI, never in the repo. Set
`NODE_AUTH_TOKEN` to the token.

Install an exact version (no `^`), so `package.json` says which version an
app runs, and `npm outdated @coenhallie/match-tracker` shows when it is behind:

```sh
npm install --save-exact @coenhallie/match-tracker
```

Vue 3.5 or newer is an optional peer dependency, and is needed only for the `/vue` entry.

## Use

The widget fills its host element and letterboxes the pitch inside it, so
give the host a size. The pitch is 16:9, under a 40 px row for the
attacking/defending labels, so a host 768 px wide fits it exactly at
768 × 472:

```css
#tracker {
  width: 768px;
  height: calc(768px * 9 / 16 + 40px);
}
```

### Live

```ts
import { createMatchTracker } from '@coenhallie/match-tracker'

const tracker = createMatchTracker(document.querySelector('#tracker')!, {
  mode: 'live',
  locale: 'en',
  teams: { home: { name: 'Ajax' }, away: { name: 'PSV' } },
})

socket.addEventListener('message', (event) => tracker.push(event.data))
socket.addEventListener('open', () => tracker.reset()) // a reconnect: forget the old stream
```

- `push` takes a message in any form the pipeline sends it: the raw string,
  a double-encoded string, the envelope, or a bare `match` object.
- A message it cannot read is skipped, and the last picture stays.
- Repeats of a frame (by `frame_count`) are dropped. A burst of messages in
  one tick is taken in whole and drawn once.
- The widget runs on the browser's own clock. Coming back to a hidden tab, or
  scrolling the widget back into view, counts as a seek, so no stale moment
  plays.

### Replay

```ts
const tracker = createMatchTracker(host, { mode: 'replay' })

// On every tick of your player's clock, and on every pause or seek:
tracker.present({
  time, // the replay clock, in seconds
  playing, // false while paused
  record, // the record on screen at `time` (parseRecord(message)), or null
  lookback, // the records you hold from time - lookback up to time, in time order
})
```

A step of 0 to 0.5 s while playing counts as playback. Anything else counts as
a seek, which stops every moment. Pausing also stops them. `parseRecord` turns a
message into the `TrackerRecord` that `present` takes.

### Vue

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { MatchTracker, type MatchTrackerHandle } from '@coenhallie/match-tracker/vue'

const tracker = ref<MatchTrackerHandle | null>(null)
socket.addEventListener('message', (event) => tracker.value?.push(event.data))
</script>

<template>
  <MatchTracker
    ref="tracker"
    class="tracker"
    mode="live"
    :locale="locale"
    :teams="{ home: { name: home }, away: { name: away } }"
    @moment="onMoment"
  />
</template>
```

- Every option below is a prop. A prop that changes, in place or not, goes to
  `setOptions` on its own, so it never undoes another prop or the layers
  chosen in the menu.
- `mode` is fixed for a tracker's life. Changing it makes a new tracker.
- The component emits `zoom`, `layers` and `moment`.
- The ref exposes `push`, `present`, `reset`, `trigger` and `overlay`. They
  do nothing until the component is mounted.
- All the types of the main entry are re-exported from `/vue`.

## API

### `createMatchTracker(host, options): MatchTracker`

Mounts a tracker in `host`'s shadow root. It reuses one already there, so a host can be mounted again after `destroy`.

| Member | |
|---|---|
| `push(message)` | Live: one websocket message. |
| `present(state)` | Replay: `{ time, playing, record, lookback }` at the host's clock. |
| `reset()` | Forget everything seen and end every moment. What comes next is a seek. The last picture stays until new data arrives. |
| `trigger(moment, team?)` | Play `'goal'`, `'attack'`, `'freeKick'` or `'throwIn'` now, on the frame on screen. `team` (0 home, 1 away, default 0) is for an attack. Returns false when the moment cannot be played on that frame (for example before the first frame, or a goal with no ball). |
| `setOptions(options)` | Change any option but `mode`. The HUD and the canvas follow at once, without a remount. |
| `on(event, listener)` | Listen to an event. Returns a function that unsubscribes. |
| `overlay` | An element over the pitch, in the canvas's own box, for a host's drawing layer. Pointer events pass through it unless you turn them on for your own elements. A press on it stops every moment. |
| `version` | The package version this tracker runs. |
| `destroy()` | Stop everything and empty the shadow root. Every method is a no-op after. |

Also exported: `MATCH_TRACKER_VERSION`, `parseRecord(message): TrackerRecord | null`, and the types
(`MatchTrackerOptions`, `ReplayState`, `TrackerEvents`, `TrackerRecord`, `Frame`, `ReplayLayers`,
`ReplayMoment`, `TrackerText`, `PersonColors`, `PersonRole` and the rest).

### Options

| Option | Type | Default | |
|---|---|---|---|
| `mode` | `'live' \| 'replay'` | (required) | Fixed at mount. |
| `locale` | `'en' \| 'zh'` | `'en'` | The built-in text. |
| `text` | `Partial<TrackerText>` | | Any string, in place of the locale's. `layers` replaces only the layers it names. |
| `teams` | `{ home?: { name?, color? }, away?: { name?, color? } }` | | Team 0 is home and team 1 is away. A name defaults to the localised "Red" and "Blue". A `color` is the team's fill, on its players, its attack and its label. |
| `colors` | `Partial<Record<PersonRole, Partial<PersonColors>>>` | video-annotation's | `fill`, `outline` and `text` per role: `home`, `away`, `goalkeeper`, `official`, `unknown`. A team's `color` wins over `fill` here. |
| `layers` | `Partial<ReplayLayers>` | all on | The layers shown until the viewer chooses in the menu. |
| `layersStorageKey` | `string \| null` | `'match-tracker.layers'` | Where the menu's choice is kept in `localStorage`. `null` keeps nothing. A kept choice wins over `layers`. |
| `formatAction` | `(actionType: string) => string` | as it comes | The bottom-left text for each of a frame's actions, from its `action_type` (for example `'EventType.FREE_KICK'` to `'Free kick'`). |

The layers are `goal`, `attack`, `freeKick`, `throwInBanner`, `ballTrail`,
`phaseLabels`, `nearbyRings`, `farFade` and `ringFades`.

The `TrackerText` keys are:
- on the canvas: `goal`, `freeKick`, `throwIn`, `attack`;
- the row: `attacking`, `defending`, `versus`, `phaseTooltip`, `red` and `blue` (the default team names);
- ARIA templates: `phaseAttackingAria` and `phaseDefendingAria` (with `{team}`), and `phaseAria` (with `{home}` and `{away}`);
- the menu: `layersButton`, `layersTooltip`, `layersMenuLabel`, and `layers` (`{ label, hint }` per layer);
- the zoom: `zoomLevel` (with `{zoom}`) and `zoomReset`.

### Events

| Event | Value | When |
|---|---|---|
| `zoom` | `{ zoom }` | The view's zoom changed, by the viewer or by a goal's camera. |
| `layers` | `ReplayLayers` | The layers in force changed, from the menu or from `setOptions`. |
| `moment` | `{ moment, phase: 'start' \| 'end' }` | A moment came on screen, or went. |

A listener that throws is reported (`reportError`) and does not stop the widget.

## Theming

- **Colours, names and text** are options (above), and can change at any time with `setOptions`.
- **The HUD** (the attacking/defending row, the layers button and menu, the zoom
  badge) reads CSS custom properties set on the host element. They inherit into
  the shadow root, and nothing else of the page's CSS does.

| Property | Default | |
|---|---|---|
| `--mt-stage-bg` | `#000` | Behind the pitch, in the letterbox. |
| `--mt-hud-bg` | `rgb(0 0 0 / 0.6)` | The HUD's badges and buttons. |
| `--mt-hud-text` | `#fff` | The HUD's text. |
| `--mt-font` | the bundled Montserrat, then the CJK fallback | The HUD's font. |

```css
#tracker {
  --mt-stage-bg: #0b1d12;
  --mt-font: 'Your Brand Sans', sans-serif;
}
```

- **Fonts.** The canvas and the HUD use Montserrat (400, 600, 700) and Inter
  (italic 900). They come in the package as Latin woff2 files, registered under
  private names (`"MatchTracker Montserrat"` and `"MatchTracker Inter"`), so
  they never clash with the page's fonts. Each is followed by
  `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif`,
  so Chinese uses the viewer's system font. Both fonts are under the SIL Open Font
  License, and their licences ship next to them in `dist`.
- **Text fits.** Every piece of canvas text is measured and shrunk to fit its
  card when it would overflow. Long team names are cut short with an ellipsis,
  and keep their full names in the tooltip and for screen readers.

## Embedding

The widget is built to sit in pages we do not control, next to their own
scripts and styles, several times on one page.

- **Contained.**
  - All DOM and CSS live in one shadow root under the host element. The
    stylesheet is adopted, not injected, so nothing goes into `document.head`.
  - The page gets only the `FontFace` registrations, made once however many
    widgets there are.
  - Host CSS cannot reach in, and the widget's CSS cannot leak out. Lengths
    are in px, not rem, so even the page's root font size stays outside.
  - There are no globals, no polyfills and no network requests: fonts and icons are in the bundle.
- **Listeners outside the widget:**
  - the resolution media query and the reduced-motion query;
  - one `visibilitychange` listener on the host's document, to stop drawing in a hidden tab.

  All are removed on `destroy()`. No other listener goes on `document` or `window`.
- **Several on one page.** Each instance has its own state. Nothing is shared but the font registration and the stylesheet.
- **Clean teardown.** `destroy()` cancels every animation frame and removes every observer, listener and timer.
- **Accurate.** Players and ball are drawn where the data puts them, with no
  smoothing. The only exceptions are video-annotation's own: the goal
  sequence's ball, and the ball held during an attack.
- **Light on the host page.**
  - The pitch is drawn only when something changes: a new record, a running
    moment or fade, a resize, or zoom and pan. Otherwise no animation frame
    loop runs.
  - Drawing stops while the widget is scrolled out of view or the tab is
    hidden, and catches up when it is back.
  - The pitch's markings are drawn once and cached.
  - Live history is capped at the lookback window, so memory stays flat over a match.
- **Input.**
  - A plain wheel scrolls the page. Ctrl or ⌘ + wheel (also what a trackpad pinch sends) zooms about the cursor, from 1x to 6x.
  - On touch, two fingers pinch-zoom, and one finger pans once zoomed in. At 1x, a vertical drag scrolls the page.
  - A mouse drag pans when zoomed in, and a double-click resets the view.
  - Escape closes the layers menu only while focus is inside the widget.
- **Reduced motion** is honoured, in every branch where video-annotation honours it.

### Bundlers

The package is ES modules with `.d.ts` types, and resolves under TypeScript's
`bundler`, `node16` and `nodenext` module resolution. The fonts are referenced
with `new URL('./font.woff2', import.meta.url)`, which bundlers copy as assets:
this was checked with Vite 8 (build and dev server) and webpack 5. Without a
bundler, serve the whole `dist` folder, so the fonts sit next to `index.js`.

### Browsers

The code is ES2022. The oldest browsers it runs in are set by the platform
features it uses:
- Chrome and Edge 105 (container queries);
- Firefox 112 (canvas `roundRect`);
- Safari 16.4, on macOS and iOS (`OffscreenCanvas` with a 2D context).

## Size and performance

`npm run size` prints the gzipped size of `dist/index.js` and `dist/vue.js`, and
the size of the fonts. It fails when `dist/index.js` is over 60 kB gzipped.
The measured numbers for each release are in [CHANGELOG.md](CHANGELOG.md). The targets:
- one draw in under 4 ms at 1280×720 CSS px at 2x;
- no dropped frames during a goal on a mid-range phone.

## Developing

```sh
npm install
npm run dev        # the demo page, http://127.0.0.1:5180/
npm test           # vitest
npm run typecheck
npm run lint       # oxlint --deny-warnings
npm run build      # dist/, then checks it (scripts/check-dist.mjs)
npm run size
```

The demo (`demo/`) plays the test fixtures through two widgets, one live and
one in replay. It has a button for every moment, a locale toggle, a width
selector and a "hostile CSS" switch. `window.demo` holds the hooks the
performance checks use: `perf.start()` / `perf.stop()` time every animation
frame, and `bench()` times the renderer over a goal. Screenshots taken
from it go in `demo/screenshots/`, which git ignores.

To try a change in an app before it is released, use `npm link` or a `file:`
path. Never commit either. Apps only ever install published versions.

## Versioning and releases

Semantic versioning:
- anything that changes what a viewer sees is at least a minor version;
- any API break is a major version (a minor version before 1.0).

`CHANGELOG.md` is written by hand for each release, in Keep a Changelog
format, and says what a viewer will notice.

To release:

1. Move the changelog's `Unreleased` notes under the new version, with the
   date and the measured size and performance.
2. `npm version <major|minor|patch>`. This sets the version in
   `package.json`, which the build injects as `MATCH_TRACKER_VERSION`, then
   commits and tags `v<version>`.
3. `git push --follow-tags`. The GitHub Actions workflow on `v*` tags runs lint,
   typecheck, tests and build, then publishes to GitHub Packages. The workflow
   arrives with the first release.
4. In each app, `npm install --save-exact @coenhallie/match-tracker@<version>`.
   Check the page shows the new `data-match-tracker-version`.
