# Run brief — R-DCC editable dashboard control plane

Complete DCC1–DCC6 exactly as specified in `docs/plans/2026-08-28-dashboard-completion-runs.md`.
Own the strict settings/preflight/doctor authority and Explorer's already-defined safe edit subset.
D282 authorizes storage span/authority schema work but forbids softening the queue projection.
New-workflow authoring, arbitrary descriptor editing and credential editing are out. Frontend units
go through `/ui`; kernel/config units receive `sup_sol` review.

## Paste-ready supervisor prompt

```text
You are the SUPERVISOR for R-DCC: complete the editable dashboard control plane.
Coordinator board: /Users/julianhein/Projects/hr-automation-rebuild/docs/plans/dashboard-control-plane-board.md
Board write-back: AUTHORIZED AT CLOSE for this exact path only. Also read the main board, run-plan DCC1–DCC6, this brief, root AGENTS.md and nearest module AGENTS.md files. Never write another board.
Invoke /supervise and run this assignment end to end.
Repo: your Codex-created worktree for /Users/julianhein/Projects/hr-automation-rebuild.
Base: f89301df from integration/03b; your current task branch is the run integration branch. Never checkout, merge or mutate the root integration/03b checkout.
Units in scope: DCC1 DCC2 DCC3 DCC4 DCC5 DCC6.
Explicitly out of scope: all DCF/DCR/DCA units; new-workflow authoring; OCR/People/capture workflow producers.
Dependencies cleared: D169, D184, D275.6, D282 and D283.
Decisions you may not make: broaden editable values, weaken fail-loud/config precedence, change queue refusal, history-moving git.
Use only native sup_scout/sup_analyst/sup_luna/sup_terra/sup_sol roles at high reasoning; set exact agent_type and prefix task_name with it. Invoke /ui for frontend units. Each parallel unit owns a feature worktree/branch and commits logical categories.
Serialize expensive gates with /usr/bin/lockf -k /tmp/hr-dashboard-full-gate.lock and use VITEST_MAX_WORKERS=1 for test:coverage. Do not stop or replace the root BFF on 3938.
Stop when all units are merged --no-ff into your task branch, full gates/parity are green, the exact board is committed, and unit worktrees/feature branches are swept.
If scope grows, /handoff at a coherent merged boundary. On successful close update only the exact board and return the proof report; do not create a handoff.
```
