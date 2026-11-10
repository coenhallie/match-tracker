# Changelog

What changes for someone watching the tracker, release by release. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

Replays of earlier moments while the live camera is away, invalid frames covered without a blink, and a smaller package.

### What you see

- **In live mode, a message without `raw_data` inside a run of invalid frames
  no longer breaks the run.** The default socket sends some copies of a message
  without it, about one in seven. Such a frame was taken for a valid one: its
  made-up positions became the last valid frame, which every invalid frame after
  it was then held on, and the attack over invalid frames ended on it and started
  again on the next, blinking about twice a second. Now a frame that says
  nothing is what the stream last said, its countdown run on by the frame's own
  time: inside the run it is held and covered like the frames around it, and
  once the run was due to end it counts as valid. What the stream said is
  carried only as far as its lookahead reached, 10 s on staging, so a stream
  that stops sending `raw_data` never leaves the picture held. A stream that never sends
  `raw_data` is unchanged, and so is replay.
- **In live mode, a long stretch of invalid frames plays replays of earlier
  moments instead of the held frame.** While the pipeline's camera is away for
  5 s or more, the widget plays an earlier clip of the match: 8 s before a
  moment and 4 s after it, cut to fit the stretch, one after another while it
  lasts. In 0.10.0 such a stretch showed the last valid frame under an
  attack, however long it was; that attack now covers shorter stretches, and
  the rest of a long one once no clip is left.
- **What counts**: a goal, a corner, or a shot or header on goal that a human
  labelled, and the ball going into the penalty area of the goal the team with
  the ball attacks, from valid frames only. AI labels never count. Of two
  moments within one clip the more important plays: a goal, a corner, a shot or
  header, then the attack near goal.
- **Each moment plays once**, and is dropped 15 minutes after it happened.
- **Live play always comes first**: a replay ends at once on a valid frame
  (riding valid gaps under 1.5 s, as the attack does), on a moment a human
  label starts in live play, on a press on the pitch, on `trigger()`, when the
  widget comes back into view, and on `reset()`. After a press or `trigger()`,
  no replay starts again until the camera is back; after the others, the next
  may start.
- **A stretch split by a short valid gap is one replay.** A clip that runs out
  in a valid gap under 1.5 s, or just before it (as when live frames come a
  little late), holds its last frame, the tab up, until the next invalid frame
  after the gap: then the next clip follows, or the replay ends. It ends at
  once if the gap turns out longer, and if no frame decides, 1.5 s after the
  stretch was due to end or the clip ran out, whichever is later.
- **It looks like the past**: a white stroke round the pitch and, in the bottom
  corner away from the action, a white tab with "REPLAY", how long ago the
  moment was ("2:47 AGO") and a line that shortens as the clip plays. They fade
  in and out (not with reduced motion). The clip is drawn as live play is, its
  own goal, cards and zoom near goal included, from the viewer's own zoom, and
  the attacking/defending row shows its phase. While the stroke shows, the
  layers button and the badges keep inside it, and the zoom badge sits above a
  tab in the bottom right. They glide there and back over 200 ms (not with
  reduced motion).
- **It is a new layer, `flashback`** ("Replays while the camera is away"), on
  by default, listed in the layers menu in live mode only. Off, nothing is kept
  for replays and long stretches are covered by the attack, as in 0.10.0.
- **Live mode keeps what it needs for the replays**, at most 8 clips, in under
  20 MB of memory at worst, measured on real staging data. `reset()` drops
  them.
- **The bottom-left action text is drawn under the replay's tab**, never over
  it. Nothing changes where no replay shows.
- Replay is unchanged.

### API

- A new layer, `flashback`, in `ReplayLayers`. The layers menu lists it in live
  mode only. In replay mode the `layers` option, the `layers` event and the
  layers kept under `layersStorageKey` now carry a `flashback` key too, which
  does nothing there, so a host that compares layer objects sees it.
