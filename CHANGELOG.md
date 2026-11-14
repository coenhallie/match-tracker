# Changelog

What changes for someone watching the tracker, release by release. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### What you see

- **The penalty waits for its kick however long it takes**, no longer 20 s of
  the stream's clock (or 40 s on screen): a penalty can take minutes to be
  taken. Any other human label ends the wait instead, during the card or the
  scene, cards and substitutions included: the penalty fades out over 0.6 s while
  that label's own moment comes in, where before it held them back (a yellow or
  red card or a substitution still waiting its turn goes first, as such cards
  always go before a throw-in or a small card). A label on the `Penalty`'s own
  record, an AI label, or one that stays on from before it does not count. Once
  the result is in, the kick and the hold play out as before, holding the other
  moments back; as the penalty fades out at the end, whatever is due now comes
  in under it rather than after it.

## [0.23.0] - 2026-11-13

The penalty, from the match-summary design.

### What you see

- **The penalty.** On a human's `Penalty` label, "PENALTY" and its icon show on
  a card across the middle, with the team taking it under the band, everyone on
  the pitch and the ball faded out (viewport/eventPenalty). After 2.4 s a scene
  of its own fades in over the pitch (viewport/eventPenaltyWaiting): a green
  with the design's fine grain and no markings, the goal, the keeper swaying on
  his line, the ball turning on the spot, and "PENALTY.." with the team at the
  top right.
- **The kick.** On `Penalty scored`, the ball curls into the top corner past the
  keeper's late dive and "SCORED!" rises in at the foot
  (viewport/eventPenaltyScored); on `Penalty missed`, it curls over the bar and
  "MISSED!" rises in (viewport/eventPenaltyMissed). The scene holds for 3 s,
  then fades back to the live pitch. A result that comes with no penalty showing,
  or as one with no result fades out, plays the scene and its kick with no card.
- **It waits 20 s** of the stream's clock for the result, then fades back to the
  live pitch. As the clock stands still while the stream stalls, it also goes
  40 s after it started, whatever the clock. Viewers see no countdown.
- **The team** is the one the `Penalty` gives, whatever team its result gives.
- **"Penalty scored" no longer plays the goal** while the penalty's layer is on:
  it plays the penalty's kick, and no goal, no wait for the goal's scorer, and a
  `Player scored` after it plays nothing. With the layer off it plays the goal,
  as before. A penalty missed, which played nothing, plays the kick over the
  bar.
- A goal takes over from the penalty, and none of the penalty's labels plays
  while a goal shows: a `Penalty`, `Penalty scored` or `Penalty missed` then
  plays nothing, then or after the goal. The penalty takes over from an attack,
  the attack over a player loss, a corner, a free kick, a throw-in and the label
  cards, and none of them starts while it shows; the yellow and red cards and
  the substitutions wait their turn. Live, a replay playing ends, and none
  starts while it shows. The zoom near goal eases out to the whole pitch for it,
  and back in after.
- **In a replay** in live mode none of the penalty's labels plays anything: the
  clip shows the kick as it was played. A penalty scored in a clip plays no goal
  either, unless the layer is off. A human's `Penalty missed` is now kept for a
  replay as a shot on goal is.
- With reduced motion nothing fades and nothing turns or sways: the card, then
  the scene, then the kick's end with its banner, each whole.

### For pages that embed it

- `trigger('penalty', team)` plays the card and the scene waiting, for 4 s;
  `trigger('penaltyScored', team)` and `trigger('penaltyMissed', team)` play the
  scene with that kick. `availability()` has `penalty`, `penaltyScored` and
  `penaltyMissed`, and the three send `moment` events: `penalty` while it shows,
  and `penaltyScored` or `penaltyMissed` from its result's label to its end.
- Its layer is `penalty`, on by default, "Penalty" in the layers menu.
- `TrackerText` has `penalty` ("PENALTY", 点球), `penaltyWaiting` ("PENALTY..",
  点球……), `penaltyScored` ("SCORED!", 罚进了！) and `penaltyMissed` ("MISSED!",
  罚丢了！), and a `penalty` layer entry. The Chinese is a draft, as the rest of
  it is.
- The penalty's pictures (its card's icon, the goal, both keepers and the
  kicked ball) are bundled as SVG, drawn through `data:` URLs, so `img-src
  data:` covers them. The ball waiting on the spot is a canvas conic gradient.

### Size

