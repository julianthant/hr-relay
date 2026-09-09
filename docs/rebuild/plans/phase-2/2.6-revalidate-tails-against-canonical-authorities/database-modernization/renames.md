# 2.6.2 R · Apply approved database renames

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

## Approval and boundary

On 2026-09-09 the operator approved keeping both maintenance tables and their behavior, renaming
only for clarity, and inserting this task before the former C0 planning prerequisite. The operator
then confirmed focused tests for every task and full gates at phase end, **as a Phase 2.6-only trial**.
At approval, no code or operator database had been changed. Scoped implementation evidence is recorded below.

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

**Status: scoped development complete; released to 2.6.3 C0.** The candidate and its focused
evidence are recorded below. Full Phase 2.6 acceptance remains open at 2.6.9.

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

## R execution evidence — 2026-09-09

### R1 — frozen inputs and ownership

Plan and source base: `27e073c0c69e1ff54fb699c805175589e8f016b3`. All four prerequisite
commits and discovery base passed `git merge-base --is-ancestor` against that exact base.
Committed approval and the seven-name contract were verified. Branch `codex/database-renames`
and `/Users/julianhein/Projects/hr-worktree-database-renames` were absent, then created from
the exact base. Primary checkout was clean and the sole registered worktree before creation.
The app task snapshot showed this as the sole active rebuild task; the adjacent planning tasks
were idle. No competing schema writer or test worker was observed. Migration 39 was absent;
current schema 38 and floor 37 were verified. R owns the shared schema seam until its release.
No subagents, operator database access, master integration, push or task dispatch are assigned.

The execution-base old-name search across `src`, `tests` and `scripts` produced this exact
consumer/fixture manifest (historical references remain subject to classification):

```text
src/core/command-kernel.ts
src/core/run-executor.ts
src/domain/authority.ts
src/domain/config/schema.ts
src/domain/config/settings-v29-schema.ts
src/domain/config/snapshot-generations.ts
src/domain/run/deleted-run.ts
src/domain/trust/evidence-identity.ts
src/infra/compat/backup-inspection.ts
src/infra/compat/settings-database-upgrade.ts
src/infra/sqlite/authority-database.ts
src/infra/sqlite/migrations.ts
src/infra/sqlite/storage-records.ts
src/services/trust/diagnostic-capture.ts
tests/scenario/workflows/person-lookup/dry-run.scenario.ts
tests/scenario/workflows/separations-kuali-finalization/dry-run.scenario.ts
tests/scenario/workflows/separations/dry-run.scenario.ts
tests/unit/architecture/storage-recovery.test.ts
tests/unit/command-groups.test.ts
tests/unit/config-snapshot-generations.test.ts
tests/unit/dry-run-scenario-composition.test.ts
tests/unit/dry-run-scenario-result.test.ts
tests/unit/fixtures/dry-run-admission-fixtures.ts
tests/unit/helpers/operation-names-fixture.ts
tests/unit/operation-names.test.ts
tests/unit/protected-settings-doctor.test.ts
tests/unit/server/compose-real-port.test.ts
tests/unit/sqlite-authority-database.test.ts
tests/unit/storage-backup.test.ts
tests/unit/storage-restore-drill.test.ts
tests/unit/storage-upgrade-admission.test.ts
tests/unit/storage-upgrade-d331.test.ts
tests/unit/storage-upgrade-tombstones.test.ts
tests/unit/storage-upgrade.test.ts
```

New proof: `tests/unit/database-renames.test.ts`. Migration history proof:
`tests/unit/architecture/migration-history-immutability.test.ts`. Existing diagnostic and
receipt proofs are included as specified by the approved gate commands.

Current state: R1–R5 complete within the approved development scope. C0 must consume the
committed R release below. Full acceptance, independent review, master integration and branch/worktree
cleanup remain assigned to 2.6.9. No task has been dispatched.

### R2–R3 — implementation and historical boundary

Migration 39 appends exactly seven `ALTER TABLE ... RENAME TO ...` statements. The migration
history guard passed with unchanged digests 1–38; floor 37 remains unchanged. Current SQL,
registries, generation accounting and deletion tallies use the new physical names. Metadata,
upgrade journal and snapshot exposure readers select names by schema version, never table
existence. Historical fingerprint ordering, schema aliases and invariant SQL translation retain
the released names. Old deletion tally JSON is not rewritten.

