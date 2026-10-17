# Workflow model

A workflow is declared once, compiled into a browser-safe descriptor, bound to backend task stores,
and executed against durable run authority. This reference owns declaration, compilation, graph
execution, checkpoint replay, and workflow projections. [Task contract](task-contract.md) owns task
inputs, outputs, and provenance. [Write safety](write-safety.md) owns external-write enforcement.
[Execution and sessions](execution-and-sessions.md) owns workers and browser resources.

## 1. The workflow descriptor

### 1.1 Shape

`src/workflow-kit/workflow-definition.ts` owns `defineWorkflow`, `WorkflowDefinition`,
`compileWorkflow`, `CompiledWorkflow`, and `composeWorkflowModule`.
`src/workflow-kit/workflow.ts` owns `WorkflowDescriptor`, `defineWorkflowDescriptor`,
`workflowPlanning`, `workflowProjections`, and `workflowTerminalResultExecution`.
The descriptor is a compiler product, not a second authored workflow.

The authored definition carries identity and presentation fields, ingress and canonical-input
schemas, a role, optional intake and operation-display declarations, and a `steps(author)` callback.
The callback returns ordered `[WorkflowTimelineGroup, readonly AnyWorkflowEntry[]]` tuples and a
terminal `result` declaration. Tuple order determines presentation. Typed entry references determine
execution dependencies.

An optional `outcomeProjection` maps a terminal-result field to declared `{ value, label, tone }`
cases. `defineWorkflowDescriptor` requires a string, enum, or literal field and rejects case values
outside its schema vocabulary. Person Lookup declares eight cases for `activeStatus.state`; the
`multiple-matches` case is shared by Search and Match mode.

`WorkflowDescriptorSpec` holds the graph and presentation contract. `defineWorkflowDescriptor`
validates contract placement, schema paths, input examples, node purposes, timeline membership,
identity, presentation, and result dependencies. Its sealed projections derive steps, gates,
browser systems, credential requirements, and dry-run support from the graph. A transaction
projects prepare and commit child steps under one graph node.

`identity.matchKey` declares the durable natural key. The start service derives the item identity
from the workflow and match key. Changing a match key changes item identity; it is not a display
edit. Descriptor `version` is a positive integer. `contractFingerprint` comes from the generated
build manifest in `src/workflow-kit/validation/build-manifest.ts`; authors do not supply it to
`defineWorkflow`.

### 1.1.1 Short code

A workflow `code` contains two to four lowercase letters. `defineWorkflowDescriptor` checks its
shape, and `auditWorkflowCodes` in `src/workflow-kit/validation/workflow-module-audit.ts` checks
registry uniqueness. `WORKFLOW_IDS_BY_CODE` derives from descriptors in the backend registry.
Trace identity uses the code; a presentation label is not a substitute.

### 1.2 The bundle crossing

Definitions and task contracts are browser-safe. Backend task implementations are bound separately.
`src/workflows/descriptor-registry.ts` compiles the same definitions for the dashboard.
`src/backend/app/registries/workflow-registry.ts` compiles and composes backend modules from the
shared task-store inventory.

`WORKFLOW_MODULES` contains `person-lookup` and `separations`. It derives `DESCRIPTORS`,
`SERVER_REGISTRY`, `WORKFLOW_DEFINITIONS`, `INTAKE_PROJECTIONS`, and `WORKFLOW_ROLES`.
`workflowModuleOf` refuses an unregistered workflow.

#### 1.2.1 Module roles

`src/workflow-kit/validation/module-role.ts` defines `standalone`, `composition`, and
`chunk-harness`. Person Lookup is standalone. Separations is a composition.
`src/backend/app/registries/step-proof-modules.ts` composes retained Separations proofs separately.
They are absent from the operator registry and do not become startable workflows.
`auditWorkflowModuleRoles` verifies role ownership.

#### 1.2.2 Workflow source layout

`src/workflow-kit/validation/source-layout.ts` derives source paths from the role:

