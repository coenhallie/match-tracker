# Player cards: the yellow and the red card

Status: built, 2026-11-12. Where the build settled something differently, the
section says so.

## Why

The live stream now carries who a card was shown to. When an analyst presses
"Player yellow card" or "Player red card" in the labelling tool, the next
record carries the label with the team and the player's shirt number. Until
now the widget had no use for those labels: they played nothing. A card is one
of the few events a viewer always wants to see, so it gets a full-size moment
of its own, built from the label cards the widget already has.

## Goals

- A human's card label plays a centre card: "YELLOW CARD" or "RED CARD" over
  a hand holding the card, the team's name under the band, and a row with a
  small card in the card's colour and the player.
- The player is shown by name when the host gives one, by shirt number when
  it does not.
- It looks and moves like the VAR check card in every way the design does not
  change: band, title, icon slot, fades, timing, fading the people out.

## Non-goals

- Substitutions. They come next, on the same lines below the band, once the
  stream gives shirt numbers for both players.
- Showing the card on the player on the pitch. A card is attached to a
  tracked player only sometimes (`match.teams[].players[].actions`), and the
  card's frame is often an invalid one.
- Names from the stream. The stream has none; the host gives them.
- A second yellow becoming a red. Each label plays what it says.

## Anti-goals

- A card that does not play because another card came shortly before it.
  Two players can be booked within seconds.
- A player row that guesses: no name made up, no number shown that the label
  did not carry.
- Text that runs off the card or the pitch at any width.

## The data

Read from the human's label in `match.state.actions[]`, which since 0.12.2
reaches the director even when the screen skipped its record. The fields seen
on the staging stream on 2026-11-12, for five cards:

```json
{"action_type": "Player red card", "action_origin": "human", "action_id": 15,
 "uuid": "0a105541-…", "team_id": 0, "player_number": 3, "player_id": 3}
```

- `action_type`: "Player yellow card" (`action_id` 14) or "Player red card"
  (`action_id` 15). Matched through `actionName`, as every label is.
- `team_id`: 0 home, 1 away, as the tracking's teams and the `teams` option.
- `player_number`: the shirt number. `player_id` is the labelling tool's
  roster id and is not used.
- `uuid`: one per label.

The same card also appears in `match.teams[team].actions[]` and in
`raw_data.labels.human_label`; `state.actions` alone has all of it.

## What the viewer sees

From the two Figma frames (Game Animation Visualizer, `eventYellowCard`, and
the red card, node 78:3399), which the Figma MCP could not read; the user sent
screenshots and the icon's SVG. The screenshots, the reference for the sizes
below and for the check in Chrome:

- red: `~/Desktop/Screenshot 2026-11-12 at 08.20.21.png` (1552 × 1070)
- yellow: `~/Desktop/Screenshot 2026-11-12 at 08.20.14.png` (1556 × 1066)

### The look

- The band, the title and the icon slot are the VAR check's, unchanged:
  `src/render/labelCard.ts` (title 92 px Inter Black Italic on a 128 px line,
  the 208 px icon slot, 16 px padding and gaps, the band's colour stops).
- Titles: "YELLOW CARD" and "RED CARD"; in Chinese 黄牌 and 红牌.
- The icon: the hand holding a card, 208 × 208, the exported SVG
  (`~/Desktop/viewport/eventYellowCard/icon.svg`), filling the whole slot. The
  yellow and red exports differ only in the card's fill, `#EAB308` and
  `#EF4444`, so the shapes are kept once and filled per card.
- Under the band, both centred on the pitch's middle, both white and fading
  with the card:
  - the team's name, taken from the `teams` option as the attack's label
    takes it (default the colour it is drawn in); only the words are the
    attack's, not its font;
  - the player row: a small upright card in the card's colour, then the
    player's name, or "#9" for shirt number 9 when the host gave no name. The
    row as a whole, small card and text, is centred: in the screenshot its
    middle is within 6 px of the pitch's, where the text alone would be 40 px
    off.
- The people and the ball fade out as the card fades in, as for the VAR check.

### Sizes (measured)

Measured from the screenshots, whose scale is 0.957 screenshot px to one
design px (the title's cap height and the icon's height agree on it), then
snapped to the card's own scale. In design px, from the foot of the band:

| | |
|---|---|
| Team name | Inter 900 Black, upright, 48 px, line height 100%, white; baseline 84 below the band |
| Team name's shadow | 0 2 px 4 px, black at 50% |
| Player row | Inter 600 Semi Bold, 40 px, line height 64 px, white; baseline 177 below the band |
| Player row's shadow | 0 2 px 4 px, black at 25% |
| Small card | 32 × 44, in the icon's card colour (`#EAB308`, `#EF4444`), its middle on the middle of the capitals, the text 37 px after it (the letters' ink 40 px after it, as measured) |
| Player row | its middle 6 px right of the pitch's middle: measured in Chrome against both frames, which agree; the team name is centred |

The fonts, sizes, line heights, colours and shadows are Figma's (Dev Mode,
read by the user, 2026-11-12). The positions are measured from the
screenshots, as the frames themselves could not be read.

Inter 900 is bundled only in italic, for the titles, so the upright Black face
is bundled too: one more woff2 beside the others (its licence already ships),
with `check-dist`, the package's files and the README's font notes updated. It
is loaded as the other faces are, and a card drawn before it has loaded falls
back as a title does.

