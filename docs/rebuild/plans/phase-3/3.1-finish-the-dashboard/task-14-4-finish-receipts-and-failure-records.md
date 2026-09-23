# Task 3.1.14.4 · Finish receipts and failure records
<!-- roadmap: dash-receipts-failures -->

**Current assignment: 3.1.14.4.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Render derived write/evidence/failure/recovery facts and prove success, no-op, refusal, failure,
  unknown submit, retry, archive, explanation, and tamper behavior.
- [ ] Route an eligible Rerun action to Task 3.1.11.2's source-bound Run modal; an unknown write exposes
  only its evidence-resolution actions.

Current immutable failures/receipts/completion coexist with versioned live resolution annotations and diagnostic_snapshots/diagnostic_files. Archived resolution is frozen and read-only. Knowledge/fix tables and old terminal outboxes do not return; preserve captured evidence, tamper refusal and UNKNOWN resolution boundaries.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-22

The operator approved this child after the [parent's shared follow-up](task-14-establish-independent-run-detail-sections.md#approved-child-release-amendment--2026-09-22) is committed and integrated into local `master`. Cut `codex/3.1.14.4-receipts` in `hr-worktree-detail-receipts` from that exact commit; no sibling candidate is a prerequisite. The Sol root accepts and integrates; a Luna xhigh worker owns the candidate. Retain proof under `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.14-detail-children-2026-09-22/3.1.14.4/`.

Own the accepted Receipts/Failures renderer/query and existing receipt, trust, advisory, failure-resolution and diagnostic leaves plus exclusive parity scenes. Derive success, verified no-op, refusal, failure and UNKNOWN from immutable operation/receipt/failure authority. Show action identity, write-state evidence, causal fingerprint, capture/bundle provenance, recovery and live annotation separately; archived resolution remains frozen. Open exact evidence and explanation. Route only an eligible served Rerun action through the shared callback to the accepted source-bound modal; UNKNOWN exposes evidence-resolution actions only. Advice is read-only and cannot authorize a write. Do not restore retired knowledge/fix tables, infer resolution from panel dismissal, or retry UNKNOWN.

Prove success/no-op/refusal/failure/UNKNOWN/recovery/retry/archive/tamper cases, version-bound annotation and wrong-run bundle refusal in focused query/BFF tests and `tests/parity/run-detail/receipts-failures.spec.ts`. Run scoped ESLint over changed source/tests, `git diff --check` and affected generated/build checks. Review any parity reference update. Live dry-run correlation and final A33/A34/D03 remain 3.1.18–3.1.19; 3.1.14.6 owns the focused combined release.
