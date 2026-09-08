# Shell and configuration
<!-- roadmap: dash-shell-configuration -->

**Subphase 3.1.9-1.** Read [shared scope and orchestration](README.md#parallel-execution-and-worktree-contract).
This group can overlap other groups. Its completion is not a prerequisite for another group
unless the exact task dependency explicitly says so. Historical Tasks 1–7 remain unchanged.

| Current task | Outcome and owning brief | Previous identity |
| --- | --- | --- |
| 3.1.9-1.1 | [Finish the shell, navigation, and accessibility baseline](task-9-1-finish-the-shell-navigation-and-accessibility-baseline.md) | 3.1.9-1 |
| 3.1.9-1.2 | [Finish Settings over the canonical settings authority](task-9-2-finish-settings-over-the-canonical-settings-authority.md) | 3.1.9-2 |
| 3.1.9-1.3 | [Finish basic storage health and recovery access](task-9-3-finish-basic-storage-health-and-recovery-access.md) | 3.1.9-3 |
| 3.1.9-1.4 | [Repair date navigation and the date picker](task-10-1-repair-date-navigation-and-the-date-picker.md) | 3.1.10-1 |
| 3.1.9-1.5 | [Finish Setup and preflight](task-11-1-finish-setup-and-preflight.md) | 3.1.11-1 |

Shell, Settings and basic storage may proceed after their shared foundation. Date navigation
still requires Shell; Setup still requires Settings, Storage and Sessions. These specific
dependencies remain until a separately approved extraction proves a smaller prerequisite.

Each task needs a focused approved brief with exact paths, prerequisite commit, isolated
branch/worktree, gate resources and either-order merge evidence. The operator chooses launches
and merges; agents return independently reviewed candidates, without messaging siblings or
editing shared completion records concurrently. Four auxiliary worktrees remain the ceiling,
including unrelated work. A proposed fifth lane requires a separate capacity approval.
