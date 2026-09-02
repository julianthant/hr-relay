# Decisions — modular workflow authoring — 2026-09-02
_Answered positionally in chat after a stateless design grill; ratified as D312–D316._

## 1 · What counts as simple?

**Situation.** The recipe compiler fails its purpose if descriptors, modules, node fragments,
registry wiring and generic dashboard tests remain workflow-author obligations.

**Options.**
- **A.** Strict four-artifact budget for a workflow that reuses existing tasks and surfaces: one
  recipe, one structural scenario, one dry-run manifest and one migration record.
- **B.** Permit extra workflow glue whenever convenient.
- **C.** Use no enforceable boundary; judge simplicity informally.

**Recommendation.** A — it makes simplicity mechanically checkable.

**Notes.** Codex, Claude and developers are the recipe authors.

## 2 · What authority do custom values have?

**Situation.** A schema proves shape, not truth. The operator nevertheless requires an omitted step
to be skipped whole and its complete replacement values collected before the run starts.

**Options.**
- **A.** Every schema-valid custom value may feed every later write without another declaration.
- **B.** Each step declares its operator-suppliable values; the run modal collects the complete set
  before planning, while separately declared mandatory verification tasks may still run later.
- **C.** Custom values may feed reads and calculations only; transactions must reread them.

**Recommendation.** B — whole-step omission remains simple without confusing typed input with
independent verification.

**Notes.** The operator clarified that step selection and every custom value are decided in the run
modal; there is no mid-run request for omitted-step data.

## 3 · How does recovery work?

**Situation.** Operators need two explicit choices after failure: continue from durable progress or
start the workflow logic over, without replaying successful external writes.

**Options.**
- **A.** Offer Resume from checkpoints and Restart from start. Restart mints the next run attempt for
  the same item, reruns read/compute work, preserves completed transaction proof and never executes
  those writes again.
- **B.** Create a linked new logical item and import earlier writes as external dependencies.
- **C.** Create an independent run and rely only on transaction probes to prevent duplicates.

**Recommendation.** A — it preserves lineage and gives a fresh read pass without duplicate writes.

**Notes.** A fresh read that disagrees with preserved write authority must refuse rather than claim
the old write matches the new facts.

## 4 · How are advanced execution shapes represented?

**Situation.** Parallel work, delegated workflows, gates and transactions must remain visible in the
simple authoring model; compiler inference would hide consequential behavior.

**Options.**
- **A.** Use explicit typed `task`, `parallel`, `delegate`, `gate` and `transaction` entries inside
  each timeline tuple's task array.
- **B.** Infer execution shape from dependencies and metadata.
- **C.** Keep the old graph authoring path as an advanced escape hatch.

**Recommendation.** A — one model stays expressive without becoming implicit.

**Notes.** Parallel leaves retry independently; delegation compiles to the existing child-workflow
contract rather than an in-process function call.

## 5 · What proves the architecture succeeded?

**Situation.** An additive facade is not simplification if old workflow declarations survive as a
second authority.

**Options.**
- **A.** Person Lookup and Separations must compile to equivalent public behavior, then redundant
  declarations are deleted; grouping/run-option changes touch one recipe and a reuse-only workflow
  satisfies item 1's artifact budget.
- **B.** Keep both authoring paths indefinitely and evaluate future workflows case by case.
- **C.** Convert Person Lookup only and defer the completeness proof.

**Recommendation.** A — Person Lookup proves the minimum and Separations proves the difficult case.

**Notes.** Existing execution, write-safety and durable evidence remain unchanged.

## Answers (2026-09-02)

| # | Chosen | Operator note |
|---|---|---|
| 1 | A | Authors are Codex, Claude and developers. |
| 2 | B | The run modal already decides which steps are skipped and collects their custom values. |
| 3 | A | Offer checkpoint resume or restart from start; completed writes are skipped. |
| 4 | A | Use explicit typed recipe entries. |
| 5 | A | Enforce the hard acceptance test. |

## Ratification

D312–D316 in `docs/rebuild/reference/decisions.md` record these choices. Normative behavior lives in
ref workflow-model §§1.6, 5.6 and 5.8; ref dashboard-surfaces §9.1; ref
frontend-backend-integration §5.1.1; ref guards-and-tests §10.11; and doc 03c
`{#workflow-authoring-model}`.
