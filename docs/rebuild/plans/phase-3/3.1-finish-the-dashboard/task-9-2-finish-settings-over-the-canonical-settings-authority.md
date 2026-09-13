# Task 9-2 · Finish Settings over the canonical settings authority
<!-- roadmap: dash-settings -->

**Current assignment: 3.1.9.2.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Historical filenames and headings remain citation aliases, not another assignment.


**D341 (approved 2026-09-07).** Consume the detour’s application-only 86-row catalog. Test subjects,
canaries, fixture paths and shared test data are not Settings/Setup leaves or protected-setting
operations/readback. Do not add controls for them or reintroduce a source. The shared test-data
interface supplies this task’s fixtures; operational credentials retain D336’s independent authority.

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

> **D336 (2026-09-06):** ordinary settings are SQLite-owned; credentials are independently stored.
> Consume the existing catalog/revision/set-clear behavior and current settings activation through the service and protected
> write-only input through its independent operation. The file-target wording below is superseded.


- [ ] Render every catalog leaf and implement revisioned edit/conflict/draft-reset/persisted-clear flows; protected
  values remain write-only and prove persisted readback by presence/revision.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref clock-config-secrets` §D331.10, the Settings/Setup edit
> contract: the surface renders the served catalog projection and nothing else. Edits go through
> §D331.5's two closed arms — `apply-settings` and `apply-protected-settings` — each CASing its own
> document's `expectedRevision`, with that section's closed refusal set (including
> `revision-conflict { currentRevision }`, which keeps the draft) mapped to fixed sentences that name a
> key or a document, never a value. Protected readback is exactly §D331.6's
> `{ present, valueId?, updatedAt? }` tuple plus the store revision. The `derived-host` row shows the
> observed primary display beside the active `display` override. P40/A8's deliberate re-freeze of the
> eleven `settings.json: not set` parity references happens HERE. No redesign.

The accepted 2.6 Settings activation amendment supersedes a blanket restart requirement: new runs
select the new committed settings snapshot; existing runs keep theirs. A stale unaccepted plan must
be reviewed again; exact accepted replay retains its original identity. Preserve process lifecycle
controls and process-owned configuration where they still apply. The current editor serves eight
leaves, and Reset only discards that leaf's draft. Complete the full served catalog and explicit
persisted-clear operation, independent protected settings and observed-host versus saved-display
readback. Preserve the accepted `Saved` badge; P40/A8 expansion and deliberate reviewed refreeze
remain this task's work, using the current scene list rather than assuming eleven old copies survive.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
