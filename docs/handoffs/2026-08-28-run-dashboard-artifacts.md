# Run brief — R-DCA artifact reads and evidence viewers

Complete DCA1–DCA5 exactly as specified in `docs/plans/2026-08-28-dashboard-completion-runs.md`.
Own strict content-addressed artifact byte serving and evidence viewers for authority the current
separations workflow already produces. R-DCF is integrated at `e0cd4353`; preserve its run-detail,
archive and parity contracts. Every visual change goes through `/ui`, is rendered with
`playwright-cli`, and receives explicit reference attribution. Do not touch the root checkout, its
BFF, `integration/03b`, OCR Review, capture-to-workflow producers, phone capture production paths,
or workflow-specific authority that does not exist yet.

## Paste-ready supervisor prompt

```text
You are the SUPERVISOR for R-DCA: finish strict artifact reads and evidence viewers for current separations authority.
Coordinator board: /Users/julianhein/Projects/hr-automation-rebuild/docs/plans/dashboard-artifacts-board.md
Board write-back: AUTHORIZED AT CLOSE for this exact path only. Also read the main board, run-plan DCA1–DCA5, this brief, root AGENTS.md and src/dashboard/AGENTS.md. Never write another board.
Invoke /supervise and run this assignment end to end.
Repo: your Codex-created worktree for /Users/julianhein/Projects/hr-automation-rebuild.
Base: e0cd4353 from integration/03b after R-DCF; your current task branch is the run integration branch. Never checkout, merge or mutate the root integration/03b checkout.
Units in scope: DCA1 DCA2 DCA3 DCA4 DCA5.
Explicitly out of scope: all DCC/DCR units; OCR Review; capture-to-workflow; phone capture production paths; later-workflow artifact producers; new workflow authoring.
Dependencies cleared: R-DCF/C1-C4 and D283 current-workflow scope. Preserve exact bundle/run/archive identity and fail loud on missing, corrupt, foreign or purged evidence.
Decisions you may not make: scope, product truth, history-moving git, rule conflicts, or inventing authority not present in the current workflow.
Use only native sup_scout/sup_analyst/sup_luna/sup_terra/sup_sol roles at high reasoning; set exact agent_type and prefix task_name with it. Invoke /ui for every frontend unit. Each parallel unit owns a feature worktree/branch and commits logical categories.
Serialize expensive gates with /usr/bin/lockf -k /tmp/hr-dashboard-full-gate.lock and use VITEST_MAX_WORKERS=1 for test:coverage. Do not stop or replace the root BFF on 3938.
Stop when all units are merged --no-ff into your task branch, full gates and parity are green, references are attributed, the exact board is committed, and unit worktrees/feature branches are swept.
If scope grows, /handoff at a coherent merged boundary. On successful close update only the exact board and return the proof report; do not create a handoff.
```
