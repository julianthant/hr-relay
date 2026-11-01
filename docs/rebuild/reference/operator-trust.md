# Operator trust

Relay keeps operator evidence locally. Receipts describe retained authority, failures describe the
recorded error and write state, and diagnostic captures bind their metadata to verified files.
Local evidence can contain complete HR values. Provider requests and desktop notifications are
separate boundaries; a local classification does not authorize sending a value outside Relay.

This reference owns evidence, diagnostics, receipts, and notification trust. [Write safety](write-safety.md)
owns external-write admission and recovery. [Clock, config, and secrets](clock-config-secrets.md)
owns credentials and runtime authority. [Dashboard surfaces](dashboard-surfaces.md) owns the rendered
operator views. [Workflow model](workflow-model.md) owns the registered workflow definition.

## Local evidence and redaction

`src/rules/redaction/redaction-policy.ts` defines five classifications and six transforms. The
closed transform policy used by `redactValue` is:

| Classification | Permitted transforms |
| --- | --- |
| `secret` | `drop`, `digest` |
| `credential-file` | `drop`, `digest` |
| `direct-identifier` | `drop`, `digest`, `last4` |
| `sensitive-hr` | `drop`, `digest`, `count` |
| `safe-diagnostic` | `allow`, `count`, `basename` |

`redactValue` in `src/rules/redaction/redaction.ts` refuses a forbidden pair. Digests use
`redactionDigest` over canonical JSON, with a versioned domain prefix. `basename` recognizes both
path separators. `count` returns a string or array length, object-key count, or one for another
JSON value. These transforms do not recover an original value.

Local evidence uses `retainLocalEvidenceValue` instead. It retains the complete supplied JSON as
`state: "allowed", transform: "allow"`, with the original classification. It validates a supplied
non-`allow` transform before retaining the value. `refineLocalEvidenceTransformPair` permits
`allow` for every classification in local evidence schemas. This includes values supplied as
`secret` or `credential-file`; the function does not read a credential source.

`redactDiagnosticFields` uses that local-retention function for each valid classified field.
Malformed fields produce warnings containing the candidate JSON. A non-array input produces a
warning containing the input JSON. `assertDiagnosticExportSafe` in
`src/models/trust/diagnostic-capture.ts` parses `RedactionResultSchema`; it does not scan keys or
remove complete values. The names `redaction`, `RedactedFieldSchema`, and
`assertDiagnosticExportSafe` therefore do not promise that local evidence lacks HR or secret values.

`directIdentifierDisplay` returns the supplied identifier. `directIdentifierDigestReference`
produces a bounded digest reference when a caller selects that representation.
`idempotencyKeyDigestReference` displays the authority digest, or
`protected transaction key (withheld)` for protected transaction input. Natural transaction keys
remain separate from that operator reference.

### Classified receipt and observation leaves

`src/models/trust/evidence-classification.ts` owns `EVIDENCE_FIELD_CLASSIFICATIONS`. Every declaration
names a scope, dotted leaf path, classification, and permitted transform. The scopes are
`workflow-input`, `workflow-result`, `task-output`, `gate-result`, and `write-proof`. A gate scope
uses the workflow and gate identities because a gate owns no task contract.

`evidenceLeaves` sorts object keys, recurses into populated objects, and treats an array or empty
object as one leaf. `classifyEvidenceLeaf` refuses an undeclared leaf by its scope and path.
`redactEvidenceLeaf` uses the declaration through `redactDiagnosticFields`, so its current local
output retains the supplied value. The declaration remains mandatory even when local retention
changes its output transform to `allow`.
`run-logs.ts` resolves observations from exactly one descriptor data origin for the node/task pair; a service origin without a browser system stays absent, and missing or ambiguous origins refuse.

`src/backend/logs/observed-data.ts` and `src/backend/runs/provenance/evidence-receipt.ts` share this
classification owner. A fixture's extra leaves also need declarations. A task's input binding,
output provenance, and receipt source remain distinct facts.

### Diagnostic text and browser summaries

`sanitizeDebugText` in `src/rules/redaction/redaction.ts` removes credential-named JSON values,
credential assignments, Bearer or Basic authorization text, private-key blocks, and URL credentials,
query strings, and fragments. It preserves other text. It is a text sanitizer, not a general HR-value
redactor.

