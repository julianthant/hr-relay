# Phase 1.6 · Implement canonical run and settings authorities

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## 1.6 · Implement canonical run and settings authorities

**Task 7 source amendment (D343, approved 2026-09-07).** Preserve `.env` as operator reference;
normal startup uses only `.env.providers` for the existing five provider families. The operator also
approved only the resulting generated-fingerprint parity refresh, including displayed hash pixels,
with all other semantics/layout and zero tolerance preserved. Task 7's owner records the classified
refresh and candidate gates; live proof, review and integration remain open.

**Task 7 current evidence (2026-09-07).** Steps 1–3 are accepted through callback repair
`09436a49`: 5522 coverage tests and 259 desktop parity cases passed. Person Lookup's headed
live-read met all seven assertions with exact 0/0/0 write deltas. Separations attempt 4 remains
failed; its callback repair subsequently passed the production read-only scanner, but complete T1b
proof is blocked by protected reread identity/admission. The Task-7 owner retains the exact results,
gates and residuals. Settings restoration is deferred until the operator explicitly signals readiness;
it is independent of the identity blocker. No final review, integration or completion is claimed.

**D341 detour (approved 2026-09-07; accepted, integrated into local `master` as `bc6dc9b54` and the
private conversion performed the same day — see `ref guards-and-tests` §10.5 completion record).** It
completed shared test configuration/fixture consolidation and verified migration of canaries out of
application settings. See `ref clock-config-secrets` §D341 and `ref guards-and-tests` §10.5. The operator reset the
actual rebuild database; Task 7 uses that fresh root and synthetic migration/recovery fixtures,
not the deleted runs or backup. Task 6’s completed conversion remains historical evidence. No new
phase number or change to the remaining phase order is introduced.
<!-- roadmap: p1-authority-implementation -->

**D336 operator amendment (2026-09-06).** The approved target is SQLite for runs and ordinary
settings, plus independent credential operations (ref clock-config-secrets §D336). This supersedes
only the conflicting storage bindings below. Completed Tasks 1–4 and the existing Task-5 assignment
retain their evidence and scope. Task 6 owns the conversion, consumer cutover and replacement proofs;
Task 7 and 2.6 consume that target. No runtime implementation, data migration or feature deferral is
claimed by this decision record.


