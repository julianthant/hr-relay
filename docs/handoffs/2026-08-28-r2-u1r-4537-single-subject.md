# Run brief — Phase 3b R2/u1r: make 4537 the sole test subject

**Date:** 2026-08-28
**Repository:** `/Users/julianhein/Projects/hr-automation-rebuild`
**Integration branch / verified base:** `integration/03b` / `8ac7faf90e59ae6c1174af44bb7e3256970f836e`
**Coordinator board:** `/Users/julianhein/Projects/hr-automation-rebuild/docs/plans/03b-board.md`
**Board intake blob:** `c1599f8deedc2ed816e4142a8e68dbe8fa4c95ff`
**Decision:** `/Users/julianhein/Projects/hr-automation-rebuild/docs/decisions/2026-08-28-r2-u1-4537-registry-reconciliation.md`
**Supervisor report:** `/Users/julianhein/Projects/hr-automation-rebuild/docs/handoffs/2026-08-28-r2-u1r-4537-single-subject-report.md`

## Outcome

Implement the operator's answered Decision 1 A with its explicit scope override: freshly verify
Kuali doc 4537 read-only, then make existing label `finalization-canary` the only target/label in
`config/test-subjects.json` and the one test subject addressable by both `separations` and
`separations-kuali-finalization`. Remove the other eight registry labels and reconcile every owning
schema, resolver, manifest, guard, test and canonical document. Preserve prior document observations
as migration history, not active registry identities.

This run performs no composed rehearsal, gate approval, external write, save or finalization. The
next 4537 `dryRun=true` u1 is already operator-authorized after this run integrates; it is not part
of u1r and does not authorize any `dryRun=false` action.

## Required intake

- Root `AGENTS.md`, nearest instructions, and
  `/Users/julianhein/.agents/skill-library/playwright-cli/REFERENCE.md` before browser work.
- Coordinator board and `docs/plans/2026-08-27-03b-runs.md` at the exact paths above.
- Decision sheet item 1, especially its answered single-subject outcome.
- `docs/rebuild/03b-finish-separations.md` §The canary registry and exit row 5.
- `docs/rebuild/reference/guards-and-tests.md` §10.4–§10.5.
- `docs/migrations/separations.md` §§9.16, 9.19, 9.28–9.30.
- `src/control/test-target-registry.ts`, both T1b manifests, their structural scenarios, and
  `tests/unit/architecture/test-target-registry.test.ts`.
- Required orchestration: `/supervise`. Use only the native roles allowed by root instructions.

## Units and ownership

### u1r-a — fresh read-only 4537 authority check

One sequential `sup_terra` live unit on the root checkout. Use Duo Autopilot and `playwright-cli`.
Verify 4537 is present, the displayed last-day/separation dates, action-list state and transaction
number state. Do not save, submit, approve a gate, start a workflow run or mutate a form. Capture
restricted screenshots under:

`/Users/julianhein/Projects/hr-automation-rebuild/.tracker-rebuild/manual-verification/4537-2026-08-28/r2-u1r/`

Use neutral filenames without a name, EID, document number or transaction number. The supervisor
persists the redacted extraction table in the report. If facts differ, preserve the exact observed
state and continue only far enough to make 4537 the sole label with truthful `unknown`/`gone`
availability; no later unit may mark it available or run it.

### u1r-b — one-label registry and resolver contract

One `sup_sol` implementation unit on `feature/u1r-registry` in its own worktree, integrated `--no-ff`
after u1r-a. It owns `config/test-subjects.json`, `src/control/test-target-registry.ts`, focused unit
tests, generated build manifest changes caused by this seam, and the nearest applicable `AGENTS.md`
lesson. Keep only `finalization-canary` / doc 4537. Redesign the strict target boundary so the one
entry is explicitly supported by both workflow resolvers; do not bypass the workflow check, guess
from a label, duplicate the subject, or add an alias. Both resolvers must return the same label and
their own exact canonical input. Remove these eight entries:

`finalization-already-finalized`, `finalization-no-active-job`,
`finalization-subject-mismatch`, `separations-dry-run-subject`,
`separations-future-dated`, `separations-controlled-commit-candidate`,
`separations-pending-termination`, `separations-controlled-commit-canary`.

Acceptance: focused RED→GREEN tests prove exactly one label, both resolvers, wrong/unknown label
refusal, honest unavailable behavior, strict/frozen parsing and no public EID.

### u1r-c — manifests, guards and owning authorities

