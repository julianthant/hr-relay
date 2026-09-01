# Run brief — R-DCF dashboard fidelity closure

Complete DCF1–DCF6 exactly as specified in `docs/plans/2026-08-28-dashboard-completion-runs.md`.
Own Phase 4 C1–C4 and no other carry-in. Use the demo at legacy commit `1ec1d870` as design
authority, but preserve D272–D276/D281 truthful exceptions. Every visual change goes through `/ui`,
is rendered with `playwright-cli`, and receives explicit reference attribution. Do not touch the
root checkout, its BFF, `integration/03b`, settings/search/artifact authority or workflow-specific
Review/People/capture producers.

## Paste-ready supervisor prompt

```text
You are the SUPERVISOR for R-DCF: close current-workflow dashboard fidelity residue.
Coordinator board: /Users/julianhein/Projects/hr-automation-rebuild/docs/plans/dashboard-fidelity-board.md
Board write-back: AUTHORIZED AT CLOSE for this exact path only. Also read the main board, run-plan DCF1–DCF6, this brief, root AGENTS.md and src/dashboard/AGENTS.md. Never write another board.
Invoke /supervise and run this assignment end to end.
Repo: your Codex-created worktree for /Users/julianhein/Projects/hr-automation-rebuild.
Base: f89301df from integration/03b; your current task branch is the run integration branch. Never checkout, merge or mutate the root integration/03b checkout.
Units in scope: DCF1 DCF2 DCF3 DCF4 DCF5 DCF6.
Explicitly out of scope: all DCC/DCR/DCA units; Phase 4 C5/C6; OCR Review; Group People; capture→workflow.
Dependencies cleared: D272–D276, D279, D281 and D283; C1–C4 are active.
Decisions you may not make: scope, product truth, history-moving git, rule conflicts.
Use only native sup_scout/sup_analyst/sup_luna/sup_terra/sup_sol roles at high reasoning; set exact agent_type and prefix task_name with it. Invoke /ui for every frontend unit. Each parallel unit owns a feature worktree/branch and commits logical categories.
Serialize expensive gates with /usr/bin/lockf -k /tmp/hr-dashboard-full-gate.lock and use VITEST_MAX_WORKERS=1 for test:coverage. Do not stop or replace the root BFF on 3938.
Stop when all units are merged --no-ff into your task branch, full gates and parity are green, references are attributed, the exact board is committed, and unit worktrees/feature branches are swept.
If scope grows, /handoff at a coherent merged boundary. On successful close update only the exact board and return the proof report; do not create a handoff.
```
