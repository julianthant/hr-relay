# Task contract

A task declares one bounded operation, its input and output schemas, its effect, and its failures.
`defineTaskContract` declares the browser-safe contract. `defineTask` binds its implementation.
The runtime validates both sides before another node can consume the output.

This reference owns task declarations, task context, observations, failures, and task registration.
[Workflow model](workflow-model.md) owns composition and replay.
[Write safety](write-safety.md) owns fenced writes, proof, recovery, and parked resolution.
[Execution and sessions](execution-and-sessions.md) owns worker and browser lifetime.
[Operator trust](operator-trust.md) owns evidence classification and serving.
[Stores](stores.md) lists the registered tasks.

## 1. Task ownership

A browser task belongs to one system. A processing task belongs to one service namespace.
A workflow task is a pure fold over declared inputs. Cross-system work belongs in the workflow graph.

Contracts live under `src/models/{systems,processing,workflows}/`.
Implementations live in the owning system, service, or workflow's `tasks/` folder.
The [codebase map](codebase-structure.md) owns exact paths and dependency direction.

## 2. Task declaration

### 2.1 Core types

`src/models/task/task-contract.ts` owns `TaskEffectSchema`, `SubjectBindingSpecSchema`,
`FreshnessPolicySchema`, `ProvenancePolicySchema`, and `defineTaskContract`.
Every contract has the following fields.

| Field | Contract |
| --- | --- |
| `id` | Branded `TaskId`, minted by `taskId`, with a registered namespace and a verb matching the effect. |
| `title` | Nonempty default step label. |
| `input`, `output` | Recursively strict Zod boundary schemas. Output is canonical JSON. |
| `errorCodes` | Nonempty tuple of unique contextual kebab-case codes or exact registered `ErrorCatalogCodeSchema` values. |
| `subject` | Explicit `none`, `person`, or `artifact` binding. |
| `scenarios` | Declared `ScenarioId` values. Empty is allowed only in a `workflow:` namespace. |
| `example` | Required output fixture, parsed and canonicalized at declaration. |
| `requires` | Optional declared secret names. Resolution belongs to [clock, config, and secrets](clock-config-secrets.md). |
| `providers` | Optional capability list, allowed only on service reads. |
| `operation` | Optional reusable display structure, checked against this contract. |

The effect adds these fields and capabilities.

| Effect | Declaration | Runtime capability |
| --- | --- | --- |
| `read` | Required `freshness` and `provenance`. Optional `artifacts: "content-addressed"`. | Observes data. Generic read retry is optional. |
| `prepare` | `checkpoint: "in-memory-only"`. | Stages ephemeral browser state within a transaction. No mutation token. |
| `commit` | Required `writeSafety`. | Receives `MutationCapability` through the protected transaction path. |

`src/rules/identity/ids.ts` owns the closed system identities. Browser namespaces are `ucpath`,
`crm`, `onbase`, `kuali`, `servicenow`, `i9`, `new-kronos`, `old-kronos`, and `sharepoint`.
Service namespaces are `extraction`, `normalization`, `ocr`, and `roster`.
`TaskStoreId` also accepts `workflow:<workflow-id>`.

`operation` uses `TaskOperationDeclaration` in `src/models/workflow/operation-display.ts`.
It declares semantic actions, logical session and page identity, schema-resolved value slots,
templates, and pure transforms. It contains no selector or execution authority.
`assertTaskOperationDeclaration` validates it during sealing.

#### Freshness and provenance policies

`FreshnessPolicy` contains `defaultMaxAgeMs`, optional `defaultOverride`, and optional `byField`
rules with `path`, `maxAgeMs`, and `override`. Overrides are `forbidden` or `audited`.
Limits are nonnegative finite integer milliseconds or `Infinity`.
`Infinity` is policy metadata, never persisted task output.

`ProvenancePolicy` contains `default: "live" | "derived"` and optional `byField` rules with
`path` and `source`. Duplicate or conflicting provenance paths fail schema validation.
`assertRead` resolves every freshness and provenance path against the exact output schema.
Checkpoint freshness enforcement belongs to [workflow model](workflow-model.md).