| Role | Definition path |
| --- | --- |
| `standalone` or `composition` | `src/workflows/<id>/workflow.ts` |
| `chunk-harness` | `src/workflows/<of>/steps/<step>/step.ts` |

A declared timeline group needs no folder unless it holds a retained harness. Separations retains
harnesses for `identity-check`, `kronos-timecard`, `kuali-extraction`, `kuali-finalization`, and
`ucpath-transaction`. Its `job-summary` group has no harness folder.
The `workflow-layout` guard in `tests/architecture/workflow-kit/workflow-layout.test.ts` checks
registered and retained modules against their role, owning composition, and declared groups.
Scenario-path helpers derive potential addresses; they do not prove scenario files or execution.

### 1.3 Projections

`workflowProjections` returns the factory-owned projection for the exact descriptor object.
A copied descriptor cannot supply the sealed planning or terminal-result interfaces.
The projection includes contracts, steps, gates, systems, requirements, timeline, node purposes,
dry-run support, and graph coverage points.

`workflowExplorerDeclaration` derives ordered groups, entry kinds, node ids, task ids, and typed
references from the compiled definition. `src/backend/runs/queries/explorer.ts` produces the
Explorer declaration and explicit unavailable states. Definition previews grant no execution
or run-state authority. Their grouping does not add graph edges.

Descriptor `icon`, `sessionLabel`, ingress, and capability fields are declarations. A declaration
alone does not prove that every dashboard component consumes it. Dashboard wiring is described in
[frontend-backend integration](frontend-backend-integration.md) and
[dashboard surfaces](dashboard-surfaces.md).

### 1.4 Validation and coverage owners

The checks have distinct owners:

| Check | Enforcement module |
| --- | --- |
| Group membership, exact entry references, duplicate ids, cycles, omission dependencies | `src/workflow-kit/workflow-definition.ts` |
| Graph dependencies, node kinds, branch targets, transaction options, gate declarations | `src/workflow-kit/flow.ts` |
| Contract effects, schemas, timeline completeness, result and display paths | `src/workflow-kit/workflow.ts` |
| Exact store and contract-object resolution | `composeWorkflowModule` in `src/workflow-kit/workflow-definition.ts` |
| Module roles, short codes, implementation bindings | `src/workflow-kit/validation/workflow-module-audit.ts` |
| Descriptor import closure and registry conformance | `tests/architecture/workflow-kit/descriptor-coverage.test.ts` |
| Canonical snapshot validation | `src/models/workflow/canonical-input.ts` |
| Pure graph coverage points | `src/workflow-kit/validation/scenario-coverage.ts` |

`src/backend/app/registries/pending-impl-bindings.json` tracks used contracts without implementations.
`auditImplBindings` refuses untracked missing bindings, stale pending entries, and unused entries.
`composeWorkflowModule` requires exactly one store per required namespace and the same contract
object imported by the definition. A globally registered implementation does not replace a missing
module binding.

Declared `scenarios` are contract data. They are not execution evidence. The current test lanes,
parity contract, and required checks live in [guards and tests](guards-and-tests.md).

### 1.5 Labels

`runtimeNodeLabel` in `src/workflow-kit/workflow.ts` resolves a task label from `node.label`, then
its contract `title`. A transaction uses its label, then its commit contract title. A gate owns its
label. The workflow tuples own group labels. There is no implemented
`config/workflow-presentation/<id>.json` label override reader.

### 1.6 Definition and compilation

The workflow author exposes `task`, `parallel`, `delegate`, `gate`, `transaction`, `group`, and
`result`. Entry identities carry stable ids, policies, contracts, and optional labels. A shared
identity created by `defineStepEntries` belongs to the exact step object, not merely an equal key.

`validateSteps` rejects empty groups, duplicate keys or labels, repeated entry objects or ids,
unresolved or repeated references, wrong step ownership, and dependency cycles. A parallel leaf
cannot also appear in a tuple. Result references pass the same exact-object resolution.

`compileWorkflow` topologically orders entries and compiles them through `flow`. It derives the
explicit timeline only when groups differ from the one-entry default or carry omissions. It
resolves the fingerprint from the build manifest and memoizes one compiled value per definition
object and manifest. Compiling that object under another manifest refuses.

