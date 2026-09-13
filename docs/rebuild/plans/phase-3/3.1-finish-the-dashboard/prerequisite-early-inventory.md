# Prepare dashboard inventory during tail revalidation
<!-- roadmap: dash-early-inventory -->

**Current assignment: 3.1.20.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.

Read [the shared phase plan](README.md#parallel-execution-and-worktree-contract) and
[current task identities](README.md#current-task-identities) before a focused assignment.

Optional read-only preparation while 2.6 recovery and closure continue. This produces a provisional inventory only; it does not freeze acceptance, authorize dashboard implementation or satisfy Task 8.

- [ ] map verified 2.6 handoffs to current controls, routes and proposed owners without modifying runtime or in-flight 2.6 plans
- [ ] mark volatile observations and unresolved producer changes for recheck after 2.6 closure

This is roadmap scope, not a launch-ready execution brief. Before implementation, the operator
approves exact paths, base, branch/worktree, proof commands and resource ownership through
`/phase-plan`. Preserve D191, independent review, vertical-slice acceptance and all source safety
contracts. Work independently by default; coordinate with relevant peers when necessary under D344. No
automatic sibling dispatch or merge.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.
