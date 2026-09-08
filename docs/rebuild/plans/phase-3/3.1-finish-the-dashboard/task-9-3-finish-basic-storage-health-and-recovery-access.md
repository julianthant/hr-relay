# Task 9-3 · Finish basic storage health and recovery access
<!-- roadmap: dash-storage -->

**Current assignment: 3.1.9.3.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Historical filenames and headings remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Serve truthful storage health, doctor findings and actionable recovery instructions. Keep
  supported explicit backup/restore/upgrade commands reachable through clear instructions; preserve
  working existing controls without requiring new interactive recovery UI for the first release.
- [ ] Prove the surfaced corruption/interruption/stale/stopped-system cases against the underlying
  recovery commands. D336's SQLite settings/independent credentials replace the old paired-file matrix.
- [ ] Record the D339 deferral of new interactive restore, migration and repair interfaces. Admit
  them only for a concrete workflow need or an explicit post-release request; core recovery and its
  tests remain mandatory. Do not present an unimplemented action as an available button.