#### Subject binding

A scoped subject names an input path, an observation, a matcher, and required observation timing.
`assertCommon` resolves the input path and refuses cross-system observations.
Service and workflow contracts cannot bind browser observations.

| Kind | Expected identity | Matcher |
| --- | --- | --- |
| `person` | `eid`, `name`, or `eid-and-name` | Corresponding `normalized-exact-eid`, `normalized-exact-name`, or `eid-and-name`. |
| `artifact` | `artifact-id`, `sha256`, or `document-id` | `exact`. |
| `none`, non-commit | Nonempty free-text `reason`. | No observation. |
| `none`, commit | `reviewedReasonId` from `UNSCOPED_COMMIT_REASON_REGISTRY`. Free text is refused. | Reviewed unscoped write policy. |

`requiredAt` is `before-subject-read` or `after-prepare-before-fence`.
Every scoped commit requires `after-prepare-before-fence` at declaration.
`src/backend/runtime/writes/write-sequencer.ts` observes and verifies the subject on the retained
transaction page before it obtains a fence. Echoed input is not independent subject proof.

#### Sessions and retry

`SessionNeedSchema` and `RetryPolicySchema` live in `src/models/sessions/session.ts`.
`SessionsFor<C>` in `src/workflow-kit/task.ts` derives the allowed session tuple.
`validateTaskBinding` checks the same constraints at runtime.

- A browser task needs exactly one session for its own system. Reads use `access: "read"`.
  Prepare and commit tasks use `access: "transaction"`.
- `session` is `reuse-worker` or `fresh`.
- OnBase requires `exclusive: true` on both the session need and store provider.
  Other systems cannot declare exclusivity.
- `acceptDownloads: true` is allowed only on a read declaring content-addressed artifacts.
- Headless tasks have `sessions: []` and no driver.
- Only reads can declare retry. `attempts` is `2` or `3`, `backoffMs` is a nonnegative integer,
  and `retryOn` is `transient`.

`src/backend/runtime/policies/task-retry.ts` permits another attempt only when the failure is
transient and attempts remain. Business failures are nontransient unless the throw site proves otherwise.
Prepare and commit recovery belongs to the write sequencer.

### 2.1.1 Strict schemas and absence

`assertContractBoundarySchema` in `src/models/validation/contract-boundary.ts` walks nested
objects, arrays, unions, wrappers, lazy schemas, pipes, intersections, and tuples.
It requires a strict object or object union at the root. It refuses `any`, `unknown`, `record`,
`map`, `set`, and open objects at every depth.

`CanonicalJsonSchema` provides the output type constraint. The factory parses `example` through
`output`, then calls `canonicalJsonStringify` as its runtime check.
Dates, EIDs, IDs, and money use the branded scalar schemas in `src/rules/identity/ids.ts`.
Money is integer minor units. Canonical task data excludes nonfinite numbers and JavaScript objects
such as `Date`, `Map`, and class instances.

An optional field means the producer can omit it. A nullable or explicit absent arm means the
contract allows a proved lack of value. An indeterminate extraction needs a distinct outcome or
failure. A missing selector and a malformed value do not prove absence.
Structural cells required to identify a row refuse blank values. Descriptive cells may carry
`{ state: "absent", reason }` when their contract declares that arm.

### 2.2 Contract and implementation

Browser-safe code imports the declaration, never the implementation. A browser implementation uses
`defineTask(driver, contract, impl)`. A headless read uses `defineTask(contract, impl)`.
Implementations declare `sessions`, optional read `retry`, and `run`.
`run` receives parsed `z.output` input, including defaults and transforms, and returns `z.input` output.
Workflow binds produce `z.input` input.

`defineTaskContract` validates the exact effect-specific shape, boundary schemas, namespace,
verb, error-code uniqueness, example, subject, and scenario declarations.
It then copies and freezes declarative metadata through `sealDeclarativeMetadata`.
Schemas and functions keep their identities. The factory records the resulting object in a private WeakSet.
`assertFactorySealedTaskContract` refuses a forged `__sealed` property or a copied object.

