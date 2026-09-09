# 2.6.2 R · Apply approved database renames

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

## Approval and boundary

On 2026-09-09 the operator approved keeping both maintenance tables and their behavior, renaming
only for clarity, and inserting this task before the former C0 planning prerequisite. The operator
then confirmed focused tests for every task and full gates at phase end, **as a Phase 2.6-only trial**.
This document plans execution; no code or operator database has been changed.

One row below is one naming change. Keep stored row meaning, identifiers, relationships, immutable
payloads, transaction behavior, backup/export capabilities and upgrade recovery unchanged.

| Current physical table | Approved name |
| --- | --- |
| `authority_meta` | `database_state` |
| `authority_upgrades` | `database_upgrades` |
| `diagnostic_bundles` | `diagnostic_snapshots` |
| `diagnostic_attachments` | `diagnostic_files` |
| `evidence_receipts` | `run_receipts` |
| `config_snapshots` | `settings_snapshots` |
| `dry_run_scenario_results` | `dryrun_results` |

The first two names were approved after examining search consistency, backups, exports and manual
upgrade recovery. A manual upgrade still records its progress; no automatic update mechanism or
new dashboard version control is introduced. Backup/export retention remains unchanged.

## Approved execution brief — 2026-09-09

The operator approved the complete `/phase-plan 2.6.2` proposal with “approve” on 2026-09-09.
This section is the substantive execution owner. Planning does not implement R or mark its
development release complete. The existing [naming contract](../../../../reference/dashboard-surfaces.md#phase-26-approved-naming-and-projection-cleanup--2026-09-09)
already ratifies the seven names; no additional product decision is introduced here.

### Verified prerequisites and checkout binding

Read-only discovery used base `0df282e45efab2e5a4768386b5c4d5202a7cfc93` on `master`.
Each following ancestry check returned exit 0 against that base:

| Prerequisite | Verified ancestor |
| --- | --- |
| 2.6.1-1 trust integration | `5a07b329e` |
| 2.6.1-2 data integration | `b2302c057` |
| 2.6.1-3 operator integration | `813581124` |
| Accepted timeline T1 integration | `46930920696ab214b036d5f2681b8ffb4e5620ea` |

The observed schema is 38 and the stopped-upgrade floor is 37. Migration digests 1–38 are pinned.
Only the primary worktree was registered. The proposed branch and worktree were absent. The
primary checkout contains an unrelated untracked Phase 4 background-check walkthrough; preserve it.

| Assignment | Branch / absolute worktree | Base and plan availability | Integration and release condition |
| --- | --- | --- | --- |
| 2.6.2 R; one GPT-6 Astra/high supervisor; zero implementation workers | Create `codex/database-renames` at `/Users/julianhein/Projects/hr-worktree-database-renames` | Create from the verified planning commit containing this approved brief, which descends from `0df282e45efab2e5a4768386b5c4d5202a7cfc93`. The planner returns its full SHA after commit verification. | Publish a committed, focused-tested development candidate to 2.6.3 C0. No master merge. Retain branch/worktree for downstream consumption; 2.6.9 owns final master integration, when operator-assigned, and cleanup after full gates and independent PASS. |

Before creating the checkout, recheck refs/path capacity, ancestry, plan content and absence of a
concurrent shared-schema writer. Names are proposals, not reservations. Do not reset a colliding ref
or reuse another task's checkout. No C0 dependency exists: R is C0's prerequisite. C0 must consume
R's actual committed candidate; it must not use the planning commit as a development release.

### Scope and exclusions

R owns these seven naming changes, their current consumers and focused naming proof. Later F/D/S
consume R's names; they do not perform these renames again. Diagnostics retirement/resolution,
settings consolidation/hot activation, run completion, provider accounting, artifacts lifecycle,
version/archive changes and table removals remain with their existing owners. Approved SQL `spans`
removal and `operator_xlsx_exports` consolidation into generated_artifacts belong to F/G, not R. Existing accepted worker/operation/
command renames and timeline T1 are not repeated.

Preserve upgrade admission behavior and floor 37, immutable stored JSON formats, backup/export
capabilities and retained identities. There is no operator-database upgrade, lifecycle redesign,
settings activation, table retirement, live browser/HR action, push or automatic task dispatch.
Historical table-name strings are intentional evidence, not rename residue to rewrite.

### File and resource ownership

R is one cohesive serial assignment: migration bookkeeping and historical validators share the same
adapter and cannot be split into independent acceptance units. The supervisor implements and fixes
the entire seam. No implementation or review subagents run in R under this Phase 2.6-only trial.

| Owned write set | Permitted change |
| --- | --- |
| `src/domain/authority.ts`, `src/domain/run/deleted-run.ts`; `src/infra/sqlite/migrations.ts`, `authority-database.ts`, `storage-records.ts`; `src/infra/compat/backup-inspection.ts`, `settings-database-upgrade.ts` | Current names, appended migration, version-aware bookkeeping/readers, historical schema aliases and invariant translation, deletion tally compatibility. |
| `src/core/command-kernel.ts`, `src/core/run-executor.ts`, `src/domain/config/schema.ts`, `settings-v29-schema.ts`, `snapshot-generations.ts`, `src/domain/trust/evidence-identity.ts`, `src/services/trust/diagnostic-capture.ts` | Directly affected naming annotations only; preserve historical references where they describe old evidence. |
| `tests/unit/database-renames.test.ts` (new), `tests/unit/architecture/migration-history-immutability.test.ts`; affected existing unit suites and fixtures listed below | Focused rename proof; append only migration 39's digest; current-name adaptation with retained old-layout fixtures and negative controls. |
| `tests/scenario/workflows/{person-lookup,separations,separations-kuali-finalization}/dry-run.scenario.ts` | Mechanical current table-name references only; read `tests/scenario/AGENTS.md`; no live execution or acceptance change. |
| This file; naming annotations at existing contract owners; affected generated outputs through supported generators | Approved naming/evidence recording only. No broader documentation cleanup or downstream contract redesign. Shared roadmap recording, if needed for scoped release, is serialized. |

The inspected unit consumer/fixture set is `command-groups.test.ts`, `config-snapshot-generations.test.ts`,
`dry-run-scenario-composition.test.ts`, `dry-run-scenario-result.test.ts`,
`fixtures/dry-run-admission-fixtures.ts`, `helpers/operation-names-fixture.ts`, `operation-names.test.ts`,
`protected-settings-doctor.test.ts`, `server/compose-real-port.test.ts`, `sqlite-authority-database.test.ts`,
`storage-backup.test.ts`, `storage-restore-drill.test.ts`, `storage-upgrade-admission.test.ts`,
`storage-upgrade-d331.test.ts`, `storage-upgrade-tombstones.test.ts`, `storage-upgrade.test.ts`, and
`architecture/storage-recovery.test.ts`, all under `tests/unit/`. Existing diagnostic and receipt
behavior proofs are also admitted. R1 freezes the exact affected manifest against the execution base;
this list is not permission to rewrite unrelated assertions. Direct transitive naming fixes stay in
scope; a required behavior change or conflicting ownership returns for amendment.

### Consequential evidence and required proof

Discovery inspected code and tests only; it did not execute implementation tests or inspect/mutate
the operator database. Actual-target preflight is inapplicable because acceptance is synthetic only.
The [accepted T1 delivery assessment](history/timeline-t1.md#delivery-assessment--accepted-t1-candidate)
found missed production recovery consumers; R therefore includes the real restore/upgrade boundary
before release. Broad final proof still belongs to 2.6.9.

| Boundary / current evidence | Necessary change and acceptance proof |
| --- | --- |
| `migrations.ts` is at schema38/floor37; immutable DDL and migration digests retain old names. | Append migration39 only if still available; preserve statements/digests 1–38 and floor37. Fresh creation produces exactly the seven new physical names and passes strict open, FK checks and baseline journal validation. |
| `AuthorityDatabase.#runMigrations`, `readMetaRow`, generation accounting and stopped `convertDatabase`/`settleSettingsUpgrade` address `authority_meta` directly. | Explicit version-aware metadata/journal access across the rename boundary in both migration paths; no table-existence fallback. Populated v38→v39 preserves row bytes, keys, links and transaction accounting. Current reopen does not rerun migration. |
| `backup-inspection.ts` maintains released fingerprint order, admitted historical versions and record-schema aliases. Current fingerprints include physical table names. | Admit v38 as historical and retain historical name/order algorithms; do not require old and new schema fingerprints to equal. Old backups retain their original fingerprints and validate strictly; renamed current backups agree with the current authority fingerprint. Malformed historical records and divergent layouts still refuse. |
| `inspectHistoricalAuthorityInvariants` translates current SQL before preparing it against replayed historical DDL; missing tables can exclude a query. | Translate all affected names for old schemas so rename changes cannot silently remove historical checks. Use a valid historical control plus a schema-valid contradictory record that the affected invariant must reject. |
| `DeletedRunRecordSchema.removed[].table` persists names; deletion SQL and triggers enforce tombstone-first removal. | Admit old and new names without rewriting settled JSON. New deletion tallies name current tables; cascade/FK/immutability protection survives and deletes are forbidden without a tombstone. |
| Diagnostics, receipts, settings snapshots and dry-run results use strict repositories over the affected tables. | Preserve insert/read/list/replay, binding, retention and strict rejection behavior. Retained JSON, snapshot generations, receipt identities and old deletion tallies remain byte-identical. |
| Stopped upgrade has precommit rollback and separately settled credentials/journal. | Inject precommit failure and prove rollback; resume after SQLite commit exactly once; replay must not duplicate journal evidence or modify original sources. Use existing real supported entrypoints and synthetic roots. |

### Ordered steps

1. **R1 — Freeze inputs and ownership.** Verify prerequisite ancestry, committed approval, checkout
   binding, schema/floor and shared-writer exclusion. Read nearest instructions and record the exact
   current consumer/test manifest. Recheck naming references across SQL, registry, recovery, CLI/BFF
   and fixtures; preserve unrelated work. Send Done / Now / Remaining before the next step.
2. **R2 — Append the rename migration.** Append migration39, update current registries, SQL,
   generation accounting and migration bookkeeping. Preserve released history 1–38, floor37 and
   upgrade admission. A competing migration release is an amendment condition, not permission to
   overwrite or silently renumber another candidate.
3. **R3 — Preserve historical reading and recovery.** Implement explicit version-aware mappings
   for metadata, journals, record validators and invariant SQL. Admit historical v38 and retain old
   backup fingerprints, immutable payloads and settled tallies. New deletion receipts use current names.
4. **R4 — Prove the complete boundary.** Implement the proof rows above in private synthetic
   databases. Run the focused gate schedule and fix failures within R. Search each old name and
   classify every remainder as immutable migration, historical reader/fixture/evidence, or a missed
   current consumer requiring repair. Do not weaken assertions to make the rename pass.
5. **R5 — Release scoped development completion.** Commit exact logical naming/test/document paths,
   freeze the tested candidate, and record plan/base/head/tree, exact changed paths, commands/exits,
   proof rows, historical-name exceptions and deferred broad acceptance. Release to **2.6.3 C0**,
   retain the branch/worktree, and stop. Mark only scoped development completion; Phase 2.6 and
   finalization remain open. No master merge, push, sibling launch or independent review here.

### Gate schedule and resources

Run commands from the absolute R worktree. The existing wrapper `scripts/test-runner.ts` owns test
process groups and synthetic scratch. Use one effective Vitest worker and verify resolved/observed
worker count; retain configuration, membership, isolation, timeouts and coverage floors. Recheck
host work and the batch's four-worker ceiling; never kill another task's processes. No temporary
configuration adapter is assigned. Generators sharing outputs run sequentially.

Iteration runs the relevant file/case from the commands below; before committing the implementation
candidate, complete all applicable commands and record actual exits, logs and tested tree identity.

```sh
npm run test -- --project unit --maxWorkers=1 tests/unit/database-renames.test.ts tests/unit/sqlite-authority-database.test.ts tests/unit/storage-upgrade.test.ts tests/unit/storage-backup.test.ts tests/unit/config-snapshot-generations.test.ts tests/unit/evidence-receipt-repository.test.ts tests/unit/diagnostic-capture.test.ts tests/unit/dry-run-scenario-result.test.ts
npm run test -- --project unit --maxWorkers=1 tests/unit/storage-restore-drill.test.ts -t 'names the corruption read-only, restores the named backup, and keeps every authority family'
npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/migration-history-immutability.test.ts
npm run lint
git diff --check
```

Add focused selectors for other directly affected cases when the final manifest or a failure
requires them; do not run every discovered suite indiscriminately. No missing-test success is
permitted. Regenerate only affected outputs, then run their freshness checks:
`npm run build:manifest` / `npm run build:manifest:check` for descriptor import-closure inputs;
`npm run stores:catalog` / `npm run stores:catalog:check` for catalog inputs;
`npm run roadmap` / `npm run roadmap:check` for roadmap/doc-binding inputs. Do not edit outputs by hand.

Recording-only commits run applicable documentation/link/instruction-pair/freshness and whitespace
checks, with inspected unchanged-input evidence for any reused code checks. Changed inputs, failures
or unresolved concerns require the relevant rerun. Failed focused tests or lint block R's release.

The approved [D191 Phase 2.6 exception](../../../../reference/guards-and-tests.md#314-testing-standard-d85--what-replaces-the-e2e-ritual)
defers full typecheck, coverage, whole architecture, broad parity/build, and complete recovery/scenario/
concurrency/redaction/production-route acceptance to **2.6.9**. No UI interaction, layout or performance
change is assigned to R; current physical table strings may propagate through the existing typed
storage reports. Broad visual proof is deferred by the trial, not claimed unnecessary or passed.

### Review, stops and handoff

R has one implementation assignment and zero review assignments. The coupled migration/recovery seam
fits one supervisor; no parallel split is proposed. At finalization, 2.6.9 owns one fresh complete
read-only `sup_review` on Astra/high covering the combined candidate, including every retained R proof,
full gates, remaining repairs/review reruns, operator-assigned master integration and cleanup. R does
not create that reviewer or self-certify independent acceptance.

Stop dependent work for changed/missing prerequisites, ref/path ownership conflict, another schema
release, a required behavior/contract change, or an actual unresolved blocker. Routine naming fixes
and regression repairs remain with R. No operator database conversion, live submission, fallback
that hides invalid state, or changed downstream task scope is authorized.

The final R handoff records the plan commit, source base, candidate head/tree, branch/absolute worktree,
exact paths, commands/exits and tested scope, historical exceptions, unfinished broad gates/review,
and retained resources. C0 consumes the actual R release sequentially. Send Done / Now / Remaining
at start/resume and after each verified R1–R5 completion, keeping final review/integration/cleanup
explicitly deferred. The operator opens C0; R never dispatches it.

**Status: execution brief approved; implementation not started.** Planning readiness is established
only after committed content, scoped planning checks and prerequisite availability are verified.

## Planning persistence verification — 2026-09-09

During persistence, another session committed the previously untracked Phase 4 walkthrough as
`3a1ebc35b1829e221dafb1e68cacfedb759d68cc`. Its only changed path is
`docs/rebuild/plans/phase-4/4.1-background-check/2026-09-08-background-check-walkthrough.md`.
It changes no R code, schema, tests, configuration, dependencies or approved scope. This planning
commit preserves that input and descends from the verified discovery base. The supervisor creates
its branch from the exact planning commit supplied in the verified launch prompt.

| Planning check | Result |
| --- | --- |
| `npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/roadmap-doc-binding.test.ts` | Exit 0; one test file, 24 tests passed; private runner scratch removed. |
| `npm run lint` | Exit 0; full repository lint passed. |
| `npm run roadmap:check` | Exit 0; existing `docs/roadmap/index.html` is fresh; regeneration unnecessary. |
| Scoped Markdown destination/heading checks | All 13 links/anchors across this file, README.md and PROMPTS.md resolve. |
| Existing instruction twins and project chains | All nine pairs byte-identical; longest project chain 17,333 UTF-8 bytes, below 32,768. |
| `git diff --check` and affected-input inspection | Passed; this assignment changes only the three planning Markdown files. |

No product code, tests, configuration, dependency or runtime artifact changes were made. Full
typecheck/coverage, implementation tests, live proof and independent review were not run or claimed
reused. They are not planning acceptance under D191's documentation-only rules. Commit identity,
actual committed content and prerequisite reachability are verified after commit before emitting
the launch prompt; a planning release does not complete R implementation.