`src/backend/logs/debug-events.ts`, `src/backend/logs/emergency-faults.ts`,
`src/backend/runtime/execution/run-failure.ts`, and the note/timeline writers under
`src/backend/storage/events/` apply that sanitizer at their respective text boundaries.
The worker logger in `src/backend/app/composition/worker-compose.ts` sanitizes its message and
string-valued fields. Local diagnostic-field retention is a separate path.

`attachBrowserDiagnostics` in `src/backend/runtime/browser/browser-diagnostics.ts` collects bounded
console kinds, request methods, error-response statuses, and instants. Each console or network list
holds at most 128 rows. Its summaries omit console text, page-error text, request bodies, headers,
and URLs, and record the omission count. These summaries do not substitute for a screenshot.

## 2.1 Failures and follow-up

`FailureRecordSchema` in `src/models/trust/failure.ts` carries run, trace, attempt, workflow, optional
node/task, code, summary, cause chain, remediation, fingerprint, and occurrence time. Its write states
are `not-attempted`, `prepared`, `attempting`, `committed`, `verified`, and `unknown`.

The schema requires exactly one primary cause, and the record's `transient` flag must match that
cause. A subject, page, or action block cannot be empty. `attempting` and `unknown` require an action
whose operation is `commit`. Transience does not establish retry permission.

`src/backend/runtime/execution/run-failure.ts` builds failure records and bounded debug details.
The optional `diagnosticSafetyVersion: 1` remains a recorded field.
`projectFailureForOperator` serves the catalog sentence for the failure's code as `summary`. A code
absent from the catalog uses the unregistered-code sentence. When the run retains protected input,
the projection drops raw diagnostic text. The authority record keeps the original summary, and
explain prints that diagnostic when the run has no protected input. Names such as `urlRedacted`,
`titleRedacted`, and `displayRedacted` describe producer fields. A protected-input projection also
omits those display strings.

`src/backend/runs/queries/run-detail/receipts-failures.ts` projects the explicit
`FailureDetailWireSchema` fields. It checks the failure's exact run/workflow/trace/attempt identity
through `assertTrustEvidenceIdentity` in `src/backend/runs/trust/run-reader.ts`. A diagnostic link
must name that failure's exact bundle and agree with the run-indexed bundle record. A nearby capture
or matching timestamp cannot replace the named record.

`src/models/dashboard/failure-display.ts` derives concise display from typed failure information.
The detailed record retains summary, code, causes, remediation, and write state. Available controls
come from the server's command descriptors; a display label does not grant a retry or submission.

Failure follow-up is a separate versioned annotation. `src/models/trust/failure-resolution.ts`
defines `unresolved` and `resolved`, with actor, instant, and an optional note on the resolved arm.
`src/backend/runs/queries/failure-resolution.ts` requires the annotation when reading its failure.
Its protected-input projection withholds a resolved note when required. The annotation does not
change the failure fingerprint, run outcome, receipt, or uncertain write state.

## 2.2 Diagnostic captures

`DiagnosticBundleSchema` in `src/models/trust/diagnostic.ts` defines the capture manifest.
`src/backend/logs/diagnostics/diagnostic-capture.ts` owns `createDiagnosticCaptureService`.
The service supports `prepare`, `persist`, `discard`, and `capture`.

`DiagnosticCaptureTriggerSchema` in `src/models/trust/diagnostic-capture.ts` admits
`unexpected-state`, `task-failure`, `subject-mismatch`, `recovery-park`, and `operator-request`.
`diagnosticOriginOfTrigger` requires a failure identity for an automatic capture and a requesting
actor for an operator capture. It forbids the other identity before artifact work.

`prepare` validates the origin, supplied operation identity, classified fields, attachments, and
retention. It stages attachments and derives a manifest digest from the run, origin, capture time,
config and descriptor fingerprints, retained fields, attachments, and optional operation identity.
`persist` admits only its owned preparation or a matching stored replay. Attachment publication and
the repository insert use `insertPrepared`; cleanup distinguishes unpublished stages from committed
artifacts. A failed cleanup remains a failure rather than disappearing.

The service accepts these attachment types:

| Kind | Media types | Sensitivity and size |
| --- | --- | --- |
| `screenshot` | `image/png`, `image/jpeg` | `redacted` or `restricted`, required width and height, at most 10 MiB |
| `accessibility-excerpt` | `text/yaml` | `redacted`, at most 1 MiB |
| `network-summary` | `application/json` | `redacted`, at most 1 MiB |
| `console-summary` | `application/json` | `redacted`, at most 1 MiB |