`CompiledWorkflow` contains `definition`, `descriptor`, `contracts`, `operationDisplay`, and
`storeNamespaces`. `composeWorkflowModule` drops unused stores, resolves required stores, places
browser stores first, and returns `descriptor`, `stores`, `role`, `intake`, `definition`, and
`operationDisplay`.

#### 1.6.1 Entry algebra

| Author entry | Compiled node | Current limit |
| --- | --- | --- |
| `task` | `task` | Read contract with explicit `checkpoint` or `always-rerun` replay |
| `parallel` | `parallel` and task leaves | `join: "all"`, `failure: "fail-fast"`; at least two nonempty branches |
| `delegate` | `child-run` | Typed target and explicit cardinality, await, join, and policy |
| `gate` | `gate` | Author produces operator gates with typed results |
| `transaction` | `transaction` | Prepare and commit contracts, stable binds, dry-run and probe policy |

The compiler refuses `parallel` with `join: "all-settled"`. Parallel leaves must be task entries and
cannot be shared across branches. The low-level graph vocabulary also contains `branch`; the
workflow author does not expose a separate branch entry.

#### 1.6.4 Operation display

`src/models/workflow/operation-display.ts` owns the versioned display vocabulary and compiler.
A definition without `operationDisplay` compiles to `{ capability: "legacy", version: 0 }`.
A complete declaration covers every contract occurrence, typed value slot, action, template,
transformation, outcome, and continuation. `compileWorkflowOperationDisplay` validates coverage
and references. Transaction display reads must name the actual write-safety probe and required
verification contracts; `operationDisplayEntries` checks them in the workflow compiler.

Display nesting is presentation only. `operationDisplay.execution` derives from entry references
and does not schedule work. `src/models/workflow/operation-display-snapshot.ts` freezes complete
structure into a run envelope. Missing or foreign frozen structure stays unavailable.

#### 1.6.5 Result sources

`result(schema, references, derive, sources?)` declares terminal dependencies and optional direct or
`derived` lineage. Sources name actual dependency fields. A derived source names each input; equal
values do not establish causality. The terminal-result owner validates source digests and exact
retained evidence.

An awaited `one/terminal/one` child may supply `child-resolved` terminal evidence. The descriptor
factory validates the child workflow, schema, run, parent edge, and retained result identity.
Other cardinalities and unawaited children cannot supply a single-child terminal dependency.
A child result is not a parent checkpoint.

#### 1.6.6 Action confirmation and step results

`src/backend/runtime/writes/operation-action-binding.ts` binds action observations to frozen
occurrences. `src/models/workflow/operation-action-identity.ts` owns their identity vocabulary.
A callback returning proves completion of the gesture, not its expected effect.
`confirmationActionId` names a declared same-page verifier. Confirmation requires that later
verification, the exact invocation, and the same physical browser-session incarnation.

Confirmed task facts and declared outcome selection use the invocation's frozen action tree.
Missing evidence is `unavailable`, duplicate evidence or multiple matches is `ambiguous`, and no
matching declared outcome is `no-match`. These states are distinct from a confirmed result.
[Task contract](task-contract.md) owns the context methods. Action confirmation does not authorize
a write, move its fence, or permit retry of an unknown submit.

## 2. Workflow input and RunEnvelope

`src/models/run/record.ts` stores raw ingress separately from the schema-bound canonical input.
Ingress defaults and transforms apply once. `src/models/workflow/canonical-input.ts` audits a
validation-only schema, proves round trips against samples, and reparses snapshots without
reapplying ingress transforms. Stored canonical input is not trusted without this validation.

Workflow input stays constant. Outputs belong to run context. Kernel controls belong in
`RunEnvelopeSchema` at `src/models/run/envelope.ts`:

- Run, workflow, item, trace, parent, descriptor, and configuration identities.
- Requested and resolved system instances, shape, priority, browser mode, and screenshot policy.
- `dryRun`, `stepOmissions`, `recovery`, `sourceBound`, and the attempt.
- `startAt`, `injected`, `freshnessOverride`, and `retryOf` when present.
- Frozen operation-display capability and snapshot when present.

