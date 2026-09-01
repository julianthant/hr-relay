# Run brief — R-DDM current-workflow `/demo`

Complete DDM1–DDM6 exactly as specified in `docs/plans/2026-08-28-dashboard-completion-runs.md`.
Build a real `/demo` path in the supported dashboard runtime. It presents the registered current
Kuali separation workflow's scenario runs, with strict authority-derived scenario identity and honest
result/unavailable states. It must not import `tests/**` into production, invent successful runs, or
turn demo fixtures into operator authority. This run is dependency-held until R-DCT integrates.

## Paste-ready supervisor prompt

```text
You are the SUPERVISOR for R-DDM: build the current-workflow Kuali separation scenario gallery at /demo.
Coordinator board: /Users/julianhein/Projects/hr-automation-rebuild/docs/plans/dashboard-demo-board.md
Board write-back: AUTHORIZED AT CLOSE for this exact path only. Also read the main board, run-plan DDM1–DDM6, this brief, root AGENTS.md and src/dashboard/AGENTS.md. Never write another board.
Invoke /supervise and run this assignment end to end only after the coordinator supplies the post-R-DCT base.
Repo: your Codex-created worktree for /Users/julianhein/Projects/hr-automation-rebuild. Your current task branch is the run integration branch. Never checkout, merge or mutate the root integration/03b checkout.
Units in scope: DDM1 DDM2 DDM3 DDM4 DDM5 DDM6.
Operator decision: add a /demo page for scenario runs of workflows currently present; this instance shows only Kuali separation.
Required truth boundary: /demo is a real pathname in the supported dashboard runtime; exact scenario ids and ordering derive from the registered descriptor/executable manifest and any durable dry-run result authority. Production may not import tests/** or expose source-file contents. A declared scenario without a durable representative result is labeled unavailable/not yet run, never illustrated as a fabricated success. Pin the exact included Kuali separation scenario set before UI implementation.
UI route: invoke /ui in Operate mode, use the existing dashboard design system, and verify via playwright-cli plus project parity/a11y. Include workflow context, scenario selection, selected run/story/evidence state, stable deep links, browser back/forward, return to live dashboard, and complete loading/empty/error/long-label/responsive states.
Explicitly out of scope: reintroducing Capture Mode, later workflows, executing live writes from the demo, OCR Review, arbitrary test runner exposure, or a second unrelated visual system.
Decisions you may not make: invent scenario outcomes, broaden registered workflows, bypass the BFF/wire boundary, history-moving git, or rule conflicts.
Use only native sup_scout/sup_analyst/sup_luna/sup_terra/sup_sol roles at high reasoning; set exact agent_type and prefix task_name with it. Each parallel unit owns a feature worktree/branch and commits logical categories.
Serialize expensive gates with /usr/bin/lockf -k /tmp/hr-dashboard-full-gate.lock and use VITEST_MAX_WORKERS=1 for test:coverage. Do not stop or replace the root BFF on 3938.
Stop when all units are merged --no-ff into your task branch, full gates and parity are green, /demo is built and served, references are attributed, roadmap is fresh, the exact board is committed, and unit worktrees/feature branches are swept.
If scope grows, /handoff at a coherent merged boundary. On successful close update only the exact board and return the proof report; do not create a handoff.
```