Attachments must contain bytes, and the total bundle limit is 50 MiB. Only screenshots may remain
`restricted`. The capture service validates the declared sensitivity and shape; it does not inspect
image pixels or sanitize arbitrary attachment text itself. The producer owns the supplied content.

`src/backend/logs/diagnostics/run-diagnostic-capture.ts` classifies structured failure fields and
selects the failure trigger. It adds attachments only through its optional `attachmentsFor` port.
A capture without that port has structured fields and no invented image. The worker composition
binds the failure capture and selected browser-screenshot capture separately.

Failure settlement uses the prepared bundle identity and persists the capture with the terminal
failure transaction. The execution owner is `src/backend/runtime/execution/run-executor.ts`.
Receipt derivation remains separate from terminal settlement.

### Selected browser screenshots

`createRunBrowserScreenshotCapture` in
`src/backend/logs/diagnostics/run-diagnostic-capture.ts` uses `operatorRequestedCapture` and
`local-operator`. It records the browser system, lease outcome, and any capture-unavailable reason.
A successful capture carries viewport PNG bytes, dimensions, and `restricted` sensitivity. Browser
console and network summaries may accompany it.

`src/backend/runtime/workers/worker-sessions.ts` captures before lease teardown. Successful leases
capture when the run selects screenshots. Failed operations attempt a capture whenever the worker
holds run screenshot context, even if the success-capture flag is false. The browser-session factory
in `src/backend/runtime/browser/browser-session-factory.ts` supplies the bytes. Missing capture
support or failed persistence remains a failure, and combined failures remain an `AggregateError`.
Diagnostic screenshots do not create a phone upload or remote capture service.

### Verified readback and downloads

`src/backend/runs/queries/diagnostic-bundle.ts` owns `readDiagnosticBundle`,
`readDiagnosticBundleAttachment`, and diagnostic artifact membership reads. It admits the canonical
run through `requireTrustRun`, validates the exact bundle identity, recomputes the content digest,
and compares every attachment-index row with the manifest. It verifies byte count and digest through
`src/backend/storage/artifacts/server-verified-artifact-reader.ts` before returning the wire or
canonical manifest.

The reader rechecks run membership and unchanged bundle authority after byte verification.
Attachment downloads bind the exact artifact to the verified bundle and use a verified byte lease.
A loose artifact id does not establish access. Missing targets, purged captures, missing bytes,
operational read failures, and corrupt evidence remain distinct refusals. The route handlers under
`src/backend/transports/http/` retain the download headers and exact membership checks.

`src/backend/runs/queries/run-captures.ts` builds the run's verified capture view. Optional operation
identity binds a capture to an exact retained action occurrence. Unbound captures remain captures;
the query does not manufacture an association from current inputs or a timestamp.
`run-captures.ts` joins an artifact only when its complete verified metadata agrees and retains every same-run diagnostic-bundle origin; run status and nearby failures never supply provenance.

### Retention and custody

`planDiagnosticRetention` in `src/models/trust/diagnostic-capture.ts` derives an ordinary deadline
from the capture instant plus `DIAGNOSTIC_ORDINARY_RETENTION_DAYS`, which is 30. A pin carries a
reason and no purge deadline.

`createDiagnosticRetentionSweep` in `src/backend/logs/diagnostics/diagnostic-retention.ts` reads due
records, re-evaluates their disposition at one instant, and delegates purge to the canonical
lifecycle service. It reports purged records, vanished records, and artifact ids without a remaining
diagnostic reference. No production caller schedules this sweep. A deadline alone does not prove
that bytes were purged, and the sweep's report does not prove another evidence owner released them.

`src/backend/storage/sqlite/migrations.ts` creates `diagnostic_snapshots`, `diagnostic_files`,
`run_failures`, and `run_receipts`. The repository API retains names such as `diagnosticBundles` and
`evidenceReceipts`; API names do not imply tables with the same names. Canonical deletion and file
custody belong to `src/backend/storage/sqlite/native-run-deletion.ts` and the lifecycle service.

## 2.3 Run receipts

`RunEvidenceReceiptSchema` in `src/models/trust/evidence.ts` accepts composition `5`.
It carries the receipt/run/trace/workflow identities, attempt, terminal instant, descriptor and config
fingerprints, `retryOf`, optional failure, input, observations, decisions, actions, verification,
output, reuse, warnings, confidence, and result.

