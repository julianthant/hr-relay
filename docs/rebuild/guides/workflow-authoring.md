# Workflow authoring

Start with the assigned brief, its README and the [codebase map](../reference/codebase-structure.md).
Use the approved workflow maps and review policy in the [root instructions](../../../AGENTS.md#what-to-build)
for coding authority and operator acceptance.

Read [workflow-model](../reference/workflow-model.md),
[task-contract](../reference/task-contract.md), [write-safety](../reference/write-safety.md) and
[guards-and-tests](../reference/guards-and-tests.md) for their contracts. The internal
[checklist](../../../.agents/skill-library/workflow-authoring/REFERENCE.md) adds no policy.

## 1 · What you author and what is derived

Author one browser-safe `src/workflows/<id>/workflow.ts`. It declares identity, input, presentation,
role, scenario IDs, ordered timeline tuples and the terminal result through `defineWorkflow`.
Workflow-owned task implementations live in `tasks/` with `task-registry.ts`; only backend
composition loads them. A chunk harness lives at
`src/workflows/<composition>/steps/<step>/step.ts`.

`src/workflow-kit/workflow-definition.ts` owns `defineWorkflow` (validation), `compileWorkflow`
(descriptor, graph, timeline, contracts, namespaces, display and manifest fingerprint), and
`composeWorkflowModule` (exact implementation bindings).

Do not author descriptors, flows, module files, node fragments or a second Explorer graph beside
`workflow.ts`. Do not add workflow-id branches to generic dashboard or runtime code. Extend a
shared capability at its owner when the requested behavior needs one.

`workflow-layout` and `workflow-authoring-budget` constrain paths and builder calls; the latter
checks closed `ARTIFACT_EXEMPTIONS` and `GENERIC_WORKFLOW_ID_ALLOWLIST` lists. Keep receipts and
evidence in the brief's main-checkout `.work/` evidence folder.

## 2 · Find, reuse or build

Search the generated task catalog in [stores](../reference/stores.md) by system, capability,
effect, input and output. `src/backend/app/registries/task-registry.ts` composes that inventory;
`npm run stores:catalog` generates it and `npm run stores:catalog:check` checks its bytes.

| Need | Change |
| --- | --- |
| Existing operation with the same contract | Import that exact contract into `workflow.ts`. |
| Existing typed option | Bind the option from the workflow input. |
| New variant of the same browser operation and output meaning | Extend the shared contract and implementation with the typed option; update its consumers and tests. |
| Pure workflow-specific calculation | Use or add a task in `workflow:<id>`. |
| New page operation or output meaning | Add the contract and driver operation to the owning system store. |
| External write | Declare a `transaction` with prepare/commit contracts and their write-safety policy. |
| New generic dashboard interaction | Change the shared capability under its own approved scope. |

Reuse follows the operation and output contract. Bind or fold the useful facts from a page-read
task instead of adding another scrape for one field.

## 3 · Files and registration

Keep definitions browser-safe: use shared models, rules and workflow-kit factories. Do not import
backend task implementations, browser drivers, Playwright or credential access into a definition.
`src/workflow-kit/validation/source-layout.ts` derives source paths from role.

For a new operator workflow:

1. Create `src/workflows/<id>/workflow.ts` with one `defineWorkflow` call.
2. In `src/backend/app/registries/workflow-registry.ts`, import the definition, export the module
   through `composeWorkflowModule(compileWorkflow(definition), taskStoreRegistry.stores)`, and add
   it to `WORKFLOW_MODULES`.
3. In `src/workflows/descriptor-registry.ts`, import the same definition and add
   `compileWorkflow(definition).descriptor` to `WORKFLOW_DESCRIPTORS` in the same order.
   `tests/workflows/descriptor-registry.test.ts` checks tuple equality and descriptor identity.
4. Run `npm run build:manifest`, then `npm run build:manifest:check`. The generator discovers the
   definition sources; do not hand-edit
   `src/workflow-kit/validation/generated-build-manifest.ts`.
5. Register any new workflow-owned store through `src/backend/app/registries/task-registry.ts`,
   then regenerate and check the store catalog.
6. Record copied source provenance, acceptance evidence and unfinished checks in the brief's
   evidence folder.

Register harnesses separately through `STEP_PROOF_MODULES` in
`src/backend/app/registries/step-proof-modules.ts`. They do not enter the operator tuple or picker.
A group without a harness needs no step folder.

Registration refuses missing or duplicate stores and a store that binds a different contract
object. Import the real contract value; an equivalent schema or copied declaration does not satisfy
`composeWorkflowModule`. `auditImplBindings` in the workflow registry checks
`src/backend/app/registries/pending-impl-bindings.json` against contracts used by registered
workflows. Remove a pending entry when its implementation exists. Pending records do not make tasks executable.

## 4 · Write `defineWorkflow`

### 4.1 Definition fields

Use the current `WorkflowDefinitionSpec` in `src/workflow-kit/workflow-definition.ts`. It combines
`WorkflowDescriptorSpec` presentation fields with `input`, `role`, optional `intake`, optional
`operationDisplay`, and `steps`. Do not supply compiler-owned `flow`, `timeline` or
`contractFingerprint`.

- Apply defaults in the ingress `input` schema. Use `defineCanonicalInput` from
  `src/models/workflow/canonical-input.ts` for the complete stored input without defaults.
  `dryRun` belongs to the run envelope, not the workflow input.
- Use `defineWorkflowRole` from `src/workflow-kit/validation/module-role.ts` for `standalone`,
  `composition` or `chunk-harness`. A harness names its composition and timeline step.
- Use shared models for parsing, details, identity, presentation and capabilities; examples must
  parse. Scenario IDs are contract metadata, not execution evidence.
- For spreadsheet intake, use `defineIntakeProjection` with canonical fields from
  `src/models/fields/registry.ts`; reuse their schema objects.

### 4.2 Entries and binds

`steps` receives a `WorkflowAuthor`. Return `{ steps, result }`, where `steps` is an ordered array
of `[group, entries[]]`. Tuple order controls presentation. References control execution.

| Author method | Declaration |
| --- | --- |
| `task(identity, references, bind)` | Read contract, stable `id`, `replay`, optional label and `when`. |
| `gate(identity, references)` | Stable `id`, label, result schema, optional `statusKey` and `when`. |
| `transaction(identity, references, { prepareBind, commitBind })` | Prepare/commit contracts, dry-run and probe policy, positive integer probe-to-fence budget, optional retry policy. |
| `parallel(identity, branches)` | Explicit branches and task leaves; see §8. |
| `delegate(identity, references, { bind, deriveChildItemId })` | Typed child-run target and policy; see §8. |
| `result(schema, references, derive, sources?)` | Terminal result schema, references and pure derivation; optional operation-display source bindings. |
| `group(step, { omission })` | Whole-step omission declaration; see §7. |

Binds receive `input`, referenced `outputs`, optional `protectedInputBindings` and `configuration`.
Declare all dependencies. For required nullable facts, use `requireFact(value, nodeId, path)` from
`src/workflow-kit/workflow.ts`; handle valid absent/conditional arms explicitly.

Choose `replay: "checkpoint"` for durable values. Choose `"always-rerun"` for browser state that
must be recreated or a check that must run again. This choice controls checkpoint reuse, not whether
the runtime records the output.

`when` declares `is-true`, `is-false`, `is-present`, `is-absent`, `equals` or `not-equals` over
input/node paths through `src/models/workflow/node-condition.ts`. Node operands require dependencies;
skipped outputs are `undefined`.

### 4.3 Refusals and compiler identity

`defineWorkflow` validates on import: groups and entries are nonempty, keys/labels/IDs are unique,
each entry has one owner, references resolve once, and dependencies have no cycle. Step-owned
entries use the exact shared step object. Omission refusals follow §7.

`compileWorkflow` requires a factory-produced definition and memoizes by definition object and
manifest identity. Regenerate on `has no build-manifest entry`; one definition cannot compile under
different manifests. `composeWorkflowModule` refuses missing/duplicate stores and mismatched
contract objects. Fix the named owner rather than copying a declaration.

### 4.4 Operation display and Explorer

`operationDisplay` is optional. The compiler uses task-owned operations, action trees and source
slots, then validates occurrence bindings, transaction read roles and result sources. A declared
complete display must name the exact contracts from the transaction's write-safety declaration.
Omitting the declaration leaves a `legacy` capability; it does not infer a complete display.

`workflowExplorerDeclaration` projects the definition; the backend checks graph and timeline
coverage. Keep stable entry/leaf IDs and exact contracts. Source jumps require one displayed
producer; missing or ambiguous sources remain unavailable. Branch choices are hypothetical.

## 5 · Person Lookup: reuse and a pure fold

`src/workflows/person-lookup/workflow.ts` declares `searching`, `cross-verify`, `active-status` and
conditional `crm-dates`, without gates or transactions. `crossVerify` references `searching` and
requires `selection.selected`; the result handles included dates and `not-requested`. Read this
complete definition for schemas, parser, intake and presentation. Its four retained read-only
harnesses live under `steps/` and import its shared step/node identities. Each includes the upstream
read groups needed by its target step and reuses the exact input, canonical schema and input defaults.

## 6 · Separations: shared steps, gates and transactions

Read `src/workflows/separations/workflow.ts` for the composition. It declares six timeline groups:
`kuali-extraction`, `identity-check`, `job-summary`, `kronos-timecard`, `ucpath-transaction` and
`kuali-finalization`. The five retained harnesses live under `steps/`; `job-summary` has no harness
folder.

### 6.1 Shared step identities

Use `defineWorkflowStep` from `src/workflow-kit/workflow.ts` and `defineStepEntries` from
`src/workflow-kit/workflow-definition.ts` when a composition and harness share identities.
`defineStepEntries(step)` provides `task`, `transaction` and `operatorGate` identity factories.
Identities carry the exact frozen step object and policy. Wiring remains in the author's methods.
Each harness imports those identities from the composition and binds its own ingress.

### 6.2 Conditional operator gate

Separations' `identityApprovalGate` conditions on `packet.emplIdSource`. The gate references the
comparison; the approval fold references comparison and gate and handles the skipped `undefined`
arm. The shared runtime owns parking and `resolve-gate`; workflows do not resolve their own gates.

### 6.3 Transaction identity and binds

A transaction declares `prepare`, `commit`, `dryRun: "stop-after-prepare" | "unsupported"`,
`probePolicy: "always" | "retries-and-recovery-only"`, `probeToFenceMaxMs` and optional
`retryBeforeFence`. The task contracts own probe, verification, target and saved-effect policy;
read [write-safety](../reference/write-safety.md) before changing them.

Bind prepare and commit from canonical input and referenced facts. `commitBind` does not read the
prepare task's output: its target is available before page mutation. Downstream output is a
`TypedTransactionOutcome`, not the bare commit output. For example, Separations reads
`outputs[TERMINATION_NODE].output.receipt` and checks the outcome's `disposition`.

Use the shared write runtime rather than adding workflow-specific fences, receipt writers or retry
logic. Repeat a completed transaction only through an admitted source-bound Rerun plan with the
required repeat-warning acknowledgment and exact server-owned repeat authorization. Follow
[write-safety](../reference/write-safety.md#explicit-repetition) for fresh occurrence proof; never
retry an UNKNOWN submit through generic retry.

## 7 · Omissions

Declare `StepOmissionDeclaration` from `src/models/workflow/step-omission.ts` beside the step's
identities, then wrap the tuple group with `group(step, { omission })`.

- `form.fields` uses the closed vocabulary: `text`, `us-date`, `eid`, `integer`, `boolean`, `enum`
  and `text-list`. Every declared fact is required; empty forms are allowed.
- `produces` maps that step's task entry IDs to pure functions of `{ facts, scope, assertedAt }`.
  Each function returns the task's complete schema-valid output.
- Omission executes no entry in the group. A gate inside the group is omitted too. Transactions
  produce no transaction outcome.
- The compiler refuses producers for another step or for a non-task entry. It also refuses an
  outside entry that reads an omitted member not rebuilt by `produces`.
- Place a mandatory verifier outside the omittable step. Rebuild needed facts from the form, move
  the reader inside the step, or declare the check separately.

Result schemas and derives handle omitted entries: Separations uses `omittedOr` and
`{ state: "omitted", step }`. Assertion checkpoints cannot replay as observations. Admission and
execution validate facts and rebuilt outputs through the omission and task schemas.

## 8 · Parallel and delegate entries

See `tests/support/fixtures/workflow-definition-fixtures.ts` and
`tests/workflow-kit/workflow-definition.integration.test.ts` for executable compiler/runtime
fixtures. Neither operator workflow uses parallel or delegate entries.

A parallel identity declares `join: "all"` and `failure: "fail-fast"`. It needs at least two
branches, each with a unique ID and nonempty task leaves. A leaf belongs only to its parallel entry,
not another branch or timeline tuple. Each leaf checkpoints independently. Readers reference leaf
values directly; the parallel output names the branch-to-leaf mapping. Parallel `"all-settled"` is
a named `capability-unavailable` refusal.

A delegate declares `target: { id, input, result }`, `edgeId`, `cardinality`, `await`, `join`,
`DelegationPolicy`, a child-input bind and `deriveChildItemId`. Admitted shapes are
`one/terminal/one`, `many/terminal/all`, `many/terminal/all-settled`, or either cardinality with
`none/none`. It returns `DelegationManifestRef` without a wait or typed child outcomes after terminal
waits. It uses child-run authority.

## 9 · Add a task only when needed

Follow Person Lookup's `ReadActiveStatus` fold:

- Contract: `src/models/workflows/person-lookup/read-active-status.ts`.
- Sessionless implementation: `src/workflows/person-lookup/tasks/read-active-status.ts`.
- Store: `src/workflows/person-lookup/task-registry.ts`, loaded by the backend task registry.
- Bind: `src/workflows/person-lookup/workflow.ts`.
- Tests: `tests/workflows/person-lookup/tasks/read-active-status.test.ts`.

Record every output leaf with `ctx.recordData`; use `ctx.fail` with a declared error code for a
refusal. A direct implementation test with a no-op recorder cannot prove executor provenance.
When adding an output leaf, update its recording and use the real provenance collector in proof.
Pure derived tasks cannot refresh upstream captures; `ReadActiveStatus` explicitly has infinite
own freshness and ages its inputs through the shared dependency policy.

A browser task uses `defineTask(driver, contract, implementation)` with the exact
`DriverDeclaration`. Read the system's `AGENTS.md`; selectors and page interpretation belong in
its driver and UI registry. Verify within the assigned scope. Regenerate the catalog and manifest
when their inputs change.

## 10 · Verify the change

Select focused tests for the changed behavior, run `npm run lint`, and run affected static and
generated checks. Tests mirror source under `tests/`, dropping `src/`; integration files use
`.integration.test.ts`. Shared fixtures and helpers live under `tests/support/`.

Inspect these existing tests for the affected seam:

- `tests/workflow-kit/workflow-definition.test.ts` and
  `tests/workflow-kit/workflow-definition.integration.test.ts`: compiler and runtime.
- `tests/workflows/descriptor-registry.test.ts`: registration identity and ordering.
- `tests/architecture/workflow-kit/workflow-layout.test.ts`: paths.
- `tests/architecture/workflow-kit/workflow-authoring-budget.test.ts`: budget.
- `tests/architecture/workflow-kit/descriptor-coverage.test.ts`: manifest coverage.
- `tests/architecture/workflow-kit/step-omission-invariants.test.ts`: omissions.

Check `npm run build:manifest:check`, `npm run stores:catalog:check` and `auditImplBindings`
consumers when their inputs change.

Before proposing integration, run `npm run typecheck`, `npm run lint`, `npm run web:build`,
`npm run test:parity`, then `npm run test:coverage` alone. Coverage runs unit, integration and
architecture suites. Preserve assertions, membership, isolation, coverage floors and timeouts.
Parity uses the fixed desktop presentation contract; do not update references to make wiring pass.
Follow the assigned brief's additional checks and resource limits.

Use the signed-in dashboard Run surface for workflow execution. Select Dry Run only where the
workflow graph supports a transaction preview; transaction-free reads use their ordinary mode.
Rehearsal declarations and test-target availability validate verification inputs, not authentication
or permission to execute. Missing manifests and unavailable subjects remain explicit refusals;
do not substitute a fixture or another subject.

## 11 · Debug at the owner

- Definition errors occur on import. Inspect the named group, entry or reference, then run the
  focused importing test and typecheck. Reordering tuples does not change dependencies.
- `workflow bind requires <node>.<path>, which is null|absent` comes from `requireFact`. Model the
  valid upstream arm or refuse explicitly; do not supply a plausible default.
- Task failures use their declared `errorCodes`; `npm run cli -- explain run <traceId|runId>` reads run evidence.
- `npm run cli -- storage` inspects storage health. `npm run dashboard` starts the local dashboard.
  Diagnostics do not prove a transaction completed.
- Selector and page-state failures belong to the system driver. Use the internal
  `.agents/skill-library/hr-debug/REFERENCE.md` and the repository's playwright-cli procedure
  within the authorized scope; snapshot before choosing locators.

Keep actual commands, results and unrun obligations in the brief's evidence. Do not treat a fixture
pass, an old live receipt or a declared scenario as current external-state proof.

## 12 · What file to change

| Change | Owner |
| --- | --- |
| Groups, options, omission forms or binds | Main `workflow.ts` |
| Shared harness identities | Composition `workflow.ts` and affected `step.ts` binds |
| Selectors or page interpretation | System driver/UI registry |
| Operation input/output/effect | Task contract, implementation and consumers |
| Authentication | Session provider/login declaration |
| Retry/checkpoints | Executor/recovery services |
| Logs, receipts or dashboard projection | Shared runtime/projection owner |
| New workflow/store | Registration files in §3 |

Grouping/options changes need no new implementation file. Update affected tests and derived
products. Do not add per-workflow adapters, checkpoint writers, screenshot hooks or bootstraps.

## Not built yet

- Workflow wiring connects Run, Rerun, Queue, Logs, Explorer, applicable OCR/Records, notifications
  and Analytics through existing components; Explorer timelines come from registered definitions.
- Each workflow switches from mock to served data through one static switch; served failures show
  failure states, and completion requires a dry run and operator sign-off.
