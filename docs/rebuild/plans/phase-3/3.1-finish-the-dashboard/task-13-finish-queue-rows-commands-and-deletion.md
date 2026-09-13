# Task 3.1.13 · Finish queue rows, commands, and deletion
<!-- roadmap: dash-queue -->

**Current assignment: 3.1.13.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full gates at finalization, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Render display facts from current summary-backed queries, enriched by canonical run services; make all single/bulk commands real,
  revision-bound, idempotent, and convergent across current/archive/tombstone views.
- [ ] Keep Rerun as Task 3.1.11.2's plan-backed modal launcher; this task does not restore direct
  retry/restart queue mutations.

The accepted 2.6 U summary consumer replaces the old whole-run projection requirement. Derived
summaries carry display facts; canonical services authorize every command. Preserve parent/member
and batch grouping, selected-set ordering, freshness refusal and bounded reads. The accepted claim
order remains canonical even when the UI offers an explicit display sort.

The historical R01 `skipped`-enum defect is superseded: current run-span handling explicitly refuses
`skipped`, which is a task outcome. The declared remove/tombstone patch operations still have no
named producer in the inspected server source; prove their required delete/transfer convergence or
an explicitly verified equivalent current protocol. Do not drop the outcome just to delete an
unused enum arm. Terminal deletion retains insert-only disposition and explicit released-key copy.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