`src/backend/runs/provenance/evidence-receipt.ts` derives those facts from the canonical run,
immutable terminal result or failure, checkpoints and provenance, durable gate results, write
intents, and write attempts. `src/backend/runs/trust/receipt-service.ts` supplies these records
inside an authority transaction. It uses the run's retained contract and config fingerprints.
It does not claim the current checkout executed an older run.

`ensureRunEvidenceReceipt` refuses a non-terminal run and a terminal `interrupted` run awaiting
recovery. Receipt identity derives from the run and attempt, evidence-entry identity derives from
the receipt/kind/key, and `generatedAt` is the terminal instant. Sorted leaf traversal preserves a
deterministic fact order.

A stored receipt is immutable. `ensureRunEvidenceReceipt` re-derives it, evaluates compatibility
through `src/backend/runtime/writes/receipt-derivation-binding.ts`, and uses the repository's immutable insert.
A divergent derivation refuses instead of overwriting the record. Classification and obligation
changes can change a receipt even when a descriptor's import fingerprint does not change.
The compatibility checks compare workflow identity, descriptor version, canonical input, evidence
graph, terminal dependency set, and declared evidence. Each reports `held`, `moved`, or
`not-evaluated`; no waiver authorizes replacing an incompatible receipt.

### Facts, decisions, and write proof

Every evidence row has an `EvidenceEntryId`. Satisfied facts contain their declared local value and
source. Unresolved facts contain a reason. Source arms distinguish input, system, checkpoint,
gate result, external gate-source event, operator correction, derived evidence, and operator
assertion. The derivation checks that cited evidence rows exist in the receipt.

`src/models/trust/evidence-obligations.ts` declares cross-source comparisons. The receipt records
the comparison verdict and supporting facts. Missing sources remain absent or unknown rather than
becoming agreement between the remaining sources.

`src/models/trust/gate-decisions.ts` declares gate outcome arms. Receipt derivation reads
`authority.gateResults`, including its recorded actor and instant, rather than a span's display key.
An undeclared gate or outcome refuses derivation. A conditional gate that does not run carries its
declared branch reason rather than an invented approval.

A commit action may carry `proved`, with system, public transaction-key digest, declared completion
kind, proof source, classified proof values, and recorded instant. The completion kinds are
`receipt`, `save-verify`, and `upload-verify`. Proof sources are `normal-output`, `recovery-probe`,
`operator-attestation`, `durable-intent`, and `live-probe`. A non-commit action cannot carry that
block. A verified write action requires a binding-proof reference.

A prepare output stays in memory under its task contract. A transaction checkpoint records the
transaction outcome and its completion evidence. A graph walk alone does not prove that the executor
read that checkpoint or terminalized from it.

### Verdicts and uncertainty

The receipt schema enforces these combinations:

| Result | Required evidence |
| --- | --- |
| `verified-done` | `verified` confidence, no unresolved mandatory facts or unknown/ambiguous mandatory verification, no warnings, and no failure |
| `done-with-warnings` | At least one warning, no load-bearing warning, and no unresolved mandatory facts or unknown/ambiguous mandatory verification |
| `failed` | A failure identity |
| `cancelled`, `partial` | No failure identity |

Evidence ids must be unique. A `verified` verification row needs evidence. These refinements are in
`RunEvidenceReceiptSchema`; display text does not establish a verdict. The current SQL baseline
does not repeat the old `verified-done` confidence check in the `run_receipts` table definition.

Dry-run envelope and terminal preview schema must agree. A transaction preview records
`DRY_RUN_PREVIEW` as load-bearing uncertainty, with an unknown terminal-result obligation, so its
receipt is `partial` with `unknown` confidence. A preview does not prove an external write.

An omitted task output carries `operator-assertion` source, an assertion decision, and a mandatory
`present` obligation rather than `verified`. `OPERATOR_OMITTED_STEP` is load-bearing uncertainty.
The receipt reconciles the terminal assertion with the exact marked checkpoint, schema hash, output
digest, step, and instant. An omitted transaction has no invented transaction checkpoint.

Reuse rows preserve source, age, and freshness limit. A replay does not become a fresh observation.
A retry keeps its own receipt and `retryOf` relation; Relay has no automatic field-level receipt
comparison. `projectReceiptForOperator` serves the parsed composition-5 receipt without another
value transform.

## 2.5 Explain and operator exports

