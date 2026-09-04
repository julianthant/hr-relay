# Board — Phase 0.3 · Redesign single-source runtime authority

**Project profile:** `docs/coordinator/phase-0-3-authority-design-c31da5310/project-profile.md`
**Coordination UUID:** `31da5310-fb55-4982-ad02-05f4c9356d8b`
**Work key:** `phase-0-3-authority-design`
**Coordinator title:** `Coordinate · phase-0-3-authority-design · C31da5310 · phase 0.3`
**Coordinator session:** `e79f35c0-69ba-4518-b9bc-f90299de24ab`
**Coordinator checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`
**Integration target:** `master`
**Board owner:** coordinator
**Write rule:** coordinator only; supervisors and workers read only
**Last verified:** 2026-09-04 at `26c70b9b` (root tree dirty with a foreign session's uncommitted restructuring; untouched)

## Facts every run needs

- Authorities: profile §Canonical authorities. The primary run contract is ref dashboard-surfaces
  §D327 (line ~3195); the primary settings contract is ref clock-config-secrets §D327 (line ~464).
- Gates: profile §Gates — design runs use `roadmap` + `roadmap:check` + `typecheck` + `lint` +
  `test:architecture`; the coordinator runs `test:coverage` at integration.
- 0.3 is design-only (D326): no runtime code under `src/`, `tests/`, `scripts/`, `config/` changes.
  Design lands as normative prose in the owning reference spec, a `decisions.md` pointer in the same
  commit, ticked checkboxes in `docs/rebuild/00-design-the-foundation.md` §0.3, and the matching
  roadmap node `builds:`/`status:`/`log:` lines. Fixture roadmaps under
  `tests/unit/architecture/fixtures/roadmap-binding/` are guard fixtures, not plan.
- Strict order 0.3 → 1.6 → 2.6 → 3.1 → 3.2 → 3.3 → 3.4 (D326). Tasks 1 → 2 → 3 → 4 run sequentially
  (operator ruling 2026-09-04; no wave labels in §0.3).
- Reconciled inputs a design may not contradict: D308 (terminal-only deletion behind an insert-only
  tombstone), D321 (`.tracker` state root + database-journal coupling; its single-file layout is
  superseded by D327), D322 (explicit `cli storage backup` only; no cadence), D324 (probed host
  display stays a derived default), D301 (span files are never rewritten).
- Runtime marker `npm run cli -- phase` still prints `completedThrough: 2j` / `active: 3-workflow-migration`;
  D326 makes the plan authoritative for 0.3's start. Not a defect; do not "fix" it in 0.3.
- Root-checkout trap: the root working tree carries a foreign session's uncommitted rename of
  `docs/rebuild/03a–03d` → `03.1–03.4` and a roadmap rewrite. Supervisors work only in their
  worktree from HEAD `26c70b9b` (which still has `03a` names); never `git restore`, stage, or edit
  root files.

## Decisions ratified

- 2026-09-03 · D326 (`1df58a9b`) → decimal hierarchy; 0.3 is the earliest active part; design only.
- 2026-09-03 · D327 (`1df58a9b`) → one SQLite run-record lifecycle service; one settings catalog +
  protected `.tracker/settings/` root; provider API keys alone in `.env`.
- 2026-09-03 · D328 → parallel waves are `N-1`/`N-2` labels; §0.3 has none.
- 2026-09-04 · operator → dispatch one supervisor per 0.3 task, sequentially.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| U01 | R01 | reserved | — | — | domain/authority, adversarial concurrency | Task 1 · canonical run-record authority contract |
| U02 | R02 | planned | — | — | security/config | Task 2 · settings catalog + protected root contract |
| U03 | R03 | planned | — | — | migration/recovery | Task 3 · upgrade, compatibility, recovery design |
| U04 | R04 | planned | — | — | consequential | Task 4 · adversarial close + 1.6/2.6/3.1 briefs |

## Residue

- Prior coordinator workspace `docs/coordinator/platform-authority-reset-cd8c37470/` (incl. its
  handoff `handoffs/2026-09-03-phase-0-3-start.md`) is deleted-uncommitted by a foreign session.
  Consumed as input here; its disposition belongs to that session. Parked.

## Questions for the operator

- None at intake.
