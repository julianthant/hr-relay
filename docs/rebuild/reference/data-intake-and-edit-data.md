# Data intake, OCR, records, and Edit Data

This reference describes spreadsheet preparation, OCR admission, artifact records, and values offered for Rerun. The [dashboard surfaces](dashboard-surfaces.md) reference owns presentation and remaining wiring.

| Concern | Owner |
| --- | --- |
| Canonical fields and cell coercion | `src/models/fields/` |
| Intake projections, mappings, validation, manifests, and wires | `src/models/intake/` |
| Upload, readback, and command preparation | `src/backend/runs/commands/intake-service.ts` |
| Intake mutations and enqueue | `src/backend/runs/commands/command-kernel.ts` |
| CSV and XLSX parsing | `src/backend/processing/spreadsheet/` |
| OCR form vocabulary, instructions, and admission | `src/models/ocr/` |
| Processing tasks | `src/backend/processing/{extraction,ocr,roster,normalization}/` |
| Durable artifact records | `src/backend/storage/sqlite/` |
| Content-addressed bytes and workbook publication | `src/backend/storage/artifacts/` |
| Context Data and Rerun values | `src/backend/runs/queries/data.ts`, `src/backend/runs/start/` |

[Task contract](task-contract.md) owns task effects and observations. [Workflow model](workflow-model.md) owns execution and checkpoint replay. [Write safety](write-safety.md) owns transaction authorization and uncertain writes. [Operator trust](operator-trust.md) owns evidence and egress.

## 1. Canonical fields and intake projections

`src/models/fields/registry.ts` owns `CANONICAL_FIELDS`, the closed `CanonicalFieldIdSchema`, labels, schemas, aliases, examples, classification, and coercers. `defineCanonicalField` validates each example through its coercer and schema. It rejects incompatible classification/transform pairs and ambiguous normalized aliases. Fields without a verified tighter shape carry an `auditNote` rather than an invented restriction.

`src/models/fields/cell-coercion.ts` owns `CellLocation`, `CellCoercionError`, and shared parsing. `eid` accepts the canonical UCPath identifier `/^10\d{6}$/` after digit normalization. `ppsEid` is a separate field. Dates become ISO `DateOnly` values. `parseUsOrIsoDate` accepts US slash or dash forms and resolves two-digit years against `CellLocation.readAt`: the 2000s interpretation unless more than a year ahead, otherwise the 1900s interpretation. It does not infer dates from bare Excel serials.

`defineIntakeProjection` in `src/models/intake/projection.ts` binds workflow input paths to factory-defined canonical fields. Each resolved leaf must be the same schema object as the canonical field, including through supported wrappers and unions. Copies with equivalent validation are refused. A union path must resolve to the same schema object in every arm containing it. A missing or omissible arm makes the target non-required.

The projection fingerprint includes target id, canonical id, requiredness, and schema hash. `intakeProjectionRegistry` in `src/workflow-kit/validation/workflow-module-audit.ts` checks factory provenance and descriptor input-schema identity.

`src/workflows/person-lookup/workflow.ts` declares the current registered projection: `emplId → eid` and `name → fullName`. Neither target is individually required because `PersonLookupInput` accepts either identifier shape. The assembled row must still pass that whole input schema. Run options retain their workflow defaults and are not mapped columns. Separations has no intake projection.

## 2. Operator column mapping

### 2.1 Column identity and mapping shape

`src/models/intake/mapping.ts` owns `DetectedColumnSchema`, `ColumnBindingSchema`, and `ColumnMappingSchema`.

A column has its original header, normalized header, duplicate occurrence, current index, samples, and `sourceColumnId`. The id is base64url canonical JSON of `{normalizedHeader, occurrence}`. Duplicate headers remain distinct. The index locates a cell only after column identity resolves.

A binding records `targetFieldId`, `canonicalFieldId`, `sourceColumnId`, and `confirmedAt`. Bindings key on target paths, so two paths may share one canonical concept. A mapping also records workflow, projection fingerprint, layout fingerprint, header row, columns, and `savedAt`.

