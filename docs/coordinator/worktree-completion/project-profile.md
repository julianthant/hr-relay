# Project profile — remaining worktree completion

Verified 2026-08-30. Repository: /Users/julianhein/Projects/hr-automation-rebuild. Coordination workspace: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion.
This is a bounded recovery/integration workspace, not a replacement product plan. Existing plans,
decisions, reports and handoffs stay at their established paths.

## Authorities and rules
- Applicable root and nearest AGENTS.md, plus the operator's replacement instructions in this task.
- Product plan: docs/roadmap/roadmap.md and docs/rebuild/03a-finish-the-dashboard.md,
  docs/rebuild/03b-finish-separations.md; owning reference contracts in docs/rebuild/reference/.
- Existing run plans: docs/plans/2026-08-27-03b-runs.md and
  docs/plans/2026-08-28-dashboard-completion-runs.md (newer versions on integration/03b/run branches).
- Read decisions.md as a pointer index only. R2 uses doc 03b Track A / D284/D286/D287;
  reporting uses D288/D289 and the owning dashboard-surfaces/operator-trust text.
- Canonical close targets: only changed owning phase/reference/migration docs, relevant AGENTS.md,
  generated roadmap; coordinator reconciles existing boards after verification.
- This workspace board is coordinator-only. No supervisor writes ANY shared/closed historical board.
- Operator request 2026-08-30 explicitly authorizes forked supervisors to finish all eight listed
  auxiliary worktrees, including the earlier R2 parity child. It does not authorize future workflows,
  unrelated deferrals, policy changes, remote pushes, or approval of an ALWAYS-GATE.

## Worktree and task isolation
Every supervisor must read and use /Users/julianhein/.agents/skills/supervise/SKILL.md in full,
including required references. The installed invocation is /supervise, not /supervisor.
Reuse existing isolated worktrees. Fork coordinator/previous task in same-directory mode to avoid
creating throwaway checkout copies; each prompt mandates its assigned absolute workdir for EVERY
command/edit. The task UI's inherited cwd is not authorization to write root.
Seven supervisors own eight worktrees: R2 alone owns both its parent and parity child.
New subagent branches/worktrees only when necessary; native roles only:
sup_scout 120k/105k, sup_analyst 200k/180k, sup_luna/sup_terra/sup_sol 240k/220k;
high reasoning, exact role prefix on visible task name, one seam per unit.
No supervisor forks new user tasks. Read-only agent findings are persisted by its supervisor.
Each writer gets a unique relative artifact path under docs/coordinator/worktree-completion/.
Do not automatically clean a foreign worktree or browser fleet.

## Git integration and cleanup
Frozen common integration baseline: integration/03b at 13175b13340fec7b5326207fe54f98078d481d7d.
Coordinator checkout began on master at 61ca853caad0c214f8240c0a1e94ae758cd916b5, clean.
Root master deliberately remains a separate release line: master merge remains the operator step
per the existing phase plan; do not silently merge the completion program into master.
Final target for returned run branches is integration/03b, serial --no-ff merges owned by the
coordinator (or one subsequently explicitly assigned integration supervisor).
No worker writes root, integration/03b, or shared codex/r-dca-dashboard-artifacts.
R2 may merge/sweep ONLY its own parity child; others may merge/sweep their new owned subunits.
Existing supervisor/source worktrees are removed by the coordinator only after their work and
reports are durably integrated, gates pass, and no ignored runtime evidence/secrets would be lost.
Record dispositions for ignored artifacts. Never git clean/reset/stash/force-delete to make a
tree appear finished. No blanket ours/theirs conflict handling. Preserve local history and stage
explicit paths. Local commits only, never push.

## Gates and resource ownership
Confirm command definitions in assigned package.json; current family:
npm run typecheck; npm run lint; npm run test:coverage; npm run build:manifest
(require resulting manifest clean); npm run test:parity; npm run roadmap:check; git diff --check.
Serialize all expensive coverage and parity commands across supervisors with the EXISTING gate
lock from dashboard-completion-board:
  /usr/bin/lockf -k /tmp/hr-dashboard-full-gate.lock env VITEST_MAX_WORKERS=1 npm run test:coverage
  /usr/bin/lockf -k /tmp/hr-dashboard-full-gate.lock npm run test:parity
Use nonblocking admission (-t 0) if needed and report busy to the coordinator rather than occupying
a shell indefinitely. Never unlink the shared lock file or weaken timeouts. No test without lint.
During this completion batch, EVERY focused Vitest command also sets `VITEST_MAX_WORKERS=1`.
Each supervisor permits at most one simultaneous light gate across itself and its native units.
Concurrent focused suites created host memory pressure despite serial full gates. Coordinator
allocation controls heavy gates; any temporary light-gate hold is recorded on the board. Do not
interrupt a healthy existing run, kill a foreign process or weaken a test to relieve contention.
Use HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation for guard data only.
No ordinary source may depend on legacy. Do not share mutable dist/test-results/state across trees.
Frontend work and parity judgment use /ui; browser uses the prescribed playwright-cli playbook.
Do not regenerate a whole reference corpus to hide unexplained differences; attribute each change.
Retain logs locally without secrets and cite exact command, head, exit status and counts.

## Runtime safety and completion
Only R2 can perform HR admission/rehearsal/control steps and only through existing owning contracts.
Existing credentials are never printed or committed. Do not select/copy/replace a live database just
because it appears convenient; verify authority roots, locks, fingerprints and intended runtime.
4537 remains the sole permitted subject. Current date is Aug 30, not Aug 28: verify S7 from actual
clock and current live state, never fake the date or use historical availability as present proof.
The controlled order is ② UCPath filing → ① UCPath pending sweep → ③ Kuali finalization.
Every required operator gate remains. UNKNOWN always stops without retry.
The earlier brief's phrase "① Kuali reread" was incorrect; the owning phase plan governs.
Finish means tested/reviewed implementation, integrated commits, truthful documentation, and exact
worktree cleanup—not deleting unfinished work. Genuine operator/system blockers are reported, not
declared complete. R3/live-derived future obligations are not fabricated or silently executed.
