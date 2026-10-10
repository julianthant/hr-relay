# Workflow authoring — the practical guide

> The practical path for adding or changing a workflow in this repository. The normative
> contract is `ref workflow-model` §1.6 (types, compiler products, invariants, refusals); current
> verification follows `ref guards-and-tests` and the owning phase; the concept boundaries and the change
> routing table are doc 03.2 `{#workflow-authoring-model}`. This guide restates none of them as a
> second opinion — it shows the real files, in the order you touch them, with every code excerpt
> copied from the tree at the commit named on it. Where this guide and the code disagree, the code
> wins and this guide is the bug.

Every fenced TypeScript block below that starts with `// from <path> @ <sha>` is a verbatim excerpt
of that file at that commit (leading indentation aside). Nothing in this guide is a sketch.

**Current paths and test policy — operator amendments 2026-10-01/02:** use the [codebase structure map](../reference/codebase-structure.md)
for the approved module homes and import direction. The main `workflow.ts` is the browser-safe
operator-definition entry. A chunk harness lives at `steps/<step>/step.ts`. Workflow-specific task
implementations and their `task-registry.ts` sit beside the definition but are loaded only by the
backend composition root. The operator retired `tests/scenario/` and `tests/parity/` on 2026-10-02;
declared scenario IDs remain contract data, while tests and manifests are not current proof. Missing
rehearsal manifests report unavailable before execution. Future scenario and visual-test design is
operator-led. Source excerpts pinned to earlier revisions retain their cited paths and do not
describe today's filesystem layout.

**Contents**

1. What you author, what is generated, what you never hand-maintain
2. Before you write code: find, reuse, or build
3. Current authored artifacts — and the registration edits
4. `defineWorkflow` — the API, entry by entry
5. The minimal example — Person Lookup (reuse-only)
6. The complete example — Separations (steps, a conditional gate, transactions, omissions, harnesses)
7. Omissions (D307/D313)
8. Parallel and delegate entries
9. The new-task example — a pure fold in a workflow mini-store
10. Verification: retained tests, rehearsal availability and the migration record
11. Debugging: what each refusal means and which gate goes red
12. "What file do I change?"

---

## 1 · What you author, what is generated, what you never hand-maintain

You write one main `workflow.ts` per operator workflow and, when it has retained chunk-harness
definitions, one `steps/<step>/step.ts` per harness. A reuse-only workflow has a dated migration
record and any genuinely new task it needs (§3). Scenario IDs in a definition remain contract
metadata; they are not evidence that tests ran. Everything else a workflow needs is derived:

| You author (the only inputs) | The compiler / runtime generates (never hand-maintain) |
|---|---|
| `src/workflows/<id>/workflow.ts`: one operator `defineWorkflow({...})` — identity, presentation, typed input/result, `role`, `scenarios`, ordered `[timeline group, entries[]]` tuples with typed binds, and (only when the workflow opts into D355 complete format) occurrence bindings/outcomes in `operationDisplay`; a chunk harness uses `src/workflows/<composition>/steps/<step>/step.ts` | the `WorkflowDescriptor` (`compileWorkflow(definition).descriptor`), its `flow`, `timeline`, node graph, `contractFingerprint` and D355 execution projection |
| `definition.scenarios` (declared scenario IDs) | contract validation; it does not imply a current test file, executed proof or available rehearsal manifest |
| the workflow's task evidence (the dated record) | `src/workflow-kit/validation/generated-build-manifest.ts` (`npm run build:manifest`) and the `ref stores` §2 task catalog (`npm run stores:catalog`) |
| a new reusable **task** (contract + implementation in the owning store) only when §2's table says BUILD | checkpoints, replay, retry, recovery (resume / restart), gate parking, the write sequencer's fences, receipts, semantic logs, screenshots, notifications, Archive — inherited by every compiled workflow with no per-workflow glue |

Normal compiled registration supplies `workflowExplorerDeclaration` and its closed
`definitionPreview` compiled/unavailable contract. Maintain ordered definitions and typed references,
plus optional `operationDisplay`; do not create an Explorer mapping. Keep descriptor identity and
full graph coverage intact. Systems derive in first-use order, and omitted `operationDisplay`
remains explicitly legacy/unavailable. Source jumps require one exact displayed producer. Branch
choices are hypothetical, and branchless definitions have no `Preview paths` control; neither
declares run progress.

**There is no other authoring path.** `src/workflow-kit/workflow-definition.ts` is the one seam. A
`descriptor.ts`, `module.ts`, `nodes.ts`, `node-ids.ts` or `omission.ts` beside a main `workflow.ts`,
or a `step.ts` outside a declared `steps/<step>/` folder, is refused by `workflow-layout`; a `defineWorkflowDescriptor(` / `flow(` /
`composeWorkflowModule(` call under `src/workflows/`, a second `defineWorkflow(` in one file, a
generic dashboard/server branch keyed by a workflow id, or a fifth authored artifact is refused by
`workflow-authoring-budget` (D312/D316/D317). The retired names (`WorkflowRecipe`,
`defineWorkflowRecipe`, `workflow-recipe`, `recipe.ts`, the flow node-fragment factory) are refused
anywhere in `src`/`tests`/`scripts`.

---

## 2 · Before you write code: find, reuse, or build

Open `docs/rebuild/reference/stores.md` §2 — the **generated task-store catalog** — and search it
by system, capability, effect (`read` / `prepare` / `commit`), inputs and outputs. It is regenerated
from `src/backend/app/registries/task-registry.ts` by `npm run stores:catalog`, and `npm run stores:catalog:check` fails on
stale bytes, so what it lists is what the registry binds today. Then classify each operation you
need with doc 03.2's current task ownership and `ref workflow-model` §1.6.1 (the table is copied here so the decision is made before any file opens):