`headerFingerprint` hashes sorted normalized-header/occurrence pairs. It ignores column order while preserving duplicate counts. `deriveMappingSnapshotHash` separately hashes workflow, sheet, header row, layout, bindings, and constants. It excludes confirmation times, corrections, and exclusions. The manifest records corrections and exclusions separately.

### 2.2 Upload and durable preparation

`POST /api/v1/intake/files?workflow=<id>&filename=<name>` accepts bytes rather than a command envelope. `src/backend/transports/http/routes/intake.ts` returns 201 for `created`, 200 for `joined`, and 422 with `INTAKE_<CODE>` for a parser refusal.

`createIntakeService` validates these upload limits before publication:

- Nonempty bytes, at most `INTAKE_UPLOAD_MAX_BYTES` (25 MiB).
- Filename length 1–255.
- Media type `text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, or `application/vnd.ms-excel`, with header parameters removed.
- Registered descriptor and intake projection.
- XLSX archive signature for non-CSV claims.

The service writes immutable bytes through the content-addressed writer, then prepares the spreadsheet. Recognized CSV and XLSX format errors become `unreadable-file`; other errors propagate. An invalid file can therefore leave published bytes without a session. Upload does not enqueue a run.

Within an authority transaction, upload joins an active same-workflow session with the same digest. Otherwise it creates a `mapping` session at version 1 with empty bindings, constants, corrections, and exclusions. The session retains the full `ArtifactRef`, original filename as `sourceName`, selected sheet/header, actor, timestamps, and a newly reserved manifest id. Enqueued imports are not joined.

`GET /api/v1/intake/:sessionId` re-derives columns, samples, suggestions, validation, comparison, and review binding from the immutable source and durable decisions. `src/models/intake/wire.ts` validates their strict wire shape. Missing sessions/manifests and inconsistent terminal identities fail.

### 2.3 Saved-mapping reuse

`resolveSavedMapping` is a pure offer resolver. It refuses `workflow-mismatch`, `projection-changed`, and `layout-mismatch` before resolving individual bindings. Resolutions are `held`, `confirmation-required`, or `unbound`. Duplicate headers and moved columns require confirmation. Missing targets, canonical changes, and absent columns unbind with a reason. The stored index never substitutes for column identity.

`heldBindings` returns only held target ids. These helpers have no application caller or durable saved-mapping writer. Current uploads start with empty mappings or join their existing active preparation.

### 2.4 Per-cell coercion

`validateIntakeRows` in `src/models/intake/validate.ts` applies constants, confirmed bindings, and row corrections. A mapped value passes through the canonical field's coercer and schema, then the assembled object passes through the full projection input schema.

Only `CellCoercionError` becomes a located `cell-coercion` rejection. Other coercer faults propagate. Blank optional cells omit the target. Required blank cells reject. A missing bound column throws instead of validating a shorter row.

Local rejection raw values and correction originals use `retainLocalEvidenceValue` in `src/rules/redaction/redaction.ts`. Values remain complete locally even where the diagnostic transform is restrictive. That local retention does not authorize provider egress.

### 2.5 Suggestions and confirmation

`suggestBindings` in `src/models/intake/suggestions.ts` ranks aliases, labels, token overlap, and real sample coercion. Samples that all fail produce score zero. `SUGGESTION_THRESHOLDS` sets the floor to 0.35 and ambiguity distance to 0.05. Scores are ranks.

Suggestions contain no `confirmedAt` and do not create bindings. `confirmBinding` is the binding factory. The kernel first checks the submitted `headerFingerprint`, declared target, and present source column. A stale layout refuses with `schema-mismatch`.

## 3. Spreadsheet and PDF extraction

`src/backend/processing/spreadsheet/spreadsheet-grid.ts` is the shared CSV/XLSX edge. It uses strict `csv-parse` parsing and `read-excel-file`. CSV has one sheet named `default`; XLSX defaults to its first worksheet. Unknown worksheets, empty sheets, and unreadable files are explicit refusals.

At this edge, date-formatted XLSX cells use UTC calendar components, numbers become decimal text, booleans become `true`/`false`, and nullish cells become blank text. Non-finite numbers also become blank text. Unexpected cell objects throw. XLSX rows are padded to the widest row. CSV inconsistent field counts fail in its parser.

`rankHeaderRows` in `src/rules/intake/header-discovery.ts` considers the first 20 rows. Structure determines candidates; aliases provide a capped bonus. Preselection requires confidence 0.7 and margin 0.1. Ambiguity yields `headerRowIndex: null`, not an inferred mapping.

`createIntakeParser` splits async `prepare` from synchronous `parse`. It retains at most eight grids. A kernel read without the exact prepared artifact/sheet throws. `deriveIntakeParse` honors the selected header or returns `header-row-absent`. Under a settled header it removes wholly blank rows and samples at most five nonblank values per column. Intake `sourceRow` is one-based within that filtered data-row list, not the physical worksheet row.

The registered `extraction/extract-spreadsheet` task uses the same grid edge. It returns columns, rows, header candidates, sheets, and `skippedRows`, with at most three samples per column. Its explicit header selection additionally refuses blank rows and rows without data beneath them as `invalid-header-selection`.

`extraction/extract-pdf-pages` in `src/backend/processing/extraction/tasks/extract-pdf-pages.ts` rasterizes content-addressed PDF bytes to content-addressed PNG pages at scale 2. It copies input bytes for each `pdf-to-img` render and resolves the installed `pdfjs-dist` wasm directory. Errors are `unreadable-pdf`, `empty-document`, and `page-out-of-range`. A requested page window is never clamped. `pageCount` describes the whole document; `sourcePage` retains the original one-based page number. This task does not read AcroForm fields.

## 4. OCR, roster matching, and generated records

### 4.1 Form instructions and OCR admission

`src/models/ocr/form-registry.ts` declares `oath`, `emergency-contact`, and `i9`. Page kinds are `oath`, `emergency-contact`, `i9-section1`, `i9-section2`, `boilerplate`, `unrelated`, and `blank`. Each form owns its fields, mandatory paths, page-kind applicability, and extraction notes. `buildExtractionInstruction` in `instruction.ts` derives the prompt and answer skeleton from that registry.

`admitOcrExtraction` in `src/models/ocr/extraction.ts` is the shared admission gate. It strictly parses form, source provenance, `readAt`, source digest/page, classification, and nullable record. The provenance union retains `provider`, `local-agent`, and `operator`; it does not grant access or change admission rules.

On a data page, every declared path has a raw reading or a typed absence: `not-on-form`, `blank`, or `illegible`. Missing and extra paths refuse. An off-section field accepts only `not-on-form`. A wrong-form or dataless page is admitted with `record: null`, not fabricated answers.

Canonical fields use the same coercers and schemas as intake. Invalid readings remain `unreadable` with raw text and a reason. Missing or unreadable mandatory fields populate `blockingPaths`. Empty `blockingPaths` means ready for review, not approved.

`answersFingerprint` hashes canonical reading facts, excluding producer, time, and confidence. `pageFingerprint` includes classification. `extractionsAgree` also checks form, source digest, and source page. Answer fingerprints alone do not identify a page.

### 4.2 The OCR task and connection refusal

`ocr/extract-form-page` builds the generated instruction, calls the `ocr.extract` capability, and passes its response to the shared gate. The task output is `AdmittedExtraction`, not a separate provider shape. Its declared errors are `ocr-provider-not-connected`, `provider-unavailable`, `incomplete-extraction`, and `unreadable-page`. The contract's default freshness limit is four hours with overrides forbidden.

`createProviderClient` in `src/backend/processing/providers/provider-client.ts` requires the subscription-only OCR adapter policy. With no adapter, an OCR call returns `unavailable` / `adapter-unavailable` / `OCR provider not connected`; the task maps that result to `ocr-provider-not-connected`.

Worker composition registers `ChatGptOcrAdapter` against its issued profile and account owner. The adapter validates artifact bytes, singleton PDFs and response metadata before returning a submitted extraction to the task's admission gate. Its fixed backend model is `gpt-6.1-sol`, independently of assistant preference; an account or model refusal has no fallback. The account establishes a single-use operation before page reads, permits its authenticated initial refresh, and checks the same account revision, profile custody and cancellation through response and usage publication.

Settings Test OCR uses the same page reader and selected account with one fixed synthetic PDF held only in memory. Its exact schema-validated reference identifies those bytes for one invocation; it never publishes a disk artifact. It returns safe completion metadata after extraction admission and known-content verification. It accepts no operator document and creates no workflow checkpoint or business receipt. Composition does not establish live account/model availability or enable a workflow's served switch.

The retained CLI helpers in `src/backend/transports/cli/ocr.ts` generate instructions and admit supplied JSON. They do not implement the subscription connection or authorize agent operation of the HR app.

### 4.3 Stack classification and grouping

`src/models/ocr/stack.ts` consumes a `ClassifiedStack`; it does not perform image classification. Duplicate `sourcePage` values refuse. `groupStack` puts each supplied page in a subject, `unidentified`, `otherForms`, or `dataless` bucket.

`personMatchKey` lowercases and sorts alphabetic name tokens, drops single-letter tokens, and requires at least two tokens. Matching is exact across the whole supplied stack. It does not pair adjacent pages or infer fuzzy name matches.

A subject is `complete`, `duplicate`, or `incomplete`. Duplicates take precedence, while `missingKinds` still names absent sections. An I-9 comprises Section 1 and Section 2 pages; an orphan section remains visible as incomplete. `reportStack` exposes classified/accounted totals and kind counts. The schema does not prove the supplied classifications cover every page of the original PDF.

### 4.4 Durable extracted records

The native `artifacts` table stores `imported`, `extracted`, and `generated` rows. `AuthorityDatabase.authority.ocrExtractions` stores admitted OCR records under `${sourceSha256}#${sourcePage}#${formType}`. An identical whole-record replay returns `existing`; different content at that key throws. Producer or timestamp changes can therefore conflict even when answer fingerprints agree.