The envelope rejects inconsistent requested instances, self-parent or self-retry identity,
wrong-attempt freshness overrides, duplicate patches, and a patch aimed at the entry node.
`nextAttemptEnvelope` removes `startAt`, `injected`, and `freshnessOverride`, and requires an
authority-supplied attempt greater than the current attempt.

`dryRun` is envelope state, not workflow input. `workflowDryRunSupport` derives support from all
transaction nodes. A graph with no transaction refuses preview as `no-transaction-node`; a graph
with an unsupported transaction refuses as `node-declares-unsupported`. Otherwise `stopsAt` names
the first transaction. `supportsDryRun` on an input-run surface is derived and cannot be authored.

### 2.1 Preview terminal result

`executeClaimedRun` in `src/backend/runtime/execution/run-executor.ts` ends a preview at the first
transaction and stores `RunDryRunPreviewResult`, not the authored terminal derive.
`src/backend/runtime/writes/write-sequencer.ts` runs the durable lookup and applicable read probe
before prepare. Its `already-present` preview reports existing evidence without settling a new
write. Its `would-prepare` preview includes staged output and the subject observation.

The run settles `done` with `externalCommit: "none"`. `buildPreview` in
`src/workflow-kit/workflow.ts` binds the preview schema and that transaction's dependencies, and
refuses a non-preview envelope or another node. A preview creates no write intent or submit fence.
`src/backend/runs/provenance/evidence-receipt.ts` reports `DRY_RUN_PREVIEW` and an unknown terminal
workflow result. A preview does not prove a completed HR transaction.

## 3. Graph execution

`src/models/workflow/graph.ts` owns runtime nodes and typed outcomes.
`src/workflow-kit/flow.ts` accumulates typed outputs, conditionality, contracts, and node tuples.
Each bind reads only its declared dependencies and returns the producing contract's input type.
Conditional outputs include `undefined`; `requireFact` refuses a missing required fact by name.

`executeClaimedRun` reparses task inputs and outputs, collects provenance, persists checkpoints,
and derives terminal results. It requires a fresh claim and rereads authority for lifecycle changes.
Ownership loss returns `abandoned`; it cannot terminalize another claim's work.
`createTaskProvenanceCollector` in `src/backend/runs/provenance/task-provenance.ts` requires
recorded points for every output leaf and checks values against parsed output. Derived outputs
retain the oldest original upstream observation. A schema leaf without its `recordData` point
refuses completion before checkpointing.

### 3.1 Navigation and transactions

Read tasks acquire session leases through the executor's session provider and own deterministic
navigation. A transaction retains one lease from prepare through commit and verification.
Its commit input binds from canonical workflow input and declared upstream outputs, before any
probe or page mutation. Prepare output does not feed the commit bind.

`write-sequencer.ts` checks durable history, probes on a read lease, prepares on the transaction
lease, observes the staged subject, checks the probe-to-fence budget, and fences before commit.
Unknown or mismatched subject evidence refuses before submit. A transaction has no checkpoint,
gate, or retry boundary between its arms and no independently resumable commit target.
[Write safety](write-safety.md) owns recovery, saved-effect verification, and settlement.

### 3.2 Delegation

`src/models/workflow/delegation-policy.ts` owns `onChildFailed`, `cascadeCancel`, `afterChildRetry`,
and `visibility`. `src/models/workflow/delegation.ts` owns `planDelegationFanOut`,
`assertDelegationReplayMatches`, and `joinDelegationOutcomes`.

Planning parses child inputs through the target schema before deriving stable child item ids.
The fingerprint includes edge, target, cardinality, join, policy, and ordered children. Replay
requires the same plan. A join requires the complete outcome set; zero children remain an explicit
satisfied join. `all-settled` returns all typed outcomes. An `all` join applies the failure policy.
Durable delegation records use `run_delegations` and `delegation_dependencies`.

