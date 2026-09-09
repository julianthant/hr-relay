# F · Shared database/domain foundation

**Current execution owner:** [Approved F01–F07 brief](#approved-execution-brief--2026-09-09).
The operator approved it on 2026-09-09, including local master merge and owned cleanup after
focused PASS. It supersedes this file's historical A/B names, prerequisite/master barriers,
per-task full gates/review and old release wording. Product scope and proof allocations below
remain binding. F is 2.6.6; C is already integrated; no implementation is claimed by this plan.

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

## Approved execution brief — 2026-09-09

The operator approved the complete F01–F07 proposal in this planning session and explicitly
required merge and cleanup at the end, with full gates at the end of Phase 2.6, not here.
This is one sequential Astra/high supervisor assignment with zero implementation workers and
zero task-local reviewers. Shared migrations, transaction interfaces, composition and integration
are coupled and stay with that supervisor. No children are dispatched. Fresh complete independent
read-only `sup_review` on Astra/high and full acceptance belong to 2.6.9.

### Binding and source admission

| Binding | Approved value / required verification |
| --- | --- |
| Task and owner | 2.6.6 F; this section owns execution, current state, evidence and delivery assessment. The prerequisite card and registry link here. |
| Inspected source | Clean master `977805e200a2788b2ba8d2d75854d7346b32329b`; schema 41, upgrade floor 40. Source/test/script/package/config inputs match C's tested candidate `89d167332e3eebe99519adc85f92607e9dbef1e8`. |
| Required ancestry | C master integration `0dd02a89056bd4ccec1a2089bacd8bd7f6cf2645`, with R/C0/T ancestry; consume [C's scoped release and cleanup](run-completion.md#c-scoped-release-and-local-integration--2026-09-09). C's removed branch/worktree is not required. |
| Implementation base | The verified master commit returned by the planner containing both the exact approved-plan commit and C's repaired release described below. Verify both ancestries and the committed owner before edits. If repair integration is still pending, F is WAITING ON it; never start from the known-defective earlier C release. |
| Creation mode | Create `codex/database-foundation` at `/Users/julianhein/Projects/hr-worktree-database-foundation` from the verified implementation base containing both the approved plan and repaired C release. The original reusable lane became C-owned again during persistence; this dedicated F path and ref are absent. Recheck capacity, ownership and availability. Never reset a colliding ref or reuse another task's checkout. |
| Integration | The same supervisor merges locally into `master` in `/Users/julianhein/Projects/hr-automation-rebuild` after committed focused PASS and baseline release proof, preferably with `--no-ff`. Recheck target state/ownership; fix in-scope integration defects and repeat invalidated checks. |
| Release | A merged scoped development release with retained candidate/integration/tree identities, proof and cleanup receipt. P/D/G/S all consume its same pinned integrated release. Phase 2.6 acceptance stays open. |

**Prerequisite correction discovered during persistence.** C was reopened to fix schema39 → 41
conversion: migration 40 used the current run parser before migration 41 adds completion.
C owns repair candidate `47a64d33a6b20569a7e3598e74463694bc8c4c9d` and its success/failure
regressions in `tests/unit/run-completion-migration.test.ts`. The planner inspected the diff;
C must pass its focused checks and integrate the repair before F becomes READY. Resolve C's
actual repaired integration and evidence at its existing owner; do not adopt a pending candidate,
reimplement the fix, or require the old reusable checkout to be available. This prerequisite repair
and safe checkout correction preserve approved product scope and require no new operator decision.
F retains the historical schema39/40 → current conversion tests in its focused regression set.

Planning inspected code and retained C evidence; it did not run product proof or inspect/upgrade
an operator database. F's migration/recovery targets are populated synthetic roots and historical
fixtures. No actual-target application is assigned. Preserve supported historical formats and
released fingerprints; choose appended migration versions from the reverified base at execution.

### Scope and ownership

Retain the [C0 F allocation](#c0-prerequisite-allocation--266-f), its prerequisite-owned shared
paths, [direct consumers](#direct-consumer-closure-additions), and [foundation proof allocation](#b-proof-allocation).
F owns those shared schemas, registries, repositories, recovery/deletion, command/wire unions,
composition roots, shared fixtures, guards and affected generated inputs. It creates/extracts and
reconnects the exact child production paths before freezing them:

- [P allocation](provider-usage.md#c0-execution-allocation--2661-p): provider-accounting storage and real legacy provider admission.
- [D allocation](diagnostics.md#c0-execution-allocation--2662-d): annotation storage, command/query/capture contracts and diagnostic composition, retaining functional capture/readback.
- [G allocation](artifacts.md#c0-execution-allocation--2663-g): generated-artifact storage/projection and export factory with working existing output behavior.
- [S allocation](decisions.md#c0-execution-allocation--2664-s): settings activation storage, run-settings, run-claim-admission, run-resources and settings/start/query callers.

The child allocations describe future changing paths; F may edit them now to finish the baseline.
After F release each child edits only its own frozen set, tests and authored evidence. No child
may need a sibling's API, migrations, root wiring, common fixture or generated source. F records
the actual file/export/caller/test manifest and pairwise intersections before releasing the group.
Additional shared fixture ownership beyond the admitted manifest requires a scoped amendment.

Authored execution evidence stays here. F may update the existing prerequisite, registry, parent
phase and combined README pointers, roadmap source, affected owner contracts/decision pointers and
guard inventory, and regenerate their registered outputs. Contract updates describe this approved
scope; they do not redesign other authorities. Generator outputs are never hand edited. Instruction
pairs change only if their rules change, with both existing twins kept identical.

### Feasibility and required proof

| Inspected mechanism / risk | Required change and acceptance |
| --- | --- |
| `authority-database.ts` owns nested authority transactions, dirty-generation tracking and most repositories. Extracting a method can accidentally commit part of an outer command. | F supplies strict typed transaction ports preserving the actual SQLite transaction and generation/integrity behavior. Inject repository/audit/event failure inside composed commands and prove complete rollback, including checkpoint/output writes. No raw-SQL escape hatch or unused factory counts as a released interface. |
| Intake uses `intakeSessions` plus immutable `intakeManifests`; command-kernel freezes the manifest, creates runs and updates the session together. | One imported row retains verified old IDs and frozen submitted content. Preserve distinct same-byte imports, historical manifest-only records, active upload reuse, command/run origins and immutable digests. Missing/conflicting linkage refuses atomically; exact replay returns the same fan-out. Complete artifacts P1–P3 and relevant P8 here. |
| Executor commits checkpoint plus artifact-outbox entries; separate sink heads track publication. XLSX service verifies stored bytes before recording export evidence. | Move queue/head/export evidence into generated-artifact rows while preserving identities and current working output/download behavior. Prove ordered distinct updates, CAS, rollback and immutable historical references with independent connections; do not expose a weaker writer while G is pending. F owns P4 storage and P7/P8 conversion; G owns remaining publication/file-fault P4–P6/P8. |
| Provider admission combines reservations with capability counters and snapshot-bound execution. | Supply final strict provider request/usage schemas and callable baseline repository, honest legacy attribution/coverage, deletion and backup conversion. Existing admission/replay/quota behavior must work through P's module. P later implements generic accounting; F must not fabricate key/model attribution or reset usage. Preserve provider P1/P5/P6 migration/baseline allocation. |
| Diagnostic evidence and immutable failures coexist with knowledge/fix authority and historical pins. | Consume R/C names; supply separate resolution storage and capture contracts, preserve failure/receipt bytes and pins, and remove retired live authority only with verified historical preservation. Historical unresolved state is explicit. D's action capability stays unavailable until implemented; capture/readback remains usable. Preserve diagnostic P1/P2 and storage P6. |
| Settings still read `settingsCurrent` and a boot-selected `runtimeConfig`; worker composition captures an active identity. | Consolidate physical authority into `app_settings` plus retained `settings_snapshots`; preserve bootstrap, replay, audit and current working behavior. Extract all real save/create/claim/resource paths so S can implement activation without changing shared files or P. Separate ownership fencing from configuration selection. F does not claim S's no-restart behavior complete. |
| SQL spans/gates/notes and OCR placeholders have storage scaffolding; durable gate answers use checkpoints, and timeline/log files have separate readers. | Remove only approved unused scaffolding with absence and retained-consumer proof. Unknown authoritative population blocks conversion for classification. Nonempty knowledge/fix history requires verified source-bound preservation; missing/mismatched backup refuses before destructive retirement. Preserve logs, timeline events, historical spans, gate resumption, future OCR dispatch requirements and live-read results. |

Authority remains with the linked [artifact/approval contract](../../../../reference/data-intake-and-edit-data.md#c0-artifact-and-approval-continuity--2026-09-09),
[settings contract](../../../../reference/clock-config-secrets.md#c0-settings-activation-and-recovery--2026-09-09),
[execution contract](../../../../reference/execution-and-sessions.md#c0-mixed-snapshot-execution-and-completion--2026-09-09),
[retirement contract](../../../../reference/dashboard-surfaces.md#c0-archive-summary-and-surface-contract--2026-09-09)
and [evidence contract](../../../../reference/operator-trust.md#c0-archived-evidence-and-privacy--2026-09-09).
The domain owners retain their complete proof tables; the rows above allocate rather than replace them.

### Ordered execution and early negative controls

1. **F01 — Admit baseline.** Recheck the approved commit, C ancestry, schema/floor, clean isolated
   branch and existing ownership. Preserve migration bytes and pin populated historical fixtures,
   accepted command/replay identities and immutable archive/receipt inputs before conversion.
2. **F02 — Shared storage.** Append complete schemas/migrations, strict historical adapters,
   repositories and transaction ports. Extend integrity, deletion, backup/restore and conversion
   registries together. Prove transaction rollback and schema/history identity at this first stable boundary.
3. **F03 — Imports and outputs.** Finish the one-row imported/extracted scope and generated
   queue/head/XLSX conversion. Reconnect current submission, replay, exports and checkpoint output.
   Prove atomic fan-out, old-ID lookup, immutable sources, ordered updates and rollback before moving on.
4. **F04 — Safe retirement.** Retire approved unused projections/placeholders and knowledge/fix
   runtime authority with verified historical preservation. Prove gate/log/timeline/diagnostic
   continuity and refusal of missing, contradictory or unclassified preservation inputs.
5. **F05 — Four working boundaries.** Finish P/D/G/S modules, shared callers, unions, factories,
   fixtures and generated inputs. Route actual provider, diagnostic, export and settings/run flows
   through them. Freeze exact API/test/file ownership. Preserve current settings behavior while
   leaving S its complete selection/claim/resource policy; no placeholder success or exposed action.
6. **F06 — Release proof.** Run all assigned focused proof on the frozen candidate, including
   populated mixed-domain conversion, pre/postcommit interruption, exact resume/no-write repeat,
   backup/restore, historical replay, deletion, pins, protected references and composed baselines.
   For six pairs P/D, P/G, P/S, D/G, D/S and G/S, test each boundary independently and both orders
   against real baseline contracts with independent fixtures. This is baseline independence proof,
   not a claim to have tested nonexistent future implementations. L rechecks actual candidate
   combinations; 2.6.9 retains final peer-order and complete acceptance proof.
7. **F07 — Merge and cleanup.** Commit logical categories using exact staged paths, preserve the
   tested candidate and integrate locally after focused PASS. Repair in-scope integration defects,
   rerun invalidated proof, preserve evidence and remove only F's owned resources. Record a single
   integrated release for all four children, with their unresolved implementation/full-phase duties.

For migration tests, a valid preserved historical fixture must succeed; missing/mismatched backup
and contradictory import links must fail without partial conversion. After interrupted commit,
exact resume verifies durable facts while changed input refuses. For commands, wrong/stale identity
and failure at audit/event/repository writes leave no partial submission or checkpoint output;
exact accepted replay remains unchanged after restart. For generated outputs, concurrent enqueue
cannot disappear when another update is acknowledged, and stale/head-conflicting publication
cannot produce a successful download. Positive controls must reach the intended boundary so these
negative cases cannot pass merely through unrelated setup failure. Retain UNKNOWN-submit refusal,
worker/claim fencing, old command fingerprints and immutable failure/completion/receipt/archive facts.

### Focused gate schedule

Run the [required unit selectors](#required-focused-selectors), including the two new meaningful
database-foundation tests. Add directly affected existing/new tests within F's owned seams; record
exact selectors and replacement provenance if a retired module moves. Empty selectors are failures.
Use one effective Vitest file worker, verified from resolved configuration or observed processes,
and independent database connections for race cases. The batch ceiling remains four workers.

```sh
VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/intake-session.test.ts tests/unit/intake-command-arms.test.ts tests/unit/intake-validation.test.ts tests/unit/server/intake-surface.test.ts tests/unit/ocr-extraction-admission.test.ts tests/unit/ocr-command.test.ts tests/unit/provider-admission.test.ts tests/unit/diagnostic-capture.test.ts tests/unit/evidence-receipt-repository.test.ts tests/unit/operator-xlsx-export.test.ts tests/unit/storage-upgrade.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts tests/unit/run-completion-migration.test.ts tests/unit/database-foundation/baseline-contracts.test.ts tests/unit/database-foundation/four-way-independence.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/storage-recovery.test.ts tests/unit/architecture/sqlite-settings-authority.test.ts tests/unit/architecture/provider-capability-boundary.test.ts tests/unit/architecture/artifact-effect-boundary.test.ts tests/unit/architecture/redaction-surface-scan.test.ts tests/unit/architecture/strict-boundary-schemas.test.ts tests/unit/architecture/guard-manifest.test.ts
npm run lint
npm run test:parity -- tests/parity/dashboard-reference.spec.ts --grep 'intake-|settings|loaded storage doctor|diagnostic-'
npm run test:parity -- tests/parity/intake-accessibility.spec.ts
git diff --check
```

Use `/ui`'s unchanged-rendering route locally for wiring: preserve values, reference identity,
DOM/copy/styles, accessibility and loading/error behavior. Run the filtered existing affected
states above; add exact existing diagnostic cases if the baseline selector does not cover a changed
consumer. Inspect any failure rather than refreezing or weakening it. A visible/interaction change
requires the relevant UI verification route and an amendment if outside approved scope. A build
needed by the focused harness is setup, not the full phase build gate. Broad parity remains 2.6.9.

At the earliest stable F02–F05 boundary run the relevant subset and neighboring negative controls.
Before release rerun the complete affected focused set on the committed candidate; lint and focused
failures cannot be deferred as PASS. Run affected `npm run build:manifest`, `npm run stores:catalog`
and `npm run roadmap` before their corresponding `:check` commands. Record any generator exclusion
with unchanged input evidence. Serialize mutations of the same generated/parity outputs. Use only
owned synthetic roots; retain command/exits, effective workers, logs and tested input objects/tree.

After integration changes, repeat invalidated focused/lint/freshness checks. Reuse unchanged checks
only with explicit comparison of their code/test/config/dependency and other inputs under D191.
Documentation-only recording runs roadmap binding, local links/anchors, instruction-pair/chain,
affected generation/freshness and whitespace checks; reuse unaffected lint by input identity.

Do not run full typecheck/coverage, whole architecture, broad parity/build/performance or independent
review here. 2.6.9 owns those plus complete migration/recovery/scenario/concurrency/redaction and
production-route acceptance, repairs and fresh complete read-only review. Keep T's incomplete
reviews and measured performance failures (day statements 5,574 > 5,569; archive freeze 3,234 > 13)
recorded there; they are not green and are not new F gates. Preserve floors, assertions, membership,
isolation, deadlines and all inherited proof obligations.

### Integration, cleanup and stop conditions

F-specific master merge/cleanup permission supersedes generic retained-candidate/no-master wording
in this folder. It does not waive focused gates or claim final acceptance. Verify target HEAD,
cleanliness, exclusive mutation access, candidate identity and mergeability before integration.
Changed target input requires relevant reconciliation/proof; never overwrite unrelated work.
Routine in-scope fixes remain with F. Stop dependent release for a changed prerequisite, unresolved
ownership, missing common mechanism, historical incompatibility or material scope/contract choice.

No live database upgrade, HR submit, provider/key activation, automatic child dispatch, new OCR
dispatcher, archive transfer, run summaries, alternate authority, dual write, retention redesign,
push or unrelated cleanup is assigned. P owns generic accounting, D live resolution actions, G
remaining publication behavior and S activation without restart; F supplies their working baseline.
Historical renames and C completion are consumed, not repeated or weakened.

Before deleting the checkout, preserve ignored proof/logs and hashes outside it. Verify the candidate
is incorporated into master, stop only owned processes, and move to the safe primary checkout.
Remove only `/Users/julianhein/Projects/hr-worktree-database-foundation` when it is verified F-owned,
then delete its integrated `codex/database-foundation` branch. Verify registered/physical/ref absence
and clean final master. Retain candidate/integration/tree identities, exact changed paths, contract
versions, test/exits, evidence location, cleanup receipt and the common integrated F prerequisite.
The [registry](PROMPTS.md#binding-registry) gives P/D/G/S distinct paths; they stay unlaunched.

Send Done / Now / Remaining at start/resume and after each verified F01–F07 completion before the
next tool call. Keep integration, cleanup and final-phase deferred review/gates visible. Update
current state here; use `/handoff` only for unique interrupted state. Stop after F's merged scoped
release and cleanup; the operator opens subsequent tasks.

### Planning verification and handoff

Operator approval was received on 2026-09-09. Persistence changes only the approved F execution
brief, its shared registry/status pointers, the roadmap/D191 merge exception and generated roadmap.
The F checkout was rebound to an absent dedicated path when C reopened the old lane; no checkout
was created by planning. C's newly discovered historical-upgrade defect is an explicit start
prerequisite, not work silently passed to F. Planning makes no runtime/phase-acceptance claim.

| Planning check | Evidence |
| --- | --- |
| Roadmap binding | `VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/roadmap-doc-binding.test.ts`: PASS, 1 file / 24 tests, exit 0; `/tmp/database-foundation-plan-binding.log`. Repeat after final recording changes and check the committed plan. |
| Lint | `npm run lint`: PASS, exit 0; `/tmp/database-foundation-plan-lint.log`. All F planning changes are outside lint inputs; compare input objects before reuse after another task integrates. |
| Roadmap generation/freshness | `npm run roadmap` and `npm run roadmap:check`: PASS, exit 0; `/tmp/database-foundation-plan-roadmap.log` and `/tmp/database-foundation-plan-freshness.log`. Regenerate after final evidence edits. |
| Links/instructions | 177 local links/anchors resolved, nine existing instruction pairs byte-identical, maximum project instruction chain 17,333 UTF-8 bytes; `/tmp/database-foundation-plan-doccheck.py` reproduces checks for changed or committed paths. |
| Focused selector preflight | All existing named unit/architecture/parity selectors exist; only the two expressly assigned database-foundation tests are new. No product tests were run by planning. |
| Scope/whitespace | `git diff --check` passes; exact staged paths are documentation/generated roadmap only. Verify the final committed owner against all approved F01–F07 controls before handing off. |

The outgoing handoff identifies the exact approved-plan commit and implementation base separately
when necessary. READY requires both the committed plan/document checks and C's repaired focused
release integrated in that base. Until the latter is verified, status is WAITING ON C's repair.
The supervisor rechecks volatile ownership and refs before creation; absent planned refs are normal.

## F execution record — 2026-09-09

**State: F01–F05 complete; candidate freezing for F06.** F07 integration and cleanup remain pending.
One Astra/high supervisor, zero workers and zero reviewers. This is the approved focused
foundation release; full acceptance and independent review remain assigned to 2.6.9.

### Admission and preserved inputs

Approved plan `b5ba39efbca023b673be3c4aac509ca42b2a751c`; exact implementation base
`4037b6b38395b77d3bcb71d2ccc99954da7d733f`; repaired C prerequisite
`e43a8d8515486c73c276fa319bbe06d196b309e3`. Both prerequisite commits are ancestors of the base.
The clean exclusive branch `codex/database-foundation` was created at that base in
`/Users/julianhein/Projects/hr-worktree-database-foundation`; master was clean at admission.
The original migration literals through schema41, floor40 and populated C fixtures were copied
and hashed before edits. External proof root:
`/Users/julianhein/Projects/hr-database-foundation-evidence-20260909` (`baseline.json`, `baseline/`).

### Supplied storage and transaction contracts

Current schema is **47**, supported floor **46**. Append-only migrations 42–47 retain every
released literal through 41. Historical backups 1–18 and 27–46 remain admitted by their existing
strict grammars; stopped upgrades use verified native backups and synthetic tests only here.

| Migration | Supplied authority / preservation |
| --- | --- |
| 42 | `imported_artifacts` owns preparation and submitted JSON with verified old session/manifest aliases, immutable submission and manifest-only history. Equal source hashes remain distinct imports. `extracted_artifacts` owns former OCR extraction rows. |
| 43 | `provider_requests` / `provider_usage` preserve legacy request/counter JSON, reservations and honest historical gaps. Strict generic storage carries attribution, leases, usage states and CAS without activating generic policy. Cumulative usage never disappears with run deletion. |
| 44 | `app_settings` consolidates saved and active identities, journal/audit linkage and snapshot references. `settings_snapshots` remains immutable. Current saves still require restart. |
| 45 | Failure annotations have independent strict JSON/version and CAS. Original failure JSON, diagnostic bundles, receipts and archive digests remain immutable; historical annotations are explicitly unresolved. |
| 46 | `generated_artifacts` consolidates ordered pending updates, head/version references and XLSX evidence. Exact old nested export JSON plus its digest is retained; issued evidence/version prefixes cannot change. No parallel live output authority remains. |
| 47 | Retires unused SQL spans/gates/notes/OCR approval placeholders only when empty; nonempty unknown population refuses. Knowledge/fix history requires complete source-bound native backup comparison before retirement. Historical schema adapters remain supported. |

Generated conversion accepts explicit `cli storage upgrade --generated-from <source>` input;
this session did not run it against operator data. Source mapping/files are checked for exact
identity, hashes, size and symlinks, copied immutably beneath the verified backup and rechecked
before commit. Missing historical export bytes become explicit unavailable evidence, never a
fabricated reference. Exact repeat compares the preserved selection, so conversion cannot adopt
its own newly installed copy as old evidence. Precommit rollback, postcommit resume, changed-source
refusal and restoration from the same source-bound backup are covered in `mixed-history.test.ts`.

All repositories participate in the owning SQLite transaction through typed `mutate` /
`withAuthorityTransaction` ports. Nested writes retain one generation/integrity boundary.
`commitGeneratedCheckpoint` commits checkpoint and all output updates together. Independent
connections prove enqueue/ack order and stale CAS refusal; immutable file evidence remains retained.
No public raw-SQL callback, alternate database, dual write or retired runtime knowledge door is supplied.

### Frozen four-child API and caller manifest

Shared strict schemas in `src/domain/`, `src/base/provider-accounting.ts`, migrations, authority
registration, command unions, composition roots and F fixtures are frozen prerequisite inputs.
Children may consume these inputs; changing them requires a prerequisite amendment. The following
existing production entry points are connected, not unused promises:

| Child | Released exports / methods | Actual callers and baseline |
| --- | --- | --- |
| P | `SqliteProviderAccounting`, `finalizeProviderRun`; legacy admission methods and `accounting()`; `ProviderAccountingStorage.transaction/getRequest/getUsage/listUsage/writeRequest/writeUsage` | Authority composition creates one component; admitted clients, executor and worker resources route through it. Legacy reserve/invoke/settle/replay remains working. Generic policy is P's remaining work. |
| D | `createFailureResolutionRepository.read/update`; `failureResolutionCapability`, `executeFailureResolution`, `bindFailureCapture`; query/command factories and `composeFailureResolution` | Command kernel dispatch and dashboard compose use D's port; receipt/trust reads and run capture use D's boundary. Action capability is unavailable and refuses before journal/audit writes. D owns future action/UI behavior. |
| G | `createGeneratedArtifactRepository` (`generatedArtifacts`, existing outbox/head/export ports); `commitGeneratedCheckpoint`, `projectGeneratedUpdates`; `composeGeneratedExports` | Executor commits outputs; real XLSX sink/projector publishes through ordered repository ports; dashboard export factory serves the existing verified export path. G owns remaining publication/fault policy. |
| S | `createSettingsActivationRepositories`; `selectRunRuntime`, `selectRunSettings`, `selectNewRunIdentity`, `runSettingsAvailable`; `runRuntimeMatches`; `createRunResourcesFactory.baseline/forRun` | Settings service, direct/intake/start/relaunch creation, claim checks and worker composition use S's ports. Actual retained snapshots select session factories, browser mode, deadlines and providers. Idle settings are read at the next idle boundary. S owns no-restart activation and new retry/child selection. |

Ordinary settings command results already admit strict `restartRequired: false` while the real
baseline explicitly returns true. Protected settings retain their separate contract. Start-plan
selection stays inside its existing single transaction; replay does not recompute accepted plans.
Failure resolution data belongs to failures/read projections, not immutable diagnostic bundle JSON.

Exact exclusive mutable paths and tests follow. Existing shared fixtures remain F-owned; new child
fixtures live beside child tests. Future test filenames are allocations, not claimed passing tests.

**P production paths (2).**

- `src/infra/sqlite/provider-accounting.ts`
- `src/core/provider-admission.ts`

**P test allocation.**

- `tests/unit/provider-admission.test.ts`
- `tests/unit/provider-pool.test.ts`
- `tests/unit/advisory-provider-exhaustion.test.ts`
- `tests/unit/provider-accounting/accounting.test.ts`

**D production paths (8).**

- `src/core/failure-resolution.ts`
- `src/infra/sqlite/failure-resolution.ts`
- `src/server/dashboard/queries/failure-resolution.ts`
- `src/server/dashboard/commands/failure-resolution.ts`
- `src/server/dashboard/compose/failure-resolution.ts`
- `src/server/dashboard/queries/run-trust.ts`
- `src/dashboard/surfaces/trust.tsx`
- `src/dashboard/surfaces/trust-model.ts`

**D test allocation.**

- `tests/unit/failure-resolution/commands.test.ts`
- `tests/unit/failure-resolution/capture.test.ts`
- `tests/unit/dashboard/failure-record-render.test.ts`
- `tests/unit/dashboard/failure-record-model.test.ts`

**G production paths (6).**

- `src/core/generated-artifact-projection.ts`
- `src/infra/sqlite/generated-artifacts.ts`
- `src/infra/artifacts/artifact-sink-projector.ts`
- `src/infra/artifacts/xlsx-retention-sink.ts`
- `src/server/dashboard/exports/operator-xlsx-export-service.ts`
- `src/server/dashboard/compose/generated-exports.ts`

**G test allocation.**

- `tests/unit/artifact-projection.test.ts`
- `tests/unit/infra/server-verified-artifact-reader.test.ts`
- `tests/unit/operator-xlsx-export.test.ts`
- `tests/unit/server/operator-xlsx-export-service.test.ts`
- `tests/unit/generated-artifacts/publication.test.ts`

**S production paths (11).**

- `src/infra/sqlite/settings-activation.ts`
- `src/core/run-settings.ts`
- `src/core/run-claim-admission.ts`
- `src/server/worker/run-resources.ts`
- `src/server/settings-runtime.ts`
- `src/server/dashboard/commands/settings-service.ts`
- `src/server/dashboard/commands/start-plan-service.ts`
- `src/server/dashboard/queries/settings.ts`
- `src/server/dashboard/queries/settings-editor.ts`
- `src/dashboard/surfaces/settings.tsx`
- `src/dashboard/surfaces/settings-model.ts`

**S test allocation.**

- `tests/unit/settings-activation/save-create.test.ts`
- `tests/unit/settings-activation/mixed-execution.test.ts`
- `tests/unit/settings-activation/retry-child.test.ts`
- `tests/unit/settings-activation/stale-plan.test.ts`
- `tests/unit/server/settings-runtime-reader.test.ts`
- `tests/unit/server/settings-facts.test.ts`
- `tests/unit/dashboard/settings-editor-surface.test.ts`
- `tests/unit/dashboard/settings-editor-client.test.ts`

D also owns its new dedicated desktop resolution parity case and references; shared existing
parity fixtures and reference images remain frozen. The 27 production paths have zero pairwise
intersection. Child test sets also have zero intersection. Source checks reject imports of another
child's mutable implementation; stable shared contracts and composition remain F-owned.

| Pair | First then second | Second then first | Isolated baseline |
| --- | --- | --- | --- |
| P / D | PASS | PASS | Real provider admission + diagnostic capture/readback |
| P / G | PASS | PASS | Real provider admission + actual XLSX projection |
| P / S | PASS | PASS | Real provider admission + retained settings/resources |
| D / G | PASS | PASS | Real capture/readback + actual XLSX projection |
| D / S | PASS | PASS | Real capture/readback + retained settings/resources |
| G / S | PASS | PASS | Actual XLSX projection + retained settings/resources |

Each order gets a fresh synthetic database and artifact/lock root. No browser, provider account,
credential or HR transaction is used. The resource case additionally switches two actual retained
snapshots and verifies the first run keeps its factory/values. These are baseline independence
proofs, not results for future implementations. L and 2.6.9 retain combination and final peer-order proof.

### Focused proof and delivery assessment

The complete committed F06 rerun and F07 receipt are recorded below when verified. Interim logs
remain in the external proof root, including failures and their repairs; they are not release PASS.
The F proof files are `baseline-contracts.test.ts`, `mixed-history.test.ts`,
`transaction-contracts.test.ts` and `four-way-independence.test.ts` beneath
`tests/unit/database-foundation/`; adjacent `fixtures.ts` / `import-fixtures.ts` are F-owned.

Material repair rounds were implementation defects within the approved brief: restored overbroad
historical-source removal; preserved nested export strings/digests; corrected current-versus-historical
fixture membership; removed cyclic storage/type imports; fixed repeat conversion adopting its own
artifact copy; and kept resolution outside immutable diagnostic JSON. Retained logs distinguish
these failed runs from the final rerun. Exact total repair count/time is unavailable across context
compactions; no estimated savings or quality score is claimed. No worker reassignment or operator
scope expansion occurred. Earlier reads of boundary constraints and explicit source-versus-installed
artifact negative controls would have prevented some rework.

Necessary fixture closure includes `tests/unit/server/start-plan-omissions.test.ts` inserting its
real immutable snapshot while retaining transaction/ID assertions, and
`tests/parity/intake-accessibility.spec.ts` attaching the existing required body-backed accessibility
evidence and digest. The latter's first run passed its four cases but correctly failed wrapper evidence
admission; the repaired wrapper passes without reference, DOM or assertion changes. Guard changes
preserve historical knowledge/fix proofs and pins, replacing only retired live-door assertions with
absence checks. Guard inventory records the extraction/retirement evidence; no coverage floor,
assertion, isolation or timeout was weakened.

The resource-only external `vitest-one.config.mts` spreads the repository configuration and sets
both root and every project `maxWorkers: 1`. `effective-workers.json` records forks/isolation and
unchanged membership. All committed unit/architecture selectors use this adapter; parity retains
its repository worker configuration. Mandatory committed reruns remain distinct from repair runs.
Full typecheck, coverage, whole architecture, broad parity/build/performance and independent review
were not run. They remain 2.6.9 duties, including inherited T incomplete reviews and measured
performance failures (5,574 > 5,569 day statements; 3,234 > 13 archive freeze statements).


The first committed expanded focused run found seven export-service failures (941 passed): its
raw SQL assertions still addressed the retired export table. Updating those assertions exposed a
real replacement bypass, repaired with explicit BEFORE INSERT conflict guards for generated,
imported and provider identities/accounting even when recursive triggers are disabled. Historical
migration pins through41 remain unchanged; only unreleased F migration pins were refreshed.
The direct annotation rollback/CAS proof also required a valid terminal fixture. F fixtures now
use real claim/terminal transitions, with D on a separate run/worker in each paired scenario;
no invalid running-run failure row substitutes for the production lifecycle. The 30-case targeted
repair run passed; full committed focused rerun follows. These are implementation/fixture defects
within approved F scope, not changed product requirements. The export-service test is a necessary
closure of G's existing allocated baseline; it preserves every old assertion's purpose.