One `sup_terra` implementation unit after u1r-b merges, on `feature/u1r-scenarios` in its own
worktree. It owns both `tests/scenario/workflows/*/dry-run.scenario.ts` declarations, their sibling
structural tests, the architecture registry guard, `docs/rebuild/03b-finish-separations.md`,
  `docs/rebuild/reference/guards-and-tests.md`, `docs/migrations/separations.md`, and D284's owning
  phase/decision text. Both live
manifests use the sole label `finalization-canary`; retain only live cases 4537 can truthfully
exercise. Do not relabel 4537 as already-finalized, no-active-job, mismatch, future-dated or pending.
Keep negative branch coverage in pure structural/unit tests where it remains valid. Historical facts
for docs 4495, 4502, 4510, 4524 and 4568 remain clearly dated migration evidence but cease to be an
active inventory. Change doc 03b's D284 status from designed to built only when the implementation
and its proof land in the same commit; do not mint a second decision number.

Acceptance: the both-directions guard proves config, manifests and the phase inventory contain
exactly the sole 4537 label/subject; no removed label remains in executable registry/manifests or
normative active-inventory prose.

### u1r-d — independent review, fixes, integrated proof and close

Run independent correctness and silent-failure reviews of the complete implementation range, plus
tests/docs review of the manifest and authority changes. Use native read-only/review roles; reviewers
return findings to the supervisor. Any fix is a separately named native execution unit on the latest
integrated base and is re-reviewed on the affected axes. Then run:

`npm run typecheck`; `npm run lint`;
`HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage`;
`npm run test:parity`; `npm run build:manifest`; require no resulting diff;
`npm run roadmap`; `npm run roadmap:check`; `git diff --check`.

Do not change timeouts, thresholds, selectors, fallbacks or retry behavior. Run the repository's
worktree sweep after integration and prove the tree clean, no feature worktree/branch remains and no
browser is open. Commit the supervisor report and authorized board close only after the board blob
still matches intake.

## Stop rules

- Stop before a composed workflow rehearsal, worker start, gate approval, `dryRun=false`, UCPath
  submit, Kuali save/finalize or any external write.
- A changed/absent 4537 is not permission to substitute another document. Keep it as the sole label
  with truthful unavailable state and close blocked.
- Do not preserve a removed subject by alias, hidden fallback, second registry or manifest-only
  label. Historical prose is not executable identity.
- Do not delete old migration evidence, screenshots from prior runs or durable run evidence.
- Stop on board-blob conflict rather than overwriting another coordinator.

## Paste-ready supervisor prompt

```text
You are the SUPERVISOR for Phase 3b R2/u1r: make 4537 the sole test subject.
Run brief: /Users/julianhein/Projects/hr-automation-rebuild/docs/handoffs/2026-08-28-r2-u1r-4537-single-subject.md
Coordinator board: /Users/julianhein/Projects/hr-automation-rebuild/docs/plans/03b-board.md
Board write-back: AUTHORIZED AT CLOSE for this exact path only after verifying blob c1599f8deedc2ed816e4142a8e68dbe8fa4c95ff.
Supervisor report: /Users/julianhein/Projects/hr-automation-rebuild/docs/handoffs/2026-08-28-r2-u1r-4537-single-subject-report.md
Repo: /Users/julianhein/Projects/hr-automation-rebuild
Integration target: integration/03b containing the brief commit; verified product base 8ac7faf90e59ae6c1174af44bb7e3256970f836e.
Read the brief, decision, board, run plan, root/nearest AGENTS.md and named canonical authorities. Verify consequential intake facts.
Invoke /supervise and execute exactly u1r-a through u1r-d with only native roles and the brief's sequential worktree/integration rules.
Decision cleared: item 1 A plus operator override—existing label finalization-canary / doc 4537 is the sole test target for both separations workflows; remove the other eight labels.
First verify 4537 read-only with playwright-cli and restricted screenshots. Never substitute another document if facts differ.
No workflow rehearsal, worker, gate approval, dryRun=false, UCPath submit, Kuali save/finalize, selector/timeout/fallback/retry change or remote write is in scope.
Preserve old subjects only as dated migration evidence, not executable registry/manifests. Ratify owning docs and any decision pointer in the same implementation commit.
Run correctness, silent-failure and tests/docs reviews; fix and re-review findings; run the full brief gate and worktree sweep.
At close, re-read the exact board and require its intake blob unchanged, then commit only the authorized board update/report and return proof. Do not create a handoff on success.
```
