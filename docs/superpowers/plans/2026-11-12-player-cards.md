# Player Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A human's "Player yellow card" or "Player red card" label plays a centre card with the team's name and the player under the band.

**Architecture:** Two entries in the label card registry carry the cards through layers, moments, words and icons as every label card is carried. A card label is read into a `CardLabel` (analysis), queued per label in the director (`CardQueue`), and played by the registry's `LabelCard` with a `LabelCardPlayer` on its indicator, which `drawLabelCard` lays out under the band.

**Tech Stack:** TypeScript (strict, no semicolons, single quotes), Vitest, canvas 2D, oxlint.

**Spec:** `docs/superpowers/specs/2026-11-12-player-cards-design.md`

## Global Constraints

- Layers point down to `model`: `model` imports nothing; `render` reads no options (the director hands it words and colours).
- Titles: en "YELLOW CARD", "RED CARD"; zh "黄牌", "红牌". Layer names: en "Yellow card", "Red card"; zh "黄牌", "红牌". Number fallback: en `#{number}`, zh `{number}号`.
- Labels matched through `actionName`: yellow `['player yellow card', 'yellow card']`, red `['player red card', 'red card']`.
- Card colours, icon and small card alike: yellow `#EAB308`, red `#EF4444`.
- Layout in design px (`designUnit`), from the foot of the band (`top + CARD_HEIGHT_PX`): team name baseline +84, Inter 900 upright 48 px, white, shadow 0 2 4 black 50%; player row baseline +177, Inter 600 40 px, white, shadow 0 2 4 black 25%; small card 32 × 44, middle on the capitals' middle (baseline − 0.727 × 40 / 2), 40 px between its right edge and the text; the row (card, gap, text) centred on the pitch's middle; each line at most the frame's width less 2 × 190, shrunk then cut with `fitText`.
- Timing is the VAR check's: `LABEL_CARD_IN_MS`, `LABEL_CARD_SHOW_MS`, `LABEL_CARD_OUT_MS`; `makesWay: true`, `until: 'labelOff'`.
- No em dashes in code, comments, docs or commits. No agent attribution in commits.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run size` all pass at the end of every task; goldens and baseline snapshots unchanged.

## Review Focus

1. A label with `team_id` other than 0 or 1, or `player_number` -1, missing, fractional or a string: no team line, or no player row, never "undefined" or "#-1". (Task 2)
2. A long team or player name at 390 px wide: shrunk, then cut with an ellipsis, never past the frame. (Task 4)
3. One card label seen on several records (an older stream, or carried onto the next record since 0.12.2): one card, not several. (Task 6)
4. A card label landed on by a seek, or arriving while replay is paused: not played, and nothing waiting plays later. (Task 6)
5. `setOptions` changing `teams.home.players` between two cards: the second card uses the new name; the card showing keeps its words. (Task 5)

---

### Task 1: The two cards in the registry, their words and their icon

**Files:**
- Modify: `src/model/labelCards.ts`, `src/model/types.ts`, `src/i18n/text.ts`, `src/i18n/en.ts`, `src/i18n/zh.ts`, `src/render/theme.ts`, `src/assets/icons.ts`, `src/render/labelCard.ts` (`LABEL_CARD_ICON_BOXES` only)
- Test: `test/model/labelCards.test.ts`, `test/assets/icons.test.ts`, `test/i18n/*.test.ts` (whichever holds the text key checks)

**Interfaces:**
- Produces: registry entries `{ key: 'yellowCard', labels: [...], size: 'centre', below: 'icon', until: 'labelOff', makesWay: true, player: { color: '#EAB308' } }` and the same for `redCard` with `'#EF4444'`, placed after `fullTime`; the registry's type gains `player?: { color: string }`.
- Produces: `type PlayerCardKey` (keys with `player`), `PLAYER_CARD_KEYS: readonly PlayerCardKey[]`, `isPlayerCardKey(key: string): key is PlayerCardKey`, `playerCardColor(key: PlayerCardKey): string` in `labelCards.ts`.
- Produces: `FrameAction.team_id?: number` and `FrameAction.player_number?: number` in `types.ts`.
- Produces: text keys `yellowCard`, `redCard`, `playerNumber` (the fallback with `{number}`), and layer entries for both cards.

- [ ] **Step 1: Write the failing tests**

`test/model/labelCards.test.ts`: `it('reads the labelling tool's card labels as the two player cards')`: a frame with a human `Player yellow card` is `isLabelCardFrame(frame, labelCard('yellowCard').labels)`; `EventType.PLAYER_RED_CARD` and `Red card` match `redCard`; an AI `Player red card` does not. `it('marks only the two cards as about a player, with their colours')`: `PLAYER_CARD_KEYS` equals `['yellowCard', 'redCard']`, `playerCardColor('yellowCard')` is `'#EAB308'`, `isPlayerCardKey('varCheck')` is false.
`test/assets/icons.test.ts`: `it('loads one hand-and-card icon per card, filled in its colour')`: the SVGs loaded for `yellowCard` and `redCard` are 208 × 208 and differ only in the card's fill, `#EAB308` and `#EF4444`.
i18n test: en `yellowCard` is `'YELLOW CARD'`, zh `redCard` is `'红牌'`, en `playerNumber` is `'#{number}'`, zh `'{number}号'`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/model/labelCards.test.ts test/assets/icons.test.ts test/i18n`
Expected: FAIL (no `yellowCard` key).

- [ ] **Step 3: Implement**

The icon: the shapes of `~/Desktop/viewport/eventYellowCard/icon.svg` once, as `playerCardSvg(fill: string): string`, with `LABEL_CARD_ICONS.yellowCard = playerCardSvg('#EAB308')` and red likewise. `LABEL_CARD_ICON_BOXES` for both: `{ left: 0, top: 0, width: 208, height: 208 }`. The type checker lists every other record the new keys need.

- [ ] **Step 4: Run the tests and the full checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS. A card now plays by the registry's ordinary rule; Task 6 replaces that.

- [ ] **Step 5: Commit** "Add the yellow and red cards to the label cards, with their words and icon"

### Task 2: Who a card is for

**Files:**
- Create: `src/analysis/cardLabels.ts`
- Test: `test/analysis/cardLabels.test.ts`

**Interfaces:**
- Consumes: `PlayerCardKey`, `labelCard`, `isHumanLabel`, `actionName`, `TeamId` (`analysis/teamPhase.ts`).
- Produces:
  ```ts
  export interface CardLabel { key: PlayerCardKey; uuid: string | null; team: TeamId | null; number: number | null }
  export function cardLabels(frame: Frame): CardLabel[]
  ```
  In the order the frame's `state.actions` has them, human labels only.

- [ ] **Step 1: Write the failing tests**

`it('reads the card, its uuid, its team and its shirt number')`: `{ action_type: 'Player red card', action_origin: 'human', uuid: 'u1', team_id: 0, player_number: 3 }` gives `[{ key: 'redCard', uuid: 'u1', team: 0, number: 3 }]`.
`it('leaves out what the label does not say plainly')`: `team_id` 2, -1, `'0'` or missing give `team: null`; `player_number` -1, 2.5, `'9'` or missing give `number: null`; no `uuid` gives `uuid: null`.
`it('reads two cards on one record in their order, and no AI card')`.

- [ ] **Step 2: Run and see it fail.** `npx vitest run test/analysis/cardLabels.test.ts` (module not found).
- [ ] **Step 3: Implement `cardLabels`.** A number is a non-negative integer of type number.
- [ ] **Step 4: Run it and the full checks.** Expected: PASS.
- [ ] **Step 5: Commit** "Read who a card is for from its label"

### Task 3: Inter Black, upright

**Files:**
- Modify: `scripts/copy-fonts.mjs` (add `inter-latin-900-normal.woff2`), `src/assets/fonts.ts` (`FACES`: Inter, weight `'900'`, style `'normal'`), `README.md` (the font notes near line 600: Inter 600, 900, italic 900)
- Create (by `npm run copy-fonts`): `src/assets/fonts/inter-latin-900-normal.woff2`
- Test: `test/assets/fonts.test.ts`

**Interfaces:**
- Produces: the face `900 normal` of `TITLE_FAMILY`, registered by `ensureFonts` with the others.

- [ ] **Step 1: Write the failing test** `it('registers Inter Black upright beside the italic, for the cards' team names')`: the faces registered include `{ family: 'MatchTracker Inter', weight: '900', style: 'normal' }` from a file ending `inter-latin-900-normal.woff2`.
- [ ] **Step 2: Run and see it fail.** `npx vitest run test/assets/fonts.test.ts`
- [ ] **Step 3: Run `npm run copy-fonts`, add the face.**
- [ ] **Step 4: Run the full checks, including `npm run build`** (check-dist fails if a font ships unloaded or without its licence). Expected: PASS; `dist` holds 6 woff2 files.
- [ ] **Step 5: Commit** "Bundle Inter Black upright for the cards' team names"

### Task 4: The lines under the band

**Files:**
- Modify: `src/render/labelCard.ts`
- Test: `test/render/labelCard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LabelCardPlayer { team: string | null; player: string | null; color: string }
  // LabelCardIndicator gains:
  player?: LabelCardPlayer
  ```
  `drawLabelCard` draws the lines only when `card.player` is given; each line is left out when its string is null.

- [ ] **Step 1: Write the failing tests** (with `draw()` as in the file, the card `yellowCard`, and `player: { team: 'Ajax', player: 'Name', color: '#EAB308' }`; measured widths from the recording context's `measureText`):
  - `it('writes the team in Inter Black 48 px, centred, 84 px below the band')`: the `fillText` of `'Ajax'` has `font` containing `900 ${48 * u}px` and not `italic`, x `CX` with `textAlign` `'center'`, y `(top + 384 * u) + 84 * u`, `shadowColor` `rgba(0, 0, 0, 0.5)`, `shadowOffsetY` `2 * u`, `shadowBlur` `4 * u`.
  - `it('writes the player in Inter 600 40 px, 177 px below the band, after a small card in its colour')`: the `fillRect` in `'#EAB308'` is `32 * u` by `44 * u`, its vertical middle at `bandFoot + (177 - 0.727 * 40 / 2) * u`; the player's text starts `40 * u` right of it; the row (32 + 40 + text width) is centred on `CX`; shadow alpha 0.25.
  - `it('leaves out the team line, or the player row, it is not given')`.
  - `it('shrinks a long name, then cuts it, inside the frame')`: at a measured width of three frames, the text's font is smaller than 40 px and the row's right edge is at most `CX + (FRAME_W - 380 * u) / 2`.
  - `it('fades the lines with the card')`: at intensity 0.5 the lines' `globalAlpha` is 0.5.
- [ ] **Step 2: Run and see them fail.** `npx vitest run test/render/labelCard.test.ts`
- [ ] **Step 3: Implement**, with `fitText` (`render/fitText.ts`) for both lines, the fonts `900 Npx ${theme.fonts.title}` and `600 Npx ${theme.fonts.title}`, and the layout values above as named constants beside the card's own.
- [ ] **Step 4: Run it and the full checks.** The existing label card tests and the render snapshots pass unchanged.
- [ ] **Step 5: Commit** "Draw the team and the player under a card's band"

### Task 5: Names by shirt number

**Files:**
- Modify: `src/widget/options.ts`, `src/director/director.ts` (`DirectorOptions`), `src/director/moment.ts` (`MomentContext`)
- Test: `test/widget/options.test.ts` (or the file testing `resolveOptions`)

**Interfaces:**
- Produces: `TeamOptions.players?: Record<number, string>`; `Resolved.playerName: (team: TeamId, number: number) => string`; `DirectorOptions.playerName` and `MomentContext.playerName` of the same type, passed through `directorOptions`.

- [ ] **Step 1: Write the failing tests**: `it('names a player by shirt number, or writes the number')`: with `teams: { home: { players: { 9: 'Name' } } }`, `playerName(0, 9)` is `'Name'`, `playerName(0, 7)` is `'#7'`, `playerName(1, 9)` is `'#9'`; with `momentLocale: 'zh'`, `playerName(0, 7)` is `'7号'`; a key given as the string `'9'` works too. `it('follows setOptions for the next name asked')`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** The fallback is `momentText.playerNumber` with `{number}` replaced; an empty name counts as none.
- [ ] **Step 4: Run it and the full checks.**
- [ ] **Step 5: Commit** "Name a carded player by shirt number from the teams option"

### Task 6: Every card plays, in turn

**Files:**
- Create: `src/director/cardQueue.ts`
- Modify: `src/director/labelCard.ts`, `src/director/director.ts`
- Test: `test/director/cardQueue.test.ts`, `test/director/playerCards.test.ts`

**Interfaces:**
- Consumes: `cardLabels`, `CardLabel` (Task 2); `LabelCardPlayer` (Task 4); `MomentContext.playerName`, `teamName` (Task 5); `isPlayerCardKey`, `playerCardColor` (Task 1).
- Produces:
  ```ts
  export class CardQueue {
    /** Queue `label` seen at `now` (seconds), unless already queued or played: by uuid, or without one within LABEL_CARD_REARM_S of the last of its key. */
    add(label: CardLabel, now: number): void
    peek(): CardLabel | undefined
    take(): CardLabel | undefined
    /** Back at the head: a card cut short before LABEL_CARD_SHOW_MS. */
    putBack(label: CardLabel): void
    drop(key: PlayerCardKey): void
    clear(): void
  }
  ```
  `LabelCard.start(now, frame, byHand, fromIntensity, player?: LabelCardPlayer, label?: CardLabel)`; `LabelCard.playing: CardLabel | null`; `LabelCard.shownMs: number` (ms since it started, 0 when not showing).
- Director, on each new record during playback: player cards skip `detect`; `cardLabels(frame)` go into the queue; after the other moments' detection, if nothing blocks (goal, corner, a centre card holding back), the head is taken and its card started with `{ team: label.team === null ? null : teamName(team), player: label.number === null || label.team === null ? null : playerName(team, number), color }`. `stopLabelCards` puts back a player card whose `shownMs < LABEL_CARD_SHOW_MS`. A seek (`clockMoved` off playback) and a reset clear the queue; a layer turned off drops its key. `trigger(key, team)` starts the card with `{ team: teamName(team), player: null, color }`.

- [ ] **Step 1: Write the failing tests**

`cardQueue.test.ts`: a uuid queued once however often added; two uuids both queue, in order; no uuid: a second within 15 s is the same card, after 15 s a new one; `putBack` goes to the head; `drop` and `clear`.
`playerCards.test.ts` (with `FakeReplay` from `harness.ts`, records carrying card actions as `cardLabels` reads them):
  - `it('plays a human's card with the team and the player, and not an AI's')`: the indicator is `{ key: 'redCard', player: { team: 'Red', player: '#3', color: '#EF4444' } }`.
  - `it('plays two cards on one record, one after the other')`: yellow then red; the red starts only after the yellow has left.
  - `it('plays a card given during a goal once the goal is over')`.
  - `it('plays again a card a goal cut short')`: a goal 1 s into the card; the card plays again after it.
  - `it('plays one card for a label seen on several records')`.
  - `it('plays a card labelled late as soon as it arrives')`: a label with `frame_match: 'historical'` on `raw_data` changes nothing.
  - `it('forgets the waiting cards on a seek')` and `it('does not play a card landed on by a seek')`.
  - `it('drops a waiting card whose layer goes off')`.
  - `it('plays a card by hand for a team, with no player')`.
  - `it('leaves out the player for a label with no team or no number')`.
- [ ] **Step 2: Run and see them fail.** `npx vitest run test/director/cardQueue.test.ts test/director/playerCards.test.ts`
- [ ] **Step 3: Implement** `CardQueue`, then the `LabelCard` additions, then the director's wiring as above.
- [ ] **Step 4: Run them and the full checks**, the goldens and the director's other tests unchanged.
- [ ] **Step 5: Commit** "Play every card label in turn, with who it is for"

### Task 7: Through the widget, and the docs

**Files:**
- Modify: `CHANGELOG.md` (Unreleased, What you see and the API), `README.md` (the `teams` option's `players`, the moments and the layers lists), `CLAUDE.md` (the `director` and label card notes: the two player cards are ours alone, queued)
- Test: `test/widget/playerCards.test.ts`

**Interfaces:**
- Consumes: everything above, through `createMatchTracker`.

- [ ] **Step 1: Write the failing tests** (live mode, `installEnv`, as `test/widget/labelCard.test.ts`):
  - `it('plays a pushed card label and tells the host')`: the log reads `['redCard:start', 'redCard:end']` after the card's time.
  - `it('plays a card whose record the next one hid before the display frame')`.
  - `it('names the player from teams.home.players, and follows setOptions')`: the canvas's `fillText` ops hold `'Name'`, then after `setOptions` a second card shows the new name.
  - `it('switches the yellow card off in the layers menu')`.
- [ ] **Step 2: Run and see them fail**, then make whatever the earlier tasks left out pass.
- [ ] **Step 3: Write the docs.**
- [ ] **Step 4: Run the full checks.**
- [ ] **Step 5: Commit** "Play the yellow and red cards through the widget, and document them"

### Task 8: Against the design, in Chrome

- [ ] **Step 1:** Serve a page mounting `dist/index.js` in live mode (as `scratchpad/e2e/replay.html` did), pushing captured staging records with one human `Player red card` (team 0, number 3) and one `Player yellow card`, with `teams.home.players: { 3: 'Player Name' }` and `teams.home.name: 'TeamName'`.
- [ ] **Step 2:** Screenshot each card at full intensity at 1280 × 720 and at 390 px wide with `chrome-devtools-axi`.
- [ ] **Step 3:** Compare against `~/Desktop/Screenshot 2026-11-12 at 08.20.21.png` and `08.20.14.png` (scale 0.957 screenshot px per design px): the team name's and the player row's baselines, sizes and weight, the small card's size and place, the row's centring, the shadows, nothing clipped at 390 px. Differences are defects: fix them in `src/render/labelCard.ts` with a test, and repeat.
- [ ] **Step 4: Commit** any fixes with the defect named in the message.
