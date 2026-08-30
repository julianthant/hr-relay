# Handoff — Phase 3b R2c: repair 4568 `clear-pending` dry-run preview

**Date:** 2026-08-28
**Paused at:** the exact 4568 rehearsal is terminal-failed and submit-free; the UCPath SS Smart HR
page-state repair has not started.

## Task summary

The operator approved run `b8eefb6d-32c1-4cc1-95b1-b180e564620a` at its exact
`identity-approval` gate after reviewing fresh Kuali, UCPath and New Kronos screenshots. The command
was CAS-applied, the run resumed, and the dry-run probe for `clear-pending` refused before staging:

> the SS Smart HR search rendered neither a result row nor PeopleSoft's no-results marker within
> 45000ms

Authority classified the failure as non-transient `UNHANDLED`, node `clear-pending`, fingerprint
`60fbc99bfbf508589ecfebe74f53a27b0d7d8f940dea1579cb18a5903f2c22f7`, with
`writeState: not-attempted`. This is the red feedback loop for R2c. Diagnose the live post-search
page shape, repair the UCPath driver/page-state seam, pin it with a test that fails against the old
behavior, and prove the repair with a new composed `dryRun=true` rehearsal. Do not extend the wait,
invent an empty-result fallback, or retry the unchanged implementation.

The previous approval applies only to the closed gate on the failed run. A new rehearsal may run
under standing live-verification authorization, but its new identity gate requires a new operator
decision from its own packet. No `dryRun=false` action is authorized.

## Plan and shared state

- Plan: `docs/plans/2026-08-27-03b-runs.md`; add R2c/u31–u35 at close only if verified work changes
  the plan's truth.
- Coordinator board: `docs/plans/03b-board.md`, last changed at
  `b3ea2c21aa5450833129fedc9723cc6f41d15e5a`; it does not yet contain this 2026-08-28 failure.
  When this handoff is used as the R2c run brief, board write-back is authorized to this exact path
  **only at successful close**; no worker or reviewer may write it.
- Owning phase/specs: `docs/rebuild/03b-finish-separations.md` exit row 5;
  `docs/migrations/separations.md` SS Smart HR search/probe and D215 preview sections;
  `docs/rebuild/reference/write-safety.md` dry-run preview and fail-loud transaction rules.
- Runtime evidence: `.tracker-rebuild/state.db`; authority receipt
  `1e4a5f3c-9113-50d5-a6bd-54663a05a26b`; failure
  `6d578da5-1f09-4d4e-8980-da0986c38919`.

## Current state (verified, not remembered)

- Repository / branch: `/Users/julianhein/Projects/hr-automation-rebuild` / `integration/03b`.
- Verified implementation base before this handoff: `eaae52dcbcfd917ec91e35afa05c181fa1911ce8`.
  Start from current `integration/03b` including this handoff commit, and verify the SHA first.
- Task commits ahead: none; the failed run produced no repository commit.
- Uncommitted: clean.
- Worktrees: the root plus unrelated dashboard worktrees under
  `/Users/julianhein/.codex/worktrees/`; none belongs to R2c. Do not touch, merge, or sweep them.
- Runtime cleanup: owned rebuild BFF and worker PIDs are absent; no listeners on 3938/5174; no
  Playwright sessions. The legacy dashboard remains owned by another process and is out of scope.
- Dependency note: at handoff, `npm run cli -- explain ...` failed with `tsx: command not found` in
  the root checkout. Restore the supervisor worktree with `npm ci` before treating any CLI failure
  as workflow evidence.

## Progress

- [x] Exact identity gate approved — command `5971115a-65d8-4150-bdfd-f563c942e29c`, expected
  version 47, applied at `2026-08-28T15:42:47Z`.
- [x] Exact failed authority tuple captured — run `b8eefb6d-32c1-4cc1-95b1-b180e564620a`, trace
  `sp-081941-b8ee`, receipt `1e4a5f3c-9113-50d5-a6bd-54663a05a26b`, 15 checkpoints.
- [x] Submit-free result independently queried — exact-run
  `write_intents/write_attempts/durable_outbox = 0/0/0`; no `transaction.previewed` terminal.
