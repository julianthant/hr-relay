# Handoff — Finish separations R1 revision 3

**Date:** 2026-09-01

**Paused at:** R1 dispatch gate before u1

**Cleanup owner:** the resuming separations supervisor

**Remove when:** the supervisor has verified this state, completed or durably re-handed off R1, reconciled the authorized board, and committed deletion of this consumed file

## Task summary

Finish the sole open Phase 3b exit criterion: the controlled separations close for Kuali document `4537`, registered as `finalization-canary`. The software readiness work is integrated and the phase is at 8/9 exit criteria; the remaining work is the live read-only re-verification, composed dry-run rehearsal, three individually gated controlled writes, evidence preservation, authority reconciliation, local integration, and cleanup.

Use the existing coordination workspace as the shared authority:

- `docs/coordinator/separations-completion/project-profile.md`
- `docs/coordinator/separations-completion/board.md`
- `docs/coordinator/separations-completion/run-plan.md`
- `docs/coordinator/separations-completion/briefs/r1.md`
- `docs/coordinator/separations-completion/reports/r1.md`
- `docs/coordinator/separations-completion/reports/r1-rev2.md`

The newest operator-supplied root `AGENTS.md` instructions govern. Do not rely on older `CLAUDE.md` references in the project profile, and never create or edit a `CLAUDE.md` file.

## Plan and shared state

R1 remains divided into u1–u5 and has not passed its dispatch gate:

1. **u1 — read-only intake:** freshly re-verify document `4537` and current S7 state.
2. **u2 — composed rehearsal:** execute the exact `dryRun=true` path and prove zero deltas in `write_intents`, `write_attempts`, and `durable_outbox`.
3. **u3 — controlled sequence:** perform D287's exact order, with one fresh operator ALWAYS-GATE for each write: ② UCPath filing → immediate ① pending sweep on the new row → ③ Kuali finalization.
4. **u4 — evidence:** preserve the complete A5 obligation and authority record, including every gate and outcome.
5. **u5 — close:** run the declared gates, reconcile only owning authorities whose truth changed, merge the verified branch locally with `--no-ff`, update the authorized coordinator board, and clean the completed branch/worktree state.

Safety constraints are unchanged:

- The live sequence runs only from the primary checkout because it owns `.env`, `.tracker-rebuild`, and `.auth`.
- Use only registered subject `4537` / `finalization-canary`. Documents `4570`, `4567`, and `4566` appeared in operator evidence but are not authorized by D284.
- Take a separate operator approval at each ALWAYS-GATE. A prior gate does not authorize the next write.
- Do not call `reRead` after write ②.
- If any submit result is `UNKNOWN`, stop. Never retry it.
- Do not push, perform an automatic remote merge, or take unrelated live HR action.

## Current state — verified, not remembered

Verified on 2026-09-01 in `/Users/julianhein/Projects/hr-automation-rebuild`:

- Branch: `master`
- HEAD: `4fd5292dab8f9353e82f97a609866fa82e092326`
- `origin/master`: `50adf8a9165341b1cc18080631dcd07b6a37d4e4`
- Local `master` is 25 commits ahead of `origin/master`.
- Exactly one worktree exists: the primary checkout on `master`.
- `feature/03b-live-close` does not exist.
- Runtime phase reports `completedThrough=2j` and `active=3-workflow-migration`.
- `npm run cli -- storage doctor` was green at `2026-09-01T16:26:23.244Z`: authority schema v28/generation 1293, `quick_check` green, zero pending commands/write intents/outbox/provider reservations/artifact outbox, and a current generation-matched backup.
- `npm run smoke:test-target-person-secrets` is red because these three operator-owned values are absent:
  - `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME`
  - `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID`
  - `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME`
- The checkout is not quiescent. Another active dashboard/D296 session owns 16 modified files:
  - `src/dashboard/app/dashboard-app-model.ts`
  - `src/dashboard/app/dashboard-app.tsx`
  - `src/dashboard/surfaces/run-start-model.ts`
  - `src/dashboard/surfaces/run-start-timeline.ts`
  - `src/dashboard/surfaces/run-start.tsx`
  - `src/domain/dashboard/bootstrap.ts`
  - `src/infra/providers/local-vite-probe.ts`
  - `src/server/dashboard/queries/bootstrap.ts`
  - `tests/parity/helpers/fixture-day.ts`
  - `tests/parity/toolbar-touch-target.spec.ts`
  - `tests/unit/dashboard-wire.test.ts`
  - `tests/unit/dashboard/fixtures/run-captures-app-fixture.ts`
  - `tests/unit/dashboard/run-start-dialog.test.ts`
  - `tests/unit/dashboard/takeover-frame-focus.test.ts`
  - `tests/unit/server/bootstrap-start-surface.test.ts`
  - `tests/unit/server/preflight-runners.test.ts`

