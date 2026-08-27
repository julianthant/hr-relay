# Decisions — R2 pre-flight (the 2026-08-28 canary) — 2026-08-27
_Answer positionally: `1 A, 2 B + "note"`, or "all recommended". Anything unanswered stays open._

R1 closed green at `db3f76f6` (coordinator-verified: 315 files / 3,456 tests, roadmap fresh, manifest unchanged). A read-only analyst traced the two live new-kronos refusals u14-fix found onto tomorrow's chain (`docs/handoffs/2026-08-27-r1-closeout-seams-closed.md`, board §Residue): both surfaces (`selectEmployeeInPanel`'s second `searchEmployee`, and `setRangeField`) are in the read half — nodes 10/11 of `src/workflows/separations/descriptor.ts:372-392` — upstream of the gate (row 14) and of every transaction node (rows 16/17/19). Refusal (1) cannot fire composed: each node takes a fresh lease that resets the page to `/wfd/home` (`src/core/worker-sessions.ts:471`, `src/infra/browser/browser-session-factory.ts:375-397`); u14-fix's probe searched twice on one page with no navigation. Refusal (2) is a latent flake — the readback `11/20/2626` is `11/20/2026` with one character overtyped at index 7 (`docs/migrations/separations.md:6261-6262`), i.e. the select-all did not clear — and it would fire BEFORE commit ②, never between ② and ③, because checkpoints are keyed `(workflow, item, node)` without dryRun (`descriptor.ts:840-842`, `src/core/run-executor.ts:718-722`): u1's dry run on 4537 seeds the checkpoints the live commits replay, and only `timecard-search` (`always-rerun`) runs live again.

## 1 · Harden `setRangeField` before u1, or rely on u1's dry run to catch it?
**Situation.** One file: `src/stores/new-kronos/driver/interpreter.ts:560-588`. The fix is to clear provably (`fill("")` + poll `inputValue() === ""`) before `pressSequentially`, refusing by name if the field will not clear. It moves the build manifest, so it must land BEFORE u1 and never between ② and ③ (a moved `implFingerprint` stops checkpoints replaying — `src/core/run-executor.ts:680`).
**Options.**
- **A.** Land it tonight as **u21** (`sup-sonnet`, cause known, one seam; a stub-Page test RED at HEAD for a pre-filled field; `build:manifest`; full gate) — R2 starts from a tree where the flake cannot recur. Cost: one small unit + gate tonight; the first composed live run on the post-u14 driver is still u1 tomorrow either way.
- **B.** Rely on u1: if the flake fires, the run terminalizes pre-gate, pre-write, and you re-run u1. Cost: a wasted live pass on the one day the canary is admitted, and the cause is already known.
**Recommendation.** A.
**Notes.** _(yours)_

## 2 · Commit ② files on the reads u1's dry run replayed — or force a fresh read?
**Situation.** dryRun is not in the item key, so u1's dry run and u2's live filing are the same item `separations:4537`; ② replays u1's checkpointed reads (values you approved at the gate; `maxAgeMs: Infinity` by design, `descriptor.ts:50-56`). A `reRead` ordinal mints a new item with no checkpoints — the whole read half, both refusal surfaces, runs live again (still pre-write).
**Options.**
- **A.** Replay — file on the reads approved at the gate. Cost: the reads are minutes old, not seconds; that is the designed contract.
- **B.** `reRead` before ② — a fresh kronos/UCPath read half. Cost: a full read half live, both refusal surfaces re-opened, and it must happen before ②, never after.
**Recommendation.** A.
**Notes.** _(yours)_

## 3 · Which workflow drives commit ③ (Kuali finalization)?
**Situation.** The composed `separations` graph reaches ③ by replaying its checkpoints after ②; the standalone `separations-kuali-finalization` workflow has NO kronos node (`src/workflows/separations/kuali-finalization/descriptor.ts:331`). A generic kronos flake after ② (the one live `timecard-search`) is the only way to strand ② without ③.
**Options.**
- **A.** Composed graph first; if it refuses in new-kronos after ②, switch to `separations-kuali-finalization` for ③ — never retry the composed graph into a kronos wall. Cost: two code paths named in the brief; the fallback's evidence lands in §9.28 under its own workflow id.
- **B.** Composed graph only. Cost: a kronos flake after ② leaves a filed UCPath transaction waiting on a retry into the same wall.
- **C.** Standalone for ③ always. Cost: exit row 5 wanted the chain's own ③; a standalone ③ proves less.
**Recommendation.** A.
**Notes.** _(yours)_

## 4 · Merge `integration/03b` into master now?
**Situation.** R1 is green and reviewed; master sits at the 03a close (`8e322e8a`). CLOSE says merge after green; it does not say per run or per phase.
**Options.**
- **A.** Merge now `--no-ff` — master carries R1 before tomorrow's live day; a rollback point that includes u14's driver fixes. Cost: one operator-run merge (the classifier blocks me).
- **B.** Wait for R2. Cost: master is a day behind the driver the live run uses.
**Recommendation.** A.
**Notes.** _(yours)_

## 5 · `vitest.config.ts` — the formatting-only reflow still in the tree
**Situation.** 19/7 lines of Prettier re-wrapping, mtime 05:07 today, not from any run; every supervisor has stepped around it. It is the only thing keeping the root tree dirty.
**Options.**
- **A.** Drop it: `git checkout -- vitest.config.ts`. Cost: none; the next format-on-save may re-create it — worth finding which editor does it.
- **B.** Commit it as `style(vitest): prettier reflow`. Cost: a no-op commit; the same editor will keep generating them.
**Recommendation.** A.
**Notes.** _(yours)_

## 6 · R1's token figure
**Situation.** The supervisor did not report its window size; the run plan's log needs it to calibrate the next cut (5 units, one fix round per unit, ~90 review findings' worth of fixes).
**Options.** Reply with the figure from your session (`/cost` or the status line) — or "unknown".
**Notes.** _(yours)_