- [x] Fresh read-only visual verification captured under
  `.tracker-rebuild/manual-verification/4568-2026-08-28/`. These prove the identity/date inputs, not
  the failed SS Smart HR page state; the failed run itself persisted no screenshot artifacts.
- [ ] **u31 — resume here:** reproduce the SS Smart HR post-search render live with Duo Autopilot;
  save a raw accessibility snapshot, screenshot, relevant DOM/count facts and exact route state.
- [ ] **u32:** repair only the proven page-state/settlement seam in
  `src/stores/ucpath/driver/smart-hr-operation.ts` and, only if live evidence requires it,
  `src/stores/ucpath/driver/ui-registry.ts`; add/adjust focused tests.
- [ ] **u33:** correctness + silent-failure review. Preserve explicit unreadable/unknown behavior;
  reject a longer timeout, fallback-to-empty, selector union that masks ambiguity, or swallowed error.
- [ ] **u34:** new composed 4568 `dryRun=true` acceptance. At a new identity gate, present its own
  packet and wait for the operator. Success means `clear-pending` reaches the D215 preview terminal
  and exact-run 0/0/0 remains true.
- [ ] **u35:** record authority evidence in the owning migration/phase docs, update the exact board
  at successful close, run the integrated gate, and sweep only R2c-owned worktrees/branches.

## Open questions / deferred decisions

- What exact DOM state followed the Search click: an unmodeled count/status banner, a different
  result container, a frame/context transition, an error/modal, or a click that did not take? Live
  snapshot evidence decides; do not choose from code inspection.
- Was the 45-second outcome genuinely timing? The span already spent the whole bound. Per
  `hr-debug`, increasing it is forbidden until live instrumentation disproves page-state mismatch.
- Automatic in-run screenshot persistence is a separate known gap. It is out of R2c unless the
  operator explicitly expands scope; u31's diagnostic artifacts are not to be mislabeled as run
  artifacts.

## Verification before resuming

```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status --short --branch
git branch --show-current
git rev-parse HEAD
git worktree list
npm ci
npm run cli -- explain run b8eefb6d-32c1-4cc1-95b1-b180e564620a --json
sqlite3 .tracker-rebuild/state.db "SELECT record_json FROM failures WHERE record_key='6d578da5-1f09-4d4e-8980-da0986c38919';"
```

The live loop is `playwright-cli` with Duo Autopilot against the configured SS Smart HR search route.
Use a fresh R2c-owned profile, capture the state immediately before and after Search, and close every
browser. After the focused RED→GREEN test and live proof:

```bash
npm run build:manifest
npm run typecheck
npm run lint
HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage
npm run roadmap:check
git diff --check
playwright-cli list
```

For the new rehearsal, independently query its own checkpoint and write rows; never reuse this
run's 0/0/0. No real write, controlled commit, or Kuali finalization is in scope.

## Pointers

- Read first: root `AGENTS.md`; `.agents/skills/hr-debug/SKILL.md` §§0–2;
  `.agents/skills/hr-manage/SKILL.md`; `/Users/julianhein/.agents/skills/playwright-cli/SKILL.md`.
- Failing seam: `src/stores/ucpath/driver/smart-hr-operation.ts` around
  `scanTerminationTransactionsOnPage` and the row/no-results settlement race.
- Selector/page-state declarations: `src/stores/ucpath/driver/ui-registry.ts` entries
  `UCPATH_SS_SMART_HR_SEARCH_*`.
- Existing coverage: `tests/scenario/separations-ucpath-termination.scenario.test.ts` and
  `tests/unit/ucpath-termination-verdict.test.ts`; add a driver-level regression if those cannot turn
  red under the live failure shape.
- Visual inputs: `.tracker-rebuild/manual-verification/4568-2026-08-28/` — restricted HR evidence;
  do not copy it into committed docs.

## Suggested skills

- `/supervise` — run u31–u35 as one live UCPath page-state repair theme.
- `/hr-debug` — enforce live reproduction before hypothesis or patch.
- `/tdd tests` — prove the regression test can fail against the old settlement logic.
- `/hr-manage` — launch and monitor the new dry-run acceptance and gate ceremony.
