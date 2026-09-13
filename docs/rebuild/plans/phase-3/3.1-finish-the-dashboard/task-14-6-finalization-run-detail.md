# Task 3.1.14.6 · Finalization — run detail
<!-- roadmap: dash-detail-finalizer -->

**Current assignment: 3.1.14.6.** Intake: candidates with passing focused checks from 3.1.14.1–3.1.14.5.

- [ ] combine every assigned worker candidate and complete the full group gates and deferred proofs
- [ ] fix failures and pass the required full gates on the final corrected tree; no independent review step
- [ ] integrate the accepted result, close worker/finalizer records and clean up owned resources

Accepted output releases 3.1.16 realtime convergence and later acceptance. Existing audit-only 3.1.19 remains unchanged.

Read [the group map](README.md#parallel-execution-and-worktree-contract),
[D344](../../../../roadmap/roadmap.md#parallel-finalizer-cadence) and
[D191](../../../reference/guards-and-tests.md#d191--the-recommendation-is-adopted-testcoverage-becomes-the-per-commit-gate-operator-decision-2026-08-12).
These are separate sequential repair/integration assignments, not independent parallel siblings.
The operator launches each finalizer after every listed worker has a committed candidate and green
focused checks. Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13). No independent review
step is required; worker development completion is distinct from the group release.

Before worker launch, the focused plan binds the finalizer's exact branch/worktree/base, target,
merge permission, quick worker commands, deferred acceptance checks and resource ownership.
In an isolated integration worktree, combine the exact committed candidates, reconcile generated
output, run typecheck, lint and full coverage plus applicable generated checks, desktop parity,
build/production smoke, performance and acceptance proofs. Fix group defects, add regression
coverage and rerun required gates on the final corrected tree. Integration, completion records and
owned cleanup require a green result. Focused iteration is sufficient while fixing failures; do not
repeat broad suites for each intermediate fix or documentation-only recording. No coverage floor,
assertion, test membership, timeout or live-write boundary is weakened.
Shared contract/scope changes require a revised plan. Other groups' files remain outside ownership.

Current baseline and acceptance: [inventory](task-8-dashboard-inventory.md) and
[frozen matrix](task-8-acceptance-matrix.md). Historical subfeature credit does not close this finalization.
