# Task 3.1.14.3 · Finish logs, observations, and captures
<!-- roadmap: dash-logs -->

**Current assignment: 3.1.14.3.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Compose missing truthful producers; render bounded searchable logs/captures/bundles and prove
  pagination snapshots, stale isolation, read-forward, redaction, absence, and large streams.

Current observation/fence producers, timeline events and note writer already exist. Trace actual ordinary workflow note call sites before labeling a producer missing. Current diagnostic capture metadata/bytes and immutable cursor tests are accepted inputs. Do not rebuild SQL spans/notes or artifact/terminal outboxes; preserve log, diagnostic, redaction and append-day retention behavior.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-22

The operator approved this child after the [parent's shared follow-up](task-14-establish-independent-run-detail-sections.md#approved-child-release-amendment--2026-09-22) is committed and integrated into local `master`. Cut `codex/3.1.14.3-logs` in `hr-worktree-detail-logs` from that exact commit; no sibling candidate is a prerequisite. The Sol root accepts and integrates; a Luna xhigh worker owns the candidate. Retain proof under `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.14-detail-children-2026-09-22/3.1.14.3/`.

Own the accepted Logs/Captures components, their server queries, focused tests and exclusive parity scenes. Trace the ordinary worker logger and note writer first, then connect only genuinely missing production note or line-kind producers with exact run/attempt/task identity, redaction and append-day retention. Do not infer page observations from write fences or add a fallible note write inside a durable commit boundary. Render bounded searchable cursor pages, late-response isolation, read-forward, truthful absence, exact diagnostic capture metadata/bytes and bound bundle links. Preserve immutable cursor snapshots, safe file headers, archive access and large-stream limits; do not restore SQL notes/spans or terminal outboxes.

Prove actual producer-to-query flow, malformed and redacted notes, pagination/refresh/stale responses, archive, missing artifact and large stream behavior in focused worker/query tests and `tests/parity/run-detail/logs-captures.spec.ts`. Run scoped ESLint over changed source/tests, `git diff --check` and affected generated/build checks. Review any parity reference update. Current live dry-run correlation and final A31/A32/D03 remain 3.1.18–3.1.19; 3.1.14.6 owns the focused combined release.
