# Task 3.1.9.3 · Finish basic storage health and recovery access
<!-- roadmap: dash-storage -->

**Current assignment: 3.1.9.3.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

Consume the [3.1.9 B ownership and working-interface record](task-9-establish-independent-dashboard-boundaries.md#b-implementation-and-child-release-contract--2026-09-13) at its accepted integration. This child owns only its listed surface/fixture/spec/reference paths and still needs its own approved execution brief. Shared registration and generated outputs remain reserved.

- [ ] Serve truthful storage health, doctor findings and actionable recovery instructions. Keep
  supported explicit backup/restore/upgrade commands reachable through clear instructions; preserve
  working existing controls without requiring new interactive recovery UI for the first release.
- [ ] Prove the surfaced corruption/interruption/stale/stopped-system cases against the underlying
  recovery commands. D336's SQLite settings and independent credentials replace the old settings-file authority.
  The live/archive database pair and retained capture/report files still require authenticated recovery.
- [ ] Record the D339 deferral of new interactive restore, migration and repair interfaces. Admit
  them only for a concrete workflow need or an explicit post-release request; core recovery and its
  tests remain mandatory. Do not present an unimplemented action as an available button.

Consume accepted schema 50, floor 46 and explicit stopped 46–49 conversion. Below-floor inputs
refuse before conversion with the compatible-release remedy. Preserve pending/published capture
custody, shared retained files, exact paired replay and the recovery marker on missing/corrupt
bytes. Retired settings imports and obsolete adapters do not return. No operator database upgrade
or new advanced recovery interface is implied by health/readiness presentation.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
