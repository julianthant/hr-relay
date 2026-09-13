# Task 3.1.14.3 · Finish logs, observations, and captures
<!-- roadmap: dash-logs -->

**Current assignment: 3.1.14.3.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full gates at finalization, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Compose missing truthful producers; render bounded searchable logs/captures/bundles and prove
  pagination snapshots, stale isolation, read-forward, redaction, absence, and large streams.

Current observation/fence producers, timeline events and note writer already exist. Trace actual ordinary workflow note call sites before labeling a producer missing. Current diagnostic capture metadata/bytes and immutable cursor tests are accepted inputs. Do not rebuild SQL spans/notes or artifact/terminal outboxes; preserve log, diagnostic, redaction and append-day retention behavior.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
