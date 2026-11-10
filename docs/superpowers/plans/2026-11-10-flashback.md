# Flashback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In live mode, while the pipeline's camera is away for 5 s or more, play earlier interesting moments (human goal, corner, shot or header labels, and attacks into the penalty area) as marked replays, each once, giving way to live play at once.

**Architecture:** A spotter notes interesting moments from valid live records. A clip store keeps slimmed records around them. A pure controller decides when a clip starts, how it is fitted to the run, when it chains and when it is cut. A widget-level stage owns a second, lazily made `Director` that plays the clip, and the stroke and tab are a new `FrameLayers` slot that the widget adds to the painted frame. The live director keeps running underneath, unpainted, so nothing of today's live behaviour changes.

**Tech Stack:** TypeScript (strict), Canvas 2D, vitest with happy-dom, oxlint, vite.

**Spec:** `docs/superpowers/specs/2026-11-10-flashback-design.md` (read it first; this plan argues from it).

## Global Constraints

- Code name `flashback` everywhere in code and API; on screen "REPLAY". Never add a new identifier containing `replay` for this feature.
- No semicolons, single quotes, strict TypeScript, `npm run lint` (oxlint `--deny-warnings`) clean, `npm run typecheck` clean.
- No em dashes anywhere: code, comments, docs, commit messages. Use "-".
- Commits carry no agent attribution: no `Co-Authored-By` trailer.
- Layers: `model` imports nothing else of ours; dependencies point down towards `model`; `widget` on top.
- Replay mode unchanged: `test/fixtures/goldens`, `test/render/__snapshots__/baseline.test.ts.snap`, `test/parity` and `test/dist` pass untouched. Never update a snapshot or golden in this work.
- Embedding guarantees (CLAUDE.md "Embedding guarantees not to break") hold: no new DOM outside the shadow root, no new document listeners, no requests, no globals.
- `npm run size`: `dist/index.js` stays under 60 kB gzipped.
- Spec values, used verbatim:
  - start: run left >= `5` s (`FLASHBACK_MIN_RUN_S = 5`)
  - clip: `8` s before the moment (`CLIP_LEAD_S`), `4` s after (`CLIP_TAIL_S`)
  - fit: at least `2` s after the moment (`FIT_MIN_AFTER_S`), at least `1` s before (`FIT_MIN_BEFORE_S`)
  - store: up to `8` clips (`CLIP_CAP`), dropped `900` s after their moment (`CLIP_EXPIRY_S`), budget under `10_000_000` bytes
  - spotting: penalty area re-arms after `15` s out of it (`AREA_REARM_S`); a label kind re-arms after `15` s without it (`LABEL_REARM_S`)
  - short valid gaps: under `MERGE_GAP_S` (1.5 s, imported from `src/director/playerLoss.ts`) keep the replay going
  - a jump back in record time over `HISTORY_S` (10 s) drops every clip
  - importance: goal > corner > shot (shot on goal, header on goal) > attack
  - look (design px, through `designUnit`): stroke `12` white; tab inset `12`, padding `16` top/bottom, `16` outer side, `32` inner side, radius `4` on the inner top corner, white; "REPLAY" Inter Black Italic `64`/`80` line, `#166a51`, shadow `0 4 24 rgba(0,0,0,0.15)`; timer Inter Black Italic `36` on the `80` line, baseline-aligned, `#166a51` at `0.62`, gap `24` from the title; progress line `6` high along the tab's bottom, `#166a51` at `0.35`, width = share of clip left
  - timer text `m:ss AGO` (en `'{time} AGO'`, zh `'{time}前'`); title en `'REPLAY'`, zh `'回放'`
  - fades: in over `ATTACK_IN_MS`, out over `ATTACK_OUT_MS` (from `src/render/attackIndicator.ts`); none with reduced motion
  - layer `flashback`, on by default, listed in the menu in live mode only; en label `'Replays while the camera is away'`, hint `'An earlier goal, corner, shot or attack near goal, each played once, while the live camera is away for 5 s or more'`
  - event `flashback: { phase: 'start' | 'end', at: number }`

## Review Focus

1. **A run interleaved with copies that carry no validity** (the default socket: about 14% of copies have no `raw_data`). Expect no flicker: the replay neither ends nor restarts on them, and no made-up positions get into a clip. Owned by Task 4 (`'rides through records with no validity'`) and Task 3 (`'keeps no record a carried validity calls invalid'`).
2. **The pipeline restarts during a replay** (`t` jumps back by more than 10 s). Expect the replay to end at once, with an `end` event, and every clip dropped, with no negative timer. Owned by Task 7 (`'ends the replay and drops every clip when the stream restarts'`).
3. **The viewer zooms or pans during a replay, then live play comes back.** Expect live play to keep the viewer's zoom, with no jump to the clip's goal camera. Owned by Task 7 (`'carries the viewer zoom across, not the clip camera'`).
4. **A clip from the first half plays after a half label has turned the pitch.** Expect the clip to show the first half's ends, and its tab side to be worked out on those ends. Owned by Task 7 (`'shows a first half clip on the first half ends'`).
5. **The layer switched off, or the widget hidden, mid-replay.** Expect the replay to end at once and today's attack cover to take over. The clip stays used up. Owned by Task 7 (`'cuts the replay when the layer goes off or the widget comes back into view'`).

---

## File Structure