For commits, `assertWriteSafety` validates the proof round trip and same-store read references.
Reconstructed output must equal the example, and present-probe proof must equal output proof.
`recoveryAbsence` parses as `NegativeSettlementPolicy`.
`unverifiableByPage` needs a reviewed task/reason and `operator-attestation` example.
The reviewed policy has no entries, so that exception is unavailable.

`defineTask` refuses unknown implementation keys, missing `run`, invalid sessions, a driver on a
headless task, retry on a write task, and artifacts on a workflow task.
It freezes the binding and registers it in another private WeakSet.

`declareDriverFor<ConcreteDriver>()` creates an invariant, factory-authenticated driver declaration.
`declareDriver` creates the system-only unwired form.
A browser store requires the exact declaration object used by all its tasks.

### 2.3 Task context and observations

`TaskCtxCommon` in `src/workflow-kit/task.ts` exposes `signal`, `log`, `fail`, `recordData`, and
optional `confirmed`. The remaining members depend on the contract.

| Task | Additional context |
| --- | --- |
| Browser read | Concrete semantic `driver` and `ctx.captureScreenshot(): Promise<void>`. |
| Browser prepare | Concrete semantic `driver`. |
| Browser commit | `driver` and `mutation`. |
| Service read with providers | `providers`, narrowed to the declared capability keys. |
| Read with artifacts | `artifacts: ContentAddressedArtifactWriter`. |
| Workflow read | No browser, provider, artifact, or mutation capability. |

The context has no mutable workflow data bag, orchestration method, park primitive, or free-form retry.
The driver owns raw browser operations. Tasks use its typed semantic methods.
`src/workflow-kit/mutation-capability.ts` authenticates mutation tokens. The write sequencer mints them
through the protected write path, and commit driver operations check them before the external action.

#### Output provenance

`createTaskProvenanceCollector` in `src/backend/runs/provenance/task-provenance.ts` owns read evidence.
`recordData` accepts one `DataPoint` or a nonempty batch:
`{ direction: "read" | "write", field: ContractFieldPath, value: JsonValue }`.
The collector stamps execution identity and one Clock instant per batch.
Duplicate, overlapping, contradictory, and post-finalization points fail.

Before checkpointing, `finalizeRead` parses the output and requires recorded read points covering
every canonical output leaf. Recorded values must equal the parsed values.
Object parents can cover their descendants. Arrays are one provenance leaf at their named path.
A count or prose summary cannot replace the output field's value.

A derived leaf requires declared upstream dependencies. The collector validates the exact dependency
set against authenticated descriptor metadata and rejects missing or extra evidence.
Checkpoint evidence includes its complete leaf provenance. Gate results contribute a fact at
`resolvedAt`, with operator or source provenance according to their arm.
Conditionally skipped tasks and operator gates are re-evaluated against canonical input and authenticated condition sources. Transitive condition evidence is separate from direct dependencies and does not contribute output provenance. Each source must match the declared producer schema, descriptor and complete leaf facts.
Child evidence binds edge, parent, result schema/identity, checkpoints, and descendants.
Foreign, extra, cyclic, or fact-free evidence fails.
Derived leaves retain the oldest contributing `originalObservedAt`.

A workflow task output is incomplete until its implementation records every new leaf.
A direct implementation test with a no-op recorder cannot prove the executor accepts that output.
The real task and `createTaskProvenanceCollector` exercise that seam.

Transaction roles use the write sequencer's role-specific collector and settlement path.
Commit observations publish after the callback settles. Cancellation does not prove an external
write has stopped. [Write safety](write-safety.md) owns post-fence settlement and saved-effect verification.

#### Provider and artifact capabilities

Current provider IDs are `ocr.extract`, `geocode.census`, and `geocode.nominatim`.
`src/backend/processing/providers/provider-client.ts` validates the immutable config identity,
canonical request, adapter capability, response, request ID uniqueness, abort, and deadline.
Its task-facing client accepts only the schema-bound payload.
Missing adapters return `unavailable`; malformed adapter responses return `invalid-response`.
Calls are not retried by this client. OCR returns `adapter-unavailable` while its connection is absent.
This module does not implement durable provider budgets or accounting.

