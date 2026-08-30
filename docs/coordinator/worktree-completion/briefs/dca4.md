# Supervisor brief — Finish Archive evidence viewer

Profile: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md
Coordination workspace: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion
Board: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/board.md — READ ONLY; no board write-back.
Run plan: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/run-plan.md
Assigned repository: /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4
Assigned branch/head: feature/dca4-archive-evidence / eda17b2708286e36542e1e18e9f8ef6a06cf3187
Supervisor report: /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/reports/dca4.md
Unit artifact paths: docs/coordinator/worktree-completion/reports/dca4-<unit>.md
Only the supervisor persists read-only agent findings. Writable agents use unique relative paths.

## Scope
Adopt and complete the existing dirty DCA4 diff on its own branch. Scope is archived evidence metadata and exact retained downloadable resources, non-byte capture records, honest purged/unavailable states. Snapshot identity must never be replaced by current live state. DCA1 and the R-DCF Archive dependency are in base ancestry; verify. DCA2 can work independently; do not modify its worktree or shared codex/r-dca-dashboard-artifacts. test-results/.last-run.json is transient test output, not feature proof: preserve at intake, then dispose only that known generated change after recording it; do not commit it as implementation. Account for existing standard Playwright snapshot directories and repository reference triplets without weakening either assertion mechanism.

## Units, in dependency order
### dca4-a1 — sup_scout

Scope: Map exact dirty paths and original DCA4 acceptance to archived authority/source APIs.
Acceptance: Frozen snapshot vs live source boundary and fixture inventory.
Dependency: none.
Visible task prefix: sup_scout_dca4_a1.
Artifact: docs/coordinator/worktree-completion/reports/dca4-a1.md.

### dca4-a2 — sup_sol

Scope: Complete immutable archived resource identity, retained/purged/missing/corrupt arms and route/query tests.
Acceptance: Exact archive ids/resources; no current/latest or metadata-reconstruction fallback.
Dependency: dca4-a1.
Visible task prefix: sup_sol_dca4_a2.
Artifact: docs/coordinator/worktree-completion/reports/dca4-a2.md.

### dca4-a3 — sup_terra

Scope: Use /ui to finish evidence viewing/download including narrow/phone and keyboard/refusal states.
Acceptance: Rendered proof, reviewed parity references and accessible semantics.
Dependency: dca4-a2.
Visible task prefix: sup_terra_dca4_a3.
Artifact: docs/coordinator/worktree-completion/reports/dca4-a3.md.

### dca4-a4 — sup_sol

Scope: Independent correctness/security/UI review and integration-ready close.
Acceptance: Full gates, clean commits/report and no lost dirty work.
Dependency: dca4-a3.
Visible task prefix: sup_sol_dca4_a4.
Artifact: docs/coordinator/worktree-completion/reports/dca4-a4.md.


## Execution and close
Read the complete profile and applicable AGENTS.md before task actions; commands and edits ALWAYS
target the assigned absolute worktree, regardless of inherited task UI cwd. Verify the intake head,
branch and dirty inventory against current state; another writer's unexpected move is a conflict,
not permission to overwrite. The source older run briefs are context only where superseded by
current owning contracts or this exact scope. No new user task, remote push, broad reset/clean,
default agent, silent fallback or unsolicited feature expansion.
Use /supervise with native roles and /ui for all frontend/parity actions. Fix concrete in-scope
findings, update tests and nearest AGENTS.md. Serialize coverage/parity via the profile lock.
Full gates, independent review and exact-path commits are required before integration-ready.
Return a self-contained report with original and final heads, per-unit roles/commits/acceptance,
review axes and findings, command outputs/log pointers, UI evidence, original dirty-file
dispositions, ancestry, remaining resources and exact next integration step.
Do NOT claim shared integration or remove your own existing source worktree: coordinator does that
after receive. Clean up only your newly spawned, merged unit trees (R2 also its assigned parity
child). If genuinely interrupted, use /handoff under this workspace-relative handoffs path and
report the exact dependency. Do not stop merely after dispatching agents or writing a plan.
