# F · Shared database/domain foundation

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

**Rename ownership amendment (2026-09-09).** [2.6.2 R](renames.md) now owns the seven
approved naming-only changes, including diagnostic/receipt/snapshot/dryrun names. Consume R's
committed names and evidence; do not repeat its migrations. Earlier rename allocations below are
historical product scope, superseded only for execution ownership. This owner retains all later
retirement, behavior and integration proof.

This file retains the approved common product scope and proof allocation from database-parallel.
[The workflow](README.md), [prerequisites](prerequisites.md) and [launch registry](PROMPTS.md)
are the only execution-control owners. Earlier A means current C; earlier B means current F;
P/D/G retain their product meanings. All product proof remains required. Heavy gates/review and
final repairs occur in 2.6.9, not separately per domain. Active timeline T1 remains unchanged;
pending T2 is now [T](timeline.md), not an external completed assumption.

C0/F must reconcile the inspected P/D/G paths below with S settings activation and the later L
lifecycle foundation before admitting peers. The paths are extraction candidates, not a verified
post-T1 frozen allocation. No peer may edit common schema/composition/command/fixture files merely
because an old ownership table once assigned them; the resolved C0/F manifest is required first.
Archive reports and run summaries each retain their one owner in [decisions.md](decisions.md).
There is no provider-owned integration task; 2.6.9 is the sole final integration/repair owner.

## Additional approved cleanup — 2026-09-09

F removes the unused SQL `spans` projection, its registration and generic repository, with focused
absence/retained-timeline checks. This does not delete timeline_events or historical span files
required by supported recovery. F also owns the generated_artifacts export-evidence fields,
one-for-one conversion of operator_xlsx_exports, its retirement and actual working export baseline.
G consumes this completed schema/API and owns publication/verification; [artifacts.md](artifacts.md)
owns the full row semantics and proof. No parallel ownership of migrations, registries or composition.

## Evidence behind the split

Inspected planning base: `ad159128b44926408babf02126941ba782052192` on local master. This is
source evidence, not a future execution base. The schema currently uses a single ordered migration
sequence (`src/infra/sqlite/migrations.ts`, current schema 34), literal historical fingerprints,
strict current-version opening, and shared upgrade/recovery registries. Four peer migrations cannot
independently reserve the same next version; renumbering at merge time would not prove the tested candidate.

`src/infra/sqlite/authority-database.ts`, `storage-records.ts`, `src/domain/authority.ts`, `ids.ts`,
`src/core/command-kernel.ts`, `run-executor.ts`, server composition, deletion/integrity, shared storage
diagnostics, fixtures and generated catalogs currently cross several product scopes. Separate worktrees
alone do not resolve those shared writes. B must finish their shared changes and expose real adapters
before peer dispatch. This is a bounded extraction, not a new database, migration framework or plugin system.

The planned dependency graph has no peer edge. Actual source-level disjointness and both-order
integration remain **release conditions for B**, because the extracted modules do not exist yet.
Do not call the peers READY merely because this plan has been committed.

## A — run completion prerequisite

Execute unit `side/run-completion` locally within the prerequisite task, using
[00a-run-completion.md](run-completion.md), with timeline T2 as its direct prerequisite.
Its full implementation, P1–P6, independent review, required gates, accepted local-master integration
and owned cleanup must finish before B. Provider usage is no longer a prerequisite for completion.
A owns its own migration sequence and shared consumer changes while no revised peer is running.

## B — shared database foundation

Unit ID: `side/database-foundation`, executed locally after A in the same prerequisite task.
This section is its implementation owner; do not open a separate supervisor. Read the complete
provider, diagnostics and artifacts contracts and proof tables; the allocation below does not replace them.

1. **Bind the base and current names.** Verify accepted A and timeline T2, source/target isolation,
   instruction owners, supported upgrade floor and free worktree capacity. Record actual full base SHA,
   schema identity and an exact old/new caller map. No operator database conversion is assigned.
2. **Settle interfaces before consumers.** Extract narrowly scoped provider storage, failure annotation,
   generated-file storage and checkpoint/export composition behind strict typed transaction ports.
   Keep the actual SQLite transaction shared across composite writes; an adapter must not accidentally
   commit part of an outer command/checkpoint/deletion transaction. Move current implementations with
   behavior-preserving proofs, then bind the final schemas from the product contracts. No raw-SQL escape
   hatch, broad repository redesign, alternate storage authority, placeholder success or mock-only wiring.
3. **Implement the shared conversion completely.** Own all migrations/fingerprints, SQL/JSON schemas,
   IDs, repository interfaces, integrity/deletion/recovery/backup registration and common composition.
   Supply the provider generic fields and honest legacy accounting representation; the diagnostic
   renames, protected retirement and resolution annotation; complete one-row imports and extraction
   rename; supply generated-file ordering, queue/receipts/version state and historical conversion.
   Choose migration version numbers only here from the accepted base. Never modify released fingerprints.
4. **Keep the intermediate application usable and safe.** Real legacy provider calls, diagnostic
   capture/download, intake submission and existing output consumers must work through the new storage.
   Strict compatibility adapters may retain old API names internally, but no second live table or
   dual-write authority. Unimplemented new attributed-provider/resolution/export-registration behavior
   must not be exposed as available. Preserve the existing output safety guarantees; do not activate a
   new unsafe writer pending G. Any required stronger safety at the adapter boundary is B's work.