- A new event, `flashback`: `{ phase: 'start' | 'end', at }`, `start` for each
  clip and `end` once the last one ends or is cut off, `reset()` included
  (`destroy()` sends none); `at` is the moment's record time. A replay's own
  moments send no `moment` event.
- The Vue component emits `flashback` too.
- New `TrackerText` keys: `flashback` ("REPLAY"; zh "回放") and `flashbackAgo`
  ("{time} AGO"; zh "{time}前") for the tab, `flashbackDebug` ("Replay:
  {kind}, {ago} ago"; zh "回放：{kind}，{ago}前") for the `debug` badge, which
  says which replay plays, `{kind}` being the moment's own word (`goal`,
  `corner`, `shotOnGoal` or `attack`), followed by the run's countdown in the
  badge's `invalidFramesValidIn` or `invalidFramesValidLater` words while the
  run is invalid, and `layers.flashback` for the menu.

### Package

- **The package is 210.6 kB packed and 423.5 kB unpacked, in 44 files**, the
  replays included, down from 235.4 kB, 513.9 kB and 77 files.
- **The code is minified in full**: `dist/index.js` is 132.12 kB, 44.83 kB
  gzipped, the replays included (0.10.0's was 138.26 kB, 41.83 kB, and its code
  minified 111.69 kB, 38.05 kB). Vite used to leave its whitespace and its
  source path comments in. An app's own build minifies it anyway, so what a
  viewer downloads hardly changes. A new check, `npm run test:dist`, the last
  step of the build, plays real match data through the built widget and the
  source side by side, and fails on any difference in what they draw or build.
- **Only the declarations the entries reach ship**: 32 files instead of 70. The
  38 left out are internal modules' declarations, which no host could import.
  The build checks that the declarations it keeps type-check strictly under
  `bundler`, `node16` and `nodenext` resolution.
- **CHANGELOG.md no longer ships in the package.** It is in the repository.

## [0.10.0] - 2026-11-09

Invalid frames held still under an attack, the zoom near goal out of an attack's way, and a shadow under a high ball.

### What you see

- **In live mode, frames the pipeline marks invalid are covered with an attack.**
  While its camera is away the pipeline keeps sending every player and the ball,
  with made-up positions, and the widget used to draw them drifting about. Now
  each invalid frame is shown on the last valid frame's positions, standing
  still (the ball where a valid frame last had it), under the attack the player
  loss already shows, from the first invalid frame of a run of 1 s or more until
  its first valid frame, through valid gaps under 1.5 s. A shorter run is held,
  not covered. The side is chosen as for a player loss, from
  valid frames only, and failing that from the half the ball is in. Labels on
  invalid frames still play, a half label among them, which turns the held frame
  round for the second half as one on a valid frame does. Replay is unchanged.
- **The team phase and the ball trail leave invalid frames out**, so neither
  reads a made-up position once the frames are valid again.
- **The zoom near goal eases out to the whole pitch while an attack shows**, as
  it does for the corner and the centre cards, and back in after it. It used to
  stay in, and near a goal the attack's label was cut off at the frame's edge.
  The attack over a player loss or invalid frames does the same.
- **A high ball casts a shadow on the pitch**, below and right of it, further
  off and fainter the higher it is. It is a new layer, `ballShadow` ("High ball
  shadow"), on by default. video-annotation has none.
- **The `playerLoss` layer is now "Attack over lost players or invalid frames".**

### API

- A new layer, `ballShadow`, and `Ball` has an optional `is_high_ball`.
- `TrackerRecord` has an optional `validity`, read from the message's
  `raw_data` by `parseRecord`; nothing else of `raw_data` is kept.
- With `debug` on, the badge says when an attack covers invalid frames, and
  counts down to the next valid frame, from the new `TrackerText` keys
  `invalidFrames`, `invalidFramesCover`, `invalidFramesValidIn`,
  `invalidFramesValidLater` and `invalidFramesShort`.

## [0.9.0] - 2026-11-09

The host can keep the teams at the right ends through a reconnect or a reload.

### What you see

- **The teams stay at the right ends through a reconnect, a reload or a seek**,
  when the host passes the second half's start back in (`secondHalfFrom`,
  below). Before, a widget that had not seen a half label itself, after a
  `reset()` or a seek past both labels, showed the second half unturned.