The source scan also found a transitive admission consumer outside the old-name search:
`src/infra/sqlite/recovery-contracts.ts` must admit v38 historical backup manifests. This
naming-boundary repair is within the approved direct-transitive scope. The v38 read-only
layout roster was added alongside the historical record aliases.

The populated v38 fixture fingerprint was independently captured using the untouched reader
at source base `27e073c0c69e1ff54fb699c805175589e8f016b3` and matched the candidate reader:
`14a5057e1f70a3f5a821934a85fbb5511784d4c2cc115f8db39fdf7a0aa021b5`. The disposable capture
script and synthetic roots were removed; the literal is retained in the rename test.

Iteration failures were classified before repairs: current readback fixtures still queried old
physical names; T1's pre-timeline fixture used `CURRENT - 1`, which incorrectly moved its
source from v37 to v38; newly authored populated fixtures initially violated enqueue/tombstone
admission. Repairs retain historical sources and all refusal assertions. Diagnostics' existing
repository replay/pinning rules and the SQL-protected dry-run/journal tables are tested separately;
R does not introduce SQL triggers or change retention behavior.

### R4 — gate configuration

The installed Vitest 4.1.10 resolves the plan's bare `--maxWorkers=1` to root 1 but project 4.
The initial iteration therefore did not qualify as the final one-worker gate. The supported
`VITEST_MAX_WORKERS=1` environment override (installed resolver
`coverage.DM_a_rWm.js`, line 380) resolves both unit and architecture projects to one fork,
`isolate=true`, and unchanged 30,000 ms deadlines. All final tests use that prefix plus the
plan's CLI flag. No configuration adapter, test membership, timeout or coverage change was made.

### R4 — final proof and gate results

All commands ran from `/Users/julianhein/Projects/hr-worktree-database-renames`. Final test
commands were prefixed with `VITEST_MAX_WORKERS=1`; resolved unit/architecture worker counts
were one. One child was observed under primary-run Vitest PID 59457; the final rerun reused
the unchanged runner/configuration and environment override. All selected
tests were collected; skips below are the explicitly excluded cases from `-t` selectors.

| Gate | Exit and observed result | Log |
| --- | --- | --- |
| Approved eight-file primary unit command | 0; 8 files, 239 tests passed | `/tmp/database-renames-focused-final.log` |
| Approved named corruption/restore drill | 0; 1 passed, 28 unselected | `/tmp/database-renames-restore-final.log` |
| Migration history immutability | 0; 4 tests passed | `/tmp/database-renames-history-final.log` |
| Changed consumer files: dry-run composition, protected-settings doctor, upgrade admission, operation names | 0; 4 files, 90 tests passed | `/tmp/database-renames-consumer-final.log` |
| Command-group populated rollback/resume | 0; 3 passed, 23 unselected | `/tmp/database-renames-command-final.log` |
| Composed runtime downgrade/failed-open cleanup | 0; 3 passed, 35 unselected | `/tmp/database-renames-compose-final.log` |
| Historical v7 native backup/restore | 0; 1 passed, 93 unselected | `/tmp/database-renames-recovery-final.log` |
| SQLite settings authority v32 pin | 0; 1 passed, 2 unselected | `/tmp/database-renames-settings-final.log` |
| `npm run lint` | 0; zero warnings | `/tmp/database-renames-lint-final.log` |
| `npm run build:manifest` / `npm run build:manifest:check` | 0 / 0; source-closure fingerprints regenerated, final freshness passed | `/tmp/database-renames-manifest.log`, `/tmp/database-renames-manifest-final.log` |
| `npm run stores:catalog:check` | 0; unchanged catalog fresh, regeneration unnecessary | `/tmp/database-renames-catalog.log` |
| `git diff --check` / staged whitespace | 0 / 0 | Verified before implementation commit |

The approved primary command is unchanged apart from the necessary environment override. Exact
additional test commands, including the two other approved commands, were:

```sh
VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/storage-restore-drill.test.ts -t 'names the corruption read-only, restores the named backup, and keeps every authority family'
VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/migration-history-immutability.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/dry-run-scenario-composition.test.ts tests/unit/protected-settings-doctor.test.ts tests/unit/storage-upgrade-admission.test.ts tests/unit/operation-names.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/command-groups.test.ts -t 'rolls back populated schema'
VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/server/compose-real-port.test.ts -t 'M9 refuses|releases its acquired server process record'
VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/storage-recovery.test.ts -t 'backs up and restores an exact v7 authority'
VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/sqlite-settings-authority.test.ts -t 'pins v32 values'
```