Do not stash, revert, stage, amend, or otherwise take ownership of those 16 files. Wait for their owning session to commit or dispose of them, then re-verify a clean and exclusive primary checkout.

The coordinator board was last verified at `136f87c6` and is stale only with respect to the newer master HEAD and the current D296 working changes. Its R1 scope, ordering, safety rules, and blocked-before-u1 status still agree with observed state. Do not invent a replacement plan; refresh the board only after an authorized verified R1 outcome.

## Progress

- Five earlier Phase 3b integration branches were finished and integrated.
- Database lineage choice 1A was ratified as D290.
- Bounded-memory archive downloads and multi-origin diagnostic image behavior were repaired and integrated.
- The chosen Run-modal Options and Steps design was preserved; destination controls were removed from that port.
- Phone/mobile document Capture Mode was retired under D294 and is outside this R1.
- Phase 3b software readiness is recorded as 8/9. Track A A2–A5 plus A8 remains the only open exit work.
- No R1 branch was created, browser opened, run started, gate requested, write attempted, retry issued, or `UNKNOWN` outcome observed in the blocked revision-2 attempt.

## Dispatch boundary

Do not create `feature/03b-live-close` and do not begin u1 until all of these are freshly green together:

1. `git status --porcelain` is empty and the primary checkout is exclusively available; the D296 owner has finished.
2. `npm run smoke:test-target-person-secrets` passes for all three registered person-value references.
3. `npm run cli -- storage doctor` is freshly green with a current valid backup.
4. The supervisor records the then-current clean `master` HEAD as the R1 base pin and confirms an operator gate window is available for u3.

After those checks, create `feature/03b-live-close` from that exact clean `master` HEAD in the primary checkout and resume at u1. The current `4fd5292d` value is evidence of this handoff, not a future branch pin; D296 may legitimately advance `master` first.

## Open questions and deferred decisions

- The three person secret values must be supplied through the ignored `.env` authority. Never put their values in a prompt, log, handoff, test fixture, or committed file.
- The other document numbers visible in prior operator evidence remain excluded. If the operator later wants them included, stop and require an explicit D284 scope change before touching them.
- If the active D296 session changes separations-owned contracts or the live run surface, reassess the impact after it commits. Do not merge around its uncommitted state.
- Any new ambiguity at a write boundary belongs in a numbered decision brief. Read-only verification should proceed once the four dispatch conditions are green.

## Verification before resuming

Run these from the repository root and preserve the outputs in the R1 evidence record:

```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/master
git rev-list --count origin/master..HEAD
git worktree list
git show-ref --verify --quiet refs/heads/feature/03b-live-close; echo $?
npm run cli -- phase
npm run smoke:test-target-person-secrets
npm run cli -- storage doctor
```

Only after every dispatch condition is green and the branch is still absent:

```bash
git switch -c feature/03b-live-close
```

Then follow `briefs/r1.md` and `run-plan.md` for u1–u5. Run every gate declared by the repository; if tests are run, lint is mandatory. Stage paths explicitly, commit by logical category, merge locally with `--no-ff`, and do not push.

## Pointers

- Owning phase: `docs/rebuild/03b-finish-separations.md`
- Migration authority: `docs/migrations/separations.md`
- Readiness evidence: `docs/coordinator/worktree-completion/status/2026-08-31-separations-readiness.md`
- Coordination board: `docs/coordinator/separations-completion/board.md`
- R1 brief: `docs/coordinator/separations-completion/briefs/r1.md`
- R1 reports: `docs/coordinator/separations-completion/reports/r1.md` and `reports/r1-rev2.md`
- Runtime operations: `.agents/skills/hr-manage/SKILL.md`

## Suggested skills

- `/supervise` — required for this multi-part R1 close; the supervisor owns sequencing, integration, verification, and consequential judgment.
- `hr-manage` — use for dashboard/runtime startup, dry-run execution, monitoring, gates, receipts, and closure.
- `/debug` — only if a concrete red-capable failure arises during R1.
- `/ui` — only if verified R1 work truly requires a user-visible dashboard change; do not absorb the active D296 work.
