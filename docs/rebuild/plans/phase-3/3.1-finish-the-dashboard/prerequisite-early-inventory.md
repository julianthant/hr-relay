# Prepare dashboard inventory during tail revalidation
<!-- roadmap: dash-early-inventory -->

Read [the shared phase plan](README.md#parallel-execution-and-worktree-contract) and
[shared foundations](subphase-8-shared-foundations.md) before a focused assignment.

Optional read-only preparation while 2.6 recovery and closure continue. This produces a provisional inventory only; it does not freeze acceptance, authorize dashboard implementation or satisfy Task 8.

- [ ] map verified 2.6 handoffs to current controls, routes and proposed owners without modifying runtime or in-flight 2.6 plans
- [ ] mark volatile observations and unresolved producer changes for recheck after 2.6 closure

This is roadmap scope, not a launch-ready execution brief. Before implementation, the operator
approves exact paths, base, branch/worktree, proof commands and resource ownership through
`/phase-plan`. Preserve D191, independent review, vertical-slice acceptance and all source safety
contracts. No agent-to-agent coordination, sibling dispatch or automatic merge.