`src/backend/storage/sqlite/extracted-artifact-row.ts` checks record/column identity on document queries. `artifacts_extracted_immutable` in `migrations.ts` refuses updates. Storage does not publish task output to review.

The `review` and `people` section names and review-record schemas exist. `buildRunSection` in `src/backend/runs/queries/run-sections.ts` currently throws `SectionUnavailableError` for them. There is no served OCR acceptance/correction/child-dispatch flow.

### 4.5 Roster matching and contact advice

`roster/match-spreadsheet` re-parses the roster through the shared grid edge. It verifies the mapping layout fingerprint and requires EID and full-name bindings. Its errors are `roster-unreadable`, `mapping-mismatch`, `no-eid-column`, and `no-name-column`.

`src/rules/matching/roster-match.ts` owns scoring and mismatch decisions. A claimed EID is not replaced by a different name match. `name-eid-conflict` has confidence zero; distinct-EID top ties are `ambiguous`; `no-match` has `matchedEid: null`. `src/rules/matching/match-confidence.ts` owns tiers: high at 0.6, low below 0.4, otherwise medium. The task's default freshness limit is 24 hours. Matching returns records and performs no workbook writes.

`normalization/read-contact-advice` applies deterministic relationship, phone, country, state, and ZIP rules. Optional geocoding uses Census before Nominatim for US-shaped addresses, otherwise Nominatim. It records city/state/ZIP advice and observation provenance; it does not offer street-line replacements. Its output includes `normalized`, `relationshipCanonical`, `changes`, and `complete`, `ambiguous`, or `advisory-unavailable` disposition. Ambiguity takes precedence when unresolved fields remain. No AI normalization arm exists. This read task does not approve or submit the advised values.

