# The substitution card

Status: design, 2026-11-12. Not built.

## Why

Since 0.13.0 the widget plays a card for a yellow or a red card, naming the team and the
player. A substitution is the other event about players a viewer wants to see, and the live
stream now says who went off and who came on. Substitutions often come in twos and threes, a
few seconds apart, so they are shown together: a card for a team's substitution takes the
substitutions that follow it into its list while it is up.

## Goals

- A human's substitution label plays a centre card: "SUBSTITUTION" over an up and down arrow,
  then under the band the team's name and a row per substitution: the player going off, a red
  down chevron, a green up chevron, the player coming on.
- Each row names the players from the `teams` option by shirt number, or shows the number.
- A substitution for the same team arriving while the card is up joins its list, up to 5 rows;
  the card rises to keep the list on the pitch.
- Everything the design does not change is the player cards': the band, the title, the icon
  slot, the fades, the team line, the text style, the queue.

## Non-goals

- Two teams on one card: a substitution for the other team waits for its own card.
- Showing the players on the pitch.
- A list longer than 5 rows: a 6th substitution waits for a card of its own.

## Anti-goals

- A substitution lost because the card was up, or because another moment was showing.
- A list that jumps: a row appearing at once, or the card snapping to a new height.
- A name made up: the rows say only what the label and the `teams` option say.

## The data

