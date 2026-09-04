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
**Last verified:** 2026-09-04 at `436bf4a8` (root tree: only the foreign session's four uncommitted deletions of the old `platform-authority-reset-cd8c37470` workspace remain; untouched)

## Facts every run needs

- Authorities: profile §Canonical authorities. The primary run contract is now **D330** = ref
  dashboard-surfaces §D327 → §D330.1–§D330.12 (merged `1a04d565`); the primary settings contract is
  ref clock-config-secrets §D327 (line ~464), to be written by R02.
- Decision numbering: master holds D1–D330. D329 is the foreign Phase 3 chronology decision
  (`188e2137`), NOT the run-record contract; R01 renumbered after a collision. Every minting commit
  must prove the next number free against `master` in the same command.
- The foreign restructuring landed on master (`188e2137`, `132003c1`): phase docs are now
  `03.1`–`03.4`, the old `03a`–`03d` names are history, and `legacy-capability-disposition` is green.
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
- 2026-09-04 · D330 (`1a04d565`, round 136) → the run-record lifecycle service contract: identity
  tuple, three-way existence, seven-state machine, version CAS + claim fence, closed operation set with
  wire mapping, total queue order with one-transaction claim, retry/restart/relaunch lineages,
  archive/purge/delete with D308 verbatim, evidence linkage, adapter boundary, 26 proofs for 1.6.
  Coordinator accepted the D268 partial supersession, `runs_view` retirement as a state read, and the
  gate-records-leave-with-the-run ruling as applications of D327's letter.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| U01 | R01 | closed | merge `1a04d565` (--no-ff, branch head `e953de9d`, 8 commits from `26c70b9b`) + reconcile `436bf4a8`; worktree removed, branch deleted, session `d02757ca` stopped | integrated: roadmap:check fresh · typecheck 0 · lint 0 · test:coverage 411/411 files, 5019 tests (exit 0) | supervisor + sup-analyst adversarial review, 15 scenarios, 8 holes fixed in `9bdcf667` | report `reports/r01.md`; D329→D330 renumber `e953de9d` |
| U02 | R02 | reserved | — | — | security/config | Task 2 · settings catalog + protected root contract |
| U03 | R03 | planned | — | — | migration/recovery | Task 3 · upgrade, compatibility, recovery design |
| U04 | R04 | planned | — | — | consequential | Task 4 · adversarial close + 1.6/2.6/3.1 briefs |

## Residue

- R01 → R02: claim runtime token (`generation`, `settingsRevision`, `settingsFingerprint`,
  `configFingerprint`) keeps its shape; R02 owns its provenance. dashboard-surfaces §2.1
  `.tracker-rebuild/` wording stale post-D321.
- R01 → R03: pre-1.6 tombstones lack `itemId`/`attempt`/`runNumber` (migration seeds the ordinal
  watermark); `authority-unknown` re-admission after restore; §2.5 item 6 "park external writes" on
  runs the service calls `absent`; §2.5 items 3–4 still carry the D322-retired backup cadence inline;
  schema additions (`checkpoint_payloads` trigger + tally column; `deleted_runs` three columns).
- R01 → R04: §D330.11's 26 proofs 1.6 owes; group/tree path unexercised as-built (every enqueue
  stamps `shape: "single"`); two projector outcome enums disagree on `skipped`
  (`run-queue-projection.ts:110` vs `:133`, unowned); `remove-queue-surface` /
  `tombstone-queue-surface` wire events have no producer.

- Prior coordinator workspace `docs/coordinator/platform-authority-reset-cd8c37470/` (incl. its
  handoff `handoffs/2026-09-03-phase-0-3-start.md`) is deleted-uncommitted by a foreign session.
  Consumed as input here; its disposition belongs to that session. Parked.

## Questions for the operator

- None at intake.
