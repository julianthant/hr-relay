# workflow-authoring — the checklist for adding or changing a workflow

> Internal repository checklist. It adds **no operator command and no policy of its own**: every
> rule it points at is owned by `docs/guides/workflow-authoring.md` (practical) and
> `docs/rebuild/reference/workflow-model.md` §§1.6, 5.6, 5.8 (normative). Where this file and the
> guide/spec disagree, **the guide and the spec win** — fix this file.

## The ordered loop

1. **Route the change first.** Confirm the change belongs in a workflow at all — guide §12 /
   doc 03c `{#workflow-authoring-model}` routing table. Grouping/options-only ⇒ no file besides
   `workflow.ts`; a selector, a task contract, or a dashboard surface has a different owner.
2. **Find, reuse, or build.** Search the generated task-store catalog `ref stores` §2 by system,
   capability, effect, inputs and outputs, then classify each operation against the reuse table —
   guide §2. "Similar" is not permission to copy a task; a read task's identity is a page visit.
3. **Know your artifacts.** A reuse-only workflow authors exactly four files (`workflow.ts`,
   `structural.scenario.test.ts`, `dry-run.scenario.ts`, `docs/migrations/<id>.md`) plus the two
   registration edits (five lines across the two registry files) and `npm run build:manifest` — guide §3. The T1b loader/resolver/registry-arm
   entries, the cited `GENERIC_WORKFLOW_ID_ALLOWLIST` / `ARTIFACT_EXEMPTIONS` lists and a harness's smaller budget are the separate documented surfaces in guide §3 and §6.4.
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
   `config/pending-impl-bindings.json` (D107).
8. **Prove it.** The T1 pair, `config/test-subjects.json` labels, the live
   `npm run cli -- dry-run-scenario <workflow> --subject <label>`, and the dated
   `docs/migrations/<id>.md` record — guide §10 / `ref guards-and-tests` §10.11. Live verification is
   pre-authorized: run it, never ask.
9. **Read the gates.** Guide §10's red-gate table says what each failure means
   (`descriptor-coverage`, `descriptor-registry`, `scenario-coverage`, `test-target-registry`,
   `workflow-layout`, `workflow-authoring-budget`, `pending-impl-bindings`, `stores:catalog:check`,
   `workflow-definition-conformance`). The commit gate itself stays
   `npm run typecheck && npm run lint && npm run test:coverage` (root AGENTS.md).
10. **Debug** — guide §11 (definition-time refusals, bind failures, task `errorCodes`, the
    equivalence tests). A selector or page-state failure belongs to the owning driver: use
    `.agents/skill-library/hr-debug/REFERENCE.md`.
11. **Record.** Update the migration doc, the doc 03c PROOF tick, and any owning reference/decision
    in the same commit that lands the change (root AGENTS.md, "A decision is not ratified…").

## Never

- Never add a file beside a `workflow.ts` — no `descriptor.ts`, `module.ts`, `nodes.ts`, `step.ts`,
  `node-ids.ts`, `omission.ts`; a step folder exists only when it carries a chunk harness.
- Never add a fifth authored artifact, or a hand-authored generated path
  (`workflow-authoring-budget` refuses it).
- Never branch generic code on a workflow id; extend the generic capability once instead.
- Never reintroduce a retired name: the flow node-fragment API (`nodes.category(...)`) and
  `src/workflows/proving/` are gone, not deprecated. "Recipe" is analogy only — the API is
  `defineWorkflow` and its compiled value is `CompiledWorkflow`.
- Never seek an "advanced" escape hatch: there is exactly one authoring path.
- Never ask before live verification, and never substitute a fixture for a live failure.
- Never default a missing bind value, and never re-run a completed transaction to "repair" a run.