`ContentAddressedArtifactWriter` in `src/workflow-kit/artifacts.ts` exposes only
`put(bytes | Readable, { mediaType })` and `open(ref)`.
`ArtifactRef` carries `id`, `sha256`, `bytes`, and `mediaType`, never a path.
`src/backend/storage/artifacts/content-addressed-artifact-writer.ts` validates the admitted root,
rejects symlinks, publishes atomically, deduplicates content, and verifies references on open.
Direct mutable task filesystem writes are excluded by `artifact-effect-boundary`.
Server-only diagnostic verification uses `server-verified-artifact-reader.ts` in that folder.
Its byte-serving and disposal contract belongs to [operator trust](operator-trust.md).

### 2.4 Failures

`src/workflow-kit/errors.ts` owns `TaskError` with `taskId`, `code`, optional `subject`,
`transient`, and `cause`. Its message is `[<taskId>] <code>: <message>`.
`transient` defaults to false.

`taskFailer(contract)` constrains `ctx.fail` to the declared literal tuple at compile time.
The executor wraps a non-`TaskError` escaping a read with `wrapUnhandledTaskError`.
The wrapper produces `code: "unhandled"`, preserves the cause, and preserves an Error's message.
A non-Error throw produces `task threw a non-Error value`.
Runtime `ctx.fail` constructs `TaskError`; it does not recheck membership in `errorCodes`.

Distinct negatives use distinct codes when their meaning matters downstream.
A timeout is a failure, never a proved no-match result.
`TaskError` has no `decoratedBy` or `hookErrors` fields.
Error presentation and the shared failure catalog belong to [dashboard surfaces](dashboard-surfaces.md).

### 2.5 Task names

`TaskIdSchema` in `src/rules/identity/ids.ts` validates
`<registered-store>/<kebab-case-operation>` and `workflow:<workflow-id>/<kebab-case-operation>`.
`taskId` retains the string literal in `LiteralTaskId`; `NamespaceOf<C>` derives the namespace.
`EFFECT_VERBS` in `src/models/task/task-contract.ts` enforces this table.

| Effect | Allowed leading verbs |
| --- | --- |
| `read` | `read`, `search`, `list`, `extract`, `match`, `verify` |
| `prepare` | `fill`, `stage` |
| `commit` | `save`, `submit`, `upload`, `create`, `update`, `delete` |

Matchers and completion verifiers are reads. One contract has one effect.
The runtime registry derives its task corpus from registered stores. There is no `KnownTaskId` generator.

### 2.6 Bounded execution

`src/backend/runtime/execution/run-executor.ts` parses bound input, runs a read under the injected
monotonic `taskDeadlineMs` and run signal, validates provenance, and parses output before checkpointing.
Browser reads acquire their driver through `WorkerSessionManager.withDriver`.
The write sequencer bounds transaction-role invocations and retains post-fence settlement ownership.

Long approval waits and external signals are graph gates, not task polling loops.
Authentication is worker-owned session infrastructure. Duo is part of login, not a workflow gate.
Session closure and cancellation proof belong to [execution and sessions](execution-and-sessions.md).

### 2.7 Declaration requirements

Requirements follow effect and namespace. Only workflow reads can omit scenario IDs.
All reads need freshness and provenance. Writes need browser namespaces; commits add write safety.
No task declares its own tier. There is no scaffold command.

### 2.8 Read extraction

A page read has one fixed strict output. Consumers project or fold downstream.
Navigation and state changes that prove one page form one operation. A separate visit has its own proof.
Optional facts declare absence. Evidence classification and provenance cover the entire output,
including fields the first consumer ignores. Business judgments belong in pure folds.

### 2.9 New Kronos reads

`new-kronos/search-employee` and `new-kronos/read-separation-timecard` use separate page visits.
The timecard driver returns observed page identity, applied range, raw rows, and extraction metadata.

`readVirtualizedGrid` in `src/backend/systems/new-kronos/driver/grid-scroll.ts` collects virtualized
rows and refuses incomplete or out-of-window coverage. Both collection and the pure fold use
`timecardRangeCoverage` in `src/rules/kronos/separation-timecard.ts`.
A widget reaching its scroll limit does not prove a complete set.

