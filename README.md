# @coenhallie/match-tracker

A live 2D match tracker for football streams. It draws players, ball and the
match's moments (goals, attacks, free kicks, throw-ins) on a pitch, from the
tracking pipeline's frames, inside any element you give it. It is the 2D
replay from video-annotation, taken out of Vue: the same picture, timing and
behaviour for the same data, with zoom and pan, the attacking/defending row and
the layers menu.

- **Framework-free.** One function, `createMatchTracker`, and plain DOM. A thin
  Vue 3 component is a separate entry, `@coenhallie/match-tracker/vue`.
- **Contained.** Everything lives in a shadow root, except the overlay: one
  element in the host, for the host's own content over the pitch. Fonts and
  icons come with the package, so the widget needs nothing from the host page
  and leaves nothing in it.
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

- **The lookback.** `REPLAY_LOOKBACK_S` is how many seconds of records before
  `time` the phase row and the ball trail read: pass the records from
  `time - REPLAY_LOOKBACK_S` up to `time`. Fewer show less phase and trail than
  the reference does, and more are ignored.
- **Over the pitch.** Mount a drawing layer, a frame badge or a transport in
  `tracker.overlay`. It sits exactly over the pitch, and the page's CSS
  (Tailwind, Vue scoped styles) styles what is in it:

  ```ts
  const layer = document.createElement('div')
  layer.className = 'absolute inset-0 pointer-events-none' // pointer-events-auto while drawing
  tracker.overlay.append(layer)
  ```

  A layer that takes the pointer stops every moment on a press. Pan and zoom
  work through anything that leaves pointer events off.

  Your own controls in the overlay, such as a transport bar or a frame badge,
  can opt out: a press on an element marked `data-match-tracker-keep`, or on
  anything inside one, leaves the moments running, so pressing Play does not
  end a goal.

  ```ts
  transport.setAttribute('data-match-tracker-keep', '')
  tracker.overlay.append(transport)
  ```
- **Demo buttons.** Disable a moment's button while `tracker.availability()`
  says it cannot be played, and follow the `availability` event:

  ```ts
  const update = () => (goalButton.disabled = !tracker.availability().goal)
  update()
  tracker.on('availability', update)
  ```

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
  chosen in the menu. Props are compared by what they hold, so an inline
  object such as `:teams="{ home: { name: home } }"` that renders again with
  the same contents changes nothing. A new `:layers` with other contents does
  go over the viewer's choice in the menu, as `setOptions` does.
- `mode` is fixed for a tracker's life. Changing it makes a new tracker, and
  the slot's content moves into its overlay.
- The default slot is rendered into the tracker's overlay, so it lies over the
  pitch and is styled by the page's CSS and the parent's scoped styles:

  ```vue
  <MatchTracker ref="tracker" mode="replay">
    <DrawingCanvas class="absolute inset-0" :class="drawing ? 'pointer-events-auto' : 'pointer-events-none'" />
  </MatchTracker>
  ```

- The component emits `zoom`, `layers`, `moment`, `box` and `availability`.
  It emits `box` and `availability` at mount too, when a tracker starts with
  values other than the last ones emitted.
- The ref exposes `push`, `present`, `reset`, `trigger`, `availability()`,
  `overlay` and `box`. They do nothing until the component is mounted.
  `box` and `availability()` are reactive, so a template or computed that
  reads them follows them. Before mount and after unmount, `box` is null and
  nothing is available.
- All the types of the main entry are re-exported from `/vue`. There
  `MatchTracker` is the component, so the tracker instance's type is
  `MatchTrackerInstance`, a name both entries export.

## API

### `createMatchTracker(host, options): MatchTracker`

Mounts a tracker in a shadow root of its own on `host`, which must be a plain
element without one. It throws, and changes nothing, on a host that has a
shadow root of the page's own, or a tracker still mounted. A host a tracker was
destroyed on can have a new one.