The executor's `ChildRunExecutor` is an injected port. If a child-run node reaches an executor
without that port, it refuses `capability-unavailable`. Neither registered workflow declares a
child-run node. The typed contract alone does not prove a running fan-out.

### 3.3 Conditions

`src/models/workflow/node-condition.ts` owns `NodeConditionSpec`, `evaluateNodeCondition`, and
`describeNodeCondition`. Conditions are data: `is-true`, `is-false`, `equals`, `not-equals`,
`is-present`, or `is-absent`, over a canonical-input or declared-output path.
Only presence checks tolerate a missing value. Invalid traversal and non-boolean boolean tests
throw. The descriptor factory validates schema paths and dependency membership. Planning and
execution evaluate the same condition; a skipped gate creates no operator decision.

## 4. Run lifecycle and gates

`src/models/run/record.ts` defines the durable states `queued`, `claimed`, `validating`, `running`,
`parked-gate`, `parked-write`, and `terminal`. Terminal outcomes are `done`, `failed`, `cancelled`,
`discarded`, `interrupted`, and `superseded`. `runTransitionViolation` checks legal edges.
Only a terminal `interrupted` run may return to `queued`. An ordinary retry creates another run.

A gate records its typed result separately from checkpoints. The executor emits `gate.opened`,
closes sessions, and persists `parked-gate` with `gateId` and `resumeAt`. Resolution requeues the
run; a fresh claim reacquires sessions. Neither park has an edge directly to `running`.
`src/backend/runtime/gates/gate-source-runtime.ts` owns source binding for workflow and external
gates. The workflow author currently produces operator gates.

A `parked-write` records the exact intent generation and code: `unknown`, `ambiguous`,
`present-proof-invalid`, `binding-invalid`, or `operator-required`. Write recovery owns its exits.
A gate result or ordinary Rerun cannot substitute for write resolution.

## 5. Resume and checkpoints

### 5.3 Replay policy

Every read entry explicitly declares `replay: "checkpoint"` or `"always-rerun"`.
The executor validates and replays checkpoint ancestors. It executes `always-rerun` ancestors
again and stores each execution with its claim generation. Replay restores values, never browser
page state. Transactions recover through permanent write authority, not a read replay flag.

### 5.4 Entry validation

`executeClaimedRun` performs resume validation in `validating`, before browser acquisition.
It validates canonical input, the start node, required ancestor outputs, schemas, fingerprints,
patches, gate evidence, omissions, and freshness. `buildEntryValidationFailureRecord` in
`src/backend/runtime/execution/run-failure.ts` aggregates problems into one no-node failure.
Missing context is refused, not replaced with an empty object or contract example.

### 5.5 Freshness and provenance

`src/models/workflow/checkpoint.ts` owns `reachableCommits`, `auditCheckpointFreshness`, and
`assertCheckpointFreshness`. The walk follows static dependency edges and branch or parallel
targets. It checks each replayed fact that can reach a transaction scheduled in this run.
A derived fact ages from `originalObservedAt`, not the time its transformation ran.

A stale fact names its checkpoint, task, field, age, limit, consuming transaction, and graph path.
An override covers only its node and field paths, only the specified attempt, and only a field
whose policy is `override: "audited"`. A forbidden override refuses. Correcting a value does not
refresh untouched live facts. Gate decisions are separate upstream evidence and cannot make an
older observed input fresh.

### 5.6 Recovery and Rerun

Internal checkpoint recovery retains canonical input and item identity. A retry takes the item's
next authority-allocated attempt and replays validated ancestors. `recovery: "restart-from-start"`
executes reads and computations again. Committed write authority remains protected in either case.
An unfinished or unknown submit enters write recovery before another submit is considered.

The `dry-run-scenario` live-read arm starts with `recovery: "restart-from-start"` so reads execute
fresh instead of replaying prior-run checkpoints. Its checkpoint and screenshot expectations use
the persisted run's authority-allocated attempt. Operator starts, Rerun, and preview fixtures keep
their existing replay, freshness, and attempt rules.

