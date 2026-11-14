# @coenhallie/match-tracker

A live 2D match tracker for football streams. It draws players, ball and the
match's moments (goals, attacks, corners, free kicks, throw-ins, penalties, fouls, shots and headers on goal, VAR checks, disallowed goals, half time, second half, full time) on a pitch, from the
tracking pipeline's frames, inside any element you give it. It is the 2D
replay from video-annotation, taken out of Vue: the same picture, timing and
behaviour for the same data, with the attacking/defending row and the layers
menu. Unlike video-annotation's, the view has no zoom or pan of its own: only
the animations (a goal's camera, the zoom near goal) move it. The corner is the widget's own, as video-annotation has none,
and so are the free kick, the VAR check, the goal disallowed, the half time, the second half, the full time, the penalty, the foul, the shot and header on goal, the goal on a penalty scored (with the penalty's layer off), the goal's scorer and the attack shown over a player loss.
video-annotation's own free kick, a card across the middle, isn't shown.

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

  A layer that takes the pointer stops every moment on a press.

  Your own controls in the overlay, such as a transport bar or a frame badge,
  can opt out: mark them `data-match-tracker-keep`. A press on such an element,
  or on anything inside one, leaves the moments running, so pressing Play does
  not end a goal.

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

- The component emits `zoom`, `layers`, `moment`, `box`, `availability`, `secondHalf` and `flashback`.
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

### Console banner

The widget never prints a banner on its own. To show the widget's version in
the browser's developer console as a small pitch, call
`logMatchTrackerBanner()` once from your app's entry, and import it from
`@coenhallie/match-tracker/banner`:

```ts
import { logMatchTrackerBanner } from '@coenhallie/match-tracker/banner'

logMatchTrackerBanner()
```

- **Import it from `/banner` at your entry, not from the main entry.** The main
  entry is the whole widget in one module, so importing even the banner from it
  pulls the whole widget into the chunk that imports it. An app entry runs on
  every page load, and if your widget is otherwise loaded lazily, on one view
  only, that puts it in your entry chunk and on every page. `/banner` is about
  1 kB gzipped and imports nothing, so your entry stays small and the widget
  still loads only where you mount it.
- The main entry and `/vue` export the same two functions, for code that already
  imports them. They are the same functions as `/banner`'s, with one guard
  between them.
- It prints once per page, however many times it is called, from whichever
  entries, so calling it from every component that mounts a tracker is fine.
- On the server (SSR), or without a console, it does nothing.
- `matchTrackerBanner()` returns the same art as plain text, without colours.

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
| `reset()` | Forget everything seen and end every moment. What comes next is a seek. The last picture stays until new data arrives. In live mode the clips kept for replays go too, and a replay playing ends, with a `flashback` `end` (see [Flashbacks](#flashbacks)). |
| `trigger(moment, team?)` | Play `'goal'`, `'attack'`, `'corner'`, `'freeKick'`, `'throwIn'`, `'penalty'`, `'penaltyScored'`, `'penaltyMissed'`, `'varCheck'`, `'goalDisallowed'`, `'halfTime'`, `'secondHalf'`, `'fullTime'`, `'foul'`, `'shotOnGoal'`, `'headerOnGoal'`, `'yellowCard'`, `'redCard'` or `'substitution'` now, on the frame on screen. `team` (0 home, 1 away, default 0) is for an attack, and for a card, a substitution, a corner, a free kick, a goal disallowed or a penalty the team it names (a corner, a free kick and a goal disallowed name the team their label on screen gives first). By hand, `'penalty'` waits a few seconds for a kick that does not come, and `'penaltyScored'` and `'penaltyMissed'` play the kick at once. Returns false when the moment cannot be played on that frame (for example before the first frame, or a goal with no ball). |
| `setOptions(options)` | Change any option but `mode` and `layersStorageKey`, which are fixed at mount. The HUD and the canvas follow at once, without a remount. Options that throw change nothing. |
| `on(event, listener)` | Listen to an event. Returns a function that unsubscribes. |
| `availability()` | Which moments `trigger` can play on the frame on screen: `{ goal, attack: { 0, 1 }, corner, freeKick, throwIn, penalty, penaltyScored, penaltyMissed, varCheck, goalDisallowed, halfTime, secondHalf, fullTime, foul, shotOnGoal, headerOnGoal, yellowCard, redCard, substitution }`, each a boolean (`MomentAvailability`). All false before the first frame and after a reset. A goal needs a ball, and an attack needs the direction that team attacks in, which needs the keepers. A fresh copy on every call. |
| `overlay` | An element over the pitch, in the canvas's own box, for a host's drawing layer and anything it anchors to the pitch. It is a `div` child of the host, with `slot="overlay"`, so the page's CSS reaches it and its content. Its inline style fills the box and turns pointer events off. Pointer events pass through it unless you turn them on for your own elements. A press on it, or on anything in it, stops every moment, except inside an element in it marked `data-match-tracker-keep` (your transport, a frame badge). |
| `box` | `{ left, top, width, height }`, the canvas's box in CSS px from the host's top-left corner, below the attacking/defending row (`TrackerBox`, frozen). Null until the widget has been laid out with a size, and after `destroy()`. |
| `version` | The package version this tracker runs. |
| `destroy()` | Stop everything, empty the shadow root and take the overlay out of the host, with whatever you mounted in it. Every method is a no-op after. |

Also exported:
- `MATCH_TRACKER_VERSION`;
- `logMatchTrackerBanner()` and `matchTrackerBanner()`, the opt-in console banner (see Console banner), also from `/vue` and, alone and tiny, from `/banner`;
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
| `momentLocale` | `'en' \| 'zh'`, or a language tag | `locale` | The language of the words the moments write on the canvas: the cards' titles and texts, and the word under the team's name in the attack's label. Read as `locale` is. For keeping them in one language while the HUD follows `locale`, for example English until a translation is approved. `text` overrides them as it does the rest. Can be changed with `setOptions`. |
| `text` | `TrackerTextOverrides` | | Any string, in place of the locale's. In `layers`, any `label` or `hint` of any layer: what you leave out stays the locale's. |
| `teams` | `{ home?: { name?, color?, players? }, away?: { name?, color?, players? } }` | | Team 0 is home and team 1 is away. A name defaults to the localised "Red" and "Blue". A `color` is the team's fill, on its players, its attack and its label. `players` names the team's players by shirt number, `{ 9: 'Name' }`, for the cards and the substitutions; a player with no name here is shown by the name the labeller gave, if any, and otherwise by the number ("#9"). |
| `colors` | `Partial<Record<PersonRole, Partial<PersonColors>>>` | video-annotation's | `fill`, `outline` and `text` per role: `home`, `away`, `goalkeeper`, `official`, `unknown`. A team's `color` wins over `fill` here. |
| `layers` | `Partial<ReplayLayers>` | all on | The layers shown until the viewer chooses in the menu. |
| `layersMenu` | `boolean` | `true` | `false` takes the layers button and menu out. The layers are then the defaults over `layers`, and nothing is read from or written to `layersStorageKey`. Can be changed with `setOptions`. |
| `layersStorageKey` | `string \| null` | `'match-tracker.layers'` | Where the menu's choice is kept in `localStorage`. `null` keeps nothing. A kept choice wins over `layers`. Fixed at mount, like `mode`: `setOptions` ignores it, and so does the Vue component when the prop changes. To keep the choice somewhere else, make a new tracker. |
| `formatAction` | `(actionType: string) => string` | as it comes | The bottom-left text for each of a frame's actions, from its `action_type` (for example `'EventType.FREE_KICK'` to `'Free kick'`). |
| `aiLabels` | `boolean` | `false` | Whether the bottom-left action text lists the pipeline's AI labels too. Off, it lists only the labels a human gave, the ones the moments play on (see [Labels](#labels)). For developers, like `layersMenu`. Can be changed with `setOptions`. |
| `secondHalfFrom` | `number \| null` | `null` | When the second half starts, as the host knows it: a record time (`TrackerRecord.t`, the pipeline's own timestamp, in seconds), as the `secondHalf` event says it. From it on the teams are shown at the other ends, as from a half label the widget sees (see [The teams change ends](#the-teams-change-ends)). Kept through `reset()`. Anything but a finite number counts as `null`. Can be changed with `setOptions`. |
| `debug` | `boolean` | `false` | Developer mode. A red badge, top left of the pitch, while fewer than 18 players are tracked on the frame on screen: how many are, and whose attack covers the loss when one does (see [Player loss](#player-loss)). In live mode it also says when the frame on screen is invalid (see [Invalid frames](#invalid-frames)), and which replay plays while one does (see [Flashbacks](#flashbacks)). For telling a real attack from one shown over lost players or invalid frames. Can be changed with `setOptions`. |

The layers are `goal`, `goalZoom`, `attack`, `playerLoss`, `flashback`, `corner`, `freeKickBanner`, `throwInBanner`, `penalty`,
`varCheck`, `goalDisallowed`, `halfTime`, `secondHalf`, `fullTime`, `foul`, `shotOnGoal`, `headerOnGoal`, `yellowCard`, `redCard`, `substitution`, `ballTrail`, `ballShadow`, `phaseLabels`, `nearbyRings`, `farFade` and `ringFades`.

#### Labels

The goal, the corner, the free kick, the throw-in, the penalty, the VAR check, the goal disallowed, the
half time, the second half, the full time, the foul, the shot and header on goal, the yellow and red cards and the substitutions play when playback runs into the pipeline's label for them, in a frame's `state.actions`, and only when a
human gave it: its `action_origin` is `"human"`. A label from the pipeline's
AI (`"ai"`), or one from an older export with no `action_origin`, plays
nothing. The bottom-left action text follows the same rule: it lists only the
human labels, unless `aiLabels` is on, when it lists every label as the export
has it. A moment played with `trigger` needs no label at all.

A human's label goes before the attack, the attack over a player loss and a
replay: whatever moment it plays, the attack showing goes and none starts while
it shows, and in live mode a replay playing ends and none starts. A goal waiting
for its scorer counts as showing. video-annotation's throw-in shows alongside an
attack; the widget's does not.

A label matches however it is written: case is ignored, spaces, underscores
and hyphens count the same, and a dotted prefix is dropped. `VAR check`,
`var check`, `VAR_CHECK` and `EventType.VAR_CHECK` are all the VAR check's label.
A label is matched whole, so no goal plays on a `Goal disallowed`.
A penalty has a label for the penalty given, `Penalty`, matched whole, and one for
its result: `Penalty scored` (as the labelling tool sends it, or `PENALTY_SCORED`,
`PenaltyScored`), `Penalty goal`, `Penalty kick scored`, `Penalty kick goal` or
`Scored penalty`, and `Penalty missed` (or `Missed penalty`, `Penalty kick missed`).
They play the penalty (see [The penalty](#the-penalty)). With the `penalty` layer
off, a penalty scored is a goal, and the goal plays on it as on `Goal`.
A corner's label names the corner it lights up, as the labelling tool sends it:
`Corner kick - Top left`, `Corner kick - Top right`, `Corner kick - Bottom left`
and `Corner kick - Bottom right`, the corner as the camera sees it from its
touchline. Where the ball is plays no part. A corner label that names no corner
(`Corner`, `Corner kick`, `EventType.CORNER_KICK`) shows the card alone, as does
a corner played with `trigger` unless the frame on screen carries a label that
names one. Under the card, the name of the team taking it, when its label gives
the team (see [A label's team](#a-labels-team)). The exports' labels give none,
and show no team.
Played with `trigger('corner', team)`, it names the team the label on screen
gives, else `team`.
A free kick's label is the labelling tool's `Freekick`, or `Free kick` written in
any of the ways above (`FREE_KICK`, `EventType.FREE_KICK`).

#### A label's team

The cards, the substitutions, the corner, the free kick, the goal disallowed, the
penalty and the goal's scorer name the team their label gives, as the labelling
tool sends it with each label since 2026-11.

- **Its side**, home or away, is the label's `is_home` (`1` or `0` on a label
  about a player, `"home"` or `"away"` on a game label), on a label that names a
  team (a `team_id` or a `team_name`); else its `team_id` when that is `0` (home)
  or `1` (away). Staging's `team_id` is the side; production's is the team's id
  in its backend, which says none, so there the side is `is_home`'s. A label that
  names no team has no side, whatever its `is_home` says: production writes `0`
  on its `Kick off`. The side groups a team's substitutions on one card, pairs a
  scorer with their goal, and looks the player up in the `teams` option.
- **Its name** is the host's for that side, in the `teams` option, else the
  label's own (`team_name`, the labelling tool's name for the team), else "Red"
  or "Blue". A label with a name and no side shows its name.
- The stream sends `is_home` and `team_name` only in the label's `raw_data`
  (`human_label.items`), and the widget reads them from there.

#### The scorer

The labelling tool labels a goal twice: `Goal` (or, with the penalty's layer off,
`Penalty scored`), which gives the team (`team_id`), and a few seconds later
`Player scored`, from the scorer's
row, which gives the player (`team_id`, `player_number` and, in the label's
`raw_data`, `player_name`). Once the scorer is known, the goal names them under
its banner, in a band across the foot of the pitch: the scorer's icon and name,
and their team's name under it. The scorer's name is their name in the `teams`
option's `players`, else the label's, else their shirt number; the team is named
as for every label (see [A label's team](#a-labels-team)). The band comes and goes with
the "GOAL" banner. video-annotation has no scorer.

- **A goal with its scorer lasts 6 s** (`SCORED_GOAL_MS`), where a goal alone
  lasts video-annotation's 3.2 s: the shot is the same, and the banner, the band
  and the view in on the goal hold until the last 0.6 s, so the scorer and their
  team are up in full for about 4.7 s. A scorer who comes while their goal plays,
  before it starts to close (2.6 s in), makes it last 6 s too. One who comes
  later is too late to read, and is not shown.

- **Live, a goal waits for its scorer**, up to 6 s of the stream's clock, and
  plays when they come, with them under it. With no scorer by then, it plays
  without. The shot is the one on the goal's record: by the scorer's, the ball
  has gone on. As it is labelled, a human's label going first, the attack (and
  the attack over a player loss) showing goes and none starts while it waits,
  and a replay playing ends and none starts (see [Flashbacks](#flashbacks)).
- **In replay** the goal plays on its label, as video-annotation's does.
- Either way, a scorer whose label comes while their goal plays, before it
  starts to close, is named under it, fading in. One that comes later is not
  shown. Live, that leaves the labeller about 8.6 s from the goal's label: the
  6 s wait, and 2.6 s into the goal; in replay, 2.6 s.
- A scorer is only ever shown under a goal: one with no goal waiting or playing
  plays nothing, as the labelling tool gives a scorer only after a goal. So does
  one after a penalty scored that the penalty played.
- A scorer is the scorer of the goal they follow, whatever team the goal's label
  gives, and is named with the team on their own label. The labeller picks them
  from their team's row, but not the goal's team: production has given a goal
  one team and its scorer the other.
- `Player Own Goal` names the conceding team's player, and plays nothing.
- A goal played with `trigger('goal')` names no scorer.

#### Free kick

On a free kick label (the `freeKickBanner` layer, on by default), the ball's spot
is marked and the other half shaded, and "FREE KICK" and its icon show on a card
in the middle of that half, with the team taking it under the card.
- The spot is where the ball was as the label came: the ball on the labelled
  record, or, with none tracked there, the last one tracked in the 5 s before it.
  It stays there as play goes on, marked by three rings lighting up one after
  another from the middle out. With no ball known, the card shows alone across
  the middle of the pitch, with nothing shaded.
- The half without the ball is shaded in the pitch's dark green, up to the
  halfway line, and the card sits in the middle of that half.
- The team is the one its label gives (see [A label's team](#a-labels-team)). A
  label without one shows no team.
- Everyone on the pitch, the ball and its trail fade out as it fades in, as for a
  corner, and back as it goes.
- It is held as the corner is: it fades in over 0.4 s, stays for at least 2 s and
  then for as long as the label is on or play is stopped, and fades out over 0.4
  s. It plays once for each run of the label, which has to be off for 15 s of
  replay time to count as a new one.
- A goal or the penalty takes over from it. A corner takes over from it, and it
  from a corner: the latest shows. It takes over from an attack, the attack over a player loss, a
  throw-in and a label card, and holds them off while it shows.
- Played with `trigger('freeKick', team)`, it is on screen for 4 s, at the ball on
  screen, and names the team the label on screen gives, else `team`.
- The layer is `freeKickBanner`, not `freeKick`: video-annotation's free kick had
  a `freeKick` layer, which a browser may still keep switched off.

#### The penalty

On a penalty label (the `penalty` layer, on by default), the widget follows the
penalty from the moment it is given to the moment it is decided, from the
match-summary design (viewport/eventPenalty and the frames after it). The
widget's own: video-annotation has none.
- **The card.** On `Penalty`, "PENALTY" and its icon, a goal with a keeper and
  a ball, show on the dark band across the middle of the pitch, with the team
  taking it under the band, as the VAR check's card shows, everyone on the pitch
  and the ball faded out. It is up for 2.4 s.
- **Waiting.** Then a scene of its own fades in over the card, over 0.5 s, and
  covers the pitch in green, with the design's fine grain and no markings: the
  goal, the keeper swaying from side to side on his line, and the ball turning
  on the spot, with "PENALTY.." and the team at the top right. It waits there for the kick, however long it takes.
- **The kick.** On `Penalty scored`, the ball curls into the top corner past the
  keeper's late dive, and "SCORED!" rises in at the foot. On `Penalty missed`,
  the keeper dives as the ball curls over the bar and on, fading out, and
  "MISSED!" rises in: the label does not say whether the keeper saved it or it
  went wide, so a miss always goes over. The kick takes 0.7 s; the scene holds
  for 3 s after the banner is in, then fades out over 0.6 s, and the live pitch
  is back.
- A result that comes during the card waits for it, and the scene goes straight
  into the kick. A result with no penalty showing (another label ended the wait,
  or the widget joined after the `Penalty`), or as one with no result fades out,
  brings the scene in with no card, kicks as soon as it is in, and names the
  result's team.
- **Any other human label ends the wait**, during the card or the scene: the
  penalty fades out over 0.6 s while that label's own moment comes in (a corner,
  a throw-in, a label card, the yellow and red cards and the substitutions
  alike). A yellow or red card or a substitution still waiting its turn from
  before takes the place of a throw-in or a small card that ended the wait,
  which then does not show, as everywhere; a corner, a free kick or another
  label card still comes first, and the waiting card after it. A label on the `Penalty`'s own record, an AI label, or one that
  stays on from before the `Penalty` does not count. The labelling tool's Cancel
  sends nothing, so a penalty given and taken back waits until the next label.
- **The team** is the one the `Penalty` label gives (see [A label's
  team](#a-labels-team)), whatever team its result gives: production has given
  the two different teams. A label without one shows no team.
- A second `Penalty` while one shows starts it again from the card, with its
  team. A second result is ignored.
- **A penalty scored plays no goal** while the layer is on: not the goal, nor
  the wait for the goal's scorer, and a `Player scored` after it plays nothing.
  With the layer off, it plays the goal, as on `Goal`. Switching the layer off
  while the penalty shows ends it at once.
- A goal takes over from it, and none of its labels plays while a goal is
  showing: a `Penalty`, `Penalty scored` or `Penalty missed` then plays nothing,
  then or after the goal (a goal waiting for its scorer does not hold them
  back). It takes over from an attack, the attack over a player loss, a corner,
  a free kick, a throw-in and any label card. While it waits, no attack or
  player loss cover starts. Once its result is in, it plays out its kick and
  hold whatever comes: nothing starts over it, and the yellow and red cards and
  the substitutions wait their turn. As it fades out at the end, whatever is due
  comes in under it. Live, a replay playing ends, and none starts while it
  shows. The zoom near goal eases
  out to the whole pitch while it shows, and back in after.
- It plays the labels as they come, live and in replay alike. A pause, a seek,
  a step or a press on the pitch ends it, as it ends every moment.
- **In a replay** (see [Flashbacks](#flashbacks)) none of its labels plays
  anything: the viewer saw the penalty live, and the clip shows the kick as it
  was played on the pitch. With the layer on, a `Penalty scored` in a clip plays
  no goal either; with it off, it plays the goal, as live.
- **Played by hand**, `trigger('penalty', team)` plays the card and the scene
  waiting, which goes after 4 s, or sooner on another label during playback;
  `trigger('penaltyScored', team)` and
  `trigger('penaltyMissed', team)` play the scene with that kick at once, with no
  card. Each names `team`.
- **With reduced motion** nothing fades, the ball does not turn and the keeper
  does not sway: the card shows whole, then the scene whole, and a result shows
  the kick's end, the keeper diving and the banner in, for 3 s, then goes.
- The `moment` events are `penalty`, from its start to its end, and
  `penaltyScored` or `penaltyMissed`, from its result's label to the same end.

#### Throw-in

On a throw-in label (the `throwInBanner` layer, on by default), "THROW IN" shows
in one of two ways.

- **Play goes on on camera:** the small band along the bottom touchline, for
  2 s, the players left as they are.
- **The camera cuts away:** live, when the record the throw-in is labelled on is
  invalid, or its lookahead says an invalid one is due within 3 s, "THROW IN"
  and its icon show on a card across the middle, with the team under it (see
  [A label's team](#a-labels-team)), and a pulse on the touchline where the ball
  went out, as everyone on the pitch and the ball fade out. Where it went out is
  the ball on the labelled record, or the last one tracked in the 5 s before,
  on the touchline nearest it; with no ball known, the card shows alone. It
  stays for at least 2 s, and after that while the camera is away, or the
  cutaway it was shown for is still to come, up to 3 s after the label; it
  fades out as the camera is back. No replay plays while it shows.
- Replay data says nothing of which frames are valid, so in replay mode the
  throw-in is always the band, as video-annotation's is.
- It plays once for each run of the label, which has to be off for 5 s to count
  as a new one. A goal, a corner or the penalty takes over from it.

#### VAR check, goal disallowed and second half

These are the same card, a title over an icon or a short text on a dark band
across the middle of the pitch, each with a layer of its own, on by default: "VAR
CHECK" and an eye on a VAR check label (`varCheck`), "GOAL DISALLOWED" and a
struck-through goal on a goal disallowed label (`goalDisallowed`), and "SECOND
HALF" and a short text, `secondHalfText` in `TrackerText`, on a second half label,
written `second half`, `Start second half` or in any of the ways above
(`secondHalf`). Each:
- It fades in over 0.4 s, stays for at least 2 s and then for as long as the
  label is on, and fades out over 0.4 s. Played with `trigger`, it is on screen
  for 4 s.
- It plays once for each run of the label, however the label flickers: the
  label has to be off for 15 s of replay time to count as a new one.
- A goal, a corner, a free kick or the penalty takes over from it, and it does
  not go over any of them. It waits for them instead: if the label is still on when they end, it plays
  then. It takes over from an attack, the attack over a player loss and a
  throw-in, and holds them off while it shows.
- The latest card takes over from another: a goal disallowed replaces the VAR
  check before it, with no gap in the band. On a frame with both labels, the
  goal disallowed plays.
- The goal disallowed names the team under the band, as the corner does, when
  its label gives the team (see [A label's team](#a-labels-team)). A label
  without a team shows the card alone. Played with `trigger('goalDisallowed', team)`, it names the team
  the label on screen gives, else `team`.

#### Half time and full time

The same card, with a title and a short text in place of the icon: "HALF TIME" on
a half time label, written `half time`, `Halftime`, `End first half`, `End FirstHalf`
or in any of the ways above (the `halfTime` layer), and "FULL TIME" on a full time
label, written `full time`, `Fulltime`, `End second half`, `End SecondHalf` or
likewise (the `fullTime` layer), each on by default. Their texts are
`halfTimeText` and `fullTimeText` in `TrackerText`, broken into lines at each line
break and to fit.

It does not time out. It stays until a human gives any other label, then fades
out over 0.4 s, and that label's own moment, if it has one, plays as it goes:
- A label from the pipeline's AI doesn't end it, nor does its own label, nor a
  label already on as it started, unless that goes off and comes back later.
- So a second half that starts with no human label plays on under the half time's
  card, until the first one.
- While it shows, it holds back attacks, the attack over a player loss and
  throw-ins, as the cards above do.
- A pause doesn't end it, nor does coming back to a hidden tab or a widget
  scrolled away. A seek does, and a press on the pitch, as for every moment, and
  so does switching off its layer. It doesn't come back after that.
- A label that comes and goes while the tab is hidden isn't seen, as for every
  moment, so it stays until the next one.
- It draws nothing while it rests, so a long break costs nothing.
- Everyone on the pitch, the ball and its trail fade out as it fades in, as for
  a corner, and back as it goes. Zoomed in, it stays whole, on the frame where
  the whole pitch has it.

#### The teams change ends

From the first human half time or second half label on, written in any of the
ways above, the teams are shown at the other ends: every player and the ball
turned half round the centre spot, so a team's far touchline becomes its near one,
as it does in the stadium. Their height is kept.
- Whichever of the two labels comes first starts it. Neither turns the pitch back,
  so both labels, or one twice, turn it once. A label from the pipeline's AI, or
  one without an origin, turns nothing.
- Everything goes by the turned frames: the attacking direction, the goal a goal
  goes in, the throw-in's side, the free kick's spot, the ball trail and the zoom near goal. The corner
  a corner's label names is turned with them, as the camera that the labeller
  names it by stays on its touchline. A frame's phase and trail are worked out from its window turned as it is,
  so they never read across the turn.
- The turn happens under the half time's or the second half's card, so the jump
  to the other ends is not seen. It happens with their layers off too.
- The widget remembers the time of the label it saw, and turns every frame from
  then on, however it gets there: playing, or seeking back or forward. A seek
  back before it shows the first half as it was.
- On its own it only knows of labels it has seen. A replay seeking into the
  second half without having played past either label (or having it within
  `lookback`), or a live widget joined or `reset` after both, shows the second
  half as the pipeline sends it.
- So the host can tell it: the `secondHalf` event says where a label the widget
  saw starts the second half, and the `secondHalfFrom` option gives that back.
  A host that keeps it for its match, and passes it in, keeps the teams at the
  right ends through a reconnect or a reload. The earlier of the two is where
  the second half starts.
- `reset()` forgets the labels seen, as everything else, but not `secondHalfFrom`.

#### Cards: yellow and red

"YELLOW CARD" or "RED CARD" over a hand holding up the card, on the dark band
across the middle of the pitch, as the VAR check's, on a human's card label
(the labelling tool's "Player yellow card" and "Player red card"; the
`yellowCard` and `redCard` layers, on by default). Under the band, the team's
name, and a small card in the card's colour before the player: named from the
`teams` option's `players`, else by the name the labeller gave, else by shirt
number. The live stream gives the team and the number with the label, and the
labeller's player name in the label's `raw_data` (`human_label.items.player_name`);
a label without a team shows no team, and one without a number or a name no
player.
- It fades in, stays at least 2 s and fades out as the VAR check does, with
  everyone on the pitch and the ball faded out.
- Every card plays, however soon after another it comes: a card's label sits on
  one record, so a card that cannot play yet (a goal, a corner, a free kick, the
  penalty or another centre card on screen) waits its turn, and cards play one after the other in the
  order they came, each fading out before the next fades in. A label seen on
  several records is one card: by its `uuid`, or, without one, by its card, team
  and shirt number. A card cut short by a goal, a corner, a free kick, the penalty or a centre card
  before its 2 s plays again after it.
- A card landed on by a seek, or seen while paused, is not played. A seek, a
  pause, a press on the pitch, a moment played by hand or a `reset()` lets go of
  the cards waiting.
- Played by hand (`trigger('redCard', team)`), it names the team and no player.

#### Substitutions

"SUBSTITUTION" over an up and a down arrow, on the dark band across the middle
of the pitch, as the cards', on a human's substitution label (the labelling
tool's "substitute"; the `substitution` layer, on by default). Under the band,
the team's name, then a row per substitution: the player going off, a red down
chevron, a green up chevron, the player coming on, named from the `teams`
option's `players` by shirt number, else by the name the labeller gave, else by
the number.
- The label gives the two players as the labelling tool's roster ids (`from`
  and `to`), read as shirt numbers: one above 99 is not a shirt number, and is
  shown only if `players` or the labeller names it.
- The live stream sends the labeller's names in the label's `raw_data`:
  `human_label.items.player_name_out` for the player going off and
  `player_name` for the player coming on.
- A substitution for the same team while the card is up joins its list, at the
  bottom, fading in, up to 5 rows. Once the rows would pass the bottom
  touchline, the card glides up to keep them on the pitch.
- The card stays at least 5 s from the last row joining, then fades out.
- A substitution for the other team, a 6th, or one arriving as the card fades
  out, waits its turn and plays as a card of its own, after. Substitutions that
  wait together for one team play as one card. Otherwise it waits and plays as
  the cards do (see "Cards: yellow and red"), and the host hears one `moment`
  start and end per card, however many rows it gathers.
- Played by hand (`trigger('substitution', team)`), it names the team and lists
  nothing.

#### Small cards: foul, shot and header on goal

A title on a small dark band along the bottom touchline, the same card as the
throw-in's, with the pitch left as it is: "FOUL" on a foul label (the `foul`
layer), "SHOT!" on a shot on goal label (`shotOnGoal`), and "HEADER!" on a header
on goal label (`headerOnGoal`), each on by default. Each is shown as a throw-in is:
- It fades in over 0.5 s, and fades out over 0.4 s from 2 s after it started,
  whatever its label does.
- It plays once for each run of the label, which has to be off for 5 s of replay
  time to count as a new one.
- It takes over from an attack, and from the attack over a player loss, and
  none starts while it shows: a human's label goes before them, as a throw-in's
  does. It takes over from a throw-in or another small card, and they from it,
  as they stand in one place.
- A goal, a corner, a free kick, the penalty or a centre card takes over from
  it, and it does not go over one, but waits: if its label is still on when they end, it plays then.

#### Player loss

Now and then the pipeline loses track of most players for a few seconds, and
the pitch is left nearly empty. While fewer than 18 players are tracked (both
teams' players, keepers included, officials not), the widget shows an attack
over the gap instead, with everyone faded out (the `playerLoss` layer, on by
default):
- It starts once the loss has lasted 0.3 s of playback.
- It shows the attack of the team the ball is heading towards the other goal
  with. While the ball isn't clearly moving, it shows the attack of the team
  that last had the ball. Until either is known it waits, and tries again on
  each record.
- The ball isn't held, as an attack holds it: play carries on underneath, and
  the ball keeps moving, ringed in the team's colour.
- It stays while the loss lasts, and fades out once 18 or more players have
  been tracked again for 0.5 s.
- A goal, a corner, a free kick, the penalty, or a VAR check, goal disallowed, half time, second half or full time takes over from it, as do a throw-in, a foul, a shot or a header on goal and a goal waiting for its scorer: a human's label goes before it. An attack the team phase calls
  during a loss isn't shown on top of it.
- With `debug` on, a badge says when this is happening.

#### Invalid frames

In live mode, the pipeline marks a frame invalid while its camera is away
(`raw_data.source_frame.frame_state` is `invalid`). It still sends every player
and the ball, but their positions are made up. The widget never shows them:
- Each invalid frame is shown on the last valid frame's positions, standing
  still, with its own labels, so a label a human gives meanwhile still plays.
  The tracking often loses the ball just before, as the broadcast cuts away, so
  the ball is the last one a valid frame had, if seen within 10 s.
  The team phase and the ball trail are worked out from valid frames only.
  In the second half all of it is turned round with the frames around it,
  and a half label on an invalid frame turns it as one on a valid frame does
  (see [The teams change ends](#the-teams-change-ends)).
- The attack of the player loss covers it, with the same layer (`playerLoss`),
  from the first invalid frame of a run that lasts 1 s or more. The frame says
  how long the run lasts (`raw_data.agentic.lookahead`); a run that does not say
  is covered too. A shorter run is not covered: the last valid frame just stands
  for it. A run of 5 s or more plays replays of earlier moments instead, while
  the `flashback` layer is on (see [Flashbacks](#flashbacks)): the attack covers
  it while no replay is ready, and for the rest of the run once they run out.
- It shows the attack chosen as for a player loss, from valid frames only. While
  neither tells, it shows the attack of the team attacking the half the ball is
  in on the last valid frame.
- It fades out from the first valid frame, unless another run of invalid frames
  starts within 1.5 s, which it stays up through.
- With `debug` on, the badge says "Invalid frames: covered by {team}'s attack",
  or "Invalid frames, no attacker" when no side could be chosen, or "Invalid
  frames, under 1 s: not covered". While the frame
  is invalid it counts down to the next valid one from the pipeline's lookahead,
  "valid in 3.2 s", or "valid in over 10 s" when none is due within it. A
  regular attack never shows it.
- A frame whose message carries no `raw_data` (the default socket sends some
  copies without it) is what the stream last said, its countdown run on by the
  frame's own time: inside an invalid run it is invalid too, held and covered
  like the others, and once that run was due to end it counts as valid. What
  the stream said is carried only as far as its lookahead reached (10 s on
  staging): a frame after that, with nothing said since, counts as valid again,
  so the picture never stays held for good. A stream that never sends
  `raw_data` is all valid, as before.

Replay mode never does any of this, whatever its data carries.

##### Flashbacks

While the live camera is away for 5 s or more, the widget plays a replay of an
earlier moment of the match in place of the held frame (the `flashback` layer,
"Replays while the camera is away", on by default). The layers menu lists it in
live mode only.
- What counts, from valid frames only: a goal, a corner, or a shot or header on
  goal that a human labelled (see [Labels](#labels)), a penalty scored counting
  as a goal and a penalty missed as a shot, whatever the layers, and the ball
  going into the penalty area of the goal the team with the ball attacks. A label counts once
  for each run of it, as for the moments, and the penalty area again only after
  the ball has been out of it for 15 s. AI labels never count.
- Each clip is 8 s of play before the moment and 4 s after, of valid frames
  only: invalid ones before the moment start it later, and after it end it
  sooner. Of two moments within one clip, the more important is kept: a goal,
  then a corner, then a shot or header, then the attack near goal.
- A replay starts on an invalid frame whose run has 5 s or more to go (its
  lookahead says so, or says no valid frame is due within its 10 s), while no
  moment a human label started is on screen, and no goal is waiting for its
  scorer (see [The scorer](#the-scorer)): the goal plays first. It plays the most important clip
  ready, the newest of its kind. When the run's time left is known and the clip
  is longer, its start is cut, keeping at least 2 s after the moment and 1 s
  before it, and if even that does not fit, its end too. When it ends with 5 s
  or more of the run to go, the next one follows; otherwise the attack covers
  the rest of the run, as above (with `playerLoss` off, the held frame is left
  uncovered).
- Each clip plays once: it is gone as it starts, however it ends.
- Live play always wins. A replay ends at once on a valid frame, unless the
  next run of invalid frames starts within 1.5 s. A frame that does not say
  whether it is valid is taken as the last one that did, its countdown run on;
  a run said to last over 10 s is taken as unknown once 10 s have gone with no
  frame saying more, so no further replay starts on it. Such a frame never ends
  a replay: when the countdown it is taken by runs out, the replay waits for
  the next frame that says, for 1.5 s at most. It also ends when a
  moment a human label started comes on in live play, or a goal is labelled
  and waits for its scorer: a human's label goes before a replay (the next may
  start once that ends), when the widget comes back after being hidden or scrolled away
  (the next may start at once), when the layer is switched off, and on
  `reset()`. A press on the pitch or the overlay or `trigger()` ends it too,
  and then no replay starts again until the camera is back.
- A run split by a valid gap under 1.5 s is one replay: a clip that runs out
  in the gap, or just before it (as when live frames come a little late),
  holds its last frame, with the tab, until the next invalid frame after the
  gap, when the next clip follows or the replay ends. Only frames that say
  whether they are valid decide. It ends at once if the gap turns out longer,
  and if no frame decides, 1.5 s after the run was due to end or the clip ran
  out, whichever is later.
- It is marked as the past: a white stroke round the pitch, and a white tab in
  the bottom corner away from where the ball was at the moment, with "REPLAY",
  how long ago the moment was ("2:47 AGO", from the frames' own times, so a
  stalled stream does not run it on) and a line along its bottom, the share of
  the clip left. The stroke and tab fade in as the first clip starts and out
  over live play as the last ends, and stay from one clip to the next. With
  reduced motion they do not fade.
- The clip is drawn as live play is, its own moments, cards and zoom near goal
  included, but for the penalty, which plays nothing in it (see [The
  penalty](#the-penalty)), and starts from the viewer's own zoom. The row above the pitch
  shows the clip's phase. Its moments send no `moment` events. As a replay
  starts, the moments on screen in live play send their `end`, and those still
  on when live play is back, their `start`. `trigger()` and `availability()`
  stay on live play.
- The host hears of each replay through the `flashback` event.
- Clips are kept until played, for 15 minutes after their moment, 8 at most,
  in under 20 MB. `reset()` drops them: a host that calls it on every
  reconnect loses them. So does switching the layer off, and while it is off
  nothing is kept, and so does a jump back of over 10 s in the frames' times,
  as when the pipeline starts again.
- While the stroke shows, the layers button and the `debug` badge keep inside
  it. They go back once it has gone. They glide there and back over 200 ms, and jump with reduced motion.
- With `debug` on, the badge says which replay plays and, while the run is
  invalid, its countdown, "Replay: GOAL, 2:47 ago, valid in over 10 s", in the
  moment's own word (`goal`, `corner`, `shotOnGoal` or `attack`), over
  whatever else it would say.
- It needs the pipeline's `raw_data` validity, as above. A stream without it
  never plays a replay.

#### High ball shadow

While the pipeline calls the ball a high ball (`is_high_ball` on the frame's
ball), it casts a shadow on the pitch (the `ballShadow` layer, on by default):
- A soft dark blot below and right of the ball, away from the light it is
  shaded by, on the grass under the players.
- The higher the ball (its `z`), the further off, the wider and the fainter
  the shadow, up to 12 m, from where it looks the same.
- It fades with the ball under a card. The goal sequence's ball and the ball an
  attack holds cast none.

#### Zoom near goal

As the ball nears a goal, the view eases in on the ball and that goal, a
little more the nearer it gets (the `goalZoom` layer, on by default):
- It starts about 32 m from the middle of the goal, past the corner of the
  box, and is as close as it goes, 1.8x, from about the penalty spot in. A
  ball by the corner flag is far.
- The view follows smoothly: it sets off and comes to rest gently, and a
  ball that jumps about from record to record does not jerk it. A ball lost
  for under 2 s keeps the view where it was.
- A goal has no zoom of its own: the view follows the goal's ball into the
  net and stays as close in as this goes. Without this layer a goal's camera
  lunges in over 400 ms and back out at the end, as video-annotation's does.
- While a corner, a free kick, a throw-in, the penalty, a VAR check, a goal disallowed, a half time, a
  second half, a full time, a foul or an attack shows (the attack over a player
  loss or invalid frames too), it eases out to the whole pitch, as their cards
  and the attack's label are laid out on it, and back in once it has gone. A shot or a header on goal is what it is there for, so for those it stays
  in. Zoomed in, those cards stay whole, on the frame where the whole pitch has
  them, as the goal's card does.
- With reduced motion it does nothing.

The `TrackerText` keys are:
- on the canvas: `goal`, `corner`, `freeKick`, `throwIn`, `penalty`, `penaltyWaiting`, `penaltyScored`, `penaltyMissed`, `varCheck`, `goalDisallowed`, `halfTime`, `halfTimeText`, `secondHalf`, `secondHalfText`, `fullTime`, `fullTimeText`, `foul`, `shotOnGoal`, `headerOnGoal`, `yellowCard`, `redCard`, `substitution`, `playerNumber` (a carded or substituted player with no name, with `{number}`), `attack`, and the replay's tab, `flashback` ("REPLAY") and `flashbackAgo` (with `{time}`);
- the row: `attacking`, `defending`, `versus`, `phaseTooltip`, `red` and `blue` (the default team names);
- ARIA templates: `phaseAttackingAria` and `phaseDefendingAria` (with `{team}`), and `phaseAria` (with `{home}` and `{away}`);
- the menu: `layersButton`, `layersTooltip`, `layersMenuLabel`, and `layers` (`{ label, hint }` per layer);
- for screen readers: `pitchLabel`, the pitch's name ("Match tracker");
- the `debug` badge: `playerLoss` (with `{players}`), `playerLossCover` (with `{players}` and `{team}`), `invalidFrames`, `invalidFramesCover` (with `{team}`), and `invalidFramesValidIn` and `invalidFramesValidLater` (with `{label}` and `{seconds}`), and `invalidFramesShort` (with `{seconds}`), and `flashbackDebug` (with `{kind}` and `{ago}`).

### Events

| Event | Value | When |
|---|---|---|
| `zoom` | `{ zoom }` | The view's zoom changed: by a goal's camera, or by the zoom near goal, which sends one for each step as it eases. |
| `layers` | `ReplayLayers` | The layers in force changed, from the menu or from `setOptions`. |
| `moment` | `{ moment, phase: 'start' \| 'end' }` | A moment came on screen, or went. Never for the moments in a replay (see [Flashbacks](#flashbacks)). |
| `box` | `TrackerBox` | The pitch's box moved or changed size. The box measured at mount is not sent, because no listener exists yet: read `tracker.box` for it. |
| `availability` | `MomentAvailability` | What can be played changed: a new frame, or a reset. |
| `flashback` | `{ phase: 'start' \| 'end', at }` | Live mode: a replay of an earlier moment started (`start`, for each clip), or the last one ended or was cut off (`end`). `at` is the moment's record time (`TrackerRecord.t`, in seconds). `start` comes for each clip, and `end` once, when the last one ends: a host that had a `start` always gets its `end` while the widget lives, `reset()` included (`destroy()` sends none). |
| `secondHalf` | `{ from }` | A human half label the widget saw starts the second half at `from` (a record time, in seconds), earlier than any it saw before. Keep it for the match and give it back as `secondHalfFrom` (see [The teams change ends](#the-teams-change-ends)). Not sent for `secondHalfFrom` itself. |

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
  (400, 600, 900, italic 900). They come in the package as Latin woff2 files, registered under
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
    under the widget's row and layers menu.
  - Any other child of the host is not shown, as before.
  - The page gets only the `FontFace` registrations, made once however many
    widgets there are.
  - Host CSS cannot reach in, except into the overlay, and the widget's CSS cannot leak out. Lengths
    are in px, not rem, so even the page's root font size stays outside.
  - There are no globals and no polyfills. The only requests the widget makes are for its own
    font files, which ship next to `dist/index.js` (see
    [Content Security Policy](#content-security-policy)). Its icons are inlined, and nothing
    else is fetched.
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
    moment or fade, or a resize. Otherwise no animation frame
    loop runs.
  - Drawing stops while the widget is scrolled out of view or the tab is
    hidden, and catches up when it is back.
  - The pitch's markings are drawn once and cached.
  - Live history is capped at the lookback window, so memory stays flat over a match.
- **Input.**
  - The pitch takes no zoom or pan by hand: a wheel, a pinch, a drag or a double-click on it
    is the page's, as on any picture in it.
  - Escape closes the layers menu only while focus is inside the widget, and the page
    does not get that Escape too.
  - A press anywhere outside the layers menu, on the pitch or on the page, closes it.
    So does the focus leaving it. Nothing covers the page while it is open.
- **Reduced motion** is honoured, in every branch where video-annotation honours it.

### Content Security Policy

On a page with a Content Security Policy, the widget needs:
- `img-src data:`, for the corner's, the free kick's, the VAR check's and the goal disallowed's icons, and the penalty's pictures, SVG `data:` URLs drawn
  through an `Image`. Without it the cards are drawn without their icons, and the penalty's scene without its goal, keeper and ball.
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

`npm run size` prints the gzipped size of `dist/index.js`, `dist/vue.js` and
`dist/banner.js`, and the size of the fonts. It fails when `dist/index.js` is over
70 kB gzipped, or `dist/banner.js` over 2 kB.
The measured numbers for each release are in [CHANGELOG.md](CHANGELOG.md). The targets:
- one draw in under 4 ms at 1280×720 CSS px at 2x;
- no dropped frames during a goal on a mid-range phone.

## Developing

```sh
npm install
npm test           # vitest, against src
npm run typecheck
npm run lint       # oxlint --deny-warnings
npm run build      # dist/, then checks it (below)
npm run size
```

`npm run build` bundles and minifies the code into `dist`, and writes the
declarations, keeping only those the entries reach. Then
`scripts/check-dist.mjs` checks what `dist` holds, and type-checks the
declarations strictly under `bundler`, `node16` and `nodenext` resolution.
Last, `npm run test:dist` (test/dist) plays real match data through
the built widget and the source side by side, and fails on any difference in
what they draw or build.

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
