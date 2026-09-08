# Run detail and evidence
<!-- roadmap: dash-detail-evidence -->

**Subphase 3.1.9-3.** Read [shared scope and orchestration](README.md#parallel-execution-and-worktree-contract).
This group can overlap other groups. Its completion is not a prerequisite for another group
unless the exact task dependency explicitly says so. Historical Tasks 1–7 remain unchanged.

| Current task | Outcome and owning brief | Previous identity |
| --- | --- | --- |
| 3.1.9-3.1 | [Finish run detail and the live timeline](task-12-2-finish-run-detail-and-the-live-timeline.md) | 3.1.12-2 |
| 3.1.9-3.2 | [Finish Context, Data, Attempts, and provenance readback](task-13-1-finish-context-data-attempts-and-provenance-readback.md) | 3.1.13-1 |
| 3.1.9-3.3 | [Finish logs, observations, and captures](task-13-2-finish-logs-observations-and-captures.md) | 3.1.13-2 |
| 3.1.9-3.4 | [Finish receipts and failure records](task-13-3-finish-receipts-and-failure-records.md) | 3.1.13-3 |
| 3.1.9-3.5 | [Finish gates and parked-write resolution](task-13-4-finish-gates-and-parked-write-resolution.md) | 3.1.13-4 |

The accepted detail-section foundation and Queue are the common prerequisites. Timeline,
Context/Data, Logs, Receipts/Failures and Gates can then be independently assigned only after
the foundation verifies disjoint production, fixture, test and generated-artifact ownership.
This offers five candidate assignments, not authorization for five simultaneous worktrees.

Each task needs a focused approved brief with exact paths, prerequisite commit, isolated
branch/worktree, gate resources and either-order merge evidence. The operator chooses launches
and merges; agents return independently reviewed candidates, without messaging siblings or
editing shared completion records concurrently. Four auxiliary worktrees remain the ceiling,
including unrelated work. A proposed fifth lane requires a separate capacity approval.
