# Task 3.1.11.3 · Finalization — run operations
<!-- roadmap: dash-operations-finalizer -->

**Current assignment: 3.1.11.3.** Intake: candidates with passing focused checks from 3.1.11.1–3.1.11.2.

- [ ] combine every assigned worker candidate and verify the integrated group with focused checks
- [ ] fix group defects; pass typecheck, focused integration tests, scoped lint and affected build/generated checks
- [ ] record broad gates as deferred to 3.1.19; integrate the focused release, close worker/group records and clean up owned resources

Accepted output releases 3.1.13 Queue, 3.1.14 Detail foundation and 3.1.15 Runtime. Full repository gates and final repairs remain at 3.1.19; this is a focused development release.

Read [the group map](README.md#parallel-execution-and-worktree-contract),
[D344](../../../../roadmap/roadmap.md#parallel-finalizer-cadence) and
[D191](../../../reference/guards-and-tests.md#d191--the-recommendation-is-adopted-testcoverage-becomes-the-per-commit-gate-operator-decision-2026-08-12).
These are separate sequential repair/integration assignments, not independent parallel siblings.
The operator launches each finalizer after every listed worker has a committed candidate and green
focused checks. Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13). No independent review
step is required; worker development completion is distinct from the group release.

Before worker launch, the focused plan binds the finalizer's exact branch/worktree/base, target,
merge permission, quick worker commands, deferred acceptance checks and resource ownership.
In an isolated integration worktree, combine the exact committed candidates and reconcile generated
output. Run `npm run typecheck`, focused integration/regression tests over the changed interfaces,
scoped lint and affected build/generated checks. The focused brief names exact test/lint paths and
commands. Fix group defects, add regression proof and rerun invalidated checks on the corrected tree.
Pass this scoped verification before releasing downstream consumers; do not claim full acceptance.

Defer full coverage, whole-repository lint/architecture, broad desktop parity, production smoke,
performance, recovery and the complete acceptance matrix to 3.1.19. Retain fixtures, proof commands,
missing broad evidence and exact candidate/integration SHAs for that task. Group-specific targeted
proof remains required where it establishes a changed interface. No full suite is required just
for a group release or documentation-only recording. Preserve coverage floors, assertions, test
membership, timeouts and live-write boundaries. No independent reviewer is required.
Shared contract/scope changes require a revised plan. Other groups' files remain outside ownership.

Current baseline and acceptance: [inventory](task-8-dashboard-inventory.md) and
[frozen matrix](task-8-acceptance-matrix.md). Historical subfeature credit does not close this finalization.