`src/backend/runs/start/rerun.ts` and `rerun-values.ts` own source-bound Rerun proposals and prefill.
The source provides values, not checkpoint authority for the new run. The Run modal's submitted
values and omission assertions form a new start plan. A selected completed transaction requires
the retained acknowledgment and the separate repeated-submission protection described in
[write safety](write-safety.md). Confirmation of a warning is not final plan consumption.

`src/backend/runtime/checkpoints/checkpoint-patch.ts` applies declared field patches and reparses
the complete producing output. The envelope carries corrections with time and reason.
Untouched provenance survives. A patch cannot replace a missing unrecorded ancestor wholesale.

### 5.7 Checkpoint storage and terminal results

`RunCheckpointRecordSchema` in `src/models/workflow/checkpoint.ts` binds output and provenance to
workflow, item, node, attempt, run, descriptor version, contract fingerprint, implementation
fingerprint, and claim generation. `checkpointLookupKey` uses the logical tuple
`(workflow, item, node, attempt, claimGeneration)`. Two claims within one attempt can produce
separate immutable observations.

`src/backend/storage/sqlite/authority-database.ts` owns the checkpoint repository and its latest
and exact reads. `src/backend/runtime/checkpoints/run-checkpoint-reader.ts` restricts source-bound
and fresh restart reads to this run's own attempt rows; ordinary recovery uses the item's latest
row. `loadCheckpoint` returns `{ found: true, ... }` or `{ found: false, reason }`, validating
version, fingerprints, schema hash, and payload. A mismatch refuses rather than selecting a
plausible output with an equal schema. `src/backend/storage/sqlite/migrations.ts` makes checkpoint
updates and replacement inserts illegal and permits deletion only with the owning deleted-run
tombstone. Event-stream retention does not delete checkpoint authority.

A successful terminal result is separate authority. `src/backend/runs/lifecycle/run-result.ts`,
`terminal-authorization.ts`, and the descriptor's terminal-result factory bind the derive to exact
checkpoint, assertion, not-run, or child-result dependencies. SQLite independently verifies those
bindings and commits the result, authorized terminal transition, and outbox atomically.
A failed or cancelled run supplies no fabricated successful result. Spans and in-memory returns
cannot replace the stored result.

### 5.8 Whole-step omission

`group(step, { omission })` declares a typed form and `produces` map beside that step's entries.
`validateOmissions` in `workflow-definition.ts` permits producers only for task entries. It
refuses an outside entry that depends on an omitted member the form cannot rebuild.
`src/models/workflow/step-omission.ts` owns `planStepOmissions`.

An omitted step executes no entry, including gates and transactions. Mandatory verification
belongs outside an omittable step. Rebuilt task outputs are complete schema-valid operator
assertions, stored as checkpoints with `assertion: { step, assertedAt }` and operator provenance.
An omitted transaction produces no transaction outcome or proof. Terminal evidence distinguishes
`asserted` from `not-run`; `step-omitted` does not mean an external write succeeded.

The executor admits replay of an assertion only for the same omission. An explicit resume across
an incompatible assertion refuses. A resumed claim of the same run reuses its own assertion.
Omission bundles are admitted before start and ride `RunEnvelope.stepOmissions`; changing them
requires another start plan.

## 6. Trace and spans

`src/backend/logs/span-emitter.ts` owns `runSpanPath`, `taskSpanPath`, `workerSpanPath`, and
`browserSessionSpanPath`. A task path is
`<traceId>/<nodeId>#<claimGeneration>.<taskAttempt>`. Claim generation distinguishes executions
across a park and fresh claim. Task attempt distinguishes local retries. Projection identity
includes run, attempt, and span path, so repeated execution does not collapse into one row.

The executor brackets actual tasks, gates, and transactions. Transaction prepare and commit have
separate child spans within the retained lease. Action observations use the Notes stream rather
than another scheduler. Replayed checkpoints retain their exact evidence identity.
[Dashboard surfaces](dashboard-surfaces.md) owns event wire formats and folds.
Every start surface publishes the committed run through `runQueuedSpanEvent` before worker execution; a durable run row alone does not prove its required queue root exists.

