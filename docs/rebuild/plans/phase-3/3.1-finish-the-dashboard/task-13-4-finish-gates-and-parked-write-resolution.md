# Task 13-4 · Finish gates and parked-write resolution
<!-- roadmap: dash-gates -->

**Current assignment: 3.1.14.5.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full gates at finalization, no independent review.
Historical filenames and headings remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Implement evidence-complete revision-bound gate/parked-write commands and prove stale, expired,
  changed-plan, skipped-condition, resume, rejection, archive, and authorization cases.

Gate decisions remain checkpoint-backed; run_operations/run_operation_attempts retain write evidence and parked resolution. The retirement of SQL gates/ocr_approvals does not remove required approval or durable review behavior. Do not restore the retired tables to satisfy old storage wording.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