| Member | |
|---|---|
| `push(message)` | Live: one websocket message. |
| `present(state)` | Replay: `{ time, playing, record, lookback }` at the host's clock. |
| `reset()` | Forget everything seen and end every moment. What comes next is a seek. The last picture stays until new data arrives. |
| `trigger(moment, team?)` | Play `'goal'`, `'attack'`, `'freeKick'` or `'throwIn'` now, on the frame on screen. `team` (0 home, 1 away, default 0) is for an attack. Returns false when the moment cannot be played on that frame (for example before the first frame, or a goal with no ball). |
| `setOptions(options)` | Change any option but `mode` and `layersStorageKey`, which are fixed at mount. The HUD and the canvas follow at once, without a remount. Options that throw change nothing. |
| `on(event, listener)` | Listen to an event. Returns a function that unsubscribes. |
| `availability()` | Which moments `trigger` can play on the frame on screen: `{ goal, attack: { 0, 1 }, freeKick, throwIn }`, each a boolean (`MomentAvailability`). All false before the first frame and after a reset. A goal needs a ball, and an attack needs the direction that team attacks in, which needs the keepers. A fresh copy on every call. |
| `overlay` | An element over the pitch, in the canvas's own box, for a host's drawing layer and anything it anchors to the pitch. It is a `div` child of the host, with `slot="overlay"`, so the page's CSS reaches it and its content. Its inline style fills the box and turns pointer events off. Pointer events pass through it unless you turn them on for your own elements. A press on it, or on anything in it, stops every moment, except inside an element in it marked `data-match-tracker-keep` (your transport, a frame badge). |
| `box` | `{ left, top, width, height }`, the canvas's box in CSS px from the host's top-left corner, below the attacking/defending row (`TrackerBox`, frozen). Null until the widget has been laid out with a size, and after `destroy()`. |
| `version` | The package version this tracker runs. |
| `destroy()` | Stop everything, empty the shadow root and take the overlay out of the host, with whatever you mounted in it. Every method is a no-op after. |

Also exported:
- `MATCH_TRACKER_VERSION`;
- `parseRecord(message): TrackerRecord | null`;
- `REPLAY_LOOKBACK_S`, the seconds of records a replay host passes as `lookback`;
- `DEFAULT_PERSON_COLORS`, the default `fill`, `outline` and `text` per role, frozen;
- the types: `MatchTrackerOptions`, `SettableOptions`, `MatchTrackerInstance`, `ReplayState`,
  `TrackerEvents`, `TrackerBox`, `MomentAvailability`, `TrackerRecord`, `Frame`, `ReplayLayers`,
  `ReplayMoment`, `TrackerText`, `TrackerTextOverrides`, `PersonColors`, `PersonRole` and the rest.

### Options

| Option | Type | Default | |
|---|---|---|---|
| `mode` | `'live' \| 'replay'` | (required) | Fixed at mount. |
| `locale` | `'en' \| 'zh'`, or a language tag | `'en'` | The built-in text. A tag is read by its language: `'zh-CN'`, `'zh-TW'` and `'zh-Hans'` are `'zh'`, `'en-GB'` is `'en'`. Anything else is English. |
| `text` | `TrackerTextOverrides` | | Any string, in place of the locale's. In `layers`, any `label` or `hint` of any layer: what you leave out stays the locale's. |
| `teams` | `{ home?: { name?, color? }, away?: { name?, color? } }` | | Team 0 is home and team 1 is away. A name defaults to the localised "Red" and "Blue". A `color` is the team's fill, on its players, its attack and its label. |
| `colors` | `Partial<Record<PersonRole, Partial<PersonColors>>>` | video-annotation's | `fill`, `outline` and `text` per role: `home`, `away`, `goalkeeper`, `official`, `unknown`. A team's `color` wins over `fill` here. |
| `layers` | `Partial<ReplayLayers>` | all on | The layers shown until the viewer chooses in the menu. |
| `layersMenu` | `boolean` | `true` | `false` takes the layers button and menu out. The layers are then the defaults over `layers`, and nothing is read from or written to `layersStorageKey`. Can be changed with `setOptions`. |
| `layersStorageKey` | `string \| null` | `'match-tracker.layers'` | Where the menu's choice is kept in `localStorage`. `null` keeps nothing. A kept choice wins over `layers`. Fixed at mount, like `mode`: `setOptions` ignores it, and so does the Vue component when the prop changes. To keep the choice somewhere else, make a new tracker. |
| `formatAction` | `(actionType: string) => string` | as it comes | The bottom-left text for each of a frame's actions, from its `action_type` (for example `'EventType.FREE_KICK'` to `'Free kick'`). |