- The widget is 66.1 kB gzipped (budget 70 kB), up from 59.1 kB.

### Parity

- The goldens and baseline snapshots have no penalty labels, and are unchanged.
  The goal's tests that used `Penalty scored` as a goal's label now use it with
  the penalty's layer off, or expect the penalty: a deliberate change.

## [0.22.0] - 2026-11-13

### What you see

- **A throw-in the camera cuts away from shows a card across the middle**, from
  the match-summary design (viewport/eventThrowInExclusive): "THROW IN" and its
  icon, the team under it, and a pulse on the touchline where the ball went out,
  as everyone on the pitch and the ball fade out. Live, it is the card when the
  record the throw-in is labelled on is invalid, or its lookahead says an
  invalid one is due within 3 s; otherwise the small band along the bottom
  touchline shows, as before. The card stays for at least 2 s, and after that
  while the camera is away, and fades out as it is back. In replay mode, whose
  data says nothing of valid frames, the throw-in is always the band.

## [0.21.3] - 2026-11-13

### What you see

- **A human's label goes before an attack and a replay.** A goal waiting for its
  scorer took over from neither: the attack (and the attack over a player loss)
  stayed up, a new one could start, and a replay of an earlier moment played on,
  until the goal played, up to 6 s later. Now, as the goal is labelled, the
  attack showing goes, none starts while it waits, and a replay playing ends.
- **A throw-in, a foul, a shot or a header on goal** takes over from an attack,
  and from the attack over a player loss, and none starts while it shows, as for
  every other label. This is a deliberate change from video-annotation, whose
  throw-in shows alongside an attack: on perspecto.ai too, an attack no longer
  shows during a throw-in.

## [0.21.2] - 2026-11-13

### What you see

- **A scorer is named under the goal they follow, whatever team the goal's
  label gives**, with the team on their own label. Production gave a goal one
  team and its scorer the other three times running, and those goals showed no
  scorer.
- **A scorer never plays a goal of their own.** One with no goal waiting or
  playing, such as one labelled more than 15 s after the goal, played the whole
  goal again with their name; now it plays nothing, as one labelled too late to
  read already did.

## [0.21.1] - 2026-11-13

### What you see

- **A goal with its scorer lasts 6 s**, where it lasted 3.2 s, so the scorer
  and their team are readable: the GOAL banner and the scorer's band are up in
  full for about 4.7 s, where it was about 2 s. The view stays in on the goal
  while they are up, and eases back out at the end. A scorer who comes while
  their goal plays makes it last 6 s too. One who comes as it closes (from
  2.6 s in) or later is too late to read, and is not shown. A goal without a
  scorer still lasts 3.2 s, as video-annotation's does.

## [0.21.0] - 2026-11-13

The goal names its scorer, and every label names its team on production too.

### What you see

- **Labels name their team on production.** The cards, the substitutions, the
  corner, the free kick and the goal disallowed showed no team on production:
  its labels give the team's id in its backend as `team_id` (807 for
  Australia), where staging gives the side (0 or 1). The side is now the
  label's `is_home` on a label that names a team, else its `team_id` when that
  is 0 or 1, so a substitution joins its team's card and a card's player is
  looked up in that team's roster as on staging.
- **A label's team name** is the host's for its side (`teams`), else the
  labelling tool's name on the label (`team_name`, "Australia"), else "Red" or
  "Blue". On staging, without names from the host, that is the labelling tool's
  "Team Home" or "Team Away" where it was "Red" or "Blue".

- **The scorer under the goal.** The labelling tool labels a goal and then, a
  few seconds later, its scorer (`Player scored`). Once the scorer is known, the
  goal names them under its banner, in a band across the foot of the pitch, as
  the match-summary design has it (viewport/eventGoalScorerInfo): the scorer's
  icon and name, and their team's name under it. The name is the one in the
  `teams` option's `players`, else the label's, else the shirt number; the team
  is its name in the `teams` option, else "Red" or "Blue".
- **Live, a goal waits up to 6 s for its scorer**, and plays when they come. With
  none by then it plays without, 6 s after its label. The shot is the one on the
  goal's record. On staging the scorer came 2.4 and 4.8 s after the goal.
- **Replays in live mode** wait for a goal waiting for its scorer: the goal
  plays first, as it did before it waited.