`src/backend/app/composition/explain-compose.ts` implements
`npm run cli -- explain run <traceId|runId> [--json]`. It admits the runtime, resolves the exact run,
loads the registered descriptor, and uses `createReceiptService` for a settled receipt.
`src/backend/runs/explain/explain-run.ts` assembles state, omitted steps, node dispositions, debug
events, reuse, identity decisions, failure, actions, gates, writes, receipt, and next safe action.

The command's `commandHistory` is absent in its current composition. Its `notifications` field is
always absent and its reason incorrectly says no notification producer is wired. The command does
not read the inbox, so that absence cannot establish that a run has no notification.
`--bundle` refuses, and `explain failure <fingerprint>` is not implemented. The separate
`explain diagnostics` command reads bounded persisted debug pages, or the stopped boot fault spool
with `--boot`.

`src/backend/runs/exports/search-metadata-export.ts` exports the accepted search metadata snapshot.
`src/backend/runs/exports/spreadsheet-csv.ts` protects spreadsheet cells against formula execution.
`operator-xlsx-export-service.ts`, `operator-xlsx-workbook.ts`, and `selection-download.ts` in that
folder bind issued XLSX files to the accepted selection, actor, metadata, and verified bytes.
Local exports preserve values their owning projection supplies. An export is evidence of that
selection and file, not independent proof that an HR transaction completed.

## Provider egress

`ProviderCapabilityIdSchema` in `src/rules/identity/ids.ts` admits `ocr.extract`, `geocode.census`,
and `geocode.nominatim`. The strict request and response envelopes live in
`src/models/providers/providers.ts`; `src/workflow-kit/providers.ts` supplies the narrowed injected
client interfaces. There is no failure-triage, run-summary, selector-suggestion, or other AI advisory
capability in this implementation.

`src/backend/processing/providers/provider-client.ts` validates execution identity and the retained
config snapshot. It parses requests, checks adapter capability, refuses reused request ids, and
applies cancellation and a monotonic deadline. Adapter failure returns an unavailable response
without retry. Invalid adapter results return `invalid-response`. These envelopes are not a generic
PII filter over the payload.

For `ocr.extract`, a configured adapter is refused with `OCR provider policy not connected`.
Calls return `adapter-unavailable` with `OCR provider not connected`.
`src/backend/processing/ocr/tasks/extract-form-page.ts` maps that result to
`ocr-provider-not-connected`. No ChatGPT OAuth connection or Responses adapter is present.

### Address requests

`src/backend/processing/normalization/tasks/read-contact-advice.ts` runs deterministic contact
rules and optionally asks a geocoder when `input.geocode` is true and an address is present.
Its local `before` values use `retainLocalEvidenceValue`. Its provider payload is separately built
as `GeocodeRequestSchema` in `src/rules/normalization/geocode.ts`.

The geocode payload contains complete `street`, optional `city`, `state`, `zip`, and `country`.
It contains no contact name, employee id, telephone, relationship, or `address2`. It does not pass
those address strings through `redactValue` before transmission.
`src/backend/processing/providers/geocode-adapters.ts` sends Census address fields as URL query
parameters to `https://geocoding.geo.census.gov/geocoder/locations`. It sends Nominatim a combined
address query to `https://nominatim.openstreetmap.org/search`.

The task tries Census first for a US-shaped address and Nominatim otherwise or after an unavailable
Census answer. It records unavailable answers and proposed changes with source and confidence.
`no-match` is a produced answer. An unverified match does not apply provider suggestions.
`src/backend/processing/providers/nominatim-owner.ts` owns the shared local channel and request
queue; it does not make the external address query local evidence.

## Notifications and delivery

`src/rules/notifications/notification-triggers.ts` owns `NotificationTriggerEventSchema` and
`projectNotificationTrigger`. Events carry ids, closed codes, counts, and typed storage concerns.
The projection creates repository-authored title and summary text; it accepts no captured form prose.
The event-to-inbox mapping is:

| Event | Trigger | Channel |
| --- | --- | --- |
| `run-failed`, `subject-mismatch` | `failed` | `ping` |
| `gate-opened` | `gate-waiting` | `ping` |
| `write-parked` | `write-parked` | `ping` |
| `repeating-failure` | `repeating` | `ping` |
| `storage-degraded` | `storage` | `ping` |
| `verified-done` | `verified-done` | `inbox` |
| `backfill-gap` | `backfill-gap` | `ping` |