### 4.6 Workbook projections

`DurableArtifactProjectionSpec` in `src/models/workflow/artifact-projection.ts` declares a producing node/path, record schema, stable key fields, sink, and blocking behavior. The workflow factory validates declarations. The executor commits a checkpoint and derived update rows together, then blocks on its injected projector. Missing wiring or projection failure is a node failure, not a successful run or a dedicated parked-projection state. No registered workflow currently declares `artifactProjections`.

`createArtifactSinkProjector` in `src/backend/storage/artifacts/artifact-sink-projector.ts` resolves pending updates through `artifactOutbox`, `artifactSinkHeads`, and `generatedArtifacts` repositories over the native artifact store. It acquires an exclusive destination lock, checks update order and publication generation, and skips already-projected updates. Head advancement and acknowledgment commit together after file publication. Failed publication remains `failed` or `conflict` and propagates.

`createXlsxRetentionSink` in `xlsx-retention-sink.ts` owns the four-column layout `stableKey`, `keyValues`, `record`, `projectedAt`. It upserts by stable key and verifies the current head and retained bytes before writing. Existing unowned files, missing recorded files, symbolic-link destinations, and changed bytes refuse. A head-hash conflict preserves the operator file and writes the intended update beside it as `.pending-<outboxId>.xlsx`.

