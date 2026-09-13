# Task 16 · Meet large-data and responsiveness budgets
<!-- roadmap: dash-performance -->

**Current assignment: 3.1.17.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full gates at finalization, no independent review.
Historical filenames and headings remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Bound database/filesystem/projection/serialization/render/memory work and add shared
  pagination/virtualization only where the preserved structural fixture crosses its trigger.

Consume the accepted F07 benchmark and summary-query instruments, preserving the 1,240 selected / 360 outside / 108 member / 20,800 note fixture and §7.4 bounds. Timings are observations, not replacement thresholds. Keep selected-set query costs, zero heartbeat summary writes, one affected update and explicit unavailable rows-visited accounting.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
