# Task 3.1.9.4 · Finish Workflow Explorer and catalog editing
<!-- roadmap: dash-explorer -->

**Current assignment: 3.1.9.4.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Consume the accepted D337 SQLite authority from [3.1.9](task-9-establish-independent-dashboard-boundaries.md#approved-execution-brief--2026-09-13). Preserve label/icon/category editing, validation, conflicts, preview/diff, exact replay and hot readback through its isolated service ports.

**Operator allocation — 2026-09-13.** The complete persistence conversion, migration, command/audit
transaction, reader/writer cutover, old-protocol retirement and conversion/recovery proof belong to
3.1.9. This child owns the editor and its surface/service acceptance over that accepted authority;
it does not reopen shared SQLite, kernel or composition ownership. Historical Task 9-4 conversion
references describe the earlier allocation.

- [ ] Complete graph/catalog authority and validated overlay preview/diff/version/hot-apply/rollback;
  prove invalid, cyclic, stale, manifest-drift, reload, and clean-context authoring cases.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
