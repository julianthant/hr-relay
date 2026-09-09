# Phase 2.6 · Revalidate tails against canonical authorities

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

**2026-09-09 approved scope and identity amendment.** After the completed Task 1 peers, new
[Task 2 · Database modernization](database-modernization/README.md) combines database-parallel,
database-remaining and pending timeline T2. It contains multiple shared prerequisites and independent
peer groups; C0 contract/execution admission is still open. Active T1 keeps its own plan and gates.
The former Task 2 proof is now **Task 3** (p2f-proof), and former Task 3 closure is **Task 4**
(p2f-close). Their stable IDs and required proof remain. Below, dated old Task 2/3 and downstream-only
statements describe the earlier allocation; this amendment admits only the named database redesign.
Final Task 3 owns combined heavy gates, all remaining repairs and fresh independent review, then
Task 4 handover. A focused-tested development release unlocks only its explicit consumers and does
not mark a roadmap task done. Completed Task 1 files and evidence are unchanged.

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

**Task 1.6.7 deterministic handoff (recorded 2026-09-07; accepted at closure 2026-09-08).**
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
The final acceptance below closes Phase 1.6 only; Phase 2.6 remains unstarted.

**Accepted foundation handoff (2026-09-08).** Task 7 consumed accepted schema-33 master and
combined fresh/v29 fixture proofs. Complete R3 review passed frozen evidence `c4fa2ba4`; local
integration `9b12f2e8` passed typecheck/lint, 5,546 coverage tests, 833 architecture tests and
261 unchanged parity cases. Both T1b workflows retain exact 0/0/0 write deltas; Separations has
fifteen fresh checkpoints and all eight assertions met. Final stopped-root doctor at
2026-09-08T09:16:18.954Z is healthy schema 33/generation 839 with twelve reconciled runs and zero
pending commands/unresolved writes/HR durable outbox. Preserve two historical leases, two local
terminal-result projection handoffs, all failed evidence and the externally created compatible but
stale backup. Preserve `workflow_runs` and `workflow_run_batches`; schema-32 reset is history, not
a restoration target. Revision 8 clears exactly the three temporary browser/timeout overrides;
restart verified defaults and all unrelated settings remain. Owned Task-7 runtime resources and
merged worktree/ref are cleaned; its user-owned standalone review record remains. No unresolved
implementation defect or Task-7 acceptance is deferred. Phase 2.6 remains unstarted and retains
only its originally assigned downstream/adapter work; no implementation or dispatch is authorized
by this handoff.

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

### Shared-reader prerequisite — approved 2026-09-08

D344 gives the existing P stage its own visible roadmap gate (`p2f-readers`) while retaining
the approved owner, brief, branches and gates. This is not a new competing extraction task.
Existing in-flight permissions remain unchanged. Newly planned work follows operator-coordinated
launches and integration in [roadmap D344](../../../../roadmap/roadmap.md#d344--operator-coordinated-prerequisite-groups-2026-09-08).

The operator approved a serial extraction before wave 1 after discovery found
trust/data/operator sections sharing `run-detail.ts` and root composition.
The complete prerequisite and trust execution brief lives in
[Task 1-1](task-1-1-revalidate-trust-and-evidence-consumers.md).
This amendment changes the wave's common base to the reviewed prerequisite
integration; it does not redesign D330/D331/D332 or dispatch the siblings.

| Owner after prerequisite | Exclusive files / boundary |
| --- | --- |
| 1-1 trust, current task `01a08042-bb76-7131-844a-872dd909a835` | Extracted trust/log/capture queries, receipt/Explain consumers, notification observation, `compose/trust.ts`, trust routes/tests; this README and shared roadmap recording until serialized integration. |
| 1-2 data, existing task `01a08043-5395-7c73-ae8f-8b6047aab3a4` | `queries/data.ts`, `compose/data.ts`, `routes/data.ts`, new Rerun values domain/service/query modules, explicit descriptor mappings/compiler checks/workflow declarations and tests. Mapping contract/decision pointer edits remain 1-2. |
| 1-3 operator, existing task `01a08043-6490-7181-a040-736db353cb68` | Remaining `queries/run-detail.ts`, status/projector/Activity/archive/operator composition/routes, `dashboard-harness.ts`, A2/A3 retirement and required DDL/historical backup admission. |
| Prerequisite owner before common base | Shared types/read-port and root wiring, query/route extraction and mechanical fixture/guard adaptation; full review/gates before any peer implementation. |

Each peer plans only its own task-specific file. Shared `guard-inventory.json`,
roadmap/generated artifacts and master integration are serialized with the
current integration owner; no concurrent shared-file edits. Peer implementation
and gates are independent after the common base; either verified merge order is
permitted. The existing four-auxiliary-worktree limit includes unrelated work.
Task 2 waits for every reviewed/integrated peer; 1-2 and 1-3 retain all their scope.

### Task 1-1 · Revalidate trust and evidence consumers

See the [owning task and execution brief](task-1-1-revalidate-trust-and-evidence-consumers.md).

### Task 1-2 · Revalidate data, intake, and prior-run value consumers

See the [owning task and execution brief](task-1-2-revalidate-data-intake-and-prior-run-values.md).

### Task 1-3 · Revalidate operator read models

See the [owning task and execution brief](task-1-3-revalidate-operator-read-models.md).

### Task 2 · Database modernization
<!-- roadmap: p2-db-modernization -->

The [combined workflow](database-modernization/README.md) is the single owner for approved product
directions, scope, prerequisites, independent peers and conditional prompts. No implementation is
ready until its listed admission and actual prerequisite releases are verified. Do not launch the
old database sidetrack prompts or pending standalone timeline T2 in parallel with this owner.

### Task 3 · Run the non-mutating migration and recovery proof

Consume the 2.6.2 development releases under the [final validation plan](database-modernization/final-validation.md).
This fresh session owns integration repairs, all required heavy gates and independent review before
operator-assigned master integration. The original recovery and adapter-retirement requirements follow;
none is replaced by the database redesign or a new controlled write.

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

### Task 4 · Close tail revalidation and hand fixtures to 3.1
<!-- roadmap: p2f-close -->

- [ ] Pass targeted/full/generated/production-route gates and an adversarial deletion-test review.
- [ ] Hand 3.1 stable contracts, representative fixtures, and an unresolved-defect ledger.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | hands 3.1 `ref clock-config-secrets` §D331.10 (the
> Settings/Setup edit contract), the served observed/active `display` pair (§D331.10's `derived-host`
> row on §D331.5's bootstrap/readback wire), and P40/A8 — after Task 6's accepted `Saved` source-copy
> correction, remaining Settings expansion and deliberate refreeze belong to 3.1 Task 9-2 —
> alongside the fixture matrix. No redesign.
