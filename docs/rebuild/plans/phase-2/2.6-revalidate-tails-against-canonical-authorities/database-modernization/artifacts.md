# Imported, extracted and generated artifacts

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

> **Combined-plan amendment — 2026-09-09.** This file retains the approved product scope,
> acceptance proofs and historical inspection below. [The combined workflow](README.md) and
> [prerequisite releases](prerequisites.md) now exclusively own assignment IDs, dependencies,
> write-set allocation, candidate release, gates, review timing, integration and launch status.
> Earlier A/B/T1/T2/P/D/G execution allocations, per-unit full gates/reviews, master prerequisites
> and provider-owned integration below are superseded for this unlaunched batch. They are not
> alternate launch instructions. Every product proof remains required; heavy proof and independent
> review run in the final session. Existing in-flight timeline T1 keeps its own schedule.

## XLSX consolidation amendment — 2026-09-09

The operator approved storing XLSX exports in the already planned **generated_artifacts** table
(the managed created-output records), and removing `operator_xlsx_exports`. This supersedes the
earlier separate-export-receipt-table requirement. No `report_exports` table is introduced.
Every generated_artifacts row still represents one logical output file; export request/completion
metadata belongs to that file row, not to a second top-level row of another kind.

F owns the common schema, populated historical export conversion, table/registry retirement and
working baseline repository/service adaptation before G launches. G owns publication/verification
and current export lifecycle through that baseline. This keeps F and G sequential on shared files;
no peer needs G's unmerged code to use the F release. Retain all P6/P7/P8 proof below with the
single-row storage shape; finalization owns complete cross-domain/recovery proof.

## Archive-report amendment — 2026-09-08

This plan retains ownership of import/generated artifact identities, publication and retention.
Archive report references must resolve to exact verified versions, never a mutable latest output.
Before run-owned data is removed, required archive files acquire durable archive ownership or are
copied into verified archive storage. Live cleanup cannot prune those bytes; archive deletion cannot
remove versions still shared by live runs/imports or other archives. Extend P8 with both directions
of ownership transfer, missing/corrupt files, pending publication and backup/restore of archive files.
The archive owner orchestrates the transfer; do not add another archive database or export format here.