`src/backend/runs/notifications/inbox.ts` creates or folds the row and records its publication
source in one authority transaction. Same-source replay is `existing` and leaves the inbox state
unchanged. Divergent source content refuses. A distinct occurrence with the same actor and dedupe
fingerprint folds the row. Publication validates a run-linked event against canonical run and
workflow identity.

`src/backend/storage/sqlite/authority-database.ts` owns notification create, fold, and versioned
state updates. A fold increments count and version, updates last-seen time, and marks the row unread.
Read state and snooze are independent. The command kernel applies actor and expected-version checks.
Backfill-gap rows remain immutable. Notification mutability does not make receipt or write evidence
mutable.

After durable publication, the inbox reports `suppressed-snoozed`, `no-channel`, or
`not-requested-existing`. There is no OS delivery implementation, and a `ping` channel does not
prove that a toast was sent or seen. The current notification renderer uses its own view model;
its presence does not establish a connected desktop delivery path.

### Production observations

`src/backend/app/composition/dashboard/notification-sources.ts` reads canonical live runs inside
one authority snapshot. It observes failures, subject mismatch, gate parks, write parks, repeating
failures, and qualifying stored receipts. It checks exact failure and receipt identities before
projecting events. A verified-done notification requires a non-dry-run terminal `done` run and a
`verified-done` receipt with `verified` confidence.

Repeating failures group retained live failures by workflow, node or task, and code. The third
distinct failure crosses the threshold; later distinct failures fold it. The reader does not include
archived source generations or infer evidence for a receipt that is missing.

`notification-health.ts` in that composition folder owns durable health observations and threshold
sampling. `src/backend/runs/notifications/backfill-gap.ts` publishes explicit server-resume gaps;
a disconnect or timeout alone does not establish a gap.

`createNotificationObserver` in `src/backend/runs/notifications/observation.ts` serializes reads
and publications, retains failed pending occurrences, exposes closed observation diagnostics, and
awaits in-flight work on stop. It removes pending occurrences only after durable publication.
`src/backend/app/composition/dashboard/compose.ts` invokes the observer at startup and on its watch
interval. The inbox cannot store an alert while its own authority is unavailable; the dashboard's
storage failure response remains the separate indication of that condition.

## 5.2 Semantic UI and Explorer evidence

`src/models/ui/contracts.ts` defines the shared semantic vocabulary. `ElementId`, `ScreenId`,
`PageStateId`, and `ObservationId` come from `src/rules/identity/ids.ts`. Evidence-entry occurrence
identity remains separate from semantic UI identity.

Each system's `src/backend/systems/<system>/driver/ui-registry.ts` owns its locator, page-state,
and observation recipes. Verification records name both fixture and read-only live evidence under
`tests/support/fixtures/ui/<system>/`, with registered verification scenarios. A recorded
`verifiedAt` does not prove the current external page still matches. `exactly-one-visible` and
`exactly-one-editable` state different observations; neither claims an external write.

`src/models/ui/driver.ts` defines the typed driver boundary, and
`src/backend/systems/browser-shared/semantic-ui-effect.ts` adapts registered effects and sensitivity.
Tasks use registered driver operations instead of inventing selectors. The system driver owns raw
browser access. [Task contract](task-contract.md) and [write safety](write-safety.md) own the task
context and commit capability.

`src/backend/systems/ui-task-links.ts` derives Explorer links from the semantic registries.
There is no generated UI catalog, catalog endpoint, or selector-search command.
`src/backend/runs/queries/explorer.ts` projects registered descriptors, compiled definitions,
sealed contracts, source manifests, and semantic links. It reports unresolved
source links explicitly and does not infer live run observations. Missing `tests/scenario` sources
remain unresolved references rather than fabricated replacements.

## 5.4 Read-only Explorer

Explorer has one generated definition query. Its labelled fictional examples and local branch controls
change only the preview. There is no edit validation endpoint, edit command, hot override repository,
or source-change draft generator. Workflow labels, icons, categories and policy remain definition-owned.
The forward migration removes editor-only override rows and exact Explorer edit command/audit history,
while foreign-key references from retained data refuse the migration transaction.

## Not built yet

- Settings must connect OCR through Sign in with ChatGPT, OAuth with PKCE and loopback redirect,
  the Responses API, and tokens held in the local credential store.
- Notification wiring must connect the approved drawer controls and silent desktop Pings with
  explicit enablement, one same-origin tab owner, and no toast replay on startup or reconnect.
- Workflow acceptance must prove real receipt, failure, capture, and notification behavior through
  the served dashboard and a dry run before operator sign-off.
