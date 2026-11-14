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
schemas, a role, optional intake, and a `steps(author)` callback.
The callback returns ordered `[WorkflowTimelineGroup, readonly AnyWorkflowEntry[]]` tuples and a
terminal `result` declaration. Tuple order determines presentation. Typed entry references determine
execution dependencies.

Start surfaces declare typed input or an upload input. A PDF upload declaration names the document
collection, as-of date and reviewer fields in the canonical input. Bootstrap carries this metadata
to the existing PDF picker. Its authenticated uploads form one submission, with fresh reading IDs;
the served operator/date facts and those IDs remain fixed while the plan is reviewed.

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
edit. Descriptor `version` is a positive integer. `contractFingerprint` is computed by `compileWorkflow`
(`src/workflow-kit/fingerprints.ts`) from the kit version, id, version, declared schemas, entry graph
and task contracts; it reads no source, so line endings and shared code edits never move it. Authors
do not supply it to `defineWorkflow`. Each run envelope also carries the app `buildId` that approved
it (a delegated child carries its parent's); a transaction refuses to derive its key, fence or click
under a different build, and a parked-write resolution treats equal contracts as identical code only
under the same build.

`requiredWorkbookFields` declares the mapped Library fields a workflow directly needs.
`workbookReference` declares the captured logical ID, lookup key, read mode and writable output
subset. The factories validate known fields and subset membership, copy and recursively freeze
the declaration, and include it in the contract fingerprint. An empty field list has no reference.
Retained step proofs inherit the declaration. Onboarding and CRM Document Download require email
and name fields; the I-9 PDF parent requires Action History fields.

Start planning takes an explicit entry-scoped Library, named version and worksheet selection.
For keyed reads it derives keys from admitted ingress; the frozen declaration supplies fields,
key and logical ID. Each selected worksheet must map every required field exactly once. Captured
references bind canonical input before identity and output planning. Their schema-bound values
retain exact cells, revision and selected worksheet identity in the confirmation fingerprint and
native run input. The confirmed Start rechecks the captured source before accepting it.
[Run reference planning](frontend-backend-integration.md#run-reference-and-output-plans) owns explicit saved-row selection and public entry coverage.

The I-9 PDF parent captures Action History's named version with no keys until OCR review supplies
the approved EIDs. Its run-bound read uses those late keys against the captured immutable version,
retaining the original version label and worksheet/row coordinates. Confirm lists every PDF and one
results workbook with one row per person after review.

Onboarding maps the exact requested email key and five required fields: `email`, `fullName` (Legal
Name), `livedName` (Lived Name), `eid` and `transactionNumber`. It reads the two name cells as whole,
whitespace-collapsed strings; a blank Lived Name means no lived name, and a blank Legal Name refuses
the row. The `hire-plan` task splits both names against the CRM first, middle and last name and accepts
only a split the roster's own `Last, First Middle` comma or a CRM name proves; any other name fails
with `ONBOARDING_NAME_UNRESOLVED` before the UCPath search. Only `eid` and `transactionNumber` are
written back; I-9 profile ID and approval status stay in the run result. The public planner refuses supplied roster
values and builds required canonical roster input from the one captured reference. With `selectedRow`,
the server derives and checks the email from that retained physical row and binds its typed names.
Execution authentication rebinds from the selector in the retained reference request, never from the
canonical row's self-claimed coordinates. The full reference, including its selector, contributes to
the reference digest and plan fingerprint. Native run membership supplies run identity; the reference digest,
library revision and row membership remain immutable during execution.

Without an explicit selector, a missing or ambiguous match still parks at `roster-choice` before the CRM read. The `workbook-writes`
section serves separate `referenceChoices` with exact reference identity, typed field/value entries,
and an available, unavailable or resolved state. Every choice carries an own-run `native` event
anchor: queued issuance before review, the parked gate's opening during review, the authenticated
resolution after selection, or the terminal run span when unresolved. A continued selection uses the
current run's queued issuance after authenticating the original choice and continuation; it does not
claim another human selection. Missing, foreign or ambiguous native evidence refuses projection. A missing key has no candidates. Refresh may show
current exact-key matches only in the original worksheet set. `resolve-workbook-reference-row`
accepts sheet and row identity, rechecks the live revision, type, key and worksheet membership, and
rebuilds typed values into a durable `{ decision: "selected", row }` gate result before the canonical
gate transition resumes the run. Every Onboarding descriptor and retained proof declares this
selection as a `taken` receipt decision bound to `row.binding.referenceDigest`. Its gate decision
declaration requires the workbook-reference resolution source and binds the pending canonical input
digest; ordinary operator gates declare their operator source and retain checkpoint evidence checks.
Direct `resolve-gate` cannot settle this gate. The original reference stays unchanged; subsequent
execution and delegation authenticate retained chosen evidence, the applied command audit and the
native gate-result hash without rereading the workbook. Runs checks this proof at the worker
validating/running transition before executor replay or task admission and again at actual child
admission. Continued runs authenticate the original source run and require identical canonical input
and workbook references; Logs can show that retained source choice as resolved.
Lazy receipt reads authenticate this authority before derivation and before returning an existing
receipt. A completed run with pending canonical roster input requires an effective authenticated
choice. Continued gate rows enter receipt derivation separately from own-run rows, bound to the
exact native continuation tuple and row digest. Their `continued-gate-result` observations retain the
original `sourceRunId`, command, operator and resolution time; the decision names the original run.
No workbook patch or write receipt is created by a read choice. Hire writes remain unavailable.
The current Onboarding graph is read-only and contains no transaction node. Its derived
`supportsDryRun` is false, so its launcher has no Dry run switch; row selection does not activate hire writes.

`workbooks/read-reference` resolves keys learned during execution through the existing run-bound
`workbooks.library` provider. The caller supplies only a captured type and lookup keys. Runs checks
the running claim, envelope and native input, then reads the exact retained named version through
`libraryVersion`. Captured fields, worksheets and original row matches must still agree with those
immutable bytes. Missing versions refuse; editable-head changes never replace the selected version.

CRM Document Download keeps a mixed EID/email list in one batch. Verified CRM identities supply
additional email lookup keys; names and worksheet destinations come only from the retained roster.
Ambiguous people park together at `document-row-choice`. Each choice is keyed by the original
requested identity and offers only that person's retained candidates. Native row-selection events
bind the command audit, checkpoint digest and reference digest. Selections accumulate without
resuming the gate until every unresolved person has a row. Exact command replay retains its first
selection. Logs serves each member's native anchor and resolution time. The completed gate value
must equal the authenticated selections before execution, continuation or receipt derivation.
Missing rows remain unavailable; the workflow never substitutes a current-head row.

The `workbooks/read-result` task accepts `patch-reference` with a stable run-local write ID and
explicit field/value entries. Runs derives its target from the captured reference and journals the
receipt with native run evidence. A revision change or ambiguous/missing key requires a Logs row
choice. `resolve-workbook-row` binds the original receipt, run version and current workbook revision;
it rechecks the live key, row, original worksheet membership and cell ownership before applying only
the retained operation's values. Operator-owned cells remain protected. Exact command replay uses
the original operation receipt; it never invents replacement values or retries an HR write.

`failureCorrections` binds a task node and failure code to one run input. Logs offers Check again
and a text entry for that input only when the failed run has no uncertain writes. The correction
preserves execution options and protected input bindings, retains source-run lineage, and reads
every selected step again. A corrected match key creates a new item identity. Inputs emitted by
the Run parser remain available for ordinary starts. Other correction inputs can change only
through their declared failure action.

### 1.1.1 Short code

A workflow `code` contains two to four lowercase letters. `defineWorkflowDescriptor` checks its
shape, and `auditWorkflowCodes` in `src/workflow-kit/validation/workflow-module-audit.ts` checks
registry uniqueness. `WORKFLOW_IDS_BY_CODE` derives from descriptors in the backend registry.
Trace identity uses the code; a presentation label is not a substitute.

### 1.2 The bundle crossing

Definitions and task contracts are browser-safe. Backend task implementations are bound separately.
Each workflow's `index.ts` declares its definition, workflow task store and step proofs.
`src/workflows/registry.ts` lists the registrations by hand: `PUBLIC_WORKFLOWS` in Run picker order
and `CHILD_ONLY_WORKFLOWS` for workflows admitted only through declared delegation edges.
`src/backend/app/registries/workflow-registry.ts` composes each entry against the shared task-store
inventory, so a missing or unbound store or contract fails at startup.

`WORKFLOW_MODULES` contains public workflows. It derives `DESCRIPTORS`,
`SERVER_REGISTRY`, `WORKFLOW_DEFINITIONS`, `INTAKE_PROJECTIONS`, and `WORKFLOW_ROLES`.
`workflowModuleOf` refuses child-only and unregistered workflows. `CHILD_ONLY_WORKFLOW_MODULES`
admits children through declared parent edges using `childWorkflowModuleOf`; the worker uses that
resolver to qualify every descendant before runtime admission.

#### 1.2.1 Module roles

`src/workflow-kit/validation/module-role.ts` defines `standalone`, `composition`, and
`chunk-harness`. Person Lookup and Separations are compositions.
`src/backend/app/registries/step-proof-modules.ts` composes their retained step proofs separately.
They are absent from the operator registry and do not become startable workflows.
`auditWorkflowModuleRoles` verifies role ownership.

#### 1.2.2 Workflow source layout

`src/workflow-kit/validation/source-layout.ts` derives source paths from the role:

| Role | Definition path |
| --- | --- |
| `standalone` or `composition` | `src/workflows/<id>/workflow.ts` |
| `chunk-harness` | `src/workflows/<of>/steps/<step>/step.ts` |

Every workflow folder containing `workflow.ts` has `tasks/` and at least one retained
`steps/<step>/step.ts` harness, checked by `workflow-structure`. A declared timeline group needs no
folder unless it holds a retained harness. Person Lookup retains `searching`, `cross-verify`,
`active-status`, and `crm-dates`. Each harness reuses the composition's input and canonical schemas,
step/node identities and input defaults, and carries the prerequisite read groups its step needs.
They remain outside the operator registry. Separations retains
harnesses for `identity-check`, `kronos-timecard`, `kuali-extraction`, `kuali-finalization`, and
`ucpath-transaction`. Its `job-summary` group has no harness folder.
The `workflow-layout` guard in `tests/architecture/workflow-kit/workflow-layout.test.ts` checks
registered and retained modules against their role, owning composition, and declared groups.
The hand-kept `CHILD_ONLY_WORKFLOWS` list in `src/workflows/registry.ts` includes OCR and OCR Page;
`STEP_PROOF_MODULES` collects their retained harnesses from each registration's proofs. These source audits cover both inventories without exposing
children or proofs as public starts.
Scenario-path helpers derive potential addresses; they do not prove scenario files or execution.

The workflow-ID boundary (`no-workflow-id-branches`) audits public, child-only and proof ids in
generic code. Its `ALLOWED_SITES` list admits each known file (or the dashboard mocks folder) for
named ids with a reason: dry-run targets, the OCR record service, Separations identity folds and the
preview mocks. A new id in any other generic file, a stale entry or a missing reason fails. Explorer derives contract and
implementation directories from the bound store's kind and namespace.
These references admit no new workflow dispatch or public start.

Success receipts authenticate the complete native delegation inventory and compare each child
proof and the full terminal-dependency set exactly. Many-child fan-outs remain outside terminal
value dependencies. OCR's snapshot-approval receipt declaration is separate from fixed-choice gate
decisions. Receipt derivation authenticates the retained operator command, gate row, current review
and approved snapshot digest through the OCR authority reader. Missing, foreign, altered or stale
approval evidence refuses derivation. Snapshot references and HR content declare sensitive-HR/drop classifications; local receipts
retain complete classified values under the existing local-evidence policy. Receipts keep composition 5 and the existing stored schema.

### 1.3 Projections

`workflowProjections` returns the factory-owned projection for the exact descriptor object.
A copied descriptor cannot supply the sealed planning or terminal-result interfaces.
The projection includes contracts, steps, gates, systems, requirements, timeline, node purposes,
dry-run support, and graph coverage points.

`details` declares the ordered operator fields. A source names a node output (`nodeId`,
`fieldPath`), a terminal result (`kind: "result"`, `fieldPath`), or the canonical input's safe
presentation (`kind: "input-title"`). Optional equality conditions name a validated canonical-input
or terminal-result path. Queue text details require exact receipt identity and their source's
verified evidence entry; null, blank and inapplicable values are omitted. Badge details remain
separate from text facts. Input-title details use the factory's canonical-input presentation and
never read retained search tuples.

`titleProjection` optionally names a verified terminal-result person name. Until a verified name
exists, its canonical input presentation supplies the name or employee ID typed. Names and detail fields declared with `display: "person-name"` use the
shared token capitalization without removing initial periods. A declared `protectedInput: "eid"`
allows only EID-bound test subjects (and non-subject timekeeper bindings) to show this safe identity
and the verified EID subtitle. Other protected subject bindings retain their display restriction.
Queue and run detail share the served title; immutable enqueue events retain their original
protected display policy.

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
and required checks live in [guards and tests](guards-and-tests.md).

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

`CompiledWorkflow` contains `definition`, `descriptor`, `contracts`, and `storeNamespaces`.
`composeWorkflowModule` drops unused stores, resolves required stores, places browser stores first,
and returns `descriptor`, `stores`, `role`, `intake`, and `definition`.

#### 1.6.1 Entry algebra

| Author entry | Compiled node | Current limit |
| --- | --- | --- |
| `task` | `task` | Read contract with explicit `checkpoint` or `always-rerun` replay |
| `parallel` | `parallel` and task or child-run leaves | `join: "all"`, `failure: "fail-fast"`; at least two nonempty branches |
| `delegate` | `child-run` | Typed target and explicit cardinality, await, join, and policy |
| `gate` | `gate` | Author produces operator gates with typed results |
| `transaction` | `transaction` | Prepare and commit contracts, stable binds, dry-run and probe policy |

The compiler refuses `parallel` with `join: "all-settled"`. Parallel leaves are tasks or delegates
and cannot be shared across branches. A delegate cohort admits every fan-out before yielding;
its leaves cannot depend on sibling results. The compiler orders all external prerequisites before
the cohort. Task-only parallel entries retain their independent checkpoint replay. The low-level graph vocabulary also contains `branch`; the
workflow author does not expose a separate branch entry.

#### 1.6.4 Result dependencies

`result(schema, references, derive)` declares terminal dependencies and a pure derivation. The
terminal-result owner validates exact retained evidence.

An awaited `one/terminal/one` child may supply `child-resolved` terminal evidence. The descriptor
factory validates the child workflow, schema, run, parent edge, and retained result identity.
Other cardinalities and unawaited children cannot supply a single-child terminal dependency.
A child result is not a parent checkpoint.

A resolved gate supplies `gate-resolved` terminal evidence. The factory checks its node, run,
resolution kind, result schema and checkpoint fingerprint. The terminal record retains its exact
gate reference and record digest; native completion compares them with the retained gate row.

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
- `operationDisplayCapability` and `operationDisplaySnapshot`, kept only as recorded data on older
  runs. New runs do not set them and nothing reads them.

The envelope rejects inconsistent requested instances, self-parent or self-retry identity,
wrong-attempt freshness overrides, duplicate patches, and a patch aimed at the entry node.
`nextAttemptEnvelope` removes `startAt`, `injected`, and `freshnessOverride`, and requires an
authority-supplied attempt greater than the current attempt.

`dryRun` is envelope state, not workflow input. `workflowDryRunSupport` derives support from the
graph's preview boundaries and the genuine descriptors bound by the workflow registry. A boundary is
a transaction node or a task node declaring `dryRun: "stop-before-publish"`, a local publication
whose contract declares at least one provider. A graph may prepare locally, stop before a local
publication or delegate preparation to a registered descendant; `firstTransactionNodeId`,
`firstPublicationNodeId` or `firstDelegationNodeId` names the first boundary in node order. An
unsupported transaction in the graph or its descendants refuses preview. A standalone graph with no
boundary refuses as `no-transaction-node`. In a graph that supports preview, every artifact
projection source must depend on a boundary with no `when` condition, and the executor fails a dry
run at any projection source, so a dry run never reaches a sink. In a dry run, a publication
boundary and every node that depends on it are always re-derived: the boundary is previewed again
and its dependents are unavailable. A stored checkpoint, gate result or child result never stands in
for them, on a fresh start, a resume, a retry or a recovery. `supportsDryRun` on the input-run and
upload-run surfaces is derived and cannot be authored. A dry-run plan carries no planned outputs.

A delegated child with no transaction inherits `dryRun: true` and executes its normal read-only
graph, including its gates and nested delegation. It returns the normal typed observational result
and receipt for its parent to consume. A child with an unsupported transaction still refuses; child
and parent dry-run flags must match. This exception does not offer standalone read-only previews.

### 2.1 Preview terminal result

For a transaction preview, `executeClaimedRun` traverses the declared graph and stores
`RunDryRunPreviewResult`, independently of the authored terminal derive. A parent aggregating
delegated preparation stores `RunDelegatedDryRunPreviewResult` with a distinct kind and schema hash.
A graph with a publication boundary stores `RunPublicationDryRunPreviewResult`
(`publication-dry-run-preview`), and cannot combine it with a delegated preview.
Every node has exercised, transaction-preview, delegation-preview, publication-preview, unavailable
or not-run accounting.
Each transaction prepares, verifies and captures without invoking commit. A publication node binds
and parses its input against its contract, fails like an ordinary task when that input is invalid,
and otherwise records `publication-preview` without calling its provider or writing a checkpoint;
its dependents are unavailable.
Existing completion may be observed at the durable lookup or read probe without restaging a form.

An awaited preview child resolves through its authenticated native result, completion, manifest and
settlement evidence. Its parent retains ordered grouped receipts and a delegation-preview step.
The preview cannot supply a normal typed child output, ordinary parent result or single-child
operation lineage. Tasks, gates and transactions requiring that unsubmitted output remain
unavailable. Read-only children retain ordinary typed results. A dependency's stored `satisfied`
state records resolution; the authenticated result schema and dry-run ancestry distinguish a
preview from an ordinary result. Retry, cancellation, continuation and UNKNOWN fences still apply.

A transaction may declare `previewBind` for dependencies whose real output does not exist until
submit. It returns separately schema-checked prepare/commit inputs and labelled sample provenance.
Samples never appear as ordinary upstream outputs or receipts. Reads that require an unsubmitted
result remain unavailable. Separations uses a labelled transaction-number sample to stage Kuali
finalization while its receipt and filing-presence checks remain unavailable. Its real submission
still requires the fresh filing-presence proof.

The terminal record retains every stage and authenticates actual read checkpoints through its
dependencies. No transaction checkpoint, write intent, submit fence, mutation capability or
successful-write receipt is created. Sample-derived preparations produce no
write authority. Sample values are labelled in Logs, served stage accounting and captured images;
real writes reject preview bindings, preview scope and reserved sample values before browser work.

Receipt derivation reports `DRY_RUN_PREVIEW`, empty workflow output and unknown write completion.
Full coverage means every declared node is accounted for; it does not mean every stage was
exercised. The partial-coverage arm explicitly represents a historical first-boundary preview
whose later stages were not recorded. It does not infer their membership from the current graph.
Delegated dispatch without a terminal wait records partial coverage as `descendant-not-awaited`;
it does not claim the child prepared. An empty fan-out retains its zero-member manifest without
inventing child preparation. Previews never supply Saved output or write completion.

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

Authored delegates inherit an omitted visibility from `capabilities.delegationDisplay`, or `inline`
when the workflow declares no default. An explicit edge visibility wins. The compiler resolves the
default before planning, so native policy records always contain the full visibility value.

Planning parses child inputs through the target schema before deriving stable child item ids.
The fingerprint includes edge, target, cardinality, join, policy, and ordered children. Replay
requires the same plan. A join requires the complete outcome set; zero children remain an explicit
satisfied join. `all-settled` returns all typed outcomes. An `all` join applies the failure policy.
Durable delegation records use `run_delegations` and `delegation_dependencies`.

Worker composition supplies the durable `ChildRunExecutor`. Admission authenticates the consumed
root start plan, retained invocation, declared edge and complete child membership. A physical worker
keeps its home slot while a fresh canonical claim identifies the executing descendant. The parent
releases its claim while awaiting children and resumes through a fresh claim. Missing child capacity
refuses explicitly; uncertain writes are never retried. A direct executor without this port refuses
`capability-unavailable`. OCR delegates page reads to `ocr-page`; Onboarding delegates I-9 search
to `i9-lookup`. OCR also delegates proposed identity checks to `person-lookup`.

A delegation wait keeps the parent run, attempt, enqueue instant and queue row. Its served status
is `running` at the owning step until it can continue. A `block-parent` failure appears as `blocked`
on every waiting ancestor, including when another branch is still active. A child's approval gate
appears only on that child; waiting ancestors remain `running`. Queue status filtering happens
before pagination, so released parents are never counted or selected as queued work. Queue, Logs
and Activity use the same authenticated wait facts.

`resume-parent` makes a completed retry eligible for joining. For a genuine transaction-free
parent at an unresolved gate or completed before approval, accepting a joined child retry opens a
waiting refresh on the same run and attempt. One native wakeup follows settlement of every accepted
replacement. Approved snapshots and resolved gates cannot reopen through this operation. `manual-parent-resume` pauses the
waiting parent through its existing pause control while the replacement child can execute. Resume
requires terminal evidence for every current manual retry and binds its native command identity to the exact dependency, child,
attempt and result digest. A later retry needs its own acknowledgement. Resume keeps the parent's
run and attempt; it cannot release an unresolved or UNKNOWN write.

A parallel step can contain several child-run leaves. One admission transaction authenticates every
leaf and records their ordered membership before releasing the parent once. Each leaf keeps its own
invocation, manifest, dependencies, child results and retry history. Ready or unawaited-only cohorts
do not yield. A resumed parent authenticates each branch again; completed continuation branches
reuse their retained evidence. A cancelled cascading branch does not cancel an independent sibling.
An UNKNOWN write in any awaited branch prevents the parent from joining or being retried.

Each leaf retains its existing admission receipt. The running transition identifies the cohort
owner; registered leaves, retained invocations and continuation evidence prove complete branch
membership. All admissions share the held claim and parent version, and exactly one requeue receipt
proves the release. These facts derive the wait without changing stored record shapes.

A trusted read-only parent refresh may revise a fan-out through a new immutable invocation and
manifest. Each revision cites its immediate predecessor and the settled retry cohort. Joins and
review inputs select the current member set; retained receipts keep their exact invocation,
member attempts and settlement versions. Removed members retain their original control history.
A rebuilt review checkpoint receives a new binding even when its lookup inputs are identical.

Reuse requires the same canonical input, explicit individual source-record set, target contract,
configuration and fresh authenticated observations. Otherwise admission creates a new read,
bound to fresh execution and checkpoints owned by that child. Complete accepted retry membership
derives from native admission and extension journals through the owner's recorded version;
an omitted extension refuses authentication and settlement. Refresh never retries a successful
write or changes an earlier manifest. A ready parent can accept another
retry cohort before being claimed; an executing refresh refuses a concurrent child retry.

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
A terminal `interrupted` run may return to `queued`. An ordinary retry creates another run.
An authenticated read-only delegation refresh can also return an unapproved completed parent to
`queued` on its existing row. A factory-proved aggregate with a read-only own graph can refresh
its authenticated done or failed settlement after a failed writing member is replaced. It reuses
the original approval and successful children; only the new child owns write authority. Its manual
Resume preserves the entire envelope and continuation, while its derived accounting consumers run
fresh against the current member receipts. Earlier terminal results, receipts and accounting
checkpoints remain immutable and readable; current output remains unavailable until refresh settles.

A gate records its typed result separately from checkpoints. The executor emits `gate.opened`,
closes sessions, and persists `parked-gate` with `gateId` and `resumeAt`. Resolution requeues the
run; a fresh claim reacquires sessions. Neither park has an edge directly to `running`.
`src/backend/runtime/gates/gate-source-runtime.ts` owns source binding for workflow and external
gates. The workflow author currently produces operator gates.

A same-run gate resolution resumes at its next node, or at the gate itself when it is last.
The resolved gate replays its typed result. Earlier completed terminal child joins pass through
canonical child admission with their original input and native proofs. Their manifests, child runs
and results remain unchanged; absent or changed proof refuses the resume.

A `parked-write` records the exact intent generation and code: `unknown`, `ambiguous`,
`present-proof-invalid`, `binding-invalid`, or `operator-required`. Write recovery owns its exits.
A gate result or ordinary Rerun cannot substitute for write resolution.

## 5. Resume and checkpoints

### 5.3 Replay policy

Every read entry explicitly declares `replay: "checkpoint"` or `"always-rerun"`.
The executor validates and replays checkpoint ancestors. Ordinary execution runs `always-rerun`
ancestors again; an authenticated Pause/Resume or failed-run continuation reuses their completed
checkpoints after the same schema, fingerprint, provenance and freshness checks. A completed `always-rerun` checkpoint
that fails the freshness check toward a transaction the continuation does not retain is run again.
A continuation compares a completed node's input with the rows it was bound from: its run's newest row
up to the node's claim, else the row the run was created with. A retained delegation is compared with
the rows its admission recorded. Replay restores values, never browser
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
A gate decision ages only `checkpoint` dependencies; an `always-rerun` dependency is read again when the run resumes.
A stale fact of a `checkpoint` task refuses the run. A stale fact of an `always-rerun` task makes the executor run that
task again, so the refusal is never reported for it.

### 5.6 Recovery and Rerun

`RunRecord.pause` is an orthogonal scheduling hold. Queued work pauses immediately. Claimed work
records a request; the worker cancels the current step and acknowledges the hold, and the step
restarts on Resume. A step past its write fence finishes its write before the hold is acknowledged. A claim release
into queued delegation or a gate park acknowledges the hold atomically and preserves that park.
Resume clears only an acknowledged hold; paused work cannot be claimed. A run-level pause affects
that exact run, including a parent; it does not implicitly cascade to children. Pause-all validates
and pauses the complete current nonterminal membership, including children. UNKNOWN parks remain
write-recovery authority and are never made resumable by these commands.

Dashboard Rerun accepts done, failed and interrupted sources without uncertain writes. It creates a
new source-bound run under the current descriptor, without inherited checkpoints or an implicit
continuation. Compatible older source values remain available for operator selection.

Native Retry takes the item's next authority-allocated attempt and requires the source descriptor
version and fingerprint. It uses the existing checkpoint policies; an always-rerun node executes again.
It creates no authenticated continuation and preserves the write-safety and delegated-retry rules.

Resume keeps the current attempt and retains completed results through exact server-issued continuation
coordinates. Each source pins run, version, attempt and a digest of input and immutable execution
identity. Queue priority and the gate scheduling cursor `startAt` keep their separate command authority.
Current-envelope validation uses the latest issuance; child replacement authority binds the exact
retained issuance version that created it. Retained source bytes, issuance, checkpoints and gate
evidence are revalidated before reuse; missing evidence fails closed.

Dashboard Run and Rerun retain the selected mode, protected-input identity, and authority-allocated
attempt. Verification checks bind checkpoints and screenshots to that persisted attempt; a
rehearsal declaration cannot change recovery or authorize another submit.

`src/backend/runs/start/rerun.ts` and `rerun-values.ts` own dashboard Rerun prefill and warning
planning. Ordinary Rerun accepts compatible older source values without requiring the original
descriptor version or fingerprint. It validates the current input and retained warning evidence.
The form keeps current input defaults and offers a source value only when the current descriptor's
value mapping, canonical input, and omission schemas accept it. For typed input, the full source value
is restored only when the current input and canonical-input schemas accept it unchanged. If that parse
fails for an unprotected source input, `readRerunValues` returns only mode, default, and identity fields
accepted unchanged by both schemas. The form combines those fields with current defaults and restores
identity text only when the current mode's identity requirements are complete. Otherwise, the text box
is blank for operator re-entry. Rejected fields are not coerced. Submitted values go through
`planStart` with the registered descriptor and its current input schemas.

For Onboarding, an available retained source that exactly matches the current canonical schema passes
through the registered workbook binding's `sourceToIngress`. It removes server-owned `roster` and validates
strict ingress while preserving `email`, explicit `mode`, `postalCodeOverride` and `configuredJobEndDate`. The caller-roster refusal remains
in force. Older partial or protected sources retain the rules above. Retained protected-input bindings are
required storage metadata; missing bindings refuse the source rather than becoming an empty array.

For an older descriptor version or fingerprint, `readRerunValues` reports every current step as
unfinished, so `defaultRerunSteps` selects every current step. For a matching descriptor, it preserves
the existing preselection based on source outcome and step completion, then applies current omission
rules. Incompatible retained transaction-warning evidence still refuses Rerun.

Rerun reads source checkpoints and gate results to build value offers and validate copied coordinates.
Accepted continuation retains exact completed task, gate, transaction and child-result evidence.
Continuation validation authenticates captured transaction coordinates and requires the exact settled
natural-key intent and proof. Predecessor repeat-occurrence checkpoints are refused before admission;
ordinary acknowledged repeats retain their distinct keys and own-run Resume remains supported.
For a settlement inherited from another run, the executor compares original and current prepare and
commit mappings before passing its unchanged native run and restored scope to the write sequencer.
The sequencer retains all schema, implementation, proof, key and unresolved-sibling checks and reuses
an eligible completion with no new probe, prepare, submit, intent, transaction checkpoint or
confirmation publication. A correction that changes a completed task or transaction's mapped input
refuses reuse. A settlement the run made itself is not compared unless the transaction reaches a
child run, directly or through a conditional dependency: the run's input is fixed, so a later read is
an observation, and the sequencer's key and proof checks decide the replay. UNKNOWN, attempting and parked writes refuse Rerun; saved results
never authorize another submit.

Completed tasks whose dependencies include a transaction wait for its authenticated semantic output
before replay comparison, correction and hydration. Their current branch and condition still apply.
An authenticated closed not-run dependency remains absent for optional consumer bindings; it is
not missing context. Original conditional skips are re-evaluated from the source's declared
condition and authenticated dependency scope. An absent required gate result still refuses.
Exact own checkpoints use the current native owner even when ordinary gate resolution requeues a
continuation without adding a Pause/Resume self-reference; foreign checkpoints require retained lineage.
Reusing a transaction publishes no new submit confirmation;
new-submit publication requires settlement evidence from the current execution.

Child-dependent transaction mappings use native authenticated delegation evidence. The original
scope retains member order, result schemas and sealed terminal results. Retry journals can prove
replacements issued to a continuation at creation, before its first claim, or replacements issued
after an exact retained source failed. The former belong to that continuation's original scope;
the latter are rewound when reconstructing the failed source. Original and current prepare and
commit mappings must agree, so an all-settled member may change only when the mapped fields do not.
Join-none dependencies keep their immutable manifest reference. Failed-parent terminal results
currently carry no dependency receipt: earlier or in-flight replacement histories without enough
native authority refuse with `RUN_CONTINUATION_REFUSED`, including own-run Resume. Effective
members never substitute for an unprovable original scope.

Dashboard Rerun consumes its canonical source-bound plan; native Retry uses the lifecycle
service. These ordinary doors do not capture continuation lineage.

The separate **Recover completed steps** action uses `run/recover-run`. It is operator-only: the assistant cannot retain or dispatch it. Native recovery and its server-derived planner require the kernel's exact active canonical recovery-command scope before reading product audit proof or minting an attempt; a parsed or retained command alone provides no authority. Its public request names only
the source run and expected version. `runs/start/recovery-plan.ts` derives a `RunRecoveryPlan` from
native authority, distinct from a Rerun plan. It accepts failed or interrupted sources under the same
descriptor version, contract and runtime fingerprint, with no attempting or parked writes. It keeps
source inputs, dry-run mode and omissions unchanged; it accepts no caller checkpoint or input override.
`RunRecordService.recover` allocates a new attempt and records a separate `recover` lifecycle journal.
The command's confirmation and typed refusal use the existing action renderer and client facade.

A recovered run may use a new configuration snapshot with the same fingerprint after startup.
Repeated recovery authenticates its product command, native origin, issuance and original start plan;
it does not substitute snapshot-ID equality for that lineage. Parent recovery replaces only failed
children with sealed terminal proof and preserves successful siblings. An interrupted parent may
recover those proven children. A truly interrupted child without native terminal-result authority
refuses visibly; normal crash reconciliation first records a structured failed settlement.
Unprovable child history and predecessor repeat occurrences remain refused with
`RUN_CONTINUATION_REFUSED`. Ordinary Rerun still requires its own repeat consent.

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
and exact reads. `src/backend/storage/sqlite/run-continuation.ts` restricts source-bound
and fresh restart reads to this run's own attempt rows. Authenticated continuation prefers its own
rows and then reads only its exact retained source coordinates; ordinary recovery uses the item's
latest row. `loadCheckpoint` returns `{ found: true, ... }` or `{ found: false, reason }`, validating
version, fingerprints, schema hash, and payload. A mismatch refuses rather than selecting a
plausible output with an equal schema. `src/backend/storage/sqlite/migrations.ts` makes checkpoint
updates and replacement inserts illegal and permits deletion only with the owning deleted-run
tombstone. Event-stream retention does not delete checkpoint authority.
It also retains original `gate.resolved` events after terminal settlement: delegation root
authentication binds a resumed run to that exact native event, command and gate result.

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

`src/workflows/person-lookup/workflow.ts` composes four visible steps and ten graph nodes from its step modules. Step order controls presentation. The table lists each step's nodes in declaration order.

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

The shared Person Org driver compares names against the original normalized full request before
drilling grid candidates or accepting an automatic detail. Comma-free names use given-name then
family-name order; `Family, Given` is the explicit alternative. Shortened or reordered search queries
do not authorize another identity. Prefix-only or reversed-person results are not-found; distinct
exact EIDs remain ambiguous.
Separations and I-9 Check use this same driver rule.
Name-only CRM discovery independently requires the exact full requested name on the search row
and opened record, so CRM-only recovery cannot introduce a prefix employee. A supplied EID keeps
its exact displayed-EID lookup and name fallback.

The result uses `active-status` in Search mode. In Match mode, it derives the outcome from the identity, match output, and any verified CRM record. CRM dates are `included` when `crm-dates` runs and `not-requested` otherwise. `requireFact` refuses a missing required fact.

`unselectedCrmRecords` is nullable. `crm-results` runs for an array, including `[]`, and skips when the field is `null`. Its bind builds the same query as `cross-verify`. The task reads the current CRM results and compares them with the discovered records. If they differ, it fails with `PERSON_LOOKUP_CRM_RESULTS_CHANGED`. `crm-results` returns unresolved rows without treating a row as the selected CRM record. When `crmRecord` is present, `crm-selected-record` reopens the record and verifies its current identity and facts. `crm-results` skips on this branch.

Every browser task that executes requires its own task-point screenshot, even when another task captured the same page. `searching`, `matching`, `crm-selected-record`, and `crm-results` place their own captures. The runtime captures at finish only when that task has no successful capture, including `cross-verify` and a `crm-selected-record` check-failed result; it never adds a finish capture after a successful task-owned capture. CRM discovery (`cross-verify`) captures results before a selected record is opened. On empty or ambiguous branches, `cross-verify` and `crm-results` each capture the results page for their separate tasks.

These workflow captures are required even when `captureBrowserScreenshots` is false. A failed or unavailable required capture prevents the task checkpoint. Checkpoint replay restores task output and does not invoke capture or create a new Screenshot action.

The workflow has no transaction, gate, parallel, or delegation node. Its dry-run preview refuses because the graph contains no transaction. Its declaration is not evidence of a current live run or completed dashboard wiring.

## Not built yet

- The wiring base must consume served descriptor projections through existing dashboard components, retaining explicit loading, empty, failure, refusal, and uncertain states.
- Each workflow switches to served data, one at a time, after a dry run where supported and operator sign-off. [Dashboard ready on the Mac](../roadmap/roadmap.md#dashboard-ready-on-the-mac) owns that sequence.
- A workflow that first uses child-run execution must verify its registered targets, durable fan-out and recovery behavior through worker composition.


Workflow timeline groups may declare a default `system` and ordered `operatorFields`. Each field owns its operator label, optional fictional display-string `example` and exact node/input-or-output path sources. An optional `visibility: "logs"` limits a field to retained observations, excluding it from Explorer examples. Groups may also declare operator `description` text. The compiler checks that every source belongs to the group and resolves through its task contract; collection paths address all members, without selecting a candidate. Logs preserves member order and keeps each member’s declared fields together. Logs uses these declarations to project classified observations and eligible frozen action values. Unlisted paths remain in Run data and diagnostics. Explorer projects declared fields and examples in group order, with explicit definition-preview copy; an undeclared example is reported as unavailable rather than replaced by a run value.


An operator field may declare optional closed `display.cases`, each with a string, number or boolean
`value` and display `text`. Typed literals are distinct and duplicate typed cases refuse. Logs maps
only declared allowed scalars; an unknown scalar refuses with `RUN_LOG_DISPLAY_VALUE_UNMAPPED`.
Null and absent values omit the field, redacted values remain redacted, and retained raw values stay
unchanged. Logs collapses forwarding aliases only when declaration identity, direction and exact
original observation cause agree. Independent observations, transitions and actions remain in order;
missing historical lineage never becomes a match by equal label, value or time.

Step modules own group metadata, typed entry wiring, omission declarations and result contributions
through `defineStep`. Their proof recipes retain proof identity and order; `index.ts` derives each
harness with `defineStepProof`. `inheritStepProof` shares parent ingress and presentation without
copying declarations. Specialized proof ingress remains explicit in `StepProofSpec`. Workflow
composition uses typed build results, without runtime group or entry lookups.

A delegate may declare `sourceRecordIds(scope)`, an ordered list of record sets aligned with its bound children. Each set is nonempty and unique; planning sorts it and includes it in the immutable plan fingerprint. Canonical input equality does not replace this source membership proof. OCR identity and signer lookups declare the records that requested each read.