`driver/interpreter.ts` reads headers from the same data container as the body cells,
compares their counts, and resolves columns by name. A global or pinned header row cannot supply
the body column offsets. Unrecognized pay codes remain in `unclassifiedPayCodes`.
The store has read tasks and no commit family.

### 2.10 Kuali task families

`src/backend/systems/kuali/driver-declaration.ts` owns one concrete declaration for the store.
Its document read, action search, and finalization family all use that declaration.
A new surface extends the same declaration rather than creating a second one.

Semantic UI attribution follows the fact or control's actual task use.
An external Save control belongs to the commit task even when a read visits the same document.
A person field's `state` and `reason` describe the extraction. Only its `value` carries the identifier.
Evidence classification belongs to `src/models/trust/evidence-classification.ts`.

### 2.11 UCPath job summary

`src/models/systems/ucpath/read-job-summary.ts` declares the Employment Instances output.
`src/rules/separations/job-summary-classification.ts` owns the business disposition fold.
The read retains verbatim HR status and render context rather than failing on a business classification.

Employment record, HR status, and business unit are structural values. Descriptive cells declare
absence where the page permits blank values. Search candidate parsing and rich job-summary parsing
apply their own schemas to the shared extraction.

`src/backend/systems/ucpath/driver/person-org-operation.ts` waits for a rendered outcome and then
classifies the observed result state. A criteria banner alone cannot prove no matches.
Ambiguity remains an explicit selection outcome.

### 2.12 UCPath termination tasks

`src/backend/systems/ucpath/task-registry.ts` binds both families to one driver.
`termination-verdict.ts` beside it folds one transaction scan into distinct probe questions.

Deleting pending terminations is its own commit and transaction, with its own key, probe, and verifier.
It is not an action hidden in prepare. Filing a termination is a separate transaction.
`driver/smart-hr-operation.ts` uses the page's resolved person name as subject evidence rather than
treating the entered employee ID as readback.
`isUcpathTerminationAction` accepts the supported `TER` and termination-label forms.
Unmatched values remain unmatched.

## 3. Task registration

### 3.1 Implementation homes

Each task family registers through its owning `task-registry.ts`.
System drivers live in `src/backend/systems/<system>/driver/`.
Shared browser leaf code lives in `src/backend/systems/browser-shared/`.
Pure reusable decisions live in `src/rules/`.
Workflows import browser-safe contracts into `workflow.ts`; their implementations remain backend-loaded.

### 3.2 Store factories

`src/workflow-kit/task-registry.ts` exports these factories.

| Factory | Constraints |
| --- | --- |
| `defineBrowserStore` | Matching system, provider, factory-authenticated driver, exact task driver identity, and OnBase exclusivity. |
| `defineServiceStore` | Sessionless read tasks with no browser driver. |
| `defineWorkflowStore` | Sessionless reads with no browser driver, providers, or artifacts. |
| `defineTaskStoreRegistry` | Factory-created stores, unique namespaces and IDs, and exact corpus membership and effects. |

Store task keys are camelCase. Task IDs belong to that store's namespace and cannot repeat.
`assertTaskContractReferences` resolves declared scenario IDs and commit probe/verifier IDs against
the registry corpus. Probe and verifier contracts must have effect `read`.

`src/backend/app/registries/task-registry.ts` creates `browserStoreRegistry` from `BROWSER_STORES`
and `taskStoreRegistry` from `TASK_STORES`. `corpusFor` projects IDs and effects from the stores.
An implementation not exported by a registered store is absent from this executable index.
The registry does not scan unregistered source files.

### 3.3 Driver boundary

Task implementations call semantic APIs. `task-driver-boundary` checks browser ownership transitively.
The root instructions and operating reference own copying, source provenance, and live verification.

### 3.4 Service stores

