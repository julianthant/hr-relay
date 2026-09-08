# Standing surfaces
<!-- roadmap: dash-standing-surfaces -->

**Subphase 3.1.9-4.** Read [shared scope and orchestration](README.md#parallel-execution-and-worktree-contract).
This group can overlap other groups. Its completion is not a prerequisite for another group
unless the exact task dependency explicitly says so. Historical Tasks 1–7 remain unchanged.

| Current task | Outcome and owning brief | Previous identity |
| --- | --- | --- |
| 3.1.9-4.1 | [Finish Workflow Explorer and catalog editing](task-9-4-finish-workflow-explorer-and-catalog-editing.md) | 3.1.9-4 |
| 3.1.9-4.2 | [Finish notifications and delivery behavior](task-10-3-finish-notifications-and-delivery-behavior.md) | 3.1.10-3 |
| 3.1.9-4.3 | [Finish Intake surfaces](task-10-4-finish-intake-surfaces.md) | 3.1.10-4 |
| 3.1.9-4.4 | [Finish Archive, versions, relaunch, and deletion](task-11-3-finish-archive-versions-relaunch-and-deletion.md) | 3.1.11-3 |
| 3.1.9-4.5 | [Finish Activity, search, and export](task-12-3-finish-activity-search-and-export.md) | 3.1.12-3 |
| 3.1.9-4.6 | [Generic Review and People pages — deferred until needed](task-14-generic-review-and-people-pages-deferred-until-needed.md) | 3.1.14 |

Explorer, Notifications, Intake and Archive can become ready after the shared foundation;
Activity still requires Archive. People/Review remains deferred by D339 and does not gate
release or any required child. Intake does not own the Run/Rerun modal.

Each task needs a focused approved brief with exact paths, prerequisite commit, isolated
branch/worktree, gate resources and either-order merge evidence. The operator chooses launches
and merges; agents return independently reviewed candidates, without messaging siblings or
editing shared completion records concurrently. Four auxiliary worktrees remain the ceiling,
including unrelated work. A proposed fifth lane requires a separate capacity approval.