- **In replay** the goal still plays on its label, as video-annotation's does. A
  scorer whose label comes while it plays is named under it, fading in. A scorer
  with no goal labelled in the 15 s before plays a goal of their own; one that
  comes after their goal is over plays nothing.

## [0.20.0] - 2026-11-13

The free kick is back: the widget's own, from the match-summary design.

### What you see

- **The free kick.** On a human's free kick label (the labelling tool's
  `Freekick`, or `Free kick` however it is written), the spot where the ball was
  as the label came is marked by a pulse of three rings, lighting up one after
  another from the middle out, and the half of the pitch without the ball is
  shaded. "FREE KICK" and its icon show on a card in the middle of that half,
  with the team the label gives under it. Everyone on the pitch, the ball and
  its trail fade out, as for a corner.
- **Where the ball was** is the ball on the labelled record, or, with none
  tracked there, the last one tracked in the 5 s before it, as the throw-in goes
  by. It stays put as play goes on. With no ball known, the card shows alone
  across the middle, with nothing shaded.
- **Held as the corner is:** at least 2 s, then for as long as the label is on
  or play is stopped. A corner and a free kick take over from each other, the
  latest showing; a goal takes over from both. The free kick takes over from an
  attack, the attack over a player loss, a throw-in and the label cards, and
  holds them off while it shows, as the corner does.
- **Replays in live mode** wait for a free kick as they do for a corner: no
  replay plays while one shows. Live play holds its last valid frame while the
  camera is away, so a free kick labelled just before a cutaway stays up through
  it, and that cutaway plays no replay; the clip is kept for the next one.
- This is not video-annotation's free kick, a card across the middle with no
  ball or shade, which the widget dropped in 0.2.0 and still doesn't show.

### For pages that embed it

- `'freeKick'` is a `ReplayMoment` again: `trigger('freeKick', team)` plays it
  for 4 s at the ball on screen, and `availability()` has a `freeKick` field.
  A free kick sends `moment` events as the other moments do.
- Its layer is `freeKickBanner`, on by default. It is not `freeKick`, the key of
  video-annotation's free kick layer: a browser that kept that switched off
  would otherwise hide this one without anyone choosing to.
- `TrackerText` has a `freeKick` title ("FREE KICK", 任意球) and a
  `freeKickBanner` layer entry. The Chinese is a draft, as the rest of it is.
- The free kick icon is bundled again, so `img-src data:` covers it.

### Size

- The widget is 53.2 kB gzipped (budget 60 kB), up from 50.4 kB, mostly the
  free kick icon's path data.

### Parity

- The goldens are unchanged and still pass. The one that has free kick labels,
  `layers-off`, records the layer off; `trigger-each-moment` is still compared
  up to its free kick, which video-annotation drew as its own.

## [0.19.0] - 2026-11-13

The goal disallowed names the team.

### What you see

- **The team under the goal disallowed.** The goal disallowed card now writes
  the team's name under its band, as the corner does: the labelling tool sends
  the team with the label (`team_id`), and the widget names it by the `teams`
  option's name, else "Red" or "Blue". A label without a team, as the exports'
  are, shows the card as before. Played by hand
  (`trigger('goalDisallowed', team)`), it names the team the label on screen
  gives, else `team`.
- **The lines under the yellow and red cards and the substitution card** are
  where the design has them. The team's name is 5.5 design pixels higher, its
  baseline 78.5 below the band, no longer 84. The player, and each substitution
  row, is 8.45 higher, its baseline 168.55 below the band, no longer 177, with
  the small card and the badges on it.
- **A substitution card with three or more rows** rises a little less to keep
  its last row on the pitch: that row's baseline now ends at most 7.55 design
  pixels below the bottom touchline, as the design's five-row frame has it, no
  longer 10. Five rows rise 202, no longer 208.

## [0.18.0] - 2026-11-13

The corner names the team taking it.

### What you see

- **The team under the corner.** The corner now writes the name of the team
  taking it under its card, as the yellow and red cards do: the labelling tool
  sends the team with a corner label (`team_id`), and the widget names it by the
  `teams` option's name, else "Red" or "Blue". A label without a team, as the
  exports' are, shows the card as before.
- **Played by hand** (`trigger('corner', team)`), the corner names the team the
  label on screen gives, else `team`.