| Required proof | Observed evidence |
| --- | --- |
| Fresh schema and released history | Fresh baseline targets 39; exact registry/FK/open checks pass. Migration39 digest `f15605b5eb310cb3633e6bef344bc1286da29fa676f35f3a92333210ef7a324b`; 1–38 digests and floor37 unchanged. |
| Populated v38 → v39 | All seven families populated. Retained non-metadata rows preserve every column/JSON byte; metadata version advances with generation 7 retained. Two inserts in one authority transaction advance generation once to 8. Reopen preserves file bytes and does not repeat migration. |
| Historical/current fingerprints | Populated v38 matches the exact-base golden fingerprint above. Current backup and current authority fingerprints agree; the renamed fingerprint differs from historical, as required. Historical backup bytes remain unchanged after conversion/resume. |
| Historical strictness | A valid populated v38 passes both historical backup inspection and no-migrate open. Malformed receipt JSON, schema-valid contradictory receipt columns, and divergent physical layout each refuse by the intended validator. |
| Receipts/diagnostics/settings/dry-run | Insert/read/list/replay, retention pinning, strict schemas and generation proofs pass in the dedicated and existing suites. SQL immutability remains on existing protected tables; repository replay rejection remains on receipts/diagnostics. |
| Deletion | New cascade tallies name diagnostic_files/diagnostic_snapshots/run_receipts; old settled four-name tallies retain exact bytes. FK rejection, protected delete triggers and immutable journal/dry-run rows remain enforced. |
| Recovery and phase projection | Real stopped entrypoints roll back precommit, resume after SQLite commit once, retain the original baseline, add exactly committed/settled records, and preserve backup bytes. The v38 read-only phase regression first failed `no such table: database_upgrades`, then passed with version-aware selection. Existing credential/source-binding and T1 import/recovery proofs pass. |
| Real restore boundary | Named CLI corruption/restore drill and released-v7 native recovery proof pass using synthetic roots. |

The final release has 342 selected passing tests across 18 files. There were no added or retired
architecture guards, so guard-inventory membership is unchanged. The schema-version search found
two additional mechanical expectation sites (`command-groups.test.ts` and
`architecture/sqlite-settings-authority.test.ts`); their directly affected selectors passed.
No live HR action, operator root access, database upgrade, full coverage, typecheck or parity is claimed.

### Historical-name exceptions

Every remaining old-name reference under `src`, `tests` and `scripts` was inspected. No current
consumer still addresses an old physical table. Intentional exceptions are:

- `migrations.ts`: released DDL, table order, layout rosters, type names, index/trigger identities
  and error strings; v39 rename statements and explicit version mappings. Statements 1–38 are immutable.
- `backup-inspection.ts`: released fingerprint order and six historical record-schema aliases.
- `authority-database.ts`: six historical record-schema aliases and the v1 metadata insertion.
  Historical invariant SQL translates the complete seven-name map before historical preparation.
- `settings-database-upgrade.ts`: v1 metadata insertion; other historical access is version-selected.
- `deleted-run.ts`: four pre-v39 tally names; `settings-v29-schema.ts`: historical snapshot annotation.
- Tests: released v1–38 fixture DDL/bookkeeping, rejected divergent/newer labels, retained golden
  fingerprint order, pre-v39 snapshot/journal sources, isolated v36 operation migration, and the
  new explicit old/current rename proof. No released fixture schema was relabeled as current.
- Existing contract/history prose and immutable evidence retain their original context. The
  ratified seven-name mapping above identifies current physical names; no historical evidence was rewritten.

### R5 — committed development handoff

| Identity | Value |
| --- | --- |
| Approved plan commit / exact source base | `27e073c0c69e1ff54fb699c805175589e8f016b3` |
| Tested implementation candidate | `37ed00d19a8b410c3fb542bea8328c0eef962b4c` |
| Tested implementation tree | `4ed36a7091bb577373d7e3a86eaed04eeab9ab1e` |
| Branch | `codex/database-renames` |
| Retained worktree | `/Users/julianhein/Projects/hr-worktree-database-renames` |
| C0 input | This committed handoff, whose parent is the exact implementation candidate above. Resolve the handoff commit from this branch; never use the planning base as the development release. |
| Independent review | Deferred to 2.6.9; no independent acceptance asserted. |
| Integration and cleanup | No master merge or push. Operator assigns 2.6.9 integration after full gates and independent PASS; retain this branch/worktree until then. |

