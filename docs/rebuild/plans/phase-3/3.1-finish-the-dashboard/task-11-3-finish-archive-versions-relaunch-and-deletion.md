# Task 11-3 · Finish Archive saved reports, version changes, and deletion
<!-- roadmap: dash-archive -->

**Current assignment: 3.1.9.7.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full gates at finalization, no independent review.
Historical filenames and headings remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Finish saved-report browsing, frozen values, version-change review/apply, report export,
  terminal-only live deletion and exact saved-report deletion, with idempotence, honest storage
  deltas, shared-file custody and convergence.
- [ ] Consume the separate `archive.sqlite` / `archive_records` authority without current workflow
  descriptors or live failure/settings parsers. Version changes use `version_changes`; deletion
  retains canonical disposition, progress and permanent-key warning semantics.
- [ ] Credit accepted indexed filters, safe attachment downloads and reference-aware deletion only
  within the 2.6 A/H proof. Complete the remaining UI/production-browser cases and whole-report
  export; test missing/corrupt bytes, stale selection/filter response, partial transfer/deletion,
  exact replay, changed review membership and truthful generic-outcome labels.
- [ ] Verify Archive has no Relaunch/Rerun/Retry/Restart execution door. The C0 archive amendment
  and 2.6.9 relaunch-history retirement supersede the former `archived_runs`, archive relaunch and
  `archive_relaunches` requirements; do not restore those tables or commands.

The historical filename remains a citation alias. Original 2026-09-04 requirements named D330.7/.8
and D332.7; the later C0/final 2.6.9 amendments above are the current requirements. Frozen report
identity and source digest survive supported recovery; they are not reconstructed from current code.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
