# Run brief — R-DCR reporting and search

Complete DCR1 and DCR3–DCR6 exactly as specified in `docs/plans/2026-08-28-dashboard-completion-runs.md`.
Own Activity's truthful axes, cross-date search, current-corpus XLSX and
field-level rerun comparison. D282 fixes the two product decisions. D283 requires evidence from the
current separations corpus and leaves later-workflow-only facets/exports out. Preserve redaction and
exact requested-id checks at every boundary.

## Paste-ready supervisor prompt

```text
You are the SUPERVISOR for R-DCR: complete dashboard reporting and search.
Coordinator board: /Users/julianhein/Projects/hr-automation-rebuild/docs/plans/dashboard-reporting-board.md
Board write-back: AUTHORIZED AT CLOSE for this exact path only. Also read the main board, run-plan DCR1 and DCR3–DCR6, this brief, root AGENTS.md and nearest module AGENTS.md files. Never write another board.
Invoke /supervise and run this assignment end to end.
Repo: your Codex-created worktree for /Users/julianhein/Projects/hr-automation-rebuild.
Base: f89301df from integration/03b; your current task branch is the run integration branch. Never checkout, merge or mutate the root integration/03b checkout.
Units in scope: DCR1 DCR3 DCR4 DCR5 DCR6.
Explicitly out of scope: all DCF/DCC/DCA units; artifact byte serving; OCR/People producers; later-workflow export shapes.
Dependencies cleared: D240, D275.4, D282 and D283; current separations corpus exists.
Decisions you may not make: move/remove Unread, enter storage-doctor scope, expose person identifiers, invent future facets, history-moving git.
Use only native sup_scout/sup_analyst/sup_luna/sup_terra/sup_sol roles at high reasoning; set exact agent_type and prefix task_name with it. Invoke /ui for frontend units. Each parallel unit owns a feature worktree/branch and commits logical categories.
Serialize expensive gates with /usr/bin/lockf -k /tmp/hr-dashboard-full-gate.lock and use VITEST_MAX_WORKERS=1 for test:coverage. Do not stop or replace the root BFF on 3938.
Stop when all units are merged --no-ff into your task branch, full gates/parity are green, the exact board is committed, and unit worktrees/feature branches are swept.
If scope grows, /handoff at a coherent merged boundary. On successful close update only the exact board and return the proof report; do not create a handoff.
```
