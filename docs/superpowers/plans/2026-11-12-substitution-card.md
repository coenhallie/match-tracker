# Substitution Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A human's substitution label plays a centre card listing a team's substitutions, joining those that follow while it is up.

**Architecture:** A registry entry carries the card through layers, moments and words. A substitution label is read into a `SubstitutionLabel` (analysis), waits in the cards' queue beside the player cards (`CardQueue`, now over `QueuedLabel`), and is played by the registry's `LabelCard`, which keeps the card's rows, lets a later substitution for its team join, and hands render a `LabelCardSubstitution` that `drawLabelCard` lays out and lifts against the bottom touchline.

**Tech Stack:** TypeScript (strict, no semicolons, single quotes), Vitest, canvas 2D, oxlint.

**Spec:** `docs/superpowers/specs/2026-11-12-substitution-card-design.md` (builds on `docs/superpowers/specs/2026-11-12-player-cards-design.md`)

## Global Constraints

- Layers point down to `model`; `render` reads no options (the director hands it the words).
- Title en "SUBSTITUTION", zh "换人". Layer en "Substitution", zh "换人". Labels: `['substitute', 'substitution']` through `actionName`.
- Assets: icon `~/Desktop/viewport 3/icon.svg` (208 × 208, fills the slot); going-off badge `~/Desktop/viewport 5/badge.svg`; coming-on badge `~/Desktop/viewport 4/badge.svg` (56 × 56).
- Layout in design px from the band's foot: team line as the player cards' (`drawPlayerLines`' team part); row `i` (0-based) baseline at `177 + 72 * i`; names Inter 600 40 px white, shadow 0 2 4 black 25%; badges 56 × 56, middles on the capitals' middle, 24 apart either side of the pitch's middle; going-off name right-aligned 24 before its badge, coming-on name left-aligned 24 after its badge.
- Lift: the whole card rises so the last row's baseline is at most 10 design px below the bottom touchline, worked out from the transform; never below 0.
- Timing: fades as the VAR check (`LABEL_CARD_IN_MS`, `LABEL_CARD_OUT_MS`); shows at least `SUBSTITUTION_SHOW_MS = 5000` from the last row's joining; a row fades in over `SUBSTITUTION_ROW_IN_MS = 400`; the lift glides over `SUBSTITUTION_LIFT_MS = 400`, easing out (cubic); at most `SUBSTITUTION_MAX_ROWS = 5`.
- Names: from `teams.*.players` by number; else `#n` for `n <= 99`; else none.
- No em dashes; no agent attribution; goldens and baseline snapshots unchanged; all five checks pass at each task's end.

## Review Focus

1. A substitution whose `from`/`to` is above 99 but named in `teams.*.players` (a host keying by roster id): the name shows. (Task 4)
2. Two substitutions for one team 3 s apart: one card of two rows, up 5 s after the second. (Task 6)
3. A substitution arriving as the card fades out: its own card, after. (Task 6)
4. A 6th substitution for the team while 5 rows show: its own card, after. (Task 6)
5. Long names on both sides at any width: shrunk, cut, never past the frame's edges. (Task 5)

---

### Task 1: The card in the registry, its words, icon and badges

**Files:**
- Modify: `src/model/labelCards.ts`, `src/model/types.ts`, `src/i18n/{text,en,zh}.ts`, `src/render/theme.ts`, `src/assets/icons.ts`, `src/render/labelCard.ts` (`LABEL_CARD_ICON_BOXES`), `src/vue.ts` and every typed literal the type checker lists
- Modify (label swap): `test/widget/labelCard.test.ts`, `test/director/labelCard.test.ts`, `test/director/goalZoom.test.ts`: every `Substitution` used as "any other human label" becomes `Kick off`
- Test: `test/model/labelCards.test.ts`, `test/assets/icons.test.ts`, `test/i18n/text.test.ts`

**Interfaces:**
- Produces: registry entry `{ key: 'substitution', labels: ['substitute', 'substitution'], size: 'centre', below: 'icon', until: 'labelOff', makesWay: true, substitution: true }` after `redCard`; `isSubstitutionKey(key: string): key is 'substitution'`.
- Produces: `FrameAction.from?: number`, `FrameAction.to?: number`.
- Produces: icons `substitution` (the arrows), and `substitutionOut`, `substitutionIn` (the badges) in `CardIcons` and `RenderTheme['icons']`, loaded by `loadIcons`.
- Produces: text keys `substitution` (title and layer).

- [ ] **Step 1: Write the failing tests**: `it('reads the labelling tool's substitution label as the substitution card')` (`substitute`, `Substitute`, `EventType.SUBSTITUTION` match; an AI one does not); `it('loads the arrows icon and the two badges')` (208 × 208 with `#FDE047`; two 56 × 56 with `#E95151` and `#22C55E`); words en/zh as Global Constraints.
- [ ] **Step 2: Run them and see them fail.** `npx vitest run test/model/labelCards.test.ts test/assets/icons.test.ts test/i18n`
- [ ] **Step 3: Implement**, the SVGs inlined as exported; then swap the test labels.
- [ ] **Step 4: Full checks.** The swapped tests pass unchanged in intent.
- [ ] **Step 5: Commit** "Add the substitution card to the label cards, with its words, icon and badges"

### Task 2: Who a substitution is for

**Files:**
- Create: `src/analysis/substitutionLabels.ts`
- Test: `test/analysis/substitutionLabels.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SubstitutionLabel { key: 'substitution'; uuid: string | null; team: TeamId | null; from: number | null; to: number | null }
  export function substitutionLabels(frame: Frame): SubstitutionLabel[]
  ```
  Whole numbers of 0 or more only, as `cardLabels` does (above 99 kept: naming decides).

- [ ] **Step 1: Failing tests**: `it('reads the team, the player going off and the one coming on')` (`{ uuid: 'u', team_id: 0, from: 1, to: 16 }` gives `{ key: 'substitution', uuid: 'u', team: 0, from: 1, to: 16 }`); `it('leaves out what the label does not say plainly')` (team 2 or `'0'`, `from` -1, 2.5 or `'9'` give null; 91001 kept); `it('reads two in order, and no AI one')`.
- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full checks.**
- [ ] **Step 5: Commit** "Read who a substitution is for from its label"

### Task 3: Substitutions in the cards' queue

**Files:**
- Modify: `src/director/cardQueue.ts`
- Test: `test/director/cardQueue.test.ts`

**Interfaces:**
- Produces: `export type QueuedLabel = CardLabel | SubstitutionLabel`; `CardQueue` holds `QueuedLabel`:
  - `seen(label: QueuedLabel, now: number): boolean`: notes it, true if news (the identity: uuid; else for a card key, team, number; for a substitution key, team, from, to; re-arm `LABEL_CARD_REARM_S`).
  - `push(label: QueuedLabel): void`; `add` is `seen` then `push`; `skip`, `peek`, `take`, `putBack`, `clear` unchanged in meaning.
  - `drop(key: PlayerCardKey | 'substitution')`.
  - `takeSubstitutions(team: TeamId | null, max: number): SubstitutionLabel[]`: the substitutions for `team` waiting at the head, in order, up to `max`, removed.

- [ ] **Step 1: Failing tests**: `it('queues substitutions with the cards, in the order they came')`; `it('tells two substitutions apart without a uuid by team and players')`; `it('takes the substitutions for a team waiting at the head, up to the most a card holds')` (head: sub A team 0, sub B team 0, card, sub C team 0: `takeSubstitutions(0, 4)` gives A and B only); `it('says whether a label is news, and remembers it')`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full checks** (the player cards' queue tests pass unchanged).
- [ ] **Step 5: Commit** "Hold substitutions in the cards' queue"

### Task 4: Naming the players in a row

**Files:**
- Modify: `src/widget/options.ts`, `src/director/director.ts` (`DirectorOptions`), `src/director/moment.ts` (`MomentContext`), the test option objects that set `playerName`
- Test: `test/widget/playerNames.test.ts`

**Interfaces:**
- Produces: `Resolved.substitutionName`, `DirectorOptions.substitutionName`, `MomentContext.substitutionName`, all `(team: TeamId | null, number: number | null) => string | null`: the name in `teams.*.players` (no team: none looked up), else `#n` (`playerNumber` text) when `n <= 99`, else null; null number gives null.

- [ ] **Step 1: Failing tests**: `it('names a substituted player, or writes a shirt number, but no roster id')` (`players: { 16: 'Name' }`: `(0, 16)` 'Name', `(0, 1)` '#1', `(0, 91001)` null, `(null, 7)` '#7', `(0, null)` null); `it('names a roster id the host names')` (`players: { 91001: 'Name' }`: `(0, 91001)` 'Name').
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement**, beside `playerName`.
- [ ] **Step 4: Full checks.**
- [ ] **Step 5: Commit** "Name substituted players by shirt number, never by roster id"

### Task 5: The rows under the band, and the lift

**Files:**
- Modify: `src/render/labelCard.ts`
- Test: `test/render/labelCard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SubstitutionRow { out: string | null; in: string | null; intensity: number }
  export interface LabelCardSubstitution { team: string | null; rows: SubstitutionRow[]; rowsShown: number }
  // LabelCardIndicator gains: substitution?: LabelCardSubstitution
  export function substitutionLiftPx(t: Transform2D, rows: number): number // design px, >= 0
  export const SUBSTITUTION_SHOW_MS = 5000, SUBSTITUTION_ROW_IN_MS = 400, SUBSTITUTION_LIFT_MS = 400, SUBSTITUTION_MAX_ROWS = 5
  ```
  The card is drawn `lift` design px higher, `lift` interpolated linearly between `substitutionLiftPx(t, floor(rowsShown))` and `ceil`. The team line is the player cards' (factor it out of `drawPlayerLines`). Rows are drawn with their own intensity times the card's. The touchline from the transform: the larger of `worldToPx(0, ±t.pw / 2, t)[1]`.

- [ ] **Step 1: Failing tests** (`T` the 105 × 68 transform):
  - `it('lifts the card only once the last row would pass the touchline')`: `substitutionLiftPx(T, 1)` and `(T, 2)` are 0 within 2; `(T, 3)` ≈ 64, `(T, 4)` ≈ 136, `(T, 5)` ≈ 208, each within 2, and each 72 more than the one before once lifting.
  - `it('writes each row: going off, two badges, coming on')`: row 0 baseline `foot + 177u`, row 1 `+ 72u`; the going-off name `textAlign` 'right' at `CX - (12 + 56 + 24)u`; the coming-on name 'left' at `CX + (12 + 56 + 24)u`; the badges drawn at `CX - (12 + 56)u` and `CX + 12u`, 56u square, middles on the capitals' middle; names Inter 600 40 px.
  - `it('draws the whole card higher by its lift, the band included')`.
  - `it('fades a row in with its intensity')`; `it('leaves out a side with no name, and a row with neither')`.
  - `it('shrinks and cuts long names inside the frame')`: neither name's ink passes `CX ± (FRAME_W / 2 - 190u)`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full checks**, the player cards' render tests unchanged.
- [ ] **Step 5: Commit** "Draw a substitution card's rows, and lift it to keep them on the pitch"

### Task 6: Rows that join, and the card's time

**Files:**
- Modify: `src/director/labelCard.ts`, `src/director/director.ts`
- Test: `test/director/substitutions.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5.
- Produces, in `LabelCard`:
  - `start(now, frame, byHand = false, fromIntensity = 0, about: CardAbout = {})` with `interface CardAbout { player?: LabelCardPlayer; labels?: QueuedLabel[]; substitution?: { team: TeamId | null; teamName: string | null; rows: Array<{ label: SubstitutionLabel; out: string | null; in: string | null }> } }`; the three existing callers move to it.
  - `get labels(): QueuedLabel[]` (replaces `playing`); `get cutShort(): boolean` (holding back, and less than its show time since its last row: `LABEL_CARD_SHOW_MS` or `SUBSTITUTION_SHOW_MS`).
  - `canJoin(team: TeamId | null): boolean` (a substitution card holding back, for `team`, with fewer than 5 rows); `join(row)`: adds the row at the card's current elapsed time, restarting its show time.
  - `value()` gives `substitution` with each row's fade-in and `rowsShown` eased over `SUBSTITUTION_LIFT_MS`.
- Director: `queueCards` reads `substitutionLabels(frame)` as well as `cardLabels`, in the frame's order; a new substitution (`seen`) joins the card up if it `canJoin`, else is `push`ed; a substitution taken from the head also takes `takeSubstitutions(team, 4)`; `stopLabelCards` puts back `card.labels` (in order) when `card.cutShort`; layer off drops `substitution`; `trigger('substitution', team)` starts it with the team and no rows.

- [ ] **Step 1: Failing tests** (`FakeReplay`, records carrying `substitute` actions):
  - `it('plays a substitution with the team and both players')`.
  - `it('takes a second for the team into its list, and stays 5 s from it')` (3 s apart; one card, 2 rows; up until 5 s after the second, gone by 5.6 s).
  - `it('gives a substitution for the other team its own card, after')`.
  - `it('gives a 6th its own card, after')`; `it('gives one arriving as the card fades its own card, after')`.
  - `it('plays three held back by a goal as one card of three')`.
  - `it('glides up as a 3rd row joins, and fades the row in')` (`rowsShown` from 2 to 3 over 400 ms; the row's intensity from 0 to 1 over 400 ms).
  - `it('plays again, with its rows, a card a goal cut short')`.
  - `it('forgets what waits on a seek, a pause, a press')`, `it('plays nothing landed on by a seek or seen while paused')`.
  - `it('plays by hand with the team and no rows')`.
  - `it('tells the host one start and one end for a card of three')` (moment events through `FakeReplay` outputs: one run of `substitution`).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full checks**, the player cards' director tests unchanged.
- [ ] **Step 5: Commit** "Join a team's substitutions on one card, and keep it up 5 s from the last"

### Task 7: Through the widget, and the docs

**Files:**
- Modify: `CHANGELOG.md` (Unreleased), `README.md` (a "Substitutions" section beside "Cards", the labels list, `trigger`, `availability`, layers, text keys), `CLAUDE.md` (the director's line)
- Test: `test/widget/substitutions.test.ts`

- [ ] **Step 1: Failing tests** (live, as `test/widget/playerCards.test.ts`): `it('plays pushed substitutions as one card and tells the host once')` (two, 2 s apart: log `['substitution:start', 'substitution:end']`); `it('names the players from teams.home.players')` (canvas text holds both names); `it('switches it off in the layers menu')`.
- [ ] **Step 2: Run; make whatever earlier tasks left out pass.**
- [ ] **Step 3: Write the docs.**
- [ ] **Step 4: Full checks.**
- [ ] **Step 5: Commit** "Play substitutions through the widget, and document them"

### Task 8: Against the design, in Chrome

- [ ] **Step 1:** A page mounting `dist/index.js` in live mode on captured staging records, with `teams.home: { name: 'Arsenal', players: { 1..10: 'Player Name' } }`, pushing 2 substitutions 1 s apart, then later 5 more 1 s apart; each card's frame copied to a canvas 1 s after its last row joins (as the player cards' check did).
- [ ] **Step 2:** Screenshot the 2-row and 5-row cards.
- [ ] **Step 3:** Measure against `~/Desktop/Screenshot 2026-11-12 at 10.36.48.png` and `10.37.01.png` at 0.569 screenshot px per design px: team line, row pitch, badge size and gaps, names' alignment and ink gaps, centring; the 5-row card's lift against the touchline rule. Differences are defects: fix in `src/render/labelCard.ts` with a test, and repeat.
- [ ] **Step 4: Commit** any fixes, naming the measure in the message.
