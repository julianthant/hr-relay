# Handoff — R2 u21 closed: the new-kronos range field is cleared provably before typing

**Date:** 2026-08-27
**Paused at:** R2 u21 merged and gated; R2 u1 (the 08-28 pre-flight) is next — its brief is `docs/handoffs/2026-08-28-run-1-t1b-canary.md`

## Task summary
u21 was the one code seam allowed before the 08-28 controlled commits (sheet item 1 A, `docs/decisions/2026-08-27-r2-preflight-decisions.md`): u14-fix had observed live that `setRangeField` typed onto an uncleared field (`"11/20/2626"` for a requested `6/1/2026`, `docs/migrations/separations.md` §9.28 line ~6262, `d45376d0`). The fix had to land BEFORE u1 because the tree is frozen between u1 and u4 (a moved `implFingerprint` stops checkpoint replay). It landed on the root checkout, `integration/03b`, no worktrees; the `../hr-automation-rebuild-ui*` worktrees belong to run UI-1 and were not touched.

## Plan
- Run plan: `docs/plans/2026-08-27-03b-runs.md` §R2 (u21 spec verbatim at line 21; u1–u5 follow)
- Board: `docs/plans/03b-board.md` — the u21 ledger row is written (`d60c8ec3`); residue item (2) now points at the fix

## Current state (from git)
- Repo: `/Users/julianhein/Projects/hr-automation-rebuild`   Branch: `integration/03b`   HEAD: `d60c8ec3`   Base for this run: `4825688d`
- Worktrees: root only for this run. `../hr-automation-rebuild-ui` (feature/ui-fidelity), `-ui-u2` (feature/ui-u2), `-ui-u3` (feature/ui-u3) are run UI-1's — leave them
- Commits ahead of `4825688d`: 6
  ```
  d60c8ec3 docs(board): u21 ledger row — range-field clear held by read-back, fix round, gate 316/3460 at 5d92794a
  5d92794a chore(manifest): regenerate for u21-fix's interpreter.ts change
  3b9588c5 fix(new-kronos): hold the range-field clear across two samples, not one (u21-fix)
  243409bd chore(manifest): regenerate after setRangeField clear-then-type fix (u21)
  21c4aa4a fix(new-kronos): clear the range field before typing, proven by read-back (u21)
  f157aae6 test(new-kronos): pin setRangeField's clear-then-type contract (u21)
  ```
- Uncommitted: clean
- master: `8e322e8a` — not moved

## Progress
- [x] u21 — `sup-sonnet`, STATUS done (`f157aae6` `21c4aa4a` `243409bd`). Silent-failure review (`review` skill, one axis per the run brief): 0 silent failures, 1 judgement — the clear poll accepted the FIRST `""` sample, which is `fill("")`'s synchronous DOM write, not the digest's answer.
- [x] u21-fix — `sup-sonnet`, STATUS done (`3b9588c5` `5d92794a`): the clear settles only when two CONSECUTIVE `inputValue()` samples read `""` (one `POLL_INTERVAL_MS` apart), else refuses by name with the last observed value and the bound; new test case (d) pinned RED at HEAD; the placeholder `sk-…` citation replaced with §9.28 / `d45376d0`. Re-review of the fixed seam: skipped — the fix is the reviewer's own one-line prescription, the delta is 4 lines of predicate + a test case, and the gate specifies it.
- [x] Integrated gate at `5d92794a` (supervisor-run, load 18.7): typecheck exit 0 · lint exit 0 · `test:coverage` **316 files / 3460 tests** · `build:manifest` no diff · `roadmap:check` fresh
- [x] Board ledger row for u21 (`d60c8ec3`)
- [ ] R2 u1 pre-flight ← **resume here on Pacific 2026-08-28** — follow the 11-step table in `docs/handoffs/2026-08-28-run-1-t1b-canary.md`; its "base = R1's exit sha" line is now `d60c8ec3`

## What u21 changed (for u1's eyes)
- `src/stores/new-kronos/driver/interpreter.ts` `setRangeField` (~565–627): `click` → `fill("")` → poll until two consecutive `""` reads (bound `RANGE_FIELD_CLEAR_TIMEOUT_MS` = 8 s) → `pressSequentially` → the existing calendar-day read-back poll. The `ControlOrMeta+a` press is gone. Either half refuses BY NAME; no retry, no second attempt, no new selector.
- `tests/unit/new-kronos-range-field.test.ts` — stub-Page test, 4 cases: (a) pre-filled → cleared then typed; (b) `fill("")` never reads `""` → clear refusal, `pressSequentially` never called; (c) already empty; (d) `""` for one read then reverted → clear refusal, never typed.
- `src/stores/new-kronos/CLAUDE.md` — dated lesson 2026-08-27.
- **Not live-verified.** The 8 s clear bound has no live measurement; u1's `dryRun=true` on 4537 is the first live pass over this code (the timecard window `07/28/2026`–`09/28/2026`). If the clear refuses live, that is a REAL finding for §9.28 — record it; do not widen the bound blind.

## Open questions / deferred decisions
- None new. Standing R2 conditions (i)–(iii) and the u3 "re-run ① immediately after ②" keyboard question are unchanged — see the R2 brief.

## Verification before resuming
```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status --short --branch && git worktree list && git log --oneline -1   # expect d60c8ec3 on integration/03b, clean
uptime   # gate only when the 1-min load is < ~20 (macOS indexing daemons flake 12–16 files on 30 s timeouts)
npm run typecheck && npm run lint
HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage 2>&1 | tail -8   # expect 316 / 3460
npm run build:manifest && git status --short   # expect no diff
npm run roadmap:check
```

## Pointers
- Read first: `docs/plans/03b-board.md` (ledger + residue) → `docs/handoffs/2026-08-28-run-1-t1b-canary.md` (the R2 brief, 11-step u1 pre-flight) → `docs/plans/2026-08-27-03b-runs.md` §R2 → root `CLAUDE.md` §"Live verification" → `src/stores/new-kronos/CLAUDE.md` (lessons)
- Memory: `~/.claude/projects/-Users-julianhein-Projects-hr-automation-rebuild/memory/worktree-agent-traps.md`
- Related handoffs: `2026-08-28-run-1-t1b-canary.md` (R2 brief, supersedes this one for u1–u5) · `2026-08-27-r1-closeout-seams-closed.md` (R1 close)

## Suggested skills for the next session
- `/supervise` — re-enter with the R2 unit list: u21 merged; u1 is next (`sup-opus`, `hr-manage` + `hr-debug`)
- `/hr-debug` — u1's node-by-node submit-free audit of the 4537 dry run