A name too long for the frame is drawn smaller to fit, as titles are
(`fitText.ts`), and cut with an ellipsis only if it still does not fit.

## Behaviour

- **What plays it:** a frame a human labelled "Player yellow card" or
  "Player red card" (also "Yellow card" and "Red card"), in either mode. An
  AI's label never does, as for every moment.
- **Timing:** as the VAR check: fades in over 0.4 s, stays at least 2 s and
  as long as its label is on, fades out over 0.4 s. Card labels sit on one
  record, so in practice about 2.8 s. The zoom near goal eases out while it
  shows.
- **Late labels:** played as soon as they arrive, however late the analyst
  gave them (`frame_match: "historical"`, `late_by_s`). The user's decision.
- **Every card plays, in turn.** A card label sits on one record, so the
  label cards' rule of playing on a later record of the same label, once
  nothing blocks it, would lose it for good. Instead a card label goes into a
  queue, one entry per label (`uuid`; without one, as in replay data, the
  label cards' re-arm, `LABEL_CARD_REARM_S`, decides what is the same label).
  The queue plays in arrival order, each card its full time, the next as soon
  as nothing blocks it: after the card before it, after a goal or a corner
  that was showing. So two cards on one record (a second booking, or two
  labels carried onto one record since 0.12.2) both play, one after the
  other, and so do two cards a second apart. Waiting cards are dropped on a
  seek or a reset, and a card's waiting entries when its layer goes off.
  (My call, from the user's "show them as soon as possible when received".)
- **Priority:** a goal, a corner or another centre card takes over from a card
  showing, and the card goes back to the head of the queue if it had not yet
  stayed its 2 s (my call: a card cut short is not a card played). The next
  waiting card comes in only once the one before has faded out (settled in the
  build's review). A pause, a press or a moment by hand lets go of the cards
  waiting, as a seek does, and a label seen while paused is not played. A card
  takes over from a small card, and other centre cards (VAR check, half time
  and the rest) take over from it as they do from each other.
- **No team:** a label without `team_id` shows no team line. **No number:** a
  label without `player_number`, or with -1 (the tracking's "not read"),
  shows no player row. The title and icon always show.
- **By hand** (`trigger('yellowCard', team)`): the team line for `team`, no
  player row. (My call: there is no player to name.)
- **The second half** turns positions round, not team ids: the team line is
  the same team either way. (To confirm while building.)

## Public API (CHANGELOG lines needed)

- `teams.home.players` and `teams.away.players`: names by shirt number,
  `{ 9: 'Name' }`, as plain JSON. Changed with `setOptions` like the rest.
- Two moments and two layers, `yellowCard` and `redCard`, in `moment` events,
  `trigger`, `availability`, `layers` and the layers menu ("Yellow card",
  "Red card"; 黄牌, 红牌).
- Text keys for the titles, the layer names, and the number fallback
  (`#{number}`; Chinese `{number}号`), overridable through `text`.
- The apps: video-annotation adds the two keys to `NOTHING_AVAILABLE` in
  `PipelineOutputSurface.vue` and its test literals when it bumps; match-share
  can pass player names once it has them.

## How it is built

Along the layers in CLAUDE.md:

- `model/labelCards.ts`: two registry entries, a centre card with an icon and
  a new flag saying it is about a player. The registry's types grow that flag.
- `model/types.ts`: `team_id` and `player_number` on `FrameAction`.
- `analysis`: who the card is for, from the frame's human label (team, number,
  uuid).
- `assets/icons.ts`: the hand-and-card SVG once, made into a yellow and a red
  image.
- `render/labelCard.ts`: the two lines under the band, for a card about a
  player; `LabelCardIndicator` gains the team's name, the player's text and
  the card's colour, worked out by the director so render reads no options.
- `director/labelCard.ts` and `director.ts`: the cards' queue (cleared on a
  seek, a reset and the layer going off), what takes over from what, and the
  player on the indicator.
- `widget/options.ts` and `i18n`: the `players` option and the words.
- `assets/fonts`: Inter 900 upright, bundled and loaded beside the others.
- `CHANGELOG.md`, README (options, moments, layers), CLAUDE.md's layer notes.

## Tests

- The registry and the label names, including the labelling tool's.
- The director: plays on a human card, not an AI one; two cards on one
  record both play, in order; a card during a goal plays after it; a card cut
  short by a goal plays again; a late label plays; a seek empties the queue.
- The drawing: the lines at the measured positions; name, number, no number,
  no team; a long name fits at 390 px.
- The widget: `players` and `setOptions`, the moment events, the layers menu,
  a card on a record the screen skipped (0.12.2's path).
- In Chrome: both cards at 1280 × 720 and 390 px wide, against the two
  screenshots; pixel-level differences are defects. Then on match-share
  staging with real labels, when the staging pipeline is back.

## Settled with the user

- The small cards take the icon's card colours, `#EAB308` and `#EF4444`. The
  screenshots show them a little lighter (yellow) and darker (red); the user
  chose the icon's colours.
- The team name's shadow is black at 50%, as the cut-off Dev Mode value reads.
- Late card labels play as soon as they arrive.
- Names by shirt number, the number shown when there is no name.
