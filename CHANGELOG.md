# Changelog

What changes for someone watching the tracker, release by release. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-11-02

Three fixes for replay pages, which video-annotation needs before it ships.
The pitch, the moments and the HUD are drawn as in 0.1.1, and the goldens and
snapshots are unchanged.

### What you see

- **Replay plays at the full frame rate.** While a replay plays, the
  tracker now draws in every display frame. Before, a page that fed it from
  its own animation frames had it drawing every other frame when no moment was
  running, so play looked less smooth than the video. Paused, in a hidden tab
  or scrolled out of view, it still draws nothing.
- **Pressing Play no longer ends a goal**, on pages that put their player
  controls over the pitch and mark them (below).

### For pages that embed it

- **`data-match-tracker-keep`.** A press anywhere in `tracker.overlay` still
  stops every moment, so what is drawn on is the data. A press inside an
  element in the overlay marked `data-match-tracker-keep` now leaves the
  moments running. Mark your own controls with it, such as a transport bar or
  a frame badge.
- **Replay feeding.** Keep calling `present()` on every tick of your clock, as
  before. While the last state you presented says `playing: true`, the
  tracker runs its own loop every display frame. A frame with nothing new
  costs one cheap update and draws nothing.
- **Vite.** On Vite 7, or any version whose dev server pre-bundles
  dependencies, add `optimizeDeps: { exclude: ['@coenhallie/match-tracker'] }`
  to the Vite config, or the dev server serves the app's HTML in place of the
  fonts and the pitch falls back to system fonts. Builds were never affected.
  The README's Bundlers section says so now.

### Size

- The widget is 33.6 kB gzipped (budget 60 kB). The Vue component adds 1.4 kB,
  and the fonts are still 81.7 kB.
- Nothing in the draw path changed, so the drawing times of 0.1.0 stand.

## [0.1.1] - 2026-11-02

What a page needs to put its own content over the pitch, as video-annotation's
replay does. Nothing changes for someone watching the tracker: the pitch, the
moments and the HUD are drawn as in 0.1.0, and the goldens and snapshots are
unchanged.

### For pages that embed it

- **The overlay takes the page's CSS.** `tracker.overlay` is now a `div` in the
  host's light DOM, with `slot="overlay"`, projected into the pitch's box.
  Tailwind classes and Vue scoped styles apply to what is mounted in it, so a
  drawing layer with `absolute inset-0` fills the pitch and takes the pointer
  when it asks for it. In 0.1.0 the overlay was in the shadow root, where the
  page's CSS could not reach.
  - Pointer events are still off on the overlay itself, so pan and zoom work
    through it.
  - A press on anything in it still stops every moment.
  - It is the one node the widget adds to the host, and `destroy()` takes it
    out.
- **`tracker.box`** is the pitch's box, `{ left, top, width, height }`, in CSS
  px from the host's top-left corner. It is null until the widget has a size.
  A `box` event says when it changes.
- **`tracker.availability()`** says which moments `trigger` can play on the
  frame on screen (`{ goal, attack: { 0, 1 }, freeKick, throwIn }`), so demo
  buttons can be disabled before a press. An `availability` event says when it
  changes.
- **New exports:**
  - `REPLAY_LOOKBACK_S`, how many seconds of records to pass as `lookback`;
  - `DEFAULT_PERSON_COLORS`, the default colours, frozen;
  - the types `TrackerBox` and `MomentAvailability`.
- **Vue.** The component's default slot is rendered into the overlay. Its ref
  exposes `box` and `availability()`, both reactive, and it emits `box` and
  `availability`.

### Size

- The widget is 33.6 kB gzipped (budget 60 kB). The Vue component adds 1.4 kB,
  and the fonts are still 81.7 kB.
- Nothing in the draw path changed, so the drawing times of 0.1.0 stand.

## [0.1.0] - 2026-11-02

The first release: video-annotation's 2D replay as a widget of its own, for
this site's live matches and, next, for video-annotation itself.

### What you see

