# Project profile — Phase 3 chronology refactor

**Repository:** `/Users/julianhein/Projects/hr-automation-rebuild`
**Coordination workspace:** `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/phase-3-chronology-c01a836a6`
**Coordination UUID:** `01a836a6-a417-444f-b789-ab8a11c3c2e3`
**Coordination short id:** `C01a836a6`
**Work key:** `phase-3-chronology`
**Coordinator title:** `Coordinate · phase-3-chronology · C01a836a6 · Refactor`
**Coordinator task/host:** task `01a06b20-5f0d-72d1-867b-ffbe98413cd4`; host unavailable
**Integration checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`
**Verified:** 2026-09-04 at `188e2137`

## Applicable instructions

- `/Users/julianhein/Projects/hr-automation-rebuild/AGENTS.md`
- Paired `/Users/julianhein/Projects/hr-automation-rebuild/CLAUDE.md`
- `/Users/julianhein/.agents/skills/coordinator/SKILL.md`
- `/Users/julianhein/.agents/skill-library/parallel-agent-work/REFERENCE.md`

## Canonical authorities

- Plan/status: `docs/roadmap/roadmap.md`; admitted phase docs under `docs/rebuild/`
- Specs/contracts: `docs/rebuild/reference/`
- Decisions: `docs/rebuild/reference/decisions.md`; `docs/decisions/phase-governance.md`
- Rules/lessons: root instructions; `docs/rebuild/reference/lessons.md`
- Other close targets: generated `docs/roadmap/index.html`; roadmap binding and UI tests

## Gates

- Unit: `npm run roadmap`; `npm run roadmap:check`; focused roadmap and architecture tests
- Integrated: `npm run typecheck`; `npm run lint`; `npm run test:coverage`; `npm run test:parity`
- Documentation/generated checks: `npm run build:manifest:check`; `npm run stores:catalog:check`; `npm run roadmap:check`

## Git and integration policy

- Branch/current-line policy: work directly on `master` for this operator-directed plan refactor
- Parallel isolation: none; no supervisor or worker dispatch is authorized
- Integration: direct local commits by logical category
- Commit and cleanup: stage explicit paths only; preserve unrelated dirty changes
- Remote writes: forbidden without explicit operator instruction

## Operations and constraints

- Pre-authorized: read-only repository inspection and roadmap rendering
- Requires operator authority: any real HR write; none is in scope
- Hard prohibitions: no remote push; no legacy runtime dependency; no destructive cleanup of foreign work

## Coordinator defaults

- Run sizing: one planning-authority refactor with bounded documentation/test seams
- Parallel supervisors: none
- Auxiliary worktree budget: four total; none reserved
- Artifact root override: none
- Final close: update only authorities whose phase naming, ownership, or chronology changed