## 8. Person Lookup

`src/workflows/person-lookup/workflow.ts` declares four visible steps and ten graph nodes. Step order controls presentation. The table lists each step's nodes in declaration order.

| Visible step | Node | Contract | Dependencies | Replay and condition |
| --- | --- | --- | --- | --- |
| Search for person | `searching` | `ucpath/search-person-org` | None | `checkpoint`; `mode = "search"` |
| Search for person | `matching` | `ucpath/search-person-match` | `searching` | `checkpoint`; `mode = "match"` |
| Search for person | `search-identity` | `workflow:person-lookup/read-resolved-identity` | `searching`, `matching` | `always-rerun` |
| Cross-check identity (`crmCheck=true`) | `cross-verify` | `crm/search-onboarding-records` | `search-identity`, `searching`, `matching` | `checkpoint`; `search-identity.shouldCheckCrm` is true |
| Cross-check identity (`crmCheck=true`) | `crm-identity` | `workflow:person-lookup/read-resolved-identity` | `search-identity`, `cross-verify`, `searching`, `matching` | `always-rerun`; same condition as `cross-verify` |
| Cross-check identity (`crmCheck=true`) | `crm-selected-record` | `crm/verify-onboarding-record` | `crm-identity` | `checkpoint`; `crm-identity.crmRecord` is present |
| Cross-check identity (`crmCheck=true`) | `crm-results` | `crm/read-onboarding-results` | `search-identity`, `cross-verify`, `crm-identity`, `searching`, `matching` | `checkpoint`; `crm-identity.unselectedCrmRecords` is present |
| Read employment status | `crm-only-recovery` | `ucpath/search-person-org` | `crm-identity`, `crm-selected-record`, `crm-results` | `checkpoint`; `crm-identity.recoveryEid` is present |
| Read employment status | `active-status` | `workflow:person-lookup/read-active-status` | `search-identity`, `crm-identity`, `crm-only-recovery`, `crm-selected-record`, `crm-results` | `always-rerun`; `mode = "search"` |
| Read CRM dates (`includeCrmDates=true`) | `crm-dates` | `crm/read-onboarding-dates` | `active-status` | `checkpoint`; `active-status.datesEid` is present |

Search mode accepts an EID or name. Match mode accepts a name plus a date of birth, an SSN, or both. The input schema owns the defaults for `crmCheck`, `keepNonHdh`, and `includeCrmDates`.

The result uses `active-status` in Search mode. In Match mode, it derives the outcome from the identity, match output, and any verified CRM record. CRM dates are `included` when `crm-dates` runs and `not-requested` otherwise. `requireFact` refuses a missing required fact.

`unselectedCrmRecords` is nullable. `crm-results` runs for an array, including `[]`, and skips when the field is `null`. Its bind builds the same query as `cross-verify`. The task reads the current CRM results and compares them with the discovered records. If they differ, it fails with `PERSON_LOOKUP_CRM_RESULTS_CHANGED`. `crm-results` returns unresolved rows without treating a row as the selected CRM record. When `crmRecord` is present, `crm-selected-record` reopens the record and verifies its current identity and facts. `crm-results` skips on this branch.

`searching`, `matching`, `crm-selected-record`, and `crm-results` own the task-point screenshot captures. `captureBrowserScreenshots` gates image capture. With the option off, `crm-results` still reads and compares the CRM records, but its screenshot call is a no-op. Checkpoint replay restores task output and does not invoke capture or create a new Screenshot action.

The workflow has no transaction, gate, parallel, or delegation node. Its dry-run preview refuses because the graph contains no transaction. Its declaration is not evidence of a current live run or completed dashboard wiring.

## Not built yet

- The wiring base must consume served descriptor projections through existing dashboard components, retaining explicit loading, empty, failure, refusal, and uncertain states.
- Each workflow needs an operator-approved walkthrough, served wiring across its required surfaces, a dry run where supported, and operator sign-off before its static switch changes.
- A workflow that first needs child-run execution must supply the executor's admitted `ChildRunExecutor` and verify its durable fan-out and recovery behavior.