| Need | Author action | Additional proof |
|---|---|---|
| Existing operation, same contract | import the exact task contract into `workflow.ts` | focused contract/definition checks under the owning phase; no current scenario tier |
| Existing operation with D355 display structure | reuse the task-owned operation; bind its occurrence values and composition-specific outcomes only | compiler fixture/refusal proof; do not copy action children or selectors into `workflow.ts` |
| Existing operation with an already-declared option | pass the typed option from the workflow definition | option behavior is already task-owned |
| Same browser operation, legitimate new variant, same output meaning | extend the shared task with a typed option; update that task's tests once | task contract/implementation proof plus affected workflow checks |
| Pure workflow-specific calculation | add or reuse a pure task in the workflow mini-store (§9) | pure task tests plus affected definition checks |
| New page operation or different output meaning | add one reusable task contract and driver operation to the owning task store | contract/driver tests and live selector verification |
| New external write | add an explicit `transaction(...)` backed by prepare/probe/commit/verify | full controlled-write evidence; dry run alone is insufficient |
| New dashboard interaction or wire arm | extend the generic capability once | focused proof defined by the owning phase; future scenario design requires the operator |

"Similar" is not permission to copy a task: the system interaction and the output contract decide
whether reuse is honest. A read task's identity is a **page visit** (D194): one task returns the
whole useful surface of one page, and a later workflow wanting one more field from that page writes
a `bind` or a pure fold, never a second scrape.

---

## 3 · Current authored artifacts — and the registration edits

A workflow that reuses existing tasks and generic surfaces currently authors:

| # | Path | What it is |
|---|---|---|
| 1 | `src/workflows/<id>/workflow.ts` — for a chunk harness, `src/workflows/<composition-id>/steps/<step-key>/step.ts` (`workflowSourcePath`) | one `defineWorkflow(...)` call (§4) |
| 2 | the workflow's task evidence | the dated migration record |

The workflow folder holds the browser-safe `workflow.ts`; it may also contain a workflow-owned
`task-registry.ts` and `tasks/`, which only the backend loads. A `steps/<step>/` sub-folder exists
when that declared step has a chunk harness, and holds its `step.ts`; a timeline step without a
harness has no such folder. `workflowSourceFolder` and `workflowSourcePath` derive source locations
from role. Scenario-path helpers describe possible role-derived locations only; the scenario suite
and files are retired pending future operator-led test design.

Only operator workflows enter the main `WORKFLOW_MODULES` tuple and descriptor registry. Harness
step modules are composed separately in `STEP_PROOF_MODULES` for historical proof reads and tests;
they do not add picker entries or operator startability. Their workflow ids remain unchanged.

