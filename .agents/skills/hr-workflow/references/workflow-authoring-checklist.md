# Workflow authoring checklist

The [workflow authoring guide](../../../../docs/guides/workflow-authoring.md) owns the steps to add or change a Relay workflow. This checklist adds no policy.

1. Read the assigned brief, approved walkthrough, and [codebase map](../../../../docs/reference/codebase-structure.md).
2. Find, reuse, or build tasks through [stores](../../../../docs/reference/stores.md).
3. Declare and register the browser-safe workflow through the guide's Files and registration and Write defineWorkflow sections.
4. Follow the guide for shared steps, gates, transactions, omissions, parallel entries, and delegates.
5. Run the focused checks, lint, and generated checks named by the brief, then its final gates. [Guards and tests](../../../../docs/reference/guards-and-tests.md) owns runner and coverage policy; mock references remain the visual contract.
6. Record commands, results, source provenance, and unrun obligations in the brief's evidence folder in the main checkout's `.work/`.

[Workflow model](../../../../docs/reference/workflow-model.md) owns declarations and execution. [Task contract](../../../../docs/reference/task-contract.md) owns task bindings. [Write safety](../../../../docs/reference/write-safety.md) owns completed-write repetition and UNKNOWN-submit refusal.
