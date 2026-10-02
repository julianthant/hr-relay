# workflow-authoring — the checklist for adding or changing a workflow

> Internal repository checklist. It adds **no operator command and no policy of its own**: every
> rule it points at is owned by `docs/rebuild/guides/workflow-authoring.md` (practical) and
> `docs/rebuild/reference/workflow-model.md` §§1.6, 5.6, 5.8 (normative). Where this file and the
> guide/spec disagree, **the guide and the spec win** — fix this file.

## The ordered loop

Current homes and dependency direction are in the [codebase structure map](../../../docs/rebuild/reference/codebase-structure.md). An operator definition is `src/workflows/<id>/workflow.ts`; a retained chunk-harness proof is `src/workflows/<composition>/steps/<step>/step.ts`, composed separately and not operator-startable. The composition owns step identities and each harness imports them. The workflow's `task-registry.ts` and `tasks/` contain backend-loaded implementations. Definitions stay browser-safe; renderer and lower-level modules must not import workflow implementations.

1. **Route the change first.** Confirm the change belongs in a workflow at all — guide §12 /
   doc 03c `{#workflow-authoring-model}` routing table. Grouping/options-only ⇒ no file besides
   `workflow.ts`; a selector, a task contract, or a dashboard surface has a different owner.
2. **Find, reuse, or build.** Search the generated task-store catalog `ref stores` §2 by system,
   capability, effect, inputs and outputs, then classify each operation against the reuse table —
   guide §2. "Similar" is not permission to copy a task; a read task's identity is a page visit.
3. **Know your artifacts.** A reuse-only workflow authors its browser-safe `workflow.ts` and
   `docs/rebuild/migrations/<id>.md`, plus the two workflow registration edits and generated
   manifest update — guide §3. Workflow-owned implementation files are added only when the task
   contract requires them. The scenario and parity suites, T1b loader and test-target manifest
   entries were retired on 2026-10-02; they are not authoring requirements.
4. **Write `workflow.ts`.** One `defineWorkflow` call: identity/presentation, typed input/result,
   and `steps` as `[group, entries[]]` tuples — guide §4 (API and refusal messages), §5 (the minimal
   reuse-only example), §6 (step identities via `defineWorkflowStep` + `defineStepEntries`,
   conditional gates, transactions). Every entry is identity → references → bind; typed references,
   not tuple order, are the edges.
5. **Omissions.** Declare `group(step, { omission })` beside the step's entries with a closed form
   and a `produces` map over that step's TASK node ids — guide §7 / `ref workflow-model` §5.8. A
   mandatory verifier is its own entry OUTSIDE the omittable step.
6. **Parallel and delegate entries** — guide §8 (branch declarations, cardinality,
   `deriveChildItemId`).
7. **A new task, if step 2 said BUILD** — guide §9 / `ref stores` §1, §2b: pure fold in the workflow
   mini-store, or a task contract + driver operation in the owning store with live selector
   verification; record every leaf with `ctx.recordData`; unimplemented contracts go in
   `src/backend/app/registries/pending-impl-bindings.json` (D107).
8. **Verify it.** Use focused unit, integration or architecture checks named by the owning phase,
   plus the dated `docs/rebuild/migrations/<id>.md` record — guide §10. A missing rehearsal manifest
   reports unavailable before execution. Scenario and visual-test design requires a separate
   operator-led task; old scenario/parity receipts are not current acceptance evidence.
9. **Read the gates.** Guide §10 and the guard inventory say what each current failure means
   (`descriptor-coverage`, `descriptor-registry`, retained pure checks in `scenario-coverage`, `test-target-registry`,
   `workflow-layout`, `workflow-authoring-budget`, `pending-impl-bindings`, `stores:catalog:check`,
   `workflow-definition-conformance`). The commit gate itself stays
   `npm run typecheck && npm run lint && npm run test:coverage` (root AGENTS.md).
10. **Debug** — guide §11 (definition-time refusals, bind failures, task `errorCodes`, the
    equivalence tests). A selector or page-state failure belongs to the owning driver: use
    `.agents/skill-library/hr-debug/REFERENCE.md`.
11. **Record.** Update the migration doc, the doc 03c PROOF tick, and any owning reference/decision
    in the same commit that lands the change (root AGENTS.md, "A decision is not ratified…").

## Never

- Never add arbitrary files beside an operator `workflow.ts` — no `descriptor.ts`, `module.ts`,
  `nodes.ts`, `node-ids.ts`, or `omission.ts`. Workflow-owned `task-registry.ts` and `tasks/` are
  backend-only; `step.ts` belongs only at a role-derived `steps/<step>/` path.
- Do not add scenario or parity test artifacts as workflow requirements. `workflow-authoring-budget`
  and `workflow-layout` still constrain authored source paths; future test tiers need operator-led
  design.
- Never branch generic code on a workflow id; extend the generic capability once instead.
- Never reintroduce a retired name: the flow node-fragment API (`nodes.category(...)`) and
  `src/workflows/proving/` are gone, not deprecated. "Recipe" is analogy only — the API is
  `defineWorkflow` and its compiled value is `CompiledWorkflow`.
- Never seek an "advanced" escape hatch: there is exactly one authoring path.
- Never ask before live verification, and never substitute a fixture for a live failure.
- Never default a missing bind value, and never re-run a completed transaction to "repair" a run.
