# Task 9-4 · Finish Workflow Explorer and catalog editing
<!-- roadmap: dash-explorer -->

**Current assignment: 3.1.9.4.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Historical filenames and headings remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] D337: store label/icon/category overrides and their command/audit in one SQLite transaction;
  migrate existing overrides and remove the file/SQLite prepared-claim protocol. Preserve editing,
  validation, conflicts, preview/diff and readback. Bind schema/shared-file ownership before the wave.


- [ ] Complete graph/catalog authority and validated overlay preview/diff/version/hot-apply/rollback;
  prove invalid, cyclic, stale, manifest-drift, reload, and clean-context authoring cases.
