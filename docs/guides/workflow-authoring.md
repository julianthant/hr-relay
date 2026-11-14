# Workflow authoring

Start with the assigned brief, its README and the [codebase map](../reference/codebase-structure.md).
Activation order and operator acceptance are in
[Dashboard ready on the Mac](../roadmap/roadmap.md#dashboard-ready-on-the-mac).

Read [workflow-model](../reference/workflow-model.md),
[task-contract](../reference/task-contract.md), [write-safety](../reference/write-safety.md) and
[guards-and-tests](../reference/guards-and-tests.md) for their contracts. The internal
[checklist](../../.agents/skills/hr-workflow/references/workflow-authoring-checklist.md) adds no policy.

## 1 · What you author and what is derived

Author one browser-safe `src/workflows/<id>/workflow.ts`. It declares identity, input, presentation,
role, scenario IDs, step composition and the terminal result through `defineWorkflow`.
Workflow-owned task implementations live in `tasks/` with `task-registry.ts`; only backend
composition loads them. A step definition lives at
`src/workflows/<composition>/steps/<step>/step.ts`; the kit derives its chunk harness.

Every workflow has `tasks/` and `steps/`. Steps group tasks into the checkpoints on the run
timeline; hovering a checkpoint shows its tasks. Reused system operations stay in their system
store, and a thin workflow-owned task retains their typed result through declared dependencies.

`src/workflow-kit/workflow-definition.ts` owns `defineWorkflow` (validation), `compileWorkflow`
(descriptor, graph, timeline, contracts, namespaces, display and manifest fingerprint), and
`composeWorkflowModule` (exact implementation bindings).

Do not author descriptors, flows, module files, node fragments or a second Explorer graph beside
`workflow.ts`. Do not add workflow-id branches to generic dashboard or runtime code. Extend a
shared capability at its owner when the requested behavior needs one.

`workflow-layout` constrains paths; `no-workflow-id-branches` refuses workflow-id literals in generic
code outside its reasoned `ALLOWED_SITES` list. Keep receipts and
evidence in the brief's main-checkout `.work/` evidence folder.

## 2 · Find, reuse or build

Search the task catalog in [stores](../reference/stores.md) by system, capability, effect, input
and output. `src/backend/app/registries/task-registry.ts` composes that inventory; update the
catalog entry when you add or change a store task.

| Need | Change |
| --- | --- |
| Existing operation with the same contract | Add a typed call to that exact contract in the workflow’s `tasks/` folder and group it in its timeline step. |
| Existing typed option | Bind the option from the workflow input. |
| New variant of the same browser operation and output meaning | Extend the shared contract and implementation with the typed option; update its consumers and tests. |
| Pure workflow-specific calculation | Use or add a task in `workflow:<id>`. |
| New page operation or output meaning | Add the contract and driver operation to the owning system store. |
| External write | Declare a `transaction` with prepare/commit contracts and their write-safety policy. |
| New generic dashboard interaction | Change the shared capability under its own approved scope. |

Reuse follows the operation and output contract. Bind or fold the useful facts from a page-read
task instead of adding another scrape for one field. A thin workflow-owned system-task call in a step module uses `reuseTask(step, identity, bindInput)` from
`workflow-definition.ts`. It returns the typed `identity` and `bind` used by `author.task`. The
identity retains the exact driver contract, including its input/output schemas and provenance; the system store keeps the driver implementation, session policy, screenshots and provenance. Such calls are fingerprinted through the workflow source closure, not registered again as mini-store implementations. Pure calculation tasks use `defineTask` and the workflow mini-store.

## 3 · Files and registration

Keep definitions browser-safe: use shared models, rules and workflow-kit factories. Do not import
backend task implementations, browser drivers, Playwright or credential access into a definition.
`src/workflow-kit/validation/source-layout.ts` derives source paths from role.

For a new operator workflow:

1. Create `src/workflows/<id>/workflow.ts` with one `defineWorkflow` call, workflow-owned `tasks/`
   and `task-registry.ts`, and step definitions under `steps/<step>/step.ts`. Each step owns its group metadata,
   typed wiring functions, result contribution and proof recipe through one `defineStep` call.
   `workflow.ts` calls those functions and concatenates their returned tuples. Keep task, gate,
   transaction, delegation and omission wiring in the step module. A module may own related groups
   when their dependencies interleave, as Separations identity and Job Summary do.
2. Create `index.ts` in that folder. Import the real workflow, store and step definitions, then
   export `registration = deepFreeze({ ... } as const)` using `deepFreeze` from
   `src/rules/validation/immutability.ts`. Follow Person Lookup or Separations:

   ```ts
   export const registration = deepFreeze({
     definition: exampleWorkflow,
     store: exampleStore,
     proofs: [defineStepProof(exampleWorkflow, exampleReadDefinition)],
   } as const);
   ```

   Import the workflow from `./workflow.js`, the store from `./task-registry.js`, and each step
   definition from `./steps/<step>/step.js`. Import `defineStepProof` from workflow-kit. List every
   retained step definition exactly once.
   The step owns its proof `id`, `order` and `build` recipe. `defineStepProof` supplies the harness
   role and validates the built graph. Use `inheritStepProof(parent)` to share ingress and
   presentation; retain a specialized proof schema through `StepProofSpec<Input, Result>` when
   the proof takes different inputs. Reference typed build results directly, never search the
   parent graph by group key or entry id. Declare proof result dependencies in the step module.
3. Add one line to `src/workflows/registry.ts`: put the registration in `PUBLIC_WORKFLOWS` (in Run
   picker order) or, for a workflow admitted only through declared delegation edges, in
   `CHILD_ONLY_WORKFLOWS`. `src/backend/app/registries/workflow-registry.ts` composes each entry
   against the task-store inventory; a store or contract that does not bind fails at startup.
4. Add the workflow's failure codes to `src/models/failures/error-catalog.ts`.
5. Record copied source provenance, acceptance evidence and unfinished checks in the brief's
   evidence folder.

Harnesses derived from the step definitions in `index.ts` enter `STEP_PROOF_MODULES`.
They do not enter the operator tuple or picker.
A group without a harness needs no step folder.

List delegated-only workflows in `CHILD_ONLY_WORKFLOWS` in `src/workflows/registry.ts`, outside
`PUBLIC_WORKFLOWS`. Give them no start surface.
The registry resolves a child only for a parent that declares its delegation edge. A child may
remain registered without a parent; I-9 Lookup uses this shape.

Registration refuses missing or duplicate stores and a store that binds a different contract
object. Import the real contract value; an equivalent schema or copied declaration does not satisfy
`composeWorkflowModule`. `auditImplBindings` in the workflow registry checks
`src/backend/app/registries/pending-impl-bindings.json` against contracts used by registered
workflows. Remove a pending entry when its implementation exists. Pending records do not make tasks executable.

## 4 · Write `defineWorkflow`

### 4.1 Definition fields

Use the current `WorkflowDefinitionSpec` in `src/workflow-kit/workflow-definition.ts`. It combines
`WorkflowDescriptorSpec` presentation fields with `input`, `role`, optional `intake` and `steps`. Explorer is generated from the registered definition: give each
timeline group a `description` and `operatorFields` with fictional examples, and declare
`nodePurposes` only for nodes in groups without a description. Do not supply compiler-owned `flow`, `timeline` or
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

`steps` receives a `WorkflowAuthor` and composes step-module build results. Return `{ steps, result }`, where `steps` is an ordered array
of `[group, entries[]]`. Tuple order controls presentation. References control execution.

| Author method | Declaration |
| --- | --- |
| `task(identity, references, bind)` | Read contract, stable `id`, `replay`, optional label and `when`. |
| `gate(identity, references)` | Stable `id`, label, result schema, optional `statusKey` and `when`. |
| `transaction(identity, references, { prepareBind, commitBind })` | Prepare/commit contracts, dry-run and probe policy, positive integer probe-to-fence budget, optional retry policy. |
| `branch({ id, cases }, references, choose)` | Select one named case through the existing graph branch; each case lists nonempty downstream targets. Unselected targets are skipped, including transactions. Branch selections are control flow, not terminal evidence. |
| `parallel(identity, branches)` | Explicit branches with task or delegate leaves; see §8. |
| `delegate(identity, references, { bind, deriveChildItemId })` | Typed child-run target and policy; see §8. |
| `result(schema, references, derive)` | Terminal result schema, references and pure derivation. |
| `group(step, { omission, description, system, operatorFields, review })` | Whole-step omission declaration (see §7), plus the step's description, system, operator fields and Explorer review (see §4.4). |

Binds receive `input`, referenced `outputs`, optional `protectedInputBindings` and optional `dryRun`.
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

`compileWorkflow` requires a factory-produced definition and memoizes by definition object. Its
contract fingerprint covers the kit version, id, version, declared schemas, entry graph and task
contracts, never source bytes. A code-only change to a read task, including one whose freshness is
infinite, reuses older checkpoints until you bump the workflow `version` (or `WORKFLOW_KIT_VERSION`
for a kit semantics change); bump it whenever task semantics change without a schema change. Writes
always refuse across app builds. `composeWorkflowModule` refuses missing/duplicate stores and mismatched
contract objects. Fix the named owner rather than copying a declaration.

### 4.4 Explorer

`workflowExplorerDeclaration` projects the definition; the backend checks graph and timeline
coverage. Keep stable entry/leaf IDs and exact contracts. Branch choices are hypothetical.

Each owning group declares `review` through
[`WorkflowStepReview`](../../src/models/workflow/review-spec.ts): ordered pages, action/check/read
lines and fields. A field references a visible `operatorField` by label, or declares its own
`label` with `transactionFields` pointing to the owning transaction's prepare input or output
paths. Fixed workflow choices use `constant` with the owning transaction `nodeIds` and value.
Compilation checks each transaction path against its prepare contract; the backend derives its
finite options from that contract or the field's display mapping. These review declarations do
not add transaction sources to Logs operator fields. Use real page names and the modes
`Fill form` or `Read only`; local or gate-only steps can have no pages. Source drawer prose belongs
beside the field reference. A source `read` names an exact step key, page title and field label;
its ordered `chain` can refer to earlier reads in the same workflow. Every declared branch case
needs a label when the group supplies review metadata. Compilation rejects unknown, ambiguous or
out-of-step references.

Source paths may name structured values such as a Kuali field's present/absent object. Those
references remain intact; automatic dropdown options require a complete finite scalar vocabulary
for every source of the field.

The backend derives `reviewSpec` from these groups, existing run surfaces, omission forms, task
session declarations, graph policies and declared failure codes. Control kinds and options use only
the input alternatives admitted by each control's declared modes. Register each normalized failure
sentence in the error catalog. Session requirements describe preparation and use, never observed
sign-ins or acquired locks. Explorer serves child-only definitions for inspection without adding
them to the Run picker.

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
fixtures. OCR declares page delegates and Onboarding declares its I-9 delegate.

A parallel identity declares `join: "all"` and `failure: "fail-fast"`. It needs at least two
branches, each with a unique ID and nonempty task or delegate leaves. A leaf belongs only to its
parallel entry, not another branch or timeline tuple. Task leaves checkpoint independently. Readers
reference leaf values directly; the parallel output names the branch-to-leaf mapping. Parallel `"all-settled"` is
a named `capability-unavailable` refusal.

A delegate declares `target: { id, input, result }`, `edgeId`, `cardinality`, `await`, `join`,
`DelegationPolicy`, a child-input bind and `deriveChildItemId`. Admitted shapes are
`one/terminal/one`, `many/terminal/all`, `many/terminal/all-settled`, or either cardinality with
`none/none`. It returns `DelegationManifestRef` without a wait or typed child outcomes after terminal
waits. It uses child-run authority.

Set `capabilities.delegationDisplay` for the workflow's default visibility. Omit an edge's
`policy.visibility` to inherit it; an explicit edge choice wins. With neither setting, it is `inline`.

Put independent delegates in the same parallel step when every fan-out must be admitted together.
The runtime commits all of them before one claim release and waits for their awaited outcomes.
Give each delegate its own target schemas, edge, policy and cardinality. A form needing only one
lookup declares only that delegate. Keep a dependency on another leaf's result sequential; delegate
cohorts refuse sibling-result dependencies. External task, gate or child prerequisites execute
before the cohort. Replay, cancellation, retries and UNKNOWN-write fences remain per delegate.

Choose `resume-parent` when a completed child retry may join automatically. Choose
`manual-parent-resume` when the operator must release the parent with its existing Paused/Resume
control after the retry settles. That acknowledgement binds the exact child attempt and result;
another retry requires another Resume. `block-parent` holds the same parent row and propagates its
block through waiting ancestors. Approval gates remain visible only on their owning run.

For record-based reads, declare `sourceRecordIds(scope)` as nonempty unique record sets aligned
with the bound children. Rebuild pure review tasks with `replay: "always-rerun"` when child retries
can change their records. The runtime authenticates revised membership and checkpoint rebinding;
it reuses a read only when its input, record association, schemas, configuration and freshness match.
Approval snapshots remain immutable, and refresh never replays a successful transaction.

During a parent dry run, a delegated child with no transactions keeps the dry-run flag and returns
its normal typed read-only observations. Registered descendants that support preparation make a
parent eligible for preview even when the parent has no local transaction. Awaited child previews
aggregate as preview evidence; they cannot feed ordinary typed bindings or the authored terminal
derive. Dependent stages remain unavailable. Dispatch without waiting records partial coverage.
A child with an unsupported transaction refuses admission. Standalone read-only workflows still
have no transaction-preview option. Declare the real child and transaction graph; support is derived.

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
- `tests/workflows/registry.test.ts`: registration identity and ordering.
- `tests/architecture/workflow-kit/workflow-layout.test.ts`: paths.
- `tests/architecture/workflow-kit/no-workflow-id-branches.test.ts`: no workflow-id branches in generic code.
- `tests/architecture/workflow-kit/descriptor-coverage.test.ts`: descriptor and bundle-boundary coverage.
- `tests/architecture/workflow-kit/step-omission-invariants.test.ts`: omissions.

Check `auditImplBindings`
consumers when their inputs change.

Before proposing integration, run `npm run typecheck`, `npm run lint`, `npm run web:build`,
then `npm run test:coverage` alone. Coverage runs unit, integration and
architecture suites. Preserve assertions, membership, isolation, coverage floors and timeouts.
Follow the assigned brief's additional checks and resource limits.

Use the signed-in dashboard Run surface for workflow execution. Select Dry Run only where the
registered workflow graph supports local or delegated preparation; graphs containing only reads use their ordinary mode.
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
  `.agents/skills/hr-debug/references/debugging.md` and the repository's playwright-cli procedure
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