`extraction` extracts spreadsheet and PDF data. `roster` matches spreadsheet rows.
`normalization` returns deterministic contact advice and declared Census or Nominatim observations.
`ocr` declares the form-page extraction capability but has no connected OCR adapter.
Their contracts follow the same schema, example, failure, freshness, and provenance rules as reads.
Provider policy remains an explicit input and capability declaration.
A provider outage stays an unavailable outcome rather than an unchanged contact value.

### 3.5 Workflow stores

`src/workflows/person-lookup/task-registry.ts` and `src/workflows/separations/task-registry.ts`
register pure workflow-specific folds and joins.
They receive prior output through typed inputs. They cannot acquire browser sessions,
make an external write, or declare provider or artifact capabilities.
Reusable system operations belong to their system store. Shared pure rules have one home under `src/rules/`.

## 4. Confirmed actions

`TaskCtxCommon.confirmed` is optional. The executor supplies it for an invocation with a complete
frozen operation display. `src/backend/logs/confirmed-actions.ts` implements `ConfirmedTaskActions`.
It validates frozen action and verifier identities, execution occurrence, attempt, and physical session.

### 4.1 Action methods

| Method | Required verifier purpose | Result |
| --- | --- | --- |
| `read` | `read-validation` | Performed JSON value and confirmed evidence. |
| `fill` | `readback` | Confirmation only when observed JSON equals the expected value and the matcher accepts it. |
| `click`, `keypress` | `interaction-effect` | Confirmation of the declared interaction. Undeclared and `external-commit` targets are refused. |
| `verify` | `read-validation` | Validated JSON observation. |
| `confirmOutcome` | `read-validation` | Frozen outcome observation: `value` or `empty`. `unavailable` is refused. |
| `result` | Exact confirmed outcome evidence | `DeclaredStepResult` for the task role. |

### 4.2 Observation and write confirmation

A completed action alone is not a confirmed fact. Its declared verifier must match the observation
on the same occurrence and browser session.
The methods cannot confirm a submit. `src/backend/logs/confirmed-submit.ts` and the write sequencer
own saved-effect publication after protected transaction verification.
[Dashboard surfaces](dashboard-surfaces.md) owns event presentation and timestamps.

### 4.3 Output isolation

`defineTask` freezes the task binding. Each node produces its own typed output.
A later task receives only its declared input mapping. Confirmed-action evidence cannot mutate
another node's output or replace a contract schema.
`decorateTask`, workflow `.decorate`, and `.instrument` hooks are absent.

## 5. Workflow composition

`src/workflow-kit/workflow.ts` allows reads in ordinary task nodes and same-system
prepare/commit pairs in transactions. The write sequencer retains their lease.
Prepare output is in-memory-only.

The builder types input binds against `z.input` of the contract schema.
The executor parses bound input before invocation and parses output before persistence.
Checkpoints bind the output schema hash and canonical value.
Declared dependencies supply provenance and freshness authority, rather than inferred bind execution.
[Workflow model](workflow-model.md) owns branches, child runs, gates, replay, and terminal results.

## 6. Authentication and dry runs

### 6.1 Authentication

`SessionProvider` in `src/workflow-kit/session.ts` exposes
`login(handle, { instance?, signal? })`, returning `logged-in` or `already-authenticated`.
Tasks receive the semantic driver, never the worker's login handle.

Session acquisition is lazy at the node that needs a driver.
`src/backend/runtime/browser/system-bindings.ts` binds UCPath, CRM, Kuali, and New Kronos to their
concrete drivers, login recipes, and authenticated-application verifiers.
The other browser stores have declarations without runnable system bindings.
Missing bindings refuse rather than creating an unauthenticated substitute.

A parked run releases sessions through the runtime's close-proof path. Resume reacquires them.
[Execution and sessions](execution-and-sessions.md) owns authentication proof, Duo, exclusive leases,
and refusal when closure is uncertain.

### 6.2 Dry runs

`dryRun` belongs to the run envelope, never task input or context.
`deriveDryRunSupport` in `src/workflow-kit/workflow.ts` derives support from transaction nodes.
All transaction nodes must declare `stop-after-prepare`. A graph with no transaction, or a node
marked unsupported, has no supported transaction preview.