**Registration is five one-line edits across two files, not authoring.** The composition root is
the ONE static module tuple, and its own header says so ("adding a workflow is one import plus one
tuple entry rather than ten synchronized lists"):

- `src/backend/app/registries/workflow-registry.ts` — an import of your main `workflow.ts`, an exported
  `<id>Module = composeWorkflowModule(compileWorkflow(<yourWorkflow>), taskStoreRegistry.stores)`
  const, and that const listed in `WORKFLOW_MODULES` (server side; resolves stores);
- `src/workflows/descriptor-registry.ts` — an import and `compileWorkflow(<yourWorkflow>).descriptor`
  in `WORKFLOW_DESCRIPTORS` (bundle-safe; the dashboard's view), in the SAME order —
  `tests/unit/workflows/descriptor-registry.test.ts` pins the two tuples equal.

Then run `npm run build:manifest`. `compileWorkflow` resolves the workflow's `contractFingerprint`
from the checked-in manifest and throws `workflow <id> has no build-manifest entry — regenerate
src/workflow-kit/validation/generated-build-manifest.ts before registering it` until you do; the
`descriptor-coverage` guard fails on a stale manifest afterwards.

**Historical T1b manifest registration (retired 2026-10-02).** D318's old loader, resolver and
subject-registry procedure is not an active authoring step. No rehearsal manifest is present in the
current tree; a missing manifest reports unavailable before execution. Do not restore this surface
until a separate operator-led scenario-design task defines its requirements.

**The two closed lists beside the budget.** A legitimately extra file — for example, a migration-doc
supplement (the workflow's task evidence) — is admitted only through a
cited `ARTIFACT_EXEMPTIONS` entry in the same guard. A generic
server/dashboard file that must branch on a workflow id under a ratified decision (today D288's
person-pseudonym fold and backfill, both `separations`) is admitted only
through a cited `GENERIC_WORKFLOW_ID_ALLOWLIST` entry. Both lists are closed: each entry names its
decision, and a stale or uncited entry is itself red. Neither is a way around §2's last row — a new
dashboard capability is still built generically once.

---

## 4 · `defineWorkflow` — the API, entry by entry

The seam is `src/workflow-kit/workflow-definition.ts`. Its header is the shortest correct description:

```ts
// from src/base/workflow-definition.ts @ 16e7e63b
 * A `WorkflowDefinition` is the reviewed source form of a workflow: identity
 * and presentation, typed input/result, and one ordered array of timeline
 * tuples `[group, entries[]]`. Tuple order is presentation order only; every
 * execution edge is derived from the typed references an entry declares. The
 * compiler is the only place those references become the runtime builder's
 * string node ids, so tuple order can never accidentally become execution
 * authority.
 *
 * The tuple's entries come from one CLOSED, EXPLICIT algebra (D315):
 * `task | parallel | delegate | gate | transaction`. The compiler may derive
 * edges from typed references, but it never infers whether an operation is
 * parallel, delegated, gated or transactional — each is an explicit entry
 * whose control policy the author writes down, and each entry and each
 * parallel leaf has a stable id.
```

### 4.1 The spec you pass

`defineWorkflow(spec)` takes every presentation field a descriptor carries (`id`, `version`, `code`,
`label`, `summary`, `icon`, `category`, `canonicalInput`, `inputSubject`, `surface`, `enqueue`,
`actions`, `capabilities`, `verdicts`, `surfaces`, `details`, `subjectProjection`, `identity`,
`presentation`, `nodePurposes`, `scenarios`, …) **minus** the three the compiler derives (`flow`,
`timeline`, `contractFingerprint`), plus:

```ts
// from src/base/workflow-definition.ts @ 16e7e63b
export interface WorkflowDefinitionSpec<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined = undefined,
> extends WorkflowDefinitionPresentation<InputSchema, ResultSchema, Completion> {
  readonly input: InputSchema;
  /** D219 — what this workflow IS to the composition root. */
  readonly role: WorkflowModuleRole;
  /** Ref data-intake-and-edit-data §1 — the spreadsheet-capable declaration, when one exists. */
  readonly intake?: IntakeProjection;
  /**
   * The graph, authored through the typed author so every entry's input and
   * output binds to THIS input schema. Returns the ordered timeline tuples and
   * the terminal result declaration.
   */
  readonly steps: (author: WorkflowAuthor<InputSchema>) => Readonly<{
    steps: readonly WorkflowTimelineTuple[];
    result: WorkflowResultDeclaration<InputSchema, ResultSchema>;
  }>;
}
```

- `input` is the ingress schema (defaults applied here, and only here); `canonicalInput` is
  `defineCanonicalInput(input, <same shape without defaults>, [examples])` — the stored, no-default
  view a run replays against. There is deliberately no `dryRun` field: that is envelope state (D6).
- `role` is `defineWorkflowRole({ kind: "standalone" })`, `{ kind: "composition" }`, or
  `{ kind: "chunk-harness", of: "<composition-id>", step: "<step-key>" }` (§6.4).
- `scenarios` is the declared list of scenario ids retained for contract validation. It is not an
  executable-test manifest or evidence that a scenario ran; future proof design is operator-led.
- `intake` (optional) is `defineIntakeProjection(input, { <field>: CANONICAL_FIELDS.<x> })` for a
  spreadsheet-startable workflow.

### 4.2 The author: what `steps` receives

```ts
// from src/base/workflow-definition.ts @ 16e7e63b
export interface WorkflowAuthor<InputSchema extends z.ZodType> {
  /** D307/D313 — declare a group omittable, beside its own entries. */
  group(
    this: void,
    step: WorkflowTimelineGroup,
    options: Readonly<{ omission: StepOmissionDeclaration }>,
  ): WorkflowTimelineGroup;

  task<
    const Identity extends TaskEntryIdentity,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Identity,
    references: References,
    bind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Identity["contract"]["input"]>,
  ): WorkflowEntry<Identity["id"], z.output<Identity["contract"]["output"]>, HasWhen<Identity>>;

  gate<
    const Identity extends GateEntryIdentity,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Identity,
    references: References,
  ): WorkflowEntry<Identity["id"], z.output<Identity["result"]>, GateConditional<Identity>>;

  transaction<
    const Identity extends TransactionEntryIdentity,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Identity,
    references: References,
    binds: Readonly<{
      prepareBind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Identity["prepare"]["input"]>;
      commitBind: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<Identity["commit"]["input"]>;
    }>,
  ): WorkflowEntry<Identity["id"], TypedTransactionOutcome<Identity["commit"]>, false>;

  parallel<
    const Identity extends ParallelEntryIdentity,
    const Branches extends readonly ParallelBranchDeclaration[],
  >(
    this: void,
    identity: Identity,
    branches: Branches,
  ): WorkflowEntry<Identity["id"], ParallelEntryOutput<Branches>, false>;
```

```ts
// from src/base/workflow-definition.ts @ 16e7e63b
  delegate<
    const Identity extends DelegateEntryIdentity,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    identity: Identity,
    references: References,
    binds: Readonly<{
      bind: (scope: WorkflowEntryScope<InputSchema, References>) =>
        Identity["cardinality"] extends "one"
          ? z.input<Identity["target"]["input"]>
          : readonly z.input<Identity["target"]["input"]>[];
      deriveChildItemId: (input: z.output<Identity["target"]["input"]>) => ItemId;
    }>,
  ): WorkflowEntry<Identity["id"], DelegateEntryOutput<Identity["target"], Identity>, false>;

  result<
    ResultSchema extends z.ZodType,
    const References extends readonly AnyWorkflowEntry[],
  >(
    this: void,
    schema: ResultSchema,
    references: References,
    derive: (scope: WorkflowEntryScope<InputSchema, References>) => z.input<ResultSchema>,
  ): WorkflowResultDeclaration<InputSchema, ResultSchema>;
}
```

The pattern for every entry is the same: **identity, references, bind.**

- **identity** — the entry's stable `id` plus its policy (a task's `contract`, `label`, `replay`,
  optional `when`; a gate's `label`, `statusKey`, `result` schema, optional `when`; a transaction's
  `prepare`/`commit` contracts, `dryRun`, `probePolicy`, `probeToFenceMaxMs`, optional
  `retryBeforeFence`; a parallel's `join`/`failure`; a delegate's `target`, `edgeId`,
  `cardinality`, `await`, `join`, `policy`).
- **references** — the array of entry VALUES this entry reads. These, not tuple order, are the
  execution edges. The scope a bind receives is typed from them: `scope.outputs["<id>"]` exists only
  for a referenced entry, and a conditional reference is `T | undefined`.
- **bind** — a pure function from `{ input, outputs }` to the contract's input. Use
  `requireFact(value, nodeId, path)` (`src/workflow-kit/workflow.ts`) for a fact that must be present: it
  throws naming the node and path instead of substituting a default (the charter's single most
  dangerous pattern is a plausible fallback).

Identity shapes (`src/workflow-kit/workflow-definition.ts`, §"entry identities\`):

```ts
// from src/base/workflow-definition.ts @ 16e7e63b
export interface TaskEntryIdentity<
  Id extends string = string,
  Contract extends AnyReadTaskContract = AnyReadTaskContract,
> extends StepOwned {
  readonly id: Id;
  readonly contract: Contract;
  readonly label?: string;
  readonly replay: "checkpoint" | "always-rerun";
  readonly when?: NodeConditionSpec;
}

export interface GateEntryIdentity<
  Id extends string = string,
  Result extends z.ZodType = z.ZodType,
> extends StepOwned {
  readonly id: Id;
  readonly label: string;
  readonly statusKey?: string;
  readonly result: Result;
  readonly when?: NodeConditionSpec;
}

export interface TransactionEntryIdentity<
  Id extends string = string,
  Prepare extends AnyPrepareTaskContract = AnyPrepareTaskContract,
  Commit extends AnyCommitTaskContract = AnyCommitTaskContract,
> extends StepOwned {
  readonly id: Id;
  readonly label?: string;
  readonly prepare: Prepare;
  readonly commit: Commit;
  readonly dryRun: "stop-after-prepare" | "unsupported";
  readonly probePolicy: "always" | "retries-and-recovery-only";
  readonly probeToFenceMaxMs: number;
  readonly retryBeforeFence?: RetryPolicy;
}
```

**`replay`** — `"checkpoint"` when the node's product is a VALUE that survives a fresh browser;
`"always-rerun"` when its product is browser STATE (a selection a later click depends on) or when
the node's whole job is to CHECK something (a replayed checkpoint would be the previous answer
standing in for the check). Separations' comments in §6 argue each choice.

**`when`** — a declared condition, never a closure (D228): `{ kind: "is-true" | "is-false" |
"is-present" | "is-absent", of }` or `{ kind: "equals" | "not-equals", of, value }`, where `of` is
`{ from: "input", path }` or `{ from: "node", nodeId, path }` — and a `node` operand must be one of
the entry's own references. A conditional entry's output is `undefined` on the skipped path, and
the type system makes every reader say so.

**Timeline tuples** — the return value's `steps` is `[group, [entries...]]` pairs in presentation
order. A group is `{ key, label }` (or a `defineWorkflowStep` value, §6.1), optionally wrapped by
`group(step, { omission })` (§7). Each entry appears in exactly one tuple; a parallel's leaves are
owned by the parallel and never listed separately.

### 4.3 What `defineWorkflow` refuses, by message

`validateSteps` runs at definition time (module load), so a bad definition fails `tsc`-adjacent —
the first import — not the first run. Each message names the workflow and the offender:

| Refusal (`src/workflow-kit/workflow-definition.ts`) | Cause |
|---|---|
| `workflow <id> requires at least one timeline group` / `requires at least one entry` | empty `steps` or a group with no entries (`timeline group "<key>" has no entries`) |
| `workflow <id> repeats timeline group key "<key>"` / `repeats timeline group label "<label>"` | two tuples with the same key or label |
| `timeline group "<key>" claims workflow entry "<id>", which belongs to step "<other>"` (`; same key but distinct step objects: …`) | a step-owned identity (§6.1) placed under a different step, or under a structurally equal but distinct step object |
| `workflow entry "<id>" appears in more than one timeline tuple` / `… is a leaf of parallel entry "<p>" and may not also appear in a timeline tuple` | the same entry value listed twice |
| `workflow <id> declares entry id "<id>" more than once` | two entries with one id |
| `workflow entry "<id>" repeats reference "<r>"` / `… references unresolved entry "<r>"`; `workflow <id> result …` likewise | a reference listed twice, or a reference to an entry not in any tuple |
| `workflow <id> dependency cycle: a -> b -> a` | references form a cycle |
| `workflow <id> step "<key>" omission produces "<n>", which is not an entry of that step` / `… which is a <kind> entry; only task entries are ever rebuilt from operator facts (D313)` | an omission's `produces` names a foreign node or a non-task |
| `workflow <id> step "<key>" is omittable, but workflow entry "<r>" in step "<other>" reads its <kind> entry "<m>", which omitting the step leaves unread; rebuild "<m>" from the step's omission form, move the reader into the step, or declare the check as its own entry outside the omitted step (D313)` | an entry outside an omittable step reads a member that omission does not rebuild |

`compileWorkflow` adds: `compileWorkflow requires a value produced by defineWorkflow`; `workflow <id>
was already compiled under a different build manifest; one definition compiles under exactly one
manifest`; and the `has no build-manifest entry` refusal (§3). `composeWorkflowModule` adds:
`workflow <id> module does not use the compiled workflow of its own definition`, `requires missing
store <ns>`, `found duplicate stores for <ns>`, `cannot resolve exact contract <contract-id>` (the
store must bind the SAME contract object the entry imported — never a copy).

### 4.4 Compiler products

```ts
// from src/base/workflow-definition.ts @ 16e7e63b
export interface CompiledWorkflow<
  InputSchema extends z.ZodType = z.ZodType,
  ResultSchema extends z.ZodType = z.ZodType,
  Completion extends CompletionProgram | undefined = CompletionProgram | undefined,
> {
  readonly kind: "compiled-workflow";
  readonly definition: WorkflowDefinition<InputSchema, ResultSchema, Completion>;
  readonly descriptor: CompiledWorkflowDescriptor<InputSchema, ResultSchema, Completion>;
  readonly contracts: readonly (AnyReadTaskContract | AnyPrepareTaskContract | AnyCommitTaskContract)[];
  /** Task-store namespaces the definition's contracts belong to, first-use order. */
  readonly storeNamespaces: readonly string[];
}
```

Compilation is memoized per definition object, so every consumer (registry, dashboard tuple, tests)
sees one descriptor identity. The timeline the compiler emits is your tuples (`key`, `label`,
`nodes`, `omission`); when every group holds exactly its one same-named entry and no omission, the
descriptor carries no explicit `timeline` (D225's honest default). `workflowDefinitionOf(descriptor)`
recovers the definition; `workflowEntryKinds(definition)` lists the entry kinds it uses.

---

## 5 · The minimal example — Person Lookup (reuse-only)

`person-lookup` is the smallest real workflow: four `task` entries over three stores, one
conditional node, no gate, no transaction. Its definition and migration record are the current
authoring artifacts in §3. The former T1 scenario and rehearsal manifests are retired; the historical
paths and excerpts below are retained only to explain the model. Its head shows the imports a bundle-safe
`workflow.ts` is allowed (zod, `src/models/**`, `src/rules/**`, and audited `src/workflow-kit/**`
builders — never a backend implementation or Playwright). The import list below is a commit-pinned
historical excerpt:

```ts
// from src/workflows/person-lookup/workflow.ts @ 16e7e63b
import { z } from "zod";
import { defineWorkflow } from "../../base/workflow-definition.js";
import { requireFact } from "../../base/workflow.js";
import {
  CrmReadOnboardingDates,
  ReadOnboardingDatesOutputSchema,
} from "../../domain/contracts/crm/read-onboarding-dates.js";
import { CrmReadOnboardingRecord } from "../../domain/contracts/crm/read-onboarding-record.js";
import { CANONICAL_FIELDS } from "../../domain/fields/registry.js";
import {
  ActiveStatusOutcomeSchema,
  ReadActiveStatus,
} from "../../domain/contracts/person-lookup/read-active-status.js";
import { SearchPersonOrg } from "../../domain/contracts/ucpath/search-person-org.js";
import { EidSchema } from "../../domain/ids.js";
import { defineCanonicalInput } from "../../domain/workflow/canonical-input.js";
import { defineIntakeProjection } from "../../domain/intake/projection.js";
import { defineWorkflowRole } from "../../domain/workflow/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../domain/workflow/presentation.js";
```

The whole graph, result included — note that references (`[searching]`, `[searching, crossVerify]`)
are the edges, the `when` is declared data, `requireFact` refuses a missing selection, and the
`always-rerun` fold is re-executed on every resume:

```ts
// from src/workflows/person-lookup/workflow.ts @ 16e7e63b
  steps: ({ task, result }) => {
    const searching = task({
      id: "searching",
      contract: SearchPersonOrg,
      label: "Searching",
      replay: "checkpoint",
    }, [], ({ input }) => ("emplId" in input
        ? { kind: "by-eid" as const, emplId: input.emplId }
        : { kind: "by-name" as const, name: input.name, keepNonHdh: input.keepNonHdh }),
    );
    const crossVerify = task({
      id: "cross-verify",
      contract: CrmReadOnboardingRecord,
      label: "Cross Verification",
      replay: "checkpoint",
    }, [searching], ({ input, outputs }) => {
      const selected = requireFact(outputs.searching.selection.selected, "searching", "selection.selected");
      return {
        eid: selected.emplId,
        name: "emplId" in input ? input.name ?? selected.name : input.name,
      };
    });
    const activeStatus = task({
      id: "active-status",
      contract: ReadActiveStatus,
      label: "Active Status",
      // Pure, and cheap: re-running it on resume is strictly safer than replaying
      // a fold whose meaning may have changed with the code that computes it.
      replay: "always-rerun",
    }, [searching, crossVerify], ({ input, outputs }) => ({
      person: outputs.searching,
      crm: outputs["cross-verify"],
      keepNonHdh: input.keepNonHdh,
    }));
    const crmDates = task({
      id: "crm-dates",
      contract: CrmReadOnboardingDates,
      label: "CRM Dates",
      when: { kind: "is-true", of: { from: "input", path: "includeCrmDates" } },
      replay: "checkpoint",
    }, [searching], ({ outputs }) => ({
      eid: requireFact(outputs.searching.selection.selected, "searching", "selection.selected").emplId,
    }));
    return {
      steps: [
        [{ key: "searching", label: "Searching" }, [searching]],
        [{ key: "cross-verify", label: "Cross Verification" }, [crossVerify]],
        [{ key: "active-status", label: "Active Status" }, [activeStatus]],
        [{ key: "crm-dates", label: "CRM Dates" }, [crmDates]],
      ],
      result: result(PersonLookupResultSchema, [activeStatus, crmDates], ({ input, outputs }) => ({
        activeStatus: outputs["active-status"],
        crmDates: input.includeCrmDates
          ? {
            state: "included" as const,
            dates: requireFact(outputs["crm-dates"], "crm-dates", "conditional output"),
          }
          : { state: "not-requested" as const },
      })),
    };
  },
});
```

Above `steps`, the same file declares `PersonLookupInput` (a `z.union` of the name arm and the EID
arm, defaults applied), `PersonLookupCanonicalInput` (`defineCanonicalInput(PersonLookupInput,
<no-default twin>, [three examples])`), `PersonLookupResultSchema`, `personLookupIntake`
(`defineIntakeProjection(PersonLookupInput, { emplId: CANONICAL_FIELDS.eid, name:
CANONICAL_FIELDS.fullName })`) and the presentation fields (`surfaces.inputRun` with its parser
rules and two D250 examples, `details`, `subjectProjection`, `identity.matchKey`, `presentation`,
`nodePurposes`, nine `scenarios`, `role: defineWorkflowRole({ kind: "standalone" })`). Read the file
once end to end; every comment in it explains a choice you will face again.

**Reuse-only, step by step.** To add a workflow like this one:

1. Find every operation in the catalog (§2). If all are REUSE, use the reuse-only path in §3.
2. Write `src/workflows/<id>/workflow.ts`: schemas, presentation, `role`, `scenarios`, `steps`.
3. Make the registration edits (five lines across the two registry files) and run `npm run build:manifest` (§3).
4. Record the migration and its verified evidence. Scenario proofs and rehearsal manifests are
   unavailable until future operator-led test design.
5. Gate: `npm run typecheck && npm run lint && npm run test:coverage`, then
   `npm run build:manifest:check`, `npm run stores:catalog:check` (unchanged — proves you added no
   task).

---

## 6 · The complete example — Separations

`separations` is the completeness proof: six timeline groups, nineteen nodes, one conditional
operator gate, three transactions, three omittable steps, five chunk harnesses. Its main
`workflow.ts` (1,509 lines at `16e7e63b`) has three regions: **step identities** (one section per
group), the **input/result schemas and presentation**, and the **`defineWorkflow` call** whose
`steps` wires those identities.

### 6.1 Step identities — `defineWorkflowStep` + `defineStepEntries`

A composition whose steps are also proved by harnesses declares each step's identities ONCE, so the
composition and the harness apply the same values and the compiler refuses a tuple that claims
another step's identity:

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
/* ── step `kuali-extraction` — group, node ids, entry identities ── */

export const KUALI_EXTRACTION_STEP = defineWorkflowStep({
  key: "kuali-extraction",
  label: "Kuali extraction",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them (D307). */
export const ACTION_NODE = "resolve-action";
export const DOCUMENT_NODE = "document";
export const PLAN_NODE = "plan";
export const TERMINATION_TYPE_NODE = "termination-type";
```

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
const kualiExtractionEntries = defineStepEntries(KUALI_EXTRACTION_STEP);
```

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
export const actionNode = kualiExtractionEntries.task(ACTION_NODE, KualiSearchSeparationAction, {
  label: "Kuali Action",
  replay: "checkpoint",
});
```

`defineStepEntries(step)` returns `task(id, contract, { label, replay, when? })`,
`transaction(id, { label, prepare, commit, dryRun, probePolicy, probeToFenceMaxMs, retryBeforeFence? })`
and `operatorGate(id, { label, statusKey?, result, when? })` — each a plain identity VALUE bound to
the exact frozen step object. They carry no wiring; the only way to execute one is to pass it to the
author's `task` / `gate` / `transaction` with references and a bind. A workflow without harnesses
(Person Lookup) writes its identities inline and needs neither helper.

### 6.2 A conditional operator gate

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
export const identityApprovalGate = identityCheckEntries.operatorGate(GATE_NODE, {
  label: "Identity Approval",
  statusKey: "awaitingIdentityApproval",
  result: IdentityApprovalResultSchema,
  when: { kind: "equals", of: { from: "node", nodeId: COMPARISON_NODE, path: "packet.emplIdSource" }, value: "name-resolved" },
});
```

Wired in `steps`, the gate references the node its condition reads, and the check that consumes the
approval references BOTH the packet and the gate:

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
    const identityGate = gate(identityApprovalGate, [comparison]);
    const approval = task(approvalNode, [comparison, identityGate], ({ outputs }) => ({
      packet: outputs[COMPARISON_NODE].packet,
      evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
      approval: outputs[GATE_NODE],
    }));
```

A false condition opens no gate and writes no `gate_results` row (D309); the `approval` fold then
receives `undefined` for the gate and proves machine verification instead. A gate's only path into
authority is the typed `resolve-gate` command; nothing in a workflow can auto-resolve one.

### 6.3 Transactions — identity, then two binds

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
export const clearPendingNode = ucpathTransactionEntries.transaction(SWEEP_NODE, {
  label: "Clear Pending Terminations",
  prepare: UcpathStagePendingTerminationSweep,
  commit: UcpathDeletePendingTerminations,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 90_000,
});
```

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
    const clearPending = transaction(clearPendingNode, [approval, pendingSet], {
    prepareBind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      observedSet: outputs[PENDING_SET_NODE],
    }),
    commitBind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      observedSet: outputs[PENDING_SET_NODE],
    }),
    });
```

`commitBind` binds the SAME target from workflow input, the gate-approved identity and the folds —
never from the prepare's own output — so the permanent idempotency key is stable before any page
mutation (`ref workflow-model` §3.1). A transaction entry's scope value downstream is the typed
outcome envelope (D144): `outputs[TERMINATION_NODE].output.receipt` is the commit contract's bare
output, `outputs[TERMINATION_NODE].disposition` says how the write settled. The write sequencer,
probes, fences, parks and dry-run preview are inherited; the workflow declares only the policy above.

### 6.4 The tuples and the result

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
    return {
      steps: [
        [KUALI_EXTRACTION_STEP, [action, document, plan, terminationType]],
        [IDENTITY_CHECK_STEP, [nameSearch, subject, comparison, identityGate, approval]],
        [JOB_SUMMARY_STEP, [jobSummary, employment, departmentOption]],
        [group(KRONOS_TIMECARD_STEP, { omission: KRONOS_TIMECARD_OMISSION }), [timecardSearch, timecard, dates]],
        [group(UCPATH_TRANSACTION_STEP, { omission: UCPATH_TRANSACTION_OMISSION }), [pendingSet, clearPending, fileTermination, receipt]],
        [group(KUALI_FINALIZATION_STEP, { omission: KUALI_FINALIZATION_OMISSION }), [filingPresence, finalizeKuali]],
      ],
      result: result(
        SeparationsResultSchema,
        [approval, employment, departmentOption, dates, receipt, clearPending, fileTermination, finalizeKuali],
        ({ outputs }) => ({
```

The three omittable groups are wrapped by `group(step, { omission })`; the other three are the bare
step values. The result's `references` list every entry the derive reads, and an omitted write step's
node is read through a declared `omitted` arm (§7.3).

**Chunk harnesses — current layout, 2026-10-01.** Each of the five step folders (`identity-check`,
`kronos-timecard`, `kuali-extraction`, `kuali-finalization`, `ucpath-transaction`) holds
`steps/<step>/step.ts` with one `defineWorkflow(...)` chunk-harness definition. The main
`separations/workflow.ts` declares each group and its step/node identities; each harness imports its
identities from the composition and wires them from its own ingress. The former matching structural
scenario files were retired with the scenario suite; no current test path is implied.
The harness id remains its run identity and the filesystem move does not change it. Harnesses do not
appear in the operator picker, Explorer, worker controls or rail; the composition owns the visible
timeline step. `job-summary` has no harness and no `steps/job-summary/` folder. The examples above
are source-pinned to `16e7e63b`; use the current source map and these current paths when navigating.

**A harness's artifact budget** is smaller than a rail workflow's: its `steps/<step>/step.ts`
definition; it shares its composition's migration record. The `source-layout.ts` scenario helpers
retain role-derived path functions, but scenario files and suites are absent. Future harness-test
design is operator-led. Source-pinned examples and historical pre-canonical lists keep their cited
paths; they are not current requirements.

---

## 7 · Omissions (D307/D313)

### 7.1 Declaring one

An omission is declared BESIDE the step's identities as a `StepOmissionDeclaration`
(`src/models/workflow/step-omission.ts`): a closed **form** the run modal's Steps screen draws
(field kinds `text`, `us-date`, `eid`, `integer`, `boolean`, `enum`, `text-list`; every field
required) and a **`produces`** map keyed by the step's TASK node ids, each a pure function from
`{ facts, scope, assertedAt }` to that node's COMPLETE, schema-valid output:

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
export const KRONOS_TIMECARD_OMISSION: StepOmissionDeclaration = {
  form: {
    fields: [
      {
        key: "lastDayWorked", label: "Last day worked", kind: "us-date",
        help: "The employee's last physical day of work, MM/DD/YYYY. Kronos is not read; this stands in for the card's last punch.",
      },
      {
        key: "separationDate", label: "Separation date", kind: "us-date",
        help: "The last day on pay status, MM/DD/YYYY — the same day as the last day worked unless paid leave follows it. The termination is effective the next day.",
      },
    ],
  },
  produces: {
    [DATES_NODE]: ({ facts, scope }) => {
      const typed = KronosTimecardFactsSchema.parse(facts);
      const plan = ReadSeparationPlanOutputSchema.parse(scope.outputs[PLAN_NODE]);
      if (!isJsonObject(scope.input)) {
        throw new Error("kronos-timecard omission requires the run's canonical input object to read the timekeeper name");
      }
      const timekeeperName = scope.input.timekeeperName;
      if (typeof timekeeperName !== "string" || timekeeperName.length === 0) {
        throw new Error("kronos-timecard omission requires input.timekeeperName to be a non-empty string");
      }
      return assertSeparationDates({
        plan,
        timekeeperName,
        lastDayWorked: typed.lastDayWorked,
        separationDate: typed.separationDate,
      });
    },
  },
};
```

A step nothing downstream reads (only the terminal result sees it) declares an empty form and
produces nothing — the transaction simply does not run:

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
export const KUALI_FINALIZATION_OMISSION: StepOmissionDeclaration = {
  form: { fields: [] },
  produces: {},
};
```

### 7.2 The rules the compiler enforces

- Whole-step omission executes **no entry** of the group — tasks, the gate inside it, its
  transactions. A transaction in an omitted step mints no outcome (D144).
- Only TASK entries are ever rebuilt; `produces` naming a gate/transaction/parallel/delegate, or a
  node outside the step, is refused at definition time (§4.3).
- An entry OUTSIDE the omittable step may read a member only if `produces` rebuilds it. Otherwise
  `defineWorkflow` refuses and tells you the three fixes: rebuild it from the form, move the reader
  into the step, or declare the check as its own entry outside the omitted step. That last one is
  how a **mandatory verifier** is authored: as its own selected entry, never inside the step it
  verifies.
- The terminal `result` is the one reader allowed to see an omitted member — because it declares
  the omitted arm itself (§7.3).
- Every replacement value is settled in the run modal before start (D313). Missing or invalid
  values refuse the start plan; no worker asks mid-run. Rebuilt outputs persist as operator
  ASSERTIONS with D307 provenance, never observations; retry/relaunch/fan-out copy the admitted
  omission bundle unchanged.

### 7.3 Reading an omitted node in the result

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
function omittedOr<T, R>(
  value: T,
  step: string,
  present: (value: T) => R,
): R | Readonly<{ state: "omitted"; step: string }> {
  const widened: T | undefined = value;
  return widened === undefined ? Object.freeze({ state: "omitted" as const, step }) : present(widened);
}
```

```ts
// from src/workflows/separations/workflow.ts @ 16e7e63b
      pendingSweep: omittedOr(outputs[SWEEP_NODE], UCPATH_TRANSACTION_STEP.key, (sweep) => ({
        disposition: sweep.disposition,
        proof: sweep.output.cleared,
      })),
```

The result schema carries the matching `{ state: "omitted", step }` arm; the receipt and the
result NAME the assertion (`disposition: "operator-asserted"`) instead of replaying the value.

---

## 8 · Parallel and delegate entries

Neither acceptance workflow uses these two kinds; the registry-wide conformance suite proves them
on a fixture that is compiled by the real compiler and walked by the real executor
(`tests/unit/fixtures/workflow-definition-fixtures.ts`, exercised by
`tests/unit/workflow-definition-conformance.test.ts`). The shapes are the real ones:

```ts
// from tests/unit/fixtures/workflow-definition-fixtures.ts @ 16e7e63b
    const fan = parallel({ id: "fan", label: "CRM reads", join: "all", failure: "fail-fast" }, [
      { id: "record", leaves: [crmRecord] },
      { id: "dates", leaves: [crmDates] },
    ]);
```

- **parallel** — `join: "all"` with `failure: "fail-fast"` is what the runtime interprets: every
  leaf checkpoints independently, so a failed leaf retries on the next attempt while its successful
  siblings replay. `join: "all-settled"` is refused by name before a run exists. A leaf is an
  ordinary `task` entry that lives ONLY inside the parallel (listing it in a tuple too is refused);
  its output is read as `outputs["<leaf-id>"]` by an entry that references the leaf, and the
  parallel's own output is `{ join: "all", branches: { <branch-id>: [leaf ids] } }`.

```ts
// from tests/unit/fixtures/workflow-definition-fixtures.ts @ 16e7e63b
    const child = delegate({
      id: "child",
      label: "Child lookup",
      target: { id: WorkflowIdSchema.parse("person-lookup"), input: PersonLookupInput, result: PersonLookupResultSchema },
      edgeId: "fixture-child-lookup",
      cardinality: "one",
      await: "terminal",
      join: "one",
      policy: {
        onChildFailed: "fail-parent",
        cascadeCancel: "cascade",
        afterChildRetry: "resume-parent",
        visibility: "inline",
      },
    }, [review], {
      bind: ({ input }) => ({ emplId: input.emplId }),
      deriveChildItemId: () => ItemIdSchema.parse("00000000-0000-4000-8000-000000000fe1"),
    });
```

- **delegate** — compiles to the existing typed child-run edge (`ref workflow-model` §3.2): the
  `target` is `{ id, input, result }` of a registered workflow, `cardinality` `"one"` (bind returns
  one child input) or `"many"` (an array), `await` `"none"` (the output is the delegation manifest
  ref) or `"terminal"` (the child outcome, or an array of them), plus the closed `policy`. It is
  never an in-process call.

The fixture's tuples show every kind in one timeline:

```ts
// from tests/unit/fixtures/workflow-definition-fixtures.ts @ 16e7e63b
      steps: [
        [{ key: "reads", label: "Reads" }, [search, fan]],
        [{ key: "review", label: "Review" }, [review, child]],
        [{ key: "sweep", label: "Sweep" }, [pendingSet, sweep]],
      ],
```

---

## 9 · The new-task example — a pure fold in a workflow mini-store

When §2's table says "pure workflow-specific calculation", the task lives in the workflow's
mini-store `workflow:<id>` — sessionless, `effect: "read"`, no browser. Person Lookup's
`active-status` fold is the whole pattern. Four files, each in its owning place:

**1. The contract** — current path `src/models/workflows/person-lookup/read-active-status.ts`.
The excerpt is pinned to its cited revision; it shows a bundle-safe strict input over upstream
output schemas and a closed output union with a reason on every arm:

```ts
// from src/domain/contracts/person-lookup/read-active-status.ts @ 16e7e63b
export const ReadActiveStatus = defineTaskContract({
  id: taskId("workflow:person-lookup/read-active-status"),
  title: "Active Status",
  effect: "read",
  input: z.strictObject({
    person: SearchPersonOrgOutputSchema,
    crm: ReadOnboardingRecordOutputSchema,
    keepNonHdh: z.boolean(),
  }),
  output: ActiveStatusOutcomeSchema,
  errorCodes: ["inconsistent-inputs"],
  subject: { kind: "none", reason: "a pure fold over facts this run already read" },
  // A pure transform can never be fresher than its inputs, so it carries no
  // freshness budget of its own: the walk in ref workflow-model §5.5 ages the UCPath and CRM
  // checkpoints that feed it. `Infinity` is written explicitly for that reason.
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: [],
  example: {
    state: "active",
    reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
    hdh: true,
  },
});
```

**2. The implementation** — current path `src/workflows/person-lookup/tasks/read-active-status.ts`.
The following excerpt is pinned to the cited revision. It uses `defineTask(contract, impl)` with
`sessions: []`, records every output leaf through `ctx.recordData` (an unrecorded schema leaf makes
the executor refuse before checkpointing), and refuses through `ctx.fail` rather than guessing:

```ts
// from src/backend/workflow-tasks/person-lookup/tasks/read-active-status.ts @ 16e7e63b
export const readActiveStatusTask = defineTask(ReadActiveStatus, {
  sessions: [],
  async run({ input, ctx }) {
    const finish = (candidate: unknown) => {
      const output = ActiveStatusOutcomeSchema.parse(candidate);
      ctx.recordData([
        { direction: "read", field: "state", value: output.state },
        { direction: "read", field: "reason", value: output.reason },
        ...("hdh" in output
          ? [{ direction: "read" as const, field: "hdh" as const, value: output.hdh }]
          : []),
      ]);
      return output;
    };
```

**3. The task registration** — `src/workflows/person-lookup/task-registry.ts`, composed through
`src/backend/app/registries/task-registry.ts` (the following source excerpt shows the earlier path):

```ts
// from src/backend/workflow-tasks/person-lookup/store.ts @ 16e7e63b
export const personLookupStore = defineWorkflowStore("person-lookup", {
  readActiveStatus: readActiveStatusTask,
});
```

**4. The workflow entry** — the `activeStatus` task in §5, importing `ReadActiveStatus` by VALUE so
a renamed field fails `tsc` here rather than at the first run.

Then run `npm run stores:catalog` (the task-store catalog gains the row;
`npm run stores:catalog:check` detects stale bytes) and `npm run build:manifest` (task implementation
fingerprints move). A contract a workflow uses that NO store implements yet must be listed in
`src/backend/app/registries/pending-impl-bindings.json` (D107) — the guard fails in both directions. A browser task is the same pattern with
`defineTask(driver, contract, impl)` bound to the store's exact `DriverDeclaration`, plus the driver
operation and its live selector verification (`ref stores` §1, §2b).

---

## 10 · Current verification and unavailable rehearsal manifests

The operator retired `tests/scenario/` and `tests/parity/` on 2026-10-02. Their former T1/T2/T3
procedures are historical and are not current test or acceptance requirements. Future scenario and
visual-test design is a separate operator-led task; do not recreate those paths or claim their old
results as current evidence.

Workflow definitions retain declared `scenarios` identifiers for contract validation. Those IDs do
not imply a current proof file or executed coverage. A missing dry-run rehearsal manifest must return
an explicit unavailable result before execution; do not substitute a fixture, create an ad hoc
manifest or start browser/runtime work in its place.

For current work, use the unit, integration and architecture test files that remain under `tests/`,
plus focused lint, type, static and generated checks required by the owning phase. The dated migration
record captures source provenance and completed acceptance evidence; it does not require a scenario
inventory or T1b result while those suites are retired. The current suite map and retirement owner
are the [codebase map](../reference/codebase-structure.md) and the 2026-10-02 amendment in the
backend layout plan (historical source `994837d1f65abd9b9e2f546b3ca52bff90646583:docs/rebuild/plans/phase-3/backend-and-unit-tests.md`).

Definition and registration guards such as `descriptor-coverage`, descriptor tuple equality,
`workflow-layout`, `workflow-authoring-budget`, `pending-impl-bindings`, store-catalog freshness and
workflow-definition conformance continue to protect their current contracts. Check
`docs/rebuild/guard-inventory.json` for the exact active guard set; a retired scenario-only guard is
not a reason to weaken semantic, import-boundary, provenance or write-safety assertions.

---

## 11 · Debugging

- **Definition-time refusals** (§4.3) fire on import: run `npm run typecheck` and any test that
  imports the workflow, read the message — it names the workflow, the entry and the fix.
- **Bind failures** (`workflow bind requires <node>.<path>, which is null|absent`) mean the upstream
  output legitimately lacks the fact (an unresolved selection, a `not-found` arm). Model the arm in
  the bind or record the refusal path for future operator-led scenario design; never default it.
- **Task-level refusals** (`ctx.fail(code, …)`) surface as the task's declared `errorCodes` on the
  run's failure record and in `npm run cli -- explain <run>`.
- **Live** — `npm run cli -- dashboard` (BFF) / `npm run dashboard` for the run timeline, detail
  and Steps screen; `npm run cli -- explain`, `npm run cli -- storage` (the doctor) for spans and
  authority; screenshots and semantic logs are attached to every node automatically.
- **Selector or page-state failures** belong to the owning driver, never to the workflow: use the
  `hr-debug` playbook (`.agents/skill-library/hr-debug/REFERENCE.md`) — headless `playwright-cli`
  snapshot, repair the registry locator, re-verify live, record provenance.
- **Current equivalence checks after a change** — use the retained unit and architecture tests
  selected by the owning phase, plus generated-manifest and store-catalog checks when affected.
  Scenario-based proof and visual parity acceptance are retired; future design requires the operator.

---

## 12 · "What file do I change?"

Doc 03.2's routing table, aligned to D329 — one reason, one owner:

| Change | One primary owner |
|---|---|
| reorder or rename timeline groups | `src/workflows/<id>/workflow.ts` |
| add/change a run option or omission form | `src/workflows/<id>/workflow.ts` |
| connect one task's output to another task's input | `src/workflows/<id>/workflow.ts` |
| change a selector or page-state interpretation | the owning system driver/UI registry |
| change one operation's input/output/effect | the owning task contract + implementation and its direct consumers |
| add shared authentication behavior | the owning session provider/login declaration |
| change retry/checkpoint execution mechanics | the shared executor/recovery services |
| change logs, screenshots, receipts, Archive or generic dashboard rendering | the shared runtime/projection surface |
| change only workflow grouping/options | **no file besides the main `workflow.ts`** |

And the files a workflow author never opens to make a workflow work: a generated descriptor or
module, a node fragment, a registry row beyond the two import lines, a dashboard adapter, a
checkpoint writer, a screenshot hook, a session bootstrap. If a change seems to need one of those,
the change belongs to a shared capability (§2's last row) or the guide is wrong — file the gap
against doc 03.2 `{#workflow-authoring-model}` rather than working around it.
