# Task 9-4 · Finish Workflow Explorer and catalog editing
<!-- roadmap: dash-explorer -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] D337: store label/icon/category overrides and their command/audit in one SQLite transaction;
  migrate existing overrides and remove the file/SQLite prepared-claim protocol. Preserve editing,
  validation, conflicts, preview/diff and readback. Bind schema/shared-file ownership before the wave.


- [ ] Complete graph/catalog authority and validated overlay preview/diff/version/hot-apply/rollback;
  prove invalid, cyclic, stale, manifest-drift, reload, and clean-context authoring cases.
