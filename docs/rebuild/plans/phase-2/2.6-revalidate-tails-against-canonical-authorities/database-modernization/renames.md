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

## Single ownership and sequence

R owns these seven naming changes, their current consumers and focused naming proof. Later F/D/S
consume R's names; they do not perform these renames again. Diagnostics retirement/resolution,
settings consolidation/hot activation, run completion, provider accounting, artifacts lifecycle,
version/archive changes and table removals remain with their existing owners. Approved SQL `spans`
removal and `operator_xlsx_exports` consolidation into generated_artifacts belong to F/G, not R. Existing accepted worker/operation/
command renames and timeline T1 are not repeated.

1. Verify completed 2.6.1 and accepted T1 ancestry, current schema/floor and actual current names.
   Read nearest module instructions. Freeze a concrete current-consumer/test manifest for this
   finite mapping before editing; check SQL, registry, repositories, recovery, CLI/BFF and fixtures.
2. Rename current identifiers and consumers consistently. Add the supported next migration and
   update current registries/validators; preserve released migration bytes and fingerprints,
   historical schemas/readers and immutable stored JSON formats. Historical names needed to read
   old databases remain intentional and are listed in the handoff. Do not blindly replace them.
3. Adapt existing focused tests to current names while retaining old-layout fixtures. Prove fresh
   creation and populated supported upgrade preserve rows/links and strict opening, with targeted
   rollback/replay coverage for affected paths. No migration of the operator's database is assigned.
4. Run focused tests, lint, affected generated-file checks and `git diff --check`; fix failures
   here. Search for each old name and classify remaining uses as required historical references.
   No full coverage, whole architecture suite or broad parity in R. Full typecheck and all required
   broad acceptance gates plus fresh independent review belong to **2.6.9**.
5. Commit the naming candidate and exact evidence here. Release it to **2.6.3 C0**, which plans
   downstream work against the actual renamed tree. Mark only scoped development completion;
   full product acceptance and master integration remain pending finalization.

## Execution binding and tests

One Astra/high supervisor, zero implementation subagents by default. The operator opens planning
and execution sessions; no automatic dispatch. Proposed branch `codex/database-renames`, new owned
worktree `/Users/julianhein/Projects/hr-worktree-database-renames`; planning creates neither.
The implementation base must include completed 2.6.1 and T1 integration
`46930920696ab214b036d5f2681b8ffb4e5620ea`, plus this approved plan. `/phase-plan 2.6.2` records
its exact available base/plan SHA, current write-set and test selectors before `/supervise 2.6.2`.
No C0 dependency: R is its prerequisite. No concurrent shared-schema writer may overlap R.

Focused candidate suites to select by actual affected names: `tests/unit/sqlite-authority-database.test.ts`,
`tests/unit/storage-upgrade.test.ts`, `tests/unit/run-record-service/service.test.ts`,
`tests/unit/storage-backup.test.ts`, `tests/unit/storage-restore-drill.test.ts` and existing diagnostic,
config-snapshot and dry-run tests. Use exact affected cases/suites, one effective Vitest worker,
private synthetic databases and `npm run lint`; do not run all listed suites indiscriminately.
Preserve assertions and scope; finalization still owes the complete existing proof families.

The development handoff records plan/base/head/tree, exact paths, commands/exits, tested scope,
historical-name exceptions and all deferred full gates/review. C0 and later prerequisites consume
this candidate sequentially; **2.6.9 is the sole master-integration and remaining-repair owner**.
No master merge or push here. Failed focused tests/lint are fixed before handoff; no idle observers.

**Status: approved scope; execution brief/base admission pending `/phase-plan 2.6.2`.**
