# Board — Phase 1.6 canonical run and settings authorities

**Project profile:** `docs/coordinator/phase-1-6-authorities-c161eaed0/project-profile.md`
**Coordination UUID:** `161eaed0-8809-4a38-b11b-fcd85b727f86`
**Work key:** `phase-1-6-authorities`
**Coordinator title:** `Coordinate · phase-1-6-authorities · C161eaed0 · Phase 1.6`
**Coordinator task/host:** `01a06d9c-1667-7451-a022-5f661d373703` / `local`
**Coordinator checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`
**Integration target:** `master`
**Board owner:** coordinator
**Write rule:** coordinator only; supervisors and workers read only
**Last verified:** 2026-09-04T18:47:17Z at authority-ratification commit `a00be7591c1a801b27d84c7b43c8a6f1708068ed`

## Facts every run needs

- Authorities and gates: `project-profile.md`; binding task seams and task-specific proofs: `docs/rebuild/01-build-the-spine.md` §1.6.
- Exact execution order: Task 1 → wave 2 (`2-1` ∥ `2-2`) → Task 3 → Task 4 → Task 5 → Task 6 → Task 7. No other pair is admitted as parallel.
- D330, D331, and D332 are fixed contracts. Contract changes return to a newly numbered 0.3 task; 1.6 does not redesign them.
- Every run preserves fail-loud behavior and updates tests; changes under a descriptor import closure require manifest regeneration/checking.
- Task 4's claimed/running cancel question is already settled as option A in the owning D330 sections and adds proof #27; it is not an open coordinator decision.
- Task 1's tombstone schema lives in `src/domain/run/deleted-run.ts`; doc 01's stale `authority.ts` location was corrected at `e1674420` without changing product scope.

## Decisions ratified

- 2026-09-04 · operator launch instruction → one supervisor per admitted 1.6 task; only the explicitly named Task 2 wave runs concurrently → owner this run plan.
- 2026-09-04 · chat item 1 = A → Task 1 may edit dashboard composition solely to release its already-acquired process lock when authority opening refuses → owner `docs/rebuild/01-build-the-spine.md` §1.6 Task 1 at `a00be759`.
- 2026-09-04 · chat item 2 = A → every upgrade-journal append has an independent row identity; repeated `planned` rows remain evidence while terminal phases are unique per upgrade → owner `docs/rebuild/reference/dashboard-surfaces.md` §D332.5 and D332's decision pointer at `a00be759`.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| U01 · Task 1 schema floor | R01 | active | pending | pending | supervisor-owned consequential review | Operator chose 1A/2A; owning authorities ratified at `a00be759`; supervisor cleared to resume. |
| U02 · Task 2-1 run-record service | R02 | blocked on U01 | pending | pending | supervisor-owned consequential review | Wave 2 peer 1. |
| U03 · Task 2-2 settings catalog/root | R03 | blocked on U01 | pending | pending | supervisor-owned consequential review | Wave 2 peer 2. |
| U04 · Task 3 runtime lifecycle writers | R04 | blocked on U02+U03 | pending | pending | supervisor-owned consequential review | Serial after both wave merges. |
| U05 · Task 4 operator run commands | R05 | blocked on U04 | pending | pending | supervisor-owned consequential review | Includes landed claimed-run cancel arm. |
| U06 · Task 5 settings consumers | R06 | blocked on U05 | pending | pending | supervisor-owned consequential review | Serial; shares composition roots with Task 3. |
| U07 · Task 6 upgrade/recovery proof | R07 | blocked on U05+U06 | pending | pending | supervisor-owned consequential review | Includes operator-root backup/upgrade evidence. |
| U08 · Task 7 foundation close | R08 | blocked on U07 | pending | pending | adversarial authority review required | Includes live dry-run and canonical handoff evidence. |

## Residue

- R01's two pre-implementation authority contradictions were ratified at `a00be759`; no open residue remains from that stop.

## Questions for the operator

- None.
