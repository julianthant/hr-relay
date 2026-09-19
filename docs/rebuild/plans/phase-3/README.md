# Phase 3 · Reusable dashboard and workflow platform

## Phase summary
<!-- roadmap: phase-3 -->

Complete 3.1 shared dashboard, 3.2 workflow authoring and candidate freeze, 3.3 controlled
acceptance, optional 3.4 document tools and AI assistance, then 3.5 Codex and Claude cooperation.
D342 makes every 3.4 feature opt-in; skipping any or all of them never blocks 3.5, Phase 4 or cutover. The strict entry prerequisite is Phase 2.6.
Each subphase owns its existing tasks, evidence and exit criteria. Phase 3.3 consumes the frozen
3.2 candidate unchanged; defects return to 3.2. See the [roadmap](../../../roadmap/roadmap.md).

## Subphase plans

- [Phase 3.1 · Finish the dashboard](3.1-finish-the-dashboard/README.md)
- [Phase 3.2 · Finish workflow authoring and freeze the acceptance candidate](3.2-finish-workflow-authoring/README.md)
- [Phase 3.3 · Accept Person Lookup and Separations](3.3-accept-person-lookup-and-separations/README.md)
- [Phase 3.4 · Optional document tools and AI assistance](3.4-optional-document-tools/README.md)
- [Phase 3.5 · Codex and Claude cooperation](3.5-co-operate-with-claude/README.md)

D344 uses actual prerequisite tasks with independent decimal children: `3.P.N` completes before
`3.P.N.1`, `3.P.N.2`, etc. launch in separate worktrees. See the [3.1 task map](3.1-finish-the-dashboard/README.md#current-task-identities)
and 3.2 plan. Each group then goes to its named sequential finalizer: workers run focused tests,
scoped lint and quick checks; the finalizer combines candidates, fixes integration failures and
runs the owning subphase’s required checks before downstream release. See
[D344's cadence](../../../roadmap/roadmap.md#parallel-finalizer-cadence) and
[D191](../../reference/guards-and-tests.md#d191--the-recommendation-is-adopted-testcoverage-becomes-the-per-commit-gate-operator-decision-2026-08-12).
Sequential tasks keep separate numbers; the operator chooses launches and integration.
Phase 3.2 audit-only acceptance and the immutable 3.3 boundary retain their existing rules.
Phase 3.1 final acceptance now includes repairs in the same session.

For remaining 3.1 work, the [2026-09-13 execution cadence](3.1-finish-the-dashboard/README.md#execution-cadence--operator-amendment-2026-09-13)
also gives prerequisites and standalone tasks focused checks and removes independent review at
every stage, including finalization. Group finalizers add typecheck and focused integration tests;
full repository gates and gate-found repairs belong only to 3.1.19. Other subphases retain their
review requirements. All Codex subagents use Astra/ultra under the current native role policy.

Phase 3.1 now places Finalization at 3.1.9.8, 3.1.11.3 and 3.1.14.6, immediately after each
group’s workers. Its numbered plans form a valid sequential path through final acceptance 3.1.19;
optional 3.1.20–3.1.22 remain outside that required sequence.

## Delivery cadence from Phase 3.2

The [2026-09-19 roadmap amendment](../../../roadmap/roadmap.md#tangible-tasks-and-phase-exit-gates)
requires concrete feature/outcome tasks and tangible subtasks, sequential unless labelled Parallel.
Each delivery part runs focused checks throughout and full gates at its end under
[the gate owner](../../reference/guards-and-tests.md#phase-exit-gates-from-3-2).
Phase 3.1 retains its existing cadence. Proof, admission, freeze and cutover boundaries remain.