`executeDryRun` in `src/backend/runtime/writes/write-sequencer.ts` probes before staging.
An already-present probe produces an honest preview without a prepare or subject observation.
The would-prepare arm stages the page and observes the subject under the retained lease.
Refused or uncertain real-path conditions also refuse preview.
The preview creates no write intent or fence and invokes no commit implementation.

The executor ends with a preview result bound to its preview schema.
It does not call the authored terminal-result derivation or fabricate a completed transaction output.
`externalCommit: "none"` distinguishes the preview from an HR write.
[Workflow model](workflow-model.md) owns the terminal preview shape and run outcome.

## 8. Enforcement and limits

The factories enforce schema, declaration, effect, session, and registration constraints.
The executor and write sequencer enforce execution boundaries.
Architecture checks include `task-contract-sealing`, `task-store-boundaries`, `task-driver-boundary`,
`artifact-effect-boundary`, and `provider-capability-boundary` under `tests/architecture/`.
`tests/types/task-contracts.typecheck.ts` covers negative type cases.
[Guards and tests](guards-and-tests.md) owns the check schedule.

An example proves one schema-valid value. Scenario IDs prove declaration and resolution, not execution.
The registry does not discover unregistered source files.
Review determines whether a schema accurately describes the source.
There is no automatic `Infinity` justification check, task-body similarity check, or task-ID generator.

## 9. Existing task shapes

### 9.1 UCPath search

`src/models/systems/ucpath/search-person-org.ts` declares `SearchPersonOrg`.
Its implementation records `results` and `selection` under one read session with transient retry.
Input is `by-eid` with `emplId`, or `by-name` with `name` and required `keepNonHdh`.
Selection is `resolved` with a selected candidate, `ambiguous` with at least two EIDs,
or `not-found` with none. The task resolves identity, so its subject is `none` with a reason.
Freshness is four hours with override forbidden.

### 9.1.1 CRM reads

`src/models/systems/crm/read-onboarding-record.ts` and `read-onboarding-dates.ts` own the schemas.
Their implementations in `src/backend/systems/crm/tasks/` compare requested EID, parsed binding,
and output EID. A found record needs displayed-record binding. An absent query cannot produce present dates.
Contradictions fail with `subject-mismatch`.

The record retains the exact `rawStage`. The dates use `Offer Letter Sent` history for `invitedOn`,
First Day of Service for `startsOn`, and `Completed` history for `completedOn`.
`Date Signed` does not substitute for completion.
Proved blanks use the declared absence arm. Missing selectors or malformed history rows fail.

### 9.2 OnBase declaration

`src/backend/systems/onbase/task-registry.ts` registers an unwired driver and an empty task set.
Its provider and any future session need require exclusivity.
There is no import prepare or commit implementation to use as an example.

### 9.3 Instrumentation boundary

The runtime owns spans, observed data, and failure diagnostics. §4 owns confirmed task actions.
Browser read implementations declare `screenshots: "task"` to own their successful captures through
`ctx.captureScreenshot(): Promise<void>`. This replaces generic successful-lease capture for those
implementations. Task-point capture runs only when the envelope sets `captureBrowserScreenshots`
to true; otherwise the call resolves without an action. The capability exposes no bytes or paths
and cannot outlive its lease. Missing capability, unavailable capture, and persistence failures use
`BROWSER_SCREENSHOT_CAPTURE_FAILED`.

The worker persists task-point screenshots through `RunBrowserScreenshotCapture` as restricted
diagnostic attachments. Logs joins each Screenshot action to its verified artifact reference.
Existing failed-lease diagnostic screenshots remain independent of the option.
`RunDiagnosticCapture.captureForFailure` separately associates diagnostic bundles with failure records.

## 10. Not built yet

- OnBase, I-9, SharePoint, Old Kronos, and ServiceNow need concrete bindings and task families for their planned workflows.
- New Kronos pay-rule work needs its own explicit commit family, protected transaction, probe, and verifier.
- OCR needs the operator's ChatGPT connection before `ocr.extract` can execute.
- Workflow wiring needs defined task failure codes and corresponding dashboard text at each new failure seam.