The layers are `goal`, `attack`, `freeKick`, `throwInBanner`, `ballTrail`,
`phaseLabels`, `nearbyRings`, `farFade` and `ringFades`.

The `TrackerText` keys are:
- on the canvas: `goal`, `freeKick`, `throwIn`, `attack`;
- the row: `attacking`, `defending`, `versus`, `phaseTooltip`, `red` and `blue` (the default team names);
- ARIA templates: `phaseAttackingAria` and `phaseDefendingAria` (with `{team}`), and `phaseAria` (with `{home}` and `{away}`);
- the menu: `layersButton`, `layersTooltip`, `layersMenuLabel`, and `layers` (`{ label, hint }` per layer);
- the zoom: `zoomLevel` (with `{zoom}`) and `zoomReset`;
- for screen readers: `pitchLabel`, the pitch's name ("Match tracker").

### Events

| Event | Value | When |
|---|---|---|
| `zoom` | `{ zoom }` | The view's zoom changed, by the viewer or by a goal's camera. |
| `layers` | `ReplayLayers` | The layers in force changed, from the menu or from `setOptions`. |
| `moment` | `{ moment, phase: 'start' \| 'end' }` | A moment came on screen, or went. |
| `box` | `TrackerBox` | The pitch's box moved or changed size. The box measured at mount is not sent, because no listener exists yet: read `tracker.box` for it. |
| `availability` | `MomentAvailability` | What can be played changed: a new frame, or a reset. |

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
  and keep their full names in the tooltip and for screen readers. Below 260 px
  wide the row drops the words "Attacking" and "Defending" (the attacking team
  is still filled in its colour, and screen readers still hear both), and below
  200 px it drops "vs" too.

## Embedding

The widget is built to sit in pages we do not control, next to their own
scripts and styles, several times on one page.

- **Contained.**
  - All DOM and CSS live in one shadow root under the host element, except the
    overlay. The stylesheet is adopted, not injected, so nothing goes into
    `document.head`.
  - The overlay is the one light-DOM node the widget adds to its host: a
    `div` with `slot="overlay"`, projected into the pitch's box, and removed
    on `destroy()`. It is in the light DOM so that the page's CSS reaches what
    the host mounts in it. Its own inline style (position, size, margins,
    pointer events) holds against the page's rules for divs. Its content
    inherits text properties (font, colour, line height) from the widget, not
    from the page, but every page rule that targets it applies. It stacks
    under the widget's row, layers menu and zoom badge.
  - Any other child of the host is not shown, as before.
  - The page gets only the `FontFace` registrations, made once however many
    widgets there are.
  - Host CSS cannot reach in, except into the overlay, and the widget's CSS cannot leak out. Lengths
    are in px, not rem, so even the page's root font size stays outside.
  - There are no globals, no polyfills and no network requests: fonts and icons are in the bundle.
- **Listeners outside the widget:**
  - the resolution media query and the reduced-motion query;
  - one `visibilitychange` listener on the host's document, to stop drawing in a hidden tab;
  - while the layers menu is open, and only then, one `pointerdown` listener on the
    host's document, so a press on the page closes the menu. It listens in capture,
    and never stops or cancels the press, which goes on to the page as it would have.

  All are removed on `destroy()`. No other listener goes on `document` or `window`.
