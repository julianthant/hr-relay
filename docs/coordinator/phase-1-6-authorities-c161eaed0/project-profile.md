# Project profile — Phase 1.6 canonical run and settings authorities

**Repository:** `/Users/julianhein/Projects/hr-automation-rebuild`
**Coordination workspace:** `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/phase-1-6-authorities-c161eaed0`
**Coordination UUID:** `161eaed0-8809-4a38-b11b-fcd85b727f86`
**Coordination short id:** `C161eaed0`
**Work key:** `phase-1-6-authorities`
**Coordinator title:** `Coordinate · phase-1-6-authorities · C161eaed0 · Phase 1.6`
**Coordinator task/host:** `01a06d9c-1667-7451-a022-5f661d373703` / `local`
**Integration checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`
**Verified:** 2026-09-04T18:10:12Z at `9201b025ad1582fabc3c3fdf7f20a1a8cac9ae18`

## Applicable instructions

- `/Users/julianhein/Projects/hr-automation-rebuild/AGENTS.md` and its byte-identical `CLAUDE.md` twin — repository scope.
- `/Users/julianhein/.agents/skills/coordinator/SKILL.md` — coordinator lifecycle.
- `/Users/julianhein/.agents/skill-library/parallel-agent-work/REFERENCE.md` — supervisor/worktree ledger, integration, cleanup, and exact progress footer.
- Supervisors invoke `/supervise`; their worker tree is limited to native `sup_scout`, `sup_analyst`, `sup_luna`, and `sup_terra` roles under the repository rules.

## Canonical authorities

- Plan/status: `docs/roadmap/roadmap.md` §1.6 and `docs/rebuild/01-build-the-spine.md` §1.6; runtime snapshot from `npm run cli -- phase` is `completedThrough=2j`, `active=3-workflow-migration` at intake.
- Specs/contracts: `docs/rebuild/reference/dashboard-surfaces.md` D330 and D332; `docs/rebuild/reference/clock-config-secrets.md` D331 and D332.S; `docs/rebuild/reference/guards-and-tests.md` §5.2; plus the task-specific references cited by doc 01 §1.6.
- Decisions: `docs/rebuild/reference/decisions.md` (pointer index; D330–D332 are owned by the specs above).
- Rules/lessons: root `AGENTS.md`/`CLAUDE.md`; `docs/rebuild/reference/lessons.md`; nearest module instruction files encountered by a run.
- Other close targets: `docs/rebuild/guard-inventory.json`, generated build manifest, stores catalog, the Task 7 handoff recorded in doc 01 §1.6, and only canonical docs whose verified truth changes.

## Gates

- Unit base: `npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check`.
- Integrated: the unit base gate after each `--no-ff` merge; every run also executes the task-specific proof and deletion-test gate from doc 01 §1.6.
- Documentation/generated checks: `npm run roadmap && npm run roadmap:check` after roadmap source changes; `npm run stores:catalog:check` when the task changes its source; Task 7 additionally runs parity, architecture, storage doctor, the two named T1b dry-run manifests, and adversarial review exactly as doc 01 §1.6 specifies.

## Git and integration policy

- Branch/current-line policy: `master` is the integration-only line; each supervisor owns `feature/phase-1-6-authorities-c161eaed0-r<nn>-<slug>` from the recorded integrated predecessor. Task 2-1 and 2-2 alone share the post-Task-1 base.
- Parallel isolation: a distinct Codex worktree and branch for every supervisor; writable workers receive distinct worktrees and ledger rows within their supervisor allowance.
- Integration: coordinator verifies and merges each supervisor branch with `git merge --no-ff` in recorded order; Tasks 2-1 then 2-2 are integrated deterministically after both parallel peers return.
- Commit and cleanup: explicit-path staging only; logical local commits as work proceeds; after verified integration and green gates, remove each registered worktree, delete its local branch, release reservations, and archive its exact Codex task.
- Remote writes: forbidden without explicit operator instruction.

## Operations and constraints

- Pre-authorized: read-only inspection; project gates; live selector/login verification; dry-run workflow verification with `dryRun=true`; Duo Autopilot; Task 6's explicit verified storage backup and stopped-system storage upgrade on the operator root because doc 01 §1.6 makes them task acceptance evidence.
- Requires operator authority: real HR writes, remote pushes, destructive action outside an exact admitted task, scope/product-truth changes, conflicting rules, or history-moving git.
- Hard prohibitions: no legacy runtime dependency; no silent fallback; no second authority; no parallelism outside the explicit Task 2 wave; no supervisor writes to `board.md` or merges to `master`.

## Coordinator defaults

- Run sizing: repository override — every numbered 1.6 task is exactly one supervisor run and one bounded seam.
- Parallel supervisors: Task 2-1 and Task 2-2 only; every other run is serial.
- Auxiliary worktree budget: four total, excluding the primary checkout. A serial supervisor receives allowance 4; each Task 2 peer receives allowance 2.
- Artifact root override: none; coordination artifacts stay under this workspace.
- Final close: update only the canonical authorities listed above whose truth changed.
