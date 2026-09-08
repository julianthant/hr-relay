# Phase 2.6 · Revalidate tails against canonical authorities

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## 2.6 · Revalidate tails against canonical authorities

**D341 input foundation (approved 2026-09-07).** Consume the completed pre-1.6.7 detour’s shared
fixture/configuration interface and explicit private-test source bindings. Tests do not provision
canaries through Settings. Trust/data/operator consumers must preserve redaction and captured-input
identity without reading current private configuration to reconstruct an existing run. The actual
operator database was reset; recovery proofs use reproducible synthetic fresh/v29 fixture recipes
handed off by Task 7, never the removed operator database or backup. The detour completes fixture
consolidation; this part consumes it and retains its existing adapter-retirement ownership.
<!-- roadmap: p2-authority-revalidation -->

This reopened part starts only after 1.6 closes. It changes downstream read models, joins, and
operator services that consume run/settings authority; it does not change the canonical stores,
rewrite append-only evidence, repeat D135's controlled write, or improvise a new contract.

**Task 1.6.7 deterministic handoff (2026-09-07; live/closure acceptance still pending).**
At base `da85e5d1d`, the nine-file upgrade/restore/doctor/settings set passed 139 tests and the five
focused authority/secrecy guards passed 60 tests, including their injected violations. Exact commands
and the reproducible two-worker adapter are in the [Task-7 owner](../../phase-1/1.6-implement-canonical-run-and-settings-authorities/task-7-close-the-rebuilt-foundation.md#gate-schedule-and-review-coverage).

| Boundary | Verified handoff and downstream owner |
| --- | --- |
| Fresh fixture | `tests/unit/storage-upgrade.test.ts`, “plans a fresh root without files, creates v33 directly, and reruns without writes”: `fixture()` constructs an isolated empty root; plan creates nothing, conversion produces schema 33/settings revision 1 without credentials, repeat is byte-identical. |
| Migrated fixture | Same file, “preserves an applied empty v29 revision and authenticates its immutable historical journal after conversion”: `fixture(29)` applies migrations through v29 with synthetic generation 7; the case seeds revision-2 empty settings plus its immutable command/audit, creates a verified stopped backup, converts to v33, retains revision 2 and source bytes. These are regenerable constructors, not operator database copies or retained temporary paths. |
| A0/A1 | Task 2 deletes `src/infra/compat/{upgrade-sources,pre-floor-settings,settings-database-upgrade,settings-source-recovery}.ts`; only the stopped `src/server/storage/upgrade.ts` boundary may reach them. Activate `authority-upgrade-adapters-retired` and retire `authority-upgrade-adapters-isolated` in that deletion commit. Keep `sqlite-settings-authority` and strict historical readers. |
| A2/A3 | Task 1-3 removes the `row.ended` and `row.claimedBy` lifecycle arms in `src/server/dashboard/run-status.ts` and lands `run-status-fold-contributes-no-lifecycle-arm` in the same commit. It removes `runs_view` with projector rewire; the existing lifecycle-SQL guard's reader violation remains red-capable. No deletion occurs in Task 7. |
| Gate records | `checkpoint_payloads` is written only through `gateResults.insert`, keyed by run/gate and parsed as `GateResultRecordSchema` in `src/infra/sqlite/authority-database.ts`. D330.11 #22 is exercised in `tests/unit/run-record-service/service.test.ts`; M23 is the tombstoned-gate removal/retention/trigger case in `tests/unit/storage-upgrade.test.ts`. No non-gate writer is admitted. |
| D183 | Preserve `D331_SERVED_LEAF_DISPOSITIONS` and the schema-driven audit in `tests/unit/architecture/redaction-surface-scan.test.ts`: closed literals/identifier-free presence, revision, opaque value identities, runtime status and refusal facts; no protected values. Missing/wrong/unreviewed dispositions are injected negative controls. D341 test inputs remain private config, outside Settings and evidence values. |
| Environment | `migrated-refused` means startup refusal by name, not an inert or fallback environment value. Under approved D343, Task 7 preserves `.env` as operator reference and admits only `.env.providers` at normal startup. Retired names remain refused in the runtime source and inherited process environment; repeat current admission before live work. |
| A8/P40 | Task 6 already changed the immediate Settings source presentation to `Saved` and accepted its parity references. Phase 3.1 Task 9-2 owns the remaining catalog-driven editor/Settings expansion and any deliberate parity refreeze. Neither this phase nor Task 7 restores the obsolete `settings.json: not set` copy. |

At reset, the primary operator root had schema 32/generation 0 and one fresh baseline marker; the
historical generation-94 database and generation-91 backup are not fixture inputs or restore targets.
This handoff does not mark Phase 1.6 or Phase 2.6 complete.

**Current closure residuals (2026-09-08).** Task 7 consumes accepted schema-33 master and the
combined fresh/v29 fixture proofs. Executable candidate `4a242128` passed 5546 coverage tests and
261 parity cases. Both T1b workflows are accepted with exact 0/0/0 write-authority deltas; complete
Separations proof has fifteen fresh current-run checkpoints and all eight assertions met. Latest
doctor at 2026-09-08T07:29:41.609Z is healthy schema 33/generation 836 with twelve reconciled runs.
Preserve the two local terminal-result projection handoffs for the successful runs, along with all
failed evidence; they are distinct from the empty HR write outbox. Preserve `workflow_runs` and
`workflow_run_batches`; the schema-32 reset remains historical, not a restoration target. The
protected reread and pending-set recording defects are repaired and live-verified. No unresolved
implementation defect is transferred by this record. Task 7 still owns fresh complete review,
integration gates, operator-deferred settings restoration and cleanup. Phase 2.6 remains unstarted.

**Execution order and wave ruling (2026-09-04).** The part runs as wave 1
(`1-1` ∥ `1-2` ∥ `1-3`) → Task 2 → Task 3. The three wave members consume the same frozen
1.6 authorities but own disjoint downstream seams: trust/evidence projections, intake/data
projections, and generic lifecycle/operator read models. Diagnostic capture belongs to 1-1;
intake/OCR/manifest/prior-run value projection belongs to 1-2; archive/current/queue lifecycle status and counts
belong to 1-3. A wave member may test another seam's stable `runId` contract, but may not edit that
seam. Shared composition roots, served aggregate contracts, guard inventory, generated artifacts,
and phase-close docs receive one owner in the coordinator run plan before dispatch; if a newly found
dependency requires two members to edit one file or contract, it becomes a serial prerequisite or a
new remediation task rather than an overlapping change.

Each member branches from the same master commit containing 1.6's verified close and runs in a
dedicated worktree. Before dispatch, the 2.6 coordinator records the exact base SHA, task/agent,
branch, absolute worktree, file and artifact scope, red-capable gate, and peer integration order.
Task 2 starts only after all three wave branches are verified, integrated `--no-ff`, and fully
closed. This is scheduling under D328, not authority redesign.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 (`ref dashboard-surfaces` §9.2), D331
> plus D332's settings half (`ref clock-config-secrets` §3), D332 (`ref dashboard-surfaces` §2.5) and
> the adapter roster (`ref guards-and-tests` §5.2) exactly as 0.3 landed them. This part READS those
> contracts; it amends none of them. A proposed contract change returns to a newly numbered 0.3 task
> and is never improvised here.

### Task 1-1 · Revalidate trust and evidence consumers
<!-- roadmap: p2f-trust -->

- [ ] Rewire notification, receipt, failure, capture, log, gate, and parked-write run joins.
- [ ] Prove durable linkage through retry, archive, and tombstone without rewriting evidence.
- [ ] Stay behind the stable run/evidence boundary; do not edit intake data projections or generic
  lifecycle status/count/archive projections owned by Tasks 1-2 and 1-3.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D330.9's evidence-linkage invariants:
> spans/logs, receipts, failures, captures and gate records are evidence ABOUT a run and link to it by
> the stable `runId` alone, so no reader joins evidence to evidence to reach a lifecycle fact and the
> span fold contributes no lifecycle arm (§D330.12 item 1). Existence stays §D330.2's three-way answer
> (`absent` · `present` live/archived · `deleted`), and §D330.8's tombstone governs deletion — a
> deleted run's gate records leave WITH the run. The notification inbox row stays run-linked. No
> redesign.

### Task 1-2 · Revalidate data, intake, and prior-run value consumers
<!-- roadmap: p2f-data -->

- [ ] Rewire only actual run/settings dependencies across intake, OCR, manifests, mappings, and the
  D334 Rerun prefill source.
- [ ] Serve every descriptor-allowed completed-step value with exact source run/version, step/node,
  field path and provenance; preserve artifact readability and fail loud on missing canonical linkage.
  Also serve read-only completed/failed/unfinished step classification and completed-transaction evidence
  coordinates for D335 defaults/warnings. Never infer completion from an omitted-step assertion or grant
  repeat consent in this projection; 1.6.4 owns the already-built backend authorization boundary.
- [ ] Keep the projection read-only: it offers prefill candidates and never writes a lifecycle row,
  checkpoint, start plan or modal value. Redact/withhold any value the ordinary operator-suppliable
  schema does not admit.
- [ ] Treat diagnostic capture projection as Task 1-1's seam and generic lifecycle/operator reads as
  Task 1-3's seam; consume their stable contracts without editing them.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D330.9 — intake, OCR, manifest, mapping
> and Edit Data rows are evidence linked by `runId` and decide no lifecycle fact — together with
> `ref clock-config-secrets` §D331.8 (a leaf has exactly one source, so no intake or Edit Data path
> writes settings or a lifecycle row) and §D332.7 item 4 (the upgrade leaves evidence and its
> immutability rules untouched, so existing artifacts stay readable across it). No redesign.
>
> 2026-09-05 | D334 operator correction | the old `run.edit-checkpoint` consumer is retired by 1.6.4.
> This task owns only the replacement READ: completed-step values and their exact provenance for the
> source-bound Rerun modal. Prove partial/missing/malformed/deleted/archived sources, copied
> versus operator-entered provenance, transaction outputs represented as assertions rather than new
> write proof, and a byte-identical source run. Task 3.1.11-2 owns all modal state and submission.

### Task 1-3 · Revalidate operator read models
<!-- roadmap: p2f-operator -->

- [ ] Rewire archive, Activity, Explorer, doctor, preflight, and settings-status reads.
- [ ] Prove current/queue/archive/delete counts converge and protected settings never read back.
- [ ] Own shared lifecycle status/count envelopes and the A2/A3 deletions; do not edit the trust
  evidence or intake data projections owned by Tasks 1-1 and 1-2.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D330.5: `read` and `list` are the ONLY
> lifecycle reads — never a span fold, never `runs_view`. This task lands adapter A2's deletion, so the
> `run-status-fold-contributes-no-lifecycle-arm` unit test lands in the SAME commit that deletes the two
> `run-status.ts` fold arms (§D332.9 rule 4; `ref guards-and-tests` §5.2 A2); A3's `runs_view` table is
> removed with the projector's rewire, its `runs-view-has-no-reader` arm already active from 1.6.
> Settings status reads only `ref clock-config-secrets` §D331.6's presence/revision tuple; doctor and
> preflight follow §D331.11 P16 and report the `authority_upgrades` phases (§D332.5/§D332.6). No
> redesign.

### Task 2 · Run the non-mutating migration and recovery proof

**Task 1.6.6 deletion handoff.** Delete the migration-only
`src/infra/compat/{upgrade-sources,pre-floor-settings,settings-source-recovery,settings-database-upgrade}.ts`
modules and their stopped upgrade entry after the required recovery proof. Activate
`authority-upgrade-adapters-retired` with module-absence and named legacy-input refusal tests.
`sqlite-settings-authority` remains active; `authority-upgrade-adapters-isolated` retires when its
subjects are deleted. Preserve the strict v1/v2 historical-backup readers
`backup-inspection.ts`, `d331-settings-current.ts`, `d331-settings-root.ts`, and
`d331-protected-journal.ts`, plus permanent immutable journal schemas
`src/domain/commands-history.ts` and `src/domain/config/settings-v29-schema.ts`.
These historical readers never reintroduce runtime settings-file authority.

<!-- roadmap: p2f-proof -->

> **D336 (2026-09-06):** consume Task 1.6.6's verified SQLite-settings format, database restore
> behavior and independently read credential availability. The older paired-file rollback and
> `settings-root-single-pathname` target below are superseded. Delete only the migration adapters
> actually admitted by Task 6's revised proof/expiry mapping. Preserve downstream reconciliation,
> evidence readability, redaction and unknown-write refusal; no second live write is authorized.


- [ ] Run migrated-copy restore, scenario, concurrency, redaction, and direct-authority reconciliation
  gates; cite D135 rather than performing a second controlled write.
- [ ] Prove displaced sources cannot alter a response.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D332.4's restore-and-rollback admission
> with §D332.11 M17 (`restore-rollback-pairs-with-evidence`) and M22
> (`pre-floor-manifest-readable-for-restore`), re-run over a migrated COPY, and §D332.7 item 6 — a run
> left `authority-unknown` by a restore is never re-admitted. This task deletes adapters A0 and A1 and
> flips `authority-upgrade-adapters-retired` from `planned` to `active` in that deletion commit.
> D336 supersedes the former `settings-root-single-pathname` activation with the already-active
> `sqlite-settings-authority` guard (`ref guards-and-tests` §5.2). Task 1.6.6
> previously upgraded the real root; the operator subsequently reset it. Prove §D332.9 rule 5’s
> `authority-below-floor` refusal with a synthetic pre-floor artifact after adapter retirement;
> the deleted operator root/backup is not an input. D135 is cited; no second controlled write. No
> redesign.

### Task 3 · Close tail revalidation and hand fixtures to 3.1
<!-- roadmap: p2f-close -->

- [ ] Pass targeted/full/generated/production-route gates and an adversarial deletion-test review.
- [ ] Hand 3.1 stable contracts, representative fixtures, and an unresolved-defect ledger.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | hands 3.1 `ref clock-config-secrets` §D331.10 (the
> Settings/Setup edit contract), the served observed/active `display` pair (§D331.10's `derived-host`
> row on §D331.5's bootstrap/readback wire), and P40/A8 — after Task 6's accepted `Saved` source-copy
> correction, remaining Settings expansion and deliberate refreeze belong to 3.1 Task 9-2 —
> alongside the fixture matrix. No redesign.
