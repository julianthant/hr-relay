# Task 3.1.9.6 · Finish Intake surfaces
<!-- roadmap: dash-intake-edit -->

**Current assignment: 3.1.9.6.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Complete upload-to-handoff, mapping, validation, reject review, manifest and rerun-diff flows
  with progress/provenance/refusals; prove real, malformed, partial, canceled, stale, redacted,
  duplicate and archived cases.
- [ ] Do not edit the Run modal, Rerun launchers or prior-run value projection. D334 assigns
  those to Task 3.1.11.2 over the 2.6 Task 1-2 read contract, leaving this wave member independent.

Accepted artifact consolidation stores intake/session/manifest facts in imported_artifacts while retaining independent import identities and immutable handoff semantics. Do not recreate intake_manifests, intake_sessions, artifact_outbox or artifact_sink_heads. Closed rejects, exact counts and changed-file/mapping/schema confirmation remain required.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