Publication verifies content-addressed readback, prepares the publication identity, stages with exclusive creation, syncs bytes, rechecks the destination, replaces it, syncs the directory, and verifies published bytes. A file replaced before database acknowledgment can leave uncertain publication; ordinary replay does not declare success from file presence alone. Operator retention columns are absent.

## 5. Validation, manifests, and enqueue

### 5.1 Row dispositions and manifest evidence

`RowRejectSchema` has `unmapped-required`, `cell-coercion`, `field-schema`, `workflow-schema`, `duplicate-identity`, and `cross-field` arms. Reject ids derive from source digest, row, kind, and subject. Whole-input root errors become `cross-field` only when at least two bound paths exist; otherwise they remain `workflow-schema`. Identity collisions reject every colliding row.

`buildIntakeManifest` and `IntakePlanManifestSchema` in `src/models/intake/manifest.ts` keep source identity, original filename, five plan fingerprints, parsed input/hash/item ids, corrections, exclusions, rejection entries, and current row dispositions. Shared refinements check total row coverage, unique valid item ids, disposition/reject consistency, and derived totals.

Current dispositions are `valid`, `rejected`, or `excluded`. Rejection entries and current rejected counts are separate. The builder accepts earlier rejection history. Enqueue supplies only current re-derived rejections, not every validation pass.

`deriveIntakeEnqueuePlan` in `src/models/intake/enqueue.ts` revalidates with retained `readAt`. It obtains every correction's original from the immutable bound source cell. Missing rows, targets, or columns throw. Corrections never rewrite source bytes.

`enqueueReadiness` refuses `unresolved-rejections` until every rejected row is corrected or explicitly excluded. Zero valid rows refuse `no-valid-rows`. Unresolved rows block the whole file.

### 5.2 Commands and atomic fan-out

The six intake commands target `{intakeSessionId, expectedVersion}`. `src/rules/commands/commands.ts` owns their envelopes and payloads; `command-kernel.ts` owns application.

| Command | Effect |
| --- | --- |
| `inspect-intake` | Selects sheet/header or an earlier `comparisonManifestId`. A layout change clears bindings, corrections, exclusions, and validation. |
| `confirm-intake-mapping` | Confirms one declared target against the exact header fingerprint and source column. |
| `correct-intake-row` | Records a bounded row's replacement text for an already-bound target. Validation later checks the value. |
| `exclude-intake-row` | Records a bounded row and nonempty reason. A different reason for an existing exclusion refuses. |
| `validate-intake` | Runs validation and retains `validatedAt` and `readAt`, not a stored copy of rows or dispositions. |
| `enqueue-intake-manifest` | Rechecks the reviewed plan, writes its manifest, and queues its valid rows. |

Mapping changes clear validation. Content-identical mapping, correction, and exclusion actions can be no-ops. Preparation commands use current authority rather than applying a general expected-version CAS. Selecting a comparison explicitly checks its observed version. Enqueue always checks `expectedVersion`.

