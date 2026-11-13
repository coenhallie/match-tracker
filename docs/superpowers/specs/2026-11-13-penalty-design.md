# The penalty

Status: designed, 2026-11-13. Not built.

## Why

A penalty is one of the biggest moments in a match, and today the widget shows nothing for it
until the ball is in: "Penalty" plays nothing, "Penalty scored" plays the ordinary goal, and
"Penalty missed" plays nothing. The Figma file "Game Animation Visualizer" has a penalty flow: a
card when the penalty is given, a scene of the taker's view of the goal while everyone waits for
the kick, and the kick itself, scored or missed. A viewer should be able to follow the penalty
from the moment it is given to the moment it is decided, then be back on the live pitch.

## Goals

- A human's "Penalty" label plays a centre card ("PENALTY", the penalty icon, the team), then a
  penalty scene: the goal, the keeper and the ball, waiting for the kick.
- A human's "Penalty scored" or "Penalty missed" label plays the kick in that scene: the ball
  curving into the top corner past the keeper's late dive ("SCORED!"), or over the bar
  ("MISSED!"). It holds, then fades back to the live pitch.
- "Penalty scored" plays this instead of the goal sequence (the user's decision).
- With no result 20 s after the "Penalty" (on the clock), the scene fades back to the live pitch
  (the user's decision: a penalty can take a long time to be taken).

## Non-goals

- The taker's name: Figma's frames 5 and 6 (`viewport/eventPenaltyScoredPlayerInfo`,
  `viewport/eventPenaltyMissedPlayerInfo`) are left for later (the user's decision). The stream
  sends no taker for a penalty today (see The data).
- Telling a save from a shot wide or over: the label does not say, so a miss always plays the
  over-the-bar kick from Figma.
- Cancelling a penalty: the labelling tool's Cancel sends nothing (see The data), and nothing
  else stands for it (the user's decision). An unanswered penalty runs out its 20 s.
- The "walk back" in the Figma ideation board (players walking back after the kick): the
  live pitch simply fades back in.

## Anti-goals

- A penalty that hangs: whatever happens, the scene is gone 20 s after its Penalty with no
  result, and a few seconds after its result.
- A goal shown twice: a "Penalty scored" plays the penalty's kick, never the goal sequence as
  well.
- The wrong team: the team is the Penalty label's, not the result's (see The data).
- Anything changing for viewers when no penalty label comes: the goldens and baseline snapshots
  pass untouched.

## The data

Seen on the staging stream on 2026-11-13, seven penalties pressed by the user:

| Button in the labelling tool | `action_type` | `action_id` |
|---|---|---|
| Penalty | `Penalty` | 18 |
| Penalty scored | `Penalty scored` | 25 |
| Missed | `Penalty missed` | 26 |

- All three are game labels (`human_label.obj: "game"`), each on one record, in
  `match.state.actions[]` with `action_origin: "human"` and `team_id`. None is in
  `teams[].actions`.
- `human_label.items` gives `team_id` (0/1 on staging; a backend id on production),
  `team_name`, `is_home` ("home"/"away") and `player_name: null`. Read the team as the other team
  labels are read (`teamOfLabel`, cardLabels.ts in analysis).
- From Penalty to its result: 4.0, 3.2, 3.5, 3.2, 2.7, 3.0 and 2.1 s, pressed quickly on staging;
  in a match it can take much longer (the user).
- One pair gave the Penalty "Team Away" and its result "Team Home", as production has given a
  goal and its scorer different teams. The Penalty's team is the one shown.
- No player label followed any result.
- The labelling tool (`datalabelling-frontend`, `src/components/StateControls.vue`): pressing
  Penalty locks the other buttons and leaves Cancel, Penalty scored and Missed. Cancel only
  unlocks the buttons: it sends nothing.
- "Penalty scored" is one of the goal's label names today (`GOAL_LABELS` in goalSequence.ts in
  analysis, with its other spellings: "penalty goal", "penalty kick scored", "penalty kick goal",
  "scored penalty"), and the goal's scorer wait treats it as a goal (goal.ts, scorerLabel.ts).
  All of those spellings are the penalty's "Penalty scored"; "goal" alone stays the goal's.
- Match the names through `actionName`, as every label is: "Penalty missed" also as
  "PENALTY_MISSED", "PenaltyMissed" and so on, as goalSequence.ts does for "Penalty scored". "Penalty"
  alone is matched whole, so it is neither of the other two.

## What the viewer sees

From the Figma file `a1DQtbTjxZYWYKecizCHkf` ("Game Animation Visualizer"), page "designs",
section "Events". Every frame is 1600 × 1100, and every position below is in that frame's units.
A throwaway mockup built from these frames was reviewed with the user in the brainstorm; this
section is what it settled.

### 1. The card: `viewport/eventPenalty` (node 136:2438)

A centre label card, like the goal disallowed's: the band with "PENALTY" over the penalty icon
(component `Type=label, Size=medium, Name=penalty`, node 63:1004: a goal with a keeper, a yellow
up arrow and a ball), and the team's name under the band (`TeamName`, 665, 774). The players are
faded out under it, as under every centre card. It is drawn and fades exactly as the other centre
cards (render/labelCard.ts: `LABEL_CARD_IN_MS`, the band, the title, the team line): my call, for
consistency, over the mockup's own numbers.

It shows for 2.4 s from its start, fades included (the mockup's), then the scene fades in over
it.

### 2. Waiting: `viewport/eventPenaltyWaiting` (node 136:2587)

The pitch is covered by a plain green (`green`, 136:2763, the whole frame). On it:

| Piece | Node | Position | Size |
|---|---|---|---|
| Goal | 136:3140 | 160, 304 | 484 × 242 |
| Goal's shadow | 136:3143 | 160, 526 | 484 × 20 |
| Keeper, standing | 136:2918 | 306, 400 | 191 × 194 |
| Keeper's shadow | 136:3142 | 339, 569 | 126 × 50 |
| Ball, the "spinner" | 136:2913 | 338, 771 | 128 × 128 |
| Ball's shadow | 136:3141 | 340, 873 | 126 × 50 |
| "PENALTY.." banner | 136:2766 | 754, 64 | 846 × 160 |
| Team name | 136:2615 | 1042, 248 | 270 × 58 |

The ball is the Figma ideation board's "spinner ball effect while waiting": it turns on the spot,
one turn in about 0.8 s. The keeper sways from side to side, ±10 units, about once every 2.4 s
(sin of time over 380 ms), his shadow with him.

The scene fades in over 0.5 s (ease in and out) as the card fades out.

The "PENALTY.." banner and the team name stay on through the kick and the hold, as in Figma's
scored and missed frames, and leave with the rest of the scene.

### 3. Scored: `viewport/eventPenaltyScored` (node 136:3145)

The kick, 700 ms:

- The ball travels a quadratic curve from the spot (centre 402, 835) through the control point
  (400, 470) to the top corner (centre 566, 380; the ball 136:3191 at 529, 343, 74 × 74), easing
  out (cubic), shrinking from 128 to 74, turning one and a half times. Its shadow slides along the
  ground from (403, 898), 126 × 50, to the goal line (560, 551), 63 × 25 (136:3176).
- Behind it, a trail: the curve travelled so far, 16 wide with round ends, white from fully clear at
  the spot to 75% at the ball (`Line 1`, 136:3377, is Figma's).
- The keeper commits late: from 15% to 85% of the kick (ease out) he moves from his standing
  place to the dive (136:3192, 468, 348, 272 × 272), turning from -35° to 0°. Over the first
  quarter of his move the standing keeper cross-fades into the diving one. His shadow stretches
  from 126 × 50 to 178 × 37 (136:3177).
- When the kick ends, "SCORED!" (banner 136:3259, 302, 780, 996 × 240) rises 40 units into place
  and fades in, over 300 ms (ease out).

### 4. Missed: `viewport/eventPenaltyMissed` (node 136:3407)

As scored, but the ball's curve goes through (430, 420) to above the bar (centre 610, 228; the
ball 136:3457 at 573, 191), and when the kick ends it carries on for 500 ms to (640, 150),
shrinking to 54 and fading out. The banner says "MISSED!" (136:3458, 330.5, 780, 939 × 240).

### After the result

Scored or missed, the scene holds for 3 s after the banner is in, then everything fades out over
600 ms and the live pitch is back, as the user put it: "hold it a few seconds, then fade back to
the live pitch".

### Fitting the frame to the canvas

Laid out as every Figma frame is in the widget (freeKick.ts and labelCard.ts in render): design
pixels through `designUnit`, the design's middle (800, 550) on the pitch's middle, fixed to the
frame while the view zooms, as the cards are. The green fills the whole frame. So placed, the
scene's pieces, from the top banner (y 64) to the result banner's foot (y 1020), fall inside the
widget's 1280 × 720 frame (settled while planning, over an earlier "fit the frame whole"). The banners and text are the widget's own, drawn as its
other banners and its team lines are, not images.

### Words

Each in every locale (src/i18n), and in DEFAULT_THEME where the other titles are:

- `penalty`: "PENALTY" (the card's title, and the layer's name in the layers menu)
- `penaltyWaiting`: "PENALTY.."
- `penaltyScored`: "SCORED!"
- `penaltyMissed`: "MISSED!"

The Chinese are my call, to be checked: 点球, 点球……, 罚进了！, 罚丢了！.

## How it plays

One moment, the penalty, with these phases: card, waiting, kick, holding, leaving.

- **A Penalty label** starts it at the card, with the Penalty's team, and starts the 20 s wait on
  the clock (`time`, the replay's, as the goal's scorer wait counts it). After the card, waiting.
- **A Penalty scored or Penalty missed label** while it waits: the kick, then holding, then
  leaving. A result that comes during the card waits for the card to finish, then the scene fades
  in and goes straight into the kick.
- **A result with no penalty showing** (it came after the 20 s, or the widget joined after the
  Penalty): the scene fades in already in place (no card) and the kick plays at once, with the
  result's own team (my call).
- **20 s with no result:** leaving, from wherever it is (card or waiting). The 20 s are on the
  clock, which stands still when the live stream stalls, so the scene also leaves after 40 s of
  waiting on screen whatever the clock (settled while planning, so a stall cannot hang it).
- **A second Penalty** while one shows starts it again from the card, with the new team and a
  new 20 s (my call).
- **A second result** while one is playing is ignored (my call).

The countdown in the brainstorm's mockup was for testing: viewers see no countdown (my call).

### With the other moments

- It is a moment a human label starts, and goes with them: it takes over from an attack, a player
  loss, a throw-in, a set piece and any label card showing; none of those start while it shows
  (my call: as the goal does). Player cards and substitutions wait their turn in their queue
  (cardQueue.ts) until it has gone, as they wait for each other. It cuts a flashback, as any live
  label moment does.
- A "Goal" label (not a penalty) while it shows: the goal takes over (my call: the goal takes over
  from any moment, and that rule stays).
- A "Player scored" label after a "Penalty scored" plays nothing: frames 5 and 6 are left for
  later. It must not start a goal of its own (it does not today: a scorer with no goal plays
  nothing).
- "Penalty scored" must no longer be a goal's label wherever the penalty plays: the goal sequence,
  the goal's scorer wait, and anything else reading `isGoalFrame`. With the penalty's layer off it
  is a goal's label again, and plays the goal as today (my call: turning a layer off leaves the
  widget as it was without it).
- A seek or a step ends it and forgets a penalty waiting, as for every moment.

### Live and replay

The same in both. In replay the result is on a later record and could be known ahead, but the
penalty plays as the labels come, as it does live (my call). Like every moment it plays only during
playback: a pause, a seek or a step ends it, as it ends every moment (`stopSequences`; settled while
planning, over an earlier "the 20 s stand still").

### In a replay (the flashback)

In live mode, while the camera is away, the widget plays earlier clips of live play ("REPLAY",
flashback.ts, flashbackStage.ts), through a second Director. A goal in a clip plays its goal again
today. The penalty does not (the user's decision): in a clip, none of the three labels plays
anything, and the clip shows the tracked play, the kick on the pitch. The viewer has seen the
penalty live; the replay is there to show the play. In particular a "Penalty scored" in a clip
does not fall back to the goal sequence either.

What is spotted for a clip (flashbackSpotter.ts) does not depend on the layers (my call): a
"Penalty scored", in any of its spellings, is spotted as a `goal`, as today, and a "Penalty
missed" as a `shot`. A "Penalty" alone is not spotted.

### Played by hand

As every moment, it is a layer of its own (`penalty`, on by default) and can be played by hand
(`trigger`), with a team:

- `penalty` plays the card, then the waiting scene, and leaves after LABEL_CARD_DEMO_MS of
  waiting (my call: the demo has no result to wait for).
- `penaltyScored` and `penaltyMissed` play the scene with that kick, as a result with no
  penalty showing does (my call, so every frame can be shown by hand).

Each joins `availability`, the layers menu, NOTHING_AVAILABLE in the Vue entry, and the README's
lists of layers and moments, as the other moments are.

### Reduced motion

As the other moments under reduced motion: no fades, no turning ball and no swaying keeper. The
card shows whole, then the scene whole; a result shows the kick's last frame (the ball at its end,
the keeper diving, the banner) for the hold, and goes without a fade (my call).

## Constraints

- **Parity:** the goldens and baseline snapshots have no penalty labels, so they must pass
  untouched. The goal's tests that use "Penalty scored" as a goal's label (goalSequence.test.ts,
  scorerLabel.test.ts, goal.test.ts) change with this, deliberately, and say so.
- **Embedding:** nothing fetched. The artwork (the goal, both keepers, both balls, the card's icon)
  is inlined, as the icons are (src/assets/icons.ts), exported from the Figma nodes above as SVG.
  Both keepers are Figma frames with no vector children, so they may be flattened shapes or image
  fills. Nothing bitmap goes in the bundle: a keeper that is an image is redrawn as a vector
  matching its frame (my call).
- **Layers:** model, analysis, render, director, widget, as CLAUDE.md lays them out: the label names
  and the card in model, the label reading in analysis, the drawing in render, the phases and
  timing in director.
- **Size:** `dist/index.js` is 59.06 kB gzipped against a budget of 60 kB (2026-11-13), and this
  feature will not fit in the 0.94 kB left. The budget goes up to 65 kB (the user's decision), in
  the same change: `BUDGET` in scripts/size.mjs, the size line in CLAUDE.md's Commands and the
  README's, and the CHANGELOG entry gives the new size and budget, as earlier entries do.
- **CHANGELOG:** a change viewers see, described under Unreleased.

## What's left to the builder

- How the moment is built: one module or the card reused from labelCard.ts with a scene after
  it, whether the card is an entry in LABEL_CARDS, and how the scene's drawing is split.
- How the SVGs are exported and drawn (as images on the canvas, or as paths).
- The exact easing beyond what is given above, as long as it reads as the mockup did.
- Tests: the phases and their timing, each edge case above, a "Penalty scored" not playing a
  goal with the layer on and playing one with it off, the team taken from the Penalty, and the
  20 s timeout; and pixel checks of each frame against the Figma frames, as the cards had.
