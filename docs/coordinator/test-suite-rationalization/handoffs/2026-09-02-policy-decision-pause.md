# Handoff — test-suite rationalization policy-decision pause

**Date:** 2026-09-02
**Paused at:** Wave 1 R1/R6 supervisors are running read-only audit and evidence work; integration of deletions, consolidations, or trigger-policy changes is blocked on decision-sheet items 1–8.
**Cleanup owner:** test-suite-rationalization coordinator
**Remove when:** operator answers are decoded and ratified, the board/run plan carry the resulting admission, exact Wave 1 task identities are reconciled, and no recovery action depends on this pause record.

## Task summary

Coordinate the entire current test estate rationalization through seven isolated supervisor runs. The operator clarified that finished lint/type/test/architecture/generated gates must be self-contained in this repository; the legacy checkout may be read only while freezing referenced facts with provenance. The operator then invoked `/decision-brief`, so the eight policy choices in the exact sheet below are open and must not be inferred from recommendations or silence.

## Plan and shared state

- Plan: `docs/coordinator/test-suite-rationalization/run-plan.md`
- Coordinator project profile: `docs/coordinator/test-suite-rationalization/project-profile.md`
- Coordinator board: `docs/coordinator/test-suite-rationalization/board.md`, verified SHA-256 `7807242783431d4585eff473f9e36ec4637ab90ffcd334e0cb47efe299bf4198` at commit `92dc95ee`
- Open decisions: `docs/coordinator/test-suite-rationalization/decisions/2026-09-02-test-suite-policy.md`, items 1–8
- Owning test contract: `docs/rebuild/reference/guards-and-tests.md`; paired root/scenario instructions and decision pointer reconcile in R7 after answers and verified runs.

## Current state (verified, not remembered)

- Repository / branch: `/Users/julianhein/.codex/worktrees/f14c/hr-automation-rebuild` / `feature/test-suite-rationalization`
- Base: current `feature/03b-live-close` intake `12ae781b`; coordinator kickoff `7982650c`
- Coordinator commits ahead: `7982650c` kickoff, `034d9262` Wave 1 dispatch ledger, `92dc95ee` pending policy sheet
- Coordinator uncommitted state before this handoff: clean
- R1 worktree: `/Users/julianhein/.codex/worktrees/eb84/hr-automation-rebuild` / `feature/test-r1-architecture-static`; dirty supervisor-owned edits in `package.json`, `vitest.config.ts`, `gate-coverage.test.ts`, `guard-manifest.test.ts`; no run commit yet.
- R1 u02 worker: `/Users/julianhein/.codex/worktrees/eb84-r1-u02-self-contained` / `feature/test-r1-u02-self-contained`; dirty worker-owned self-contained provenance/helper/test edits and new frozen provenance files; no commit yet.
- R6 worktree: `/Users/julianhein/.codex/worktrees/b4ef/hr-automation-rebuild` / `feature/test-r6-parity-checks`; clean at `7982650c` at pause verification.
- Other listed worktrees/branches belong to concurrent Phase 3/session-panel work and are outside this project's cleanup ownership.

## Progress

- [x] Kickoff profile, board, seven-run plan, exact briefs, and intake evidence — commit `7982650c`.
- [x] Wave 1 R1/R6 dispatched as separate Codex worktrees — client setup ids recorded in run plan; exact branches/worktrees verified.
- [x] Self-contained-repository directive recorded in board/profile/briefs.
- [x] Eight-item operator decision sheet persisted and linked — commit `92dc95ee`.
- [ ] Decode and ratify operator answers ← resume here. Leave unanswered items open.
- [ ] Reconcile canonical R1/R6 task ids. `list_threads` had not yet exposed their exact titles although the worktrees and R1 worker were active; do not pass client ids to thread tools or guess ids.
- [ ] Relay answer-derived scope to exact supervisor tasks, receive/verify Wave 1, then proceed through Waves 2–3 and serial R7.

## Open questions / deferred decisions

- Items 1–8 in `decisions/2026-09-02-test-suite-policy.md`: success measure, duplicate definition, deletion proof, directory structure, scenario scope, trigger policy, runtime budget, naming/file boundaries.
- No deletion/consolidation or trigger-policy change may be integrated until applicable answers arrive. Inventory, mapping, and negative-control evidence may continue.

## Verification before resuming

```bash
git status --short --branch
git branch --show-current
git log --oneline 12ae781b..HEAD
git worktree list --porcelain
git branch --list 'feature/test-*' -vv
shasum -a 256 docs/coordinator/test-suite-rationalization/board.md
```

Then re-read the project profile, board, run plan, decision sheet, and exact Wave 1 reports/artifacts if they exist. Use `list_threads` to reconcile each setup id only against one unique project/title/worktree/branch/report match.

## Pointers

- Read first: root `AGENTS.md`/`CLAUDE.md`, coordinator skill, project profile, board, run plan, decision sheet.
- Intake proof: `docs/coordinator/test-suite-rationalization/evidence/intake-2026-09-02.md`.
- Wave briefs: `briefs/r1-architecture-static.md` and `briefs/r6-parity-checks.md`.

## Suggested skills

- `/coordinator` — resume in `decide`, then `receive/plan/dispatch` modes.
- `/decision-brief` — decode positional answers and ratify only answered items.
- `/worktree-sweep` — after verified run integrations, never against unrelated retained worktrees.
