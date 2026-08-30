# Supervisor brief — Verify and finish reporting worktree

Required skill: /supervise — read /Users/julianhein/.agents/skills/supervise/SKILL.md completely
before dispatch, and follow its required references, native-role guard, verification and reviews.

Profile: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md
Coordination workspace: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion
Board: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/board.md — READ ONLY; no board write-back.
Run plan: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/run-plan.md
Assigned repository: /Users/julianhein/.codex/worktrees/3646/hr-automation-rebuild
Assigned branch/head: codex/r-dcr-authority-close / 6d1e3ca89714e13ea7bbb440d27957301ffc6ca6
Supervisor report: /Users/julianhein/.codex/worktrees/3646/hr-automation-rebuild/docs/coordinator/worktree-completion/reports/dcr.md
Unit artifact paths: docs/coordinator/worktree-completion/reports/dcr-<unit>.md
Only the supervisor persists read-only agent findings. Writable agents use unique relative paths.

## Scope
Verify the closed report docs/handoffs/2026-08-28-r-dcr-authority-close-report.md and head 6d1e3ca8, including the final docs/status addition. Do NOT rebuild completed DCR1/DCR3–DCR6 or expand to later workflows. Prove commit ancestry, independent review provenance, gates and migration/secret safety; fix only concrete receive findings in that branch. The report's seven ineligible rows are an honest unavailable state, not authority to fabricate pseudonyms or rerun HR work. Final integration and removal of this supervisor worktree belongs to the coordinator after receipt.

## Units, in dependency order
### dcr-q1 — sup_scout

Scope: Map the final report to actual commit, migration, test and review artifacts.
Acceptance: Evidence matrix with proved/claimed-unverified/residue.
Dependency: none.
Visible task prefix: sup_scout_dcr_q1.
Artifact: docs/coordinator/worktree-completion/reports/dcr-q1.md.

### dcr-q2 — sup_sol

Scope: Receive-review identity/disclosure boundaries D288/D289 and D75 at the current head.
Acceptance: Concrete findings only; preserve privacy and immutable evidence; review fixes independently if needed.
Dependency: dcr-q1.
Visible task prefix: sup_sol_dcr_q2.
Artifact: docs/coordinator/worktree-completion/reports/dcr-q2.md.

### dcr-q3 — sup_terra

Scope: Run exact serialized gates and /ui rendered parity verification of changed reporting surfaces.
Acceptance: Full counts, logs, build-manifest freshness; no blanket refreeze.
Dependency: dcr-q2.
Visible task prefix: sup_terra_dcr_q3.
Artifact: docs/coordinator/worktree-completion/reports/dcr-q3.md.

### dcr-q4 — sup_sol

Scope: Return a clean integration-ready branch and report; remove only its already-merged temporary units.
Acceptance: Evidence-backed release handback; do not edit historical closed board or root.
Dependency: dcr-q3.
Visible task prefix: sup_sol_dcr_q4.
Artifact: docs/coordinator/worktree-completion/reports/dcr-q4.md.


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
