# Run brief — R-DCT retire mobile document capture

Complete DCT1–DCT6 exactly as specified in `docs/plans/2026-08-28-dashboard-completion-runs.md`.
Remove the mobile document-capture product end to end: operator and phone UI, browser entry,
transport/commands, capture-session authority, capture-to-intake handoff and every active plan/roadmap
promise. The word “capture” is overloaded; preserve diagnostic screenshots, artifact evidence and
run-detail/receipt capture records that are not part of the phone document-capture product. Every
visual change goes through `/ui` and is rendered with `playwright-cli`.

## Paste-ready supervisor prompt

```text
You are the SUPERVISOR for R-DCT: retire the rebuild's mobile document Capture Mode end to end.
Coordinator board: /Users/julianhein/Projects/hr-automation-rebuild/docs/plans/dashboard-capture-retirement-board.md
Board write-back: AUTHORIZED AT CLOSE for this exact path only. Also read the main board, run-plan DCT1–DCT6, this brief, root AGENTS.md and every nearer AGENTS.md. Never write another board.
Invoke /supervise and run this assignment end to end.
Repo: your Codex-created worktree for /Users/julianhein/Projects/hr-automation-rebuild. Your current task branch is the run integration branch. Never checkout, merge or mutate the root integration/03b checkout.
Units in scope: DCT1 DCT2 DCT3 DCT4 DCT5 DCT6.
Operator decision: remove Capture Mode from the rebuild, active rebuild plans and roadmap.
Exact semantic boundary: DELETE the mobile/phone document-capture product (capture.html and phone bundle, operator Start Capture/session panel, capture client/state, session/phone routes and service, capture commands, capture session/outbox authority, capture-to-intake/workflow handoff/binding, capture-only configuration/capabilities, tests and active normative promises). PRESERVE generic diagnostic bundle screenshots, content-addressed artifact evidence, receipt/run-detail capture records and any non-phone capture semantics. DCT1 must commit a keep/delete inventory before destructive edits.
Explicitly out of scope: OCR Review, generic artifact viewers owned by R-DCA, unrelated DCC/DCR work, separations workflow behavior, and deleting historical documents merely because they mention what once existed.
Decisions you may not make: broaden the deletion across the overloaded word capture; invent replacement intake authority; history-moving git; rule conflicts. Ratify the operator retirement in the owning normative docs plus the next-free decision pointer in the same commit; re-check the next free decision id immediately before that commit.
Use only native sup_scout/sup_analyst/sup_luna/sup_terra/sup_sol roles at high reasoning; set exact agent_type and prefix task_name with it. Invoke /ui for every frontend unit. Each parallel unit owns a feature worktree/branch and commits logical categories.
Serialize expensive gates with /usr/bin/lockf -k /tmp/hr-dashboard-full-gate.lock and use VITEST_MAX_WORKERS=1 for test:coverage. Do not stop or replace the root BFF on 3938.
Stop when all units are merged --no-ff into your task branch, full gates and parity are green, roadmap is fresh, active plan promises are removed, the exact board is committed, and unit worktrees/feature branches are swept.
If scope grows, /handoff at a coherent merged boundary. On successful close update only the exact board and return the proof report; do not create a handoff.
```