- **In a replay of an earlier moment** (live mode's flashbacks), the corner
  names its team too.

### Fixed

- **Cards and substitutions in a replay.** A yellow or red card, or a
  substitution, labelled within a replay's clip played with no team and no
  player, as the clips kept only a label's name. A replay now names them as
  live play does.

## [0.17.0] - 2026-11-13

The corner lights up the corner its label names.

### What you see

- **The corner from its label.** The labelling tool now has a button for each
  corner and sends it in the label: `Corner kick - Top left`, `Top right`,
  `Bottom left` and `Bottom right`, the corner as the camera sees it. The corner
  plays on these and lights up the corner the label names. These labels used to
  play nothing, as only `Corner` and `Corner kick` were a corner's.
- **The ball no longer picks the corner.** It used to be the corner nearest the
  ball, which was often the wrong one: a corner is mostly prepared off camera,
  with the ball lost or somewhere else. A corner label that names no corner
  (`Corner`, `Corner kick`, the exports' `EventType.CORNER_KICK`) now shows the
  card alone, without the cone.
- **In the second half** the corner is turned with the pitch: the camera stays on
  its touchline, so the camera's bottom left is the turned pitch's top right.
- **Played by hand** (`trigger('corner')`), the corner shows the card alone,
  unless the frame on screen carries a label that names a corner. It used to
  light up the corner nearest the ball.
- A flashback counts the new labels as corners too.

## [0.16.0] - 2026-11-12

Substituted players named as the labeller named them.

### What you see

- **Substituted players' names from the label.** The substitution card now
  names the player going off and the player coming on as the labeller did,
  where `teams.*.players` does not name them: the live stream sends the names
  in the label's `raw_data` (`human_label.items.player_name_out` and
  `player_name`), and the widget now reads them there. The host's `players`
  still comes first, and a player the label does not name still shows the
  number. A roster id above 99 the label names is now shown by that name.

## [0.15.0] - 2026-11-12

A carded player named as the labeller named them.

### What you see

- **A carded player's name from the label.** A yellow or red card now names the
  player as the labeller did, where `teams.*.players` does not name the shirt
  number: the live stream sends the name in the label's `raw_data`
  (`human_label.items.player_name`), and the widget now reads it there. The
  host's `players` still comes first, and a label with no name (`null`, or
  `None` as the stream sends for a substitution) still shows the number.
  Substitutions are unchanged: their label's one `player_name` names neither
  player.

## [0.14.0] - 2026-11-12

Substitutions, a team's listed together on one card.

### What you see

- **Substitutions.** A human's substitution label (`substitute`, as the
  labelling tool sends it) plays a card across the middle of the pitch:
  "SUBSTITUTION" over an up and a down arrow, the team's name, and a row per
  substitution, the player going off, a red and a green chevron, the player
  coming on, named from `teams.*.players` or by shirt number. The players come
  as roster ids and are read as shirt numbers; one above 99 is not shown unless
  named. A substitution for the same team while the card is up joins its list,
  fading in, up to 5, the card gliding up to keep them on the pitch, and the
  card stays 5 s from the last. One for the other team, a 6th, or one arriving
  as the card fades out plays as its own card, after. Chinese: 换人.

### API

- The moment, layer and `trigger` key `substitution`, in `MomentAvailability`
  and `ReplayLayers` too: a TypeScript literal of either type now needs it.
- The text key `substitution`.
- The package bundles one more font file, Inter Regular
  (`inter-latin-400-normal.woff2`), beside the others.

## [0.13.0] - 2026-11-12

Yellow and red cards, with the team and the player.

### What you see

- **Yellow and red cards.** A human's `Player yellow card` or `Player red card`
  label (also `Yellow card`, `Red card`) plays a card across the middle of the
  pitch, as the VAR check's: "YELLOW CARD" or "RED CARD" over a hand holding up
  the card, then under the band the team's name in Inter Black and a small card
  in the card's colour before the player, named from `teams.*.players` or by
  shirt number ("#9"). The team and the number come with the label on the live
  stream; a label without them shows no team, or no player. Every card plays:
  one that cannot play yet (a goal, a corner or another centre card on screen)
  waits its turn, cards play one after another in the order they came, each
  fading out before the next fades in, a card cut short before its 2 s plays
  again, and a label seen on several records is one card. A card landed on by a
  seek or seen while paused is not played, and a seek, a pause or a press lets
  go of the cards waiting. Chinese: 黄牌, 红牌, and
  "9号" for a player with no name.

### API

- `teams.home.players` and `teams.away.players`: names by shirt number, for
  the cards.