**Session workflow (operator amendment, 2026-09-04):** use roadmap §Governance's
[Plan, implement, review](../../../../roadmap/roadmap.md#plan-implement-review-operator-amendment-2026-09-04) rule.
The approved phase section is the executor's brief. A candidate stays awaiting independent review;
only the original supervisor finalizes after accepted review, required integration gates and cleanup.
Existing task seams, dependency order, contracts and proof obligations remain unchanged.

This reopened implementation part waits for 0.3's approved contracts. It does not redesign the
authority model and does not own Phase-2 downstream read models or Phase-3 dashboard presentation.
Its scope is the stores, migrations, lifecycle/configuration writers, core runtime consumers, and
their deletion tests.

**The binding (0.3 Task 4, R04, 2026-09-04).** 1.6 implements **D330** (ref dashboard-surfaces
§D330.1–§D330.12), **D331** (ref clock-config-secrets §D331.1–§D331.12) and **D332** (ref
dashboard-surfaces §2.5 D332.1–D332.12, its settings half ref clock-config-secrets §D332.S1–S6, the
adapter roster ref guards-and-tests §5.2) verbatim; a task that needs a contract change returns it to
a newly numbered 0.3 task and does not improvise. Every task below is one supervisor session (D326)
bound to ONE seam (the files it may touch), ONE gate, its place in the integration order, the proofs
it owes from the three ladders (§D330.11's 27, §D331.11's 41, §D332.11's 27 — 95 rows, each assigned
exactly once below, plus the guard entries and the one unit test ref guards-and-tests §5.2 names),
and ONE deletion test — the red-capable proof that the displaced authority is gone, never a switch.
The **base gate** every task runs before its own row is
`npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check`
(a descriptor's import closure includes `src/domain/**`, so a stale manifest is a red gate, not drift);
`npm run test:parity` must stay green UNCHANGED through the whole part — adapter A8 (the served
eight-leaf editor inventory and the `settings.json: not set` line) is re-frozen deliberately at 3.1,
never here. **Operator exception (2026-09-04, choice 3 A):** before wave 2, a serial supervisor
repair may refresh stale derived-hash parity metadata inherited from D324. The operator's subsequent
explicit approval includes verified displayed descriptor/implementation hashes and their screenshot
and accessibility references. All other semantic content and layout must remain unchanged; retain
production code, assertions, and the existing pixel tolerance. Prove the exact hash-only differences
and pass parity in assertion mode after the repair. This admits no A8 or Settings UI change and no
general reference refreeze.
Both wave peers branch from the same integrated repaired baseline. Every leaf a task adds to a served contract is dispositioned under D183 in the same commit
(§D331.11 P41, §D332.11 M26). **Integration order:** Task 1 → wave 2 (`2-1` ∥ `2-2`) → 3 → 4 → 5 →
6 → 7, each merged `--no-ff` onto master with the base gate green before the next branches.

**Operator-ratified Task-4 amendment (D334, 2026-09-05).** Feasibility inspection found D109's
pre-minted plan identities and D166's direct `edit-checkpoint` writer contradicted D330.1/D330.10.
The operator resolved both and approved updating every affected phase plan: identities are minted
only when Confirm creates the run; Rerun is a source-bound preset of the ordinary new-run
modal; completed-step values are editable prefill only; submitted values/omissions are authoritative;
the source is immutable. This is the approved contract correction the rule above requires, not a
Task-4 improvisation. D334's owner and decision-index pointer land with this plan commit.

**The wave ruling.** The roadmap admitted Tasks "1 and 2" as a wave only after 0.3 proved their
schemas and migration boundaries independent. R04's cross-contract review proved they are NOT
independent as written — both add SQLite schema steps, both would bump `CURRENT` (two floors, two
frozen D290 lists, §D332.3 step 3(b)), both edit `migrations.ts`, `AUTHORITY_TABLE_REGISTRY` and
`authority-database.ts`, and §D332.5 makes the run half and the settings half one transaction by
design. They become independent the moment the schema floor is one serial commit: after it, the
run-record service touches the lifecycle adapter/service files and the settings work touches
`src/domain/config/**`, `src/infra/config/**`, `secrets.ts`, the settings runtime and the bootstrap,
with no shared file. So the part is re-sliced (D328): **Task 1 is the serial floor; Tasks 2-1 and 2-2
are the wave**, each in its own worktree and `codex/<unit>` branch from the master that contains
Task 1's merge and both approved focused plans. Each focused plan records its exact branch, worktree,
ownership and merge condition; the common base is resolved and verified before either supervisor
creates a worktree. Tasks 3–7 keep their numbers and run serially. No other pair is admitted as a wave:
Tasks 3 and 5 both edit the composition roots.

- [Task 1 · Land the schema floor](task-1-land-the-schema-floor.md)

- [Task 2-1 · Implement the canonical run-record service](task-2-1-implement-the-canonical-run-record-service.md)

- [Task 2-2 · Implement the settings catalog and protected root](task-2-2-implement-the-settings-catalog-and-protected-root.md)

- [Task 3 · Cut over executor and worker lifecycle writers](task-3-cut-over-executor-and-worker-lifecycle-writers.md)

- [Task 4 · Cut over operator run commands, Rerun planning, and archive/delete writers](task-4-cut-over-operator-run-commands-rerun-planning-and-archive-delete-writers.md)

- [Task 5 · Cut over settings mutation and runtime resolution](task-5-cut-over-settings-mutation-and-runtime-resolution.md)

- [Task 6 · Consolidate settings in SQLite and prove upgrade/recovery](task-6-consolidate-settings-in-sqlite-and-prove-upgrade-recovery.md)

- [Task 7 · Close the rebuilt foundation](task-7-close-the-rebuilt-foundation.md)
