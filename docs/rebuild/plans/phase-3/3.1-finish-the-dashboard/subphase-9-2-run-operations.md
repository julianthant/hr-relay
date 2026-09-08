# Run operations
<!-- roadmap: dash-run-operations -->

**Subphase 3.1.9-2.** Read [shared scope and orchestration](README.md#parallel-execution-and-worktree-contract).
This group can overlap other groups. Its completion is not a prerequisite for another group
unless the exact task dependency explicitly says so. Historical Tasks 1–7 remain unchanged.

| Current task | Outcome and owning brief | Previous identity |
| --- | --- | --- |
| 3.1.9-2.1 | [Finish sessions, worker pools, and browser lifecycle](task-10-2-finish-sessions-worker-pools-and-browser-lifecycle.md) | 3.1.10-2 |
| 3.1.9-2.2 | [Make Run and Rerun enqueue real work](task-11-2-make-run-and-rerun-enqueue-real-work.md) | 3.1.11-2 |
| 3.1.9-2.3 | [Finish queue rows, commands, and deletion](task-12-1-finish-queue-rows-commands-and-deletion.md) | 3.1.12-1 |

Sessions still requires Settings and Storage. Run/Rerun requires Sessions; Queue requires
Run/Rerun. These are genuine retained task dependencies, not permission to implement against
unmerged sibling branches. No whole Shell/configuration subphase closure is required.

Each task needs a focused approved brief with exact paths, prerequisite commit, isolated
branch/worktree, gate resources and either-order merge evidence. The operator chooses launches
and merges; agents return independently reviewed candidates, without messaging siblings or
editing shared completion records concurrently. Four auxiliary worktrees remain the ceiling,
including unrelated work. A proposed fifth lane requires a separate capacity approval.