- The moments, layers and `trigger` keys `yellowCard` and `redCard`, in
  `MomentAvailability` and `ReplayLayers` too: a TypeScript literal of either
  type now needs them.
- The text keys `yellowCard`, `redCard` and `playerNumber` (with `{number}`).
- The package bundles one more font file, Inter Black upright
  (`inter-latin-900-normal.woff2`), beside the others.

## [0.12.2] - 2026-11-12

Live mode sees every label a human gives.

### What you see

- **Live mode no longer misses a human's label.** The live stream puts a
  label on one record alone, and records arrive in bursts, so the next record
  often came before the screen's next frame, which shows only the newest.
  The label was then never seen: its moment (a goal, a corner, a VAR check and
  the rest) did not play, and it was not listed bottom left. In one test on
  the staging stream, 6 labels of 23 were lost that way. Now a label on a
  record the screen skipped is seen on the next record shown, a frame later.
  A label from before the widget went out of view, or the tab was hidden, is
  still let go.

## [0.12.1] - 2026-11-11

A penalty scored plays the goal.

### What you see

- **A penalty scored plays the goal.** The ball rolls into the net, the camera
  frames the goal and, in live mode, the moment is kept for a replay, as for a
  `Goal` label, when a human labels a frame `Penalty scored` (the labelling
  tool's button), however it is written (`PENALTY_SCORED`,
  `EventType.PENALTY_SCORED`, `PenaltyScored`), or `Penalty goal`, `Penalty
  kick scored`, `Penalty kick goal` or `Scored penalty`. Before, only `Goal`
  played it. A penalty given
  (`Penalty`), missed or saved still plays nothing, and a penalty scored
  followed by a `Goal` label is one goal.

## [0.12.0] - 2026-11-10

No zoom or pan by hand, replays that agree with the picture when `raw_data`
stops, and a pitch of another size drawn to its own size.

### What you see

- **The viewer can no longer zoom or pan the pitch.** Only the animations
  move the view: a goal's camera and the zoom near goal. Ctrl or ⌘ + wheel, a
  trackpad or two-finger pinch, a drag and a double-click on the pitch now do
  what they do on any picture in the page, so the page scrolls and zooms as
  usual over the widget. The zoom badge, the grab cursor and the "Double-click
  to reset the zoom" tooltip went with them.
- **In live mode, replays take frames without `raw_data` the way the picture
  does.** When a stream stops sending `raw_data`, the picture counts its frames
  as valid again once the lookahead's reach (10 s on staging) has passed. The
  replays did not: they kept taking those frames for the run they last heard
  of. So a moment in them, a goal say, was never kept for a replay, and a replay
  under way ran on to its clip's end over live play the picture already showed.
  Now both go by one rule. Those frames are kept and their moments are
  replayed later, and a replay under way ends with live play, within 1.5 s of
  the lookahead running out, as a replay ends on a frame that says nothing.
- **A frame on another pitch is drawn to it.** The pitch's size was taken from
  the first frame drawn and kept for good, so a widget shown a match on a
  pitch of another size (after a reset, or on a stream that changes match)
  placed its players and markings on the first pitch, while the goals and the
  attack's shade followed the new one. Every match so far is on a 105 by 68 m
  pitch, so nothing has looked wrong yet.

### API

- Removed the `zoomLevel` and `zoomReset` keys of `TrackerText` (and so of
  `TrackerTextOverrides`): nothing shows them now. A host that overrides
  either gets a type error, and can drop the override.

## [0.11.0] - 2026-11-10

Replays of earlier moments while the live camera is away, invalid frames
covered without a blink, and a smaller package.

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
  that stops sending `raw_data` never leaves the picture held. A stream that
  never sends `raw_data` is unchanged, and so is replay.
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
- **Live play always comes first**: a replay ends at once on a frame that says
  it is valid (riding valid gaps under 1.5 s, as the attack does; a frame that
  does not say never ends it, and when the run's countdown runs out with no
  frame saying so, it waits 1.5 s at most for one that does), on a moment a
  human label starts in live play, on a press on the pitch, on `trigger()`,
  when the widget comes back into view, and on `reset()`. After a press or `trigger()`,
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

- **The package is 211.2 kB packed and 425.1 kB unpacked, in 44 files**, the
  replays included, down from 235.4 kB, 513.9 kB and 77 files.
- **The code is minified in full**: `dist/index.js` is 133.00 kB, 45.08 kB
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
