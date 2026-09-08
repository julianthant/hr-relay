# Integrated acceptance
<!-- roadmap: dash-integrated-acceptance -->

**Subphase 3.1.10.** Read [shared scope and orchestration](README.md#parallel-execution-and-worktree-contract).
This group can overlap other groups. Its completion is not a prerequisite for another group
unless the exact task dependency explicitly says so. Historical Tasks 1–7 remain unchanged.

| Current task | Outcome and owning brief | Previous identity |
| --- | --- | --- |
| 3.1.10.1 | [Finish production startup, serving, and shutdown](task-12-4-finish-production-startup-serving-and-shutdown.md) | 3.1.12-4 |
| 3.1.10.2 | [Prove realtime convergence and reconnect](task-15-prove-realtime-convergence-and-reconnect.md) | 3.1.15 |
| 3.1.10.3 | [Meet large-data and responsiveness budgets](task-16-meet-large-data-and-responsiveness-budgets.md) | 3.1.16 |
| 3.1.10.4 | [Build the complete dashboard proof infrastructure](task-17-build-the-complete-dashboard-proof-infrastructure.md) | 3.1.17 |
| 3.1.10.5 | [Execute integrated dashboard acceptance and close 3.1](task-18-execute-integrated-dashboard-acceptance-and-close-3-1.md) | 3.1.18 |

Production runtime may start after its named Setup/Storage/Sessions prerequisites. Final
realtime, performance, complete proof infrastructure and integrated acceptance retain their
combined-tree dependencies and required gates. Task acceptance does not waive phase closure.

Each task needs a focused approved brief with exact paths, prerequisite commit, isolated
branch/worktree, gate resources and either-order merge evidence. The operator chooses launches
and merges; agents return independently reviewed candidates, without messaging siblings or
editing shared completion records concurrently. Four auxiliary worktrees remain the ceiling,
including unrelated work. A proposed fifth lane requires a separate capacity approval.
