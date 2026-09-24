# Task 3.1.16 · Prove realtime convergence and reconnect
<!-- roadmap: dash-realtime -->

**UI refinement input (approved 2026-09-23).** Also require accepted
[3.1.23.3 Finalization](ui-refinement/README.md#proof-and-finalization), preserving all existing
inputs. Prove the combined refined surfaces; no UI worker candidate alone releases this task.

**Current assignment: 3.1.16.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Publish or remove every declared topic and prove ordered, duplicate, missed, restart, offline,
  selection-switch, settings/worker, archive/delete, and backfill-gap convergence.

Consume current summary publication and canonical mutation boundaries. Inventory topic declarations and actual producers independently; a fixture publication is not a production producer. Preserve bounded backpressure/reset, generation refresh, archived/deleted target navigation and notification backfill-gap behavior.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