The implementation commit contains exactly these 34 paths:

```text
src/core/command-kernel.ts
src/core/run-executor.ts
src/domain/authority.ts
src/domain/config/schema.ts
src/domain/config/snapshot-generations.ts
src/domain/run/deleted-run.ts
src/domain/trust/evidence-identity.ts
src/domain/workflow/generated-build-manifest.ts
src/infra/compat/backup-inspection.ts
src/infra/compat/settings-database-upgrade.ts
src/infra/sqlite/authority-database.ts
src/infra/sqlite/migrations.ts
src/infra/sqlite/recovery-contracts.ts
src/infra/sqlite/storage-records.ts
src/services/trust/diagnostic-capture.ts
tests/scenario/workflows/person-lookup/dry-run.scenario.ts
tests/scenario/workflows/separations-kuali-finalization/dry-run.scenario.ts
tests/scenario/workflows/separations/dry-run.scenario.ts
tests/unit/architecture/migration-history-immutability.test.ts
tests/unit/architecture/sqlite-settings-authority.test.ts
tests/unit/architecture/storage-recovery.test.ts
tests/unit/command-groups.test.ts
tests/unit/config-snapshot-generations.test.ts
tests/unit/database-renames.test.ts
tests/unit/dry-run-scenario-composition.test.ts
tests/unit/dry-run-scenario-result.test.ts
tests/unit/fixtures/dry-run-admission-fixtures.ts
tests/unit/helpers/operation-names-fixture.ts
tests/unit/protected-settings-doctor.test.ts
tests/unit/server/compose-real-port.test.ts
tests/unit/sqlite-authority-database.test.ts
tests/unit/storage-backup.test.ts
tests/unit/storage-upgrade-admission.test.ts
tests/unit/storage-upgrade.test.ts
```

This recording commit changes only this evidence owner, the adjacent `README.md` readiness
pointer, `docs/roadmap/roadmap.md`, and its supported generated `docs/roadmap/index.html`. The implementation candidate's source, tests,
configuration, dependencies and generated build manifest are unchanged; the code-gate evidence
above is reused under D191. Documentation binding/freshness, links, instruction pairs and whitespace
are checked before the handoff commit. Its exact SHA is returned to the operator after commit.

Retained resources are the assigned branch/worktree and its ignored dependency symlink to the
primary checkout's existing `node_modules`; successful test-run scratch was removed by the wrapper.
Seven named failed synthetic scratch roots were removed after verifying owner identity, private
permissions and absent process groups; no other task scratch was touched.
Gate logs remain at the exact `/tmp/database-renames-*` paths above. No owned test process remains.

2.6.9 still owes full typecheck, lint, coverage, whole architecture, desktop parity/build, generated
freshness and the original broad recovery/scenario/concurrency/redaction/production-route proofs;
it also owns repairs, fresh complete independent review, operator-assigned master integration,
handover and branch/worktree cleanup. C0 is ready for the operator to open sequentially; no dispatch
or acceptance on C0's behalf occurred. Phase 2.6 remains open.

### Delivery assessment

No scope amendment, assignment resize or external prerequisite change was required. The plan
correctly coupled migrations, historical validation and recovery. Read-only inventory needed a
second schema-version search to find the backup-manifest admission ceiling and current-version
expectations; these were direct transitive naming work already admitted by the plan.

Implementation repair covered mixed historical/current fixtures and one missed historical upgrade-
phase projection. The latter had a concrete red regression and a full prescribed focused rerun.
The new fixture's enqueue/tombstone and protection assumptions were corrected against existing
admission/DDL, without adding behavior or relaxing existing tests. The installed runner's project
override required a supported environment setting, not a configuration adapter. An earlier resolved-
worker check and explicit coverage of every read-only phase consumer would have avoided those
iterations. Full review has not run; no comparative quality score or time-savings claim is made.

### Recording validation

`VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1
tests/unit/architecture/roadmap-doc-binding.test.ts` passed (exit 0; 24 tests;
`/tmp/database-renames-doc-binding.log`). `npm run roadmap` and `npm run roadmap:check`
passed (exit 0; `/tmp/database-renames-roadmap.log`). All three links/anchors in this owner
resolve. All nine existing instruction pairs remain byte-identical; the longest project
chain is 17,333 UTF-8 bytes. `git diff --check` passed. Inspection confirmed no differences
from the tested implementation in `src`, `tests`, configuration or dependency inputs;
its focused gates and lint are reused without claiming unrun broad gates.
