# Task 3.1.11.2 · Make Run and Rerun enqueue real work
<!-- roadmap: dash-run-modal -->

**Current assignment: 3.1.11.2.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**2026-09-14 Intake allocation:** consume 3.1.9.6's extracted spreadsheet upload component after
3.1.9.8 releases it. The [approved Intake amendment](task-9-establish-independent-dashboard-boundaries.md#intake-child-ownership-amendment--2026-09-14)
permits only that extraction/repair and replacement of its existing Run-modal call site, plus
Intake-specific comparison/confirmation handling. Ordinary Run/Rerun and prior-run values remain
this task's ownership. Do not duplicate or reverse the upload extraction; existing dependency edges
already order this task after the surface-group release.

**2026-09-16 focus allocation:** consume the [approved 3.1.9.8 F3 correction](task-9-8-finalization-dashboard-surfaces.md#approved-execution-brief--2026-09-16)
to shell/dialog focus and the narrow Run-modal hookup. Dismissal returns focus to the launch control;
successful Intake handoff retains takeover focus. Preserve that correction and the extracted uploader.
Ordinary Run/Rerun, warning, prior-value and enqueue semantics remain owned by this task.

- [ ] Make ordinary Run plus D334 Rerun use one modal and one server plan/confirm/enqueue path.
  Use one Rerun action for failed/interrupted and successful sources; do not offer a separate Retry
  action. Failed/interrupted sources default to failed/unfinished steps; successful sources default
  to ALL steps, including previously omitted steps. Begin at Steps; defaults never restrict selection.
- [ ] Offer descriptor-allowed completed-step values from 2.6 Task 1-2 as optional prefill. Let the
  operator copy, change or clear values and select or omit any eligible step; submitted modal values
  and omission facts are authoritative, and unselected steps do not replay.
- [ ] D335: proceeding from Steps with a selected previously submitted transaction shows a warning
  with Cancel / Confirm. Cancel returns to Steps; Confirm acknowledges the exact server warning set
  and advances to Values only. With no warning, proceed directly to Values. Neither navigation action
  consumes a plan, mints run/trace ids, creates/publishes a run or submits a transaction. Let the user
  edit Values normally; retain acknowledgment when the warning facts are unchanged, and renew it when
  warned selection/business keys/source/evidence change. Prior completion never disables a step or
  silently reuses its receipt. Consume 1.6.4's backend protocol; this task owns the full interaction.
- [ ] Create a new queued run only on the modal's final submission, show the committed run identity returned by the server,
  keep the source run byte-identical, and never represent an omitted transaction as a new write/proof.
- [ ] Prove ordinary/single/batch/dry-run plus Rerun defaults and full customization across
  stale/deleted/archived sources, malformed/partial prefill, changed item identity, unknown-write
  refusal, conflict, no-worker, delayed-worker, reload and exactly-once paths. Include one Rerun label
  for both outcomes, failed-source remaining versus successful-source all-step defaults, selecting a
  previously completed transaction, warning Cancel and Confirm navigation, zero effects before final
  submission, Values edits with unchanged versus changed warning facts, acknowledgment renewal,
  exact final-submission replay and no unintended second submission. The narrow pre-Confirm trace and
  retired-editor compatibility/reference changes were assigned to 1.6.4; do not restore them here.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref dashboard-surfaces` §D330.5's `create` — the row is
> inserted at `version 1`, state `queued`, and the write-once `run.queued` root is published through the
> shared builder AFTER commit — and §D330.6's first-eligible claim, which is ONE SQLite write
> transaction that proves the worker's runtime generation tuple or refuses `runtime-stale`. The served
> `version` is the one CAS token (§D330.4, the wire's `rowRevision`). A bulk start is D235's N children
> and one vector. No redesign.
>
> 2026-09-05 | D334 operator correction | this task also consumes `ref data-intake-and-edit-data` §6
> and 2.6 Task 1-2. The source supplies prefill/provenance only; Confirm submits new authoritative
> values and creates a new run. The former Context-rail `edit-checkpoint` writer and D314's direct
> Resume/Restart controls do not return. Task 10-4 retains intake only, so the two assignments have
> no shared implementation owner.

The current app still exposes Resume from checkpoints and Restart through generic command dispatch; the source-bound modal remains real implementation work. Preserve accepted backend prior-run read, settings selection and warning/replay protocol. New-run settings and stale-preview cases are part of final-submit proof. Archive reports provide no execution source.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
