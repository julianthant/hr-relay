# Phase 3.1 parallel finalizers

Read [the group map](README.md#parallel-execution-and-worktree-contract),
[D344](../../../../roadmap/roadmap.md#parallel-finalizer-cadence) and
[D191](../../../reference/guards-and-tests.md#d191--the-recommendation-is-adopted-testcoverage-becomes-the-per-commit-gate-operator-decision-2026-08-12).
These are separate sequential repair/integration assignments, not independent parallel siblings.
The operator launches each finalizer after every listed worker has a reviewed candidate and green
focused checks. Worker readiness permits intake even though worker completion stays open.

Before worker launch, the focused plan binds the finalizer's exact branch/worktree/base, target,
merge permission, quick worker commands, deferred acceptance checks and resource ownership.
In an isolated integration worktree, combine the exact reviewed candidates, reconcile generated
output, run typecheck, lint and full coverage plus applicable generated checks, desktop parity,
build/production smoke, performance and acceptance proofs. Fix group defects, add regression
coverage, obtain fresh independent review of the fixes and combined candidate, then rerun gates on
the corrected tree. Integration, completion records and owned cleanup require a green reviewed
result. No coverage floor, assertion, test membership, timeout or live-write boundary is weakened.
Shared contract/scope changes require a revised plan. Other groups' files remain outside ownership.

## Task 23 · Finalize dashboard surfaces
<!-- roadmap: dash-surfaces-finalizer -->

**Current assignment: 3.1.23.** Intake: reviewed workers 3.1.9.1–3.1.9.7.

- [ ] combine every assigned worker candidate and complete the full group gates and deferred proofs
- [ ] fix failures, obtain independent review of the combined result and pass gates on the corrected tree
- [ ] integrate the accepted result, close worker/finalizer records and clean up owned resources

Accepted output releases 3.1.10 Date, 3.1.11 Sessions and 3.1.12 Activity. Existing audit-only 3.1.19 remains unchanged.

## Task 24 · Finalize run operations
<!-- roadmap: dash-operations-finalizer -->

**Current assignment: 3.1.24.** Intake: reviewed workers 3.1.11.1–3.1.11.2.

- [ ] combine every assigned worker candidate and complete the full group gates and deferred proofs
- [ ] fix failures, obtain independent review of the combined result and pass gates on the corrected tree
- [ ] integrate the accepted result, close worker/finalizer records and clean up owned resources

Accepted output releases 3.1.13 Queue, 3.1.14 Detail foundation and 3.1.15 Runtime. Existing audit-only 3.1.19 remains unchanged.

## Task 25 · Finalize run detail
<!-- roadmap: dash-detail-finalizer -->

**Current assignment: 3.1.25.** Intake: reviewed workers 3.1.14.1–3.1.14.5.

- [ ] combine every assigned worker candidate and complete the full group gates and deferred proofs
- [ ] fix failures, obtain independent review of the combined result and pass gates on the corrected tree
- [ ] integrate the accepted result, close worker/finalizer records and clean up owned resources

Accepted output releases 3.1.16 realtime convergence and later acceptance. Existing audit-only 3.1.19 remains unchanged.
