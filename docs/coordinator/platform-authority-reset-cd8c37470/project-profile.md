# Project profile — platform authority reset

**Repository:** `/Users/julianhein/Projects/hr-automation-rebuild`
**Coordination workspace:** `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/platform-authority-reset-cd8c37470`
**Coordination UUID / short id:** `d8c37470-550f-4093-80dd-139763304d77` / `Cd8c37470`
**Work key:** `platform-authority-reset`
**Coordinator title:** `Coordinate · platform-authority-reset · Cd8c37470 · phases 0–3`
**Coordinator task/host:** `01a06ade-e8da-7f91-9e45-bf1fcc12175a` / `local`
**Integration checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`
**Verified:** 2026-09-03 before the planning commit

## Applicable instructions

- Root `AGENTS.md` and its byte-identical `CLAUDE.md` twin.
- `/Users/julianhein/.agents/skills/coordinator/SKILL.md`.
- `/Users/julianhein/.agents/skill-library/parallel-agent-work/REFERENCE.md` for any parallel run.

## Canonical authorities

- Plan/status: `docs/roadmap/roadmap.md`; phase docs `docs/rebuild/00-design-the-foundation.md`
  through `docs/rebuild/03d-co-operate-with-claude.md`.
- Run/settings contracts: `docs/rebuild/reference/dashboard-surfaces.md`,
  `clock-config-secrets.md`, `frontend-backend-integration.md`, `workflow-model.md`,
  `execution-and-sessions.md`, `operator-trust.md`, and `guards-and-tests.md`.
- Decisions: `docs/rebuild/reference/decisions.md` with context in
  `docs/decisions/phase-governance.md`.
- Rules/lessons: root instruction twins and `docs/rebuild/reference/lessons.md`.
- Generated close target: `docs/roadmap/index.html`.

## Gates

- Planning/design: `npm run roadmap`, `npm run roadmap:check`, relevant roadmap/document
  architecture tests, then `npm run lint`.
- Implementation per commit: `npm run typecheck && npm run lint && npm run test:coverage`.
- Dashboard changes: `npm run test:parity`.
- Generated as affected: `npm run build:manifest:check`, `npm run stores:catalog:check`.

## Git and integration policy

- Local `master` is the integration line; never push without explicit operator instruction.
- Every writable parallel run needs a distinct `feature/<work-key>-...` branch, registered worktree,
  exact scope/gate, and recorded integration order before dispatch.
- Integrate verified branches with `--no-ff`; stage explicit paths only; sweep every worktree,
  branch, reservation, and separate Codex task after integration.

## Operations and constraints

- Pre-authorized: read-only live verification and dry-run workflows under repository rules.
- Requires operator authority: real writes and remote pushes.
- Hard prohibitions: no legacy runtime dependency, silent fallback, raw run/settings mutation outside
  canonical authority, automatic backup cadence, secret-value readback, or ambient dispatch.

## Coordinator defaults

- One numbered roadmap task per supervisor session; supervisor owns central judgment and splits only
  bounded seams to native Luna/Terra workers under `/supervise` rules.
- Start at Phase 0.3 Task 1; Task 2 is parallel-capable only after isolation is recorded.
- Auxiliary worktree budget: four, excluding integration checkout.
- Final close: update only authorities whose truth changed.