Enqueue requires `validated` state, source filename, reserved manifest id, current descriptor/projection, required target assignments, explicit `dryRun`, supported dry-run behavior, ready dispositions, and exact `reviewBinding`. `intakeReviewBinding` in `review.ts` hashes session, normalized proposed manifest, and prior comparison. Missing or stale review binding refuses before fan-out.

The composition's selected config identity must resolve to a stored snapshot with the same fingerprint. Each valid stored input passes protected-input admission and the current transform-free canonical input schema. The kernel refuses an existing reserved manifest rather than adopting it.

`fanOutQueuedRuns` creates independent `shape: "single"`, `priority: "bulk"` runs with fresh identities, stable row item ids, and a shared session whose origin is `intake-manifest`. It applies the descriptor's current enqueue policy. There is no coordinator run.

Manifest insert, run inserts, and session transition to `enqueued` share the outer authority transaction. A refusal rolls back that fan-out. `intakeManifestId` equals `reservedManifestId`; a reservation alone is not a submitted manifest.

`src/backend/storage/sqlite/imported-artifacts.ts` keeps preparation and submitted JSON on one `artifacts` row. It checks workflow/source linkage, immutable reservation, predecessor version, and immutable submitted preparation. `artifacts_import_submission`, `artifacts_identity`, `artifacts_no_replace`, and `artifacts_retained` in `migrations.ts` protect submitted import identity, content, and retention.

### 5.3 Earlier-import comparison

`resolveIntakeComparison` accepts an explicit earlier same-workflow manifest, including a different source digest. Without an explicit choice it selects the unique latest same-digest manifest no later than session creation. The current reservation and future manifests are ineligible; tied latest timestamps throw.

`rerunDiff` compares source artifact, mapping snapshot, intake projection, workflow contract, and canonical-input schema. Membership uses stable `itemId`, not row positions. Same-item input changes appear in `changedInputs` as before/after hashes. Missing facts refuse rather than producing an empty diff. The wire's terminal manifest uses the exact committed id even when newer imports exist.

## 6. Context Data and values for Rerun

### 6.1 Read-only Context Data

`src/backend/runs/queries/data.ts` builds `context-data` from canonical run authority and descriptor-declared `capabilities.editData.fields`. The name remains in the descriptor; the served data section has no save policy or checkpoint-edit command.

The query checks run, workflow/item, attempt, claim generation, descriptor identity, and output-schema hash before exposing a scalar. It distinguishes absent checkpoints, absent outcome fields, malformed coordinates, deleted runs, and unavailable readers/descriptors. Entries carry node/field coordinates, checkpoint evidence, provenance, and declared origin/freshness where available. Run observations remain separate from checkpoint entries.

### 6.2 Source-bound Rerun

`src/backend/runs/start/plan.ts` and `rerun.ts` plan a new run from operator-submitted values and selections. The source remains read-only. `buildRerunPlan` checks source id/version, descriptor/input/checkpoint compatibility, selected required steps and omission cascades, and copied-value attribution. It refuses sources outside terminal `done`, `failed`, or `interrupted`, and sources with uncertain writes.

Prior transactions provide repeat-warning evidence, not execution authority. The warning acknowledgment and final start consumption remain separate boundaries. [Write safety](write-safety.md) owns their execution and repeat-consent requirements.

### 6.3 Declared fields and checkpoint patches

The workflow factory still validates `capabilities.editData.fields`: fields belong to checkpoint-replayed task nodes and resolve through their output schema. Transaction proof fields and always-rerun nodes cannot be declared there. Person Lookup declares its three CRM date paths for Context Data.

`RunEnvelope.injected` and executor patch-consumption code remain internal model/runtime facilities. The executor applies patches only during checkpoint replay, validates the whole patched output, and refuses leftover corrections for nodes it executes instead. `RunCommandRequestSchema` contains no `edit-checkpoint` arm. There is no dashboard save endpoint.

### 6.4 Explicit values offered from completed output