- **Left to right** on a right-to-left page too: the HUD and the canvas text keep
  their layout whatever `dir` the page sets.
- **Stacking.** The widget is a stacking context of its own, so nothing in it
  competes with the page's `z-index`.
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
  - Escape closes the layers menu only while focus is inside the widget, and the page
    does not get that Escape too.
  - A press anywhere outside the layers menu, on the pitch or on the page, closes it.
    So does the focus leaving it. Nothing covers the page while it is open.
- **Reduced motion** is honoured, in every branch where video-annotation honours it.

### Content Security Policy

On a page with a Content Security Policy, the widget needs:
- `img-src data:`, for the free kick and goal cards' icons, which are SVG `data:` URLs
  drawn through an `Image`. Without it the cards are drawn without their icons.
- `font-src` for wherever the package's files are served from: the fonts are
  woff2 files next to `dist/index.js`, loaded with `FontFace`. Bundled into your app
  that is usually `'self'`; from a CDN, that CDN's origin. Without it the text falls
  back to the system fonts.
- Nothing for `style-src`: the stylesheet is a constructed one, adopted by the
  shadow root, which a policy does not block, and every other style is set through
  the CSSOM, the overlay's included. No `'unsafe-inline'` is needed.
- Nothing else: no `connect-src`, `worker-src` or `'unsafe-eval'`. The widget makes
  no requests of its own.

This was checked in Chrome with `default-src 'none'; script-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'`,
with no violation reported.

### Bundlers

The package is ES modules with `.d.ts` types, and resolves under TypeScript's
`bundler`, `node16` and `nodenext` module resolution. The fonts are referenced
with `new URL('./font.woff2', import.meta.url)`, which bundlers copy as assets:
this was checked with Vite 8 (build and dev server) and webpack 5. Without a
bundler, serve the whole `dist` folder, so the fonts sit next to `index.js`.

On Vite 7, or any version whose dev server pre-bundles dependencies, exclude
the package from pre-bundling. Pre-bundled, its code is served from
`node_modules/.vite/deps`, where the fonts are not, so the dev server answers
the font requests with the app's HTML and the pitch falls back to system
fonts. Builds are not affected.

```js
// vite.config.js
export default defineConfig({
  optimizeDeps: { exclude: ['@coenhallie/match-tracker'] },
})
```

### Browsers

The code is ES2022. The oldest browsers it runs in are set by the platform
features it uses:
- Chrome and Edge 105 (container queries);
- Firefox 112 (canvas `roundRect`);
- Safari 16.4, on macOS and iOS (`OffscreenCanvas` with a 2D context).

The other newer APIs the code calls are older than these: `Array.prototype.at`,
`Object.hasOwn` and `structuredClone` (Chrome 98, Firefox 94, Safari 15.4 at the latest).

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
one in replay. It has a button for every moment, disabled while the moment
cannot be played, a locale toggle, a width selector and a "hostile CSS" switch.
A badge styled by the page's stylesheet sits in each overlay, showing the box. `window.demo` holds the hooks the
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
   date and the measured size and performance, and commit the changelog.
   `npm version` refuses to run with uncommitted changes, and its commit holds
   only `package.json` and `package-lock.json`, so the changelog has to be in
   a commit of its own first.
2. `npm version <major|minor|patch>`. This sets the version in
   `package.json`, which the build injects as `MATCH_TRACKER_VERSION`, then
   commits and tags `v<version>`.
3. `git push --follow-tags`. The GitHub Actions workflow on `v*` tags runs lint,
   typecheck, tests and build, checks the tag equals `v` plus the `package.json`
   version, then publishes to GitHub Packages.
4. In each app, `npm install --save-exact @coenhallie/match-tracker@<version>`.
   Check the page shows the new `data-match-tracker-version`.