- Create `src/model/flashback.ts`: the shared types (`FlashbackKind`, `SpottedMoment`, `Clip`), `KIND_RANK`, and `carriedValidity`. Model, so history, director and widget can all share it.
- Create `src/director/flashbackSpotter.ts`: `FlashbackSpotter`, deciding from one valid live record and its phase whether a moment starts there. It lives in director because the corner labels live in `src/render/corner.ts`.
- Create `src/history/clipStore.ts`: `ClipStore` (slimmed records, clips, cap, expiry, restart, budget) and `slimRecord`.
- Create `src/director/flashback.ts`: `Flashback`, the pure controller (start, fit, chain, cut, merge, fades, progress).
- Create `src/render/flashback.ts`: `FlashbackIndicator` and `drawFlashback`.
- Create `src/widget/flashbackStage.ts`: `FlashbackStage`, which glues the store, spotter and controller to a lazily made clip `Director` for the widget.
- Modify `src/render/renderer.ts`: the `FrameLayers.flashback` slot, drawn last.
- Modify `src/render/theme.ts`, `src/widget/options.ts` (`themeFor`), `src/i18n/text.ts`, `src/i18n/en.ts`, `src/i18n/zh.ts`: the text keys.
- Modify `src/model/replayLayers.ts`, `src/widget/layersMenu.ts`: the `flashback` layer, live only in the menu.
- Modify `src/widget/createMatchTracker.ts`, `src/widget/events.ts`, `src/widget/hud.ts`: the wiring, the event and the debug badge.
- Modify `src/director/playerLoss.ts` (comment only), `README.md`, `CHANGELOG.md`.
- Create `test/fixtures/staging-validity.jsonl.gz`, plus tests named in each task.

---

### Task 0: Branch, and commit the spec and plan

- [ ] **Step 1:** `git checkout -b flashback`
- [ ] **Step 2:** Commit the two documents:

```bash
git add docs/superpowers/specs/2026-11-10-flashback-design.md docs/superpowers/plans/2026-11-10-flashback.md
git commit -m "Add the flashback design and plan"
```

---

### Task 1: Shared types, carried validity, and a staging fixture

**Files:**
- Create: `src/model/flashback.ts`
- Create: `test/fixtures/staging-validity.jsonl.gz`
- Test: `test/model/flashback.test.ts`