`readRerunValues` in `src/backend/runs/start/rerun-values.ts` uses one authority read snapshot. It validates source eligibility, descriptor, canonical input, source-owned checkpoints/gates/failures, and transaction proof relationships.

The descriptor's `rerunValues` mappings name exact source node/field and target input or omission field. Available values need completed source facts, recorded provenance, compatible target schemas, and no retained protected data. Unavailable reasons include `not-completed`, `not-recorded`, `protected`, `target-invalid`, and `provenance-unavailable`. Malformed source evidence refuses.

When plain-parser source input is withheld as protected, Rerun offers only declared ingress identity fields accepted unchanged by the current input and canonical schemas. Each field is checked separately against protected bindings and embedded protected values. Safe identity fields use the partial source-input response; protected identity remains unavailable. Unprotected source-input responses keep their existing shape. Server-owned values such as `timekeeperName` stay off this wire; new Rerun plans reuse their retained source bindings through protected-input admission.

Omitted-step assertions are unfinished facts, not observed completion. The response contains source coordinates, steps, values, and transaction warning facts. It creates no plan, repeat consent, run, checkpoint, or settings change.

## 7. Intake boundary protections

These rules identify the enforcing seam rather than relying on presentation alone.

1. `suggestions.ts` proposes; `confirmBinding` mints a confirmed binding.
2. `mapping.ts` resolves column identity before using its index and refuses mismatched saved layouts.
3. `validate.ts` converts only typed coercion refusals and rejects all colliding identities.
4. `manifest.ts` checks row coverage and totals; `enqueueReadiness` blocks unresolved and empty plans.
5. `command-kernel.ts` rechecks version, exact review binding, reserved identity, snapshot, and canonical inputs before atomic enqueue.
6. `defineIntakeProjection` requires the canonical schema object at every mapped leaf; `intakeProjectionRegistry` requires the descriptor's input schema object.
7. `admitOcrExtraction` checks every declared field and typed absence without granting weaker admission to a producer.
8. `groupStack` matches exact name keys across the supplied stack and keeps unidentified, duplicate, incomplete, and wrong-form pages visible.
9. `imported-artifacts.ts` and native triggers hold submitted import content immutable; OCR insertion refuses a different whole reading at an existing page/form key.
10. `artifact-sink-projector.ts` and `xlsx-retention-sink.ts` serialize publication and refuse unowned or changed workbook bytes.
11. `rerunDiff` compares stable-item membership separately from changed input hashes.
12. `data.ts` serves checkpoint values for reading; the start planner admits new Rerun values without mutating the source.

Tests mirror the model, rule, command, query, start, and artifact owners. `tests/architecture/processing/` contains `intake-canonical-field-registry.test.ts` and `intake-mapping-boundary.test.ts`. Declared scenario ids do not establish live results.

## 8. Validation example

`tests/models/intake/validate.test.ts` uses `createWorkStudyIntakeFixtures` from `tests/support/helpers/intake/work-study-fixtures.ts`. This is a model fixture, not a registered Work-Study workflow or a live run.

Its 42 rows bind EID and department, with a supplied effective-date constant. The name column is unbound. Row 17 carries `10-4567` and row 31 carries `TBD`. Validation returns 40 valid rows and two located `cell-coercion` rejections. `enqueueReadiness` returns `unresolved-rejections`, naming rows 17 and 31. Corrected or explicitly excluded rows are revalidated; the source artifact remains unchanged.

## Not built yet

- Settings' ChatGPT-subscription OCR connection: OAuth with PKCE, a loopback redirect on `127.0.0.1`, plan-usage scopes, Responses API requests, and tokens confined to the local credential store. No other AI provider is permitted.
- Served OCR record review, corrections, acceptance, and replay-safe child dispatch over admitted artifacts.
- Saved-mapping persistence, visible reuse, and commands for constants and unbinding targets.
- Workflow declarations and operator workbook columns for retention projections, including I-9 consumers.
- Dashboard connections for Intake, OCR, Records, and Rerun values through the existing component set and shared client/models.
