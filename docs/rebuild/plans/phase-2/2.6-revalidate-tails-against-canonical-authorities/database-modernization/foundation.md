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
| D `side/diagnostics` | `src/core/failure-resolution.ts`, `src/infra/sqlite/failure-resolution.ts`, `src/server/dashboard/queries/failure-resolution.ts`; resolution command handling in new `src/server/dashboard/commands/failure-resolution.ts`; F owns global unions and root dispatch; `src/server/dashboard/queries/run-trust.ts`, F-owned frozen run-detail types, `src/dashboard/surfaces/trust.tsx` and `trust-model.ts`; a new `src/server/dashboard/compose/failure-resolution.ts` factory. D alone may change these command/read/UI files. | New `tests/unit/failure-resolution/`, `tests/unit/dashboard/failure-record-render.test.ts`, `failure-record-model.test.ts`, and new resolution parity cases/references; diagnostics plan and its `02-diagnostics-evidence.md` in this folder. Shared guard-inventory changes belong to the prerequisite or final owner; D records the required delta. |
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

## C0 prerequisite allocation — 2.6.6 F

Consume **C release**. One Astra/high supervisor; zero implementation workers.
Use `F`'s exact branch/absolute worktree from [the registry](PROMPTS.md#binding-registry).
No future input SHA is guessed. Resolve committed candidate identities before creating the checkout.

F owns shared schemas, appended migrations, strict historical aliases, complete imported/extracted
artifact conversion, generated XLSX single-row conversion, diagnostic retirement, app_settings
consolidation, unused projection retirement and all global unions/registration. Preserve R's seven
names and C's completion. Common methods expose real authority transaction handles and validated
record types; peers cannot add columns, change fingerprints or fix a common fixture after launch.

Create/extract all four child path sets below before release. Route current production behavior
through them: existing capability admission through P; real failure capture/readback through D's
query/capture interface; explicit XLSX generation and checkpoint projection through G; settings save,
new-run selection, claim authorization and worker resource creation through S. Freeze stable methods
and global command types needed for the approved child behavior. A baseline can preserve existing
capability availability, but an unused factory or placeholder success is not release proof. Resolution
commands must have an explicit capability state until D supplies the admitted mutation; existing
failure readback remains functional. Do not expose an action that only reaches a placeholder.

S's extracted run-settings and run-claim-admission modules own selection/authentication policy;
F rewires run-record-service, command-kernel, intake creation and worker-loop callers to those ports.
S's run-resources factory receives the claimed run and its retained snapshot. F routes actual task,
session/browser, provider and deadline configuration through that factory, preserving old behavior
before S changes activation. P receives the resolved invocation settings, never imports S's mutable
implementation. D/G depend only on frozen artifact/evidence and capture contracts, not each other.

For process-wide ordinary scheduling, select current saved idle cadence at the next idle scheduling
boundary; do not cancel or re-time a held claim/deadline. All run-bound task, session/browser and
provider invocation values use the retained run snapshot. Lowered shared admission limits do not
terminate existing work or erase cumulative quotas. Host probe and deployment-only sources retain
existing process scope. The settings catalog and each actual composition consumer must agree;
changing only the stored fingerprint fails S acceptance.

Ordered work: admit C; implement shared conversion and real baseline repositories; extract/reconnect
four production module sets; freeze types/callers/fixtures and generated inputs; prove populated
mixed-domain migration, rollback/restore and independent baseline flows; release one F SHA to all
four children. Preserve every B proof allocation above and artifact P1–P3/P7/P8, diagnostic P1/P2/P6,
provider migration proof and settings bootstrap/snapshot continuity. No intermediate finalization.

### Prerequisite-owned shared paths