**Interfaces:**
- Produces:
  - `type FlashbackKind = 'goal' | 'corner' | 'shot' | 'attack'`
  - `const KIND_RANK: Readonly<Record<FlashbackKind, number>>` = `{ goal: 0, corner: 1, shot: 2, attack: 3 }` (lower is more important)
  - `interface SpottedMoment { kind: FlashbackKind; at: number; frameCount: number }` (`at` is the record's `t`)
  - `interface Clip { id: number; kind: FlashbackKind; at: number; frameCount: number; from: number; to: number; ready: boolean }` (`from` and `to` are record times bounding what is shown, before any fitting)
  - `interface CarriedValidity { t: number; validity: RecordValidity }`
  - `function carriedValidity(last: CarriedValidity | null, t: number): RecordValidity | null`: what the stream says at record time `t`, from the last record that said anything. Its countdowns are aged by `t - last.t`, and `horizonS` is kept. A countdown that has run out flips the state: invalid with `nextValidInS` passed becomes valid (`nextValidInS: 0`, `nextInvalidInS: null`), and valid with `nextInvalidInS` passed becomes invalid (`nextInvalidInS: 0`, `nextValidInS: null`). A flipped state is a guess, so it drops `horizonS`. Its null countdown then reads as "unknown", never as "10 s or more", and a guess can never start or chain a replay (Task 4). Null when `last` is null.
  - `function readFixture(name)` is not exported from src; the tests read the fixture themselves (Step 4).

- [ ] **Step 1: Write the failing tests** in `test/model/flashback.test.ts`:

```ts
it('ages an invalid countdown by record time', () => {
  const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: 6, horizonS: 10 } }
  expect(carriedValidity(last, 102)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: 4, horizonS: 10 })
})
it('flips to valid once the invalid countdown has run out', () => {
  const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: 1 } }
  expect(carriedValidity(last, 101.5)).toEqual({ invalid: false, nextInvalidInS: null, nextValidInS: 0 })
})
it('keeps a null countdown null', () => {
  const last = { t: 100, validity: { invalid: true, nextInvalidInS: 0, nextValidInS: null, horizonS: 10 } }
  expect(carriedValidity(last, 130)?.nextValidInS).toBeNull()
  expect(carriedValidity(last, 130)?.invalid).toBe(true)
})
it('flips to invalid as a guess, with no horizon', () => {
  const last = { t: 100, validity: { invalid: false, nextInvalidInS: 0.5, nextValidInS: 0, horizonS: 10 } }
  expect(carriedValidity(last, 101)).toEqual({ invalid: true, nextInvalidInS: 0, nextValidInS: null })
})
it('says nothing before anything was said', () => {
  expect(carriedValidity(null, 5)).toBeNull()
})
it('ranks goal over corner over shot over attack', () => {
  expect([...(['attack', 'shot', 'goal', 'corner'] as const)].sort((a, b) => KIND_RANK[a] - KIND_RANK[b])).toEqual(['goal', 'corner', 'shot', 'attack'])
})
```

- [ ] **Step 2:** Run `npx vitest run --project src test/model/flashback.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `src/model/flashback.ts` with the interfaces above. It imports only `RecordValidity` from `./types.js`.
- [ ] **Step 4: Build the fixture.** From `/Users/coenhallie/projects/once-experiment/captures/staging-620749bb.jsonl.gz`, keep only lines with `kind === 'msg'` and `s === 'default'`, take each one's `data` (the raw socket string), and keep the first copy of each `frame_count`. In each message's `raw_data`, keep only `source_frame.frame_state` and `agentic.lookahead` (`next_invalid_in_s`, `next_valid_in_s`, `horizon_s`) and drop everything else. Do not drop copies with no `raw_data`: they are the case Review Focus 1 needs. Keep a 90 s window that holds all of these:
  - at least one invalid run of 5 s or more, with a valid gap under 1.5 s near it;
  - at least one run over 10 s (a null `next_valid_in_s`);
  - before one of those long runs, valid records where the ball goes into a penalty area while players of one team carry `in_possession`, so the spotter has an attack to find. Task 2's fixture test confirms the choice. Write the result one message per line, gzipped, to `test/fixtures/staging-validity.jsonl.gz`. Target under 1.5 MB. Use a throwaway `node -e` script; do not commit the script. Say in the commit message what the fixture is cut from and how.
- [ ] **Step 5: Add a fixture sanity test** in `test/model/flashback.test.ts`: `'the staging fixture has a run of 5 s or more, one over 10 s, a short valid gap, and copies with no validity'`. Parse every line with `parseRecord`, then assert:
  - some record has `validity.invalid && validity.nextValidInS >= 5`
  - some record has `validity.invalid && validity.nextValidInS === null && validity.horizonS === 10`
  - some record has `!validity.invalid && validity.nextInvalidInS !== null && validity.nextInvalidInS < 1.5`
  - some record has `validity === undefined`
- [ ] **Step 6:** Run `npx vitest run --project src test/model/flashback.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** (`src/model/flashback.ts`, the test, the fixture), message "Add flashback's shared types, carried validity, and a staging validity fixture", body naming the source capture and the trimming.

---

### Task 2: The spotter

**Files:**
- Create: `src/director/flashbackSpotter.ts`
- Test: `test/director/flashbackSpotter.test.ts`

**Interfaces:**
- Consumes: `SpottedMoment`, `FlashbackKind`, `KIND_RANK` (Task 1). `HISTORY_S` (`src/analysis/derive.ts`), `isGoalFrame` (`src/analysis/goalSequence.ts`), `isCornerFrame` (`src/render/corner.ts`), `frameHasAction` (`src/analysis/actionLabels.ts`), `resolvePitchDimensions` (`src/render/pitchGeometry.ts`), `shownBall` (`src/director/ballRoll.ts`), `TeamPhase` (`src/analysis/teamPhase.ts`).
- Produces:
  - `const LABEL_REARM_S = 15`, `const AREA_REARM_S = 15`
  - `class FlashbackSpotter { spot(record: TrackerRecord, phase: TeamPhase | null): SpottedMoment | null; reset(): void }`
    - Called only with valid records, unturned, in time order.
    - Labels are human only (via `isGoalFrame`, `isCornerFrame`, `frameHasAction(frame, 'shot on goal' | 'header on goal')`), never AI. One record can carry several; return the most important by `KIND_RANK`.
    - A label kind is spotted when seen and not seen within the previous `LABEL_REARM_S` of record time.
    - `attack`: `phase.possession !== null` and `phase.attacks[possession] !== null`, and the ball (from `shownBall(frame, undefined)`) inside the penalty area at the end that team attacks: `sign(x) === attacks[possession]`, `|x| >= L/2 - penalty_area_length`, `|y| <= penalty_area_width / 2`, where `L` and the area sizes come from `resolvePitchDimensions(frame.pitch_dimensions)`. It re-arms per end once the ball has been outside that end's area for `AREA_REARM_S` of record time.
    - A record time going back by more than `HISTORY_S` resets the re-arm memory.

- [ ] **Step 1: Write the failing tests.** Build frames like `test/director/invalidFrames.test.ts`'s `frameWith`, with `action_origin` set per test. Use the phase `{ possession: 0, attacks: { 0: 1, 1: -1 }, states: {...} }`.
  - `'spots a human goal label once per run'`: goal-labelled records at t 10, 10.04 and 10.08, then plain records up to 30, then a goal label at 30. Expect `[{kind:'goal', at:10}, {kind:'goal', at:30}]`.
  - `'ignores AI labels, and labels with no origin'`: `action_origin: 'ai'` and a missing origin, for goal and corner. Expect nothing spotted.
  - `'spots a corner, a shot on goal and a header on goal'`: kinds `corner`, `shot`, `shot`.
  - `'takes the most important of two labels on one record'`: goal and corner on one record. Expect `goal`.
  - `'spots the ball entering the penalty area the team in possession attacks'`: the ball goes from x 30 to 40 (L 105, area 16.5, so the area starts at 36) at y 0. Expect `{kind:'attack'}` at the first record with x >= 36, and nothing for the same move into the other end, or with `possession: null`.
  - `'re-arms the area only after 15 s outside it'`: in, out 10 s, in again: one spot. In, out 15.04 s, in again: two.
  - `'forgets its re-arm memory when the stream restarts'`: a goal at t 1000, then a goal at t 500. Expect two spots.
  - `'finds an attack into the box before a long run in the staging fixture'`: parse `test/fixtures/staging-validity.jsonl.gz`. For each record whose `carriedValidity` is valid, spot it with the phase from `deriveAt(windowAt(validSoFar, record), record)`. Expect at least one `attack`, and its `at` to come before an invalid record with `nextValidInS >= 5` or null. If this fails, the fixture window was badly chosen: go back to Task 1 Step 4.
- [ ] **Step 2:** Run `npx vitest run --project src test/director/flashbackSpotter.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/director/flashbackSpotter.ts` to the interface.
- [ ] **Step 4:** Run it. Expected: PASS. Then run `npm run lint` and `npm run typecheck`.
- [ ] **Step 5: Commit** "Spot flashback moments: human labels and attacks into the penalty area".

---

### Task 3: The clip store

**Files:**
- Create: `src/history/clipStore.ts`
- Test: `test/history/clipStore.test.ts`

**Interfaces:**
- Consumes: `Clip`, `SpottedMoment`, `KIND_RANK`, `carriedValidity`, `CarriedValidity` (Task 1); `HISTORY_S` (`src/analysis/derive.ts`).
- Produces:
  - Constants: `CLIP_LEAD_S = 8`, `CLIP_TAIL_S = 4`, `CLIP_CAP = 8`, `CLIP_EXPIRY_S = 900`.
  - `function slimRecord(record: TrackerRecord): TrackerRecord`: a copy keeping only what the renderer, the director and the analysis read. That is: `t`, `frameCount`, `validity`; `frame.pitch_dimensions`, `frame.frame_data`, `frame.state.actions` (each with `action_type` and `action_origin`), `frame.balls[].projected_coordinates` and `is_high_ball`, and `frame.teams[]` with `team_id` and `players[]` (`track_id`, `person_type`, `projected_coordinates`, `player_number`, `in_possession`). Before fixing the list, grep `src/render`, `src/director` and `src/analysis` for every `Frame` field read, and add any found. The test in Step 1 is the check.
  - `class ClipStore`:
    - `add(record: TrackerRecord): void`. Every live record, in arrival order. It works out the record's state with `carriedValidity` when `record.validity` is absent, and keeps a slimmed copy only when that state is valid (or unknown, i.e. no validity ever seen). It notes the times of invalid ones. It closes clips: a clip's `to` is `min(at + CLIP_TAIL_S, last valid t before the first invalid record after at)`, and the clip is `ready` once `to` is fixed (the newest t has passed `at + CLIP_TAIL_S`, or an invalid record arrived after `at`). It drops clips whose `at` is more than `CLIP_EXPIRY_S` before the newest t. On a jump back over `HISTORY_S`, it drops all clips and records. Afterwards it prunes every record not needed: needed are the records within `[from - HISTORY_S, to]` of a kept clip, and the last `CLIP_LEAD_S + HISTORY_S` seconds.
    - `note(moment: SpottedMoment): void`. Makes a clip with `from = max(at - CLIP_LEAD_S, first valid t after the last invalid record before at)`. If an existing clip's window `[c.at - CLIP_LEAD_S, c.at + CLIP_TAIL_S]` holds `moment.at`, or the new window holds `c.at`, then the more important one (lower `KIND_RANK`) stays and the other goes; on a tie the existing one stays. Over `CLIP_CAP`, it drops the least important, then the oldest.
    - `next(): Clip | null`: the most important ready clip, newest `at` within its kind.
    - `take(id: number): void`: removes the clip (it has been played).
    - `records(id: number): readonly TrackerRecord[]`: the slimmed records from `from - HISTORY_S` to `to`, in time order.
    - `clips(): readonly Clip[]` (for tests and the debug badge), `bytes(): number` (the sum of `JSON.stringify(slim).length` over kept records, counted at add), and `clear(): void`.

- [ ] **Step 1: Write the failing tests.** Use records at 25 Hz with full frames from `test/fixtures/excerpt.jsonl.gz` for size, plus validity as each test needs.
  - `'slims a record without changing what is drawn'`: for 50 staging fixture records, render the full and the slim record with `createRenderer` on a `recordingCtx` canvas (see `test/helpers/recordingCtx.ts`, as `test/render/renderer2D.test.ts` does). Expect identical op lists.
  - `'makes a clip from 8 s before to 4 s after, ready once the after part is in'`
  - `'starts the clip after invalid records before the moment, and ends it at the first invalid one after'`
  - `'keeps no record a carried validity calls invalid'`: an invalid record with `nextValidInS: 3`, then records with no validity for 2 s. None of those are kept.
  - `'keeps the more important of two moments in one window'`: an attack at 100 and a goal at 103 leave one clip, the goal. A goal at 100 and an attack at 103 leave the goal.
  - `'keeps 8 clips, dropping the least important then the oldest'`
  - `'drops a clip 900 s after its moment'`
  - `'keeps clips over a forward gap, drops them all when the stream restarts'`
  - `'takes a clip once: next never gives it again'`
  - `'gives the most important ready clip, the newest of its kind'`
  - `'stays under 10 MB at its cap'`: 8 non-overlapping 12 s clips of fixture-sized records, 25 Hz, each with its 10 s lookback. Expect `bytes() < 10_000_000`.
  - `'keeps only the records kept clips and the next moment need'`: after `take` of every clip and 60 s of records, `bytes()` covers at most `CLIP_LEAD_S + HISTORY_S` of records.
- [ ] **Step 2:** Run `npx vitest run --project src test/history/clipStore.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/history/clipStore.ts`. Keep the records in one time-ordered array, so overlapping clips share them; prune from the front only.
- [ ] **Step 4:** Run it. Expected: PASS. Lint and typecheck clean.
- [ ] **Step 5: Commit** "Keep flashback clips: slimmed valid records around each moment, capped and aged".

---

### Task 4: The controller

**Files:**
- Create: `src/director/flashback.ts`
- Test: `test/director/flashback.test.ts`

**Interfaces:**
- Consumes: `ClipStore` (Task 3), `Clip`, `carriedValidity` (Task 1), `MERGE_GAP_S` (`src/director/playerLoss.ts`), `ATTACK_IN_MS`, `ATTACK_OUT_MS` (`src/render/attackIndicator.ts`).
- Produces:
  - Constants: `FLASHBACK_MIN_RUN_S = 5`, `FIT_MIN_AFTER_S = 2`, `FIT_MIN_BEFORE_S = 1`.
  - `function fitClip(beforeS: number, afterS: number, leftS: number | null): { beforeS: number; afterS: number }`. The algorithm is fixed:

```ts
if (leftS === null || beforeS + afterS <= leftS) return { beforeS, afterS }
let after = Math.min(afterS, Math.max(FIT_MIN_AFTER_S, leftS - beforeS))
let before = Math.min(beforeS, Math.max(Math.min(beforeS, FIT_MIN_BEFORE_S), leftS - after))
if (before + after > leftS) after = Math.max(0, leftS - before)
return { beforeS: before, afterS: after }
```

  - `interface FlashbackLive { newest: TrackerRecord | null; labelMoment: boolean; layerOn: boolean }`. `newest` is the newest live record as pushed (`LiveHistory.latest()`); `labelMoment` is whether the live director is showing a moment a human label started.
  - `interface FlashbackShot { clip: Clip; record: TrackerRecord; records: readonly TrackerRecord[]; event: TrackerRecord; time: number; playback: boolean; leftShare: number }`. `record` is the clip record to show now (the last with `t <=` the clip clock); `event` is the clip's moment record (by `frameCount`); `time` is a clock that only goes up, across clips; `playback` is false on each clip's first record; `leftShare` runs from 1 to 0 over the fitted clip.
  - `interface FlashbackFrame { shot: FlashbackShot | null; alpha: number; agoS: number | null; events: ReadonlyArray<{ phase: 'start' | 'end'; at: number }> }`. `alpha` is the stroke and tab's strength: up over `ATTACK_IN_MS` from the first clip, 1 while clips play, down over `ATTACK_OUT_MS` after the last ends or is cut, while live play shows; with reduced motion only 0 or 1. `agoS` is `newest.t - clip.at` while there is a clip to name, else null.
  - `class Flashback { constructor(store: ClipStore, reducedMotion: () => boolean); step(nowMs: number, live: FlashbackLive): FlashbackFrame; cut(nowMs: number): void; get active(): boolean; get animating(): boolean; reset(): void }`. `animating` is true while a clip plays, or while alpha has not reached its target. So a clip plays on its own clock even when the stream stalls.
  - Rules, all from the spec ("When a replay plays"):
    - `left` = `carriedValidity` of `newest`: `nextValidInS` when invalid, `Infinity` when that is null and `horizonS` is set, `undefined` (do not start) when null with no horizon, or when valid. A flipped guess has no horizon (Task 1), so it can keep a replay going but never start or chain one.
    - **Start** when not active, `layerOn`, invalid with `left >= FLASHBACK_MIN_RUN_S`, `!labelMoment`, and `store.next()` gives a clip. `store.take` it at once. Fit with `fitClip(clip.at - clip.from, clip.to - clip.at, left)`. Emit `start`.
    - **Clip clock**: `fittedFrom + (nowMs - clipStartMs) / 1000`; the clip ends when it passes `fittedTo`.
    - **Chain**: at the end, if the start rule holds, take the next clip at once (the alpha stays at 1) and emit `start` for it; otherwise end.
    - **Cut**: when `carriedValidity` says valid and not (`nextInvalidInS !== null && nextInvalidInS < MERGE_GAP_S`); or `labelMoment`; or `!layerOn`; or `cut()` is called. End at once: `shot` becomes null.
    - **End** emits one `end` with the last clip's `at`, and starts the fade out.
    - A record with no validity counts as its carried validity (Review Focus 1).

- [ ] **Step 1: Write the failing tests**, driving `step` at 40 ms steps with records from a helper that sets validity:
  - `fitClip`: `fitClip(8, 4, null)` is `{8, 4}`; `fitClip(8, 4, 12)` is `{8, 4}`; `fitClip(8, 4, 5.3)` is `{3.3, 2}` within 1e-9; `fitClip(8, 4, 3)` is `{1, 2}`; `fitClip(0.5, 4, 3)` is `{0.5, 2.5}`.
  - `'starts on an invalid record with 5 s or more to go, not under'`: `nextValidInS` 4.96 does not start; 5 does.
  - `'starts on a null countdown only with a horizon'`
  - `'never starts on a carried guess'`: a valid record with `nextInvalidInS: 0.3` and `horizonS: 10`, then 1 s of records with no validity. Expect no `start`, with a ready clip in the store.
  - `'does not start without a ready clip, with the layer off, or while a live label moment shows'`
  - `'plays a 5.3 s run with its moment inside it'`: clip at 100, a run with `nextValidInS: 5.3`. Expect the first shown `record.t` to be about 96.7 and the last about 102, and the moment record to be shown.
  - `'chains to the next unused clip while the run goes on'`: a run with null countdown and two clips. Expect two `start` events and one `end`, with `alpha` 1 throughout between them.
  - `'falls back to live when no clip is left'`: the shot becomes null, one `end`, then alpha fades over `ATTACK_OUT_MS`.
  - `'cuts on a valid record'`
  - `'rides through a valid gap under 1.5 s'`: a valid record with `nextInvalidInS: 0.28` keeps it going; `nextInvalidInS: 1.5` cuts.
  - `'rides through records with no validity'`: a run interleaved one in seven with records that have no `validity`. Expect exactly one `start` and no `end` until the valid record.
  - `'plays each clip once'`: cut it, start again on a new run, and expect the other clip or none, never the cut one.
  - `'counts the timer from the moment in record time'`: `agoS` equals `newest.t - clip.at`, and does not move when `nowMs` moves with no new record.
  - `'neither fades with reduced motion'`: alpha is 1 while active and 0 at once after.
- [ ] **Step 2:** Run `npx vitest run --project src test/director/flashback.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/director/flashback.ts`.
- [ ] **Step 4:** Run it. Expected: PASS. Lint and typecheck clean.
- [ ] **Step 5: Commit** "Direct flashbacks: start on a long run, fit to it, chain, and give way to live play".

---

### Task 5: Drawing the stroke and tab, and its words

**Files:**
- Create: `src/render/flashback.ts`
- Modify: `src/render/renderer.ts` (`FrameLayers`, and the drawing after `goalBanner`), `src/render/theme.ts` (`RenderTheme.text` and `DEFAULT_THEME`), `src/widget/options.ts` (`themeFor`), `src/i18n/text.ts`, `src/i18n/en.ts`, `src/i18n/zh.ts`
- Test: `test/render/flashback.test.ts`, `test/i18n/text.test.ts` (extend)

**Interfaces:**
- Produces:
  - `interface FlashbackIndicator { alpha: number; side: 'left' | 'right'; agoS: number | null; leftShare: number }`
  - `function flashbackSide(event: TrackerRecord): 'left' | 'right'`: from the first ball in `event.frame.balls` with a finite `projected_coordinates.x` (render cannot import `shownBall` from director). Ball x > 0 gives `'left'` (tab away from the action), x < 0 gives `'right'`, no ball or x === 0 gives `'left'`. The caller passes the shown (turned) record, so its ends decide.
  - `function formatAgo(seconds: number, template: string): string`: `m:ss` with whole seconds, floored, put in for `{time}`. So 167.9 with `'{time} AGO'` gives `'2:47 AGO'`, 45 gives `'0:45 AGO'`, and 3730 gives `'62:10 AGO'`.
  - `function drawFlashback(ctx: CanvasRenderingContext2D, t: Transform2D, value: FlashbackIndicator, theme: RenderTheme): void`. Draws in frame units, fixed to the frame, as `drawGoalBanner` is called. It uses the spec's values (Global Constraints, "look") through `designUnit(t)` and the bounds `FRAME_W` x `FRAME_H`, at `globalAlpha = value.alpha`. The timer is not drawn when `agoS` is null. The right tab mirrors the left: the rounded corner and the 32 px padding go on the side facing the pitch.
  - `FrameLayers.flashback?: FlashbackIndicator | undefined`, drawn after the goal banner and before `draw2DOverlay`, with `ctx.setTransform(sx, 0, 0, sy, 0, 0)` and then restored.
  - `RenderTheme.text.flashback` and `.flashbackAgo`; `TrackerText.flashback` (en `'REPLAY'`, zh `'回放'`), `.flashbackAgo` (en `'{time} AGO'`, zh `'{time}前'`), `.flashbackDebug` (en `'Replay of a {kind} from {ago} ago'`, zh `'{ago}前的{kind}回放'`), and `layers.flashback` (en label and hint from Global Constraints; zh label `'镜头离开时回放'`, hint `'镜头离开 5 秒或更久时，回放之前的进球、角球、射门或禁区附近的进攻，每个只播放一次'`). `themeFor` maps both canvas keys from `momentText`, like the card titles.

- [ ] **Step 1: Write the failing tests** in `test/render/flashback.test.ts`, with `recordingCtx`:
  - `'formats the time since the moment'`: the three `formatAgo` cases above.
  - `'puts the tab away from the action'`: ball at x 20 gives `'left'`, at x -20 `'right'`, with no ball `'left'`.
  - `'draws the stroke round the frame and the tab bottom left, at the design sizes'`: with `t = build2DTransform({ length: 105, width: 68 })` and `u = designUnit(t)`, expect a stroke rect inset `6 * u` with `lineWidth 12 * u` in `#ffffff`, and a tab whose left edge is `12 * u`, whose bottom is `FRAME_H - 12 * u`, and whose height is `(16 + 80 + 16) * u`. Expect `fillText('REPLAY', ...)` in `italic 900 ${64 * u}px` of the theme's title family and `#166a51`, and `fillText('2:47 AGO', ...)` at `36 * u`.
  - `'mirrors the tab to the right'`: the tab's right edge is `FRAME_W - 12 * u`.
  - `'shrinks the progress line with the clip'`: at `leftShare` 0.5 the line's width is half the tab's.
  - `'draws nothing at alpha 0, and no timer without one'`
  - `'is drawn over the goal banner, fixed to the frame in a zoomed view'`: `renderFrame` with `goalBanner` and `flashback` set, in a view zoomed to 2. The flashback ops come after the banner's, under the identity-scaled transform.
  - In `test/i18n/text.test.ts`, the existing completeness checks cover the new keys. Add `'says REPLAY in both languages'`.
- [ ] **Step 2:** Run `npx vitest run --project src test/render/flashback.test.ts test/i18n/text.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS, with the goldens and baseline snapshot untouched (no `-u`). Lint and typecheck clean.
- [ ] **Step 5: Commit** "Draw the flashback's stroke, tab, timer and progress line, from the Figma design".

---

### Task 6: The layer, listed in live mode only

**Files:**
- Modify: `src/model/replayLayers.ts`, `src/widget/layersMenu.ts`, `src/widget/createMatchTracker.ts` (pass the mode to `LayersMenu`)
- Test: `test/model/replayLayers.test.ts`, `test/widget/layersMenu.test.ts`

**Interfaces:**
- Produces:
  - `ReplayLayerKey` gains `'flashback'`; `DEFAULT_REPLAY_LAYERS.flashback = true`.
  - `REPLAY_LAYERS` entries become `{ key: ReplayLayerKey; liveOnly?: true }`, with `{ key: 'flashback', liveOnly: true }` right after `playerLoss`.
  - `new LayersMenu(shadow, onToggle, mode: 'live' | 'replay')`: it skips `liveOnly` entries in replay mode.

- [ ] **Step 1: Write the failing tests.**
  - `test/model/replayLayers.test.ts`: `'has flashback on by default, after playerLoss'`, and `'reads a stored flashback choice'`.
  - `test/widget/layersMenu.test.ts`: `'lists flashback in live mode only'`, mounting both modes. In replay mode the listed keys equal `REPLAY_LAYERS.filter((l) => !l.liveOnly).map((l) => l.key)`. Update `'lists every layer in order...'` to state its mode and expect its own list.
- [ ] **Step 2:** Run `npx vitest run --project src test/model/replayLayers.test.ts test/widget/layersMenu.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS, goldens and snapshot untouched.
- [ ] **Step 5: Commit** "Add the flashback layer, listed in live mode only".

---

### Task 7: Wiring it into the widget

**Files:**
- Create: `src/widget/flashbackStage.ts`
- Modify: `src/widget/createMatchTracker.ts`, `src/widget/events.ts`, `src/widget/hud.ts`
- Test: `test/widget/flashback.test.ts`, `test/widget/lossBadge.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 1 to 6.
- Produces:
  - `TrackerEvents.flashback: { phase: 'start' | 'end'; at: number }`.
  - `function labelMomentShowing(layers: FrameLayers | null): boolean` in `events.ts`: true when `goal`, `goalBanner`, `corner`, `throwIn`, `labelCard` or `smallLabelCard` is set. The attack, which the phase or a loss starts, does not count.
  - `class FlashbackStage` (`src/widget/flashbackStage.ts`):
    - `constructor(options: () => DirectorOptions)`. Makes the clip `Director` lazily, on the first clip (so a live widget that never plays one makes one director, as today), with `coverInvalidFrames: false`.
    - `see(record: TrackerRecord, liveWindow: readonly TrackerRecord[]): void`. Called from `push` after `history.add`. It adds the record to the store. For a record the carried validity calls valid, it spots with `deriveAt(windowAt(liveWindow, record), record).phase`, and notes what it spots.
    - `tick(nowMs: number, live: FlashbackLive, halves: SecondHalf, view: DirectorView): { out: DirectorOutput | null; indicator: FlashbackIndicator | null; events: FlashbackFrame['events'] }`. While a shot plays, it feeds the clip director `{ nowMs, time: shot.time, playing: true, playback: shot.playback, record: halves.shown(shot.record), phase, trail }`, where phase and trail come from `deriveAt(halves.window(windowAt(shot.records, shot.record), shot.record), halves.shown(shot.record))`, cached on `shot.record`. It returns that director's output. The indicator is `{ alpha, side: flashbackSide(halves.shown(shot.event)), agoS, leftShare }`; once the shot is gone, the last side and leftShare are kept while alpha fades out.
    - `setLayers(layers: ReplayLayers): void`: to the clip director, if made, so a layer switched off in the menu is off in clips too. The widget calls it from `applyLayers`.
    - `cut(nowMs: number): void`, `reset(): void` (store, spotter and controller cleared; the clip director reset), `get active(): boolean`, `get animating(): boolean`, `get clipView(): DirectorView | null`, `setView(view: DirectorView): void` (to the clip director, if made), `debug(): { kind: FlashbackKind; agoS: number } | null`.
  - In `Tracker` (`createMatchTracker.ts`), live mode only:
    - `push`: `this.flashback.see(record, this.history.window())`. On a stream break (the `breaks` change), the store drops its clips itself (Task 3); also call `this.flashback.cut(performance.now())`.
    - `tick`: after the live `director.update`, call `stage.tick` with `live = { newest: history.latest(), labelMoment: labelMomentShowing(liveOut.layers), layerOn: layers.flashback }`. While `out` is non-null, show it in place of the live output. Feed none of its paints to `MomentWatch`. Add `flashback: indicator` to the drawn paint's layers. Adopt its `camera` into the clip view only. When the stage goes inactive, repaint live (`this.repaint()`) so live play is drawn at once.
    - **Route at the choke point, `show()`.** Live output reaches `show()` from `tick`, `repaint()` (fonts, icons, `setOptions`, and the stale repaint at the end of `tick`), `measure()`, `setUserView` and `applyLayers`. While the stage is active, `show()` takes a live output only for its `loss` and its `camera` (into the held live view). It neither draws it nor watches it. In the same state, `repaint`, `measure`'s `setView`, `setUserView` and `applyLayers` also call the clip director (`setLayers`, `setView`) and draw its paint, with the indicator. zoomPan's `takeCamera` releases both directors' cameras.
    - **Indicator redraws**: on any tick where the indicator changed and no paint was drawn, draw the last drawn paint again with the new indicator. This covers the fade in, the timer, the progress line between clip records (the default socket sends about 10 a second), and the fade out over live play.
    - Moments: when a replay starts, emit `moment` `end` for everything `MomentWatch` shows (`moments.clear()`); live paints after it start them again.
    - The phase row: while a shot plays, `this.phase` is the clip input's phase, so the row matches the pitch; otherwise it is the live input's, as today.
    - The view: the widget's `view` (badge, zoomPan) is the painted director's. `setUserView` goes to both directors, so a viewer's zoom carries across. The live director's `camera` while unpainted is adopted into a held live view, not into `this.view`; on switching back, `this.view` becomes the live director's `view`.
    - `onOverlayPointerDown`, `trigger`, `reset`, `resumeAfterAbsence`, and a layer change turning `flashback` off all call `flashback.cut(...)` first; `reset` also calls `flashback.reset()`.
    - Emit `flashback` events from `tick`'s `events`.
    - The loop's animating check becomes `() => this.director.animating || this.flashback.animating`.
    - Debug badge: while `stage.debug()` is non-null, `LossBadge` shows `formatText(text.flashbackDebug, { kind, ago })`, with `ago` from `formatAgo(agoS, '{time}')`, and `data-cause="flashback"`.
    - Replay mode never makes a stage.

- [ ] **Step 1: Write the failing tests** in `test/widget/flashback.test.ts`, using `installEnv`, `makeHost` and `recordingDirector`/`recordingRenderer` (as `test/widget/invalidFrames.test.ts` does). Feed messages built like its `withState`, with human labels where needed, plus the staging fixture for the end-to-end cases.
  - `'replays a goal while a long run is invalid, then goes back to live on the first valid record'`: assert the drawn layers carry `flashback` with alpha rising to 1; the drawn frame is the clip's; one `flashback` `start` with `at` equal to the goal's `t`; then, on the valid record, the drawn frame is live, plus `flashback` `end`.
  - `'shows the clip phase in the row above the pitch during a replay'`
  - `'a resize, a font load or a layer change mid-replay redraws the clip, not live'`: during a clip, fire the resize observer, resolve the fonts promise, and toggle `ballTrail`. Every frame drawn is the clip's, with `flashback` on it, and no `moment` event fires.
  - `'moves the timer and the progress line between clip records'`: with clip records 100 ms apart, animation frames at 16 ms redraw with a falling `leftShare`.
  - `'makes no second director until a clip plays'`: `control.options.length` is 1 after mount and after a short run, and 2 after the first clip.
  - `'sends no moment events for what plays in a clip'`: the clip's goal draws its banner and sends no `moment` `goal` `start`.
  - `'does nothing with the layer off, as today'`: the drawn layers match a mount without the feature (same `attack` cover, no `flashback`).
  - `'cuts the replay when the layer goes off or the widget comes back into view'` (Review Focus 5).
  - `'cuts the replay on a press, and trigger plays on the live frame'`
  - `'ends the replay and drops every clip when the stream restarts'` (Review Focus 2): a `t` jump back of 20 s mid-clip gives `end`, and a following long run plays nothing.
  - `'carries the viewer zoom across, not the clip camera'` (Review Focus 3): zoom to 2 by `setUserView` mid-clip, cut, and expect the live view's zoom to be 2 and no camera from the clip adopted.
  - `'shows a first half clip on the first half ends'` (Review Focus 4): the clip is recorded at t 100, a human `half time` label arrives at t 200, and the run is at t 300. Expect the clip's drawn frame to be the unturned positions, and the tab side worked out on them.
  - `'plays through the staging fixture without flicker'`: push the fixture at 25 Hz with fake time. Expect at least one `start`, so the test is not empty. Expect every `end` to land on a valid record (never on one with no validity), and no `start`/`end` pair under 1 s apart.
  - `test/widget/lossBadge.test.ts`: `'says what replay is playing, in developer mode'`.
- [ ] **Step 2:** Run `npx vitest run --project src test/widget/flashback.test.ts test/widget/lossBadge.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `FlashbackStage` and the wiring. Keep `createMatchTracker.ts` growth to the glue; put the logic in the stage.
- [ ] **Step 4:** Run `npm test`, `npm run typecheck` and `npm run lint`. Expected: all clean. Goldens and snapshot untouched, and `test/widget/invalidFrames.test.ts` passes unchanged.
- [ ] **Step 5: Commit** "Play flashbacks in live mode while the camera is away".

---

### Task 8: Docs, the full checks, and the real browser

**Files:**
- Modify: `src/director/playerLoss.ts` (the "## Over invalid frames" comment), `README.md`, `CHANGELOG.md`

- [ ] **Step 1: The comment.** In `playerLoss.ts`, replace "this covers them, for now, until the cover the spec has in mind is built" with words saying that runs of 5 s or more play flashbacks when the `flashback` layer is on (`src/director/flashback.ts`), and that this attack is the fallback under them and the cover for shorter runs.
- [ ] **Step 2: README.**
  - Add `flashback` to the layers list (README line about "The layers are ...").
  - Add the `flashback` event to the events table.
  - Add a "Flashbacks" subsection under Invalid frames: when a replay plays, what counts, each once, the cut-off rules, the stroke and tab, that the menu lists it in live mode only, and that `reset()` drops the clips (a reconnect that calls it loses them).
  - Add the `debug` badge's flashback line.
  - Run `npx vitest run --project src test/readme.test.ts`. Expected: PASS.
- [ ] **Step 3: CHANGELOG.** Under `[Unreleased]`, add "What you see": live mode replays earlier moments over long invalid runs, with what counts, once each, live play first, the look, and the layer, plus "Replay is unchanged". Add "API": layer `flashback`, event `flashback`, `TrackerText` keys `flashback`, `flashbackAgo`, `flashbackDebug` and `layers.flashback`, and `LayersMenu` listing it live only. Say also that in replay mode the `layers` option and event now carry a `flashback` key, which does nothing there, so a host that compares layer objects sees it. Keep the existing Unreleased "Package" notes.
- [ ] **Step 4: Full checks.** Run `npm test && npm run typecheck && npm run lint && npm run build && npm run size`. Expected: all pass. `build` includes `check-dist` and `test/dist`. `size` prints under 60 kB for `dist/index.js` and under 2 kB for `dist/banner.js`. Paste the size lines into the commit body.
- [ ] **Step 5: The real browser.** Serve a page that mounts `dist/index.js` in live mode (Chrome via `chrome-devtools-axi`, page opened from a `file://` URL with `CHROME_DEVTOOLS_AXI_CHROME_ARGS="--allow-file-access-from-files"`). Push `test/fixtures/staging-validity.jsonl.gz` at 25 Hz, with one human `goal` label added before the first long run. Screenshot mid-replay at 1280x760 and at 390 px wide. Compare against the Figma frame `81:4738` (https://www.figma.com/design/a1DQtbTjxZYWYKecizCHkf/Game-Animation-Visualizer?node-id=81-4738), and against 81:4849 for the right tab if the Figma MCP allows reads. Check in particular the stroke weight, the tab inset and padding, the title size, colour and shadow, the timer baseline, the progress line, and that nothing is clipped at 390 px. Pixel-level mismatches are defects: fix them in `src/render/flashback.ts`, and rerun Steps 4 and 5.
- [ ] **Step 6: Commit** "Document flashbacks", with the size lines in the body. Then hand over with the screenshots.