- The pitch, players and ball as the tracking data has them, in fixed colours:
  - home red and away blue;
  - goalkeepers yellow, ringed in their team's colour;
  - officials black.
- The moments, as in video-annotation:
  - a goal: the camera follows the shot into the net, then the GOAL card shows;
  - an attack: the attacking team's half is shaded, with its name;
  - a free kick: its banner stays up while play is stopped;
  - a throw-in: its banner slides in from the ball's side.
- The ball's trail, rings round the players near the ball, and distant players faded.
- Above the pitch, which team is attacking and which is defending.
- A layers menu to switch each of these on or off. Your choice is remembered.
- English or Chinese text. Chinese uses your system's Chinese font, and every
  label fits its card or row, down to a widget 160 px wide: below 260 px the
  attacking/defending row shows only the team names (the attacking team is still
  filled in its colour), and below 200 px it leaves out "vs" too.
- The same layout on a right-to-left page as on any other.

### What is new compared with video-annotation

- The page scrolls under a plain mouse wheel. Hold Ctrl or ⌘ to zoom, or pinch
  on a trackpad or touch screen. Double-click to reset.
- Live matches: frames are drawn as they arrive. A hidden tab or a widget
  scrolled out of view stops drawing, and catches up when you come back.
- After a reconnect, or when the stream starts again from the top, the widget
  picks up at once: nothing from before plays late, it never freezes on the
  last picture, and a goal's zoom is not left behind.
- A frame that fails to draw does not stop a moment that is playing. The error
  is reported once in the browser console.
- The layers menu covers nothing else on the page: while it is open, the rest
  of the page still takes clicks, and a click anywhere outside the menu, or the
  focus moving away, closes it. It closes with Escape only while you are using
  it, and that Escape does nothing else on the page.
- Screen readers hear the pitch as one picture, "Match tracker", and the layers
  as buttons that are pressed or not.
- A page that embeds the widget can hide the layers menu (`layersMenu: false`). The layers are then the same for every viewer, and nothing is kept.
- Long team names are cut short with "…". The full name is in the tooltip.

### For pages that embed it

- `locale` takes a language tag too: `'zh-CN'`, `'zh-TW'` and `'zh-Hans'` are
  Chinese, and a language the widget has no text for is English.
- The host must be a plain element without a shadow root of its own.
- `layersStorageKey` is fixed at mount, like `mode`.
- A Vue parent that renders inline objects as props again no longer undoes the
  viewer's layer choice.
- The tracker instance's type is `MatchTrackerInstance`, from both entries.
- On a page with a Content Security Policy, allow `img-src data:` and
  `font-src` for where the package's files are served (see the README).

### Size and speed

Measured on an Apple M4 Pro laptop, in headless Chrome 156 with GPU canvas
(Metal), at 1280×720 CSS px and a pixel ratio of 2 (a 2560×1440 bitmap):

- **Download:**
  - the widget is 33.0 kB gzipped (budget 60 kB);
  - the Vue component adds 1.0 kB;
  - the fonts are 81.7 kB, fetched once.
- **Drawing one frame:**
  - 0.16 ms on average over the 193 frames of a goal, drawn 5 times;
  - 0.6 ms at the 95th percentile, and 2.3 ms at most (target: under 4 ms);
  - 0.20 ms per frame when the GPU work is included.
- **A whole animation frame during a goal** (the replay's update and the
  draw): 1.0 ms on average and 2.2 ms at most.
- **On a phone profile** (375 px wide at a pixel ratio of 3, CPU slowed 4×),
  during a goal:
  - an animation frame takes 1.3 ms on average and 2.9 ms at most, against
    16.7 ms for 60 frames a second;
  - no frame was dropped. Headless Chrome shows 30 frames a second, and no gap
    between frames was longer than one of them (33.4 ms at most). The
    performance trace reports no dropped frame.
- **With the CPU slowed 4× at 1280×720 at 2x:** drawing one frame takes
  0.53 ms on average. 28 of 964 draws took between 4 and 6.5 ms.
