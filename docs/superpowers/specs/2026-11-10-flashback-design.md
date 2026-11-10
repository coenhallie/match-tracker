# Flashback: replays of earlier moments while the live camera is away

Status: built, 2026-11-10. This reads as what was built; where the build
settled something the design left open, it says so.

## Why

In live mode the pipeline marks records invalid while its camera is away. It
keeps sending every player and the ball, with made-up positions. Since 0.10.0
the widget holds the last valid frame and covers any run of 1 s or more with an
attack (`src/director/playerLoss.ts`). That works for short runs, but long runs
are common: on about 10 minutes of staging data, 9 of 19 invalid runs lasted 5 s
or more, about one a minute, the longest 40 s. Half a minute of a held frame
under an attack tells the viewer nothing.

For those long runs the widget shows something worth watching instead: a
replay of an interesting moment from earlier in the match, a goal, a corner, a
shot, or an attack that reached the penalty area. Each replay is clearly marked
as the past, with how long ago it happened, and gives way to live play the
moment live play is back.

This replaces the "Back in a moment" card that the earlier spec ("Invalid
frames cover - spec", Claude Doc, 2026-11-09) planned as the final cover. The
attack cover stays, as the fallback.

## Names

On screen it says "REPLAY". In code and the public API it is **flashback**,
because "replay" already means three things here: the widget's replay mode,
`ReplayMoment`/`ReplayLayers`, and accio-match-share's video replay of ended
matches.

## Goals

- In live mode, a run of invalid records that will last 5 s or more plays
  earlier moments instead of the held frame.
- Only human labels and positions decide what is interesting. AI labels never
  do.
- Each moment plays at most once. Once played, it is gone.
- Live play always wins: valid frames, or a human label played live, end the
  replay at once.
- The viewer always knows it is a replay and how long ago the moment was.
- It can be switched off from the layers list, and off means exactly today's
  behaviour.

## Non-goals

- No change in replay mode. video-annotation's viewers see nothing new, and the
  goldens and baseline snapshots stay untouched.
- No scrubbing or picking replays by hand. There is no UI to call one up.
- No naming the kind of moment on screen. The tab says REPLAY and the time,
  nothing else; the clip's own goal banner or card says what it is.
- No keeping clips across `reset()`, a reload or another match.

## Anti-goals

These would make it a failure even if it technically works:

- A replay that could pass for live play.
- A replay that holds back live play, even briefly, once valid frames are back.
- The same moment shown twice.
- Flicker: the replay blinking off and on, or a clip used up in a fraction of a
  second, on a stream that splits runs.
- The host page's memory growing without bound over a 90 minute match.

## What the viewer sees

### The look

From the Figma design, Game Animation Visualizer
(https://www.figma.com/design/a1DQtbTjxZYWYKecizCHkf/Game-Animation-Visualizer?node-id=81-4738),
`viewport/replayCoverage/left` (node 81:4738) and `/right` (81:4849), on the `pitchViewport` component's
`replayLeft` (62:601) and `replayRight` (62:702) variants. Sizes are in design
pixels, drawn through `designUnit` like every other card, so they keep their
size against the pitch at any frame size.

- **Stroke**: a white stroke, 12 design px, round the whole frame (the canvas,
  not the phase row above it).
- **Tab**: a white box in a bottom corner, 12 design px in from the frame's
  edges (inside the stroke), padding 16 above and below, 16 on the outer side
  and 32 on the inner side, 4 design px radius on its one corner that faces the
  pitch. In it:
  - "REPLAY", Inter Black Italic 64 px on an 80 px line, `#166a51`, text shadow
    0 4 24 black at 15%. As the design has it.
  - The timer after it, e.g. "2:47 AGO", Inter Black Italic, smaller (about 36
    px on the same 80 px line, baseline-aligned), the same green at about 62%
    opacity, tabular figures. Not in the design; agreed from the mockup.
  - A progress line along the tab's bottom edge, about 6 design px, the same
    green at about 35%, its width the share of the clip still to play. Not in
    the design; agreed from the mockup.
- **Pitch**: full colour. Nothing else of the pitch changes: the clip is drawn
  as live play is, its own moments included.
- **Side**: the tab goes in the bottom corner of the half the moment is *not*
  in, judged from the ball at the moment's time, so it never covers the action.
  Ball in the right half: tab bottom left (the design's `replayLeft`). Left
  half: bottom right (`replayRight`). No ball or exactly on the halfway line:
  bottom left. The right tab mirrors the left one: the rounded corner and the
  wider padding swap sides. The right frame could not be read in detail (Figma
  rate limit), so check it against 81:4849 when building.

The look was agreed on a mockup: the real widget playing a real clip, with the
stroke, the tab, the timer and the progress line laid over it in HTML. The real
one is drawn on the canvas.

### The timer

It is the time since the moment, so it keeps ticking through the clip:
`m:ss AGO` ("0:45 AGO", "2:47 AGO", "62:10 AGO"). It is worked out from record
times, not the wall clock, so a stalled stream does not run it on: the newest
live record's `t` minus the moment's `t`. Both strings are text keys, in en and
zh (see API).

### In and out

- The stroke and tab fade in over the attack's `ATTACK_IN_MS` as the first clip
  starts, and out over `ATTACK_OUT_MS` when the last one ends.
- From one clip to the next the stroke and tab stay. The pitch cuts to the next
  clip; the timer and the progress line start again for it; the tab moves if
  the next moment is in the other half.
- When live play takes over, the pitch is live at once. Only the stroke and tab
  fade, over live play.
- While a replay shows, the HUD controls glide clear of the stroke: the layers
  button and the badges keep inside it, and the zoom badge sits above the tab
  when the tab is bottom right. They glide there and back over 200 ms, and go
  back once the stroke has faded out (at once on `reset()`).
- With reduced motion, nothing fades and the HUD controls jump.

## Behaviour

### What counts as interesting

Noted as they happen in live mode, from valid records only:

| Kind | From | Moment's time |
| --- | --- | --- |
| Goal | a human goal label | the label's first record |
| Corner | a human corner label | the label's first record |
| Shot on goal, header on goal | their human labels | the label's first record |
| Attack near goal | positions: the ball goes into the penalty area of the goal the team in possession attacks (`teamPhase` possession and `attacks`) | the record it goes in on |

- "Human" is `isHumanLabel` (`action_origin: 'human'`), as every moment uses.
  AI labels never make a moment, whatever `aiLabels` says.
- A label is noted once per run of it, as the moments already treat labels.
- An attack near goal re-arms only after the ball has been out of that penalty
  area for 15 s, so one spell of pressure is one moment.
- If two moments fall in one clip's window, the clip is the more important one,
  and the other is dropped. Order: goal, corner, shot or header, attack near
  goal.
- Real staging and production captures have no human labels at all, so in
  practice most clips will be attacks near goal (about one a minute). Labels
  matter when a human labeller is on the match.

### Clips

- A clip is the records from 8 s before the moment to 4 s after it. When it
  plays, it may be trimmed to fit the run (below).
- Only valid records go in a clip. The records before a run of invalid ones
  end the clip early: a clip whose after-part was cut short by invalid records
  is still kept, as long as the moment itself is in it. A moment whose
  before-part has invalid records in it starts its clip after them.
- A clip also keeps the 10 s of records before its first shown one
  (`HISTORY_S`), so the team phase and the ball trail are right from the clip's
  first frame (`deriveAt` over the clip's own records).
- A clip is ready to play once its after-part is in, or cut short.
- Clips are kept until played, until 15 minutes after their moment, or until
  `reset()`, whichever comes first. Up to 8 are kept: a new one over the cap
  drops the least important, then the oldest. A forward gap in the records,
  however long, does not drop them. A jump back in record time of more than
  10 s (what `LiveHistory` counts as a break: the pipeline started again, its
  clock with it) drops them all, since their ages, expiry and order are all in
  the old clock. (Builder's call.)
- Memory: store only what the renderer and the analysis read from a record,
  and store records that overlapping clips share once. A record kept only for
  a clip's lookback is thinned to what the phase and the trail read. The store
  stays under 20 MB at its cap: on the worst case, 8 clips with separate
  lookbacks from real staging records, its retained heap measures about 19 MB.

### When a replay plays

- A clip starts when all of these hold: the layer is on; the newest live record
  is invalid; the run has 5 s or more to go (`validity.nextValidInS >= 5`, or
  null with `horizonS` set, which means 10 s or more); no live moment is
  showing that a human label started; and a clip is ready.
- Which clip: the most important unplayed one, the newest of its kind.
- As it starts, the clip is marked played, whatever happens next.
- **Fit to the run.** `nextValidInS` is exact to the frame for runs under 10 s,
  so the time left is known. If the clip is longer than that, its before-part
  is trimmed so the moment lands inside the time left with at least 2 s after
  it, keeping at least 1 s before the moment. If even that does not fit, the
  end is cut too. With null (10 s or more), the clip plays whole. A run of
  5.3 s still shows its goal.
- **One after another.** When a clip ends and the run still has 5 s or more to
  go, by the newest live record, the next unplayed clip starts, fitted the same
  way. When there is none, or under 5 s are left, the attack cover shows for the
  rest of the run, as today.
- **Cut off.** The replay ends at once when:
  - a live record says it is valid (`validity.invalid === false`), subject to
    the short-gap rule below. A record with no `validity` never ends it: on the
    default socket about 14% of copies came without `raw_data`, and treating
    them as valid would cut every clip within a second;
  - the live director starts a moment from a human label (a goal, a corner, a
    card or a throw-in on an invalid record). When that moment ends, the next
    clip may start if the rule above holds;
  - the layer is switched off, or `reset()`, or the widget goes out of view and
    comes back (a seek), or the stream breaks (a jump back in record time of
    more than 10 s). None of these holds off the next replay: it may start as
    soon as the start rule holds;
  - the viewer presses the pitch or the overlay, which the README says stops
    every moment, or the host calls `trigger()`, which then plays on the live
    frame. A replay is treated as a moment here: anything that means someone
    wants the real frame stops it. The clip counts as played. These two hold
    off further replays until the live run ends (a valid record not in a short
    gap) or `reset()`. (Builder's call.)
- **Records with no validity.** A live record with no `validity` neither
  starts, chains nor ends a replay: the last known validity is carried forward,
  its countdown aged by record time. A carried state whose countdown has run out
  is a guess, and a carried null countdown loses its horizon once 10 s (its
  `horizonS`) have gone with no record saying more: either may keep a clip
  going, but neither starts or chains one. (Builder's call.)
- **Short valid gaps.** The replay plays on through a valid gap under 1.5 s
  (`MERGE_GAP_S`, as the attack cover does): a valid live record whose
  `nextInvalidInS` is under 1.5 s does not end it. Real runs are split this
  way: in the staging data a 0.28 s valid gap joins a 4.1 s and a 7.4 s run,
  and cutting there would show a quarter second of live play and use up the
  clip.
- **A clip that runs out at a gap holds its last frame.** A clip fitted to a
  run under 10 s ends with the run, so it runs out at the gap. It then holds
  its last frame, the tab up and the progress line run down, through the gap,
  and the next invalid record decides: the next clip follows if the start rule
  holds, and the replay ends if not. It holds too when the clip runs out just
  before the gap, while the newest record that says its validity is invalid
  with its run about to end (a valid record due within 1.5 s): the clip is
  fitted in record time but plays on the wall clock, so live records that come
  a little late have it run out on the run's last records. Only a record that
  says its validity decides: the run's own last records decide nothing until a
  valid one has come; a valid record in a short gap keeps it holding; one
  outside such a gap ends it at once. The hold is bounded from when the clip
  ran out, by the run's countdown left then (under 1.5 s, none in a gap) plus
  1.5 s, so a stalled stream does not keep the frame up. A live label moment,
  the layer going off and the cuts above end it at once. A split run is one
  replay, with one `flashback` `end`. (Builder's call.)

### Live play underneath

The live director keeps running on live records throughout, unpainted, so
labels on invalid records still play, half labels still turn the pitch, and the
attack cover is already up when the replays run out. The clip is played by a
second, separate director, so nothing in the live one is wiped by jumping into
and out of clips.

### The layer

- A new layer, `flashback`, "Replays while the camera is away", hint "An
  earlier goal, corner, shot or attack near goal, each played once, while the
  live camera is away for 5 s or more". On by default.
- Listed in the layers menu only in live mode, so video-annotation's menu does
  not change.
- Off: invalid runs are covered by the attack (`playerLoss` layer) exactly as
  today.
- With `playerLoss` off and `flashback` on, replays still play, and when they
  run out the held frame is left uncovered, as today with `playerLoss` off.

## How it is built

The parts the conversation settled, and the hook points the investigation
found. File references are as of 0.10.0.

- **Recorder** (new, `analysis` for the "is this interesting" test, `history`
  for the store). Fed from `push()` in `src/widget/createMatchTracker.ts`
  (around :457-471) with every parsed record, after `history.add`. It cannot
  live in `LiveHistory`, which keeps only 10 s and clears on a stream break.
  The near-goal test uses `teamPhase` and the penalty area from
  `pitchGeometry`/`resolvePitchDimensions`; the label tests use
  `actionLabels.ts`. `src/analysis/goalApproach.ts` (`approachWeight`) is a
  related positional measure, for reference.
- **Clip player**: a second `Director` with `coverInvalidFrames: false`, driven
  as replay mode drives its director (`createMatchTracker.ts` :701-718): the
  clip record at the clip's own time, `playing` true, phase and trail from
  `deriveAt` over the clip's records. Its `time` keeps increasing across clips.
  Its records never go through `halves.see`; `halves.shown(record)` turns them
  for the second half by their own `t`, so a clip from the first half shows the
  first half's ends.
- **Switching**: in `nextInput`, live branch (:679-700), choose what is painted:
  the clip director's frame while a clip plays, the live director's otherwise.
  The live director is updated on every tick either way.
- **The view** (builder's call): the viewer's own zoom and pan are one, kept
  across every switch, and a zoom made during a clip carries on into live
  play. Each director's automatic camera (the goal camera, the zoom near goal)
  is its own, and only the painted director's shows. So a clip's goal zooms in
  the clip, and when live play takes over, the live director's camera is what
  shows, not the clip's.
- **Outside the canvas** (builder's call): the phase row follows the pitch on
  screen, so it shows the clip's phase during a replay; the stroke and tab say
  it is a replay. `trigger()` and `availability()` stay on the live director.
- **When live play takes over**, the live director's attack cover, if it is
  up, is ending too (its records are valid again) and fades as it does today.
- **Events**: the clip director's moments never reach `MomentWatch` (the
  `moment` event) or `availability`. `moment` keeps meaning "came on screen, or
  went": the live director's moments are not on screen during a replay, so they
  start no `moment` event then. The host instead gets a new event,
  `flashback`, `{ phase: 'start' | 'end', at: number }`, `at` being the moment's
  record time; `start` for each clip, `end` when the last one ends or is cut
  off.
- **Drawing**: a new optional slot in `FrameLayers` (`src/render/renderer.ts`),
  drawn last, fixed to the frame like the goal banner; the stroke and tab in a
  new `src/render/flashback.ts`, reusing `fitText`, `designUnit` and the title
  font from the theme.
- **Debug badge**: with `debug` on, it says when a replay is playing and the
  run's countdown, from new text keys.
- **The old comment**: `playerLoss.ts` says it covers invalid frames "for now,
  until the cover the spec has in mind is built". Update it to say the attack
  is the fallback under flashbacks.

### Public API (CHANGELOG lines needed)

- Layer key `flashback` and its menu text (en, zh).
- Event `flashback`.
- `TrackerText` keys `flashback` ("REPLAY"; zh "回放") and `flashbackAgo`
  ("{time} AGO"; zh "{time}前"), and the debug badge's keys.
- README: the layers list, the events table, the Invalid frames section.

### Tests

- No fixture carries validity. Build a trimmed fixture from the staging capture
  (`/Users/coenhallie/projects/once-experiment/captures/staging-620749bb.jsonl.gz`)
  with its `raw_data` validity, and add human labels in the test where needed,
  as the goldens' tests mark theirs human.
- Cover: what is noted and what is not (AI labels, invalid records); dedupe and
  priority; the store's cap, expiry and memory budget; start only at 5 s or
  more; fitting to the run, including a 5.3 s run; chaining; cutting off on a
  valid record but not on one with no validity; a live human label cutting it;
  played-once; layer off is today's behaviour; replay mode unchanged; timer from
  record times; the tab's side; reduced motion; the `flashback` event; `moment`
  events not fired by clips.
- Goldens, baseline snapshots and `test/dist` stay passing, untouched.
- `npm run size` stays under 60 kB gzipped.

## Known limits

- Production streams carry no `raw_data` today, so this only plays where the
  pipeline sends validity (staging).
- accio-match-share calls `reset()` on every reconnect, which drops the clips.
- With no human labeller, nearly every replay is an attack near goal.
