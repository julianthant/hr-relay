# Handoff — direct supervisor workflow

Date: 2026-09-04. Resume only the pending repository validation/commit.
Cleanup owner: resuming task. Remove this file after the scoped commit is verified.

The user coordinates and assigns one roadmap task. The supervisor implements, verifies,
commits/integrates, updates that task's owning phase and roadmap, and stops. Apply to Codex and
Claude; no agent coordinator or separate coordination paperwork for new direct assignments.

## Verified state

Repository: /Users/julianhein/Projects/hr-automation-rebuild; branch: master; HEAD: 77b5952e9a952be647f24ad02fbc8051626e09a3.
Only the primary worktree is registered. This task created no workers/worktrees or commits.
Personal supervisor skills and parallel-agent-work references are updated on both platforms.
Their shared direct-assignment instructions match; native role policies and both skill validators
pass. Prior coordinated-run instructions remain in each skill's references/coordinated-runs.md,
loaded only for explicitly continued coordinated work. Evaluation cases 13–14 were added on both
platforms but not executed. Previous Claude skill/reference backups are under
/Users/julianhein/.config/skill-sync/archive/20260905T000853Z/claude.

The following exact repository changes are staged for this task:

.agents/skill-library/repository-work/REFERENCE.md
AGENTS.md
CLAUDE.md
docs/rebuild/01-build-the-spine.md
docs/rebuild/reference/decisions.md
docs/roadmap/roadmap.md

Only the nine-line Direct roadmap assignments addition in each root instruction file is ours.
Their broader unstaged rewrites, nested instructions, and coordination/status-file deletions belong
to another session. Preserve them; never stage the complete root files over the scoped index.
The roadmap change is governance-only; generation leaves index.html unchanged.

## Gate and resume boundary

Passed: typecheck, lint, roadmap generation/check, diff whitespace, instruction-twin equality,
Codex/Claude quick_validate.py and both check-role-policy.py commands.
Full npm run test:coverage was stopped after known failures, not completed. Its log is
/tmp/hr-supervisor-direct-coverage.log. Failures observed:
- Environment inventory ENOENT for deleted docs/coordinator/execute-phase-1-6-from-c858cc3dc/evidence/r01/m21-control-neutralized.config.ts.
- flow-type-budget: reported check time 9.45s exceeds the existing 5s limit.
- dashboard/takeover-frame-focus: dirty native popstate route was not restored before confirmation.
Another session was running a separate coverage command; do not stop or modify that session.
This task's owned coverage process tree was terminated. No gate was weakened.

Verify git status, staged diff, HEAD, twin equality, and worktree list first. Once the shared
checkout is ready, run npm run typecheck && npm run lint && npm run test:coverage, plus
npm run roadmap:check. Resolve only failures owned by this change; preserve concurrent edits.
Then commit only the six scoped staged paths after rechecking index ownership. Do not push.
The normative policy is docs/roadmap/roadmap.md §Direct supervisor assignments; the decision pointer
and Phase 1.6/operating/root read triggers are staged with it. Do not start task 1.6.1 or any
other roadmap task: its number was an example, not an implementation assignment.
