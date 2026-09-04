# Workflow authoring decisions — operator context

This topic record preserves the answers behind the workflow-authoring model. Normative behavior is
in ref workflow-model and the other owners named by `docs/rebuild/reference/decisions.md`.

## D307 — whole-step omission

On 2026-09-01 the operator ruled that any step may be selected or omitted and that required values
from omitted steps are collected as custom input. The first implementation made the Kronos
timecard, UCPath transaction, and Kuali finalization steps omittable. D313 later sharpened the rule:
the run modal supplies the complete replacement set before planning, and an omitted step executes
none of its entries.

Normative owners: ref workflow-model §5.8, ref write-safety §3.1, ref dashboard-surfaces §9.1, ref
operator-trust §2.3, and the Separations migration record.

## D312–D317 — modular workflow authoring

The operator accepted all five recommendations on 2026-09-02 and then corrected the terminology:
“pantry and recipe” is explanatory only; the technical model is a workflow.

| Decision | Answer retained here | Canonical owner |
|---|---|---|
| D312 | A reuse-only workflow has exactly four authored workflow-specific artifacts. | ref workflow-model §1.6.1 |
| D313 | The run modal owns whole-step omission and the complete replacement values; omitted entries do not execute. | ref workflow-model §5.8 |
| D314 | Recovery offers checkpoint resume or restart from start without repeating a completed external write. | ref workflow-model §5.6.1 |
| D315 | Workflow entries use the closed explicit algebra `task`, `parallel`, `delegate`, `gate`, or `transaction`. | ref workflow-model §1.6.1 |
| D316 | Person Lookup and Separations must prove public equivalence before the superseded authoring path is deleted. | ref workflow-model §1.6.1; ref guards-and-tests §10.11 |
| D317 | The authored artifact is `workflow.ts`, created with `defineWorkflow`, compiled to `CompiledWorkflow`, and executed as a `WorkflowRun`; recipe names are forbidden at this seam. | ref workflow-model §1.6 |

The choices do not create a second runtime, weaken write safety, or treat typed operator input as an
independent observation.

On 2026-09-03 the operator confirmed the remaining D313 interpretation: verification after an
omission is workflow-specific. There is no universal verifier and no platform rule that compares
two attempts. A workflow declares a separate mandatory verification entry only when that
workflow's own write contract requires one.
