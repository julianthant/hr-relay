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
**Last verified:** 2026-09-04T20:55:56Z at R01 merge `ebc41c45863c9748f3cc48b23f2b9483fb748421`

## Facts every run needs

- Authorities and gates: `project-profile.md`; binding task seams and task-specific proofs: `docs/rebuild/01-build-the-spine.md` §1.6.
- Exact execution order: Task 1 → wave 2 (`2-1` ∥ `2-2`) → Task 3 → Task 4 → Task 5 → Task 6 → Task 7. No other pair is admitted as parallel.
- D330, D331, and D332 are fixed contracts. Contract changes return to a newly numbered 0.3 task; 1.6 does not redesign them.
- Every run preserves fail-loud behavior and updates tests; changes under a descriptor import closure require manifest regeneration/checking.
- Task 4's claimed/running cancel question is already settled as option A in the owning D330 sections and adds proof #27; it is not an open coordinator decision.
- Task 1's tombstone schema lives in `src/domain/run/deleted-run.ts`; doc 01's stale `authority.ts` location was corrected at `e1674420` without changing product scope.
- M3 allocation: Task 1 owns the direct database open/no-migrate half; Task 6 owns and re-runs the successful backup/doctor inspector and manifest half. This resolves the impossible cross-seam gate without moving any compatibility file into R01.
- Parity is inherited red at R01's exact base: 116 references differ only in the embedded descriptor hash after `dae04a11` changed the generated manifest subsequent to parity refreeze `7caa3fa9`. R01's range leaves the manifest, parity references, and fixture-day helper byte-unchanged, so the coordinator classified this as inherited evidence; Task 1 must not refreeze or alter the parity lane.

## Decisions ratified

- 2026-09-04 · operator launch instruction → one supervisor per admitted 1.6 task; only the explicitly named Task 2 wave runs concurrently → owner this run plan.
- 2026-09-04 · chat item 1 = A → Task 1 may edit dashboard composition solely to release its already-acquired process lock when authority opening refuses → owner `docs/rebuild/01-build-the-spine.md` §1.6 Task 1 at `a00be759`.
- 2026-09-04 · chat item 2 = A → every upgrade-journal append has an independent row identity; repeated `planned` rows remain evidence while terminal phases are unique per upgrade → owner `docs/rebuild/reference/dashboard-surfaces.md` §D332.5 and D332's decision pointer at `a00be759`.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| U01 · Task 1 schema floor | R01 | complete | `ebc41c45` (`--no-ff`) | integrated typecheck/lint/coverage/manifest green; focused 56/56 and combined 123/123 | consequential review finding fixed at `14c95b42` | Report `reports/r01.md`; worktree removed, branch deleted, exact task archived. |
| U02 · Task 2-1 run-record service | R02 | blocked on wave parity baseline | pending | pending | supervisor-owned consequential review | Dependency U01 is closed; dispatch remains paired with U03 from exact base `ebc41c45`. |
| U03 · Task 2-2 settings catalog/root | R03 | blocked on wave parity baseline | pending | inherited parity red before branch | supervisor-owned consequential review | Canonical gate requires parity green and byte-unchanged; operator ruling required before launch. |
| U04 · Task 3 runtime lifecycle writers | R04 | blocked on U02+U03 | pending | pending | supervisor-owned consequential review | Serial after both wave merges. |
| U05 · Task 4 operator run commands | R05 | blocked on U04 | pending | pending | supervisor-owned consequential review | Includes landed claimed-run cancel arm. |
| U06 · Task 5 settings consumers | R06 | blocked on U05 | pending | pending | supervisor-owned consequential review | Serial; shares composition roots with Task 3. |
| U07 · Task 6 upgrade/recovery proof | R07 | blocked on U05+U06 | pending | pending | supervisor-owned consequential review | Includes operator-root backup/upgrade evidence. |
| U08 · Task 7 foundation close | R08 | blocked on U07 | pending | pending | adversarial authority review required | Includes live dry-run and canonical handoff evidence. |

## Residue

- R01's two pre-implementation authority contradictions were ratified at `a00be759`; no open residue remains from that stop.
- The inherited descriptor-hash parity drift remains repository residue for an owning later task; it does not authorize R01 to change parity artifacts.
- Wave 2 cannot satisfy the canonical green-and-unchanged parity invariant from base `ebc41c45` until the operator chooses whether to restore the baseline through a newly admitted authority-repair run or amend the task gate.

## Questions for the operator

- Choose the authority path for the inherited descriptor-hash parity drift before the paired R02/R03 launch.
