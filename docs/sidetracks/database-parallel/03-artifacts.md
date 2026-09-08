# Imported, extracted and generated artifacts

## Assignment and approval

**Product owner: `side/artifacts`. Revised execution follows the [parallel execution plan](README.md).**
Former T1 import/extraction implementation and shared generated storage move to prerequisite B.
T2 `side/artifacts-2` becomes parallel peer G, **WAITING ON accepted B release**. The operator
approved this allocation amendment on 2026-09-08. The four currently running plans stay unchanged.

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

The one [prerequisite task](00-prerequisites.md) must publish its verified B release before launch.
Use that exact accepted release base, also used by both peers. Record this peer's detailed evidence
only in `03-artifacts-evidence.md` in this folder; do not share an `implementation.md` or edit another peer's plan.

## Authorities and scope

- [Root instructions](../../../AGENTS.md), [document routing](../../README.md),
  [roadmap governance](../../roadmap/roadmap.md), and
  [operating reference](../../../.agents/skill-library/repository-work/REFERENCE.md).
- [Data intake and Edit Data: artifact storage model](../../rebuild/reference/data-intake-and-edit-data.md#artifact-storage-model)
  owns the pending amendment to intake/extraction and D164's output-maintenance tables.
- [Dashboard surfaces: artifact storage model](../../rebuild/reference/dashboard-surfaces.md#artifact-storage-model)
  owns unchanged intake behavior, command replay, generated-file/export presentation and diagnostics.
- The [parallel execution plan](README.md) owns B, which provides diagnostic snapshot/file/receipt names
  and protection plus import/extraction and generated storage. Run completion and timeline T2 precede
  B. Diagnostic resolution and provider accounting are independent peers, not predecessors.
- [Task contract](../../rebuild/reference/task-contract.md), [workflow model](../../rebuild/reference/workflow-model.md),
  [operator trust](../../rebuild/reference/operator-trust.md), [clock/config/secrets](../../rebuild/reference/clock-config-secrets.md)
  D321/D322/D332, [frontend/backend integration](../../rebuild/reference/frontend-backend-integration.md),
  and [guards and tests](../../rebuild/reference/guards-and-tests.md) §3.14 D191 retain authority,
  protected evidence, upgrade/backup, commands, resource admission and gates.

B owns all T1 intake/extraction implementation, including commands, fan-out/origin references,
transitive readers and proof. B also owns T2 physical schema, strict low-level queue/CAS/receipts,
migration/source backups/integrity/retention, shared executor/export composition and pending counts.
G owns generated-file publication, writer and immutable-version verification, exact checkpoint update
consumption, and existing explicit XLSX export registration through B's real frozen interfaces.
Only G's enumerated production/tests and this plan/evidence may change in parallel; no shared
migration, IDs, global repository types, root composition or intake command edits. The [parallel execution plan](README.md)
owns exact file lists and integration. Read nearest instructions and lessons before module edits.

Do not change workflow meaning, source coercion, sensitive-field rules, active-import reuse policy,
batch grouping/priority, run membership, retry, operation proof or UNKNOWN-submit safety. Do not
introduce PDF-to-intake automation, new OCR providers, real-key wiring, an I-9 workbook path/column
layout or activation of currently unwired descriptor projections. No new file-management UI, sync
service, automatic exports, new output format or general artifact garbage collector. Keep diagnostic
files as diagnostic relationships and `operator_xlsx_exports` as export-evidence records, not competing
file heads. Internal screenshots/PDF raster intermediates are not automatically registered as managed
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

**Current consumers.** Adapt the existing executor projector seam and synthetic `xlsx-retention` writer,
without activating an I-9 workflow or inventing operator workbook columns/paths. Register outputs from
the existing explicit operator XLSX export service: allocate a logical output identity, retain pending
state for the admitted generation, publish/verify its immutable bytes, and settle the ready record with
its existing export receipt in one authority transaction. Preserve the export's served snapshot selection,
protected data, download headers, workbook contents and authorization. Repeated explicit exports remain
separate requests as today; retries of an already identified generation cannot create conflicting receipts.
`operator_xlsx_exports` remains evidence of what was requested/exported, not another mutable file head.
No automatic registry rows for diagnostic attachments or extraction intermediates in this unit.

**Historical conversion.** Group old output updates and head by their exact admitted destination/sink
identity, preserving each pending/completed update, stable key, source, payload, receipt ID and ordering.
Carry old IDs as explicit compatibility identities. Missing/contradictory ownership refuses; don't infer
one file per run or coalesce updates merely because their keys match. For populated old file heads,
verify the actual destination and capture its exact bytes into immutable artifact storage under a stopped,
backup-bound conversion. Old versions absent from retained evidence stay explicitly unavailable; do not
invent a full version history from a hash. A current populated head without verifiable matching bytes
blocks conversion instead of becoming a plausible ready record. A first-create pending file may have no
head or existing file, which is a distinct valid case.

Historical exports can register a ready logical file from their exact retained verified artifact and
export identity. Do not rewrite issued receipt JSON/digests or enumerate unrelated files from disk. No
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
   consumption and existing explicit export registration. Prove P4–P6 and generated-output P8 on B alone.
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
| P6 Generated history/export | One file row progresses pending to verified ready and survives later updates without changing old import/run/export references. Existing explicit XLSX exports preserve selection, protected contents, receipt/digest/headers; byte/receipt/DB faults cannot return a successful inconsistent download. Independent exports remain independent. |
| P7 Output migration/retirement | Populated pending/completed/mixed updates, existing heads and files, old exports and unavailable history have exact conversion outcomes. Required stopped file copies and DB backup are identity-bound; changed/missing sources refuse. Old output tables/current consumers retire and pending counts remain accurate. |
| P8 Upgrade/retention/compatibility | Fresh creation, supported old backups/upgrades, pre/postcommit interruption, exact resume, no-write repeat and full restore pass. D308/tombstones, shared file refs, diagnostics/pins, archive identity and schema/settings coupling remain correct. No new real provider/workflow activation. |

B's implementation/review allocation lives in the [parallel execution plan](README.md). G uses one Astra/high
supervisor implementing locally, zero implementation workers, and one fresh complete read-only
`sup_review` on Astra/high. The reviewer receives exact base/head/tree, full assigned diff, this product
contract/proof allocation and gate evidence, not the author's conversation. It never implements or
delegates. Re-review required findings and behavioral integration fixes.

| Unit | Branch / absolute checkout | Base / owned scope |
| --- | --- | --- |
| Former T1 | No separate task or checkout; execute inside `side/database-foundation`. | B owns its complete implementation and review. |
| T2 `side/artifacts-2` | Create `codex/artifact-outputs` at `/Users/julianhein/Projects/hr-worktree-artifact-outputs`. | Exact accepted B release SHA, also used by P/D; G owns publication/export behavior only. |

Verify availability, capacity and full base before editing. The provider-usage implementing supervisor
is the one peer integration owner. Return the reviewed candidate with exact proof/handoff; transfer
responsibility only on acceptance. Integration may occur before or after P or D. The shared plan owns
serialized target operations, combined gates, renewed review and safe cleanup. No automatic integration,
push, sibling launch, operator-database application or phase completion.

## Gates and application

Read nearest instructions and relevant lessons; use `/ui` for required intake/diagnostic/export UI
adaptations and preserve existing layouts. No new artifact-management screen is assigned.

Focused iteration selectors (T1 belongs to B; T2 belongs to G except B-owned migration/storage proof):

- T1: `npm run test -- tests/unit/intake-session.test.ts tests/unit/intake-command-arms.test.ts tests/unit/intake-validation.test.ts tests/unit/server/intake-surface.test.ts tests/unit/ocr-extraction-admission.test.ts tests/unit/ocr-command.test.ts`
- T1: `npm run test:architecture -- tests/unit/architecture/intake-mapping-boundary.test.ts tests/unit/architecture/ocr-producer-parity.test.ts`
- T2: `npm run test -- tests/unit/artifact-projection.test.ts tests/unit/infra/server-verified-artifact-reader.test.ts tests/unit/operator-xlsx-export.test.ts tests/unit/server/operator-xlsx-export-service.test.ts`
- B and G: `npm run test -- tests/unit/storage-upgrade.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts tests/unit/archive-model.test.ts`
- B and G: `npm run test:architecture -- tests/unit/architecture/migration-history-immutability.test.ts`

Add actual concurrent database/writer, failure-injection, complete source-copy restore and historical
identity fixtures for the proof rows. Record renamed selector/guard mapping and guard inventory evidence;
never simply remove failed assertions. Run lint whenever tests run. Focused passes do not replace full gates.

Each implementation commit/candidate and material integration requires `npm run typecheck`,
`npm run lint`, `npm run test:coverage`, `npm run web:build`, `npm run test:parity`, affected generated
checks and `git diff --check`. If affected, generate `build:manifest`, `stores:catalog`, `roadmap` before
the corresponding `:check`; never hand-edit generated output. Any parity-reference changes must be
deliberate and reviewed, not blanket refreezes. Keep membership, isolation, assertions, floors and timeouts.

Use at most four effective file workers. Keep coverage free of this task's compiler/linter contention;
serialize mutable output directories and evidenced resource conflicts without killing peer processes.
Independent typecheck/lint/freshness may overlap within verified capacity. Record exact tested SHA/tree,
commands/exits/logs, effective workers and proof mapping. Reuse only with original tested identity/results
and unchanged relevant inputs; changed inputs, failures or unresolved evidence require rerun. D191 scoped
checks govern planning/recording only and do not prove unimplemented behavior.

Actual operator conversion is separately assigned after accepted integration. Recheck schema/executable,
permissions, stopped locks, exact file destinations and all required source bytes; take the verified
explicit SQLite backup and immutable source copies before planning/applying upgrade and running doctor.
Verify sanitized before/after identities, counts, frozen import/extraction data and generated-file versions.
No live HR submission, real OCR call or maintained production workbook is needed for acceptance.

## Progress and launch status

- Original product scope remains approved. On 2026-09-08 the operator explicitly approved revising
  the remaining plans for parallel execution, including their ownership, prerequisites and gates.
- Earlier inspection/check records are historical planning evidence. This amendment's validation
  is recorded in the [parallel execution plan](README.md); no product tests are claimed from planning.
- B/T1, B/T2 storage, G/T2 publication and P1–P8 allocated proof: **not started**. Required product proof, gates, independent review, accepted integration
  and cleanup remain unfinished until linked to exact evidence.
- Launch: **WAITING ON accepted B release, including complete former T1 and shared generated-storage proof**. Verify the committed plan revision, base, branch/path ownership
  and capacity. Do not substitute a planning commit or unmerged sibling for the prerequisite.

The operator opens `/supervise side/artifacts-2` using this absolute plan path and the approved plan SHA.
This is an approved side-work assignment. This side plan is the task owner wherever `/supervise`
refers to a task/phase section. Record progress, review, gate evidence and completion here; do not
create a phase number or mark roadmap tasks complete. Preserve repository contracts, Astra/high,
fresh read-only `sup_review`, all required gates and the linked integration/cleanup conditions.
Send Done / Now / Remaining at start/resume and after each verified step. No automatic task launch,
push or application to the operator database.