5. **Finish shared presentation and generated inputs.** Update Storage Doctor shapes/counts and shared
   fixtures; complete all necessary root composition, registration, shared domain/import-closure changes,
   owner contract amendments, generated catalog/manifest inputs and guard-retirement inventory. The
   peer candidates must independently pass freshness checks without a later central regeneration fix.
6. **Prove and release.** Complete the foundation proof map below, full gates and fresh independent
   review. Record exact module/API/test ownership and release evidence. Use the prerequisite task's explicitly assigned local integration after review PASS.
   Only after accepted integration, required combined gates and cleanup record base `B` in
   [the prerequisite release record](prerequisites.md#release-record-required-from-every-implementation-prerequisite) and
   release P/D/G. Do not launch them automatically.

### B proof allocation

| Product proof | B's required evidence | Remaining peer evidence |
| --- | --- | --- |
| Provider P1/P5/P6 | Final strict schemas round-trip synthetic attribution; populated historical conversions, complete backup/restore, unchanged real composed legacy admission and diagnostics. | P proves all generic transactional policy, including P1–P4/P6; reuses only valid unchanged migration evidence and runs full required gates. |
| Diagnostics P1/P2/P6 | Evidence-preserving renames, protected retirement, historical unresolved defaults, deletion and restore; real existing consumers. | D proves P3–P5 and annotation-specific P6, including real composed command/UI and multi-connection races. |
| Artifacts P1–P3/P7/P8 | Complete import/extraction functionality and proof; generated historical source-copy migration, retirement, pending counts, shared retention/recovery. Prove low-level P4 ordering/CAS/rollback on actual SQLite. | G proves P4–P6 and generated-output portions of P8, including filesystem fault injection and existing export service. |

Record each subclaim's test and exact tested tree. No row is marked wholly complete from partial proof.
B must cover supported fresh/historical databases, populated mixed-domain upgrade, old identifier and
fingerprint stability, transaction rollback, pre/postcommit interruption, source-bound backups and
restore, tombstones and shared file references. Empty local tables are not migration evidence.


## Inspected module candidates for C0/F admission

F creates or extracts the following owned modules. Names below are intended new locations, not a
claim they currently exist. F records every actual file, exported contract and test selector before
release. A necessary change to this allocation requires a plan amendment before peer launch.

| Owner | Exclusive changing production scope after F | Exclusive tests and authored records |
| --- | --- | --- |
| P `side/provider-usage` | `src/infra/sqlite/provider-accounting.ts`; `src/core/provider-admission.ts`. F supplies immutable repository types and a real legacy implementation of this module before release. | Existing provider admission/pool/exhaustion tests, new `tests/unit/provider-accounting/`; provider plan and its new `01-provider-usage-evidence.md` file in this folder. |
| D `side/diagnostics` | `src/core/failure-resolution.ts`, `src/infra/sqlite/failure-resolution.ts`, `src/server/dashboard/queries/failure-resolution.ts`; resolution command admission/dispatch in `src/domain/commands.ts` and `src/core/command-kernel.ts`; `src/server/dashboard/queries/run-trust.ts`, `src/server/dashboard/queries/run-detail-types.ts`, `src/domain/dashboard/run-detail.ts`, `src/dashboard/surfaces/trust.tsx` and `trust-model.ts`; a new `src/server/dashboard/compose/failure-resolution.ts` factory. D alone may change these command/read/UI files. | New `tests/unit/failure-resolution/`, `tests/unit/dashboard/failure-record-render.test.ts`, `failure-record-model.test.ts`, and new resolution parity cases/references; diagnostics plan and its `02-diagnostics-evidence.md` in this folder. Shared guard-inventory changes belong to the prerequisite or final owner; D records the required delta. |
| G `side/artifacts-2` | `src/core/generated-artifact-projection.ts`, `src/infra/sqlite/generated-artifacts.ts`, existing `src/infra/artifacts/artifact-sink-projector.ts` and `xlsx-retention-sink.ts`; `src/server/dashboard/exports/operator-xlsx-export-service.ts` and a new `src/server/dashboard/compose/generated-exports.ts` factory. | Artifact projection/verified-reader/operator-XLSX tests and new `tests/unit/generated-artifacts/`; artifacts plan and its `03-artifacts-evidence.md` in this folder. No failure-detail UI or command registration changes. |

All other changing shared files must be completed by F: migration and storage records, IDs/global
repository types, authority database, recovery/upgrade/integrity/deletion registries, common server
composition, the run-executor's checkpoint transaction seam, Storage Doctor, fixture builders and
generated descriptor/catalog sources. P/D/G may call these frozen interfaces, not edit them. F must
route the real executor through G's module and expose the existing export service through its owned
factory; G must not need to reopen root composition. Shared contract/index status updates after peers
belong to the integration owner, with each peer documenting precise proposed changes in its own evidence.


Use prerequisites.md's F release record and four-way independence test (P/D/G/S). The old
standalone branches/master barriers/reviews/launch prompts are retired, not alternative execution.
Earlier plan-validation evidence is available in Git at `58d4fbcba` under database-parallel.