- `src/infra/sqlite/migrations.ts`
- `src/infra/sqlite/authority-database.ts`
- `src/infra/sqlite/storage-records.ts`
- `src/infra/sqlite/recovery-contracts.ts`
- `src/infra/compat/backup-inspection.ts`
- `src/infra/compat/settings-database-upgrade.ts`
- `src/domain/authority.ts`
- `src/domain/run/deleted-run.ts`
- `src/server/storage/compose.ts`
- `src/server/storage/upgrade.ts`
- `src/domain/commands.ts`
- `src/core/command-kernel.ts`
- `src/core/run-record-service.ts`
- `src/server/dashboard/compose.ts`
- `src/server/worker/compose.ts`
- `src/server/dashboard/commands/command-service.ts`
- `src/cli.ts`
- `src/core/run-executor.ts`
- `src/core/worker-loop.ts`
- `src/core/worker-sessions.ts`
- `src/domain/ids.ts`
- `src/domain/providers.ts`
- `src/domain/provider-admission.ts`
- `src/domain/artifacts.ts`
- `src/domain/config/schema.ts`
- `src/domain/config/catalog.ts`
- `src/domain/config/runtime-generation.ts`
- `src/domain/config/settings-current.ts`
- `src/domain/dashboard/settings.ts`
- `src/domain/dashboard/settings-editor.ts`
- `src/domain/dashboard/run-detail.ts`
- `src/server/dashboard/queries/run-detail-types.ts`
- `src/server/dashboard/queries/storage.ts`
- `src/domain/dashboard/storage.ts`
- `src/services/runs/enqueue.ts`
- `src/domain/intake/enqueue.ts`
- `src/services/start/plan.ts`
- `src/domain/workflow/delegation.ts`
- `src/domain/workflow/delegation-policy.ts`
- `src/domain/intake/session.ts`
- `src/domain/intake/manifest.ts`
- `src/domain/ocr/extraction.ts`
- `tests/unit/fixtures/settings-operation-fixtures.ts`
- `tests/unit/fixtures/settings-runtime-corruption-fixtures.ts`
- `tests/unit/helpers/settings-backup-fixture.ts`
- `tests/parity/helpers/fixture-day.ts`
- `tests/parity/helpers/seeded-bff.ts`

The prerequisite additionally creates/extracts and verifies the complete production path sets of
P, D, G, S in their C0 allocations, then freezes them before those peers start.
It owns affected `docs/rebuild/guard-inventory.json`, generated outputs via their registered generators,
and shared fixtures actually named above. Existing fixture changes outside this manifest require
a scoped prerequisite amendment before release; peers may add only their own fixtures.

### Required focused selectors

- `tests/unit/intake-session.test.ts`
- `tests/unit/intake-command-arms.test.ts`
- `tests/unit/intake-validation.test.ts`
- `tests/unit/server/intake-surface.test.ts`
- `tests/unit/ocr-extraction-admission.test.ts`
- `tests/unit/ocr-command.test.ts`
- `tests/unit/provider-admission.test.ts`
- `tests/unit/diagnostic-capture.test.ts`
- `tests/unit/evidence-receipt-repository.test.ts`
- `tests/unit/operator-xlsx-export.test.ts`
- `tests/unit/storage-upgrade.test.ts`
- `tests/unit/storage-backup.test.ts`
- `tests/unit/storage-restore-drill.test.ts`
- `tests/unit/database-foundation/baseline-contracts.test.ts` (new required test)
- `tests/unit/database-foundation/four-way-independence.test.ts` (new required test)

Run the explicit owned unit paths using `VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1`,
`npm run lint`, affected architecture selectors under `--project architecture --maxWorkers=1`,
affected supported generators and freshness checks, and `git diff --check`. Validate populated
migration/recovery inputs before release; independent-connection race tests use separate database
connections even with one file worker. All retained heavy proof remains due at 2.6.9.

Each peer must implement and pass its full assigned focused proof on this baseline alone. Verify
the production call paths and test the common contracts with each peer capability independently,
then both orders of every pair using independent fixture instances. A textual merge alone proves
nothing about counts, file custody, configuration or rollback. At peer consumption the next named
prerequisite rechecks both orders with actual candidates and owns all combination fixes.

Record baseline SHA/tree, exported type/method contracts, migration fingerprints, exact generated
inputs, fixture paths and focused test exits before release. No inherited source proof is silently
waived. A common API that remains unimplemented blocks the entire dependent peer group.

### Direct consumer closure additions

The current symbol/import inspection additionally assigns these transitive consumers to this
sequential owner. Historical-only matches retain versioned compatibility rather than blind renaming.

- `src/base/artifacts.ts`
- `src/base/providers.ts`
- `src/dashboard/surfaces/intake.tsx`
- `src/domain/dashboard/artifacts.ts`
- `src/domain/dashboard/xlsx-export.ts`
- `src/domain/ocr/extraction.ts`
- `src/domain/trust/knowledge-projection.ts`
- `src/domain/workflow/artifact-projection.ts`
- `src/server/dashboard/commands/intake-service.ts`
- `src/server/dashboard/compose/data.ts`
- `src/server/dashboard/exports/operator-xlsx-workbook.ts`
- `src/server/dashboard/routes/data.ts`
- `src/services/trust/knowledge-service.ts`