From the live stream (staging, 2026-11-12; and the backend's sample):

```json
{"action_type": "substitute", "action_origin": "human", "action_id": 48,
 "uuid": "c15dbd2e-…", "team_id": 0, "from": 1, "to": 16}
```

- In `match.state.actions[]`, as the cards' labels are. The labelling tool sends
  `substitute` (the backend's sample says `Substitute`); matched through `actionName`, with
  `substitution` too.
- `team_id`: 0 home, 1 away. `from`: the player going off. `to`: the player coming on.
- `from` and `to` are the labelling tool's roster ids, and it sends no shirt number with a
  substitution (`datalabelling-frontend`, `src/store/StateStore.js`). On staging they were the
  shirt numbers; in the backend's sample they were not (91001). They are read as shirt numbers,
  the user's decision: one above 99 is taken for a roster id, not a number, and is not shown
  unless the `teams` option names it (the user's decision). No other field is read until the
  backend sends shirt numbers for substitutions.
- Anything the label does not say plainly (a team other than 0 or 1, a number that is not a
  whole number of 0 or more) is left out, as for the cards.

## What the viewer sees

From the user's two screenshots (Figma "Game Animation Visualizer"; the Figma MCP could not
read the frames):

- 2 rows: `~/Desktop/Screenshot 2026-11-12 at 10.36.48.png`
- 5 rows: `~/Desktop/Screenshot 2026-11-12 at 10.37.01.png`

and the exported assets:

- the icon: `~/Desktop/viewport 3/icon.svg`, 208 × 208, filling the card's icon slot: an up
  arrow in `#E2E8F0` and a down arrow in `#FDE047`;
- the going-off badge: `~/Desktop/viewport 5/badge.svg`, 56 × 56, corner radius 8, `#343434`,
  a down chevron in `#E95151`;
- the coming-on badge: `~/Desktop/viewport 4/badge.svg`, the same with an up chevron in
  `#22C55E`.

### The look

- The band, the title ("SUBSTITUTION"; Chinese 换人), the icon slot: the player cards'.
- The team line: the player cards', the same font, size, shadow and place.
- Each row: the player going off, right-aligned, ending before the going-off badge; the two
  badges either side of the pitch's middle; the player coming on, left-aligned, after the
  coming-on badge. The names: Inter 600, 40 px on a 64 px line, white, shadow 0 2 px 4 px
  black at 25%, as the player cards' player.

### Sizes (measured)

Measured from the screenshots at 0.569 screenshot px to one design px (the icon's down arrow,
124.8 px high in the SVG, and the badges, 56 px, agree on it). In design px:

| | |
|---|---|
| Team line | as the player cards': baseline 84 below the band's foot |
| First row | baseline 177 below the band's foot, as the player cards' row |
| Rows | 72 apart (a 64 px line and 8 between) |
| Badges | 56 × 56, their middles on the middle of the row's capitals |
| Between the badges | 24, centred on the pitch's middle (measured 26 to the antialiased edge) |
| Name to badge | 24 either side (measured 26 to 28 to the letters' ink) |

The gaps are my reading of the measures, to be checked in Chrome against the screenshots,
as the cards' were.

### How the list grows

- With few rows the card sits where every centre card does (measured: the title within 1.3 px
  of the player cards').
- A new row is added at the bottom; the oldest stays on top.
- The card rises just enough that the last row's baseline is never more than 10 px below the
  bottom touchline, worked out from the pitch on screen. The rule, not the frames' lifts,
  decides (my call, from the review): the widget's pitch (105 × 68, 1356 × 878 design px) is
  squatter than the Figma frame's (about 1356 × 968), so the frames' lifts (about 17, 89 and
  162 px for 3, 4 and 5 rows, measured: 163.5) would put the 5th row's baseline at the canvas's
  bottom edge. In the widget, 2 rows reach the touchline, and 3, 4 and 5 rows lift the card by
  about 64, 136 and 208 px. On a pitch narrower still, 2 rows may lift it a little.
- A new row fades in over 0.4 s, and the card glides to its new height over 0.4 s, easing
  out. (My call: the design has the two states, not the move.)
- The card stays at least 5 s from the last row's arrival (the user's decision: substitutions
  made together come a few seconds apart, as each takes two clicks in the labelling tool), then
  fades out as a VAR check does.

## Behaviour

- **What plays it:** a frame a human labelled `substitute` or `substitution`, in either mode,
  never the AI's, as every moment.
- **Joining the card:** while a substitution card is up and not yet fading out, a
  substitution for its team joins its list, up to 5 rows. Anything else waits in the cards'
  queue (`cardQueue.ts`): a substitution for the other team, a 6th, one arriving as the card
  fades out.
- **Out of the queue:** a substitution card taken from the queue also takes the substitutions
  for its team waiting straight after it, up to 5, so three substitutions held back by a goal
  show as one card of three. (My call.)
- **One substitution per label:** by `uuid`, or without one by team, `from` and `to`, with the
  label cards' re-arm, as the player cards do.
- **The rest is the player cards':** it waits behind a goal, a corner or a centre card on
  screen; one cut short before its 5 s goes back to the head of the queue with its rows; a
  seek, a pause, a press, a moment by hand or a reset lets go of what waits; a label seen while
  paused or landed on by a seek is not played.
- **No team:** no team line. **No `from` or `to`, or one above 99 with no name for it:** that
  side of the row shows no name, its badge stays. A row with neither player is not drawn, and a
  card with no row shows the title, the icon and the team. (My call.) Labels with no `uuid`,
  team, `from` or `to`, as replay data may have, cannot be told apart: two within 15 s are one.
- **By hand** (`trigger('substitution', team)`): the title, the icon and the team, no rows.
- **Events:** one `moment` start and end per card, however many rows it gathers.

## Public API (CHANGELOG lines needed)

- The moment, layer and `trigger` key `substitution` (layer "Substitution"; 换人), in
  `MomentAvailability` and `ReplayLayers`.
- The text key `substitution`.
- The apps: video-annotation adds the key to its typed `MomentAvailability` literals when it
  bumps, as for the cards.

## How it is built

- `model/labelCards.ts`: a registry entry, a centre card with an icon, about a team's
  substitutions.
- `model/types.ts`: `from` and `to` on `FrameAction`.
- `analysis`: who a substitution is for, from its label (team, from, to, uuid), beside
  `cardLabels.ts`.
- `assets/icons.ts`: the arrows icon, and the two badges.
- `render/labelCard.ts`: the team line and the rows for a substitution card, laid out from its
  rows and how far it has risen and faded each row in, as the director works them out.
- `director`: the queue holds substitutions as well as cards; the card's rows, joining, rising
  and timing.
- `widget`, `i18n`, README, CHANGELOG, CLAUDE.md, as for the cards.
- Tests that use `Substitution` as a label with no moment of its own
  (`test/widget/labelCard.test.ts`, `test/director/labelCard.test.ts`,
  `test/director/goalZoom.test.ts`) switch to one that has none, such as `Kick off`, as their
  intent is "any other human label".

## Tests

- The registry and label names; who a substitution is for, with what is left out.
- The drawing: the rows at the measured places, the badges, the names right- and left-aligned
  either side, long names shrunk then cut, the rise for 3, 4 and 5 rows.
- The director: one substitution plays; a second for the team joins the card and keeps it up
  5 s more; one for the other team waits for its own card; a 6th waits; one arriving as the
  card fades waits; three behind a goal play as one card of three; the cards' rules for seek,
  pause, press, cut short.
- The widget: a pushed substitution plays and the host hears one start and one end for a
  card of three; the layer switches it off; names from `teams.*.players`.
- In Chrome: the 2-row and 5-row cards against the two screenshots, as the player cards were
  checked: the row spacing, badges, type and centring against the frames, the card's height
  against the rule.

## Settled with the user

- Names by shirt number from `teams.*.players`, the number when there is none; `from` and `to`
  read as shirt numbers, and one above 99 hidden unless named.
- A substitution for the other team gets its own card once this one ends.
- The list grows as described above, up to 5 rows.
- The card stays 5 s after the last substitution joins.
