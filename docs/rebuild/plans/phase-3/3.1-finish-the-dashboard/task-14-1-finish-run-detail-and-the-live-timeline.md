# Task 3.1.14.1 · Finish run detail and the live timeline
<!-- roadmap: dash-run-detail -->

**Current assignment: 3.1.14.1.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Render groups/attempts/status arms/duration/systems/provenance and preserve exact live UI state
  across patches, retry, archive, reconnect, and out-of-order delivery.
D344 moves the shared section projector/component/test extraction to
[the detail foundation](task-14-establish-independent-run-detail-sections.md), which must be accepted first.
This task retains all timeline/rendering/realtime acceptance above and owns none of the four
section tasks. Those tasks depend on the accepted foundation and Queue, not this timeline task.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref dashboard-surfaces` §D330.3's seven closed lifecycle states
> (`queued` · `claimed` · `validating` · `running` · `parked-gate` · `parked-write` · `terminal`) — a
> park IS a state, never a sentinel — and §D330.4, where the served `version` is the row revision the
> wire calls `rowRevision`. D268's ONE run-status derivation is retained with the span fold
> contributing no lifecycle arm (§D330.12 item 1). Attempts render as separately selectable evidence
> rows under one item and are never compared for the operator (the D289 amendment, root `CLAUDE.md`).
> No redesign.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-22

The operator approved this child with the [parent's shared follow-up](task-14-establish-independent-run-detail-sections.md#approved-child-release-amendment--2026-09-22). Admit only after that committed follow-up is integrated into local `master`, its bounded item-attempt read and Rerun action hook are tested, and its exports/fixtures are frozen. Cut `codex/3.1.14.1-timeline` in `hr-worktree-detail-timeline` from that exact commit. This leaf has no dependency on the other four leaf candidates. The Sol root owns acceptance and integration; a Luna xhigh worker owns this candidate. Record exact paths, SHA, commands and results under `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.14-detail-children-2026-09-22/3.1.14.1/`.

Own the accepted timeline component/model, server timeline query and exclusive timeline parity scenes. The approved exception also gives this leaf the smallest `src/dashboard/surfaces/queue.tsx` and `queue-model.ts` change and focused Queue tests needed for selected-day grouping. Render one logical row per item in the selected day, with each authority run/attempt separately selectable. Preserve exact run/attempt navigation, queued/claimed/validating/running/parked/terminal arms, replay/skipped/blocked task segments, duration, systems and provenance. Keep focus, expansion, scroll and selected identity stable through live patches, archive, retry, reconnect and out-of-order delivery. Queue state derives from served authority; do not compare attempts, synthesize status, change another leaf's section, or alter shared projectors without returning to the parent owner.

Prove same-item grouping across multiple attempts, selected-day isolation, direct attempt opening, stale/out-of-order patch refusal, live follow and archive/reconnect using focused model/server tests and filtered `tests/parity/run-detail/timeline.spec.ts` plus focused Queue parity. Run scoped ESLint over changed source/tests, `git diff --check`, and affected generated checks. Record any browser filter and reference comparison; refreeze only with reviewed attribution. Full repository gates and final A29/D02/D03 acceptance remain 3.1.19; 3.1.14.6 owns the focused combined release.
