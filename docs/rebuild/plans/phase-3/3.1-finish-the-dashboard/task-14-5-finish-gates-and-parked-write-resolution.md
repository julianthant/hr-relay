# Task 3.1.14.5 · Finish gates and parked-write resolution
<!-- roadmap: dash-gates -->

**Current assignment: 3.1.14.5.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [x] Implement evidence-complete revision-bound gate/parked-write commands and prove stale, expired,
  changed-plan, skipped-condition, resume, rejection, archive, and authorization cases.

Gate decisions remain checkpoint-backed; run_operations/run_operation_attempts retain write evidence and parked resolution. The retirement of SQL gates/ocr_approvals does not remove required approval or durable review behavior. Do not restore the retired tables to satisfy old storage wording.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-22

The operator approved this child after the [parent's shared follow-up](task-14-establish-independent-run-detail-sections.md#approved-child-release-amendment--2026-09-22) is committed and integrated into local `master`. Cut `codex/3.1.14.5-gates` in `hr-worktree-detail-gates` from that exact commit; no sibling candidate is a prerequisite. The Sol root accepts and integrates; a Luna xhigh worker owns the candidate. Retain proof under `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.14-detail-children-2026-09-22/3.1.14.5/`.

Own the accepted Gates/Park renderer/query and existing identity approval and parked-write resolution leaves plus exclusive parity scenes. The narrow shared exception owns only `executeResolveGate` in `src/core/command-kernel.ts` and focused command tests: reject an expired, changed-evidence or now-skipped gate before inserting a result, event or requeue, preserving existing version and exact-gate checks. A broader executor/descriptor change returns to the parent/finalizer owner before editing. Render checkpoint-backed gate evidence, freshness, actor, decision version, write plan and machine-verified absence. Approve/reject/reopen and parked-write resolution must use exact run/operation/revision/actor evidence and survive reload/resume. Preserve the accepted source-bound durable external/children-terminal settlement; never synthesize an operator decision. Refuse changed or expired gate, skipped condition, stale version, malformed/absent proof, unauthorized actor and archived mutation. An UNKNOWN write remains parked until evidence-backed resolution; never retry it or infer absence from timeout. Do not restore SQL gates or OCR approval tables.

Prove current/stale/expired/changed-plan/skipped/resumed/rejected/archived/unauthorized paths and write-resolution evidence in focused query/command tests and `tests/parity/run-detail/gates-park.spec.ts`. Run scoped ESLint over changed source/tests, `git diff --check` and affected generated/build checks. Review any parity reference update. Live dry-run correlation and final A35/A36/D04 remain 3.1.18–3.1.19; 3.1.14.6 owns the focused combined release.
