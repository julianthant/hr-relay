# Task 12-3 · Finish Activity, search, and export
<!-- roadmap: dash-activity -->

**Current assignment: 3.1.12.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full gates at finalization, no independent review.
Historical filenames and headings remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Implement bounded cross-date filters and stable redacted exports; prove pagination,
  cancellation, stale responses, large history, errors, and exported-row reconciliation.

Accepted U supplies summary-backed Activity, current range/group metrics and the separate confirmed transaction-history query. Preserve unavailable distinct-person facts, privacy and archived confirmed totals until explicit deletion. Remaining search/export, pagination/cancellation, stale response and exported-row reconciliation proof stays open; no generic all-time archive Activity population is added.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
