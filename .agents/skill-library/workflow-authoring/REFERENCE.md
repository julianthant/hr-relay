# Workflow authoring checklist

The [workflow authoring guide](../../../docs/rebuild/guides/workflow-authoring.md) owns the steps to add or change a Relay workflow. This checklist adds no policy.

1. Read the assigned brief, approved walkthrough, and [codebase map](../../../docs/rebuild/reference/codebase-structure.md).
2. Find, reuse, or build tasks through [stores](../../../docs/rebuild/reference/stores.md).
3. Declare and register the browser-safe workflow through the guide's Files and registration and Write defineWorkflow sections.
4. Follow the guide for shared steps, gates, transactions, omissions, parallel entries, and delegates.
5. Run the focused checks, lint, and generated checks named by the brief, then its final gates. [Guards and tests](../../../docs/rebuild/reference/guards-and-tests.md) owns runner and coverage policy; parity references remain the visual contract.
6. Record commands, results, source provenance, and unrun obligations in the brief's evidence folder in the main checkout's `.work/`.

[Workflow model](../../../docs/rebuild/reference/workflow-model.md) owns declarations and execution. [Task contract](../../../docs/rebuild/reference/task-contract.md) owns task bindings. [Write safety](../../../docs/rebuild/reference/write-safety.md) owns completed-write repetition and UNKNOWN-submit refusal.
