# Task 3.1.14.2 · Finish Context, Data, Attempts, and provenance readback
<!-- roadmap: dash-context-data -->

**Current assignment: 3.1.14.2.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [x] Render origins/redaction/checkpoints/attempts and D334 prior-run value coordinates; keep the
  source rail read-only and link eligible rows to Task 3.1.11.2's Rerun modal.
- [x] Prove value/provenance readback, validation, stale/conflict refusal, archive, malformed, empty,
  redacted and cross-attempt cases without a source-run edit command.

Consume current checkpoint_payloads/run_checkpoints and exact prior-run read contracts; SQL scaffolding retirement does not waive Data/Attempts/provenance. The foundation separates this read-only ledger from the already accepted Rerun-values producer before parallel children.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-22

The operator approved this child with the [parent's shared follow-up](task-14-establish-independent-run-detail-sections.md#approved-child-release-amendment--2026-09-22). Admit only after its bounded item-attempt read and existing Rerun action callback are committed, tested and integrated into local `master`. Cut `codex/3.1.14.2-context-data` in `hr-worktree-detail-data` from that exact commit. This leaf is independent of the other four candidates. The Sol root accepts and integrates; a Luna xhigh worker owns this candidate. Retain proof under `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.14-detail-children-2026-09-22/3.1.14.2/`.

Own `src/dashboard/surfaces/context-rail*.ts*`, `src/server/dashboard/queries/data.ts`, their focused tests and exclusive Context/Data parity scenes. The narrow shared exception also owns only the Context/Data editing and entry schema in `src/domain/dashboard/run-detail.ts`; change that schema together with the query and renderer so the active source rail is always read-only. Preserve the shared history wire and other section schemas. Show declared input, direction, exact origin, redaction, checkpoint payload/provenance coordinates and truthful item attempt history from the shared authority read. The source run is immutable in every lifecycle state: remove the server's stale editable claim and unused edit-facing props, display read-only values, and send an eligible version-bound Rerun action to the accepted source-bound modal. Show empty, redacted, malformed, unavailable, archived and deleted evidence distinctly. Select checkpoints by the exact source run and attempt, rejecting a sibling attempt's value or origin even when it is the latest for the item. Reject stale prefill and source mutation; no edit-checkpoint command or new persistence authority.

Prove prior-run readback, cross-attempt isolation, version/stale refusal, archived/deleted behavior and source immutability in focused query/model/BFF tests and `tests/parity/run-detail/context-data.spec.ts`. Run scoped ESLint over changed source/tests, `git diff --check` and affected generated checks. Review any parity reference update. Final A30/D03 and full repository gates stay with 3.1.19; 3.1.14.6 owns the focused combined release.