### API

- A new option, `secondHalfFrom`: when the second half starts, as a record time
  (`TrackerRecord.t`). From it on the frames are turned round, as from a half
  label the widget sees; the earlier of the two wins. It is kept through
  `reset()` and can be changed with `setOptions`. The Vue component takes it as
  a prop.
- A new event, `secondHalf` (`{ from }`): a human half label the widget saw
  starts the second half at `from`, for the host to keep for its match and pass
  back as `secondHalfFrom`. The Vue component emits it.

## [0.8.0] - 2026-11-09

The teams change ends at half time.

### What you see

- **The teams change ends for the second half.** From the first human half time
  label ("End FirstHalf", the labelling tool's "Half Time" button) or second half
  label ("Start second half", its "Second Half" button), every player and the
  ball are shown turned half round the centre spot, and the attacking direction,
  the goal side, the corner and throw-in sides, the ball trail and the zoom near
  goal all follow. The turn is hidden under the half time's or the second half's
  card. It goes by the labels the widget has seen: a seek back before the label
  shows the first half as it was, and a widget that never saw either label, after
  a `reset()` or a seek past both, shows the frames as the pipeline sends them.
  video-annotation has no such turn.

## [0.7.1] - 2026-11-08

Lighter and leaner, with nothing drawn differently.

### Performance

- **The pitch's markings are drawn again into the bitmap they were drawn in before.**
  While the view moves (the zoom near goal easing, or a pinch or a drag) they
  are redrawn every frame, and each time used to take a new full-size bitmap,
  about 15 MB a frame on a 2x screen, for the browser to reclaim. A new one is
  made only when the canvas changes size.

### Package

- **The stylesheet ships without its comments**, which were about two fifths of
  it: with the goal-net icon gone too, index.js is about 2.3 kB smaller gzipped (41.75 to 39.47 kB). The rules are
  the same; the comments stay in the source.
- **The goal-net icon is no longer loaded.** Only the parity test's reference goal
  card used it, and the widget's own goal banner has no icon.

### Docs

- The README said the widget makes no network requests. It requests its own font
  files, which ship next to `dist/index.js`, and nothing else.

## [0.7.0] - 2026-11-08

A new option for the language of the moments' words. Everything is drawn as in
0.6.1.

### API

- A new option, `momentLocale`: the language of the words the moments write on the
  canvas, the cards' titles and texts and the attack's word. Default `locale`, so
  nothing changes for a page that does not give it. A host can keep them in one
  language while the HUD follows `locale`.

## [0.6.1] - 2026-11-06

The half time, second half and full time cards now play on the names the
labelling tool sends. Everything else is drawn as in 0.6.0.

### What you see

- **The half time, the second half and the full time play on the labelling
  tool's names for them.** It sends `End first half` (saved as `End FirstHalf`),
  `Start second half` and `End second half` (saved as `End SecondHalf`), whatever
  its buttons say, and none of these played a card. The names they already played
  on still do.

## [0.6.0] - 2026-11-06

Five new moments: the second half and the full time, on the reusable card, and
the foul and the shot and header on goal, on a small version of it, which the
throw-in now uses too. The centre cards fade out the pitch and zoom out.
Everything else is drawn as in 0.5.0.

### API

- `ReplayMoment` has five new members, `'secondHalf'`, `'fullTime'`, `'foul'`,
  `'shotOnGoal'` and `'headerOnGoal'`, which `trigger` plays and the `moment` event names.
- `MomentAvailability` has the same five new keys. A page that builds a whole
  `MomentAvailability` itself now has to give them.
- `ReplayLayers` has the same five new keys. A page that builds a whole
  `ReplayLayers` itself now has to give them; `layers` and `setOptions` take a
  `Partial<ReplayLayers>`, as before, and need nothing new.
- `TrackerText` has the same five new keys, the cards' titles, the same five under
  `layers`, and `secondHalfText` and `fullTimeText`. `text` takes overrides, as before, and needs nothing new.

### What you see

- **Second half.** On a human's second half label, "SECOND HALF" and a short text
  fade in on the same card as the half time. It goes by itself, as the VAR check
  does, after at least 2 s and once its label is off, and takes over from a half
  time still showing. It is a new layer, `secondHalf` ("Second half"), on by
  default, and the widget's own too.
- **Full time.** On a human's full time label, "FULL TIME" and a short text fade in
  on the same card. As the half time does, it does not time out: it stays until a
  human gives any other label. It is a new layer, `fullTime` ("Full time"), on by
  default, and the widget's own too.
- **Foul.** On a human's foul label, "FOUL" fades in on a small dark band along
  the bottom touchline, and fades out after 2 s, as a throw-in does, with the
  pitch left as it is. It is a new layer, `foul` ("Foul"), on by default.
  video-annotation has no foul: this is the widget's own.
- **Shot and header on goal.** The same card, with "SHOT!" on a human's shot on goal
  label and "HEADER!" on a header on goal label. No goal plays on either. Unlike
  the foul, the view stays zoomed in for them. They are new layers, `shotOnGoal` and
  `headerOnGoal`, on by default, and the widget's own too.
- **The throw-in is on the new small card.** Its band is now 112 px high and hugs
  "THROW IN", where it was a fixed 501 by 109, and stands 60 px above the bottom
  touchline, where it stood 90. It behaves as before. The parity test still draws
  the reference's sliding band.
- **The zoom near goal makes way for the new cards.** While a VAR check, a goal
  disallowed, a half time, a second half, a full time or a foul shows, the view eases out to the whole pitch,
  as it does for a corner or a throw-in.
- **The VAR check, the goal disallowed and the half time fade out the pitch.**
  Everyone on the pitch, the ball and its trail fade out as the card fades in, as
  for a corner, and back as it goes.

## [0.5.0] - 2026-11-06

Three new moments, the VAR check, the goal disallowed and the half time, on a
new reusable kind of card. Everything else is drawn as in 0.4.0.

### API

- `ReplayMoment` has three new members, `'varCheck'`, `'goalDisallowed'` and
  `'halfTime'`, which `trigger` plays and the `moment` event names.
- `MomentAvailability` has three new keys, `varCheck`, `goalDisallowed` and
  `halfTime`. A page that builds a whole `MomentAvailability` itself now has to give them.
- `ReplayLayers` has three new keys, `varCheck`, `goalDisallowed` and `halfTime`.
  A page that builds a whole `ReplayLayers` itself now has to give them; `layers` and `setOptions` take a
  `Partial<ReplayLayers>`, as before, and need nothing new.
- `TrackerText` has four new keys: `varCheck`, `goalDisallowed` and `halfTime`,
  the cards' titles, the same three under `layers`, and `halfTimeText`. `text` takes overrides, as before, and needs nothing new.

### What you see

- **VAR check.** On a human's VAR check label, in any case and however the
  export writes it ("VAR check", "var check", "EventType.VAR_CHECK"), "VAR CHECK"
  and an eye fade in on a dark band across the middle of the pitch, stay for at
  least 2 s and for as long as the label is on, and fade out. It plays once per
  run of the label. It gives way to a goal or a corner and plays after them if
  the label is still on, and it takes over from an attack and a throw-in. It is
  a new layer, `varCheck` ("VAR check"), on by default. video-annotation has no
  VAR check: this is the widget's own.
- **Goal disallowed.** The same card, with "GOAL DISALLOWED" and a struck-through
  goal, on a human's goal disallowed label, written in any of the same ways. No
  goal plays on that label. It behaves as the VAR check does, and takes over from
  it, as the latest card always takes over from another. It is a new layer,
  `goalDisallowed` ("Goal disallowed"), on by default. This is the widget's own too.
- **Half time.** The same card again, with "HALF TIME" and a short text in place
  of the icon, on a human's half time label. It does not time out: it stays until
  a human gives any other label, then fades out as that label's moment comes. A
  pause or coming back to a hidden tab leaves it up; a seek or a press on the
  pitch ends it. It is a new layer, `halfTime` ("Half time"), on by default. This
  is the widget's own too.

### Package

- Inter Semi Bold is now bundled, for the half time's text: a fifth font file
  next to `dist/index.js`, 24 kB, loaded with the others.

## [0.4.0] - 2026-11-05

The view zooms in as the ball nears a goal, a goal no longer zooms on its
own, and the goal's banner is new. Everything else is drawn as in 0.3.0.

### API

- `ReplayLayers` has a new key, `goalZoom`. A page that builds a whole
  `ReplayLayers` itself now has to give it; `layers` and `setOptions` take
  a `Partial<ReplayLayers>`, as before, and need nothing new.

### What you see

- **Zoom near goal.** As the ball nears a goal, the view eases in on the ball
  and that goal, a little more the nearer it gets: from about 32 m from the
  middle of the goal, up to 1.8x from about the penalty spot in. It follows
  smoothly, sets off and comes to rest gently, rides over a ball that jumps
  about, and holds through a ball lost for under 2 s. Far from goal, by the
  corner flags included, the view is the whole pitch. It is a new layer,
  `goalZoom` ("Zoom near goal"), on by default.
- **A goal has no zoom of its own.** With the zoom near goal on, the view
  follows the goal's ball into the net as it follows the tracked ball, and
  settles as close in as the zoom near goal goes, 1.8x, with no pull back out
  at the end. A view still easing in as the goal comes carries on, with no
  stop and start. Before, the goal's camera went from 1x to 2x in 150 ms, at
  full speed from its first frame, and snapped back out over its last 0.6 s.
- While a corner or a throw-in shows, the view eases out to the whole pitch,
  as their cards are laid out for it. An attack keeps the view: its edge and
  label stay in view.
- **The corner's card and the throw-in's banner stay whole when zoomed in.**
  In a view zoomed or panned, by the viewer or the zoom near goal, they are
  drawn on the frame where the whole pitch has them, as the goal's card is,
  where before they zoomed with the pitch and could be cut off. At the whole
  pitch they are drawn as before.
- Zooming or panning takes the view from the zoom near goal, which leaves it
  where it is put, until it is back at the whole pitch (a double-click, or
  zoomed all the way out). With reduced motion the zoom near goal does
  nothing.
- The `zoom` event is sent for each step of the zoom near goal, as it is for
  a goal's camera.
- **The goal's banner.** "GOAL" alone on the dark band, with no icon, in the
  half of the screen away from the goal, as the design's vp-pitch-3 has it.
  It slides in from that side's edge as the ball reaches the net, slowing to
  a stop over 0.6 s: left to right for a goal on the right, right to left for
  one on the left. It fades out as before. With reduced motion it is in place
  from the start. Before, it was "GOAL" and a ball-in-the-net icon on a card
  centred on the pitch, fading in where it stood.

### Parity

- video-annotation has no zoom near goal, and its goal's camera lunges in
  over 400 ms. With `goalZoom` off, the view is drawn as video-annotation
  draws it. The goldens and baseline snapshots are unchanged: the parity test,
  and the tests ported from the reference, run with `goalZoom` off.
- The reference has no corner, and its throw-in slides in over the zoomed
  pitch; none of the goldens zooms in during either, so they hold.
- The reference's goal card is the old one. The goldens are unchanged: the
  parity test draws the widget's goal banner as the reference's card, as it
  does its throw-in.

## [0.3.0] - 2026-11-05

The bottom-left action text lists only human labels. Everything else is drawn
as in 0.2.1.

### What you see

- **The bottom-left action text lists only human labels.** It follows the
  same rule as the moments: a label whose `action_origin` is `"human"` is
  listed, and the AI's labels, and labels with no `action_origin`, are not.
  On a frame with no human label there is no text.
- **`aiLabels`, a new option, lists the AI's labels too,** as every label was
  listed before. It is off by default, for developers, like `layersMenu`, and
  can be changed with `setOptions` (and as a prop of the Vue component).

### Parity

- video-annotation lists every label. The baseline snapshots are unchanged:
  their labels have no origin, so the baseline test marks them human, as the
  parity test does the goldens'.

## [0.2.1] - 2026-11-03

The moments play only on labels a human gave. Everything else is drawn as in
0.2.0.

### What you see

- **Only human labels play a moment.** A goal, a corner or a throw-in plays
  only on a label whose `action_origin` is `"human"`. Labels from the
  pipeline's AI (`"ai"`), and labels from older exports with no
  `action_origin`, play nothing. On an export labelled by the AI alone, such
  as the February one, no goal, corner or throw-in plays by itself any more.
- The bottom-left action text still lists every label, AI ones included, and
  the attack, the attack over lost players and the moments played by hand
  are unchanged: none of them comes from a label.

### Parity

- The goldens and snapshots are unchanged. The goldens' labels predate
  `action_origin`, so the parity test marks them human as it loads them:
  each still plays as video-annotation played it.

## [0.2.0] - 2026-11-03

The free kick is gone. Everything else is drawn as in 0.1.7. This breaks the
API for any page that names the free kick, so it is 0.2.0.

### What you see

- **No free kick.** A free kick label no longer brings up the "FREE KICK"
  card, and no longer fades the players and the ball out. Play shows as it
  is through a free kick, and an attack, a throw-in or the attack over lost
  players can show during one, where the free kick used to hold them back.
  The free kick's layer is gone from the layers menu.
- The corner is unchanged: it keeps the card and the hold it took from the
  free kick.

### For pages that embed it

- `'freeKick'` is gone from `ReplayMoment` and `ReplayLayerKey`, so
  `trigger('freeKick')` no longer type-checks, and from plain JavaScript it
  returns false. `availability()` has no `freeKick` field.
- `TrackerText` has no `freeKick` title, and its `layers` no `freeKick`
  entry. An override that still gives them is ignored.
- A layer choice kept from an earlier version that includes `freeKick` is
  read without it.
- The free kick card's icon is no longer bundled, so the cards' icons are the
  goal's and the corner's.

### Parity

- video-annotation's free kick is no longer matched. Its two goldens,
  `real-free-kick` and `free-kick-held-through-cutaway`, recorded nothing
  else, and are retired. `trigger-each-moment` is compared up to its free
  kick trigger: the goal and both attacks. The throw-in after it keeps its
  own four goldens. The other 15 goldens are unchanged and still pass.
- The baseline snapshot that drew the free kick card with the throw-in and
  the goal card now draws those two alone. The other four snapshots are
  unchanged.

### Size

- The widget is 34.2 kB gzipped (budget 60 kB), down from 36.3 kB, and the
  fonts are still 81.7 kB.

## [0.1.7] - 2026-11-03

An attack shown over stretches where the pipeline loses most players, and a
developer-mode badge that says when that's what is on screen. Everything else
is drawn as in 0.1.6.

### What you see

- **An attack over lost players.** While the pipeline tracks fewer than 18
  players (both teams' players, keepers included), which leaves the pitch
  nearly empty, the tracker shows an attack instead, for the team the ball is
  heading towards the other goal with, or else the team that last had the
  ball. Everyone fades out, and the ball keeps moving under it. It starts
  once the loss has lasted 0.3 s, stays while it lasts, and fades out once 18
  or more players have been back for 0.5 s. It has its own layer, "Attack
  over lost players", on by default. video-annotation has nothing like it.
  The goldens and snapshots are unchanged: the goldens carry their own
  layers, which don't have this one, so it stays off for them, although
  their synthetic scenes have six players throughout.

### For pages that embed it

- **`debug`**, a new option, is developer mode: a red badge, top left of the
  pitch, says "Player loss: 9 tracked" while too few players are tracked, and
  ", covered by Red's attack" when the attack covers it. That's how to tell a
  real attack from one shown over lost players. It's off by default, and can
  be changed with `setOptions`. The Vue component takes it as a prop.
- `ReplayLayerKey` takes `'playerLoss'`, and `TrackerText` has `playerLoss`
  and `playerLossCover`, plus a `playerLoss` entry in `layers`. Code that
  builds a whole `TrackerText` has to add them.

### Size

- The widget is 36.3 kB gzipped (budget 60 kB), up from 34.9 kB, and the
  fonts are still 81.7 kB.

## [0.1.6] - 2026-11-03

The corner's cone is easier to see. Nothing else changes for someone
watching the tracker, and the goldens and snapshots are unchanged.

### What you see

- **The corner's cone is stronger.** Its sections are about three quarters
  brighter, and between waves they settle lower than before (to 40% of full,
  from 65%), so each wave out from the flag stands out. Each section also
  takes a little longer to light up and settle (0.7 s, from 0.6 s).

## [0.1.5] - 2026-11-03

A new moment, the corner, which video-annotation does not have. The free kick
now fades out the ball with everyone else, and the throw-in fades in where it
stands instead of sliding in. Everything else is drawn as in 0.1.4. The
goldens and snapshots are unchanged: none of their frames carries a corner
label, and the parity test draws their free kicks and throw-ins as
video-annotation draws them, the ball left in and the band sliding, so
everything else in those paints is still checked against the reference call
for call.

### What you see

- **The free kick fades out the ball and its trail** with the players, so
  nothing of play is left under its card, and they fade back in with the
  players as it goes. Before, as in video-annotation, the ball stayed.
- **The throw-in fades in and out** where it stands, centred above the bottom
  touchline. Before, as in video-annotation, it slid in from the side of the
  ball's half and back out that way. Its layer's hint in the menu now reads
  "A banner along the bottom touchline on a throw-in label".

- **Corners.** On a corner label, "CORNER" (角球 in Chinese) is shown across
  the middle of the pitch with a corner icon, on the free kick's card, and
  everyone on the pitch fades out, the ball and its trail with them. The corner it is taken from lights up as a
  cone of three sections fanning out from the flag (to 7, 15 and 24 m), each
  lighting up after the one inside it, in a wave that runs out from the flag
  every 1.6 s while it shows. The sections are told apart by their shading
  alone, each fainter than the one inside it, with no lines between them. The corner is the one nearest the ball, or the
  ball last tracked in the 5 s before. With no ball to go by, the card is
  shown alone.
- It is held as a free kick is: for at least 2 s, then for as long as the
  label is on or play is stopped, and it fades out once play is back. It is
  shown once per corner, only during playback. A goal takes over from it. It
  takes over from an attack and a throw-in. A free kick and a corner never
  take over from each other: the first one shown stays. Its label has to have
  been off for 15 s before it counts as a new corner, where a free kick's
  needs 5 s: in the one export with corners, the label is off for up to 9 s
  within a corner, and the corners are minutes apart.
- Played by hand, it is on screen for 4 s.
- Under reduced motion it is shown whole and still, and goes without a fade.
- **A Corner layer** in the layers menu, after Free kick, on by default. A
  choice kept from an earlier version leaves it on.
- The corner label is matched as "Corner", as the February export writes it,
  and as "Corner kick", "EventType.CORNER" or "EventType.CORNER_KICK", in any
  case, for exports that name it as they name the free kick.

### For pages that embed it

- `trigger('corner')` plays it now, on the frame on screen, and the `moment`
  event says `'corner'` when it starts and ends.
- `MomentAvailability` has a `corner` field, `ReplayMoment` and
  `ReplayLayerKey` take `'corner'`, and `TrackerText` has `corner`, with a
  `corner` entry in `layers`. Code that builds a whole `MomentAvailability` or
  `TrackerText` itself has to add them. Text overrides are partial, as before.
- On pages with a Content Security Policy, the corner's icon is an SVG
  `data:` URL like the others, so `img-src data:` covers it.

### Size

- The widget is 34.9 kB gzipped (budget 60 kB), up from 33.7 kB, and the
  fonts are still 81.7 kB.

## [0.1.4] - 2026-11-03

A tiny `@coenhallie/match-tracker/banner` entry for the console banner, so a
host can call it from its app entry without loading the widget. Nothing
changes for someone watching the tracker: the pitch, the moments and the HUD
are drawn as in 0.1.3, and the goldens and snapshots are unchanged.

### For pages that embed it

- **`@coenhallie/match-tracker/banner`** exports `logMatchTrackerBanner()` and
  `matchTrackerBanner()` on their own. Before, the only way to get them was the
  main entry, which is the whole widget in one module, so calling the banner
  from an app's entry pulled the widget into the entry chunk (163 kB to 253 kB
  on one app that otherwise loads the widget lazily). `/banner` is under 1 kB
  gzipped and imports nothing. The README's Console banner section says to
  import it from there at your entry.
- The main entry and `/vue` still export both functions, and they are the
  same functions, so the banner still prints once per page when a page loads
  `/banner` and either of the others.

### Size

- `dist/banner.js` is 0.76 kB gzipped (budget 2 kB, checked by `npm run size`).
  The widget is 33.7 kB gzipped (budget 60 kB), as before, and the fonts are
  still 81.7 kB.

## [0.1.3] - 2026-11-03

Host controls over the pitch are left alone by zoom and pan too, and an
opt-in console banner shows the version. The pitch, the moments and the HUD
are drawn as in 0.1.2, and the goldens and snapshots are unchanged.

### What you see

- **Play works while zoomed in**, on pages that put their player controls
  over the pitch and mark them `data-match-tracker-keep`. Before, zoomed in,
  a press on such a control started a pan of the pitch and its click never
  reached the button, and a double-click on one (Next frame, twice) reset the
  zoom. Now a press there starts no pan and a double-click there leaves the
  zoom. A ctrl or ⌘ + wheel or a pinch over a control still zooms the pitch,
  and never the page, as before.

### For pages that embed it

- **`data-match-tracker-keep`** now also keeps zoom and pan's hands off the
  element: no pan and no pointer capture on a press, no zoom reset on a
  double-click. A page that stopped its controls' pointer events from
  reaching the tracker to get this can drop that workaround.
- **`logMatchTrackerBanner()`**, from the main entry and from `/vue`, prints
  a small pitch in box-drawing characters with `MATCH TRACKER · v<version>`
  under it to the browser's console, in the widget's colours. It is opt-in:
  the widget never prints it by itself. It prints once per page however many
  times it is called, and does nothing on the server or without a console.
  `matchTrackerBanner()` returns the same art as plain text. The README's
  Console banner section shows how to turn it on.

### Size

- The widget is 34.3 kB gzipped (budget 60 kB). The Vue component adds 1.4 kB,
  and the fonts are still 81.7 kB.
- Nothing in the draw path changed, so the drawing times of 0.1.0 stand.

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