Archive design owner: [independent archive reports](decisions.md#approved-group-3-independent-archive-reports-and-no-relaunch).
This is a planning amendment. Preserve existing in-flight gate schedules, candidate evidence and
accepted work; it does not launch implementation or reschedule reviews. New launch readiness awaits
the complete revised allocation and verified prompts.

## Assignment and approval

**Current assignments: 2.6.6 F / 2.6.6.3 G.** This file owns its product requirements within the
[combined workflow](README.md). Implementation waits for C0 and the verified C/F development
release. Earlier side-work IDs are historical aliases only.

On 2026-09-08 the operator approved combining intake preparation and submission into one row,
explicitly rejecting draft rows and snapshot rows with different purposes. They requested that the
next related changes be combined with that work. Final names were selected as `imported_artifacts`,
`extracted_artifacts` and `generated_artifacts`; after the last name and its creation/update meaning
were explained, they said **“okay lets do that.”** This records the agreed storage design. Planning
persists documents only; it does not implement, activate workflows or convert the operator database.

Three product outcomes:

1. `intake_sessions` + `intake_manifests` become `imported_artifacts`: one row per import, editable
   during preparation and retaining its frozen submitted data after enqueue.
2. `ocr_extractions` becomes `extracted_artifacts`: one admitted structured extraction per document
   page/form identity, preserving existing validation and deduplication.
3. `artifact_outbox` + `artifact_sink_heads` become `generated_artifacts`: one row per logical
   output file, with pending work, current processing state and verified file-version references.
   Creation and subsequent updates use the same kind of record, not separate row types or tables.

The product sections retain T1/T2 labels for requirement/proof continuity. **Do not launch
`side/artifacts-1` separately:** its full scope is now implemented and reviewed in B. B also supplies
T2's physical storage, conversion and real adapters. T2 `side/artifacts-2` owns the filesystem/DB
publication and export behavior through those frozen seams. It can run independently alongside
provider accounting and diagnostic resolution after B; neither peer is its prerequisite.

Use [prerequisites](prerequisites.md) for the exact release and evidence allocation. Each peer
records progress only in its assigned owner/evidence file; shared plan edits belong to the
prerequisite or final owner. No shared implementation.md or peer-plan edits.

## Authorities and scope

- [Root instructions](../../../../../../AGENTS.md), [document routing](../../../../../README.md),
  [roadmap governance](../../../../../roadmap/roadmap.md), and
  [operating reference](../../../../../../.agents/skill-library/repository-work/REFERENCE.md).
- [Data intake and Edit Data: artifact storage model](../../../../reference/data-intake-and-edit-data.md#artifact-storage-model)
  owns the pending amendment to intake/extraction and D164's output-maintenance tables.
- [Dashboard surfaces: artifact storage model](../../../../reference/dashboard-surfaces.md#artifact-storage-model)
  owns unchanged intake behavior, command replay, generated-file/export presentation and diagnostics.
- The [combined execution plan](README.md) owns B, which provides diagnostic snapshot/file/receipt names
  and protection plus import/extraction and generated storage. Run completion and timeline T2 precede
  B. Diagnostic resolution and provider accounting are independent peers, not predecessors.
- [Task contract](../../../../reference/task-contract.md), [workflow model](../../../../reference/workflow-model.md),
  [operator trust](../../../../reference/operator-trust.md), [clock/config/secrets](../../../../reference/clock-config-secrets.md)
  D321/D322/D332, [frontend/backend integration](../../../../reference/frontend-backend-integration.md),
  and [guards and tests](../../../../reference/guards-and-tests.md) §3.14 D191 retain authority,
  protected evidence, upgrade/backup, commands, resource admission and gates.

B owns all T1 intake/extraction implementation, including commands, fan-out/origin references,
transitive readers and proof. B also owns T2 physical schema, strict low-level queue/CAS/receipts,
migration/source backups/integrity/retention, shared executor/export composition and pending counts.
G owns generated-file publication, writer and immutable-version verification, exact checkpoint update
consumption, and existing explicit XLSX export registration through B's real frozen interfaces.
Only G's enumerated production/tests and this plan/evidence may change in parallel; no shared
migration, IDs, global repository types, root composition or intake command edits. The [combined execution plan](README.md)
owns exact file lists and integration. Read nearest instructions and lessons before module edits.

Do not change workflow meaning, source coercion, sensitive-field rules, active-import reuse policy,
batch grouping/priority, run membership, retry, operation proof or UNKNOWN-submit safety. Do not
introduce PDF-to-intake automation, new OCR providers, real-key wiring, an I-9 workbook path/column
layout or activation of currently unwired descriptor projections. No new file-management UI, sync
service, automatic exports, new output format or general artifact garbage collector. Keep diagnostic
files as diagnostic relationships. Store export evidence on its generated_artifacts row;
retire operator_xlsx_exports after verified conversion, without a competing file head.
Internal screenshots/PDF raster intermediates are not automatically registered as managed
output files merely because they use the byte store. No replacement generic `artifacts`, file-update,
sink-state, import-draft or import-snapshot authority table. No live HR writes, push or cutover.

## Inspected mechanisms and target

Inspection base: `261111d1af16c431633a514c6e35f72aaf03c87e` on master. This is planning evidence,
not either unit's eventual implementation base. Existing worktrees remain peer-owned.

| Current mechanism | Consequence for this assignment |
| --- | --- |
| `domain/intake/session.ts` stores source artifact, worksheet/header, mappings, corrections, exclusions, validation read-time and a reserved manifest ID. Parsed rows are re-derived from immutable file bytes. | One import row retains those decisions; avoid another mutable copy of the spreadsheet. Preserve version checks and deterministic validation time. |
| `core/command-kernel.ts` enqueue freezes the manifest, creates all runs with intake origin, and marks the session enqueued in one transaction. | Update the same imported-artifact row with immutable submitted content and create runs atomically. Existing reserved IDs and issued command/run references must keep resolving. |
| `intake_manifests` predates `intake_sessions`; source-byte equality is not proof of the same import. Open-source lookup reuses an active session. | Migrate by explicit session/manifest linkage, never merge imports by file hash. Support old submitted manifests without a surviving draft as complete imports with explicitly absent preparation history. |
| `ocr_extractions` has UNIQUE `(source_sha256,source_page,form_type)` and strict admitted record validation. OCR CLI admission validates/returns records without DB persistence. | Rename without activating new producers or loosening page/form uniqueness. An extracted artifact is structured data, not necessarily another file. |
| `run-executor.ts` atomically commits checkpoint plus one or more per-record output updates, then blocks the node on their projection. Replay reuses checkpoints to find pending work. | Generated-file rows must retain every distinct update and its exact source, not just one mutable pending slot. Multiple workers updating one file cannot replace one another's intent. |
| `artifact_sink_heads` tracks one destination's last fingerprint/generation; the sink checks it before replacing a file and acknowledges head/update together afterward. | Move file head and update bookkeeping into the same generated-file row. Keep content-conflict protection and exclusive writer fencing. File and DB commits remain separate physical operations. |
| `content-addressed-artifact-writer.ts` stores immutable bytes under their digest and verifies references. Existing sink writes a mutable workbook without retaining every former workbook version. | Retain verified old/new file contents through the existing byte store before a managed update replaces the destination; current logical-file metadata can change without changing old artifact references. |
| No production descriptor/composition declares/wires the maintained-workbook projector. Its only sink is `xlsx-retention`. Existing operator XLSX export service does publish and verify immutable bytes and a separate export receipt. | Exercise maintained-file behavior through synthetic compositions; do not invent real workbook configuration. Register existing explicit XLSX outputs as generated files without changing export selection, headers or receipt identity. |

Read-only target observation at `2026-09-08T21:33:54.000875+00:00`:
`/Users/julianhein/Projects/hr-automation-rebuild/.tracker/state.db` had zero intake sessions,
intake manifests, OCR extractions, artifact outbox rows, sink heads and operator XLSX export rows.
Quick check `ok`; FK violations zero. This does not prove populated migration or filesystem recovery.
Required fixtures include old manifests without sessions, multiple pending updates, existing output
files, projected history, exports, archives and shared artifact references. No payload/secret was printed.

## T1 — imported and extracted artifacts

Each `imported_artifacts` row represents one import into a workflow. It retains source-file identity,
original filename when actually known, worksheet/header choice, mappings/constants, corrections,
exclusions, validation time/state and row version. Source bytes stay immutable in artifact storage.
Different imports may reference the same bytes. Preserve existing active-upload reuse and duplicate
warnings instead of creating new imports on every retry of the upload request.

The row progresses through preparation/validation/submission (and existing discard behavior). On
submission it acquires strict immutable submitted content containing the old manifest's exact source,
validated values/hashes, current per-row dispositions, rejection history and explicit exclusions.
The record remains the same row: there are no separate draft/snapshot rows distinguished by type.
Freeze submission and enqueue its runs in one database transaction, including required command/audit
and timeline facts. A failure at any point leaves no partially submitted import or partial fan-out.
Repeated exact command returns the original result/runs; a changed command identity refuses.

After submission, corrections require another import rather than editing frozen content. Existing
explicit rerun behavior over a frozen manifest remains its own admitted command behavior and cannot
silently append a new submission to the import. Preserve batch/run origin and links through the accepted
predecessor contracts. The row's source reference is always the exact file version used, never a lookup
of a generated file's current head. Old archive/input/replay fingerprints and protected projections stay valid.

Use a canonical import identity plus unique retained old session/manifest identifiers on the same row.
Old IDs are compatibility lookup keys, not competing authorities. Match only verified explicit links;
check both halves' workflow/source/reservation consistency. Unsubmitted sessions migrate without
submitted data; submitted pairs merge once. Historical manifest-only imports retain the full submitted
record with typed absence for unknown preparation facts; do not invent a filename, actor, mapping or
validation timestamp. An enqueued session missing its required manifest, conflicting links or ambiguous
identity collision refuses atomically. Preserve historical JSON/digests where existing readers cite them.

Rename `ocr_extractions` to `extracted_artifacts` with unchanged admitted page record IDs, schema,
source/provenance, unique document-page-form identity, conflict/replacement semantics and consumer results.
It need not reference an imported-artifact row: existing extraction may originate outside dashboard intake.
Do not manufacture links from filename similarity, introduce one row per arbitrary file or persist CLI
outputs automatically. Extraction-to-import automation remains later work.

T1 retires the three old physical tables and updates their current indexes/triggers/registrations and
read/write callers together. Supported legacy adapters may read historical layouts; no live dual-write
or permissive old-table fallback. Archive/deletion and receipts retain exact ownership/protected evidence.

## T2 — generated artifacts

One `generated_artifacts` row represents one logical managed output file. A maintained workbook keeps
its row across updates; each independent explicit export is its own output file. Filename alone is not
identity: bind an admitted output ID and destination scope so aliases cannot create two writers for the
same file. Store producer/source references, media type, processing state, current verified immutable
file reference/fingerprint, optimistic version/generation, pending updates and completion/history references.
Imported/extracted rows and output rows have distinct meanings; do not move a record between tables.

**Pending work lives in the file row.** Represent a strictly validated ordered collection of pending
update entries with immutable update identity, exact source checkpoint/export identity, schema/payload
fingerprint and required content reference. Keep independently identifiable completion receipts for
idempotency. An update is part of the file's bookkeeping, not a second kind of top-level row. Large
immutable content/history may use content-addressed manifests in existing artifact storage; no additional
SQL queue table. Define bounded metadata admission and fail before committing a checkpoint if an input
cannot fit; never truncate pending work or discard old replay evidence to meet a bound.

Each pending update is admitted once, transactionally with its producing checkpoint where applicable.
Use database-assigned per-file ordering and generation/version fencing; two writers cannot lose an entry
or acknowledge the other writer's work. Same checkpoint/spec/update identity and exact content replays;
divergent content refuses. A newer update to the same workbook record remains distinct from an old
completed update. Replaying an old checkpoint must not write its stale value over the newer one. Keep
stable row-key upsert semantics and exact update receipts across restart. Do not match pending work by
record key alone when different payload/source generations can legitimately share that key.

**State and fingerprint are separate.** A file may be pending/writing/ready/failed/conflict while its last
verified version remains available. Ready requires every admitted blocking update through the relevant
settled generation to be acknowledged. Completing one update cannot mark later queued updates done.
The current fingerprint changes only after the produced bytes are verified. A failed/conflicted update
retains its intent and does not erase the last good version or pretend that publication succeeded.

Before managed replacement, verify expected current destination bytes and preserve that verified version
in immutable artifact storage if not already retained. Generate/stage and verify the intended new version;
persist sufficient prepared identity for recovery, hold the exclusive destination writer lease, and apply
the existing durable temp/fsync/replace protocol. Set new current-version reference, update receipt and
pending state in one DB transaction afterward. Never mutate bytes under an existing artifact reference.
Old runs, imports, receipts and exports continue referencing their original version, regardless of the
logical file's current head. Retain historical version references; no automatic version pruning here.

SQLite cannot atomically replace an external workbook. Preserve fail-closed handling of an interrupted
write, missing expected file, unexpected existing file or external modification. In particular, after
file replacement but before acknowledgement, do not blindly retry/overwrite or declare success from
filename/time alone. Preserve the intended version and report a conflict unless exact durable ownership
and publication evidence prove safe reconciliation. The existing conservative conflict behavior is an
acceptable outcome. Do not add an automatic recovery policy, new parked-run state or external resubmit;
existing blocking projection failures remain structured node failures with durable work retained.

**Current consumers.** Adapt the existing executor projector seam and synthetic `xlsx-retention`
writer without activating an I-9 workflow or inventing workbook columns/paths. The existing explicit
XLSX service creates one generated_artifacts row in pending state for each admitted export identity.
That same row carries the requester/time, exact search snapshot or Activity selection, workbook
format/version and sheet/row metadata. Publish and verify immutable bytes, then atomically settle
that row to ready with its verified artifact reference, digest, length and download metadata.
Do not return a successful download before the persisted record and returned bytes agree.
Preserve authorization, protected fields, workbook content and download headers. Failed publication
retains truthful pending/failed state. Same identified request and payload replays on the same row;
divergent replay refuses. Separate explicit exports remain separate logical outputs even when
content-addressed bytes match. No second SQL export-receipt row or live dual write remains.
Export receipt IDs can be retained as unique compatibility identities on the same row; an issued
receipt's immutable fields/digest must not be rewritten. Managed-workbook update receipts remain
part of their own generated row's bounded bookkeeping. Do not automatically register diagnostic
attachments or extraction intermediates here.

**Historical conversion.** Group old output updates and head by their exact admitted destination/sink
identity, preserving each pending/completed update, stable key, source, payload, receipt ID and ordering.
Carry old IDs as explicit compatibility identities. Missing/contradictory ownership refuses; don't infer
one file per run or coalesce updates merely because their keys match. For populated old file heads,
verify the actual destination and capture its exact bytes into immutable artifact storage under a stopped,
backup-bound conversion. Old versions absent from retained evidence stay explicitly unavailable; do not
invent a full version history from a hash. A current populated head without verifiable matching bytes
blocks conversion instead of becoming a plausible ready record. A first-create pending file may have no
head or existing file, which is a distinct valid case.

Historical exports migrate one-for-one into generated_artifacts using their exact export identity,
request metadata, immutable receipt fields and retained verified artifact. Preserve existing download/
receipt references through unique compatibility lookup; never collapse independent exports by hash.
Missing bytes remain explicitly unavailable rather than falsely verified ready. Conflicting identity
or altered evidence refuses. Retire operator_xlsx_exports and its current registry/repository paths
only after complete conversion; supported historical readers retain the old layout deliberately.
Do not rewrite issued receipt JSON/digests or enumerate unrelated files from disk. No
historical generated-file row may claim its original creation time or producer was known if evidence
lacks it. Remove the two old live output tables and expose pending-update counts from the new authority
in Storage Doctor; count updates, not merely the number of files containing pending work.

Shared output files and byte versions may be referenced by several runs/imports. D308 deletion must
preserve other owners and pending work; source-run disappearance cannot silently cancel acknowledged
file effects or unreferenced-byte cleanup. Preserve current deletion policy, shared receipts and privacy
boundaries; do not introduce an artifact GC or new retroactive output scrubbing rule in this assignment.
The stopped migration must bind immutable copies of any external file bytes needed for restore to its
verified database backup/source manifest, following the timeline predecessor's source-preservation pattern.

## Work sequence, review and proof

1. **B/T1:** the shared foundation implements the complete one-row import/extraction scope,
   validates historical identity and frozen readers, and proves P1–P3 plus its P8 cases.
2. **B/T2 storage:** B implements final generated-file schema/queue methods, populated conversion,
   verified source preservation, legacy adapters and shared composition; prove storage P4/P7/P8.
3. **G admission:** verify B accepted release, immutable APIs/schema, exclusive exact paths,
   base and test resources. No provider or diagnostic-resolution peer input is required.
4. **G writer/export:** implement managed immutable publication, ordered/fenced checkpoint output
   consumption and existing explicit export registration. Prove P4–P6 and generated-output P8 on F alone.
5. **G acceptance:** full gates, frozen candidate and fresh independent review covering G plus
   its preserved import/extraction interactions; fix/re-review and return the compact handoff for
   operator-chosen integration, combined gates and cleanup. Do not claim all artifacts complete
   until both B's and G's proof allocations have accepted evidence.

| Proof | Required result and negative controls |
| --- | --- |
| P1 One import lifecycle | One row covers mapping, correction, exclusion, deterministic validation and submission. Re-upload reuses the existing active import under current rules. Submit is atomic with all runs/batch origins/commands/events; injected failures roll back fan-out and frozen data. Exact replay adds no runs; changed identity/version refuses. |
| P2 Historical import/extraction | Unsubmitted, validated, submitted pairs and old manifest-only records migrate with honest absence and unchanged IDs/digests. Conflicting linkage or missing required snapshot refuses. Same-byte separate imports stay separate. Extraction page/form uniqueness and producer validation remain identical without new persistence wiring. |
| P3 Frozen source and readers | Changing a later import or updating its logical source file cannot change earlier submitted values or their exact file version. Existing intake review/rerun, command history, run origins, receipts, archives and protected downloads remain correct. |
| P4 Concurrent output updates | Real independent connections admit distinct updates to one file without lost work. Exclusive writer fencing and ordered settlement hold. Exact checkpoint replay does not duplicate rows, drain unrelated updates or overwrite newer contents. Mutation during projection leaves newly queued work pending; record limits refuse before checkpoint commit. |
| P5 File/DB failure windows | Inject before/after staging, fsync, replace and DB acknowledgement. No false ready state, unsafe repeat or discarded intent. External edits, missing/headless files and stale writer generations yield distinct refusal/conflict. Original/current/intended bytes and old version refs remain verifiable. |
| P6 Generated history/export | One file row progresses pending to verified ready and survives later updates without changing old import/run/export references. Existing explicit XLSX exports keep request and completion evidence on one generated row and preserve selection, protected contents, receipt/digest/headers; byte/receipt/DB faults cannot return a successful inconsistent download. Independent exports remain independent; replay creates no duplicate row and no live operator_xlsx_exports table/reader/writer survives. |
| P7 Output migration/retirement | Populated pending/completed/mixed updates, existing heads and files, old exports and unavailable history have exact conversion outcomes. Required stopped file copies and DB backup are identity-bound; changed/missing sources refuse. Old output tables/current consumers retire and pending counts remain accurate. |
| P8 Upgrade/retention/compatibility | Fresh creation, supported old backups/upgrades, pre/postcommit interruption, exact resume, no-write repeat and full restore pass. D308/tombstones, shared file refs, diagnostics/pins, archive identity and schema/settings coupling remain correct. No new real provider/workflow activation. |

## Cross-stage proof allocation

F owns complete imported/extracted artifacts and shared migration/recovery proof; G owns generated
publication/update/export proof on F alone. Existing archive/retention behavior is tested on that
base. New archive.sqlite transfer, shared-file custody and post-transfer access consume G in L/A/H
and receive combined proof in 2.6.9; G must not require A's unmerged implementation.

## Execution ownership

Use [the combined workflow](README.md), [prerequisite releases](prerequisites.md) and
[launch registry](PROMPTS.md). One Astra/high supervisor owns this assignment; default zero
implementation workers. Shared migrations, composition and fixture work belongs to its prerequisite.
Return a committed development candidate after focused checks, lint and affected freshness; final
2.6.9 owns heavy gates, independent review, all remaining repairs and operator-assigned integration.
No per-peer review, master merge, provider-owned integration or automatic task dispatch remains.

## Focused checks and final proof

Suggested selectors from source inspection, to verify on the actual prerequisite release:

- T1: `npm run test -- tests/unit/intake-session.test.ts tests/unit/intake-command-arms.test.ts tests/unit/intake-validation.test.ts tests/unit/server/intake-surface.test.ts tests/unit/ocr-extraction-admission.test.ts tests/unit/ocr-command.test.ts`
- T1: `npm run test:architecture -- tests/unit/architecture/intake-mapping-boundary.test.ts tests/unit/architecture/ocr-producer-parity.test.ts`
- T2: `npm run test -- tests/unit/artifact-projection.test.ts tests/unit/infra/server-verified-artifact-reader.test.ts tests/unit/operator-xlsx-export.test.ts tests/unit/server/operator-xlsx-export-service.test.ts`
- B and G: `npm run test -- tests/unit/storage-upgrade.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts tests/unit/archive-model.test.ts`
- B and G: `npm run test:architecture -- tests/unit/architecture/migration-history-immutability.test.ts`

Add real populated migration, concurrent connection and fault-injection tests for the proof rows;
replace retired guards with meaningful negative controls and deciding inventory evidence. Preserve
all assertions, test membership, coverage floors, isolation and timeouts. Run lint whenever tests
run. A focused pass is not complete product acceptance. The full required typecheck/coverage/
architecture/parity/build/recovery and generated gates are owned by [2.6.9](final-validation.md).
Use /ui for frontend work and deliberate parity changes; preserve the scoped product exclusions.

No live external submission, real provider/key wiring, operator database upgrade or source cleanup
is authorized here. An operator-root upgrade/cleanup is a separately assigned action after accepted
integration, verified stopped ownership, source-bound backup, supported upgrade plan/apply/doctor
and sanitized before/after identity/count evidence. This planning work changes no runtime data.

**WAITING ON:** the assignment's actual prerequisite development release. C0's execution allocation is admitted below; no future base is guessed.
All earlier planning checks remain historical Git evidence, not gates for the new implementation.

## C0 execution allocation — 2.6.6.3 G

The approved G01–G06 brief below supersedes this allocation’s historical baseline, unresolved
readiness, gate invocation and no-master-integration wording. Its six production and five test
paths remain binding; the previously new production targets now exist on repaired F.

Prerequisite: **one frozen F release, identical to P/D/S base**. One Astra/high supervisor, zero implementation workers.
Use the exact `G` branch and absolute worktree in [PROMPTS.md](PROMPTS.md#binding-registry).
This allocation supersedes older shared-file/side-task ownership in this owner; product proof is retained.
Current inspected baseline is R `60b356dd119140dc972a077751ad16af934acb2e`, schema39/floor37.
Future prerequisites build the explicitly named new modules before peers launch; names do not assert readiness.

Ordered outcomes: Verify generated-file storage and working explicit XLSX baseline; implement ordered fenced publication/verification; prove filesystem and DB failure windows plus old version downloads; release to L.

### Exclusive changing paths

- `src/core/generated-artifact-projection.ts` (new target)
- `src/infra/sqlite/generated-artifacts.ts` (new target)
- `src/infra/artifacts/artifact-sink-projector.ts`
- `src/infra/artifacts/xlsx-retention-sink.ts`
- `src/server/dashboard/exports/operator-xlsx-export-service.ts`
- `src/server/dashboard/compose/generated-exports.ts` (new target)

### Proof and test ownership

P1–P8 remain with F owning complete import/extraction and shared conversion. G owns publication-specific P4–P6/P8 on F alone. F supplies stable artifact metadata/retention and SQLite methods so D/S/P cannot require changes here.

- `tests/unit/artifact-projection.test.ts`
- `tests/unit/infra/server-verified-artifact-reader.test.ts`
- `tests/unit/operator-xlsx-export.test.ts`
- `tests/unit/server/operator-xlsx-export-service.test.ts`
- `tests/unit/generated-artifacts/publication.test.ts` (new required test)

Run the owned unit files with `VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1`
followed by their explicit paths above (exclude a performance script from Vitest). New paths must exist
and collect meaningful cases before release. Use `npm run lint`; run affected architecture guards
with `--project architecture --maxWorkers=1`, and the affected manifest/catalog/roadmap generators
before their `:check` commands. Preserve existing floors, membership, assertions and timeouts.
Desktop visual work uses `/ui`; focused rendering/accessibility proof is due here, complete parity/build
and all heavy gates remain 2.6.9. Preserve every inherited proof row; record exact tested tree and exits.

The prerequisite owns shared fixtures, registries, global unions and generated inputs; create only
owned fixture files beside the new tests. Shared architecture guard retirement is recorded by the
prerequisite with violating fixtures and guard-inventory evidence. No peer may edit another peer
or prerequisite path. A newly discovered required shared edit blocks peer release until its owning
prerequisite is amended and revalidated. Do not replace a missing baseline with an unused export.

Release committed candidate/base/tree and focused evidence to the next named consumer. No master
integration, independent review, heavy-gate waiver, sibling dispatch or live database application.
Future-base binding remains WAITING ON the actual prerequisite release, not a fabricated SHA.

Authored evidence stays in this task's existing `artifacts.md` owner; shared indices remain read-only.


## Approved execution brief — 2026-09-09

The operator approved the complete G01–G06 proposal on 2026-09-09 after the shared F repair.
The same supervisor implements, passes focused checks, merges locally into master and removes
only G’s owned checkout/ref. This approval overrides generic retained-candidate/no-master wording
for G in this owner and the combined plan. Full gates and complete independent review remain in
2.6.9; there is no intermediate finalizer or reviewer. This is planning approval, not implementation
or final phase acceptance. Preserve all T2 product requirements and proof rows above.

### Binding, allocation and readiness

| Field | Binding |
| --- | --- |
| Assignment | 2.6.6.3 G; one GPT-6 Astra/high supervisor, zero implementation workers and zero reviewers here |
| Common runtime prerequisite | Completed F resolver-port integration `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`, with verified release record `e06a1c82e9983deb281c5400671f6ce330214000` and complete cleanup receipt. This supersedes `51e4c087a0d455619ca93a3bbddc5c8fb5a24a48` for launch. |
| Inspected planning base | Clean master `0eeedcadad5ed4f686799be4dd190133372d5e2b`; source/tests/configuration/dependencies match F’s tested candidate `a1e963445bc05d57f1eb9abbff95a9238300ab3a` |
| Execution base | The exact committed plan/base returned by the planner, containing this approved G brief and F’s completed resolver-port repair integration. Verify both ancestries and unchanged runtime inputs relative to that latest tested F release. A pre-repair plan commit is not launchable. Do not start from an arbitrary later master. |
| Branch / checkout | Create `codex/artifact-outputs` at `/Users/julianhein/Projects/hr-worktree-artifact-outputs` from that exact execution base. Both were absent during planning; names are not reservations. |
| Scope | The six production and five test paths in the C0 allocation above; fixtures local to the new owned test directory only. Authored implementation evidence stays in this file. |
| Integration | G supervisor merges locally into master after focused PASS and checks for concurrent ownership; no push. Preserve candidate/merge/tree identities for L and 2.6.9 before deleting G’s ref. |
| Capacity | One unrelated auxiliary worktree exists at `/Users/julianhein/Projects/hr-separation-accounting-final`; preserve it. Recheck the four-auxiliary-worktree cap and current ownership before creation and integration. |
| Review | Fresh complete read-only `sup_review` on Astra/high belongs to 2.6.9, covering G’s publication, replay, exports and cross-domain retention with the combined candidate. G claims only a scoped development release. |

The [F repair and closure](foundation.md#f-prerequisite-repair--2026-09-09) and its
[complete cleanup receipt](/Users/julianhein/Projects/hr-database-foundation-repair-evidence-20260909/closure.json)
were inspected. They bind 961 unit tests, 199 guard tests, lint/freshness and 67 filtered UI cases
to the repaired candidate. These are prerequisite evidence, not G test results. Schema47/floor46
and released migrations remain unchanged. G needs no sibling code, provider, live system, or actual
operator database: its publication/recovery acceptance uses isolated synthetic DB/file fixtures.
READY additionally requires committed approval, passing documentation checks and verified plan
availability. Planning creates no implementation checkout or task.

### Parallel coordination binding — amended 2026-09-09

The operator explicitly requested this plan/prompt correction and then required the updated
[Parallel coordination protocol](/Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md#parallel-coordination).
Read that section before G01 and apply it throughout G01–G06. This amendment changes coordination
only: G’s product scope, one-supervisor/zero-worker allocation, base requirements, focused gates,
authorized local merge/cleanup and 2.6.9 full-gate/review timing remain unchanged. It supersedes any
interpretation of earlier planning-history sequences as a standing queue or messaging requirement.

| Responsibility / resource | G binding |
| --- | --- |
| Implementation and proof | The operator-opened G supervisor owns G01–G05 in `codex/artifact-outputs` at `/Users/julianhein/Projects/hr-worktree-artifact-outputs`. P/D/S are independent assignments; G neither dispatches nor monitors them. Their unmerged work is not a G prerequisite. |
| G integration and cleanup | The same G supervisor owns G06: its candidate’s local master merge, invalidated checks, exact release record and owned cleanup. No additional coordinator or automatic transfer to a peer. A focused candidate alone does not discharge G06. |
| Later work | L owns its already assigned combined P/D/G/S consumption; 2.6.9 owns full-batch gates, independent review and final acceptance. G records the exact integrated release in this owner. Already assigned later work needs no new acceptance handshake or readiness broadcast. G does not wait for sibling completion after finishing G06. |
| Shared writes | Before modifying the primary checkout/index, shared plan/status/registry files or combined generated output, inspect current Git/worktree state and available recorded ownership. Apply the isolation policy; clean status alone does not prove exclusivity. Serialize only the actual conflicting mutation/validation, not whole tasks or unrelated worktree-local gates. |
| Actual conflict | Use an existing supported acquisition mechanism when available. If evidence leaves a concrete conflict needing another owner’s action, contact only that exact known owner. Record the resource, owner, grant/mechanism and release condition in G’s current evidence. No broadcast, peer availability survey, invented group slot or speculative queue. Release after the operation/process finishes, including failure; send one release only when necessary to unblock the named waiter. |

**Communication default: no peer messages.** Read committed plans, Git and existing evidence first.
Before any permitted message, identify the specific action the recipient must take and why primary
evidence cannot resolve it. Only unresolved blockers, conflicting claims, changed required inputs
or necessary delivery/reassignment justify contacting the affected exact returned task/agent ID.
Never infer ownership from titles or reuse these planners’ IDs for future implementation sessions.
No routine start/finish announcements, status/readiness reports, copied gate results, holding notices,
acknowledgment rounds or relays. Native returns and established completion waits are delivery; do
not duplicate them. Progress updates remain in G’s user-facing chat, not in peer messages.

**Retain and finish owned duties.** Gates, final verification, merge and cleanup remain with G until
finished or explicitly transferred under approval. If an actual transfer becomes necessary, record
exact sender/recipient IDs, branch/worktree, plan/base/candidate, tested evidence, dirty state,
unresolved issues and remaining-duty ownership here; the receiver must accept those still-owned
duties. Message delivery alone is not acceptance. Record an existing authorized resume mechanism
for any G verification retained after transfer; otherwise state the operator resume point. Do not
invent an automation, subscription, dispatch or new verification duty.

When no local work or active process remains and later duties already have an authorized owner,
end G’s active turn with its contribution status and remaining owner. Keep phase acceptance open;
no observer loop, sibling monitoring or confirmation wait merely to relay completion. While an
owned dependency is genuinely needed, continue independent work and use supported completion waits
with cursors/backoff. Resume only for an owned repair, missing evidence or assigned verification.

### Feasibility and required proof

| Boundary / observed mechanism | G change and required negative proof |
| --- | --- |
| Shared executor now delegates source matching to `pendingGeneratedUpdateIds`; `generatedUpdateId` commits to the complete checkpoint and derived row. | Preserve these repaired interfaces and complete checkpoint identity across run/item/attempt/claim/output. Replaying an old completed checkpoint cannot consume newer same-key work; historical random IDs need one exact witness, and ambiguous or unbound commitments refuse without acknowledgement. No shared executor edit is needed. |
| `generated_artifacts` already carries bounded ordered updates, versions, state and nullable prepared identity; `generatedArtifacts` and exports are exposed through inferred repository types. | Add publication state transitions through G’s repository module and projector options without changing shared types/schema/root wiring. Admit bounded metadata before checkpoint commit; retain immutable update/receipt/version prefixes and generation checks. Exercise independent SQLite connections and rollback. |
| Sink already puts old/new bytes, fsyncs a temp file, replaces the destination and fsyncs its directory; projector records head and acknowledgement together afterward. | Persist prepared update/version identity before replacement, verify old/staged/new bytes, hold the exclusive writer fence and settle the exact ordered update. Crash windows must retain intent and the last verified version. No filename/time-only success or blind overwrite; conservative conflict is acceptable. |
| Explicit XLSX service currently publishes bytes before inserting completed evidence, while register/fail methods already exist. | Validate/capture the selected data before registration changes authority generation; register before byte publication and settle the same file row only after verification. Preserve exact selection, attribution, protected workbook contents, immutable evidence and headers. Identified replay reuses its row; changed request/evidence refuses, and independent exports remain independent even with identical bytes. No new public request field or export format. |
| F owns imported/extracted conversion, historical export conversion, retained version references and existing deletion protection. | G proves old-version reads and existing shared retention on F alone, including missing/corrupt byte refusal. New archive.sqlite custody/transfer consumes G in L/A/H and receives combined proof in 2.6.9; G must not depend on those future implementations. |

Carry these interacting cases into P4–P6/P8: two independent enqueues plus one active writer;
new enqueue during publication; completed-old/new-pending same record key; historical ambiguous
checkpoint plus matching payload; stale generation plus prepared intent; interrupted replacement
plus same/different retry; external destination change with an intact last-good immutable version;
export registration followed by byte, readback or DB settlement failure. Each refusal test also
needs a valid control reaching the intended boundary. No false ready/download, lost pending work,
mutated old reference, cross-checkpoint acknowledgement or unsafe repeated replacement is allowed.

### Ordered steps

1. **G01 — Verify prerequisite.** Verify the exact plan/runtime ancestry, F receipt, ownership,
   runtime input equality, schema47/floor46 and resource capacity before creating the owned lane.
   Read the parallel coordination binding and its linked protocol; inspect recorded ownership
   before shared writes without starting a peer check-in round. Read nearest module instructions
   and relevant artifact/export lessons. Preserve repaired replay.
2. **G02 — Ordered publication.** Complete durable prepared intent, byte verification, old/intended
   immutable retention, exclusive writer/generation fencing and atomic exact head/ack settlement.
   New updates admitted during a write remain pending. Preserve limits and rollback semantics.
3. **G03 — Failure windows.** Add fault injection and restart proof around staging, fsync,
   replacement and acknowledgement. Prove missing/headless/external-edit/stale-generation refusals,
   truthful states, retained intent and old-version readability; do not add automatic recovery.
4. **G04 — Explicit XLSX lifecycle.** Capture the admitted selection, register its export identity
   before writing bytes, verify publication and settle that same generated row. Prove exact replay,
   divergent refusal, separate same-byte exports, immutable receipt/headers and failure truthfulness.
5. **G05 — Focused release.** Complete the assigned P4–P6 and existing-retention P8 proof on F
   alone, run the candidate gates below, fix in-scope failures and commit logical categories using
   exact paths. Record plan/base/head/tree, paths, commands/exits, proof rows and deferred work here.
6. **G06 — Merge and cleanup.** Recheck clean target, ancestry, current task ownership and changes
   since base; apply the parallel coordination binding to actual shared integration/recording
   conflicts. Retain this step through verified merge and cleanup; no routine peer handshake. Merge locally after focused
   PASS, repair in-scope integration defects and rerun invalidated checks. Record candidate and merge
   identities, inherited final-proof obligations and focused evidence; preserve owned logs/ignored
   artifacts outside the checkout, stop owned processes and remove only G’s worktree and branch.
   Verify registration/path/ref absence and clean target. Preserve all unrelated work. Stop here.

At start/resume and after every verified step, send Done / Now / Remaining before the next tool
call. Include integration, cleanup and deferred final review explicitly. L still waits for all
four actual child releases; G neither launches L nor claims its siblings complete.

### Reproducible focused gates and evidence

Use a private evidence directory outside the implementation checkout and a resource-only
`vitest-one.config.mts` adapter. Recreate it against this checkout rather than F’s deleted path:

```ts
import baseline from "/Users/julianhein/Projects/hr-worktree-artifact-outputs/vitest.config.ts";
export default { ...baseline, test: { ...baseline.test, maxWorkers: 1,
  projects: baseline.test!.projects!.map((project) => {
    if (typeof project !== "object") throw new Error("unexpected project configuration");
    return { ...project, test: { ...project.test, maxWorkers: 1 } };
  }),
} };
```

Use `G_CONFIG` for that adapter’s absolute path. Compare its resolved configuration with the real
configuration: only root and per-project maxWorkers may differ. Record effective one-file-worker
counts, identical project include/exclude membership, forks, isolation, assertions, floors and
30-second test/hook timeouts. Do not modify repository configuration or reuse a deleted adapter.
Run from `/Users/julianhein/Projects/hr-worktree-artifact-outputs`:

```sh
VITEST_MAX_WORKERS=1 npm run test -- --config "$G_CONFIG" --project unit --maxWorkers=1 tests/unit/artifact-projection.test.ts tests/unit/infra/server-verified-artifact-reader.test.ts tests/unit/operator-xlsx-export.test.ts tests/unit/server/operator-xlsx-export-service.test.ts tests/unit/generated-artifacts/publication.test.ts tests/unit/database-foundation/transaction-contracts.test.ts tests/unit/database-foundation/four-way-independence.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --config "$G_CONFIG" --project architecture --maxWorkers=1 tests/unit/architecture/artifact-effect-boundary.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/storage-recovery.test.ts tests/unit/architecture/redaction-surface-scan.test.ts
npm run lint
```

The two F unit files and architecture guards are read-only boundary checks, not G write ownership.
The new publication suite must exist and collect meaningful cases. During iteration select affected
owned tests; before candidate release run the full focused set above against the committed code.
Run lint whenever tests run. Failed focused checks block release; routine fixes stay with G.

For affected generated inputs, run `npm run build:manifest`, `npm run stores:catalog`, or
`npm run roadmap` before the corresponding `:check` command. Serialize writes to shared generated
outputs; regeneration does not authorize shared source edits. Planning/completion documents require
roadmap generation/freshness, focused `tests/unit/architecture/roadmap-doc-binding.test.ts`, local
link checks, existing AGENTS/CLAUDE equality, project instruction chains below 32,768 UTF-8 bytes,
and `git diff --check`. Status/launch pointers and generated roadmap recording are serialized by
G at integration; implementation peers otherwise keep their authored evidence in their own owner.

At candidate, integration and recording boundaries, record command/exits and tested SHA/tree.
After integration changes rerun every invalidated focused check. D191 permits reuse only with an
explicit diff proving relevant source/tests/configuration/dependencies and other inputs unchanged;
a documentation-only SHA is not automatically sufficient. Preserve all failures and repairs in
external evidence; never call an unrun gate passed.

Full typecheck, coverage, whole architecture, broad parity/build/performance, combined archive
transfer and original cross-domain recovery/scenario/production-route proofs, and fresh complete
independent review remain in **2.6.9**. There is no frontend layout/interaction change or new live
producer here: verify download behavior in the focused service tests. A necessary visual behavior
change or shared-fixture/schema/executor/root-composition edit requires amendment, not silent
scope expansion or an invented fallback. Imported/extracted and historical conversion proof remains
F evidence plus final combined verification; no product proof is dropped.

### Stop conditions and exclusions

No push, live database upgrade/application, HR submission, provider/key wiring, I-9 activation,
new workbook layout/output format, artifact-management UI, automatic export/recovery/GC, sibling
launch, or cleanup of another lane. Preserve UNKNOWN-submit refusal and issued historical evidence.
Changed prerequisite inputs, unavailable owned capacity, an unresolved ownership conflict, a failed
focused check or a required shared change blocks dependent release. Continue independent owned
work and surface the exact remaining blocker; never weaken a requirement to obtain PASS.

### Planning persistence evidence

The planner validates this approved section and its shared gate/merge pointers with documentation
checks only, commits exact paths, reads the committed section back and verifies repaired F ancestry,
plan availability and proposed ref/path absence before issuing READY. Runtime gates are not rerun
or newly claimed by planning; the unchanged runtime input comparison preserves F’s prerequisite
provenance. G remains unimplemented until the operator starts its fresh supervisor session.


Planning check record (2026-09-09): the one-worker adapter was compared structurally with the
repository config and changed only root/project worker limits. The focused roadmap binding suite
passed 24 tests; `npm run lint` exited 0 with zero warnings against the unchanged runtime/test/
script/config inputs at `0eeedcadad5ed4f686799be4dd190133372d5e2b`. Shared-master P/D/G planning
writes required serialized commits (D, then P, then G); each task retains its own authored hunks.
G reruns affected document/generator checks on its final candidate and reuses lint only after
confirming those execution inputs are unchanged. Planning does not claim any G product test,
full-phase gate or independent review. Command logs are at `/tmp/g-plan-20260909/`.


### Launch prerequisite update — resolver-port repair

F’s complete resolver-port repair is locally integrated at `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`. It supersedes
`51e4c087a0d455619ca93a3bbddc5c8fb5a24a48` as the common P/D/G/S runtime prerequisite. The
[F resolver release](foundation.md#f-resolver-port-repair--2026-09-09) and its
[cleanup receipt](/Users/julianhein/Projects/hr-database-foundation-resolver-evidence-20260909/closure.json), required to be complete, resolve this F dependency.
G’s six-file ownership, product requirements and focused/merge/cleanup schedule remain unchanged.
The planner retains approved G plan `4e84dbcb1b696c5d4d1f99f8a73a5bf25d085dd3`, verifies a final
committed descendant containing that plan and this F release against F’s tested runtime inputs,
and returns the exact resolved implementation base. No new G product approval, scope expansion,
implementation or child launch is implied. P/D/G’s concurrent planning commits were preserved.


### Verified final planning rebind — 2026-09-09

The planner verified common F integration `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`, its
release record `e06a1c82e9983deb281c5400671f6ce330214000` and the complete resolver-repair
cleanup receipt. The old pending-prerequisite hold is resolved. Approved G plan
`4e84dbcb1b696c5d4d1f99f8a73a5bf25d085dd3` remains an ancestor. All G01–G06 steps, the six
production/five test paths, proof allocation, exclusions and focused/merge/cleanup schedule are
unchanged. F's six G production files also remain identical to the earlier inspected release.

The exact implementation base is the committed G rebind SHA returned by this planner, a descendant
of inspected master `fcb02e295542aa7772052200d75050656b818b83` containing both the full approved
G plan and current F integration. All non-document inputs match F's tested candidate
`f917ffe7b2308b4746e2aba16719a68cbafdb56c`. Use the pinned base, not a later arbitrary master;
verify both prerequisite and approval ancestries before creating the G checkout. G branch/path
are absent; only the unrelated separation-accounting worktree remains. No G worktree, worker,
reviewer or implementation was created by planning.

For this factual documentation rebind, rerun roadmap generation/freshness, the 24-case focused
roadmap binding suite, changed-document links, nine existing instruction pairs/chain bounds and
whitespace checks. Reuse F's passing `npm run lint` from its tested candidate only after verifying
all non-document input equality; the earlier G lint run predating the resolver repair is not the
current basis. F's `final-reuse.json` and `focused-pass.json` beside the complete receipt retain
that command/input evidence. Full gates and independent review remain in 2.6.9. READY is issued
only after this rebind is committed, read back and checked with the exact returned base.


### Coordination amendment persistence — 2026-09-09

The operator authorized updating the plan and prompt, then explicitly directed rereading the revised
protocol. Before editing, the planner reread the current references and verified clean master
`d3a4d121b2611bdd277663fabb953ea29f6dfa13`, the worktree inventory and the existing grant for the
actual shared documentation/index operation. Only this owner and G’s prompt binding change.
The prior broad reservation conversation is not a prescribed workflow. After checks and the exact
commit, one release to the already waiting owner ends this actual conflict; no peer status broadcast
or new queue is created. The planner’s returned amended plan/base supersedes the previous G launch
prompt while preserving the current F prerequisite and all execution requirements.

## G execution record — 2026-09-09

**Current state:** G01–G04 implemented and focused proof passed; G05 final committed checks and
G06 integration/cleanup remain owned by this supervisor. This is a scoped development release;
full acceptance and independent review remain in 2.6.9. No workers, reviewers or siblings were
launched. No peer messages or transfers were needed.

| Binding | Verified evidence |
| --- | --- |
| Plan/execution base | `391686035bc85a0587958e09dae7cf0feceadbed`; approved plan `4e84dbcb1b696c5d4d1f99f8a73a5bf25d085dd3` is an ancestor |
| F prerequisite | `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` and release `e06a1c82e9983deb281c5400671f6ce330214000` are ancestors; resolver cleanup receipt is complete and its owned path/ref remain absent |
| Runtime comparison | All non-document inputs at the execution base equal F's tested `f917ffe7b2308b4746e2aba16719a68cbafdb56c`; schema47/floor46 and released migrations remain unchanged |
| Owned lane | `codex/artifact-outputs`, `/Users/julianhein/Projects/hr-worktree-artifact-outputs`; created from the exact base with one existing auxiliary checkout, under the then-available cap |
| Integration owner/condition | This G supervisor retains local master integration, invalidated focused checks, release recording and owned cleanup after committed focused PASS |
| Evidence | `/Users/julianhein/Projects/hr-artifact-outputs-evidence-20260909/`; `preflight.json`, `config-proof.json`, command logs and `sensitivity.json` preserve actual results |

### Implementation and proof

| Step / proof | Delivered behavior and boundary evidence |
| --- | --- |
| G01 | Read the amended coordination binding and current linked protocol, server instructions, artifact/export contracts and lessons. Preserved unrelated primary-checkout planning edits. Verified ancestry, complete F receipt, runtime equality, schema/floor and capacity before creating the lane. |
| G02 / P4 | Repository admission reserves bounded settlement metadata. Prepared update/artifact/generation identity is durable before staging. The writer verifies immutable old/intended bytes, staged bytes and destination bytes; canonical destination locks include directory aliases and refuse symlink files. Generation and exact prepared identity are rechecked before replacement. Head/version/ack settle together; independent enqueues remain pending. F's complete checkpoint commitment and historical witness resolver are unchanged. |
| G03 / P5 | The new publication suite exercises ten staging/fsync/replace/settlement interruption boundaries with a valid initial publication, independent reopened connections, retained intent, unchanged last head and readable old immutable versions. Prepared retries refuse explicit reconciliation; no automatic recovery. It also covers staged corruption, external edits during publication, stale preparation, divergent settlement, exact acknowledgement, alias contention, metadata rollback and missing/corrupt old versions. Existing projection tests retain missing/headless destination and executor replay controls. |
| G04 / P6 | The service captures and composes the admitted selection before registration changes authority generation, registers before publishing workbook bytes, verifies readback, settles the same generated row, then verifies persisted evidence before returning. An unavailable intended digest in the existing version collection binds pending exports to their bytes; verified publication appends the actual immutable reference without rewriting that commitment. Failed publication/readback/settlement retains failed registration. Identified exact-content replay reuses its row; request/content divergence refuses. Independent same-byte exports retain separate identities. Existing actor, protected workbook and header behavior is preserved. |
| G05 / P8 | Existing immutable references survive later output versions; missing/corrupt bytes refuse. F's storage transaction, four-way independence and selected backup/recovery guards remain passing boundary checks. Combined archive custody/transfer and complete cross-domain recovery stay assigned to L/A/H and 2.6.9. |

Four production files changed: the generated repository, sink projector, retention sink and export
service. The core checkpoint resolver and composed export factory did not need edits. Test changes
are restricted to the existing projection/export service suites and the new owned publication suite.
No shared schemas, migrations, executor/root composition, registry, fixtures or sibling source changed.

### Focused evidence and limitations

The external adapter imports this checkout's real Vitest configuration. Structural and resolved
configuration comparisons permit only root/project `maxWorkers: 1`; all project include/exclude
membership, forks, isolation, assertions, coverage thresholds and 30-second test/hook timeouts match.
Before the final prepared-fence recheck, the complete assigned unit selection passed **7 files /
101 tests** and architecture selection passed **4 files / 131 tests**. `npm run lint`, manifest
and store-catalog generation/freshness exited 0. Final committed results below supersede this
iteration evidence; unrun full gates are not claimed.

Targeted mutations prove the tests detect lost prepared intent, skipped staged-byte verification,
skipped destination revalidation and divergent export replay. The initial removal of one redundant
prepared precheck still refused at the second guard; it is retained as non-discriminating evidence,
not claimed mutation coverage. All injected changes were restored exactly before normal gates.

Observed implementation repair rounds: initial export identifier ordering violated existing refusal
fixtures and was repaired by preserving capture before identity allocation; the projection test
teardown now awaits artifact initialization before removing roots. New fixture migration-owner casing
and the manual-clock method were corrected without changing production expectations. Final inspection found that re-putting missing old bytes could allocate a different immutable ID;
publication now opens the exact retained reference first, with missing/corrupt controls and verified
restore-to-the-same-reference controls. This was an in-scope implementation defect. No product or
ownership amendment was required. Earlier use of the real clock/fixture contracts would have avoided
those fixture repairs. Full review has not run; these observations are not an independent verdict.

Full typecheck/coverage, whole architecture, broad parity/build/performance, combined archive transfer,
original cross-domain recovery/scenario/production-route proof and fresh complete `sup_review` remain
in **2.6.9**. This task adds no live producer, UI behavior, automatic recovery/GC, export format,
provider wiring or HR submission. No push or operator-database upgrade occurred.
