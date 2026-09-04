# Board — Phase 0.3 · Redesign single-source runtime authority — CLOSED 2026-09-04

**Project profile:** `docs/coordinator/phase-0-3-authority-design-c31da5310/project-profile.md`
**Coordination UUID:** `31da5310-fb55-4982-ad02-05f4c9356d8b`
**Work key:** `phase-0-3-authority-design`
**Coordinator title:** `Coordinate · phase-0-3-authority-design · C31da5310 · phase 0.3`
**Coordinator session:** `e79f35c0-69ba-4518-b9bc-f90299de24ab`
**Coordinator checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`
**Integration target:** `master`
**Board owner:** coordinator
**Write rule:** coordinator only; supervisors and workers read only
**Last verified:** 2026-09-04 at `287ae52f` (root tree clean; no auxiliary worktrees, no `feature/*` branches, no supervisor sessions)
**Board state:** CLOSED — every run integrated and closed; Phase 0.3 done in the plan (`287ae52f`); the runtime marker still reports `completedThrough: 2j` by design until 1.6 implements (D326)

## Facts every run needs

- Authorities: profile §Canonical authorities. The primary run contract is now **D330** = ref
  dashboard-surfaces §D327 → §D330.1–§D330.12 (merged `1a04d565`); the primary settings contract is
  **D331** = ref clock-config-secrets §D327 → §D331.1–§D331.12 (merged `63f6da4f`); the
  migration/recovery contract is **D332** = ref dashboard-surfaces §2.5 (upgrade command, preflight,
  journal, rollback, boot matrix, preservation, adapter policy), its settings half in
  clock-config-secrets, and §5.2 adapter roster A0–A8 + deletion tests in guards-and-tests (merged
  `ff4e08b9`).
- Decision numbering: master holds D1–D332 (D333 next). R04 minted none; its cancel ruling is a dated amendment inside D330. D329 is the foreign Phase 3 chronology decision
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
- 2026-09-04 · D331 (`63f6da4f`, round 137) → the settings catalog and protected root contract:
  closed catalog (88 rows frozen), five source classes with one authority each, `.tracker/settings/`
  root layout/permissions, revision + journal coupling, one update command family (two arms),
  write-only protected values with presence/revision readback, restart scope and the D330 claim
  token's provenance, one-source precedence, 3.1 edit contract, 40 proofs for 1.6. Coordinator
  accepted: roster URL + D288 pseudonym pair as `protected-store`; `personLookupCanaryEid` as the
  class's second member (already as-built in `src/domain/secrets.ts`; dated note scopes D300 to
  Separations); protected revision outside the claim token. `SETTINGS_SCHEMA_HASH` rewrite routed
  to R03.
- 2026-09-04 · D332 (`ff4e08b9`) → the authority upgrade: one command with explicit D322 backup
  prerequisite, preflight under D181 admission, transactional journal (`authority_upgrades`) with
  rollback and mixed-generation/downgrade refusal, boot matrix, evidence/identity preservation, the
  `.env`/`settings.json`/canary import with tie-break and `migrated-refused` first boot, adapter
  roster A0–A8 with expiry phases and red-capable deletion tests, 24 proofs for 1.6. Coordinator
  accepted: the `baseline` journal row at D321 regeneration; the journaled orphaned gate-record sweep
  for pre-floor tombstones (D308/§D330.9); adapter expiry phases as set (re-slot only by naming the
  owning deletion-test task).
- 2026-09-04 · coordinator ruling (R04 NEEDS COORDINATOR item 1, landed `faa205b8`, merged `5dcdd112`) →
  operator `cancel` of a claimed/validating/running run is a REQUEST (`cancelRequested` self-edge under
  version CAS; the worker settles `terminal/cancelled` through `terminalize` under its claim fence at its
  next non-fenced boundary; `cancelling` served status; §D330.11 #27). Authority: the 2026-08-25
  fenced-write lesson and §D330.4 forbid a direct terminal write over a fenced row; the queue's cancel verb
  stays. Operator may overturn; 1.6 Task 4 owns the implementation.
- 2026-09-04 · R04 wave ruling (doc 01 §1.6, roadmap `5dcdd112`) → 1.6 is Task 1 schema floor (serial),
  wave `2-1` run-record service / `2-2` settings catalog+root (independent only after the floor), then
  serial Tasks 3–7. Tasks 3 and 5 share composition roots and are never a wave.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| U01 | R01 | closed | merge `1a04d565` (--no-ff, branch head `e953de9d`, 8 commits from `26c70b9b`) + reconcile `436bf4a8`; worktree removed, branch deleted, session `d02757ca` stopped | integrated: roadmap:check fresh · typecheck 0 · lint 0 · test:coverage 411/411 files, 5019 tests (exit 0) | supervisor + sup-analyst adversarial review, 15 scenarios, 8 holes fixed in `9bdcf667` | report `reports/r01.md`; D329→D330 renumber `e953de9d` |
| U02 | R02 | closed | merge `63f6da4f` (--no-ff, branch head `fa160fbf`, 8 commits from `da870d2d`) + reconcile `629a166a`; worktree removed, branch deleted, session `3700aeea` stopped | integrated: roadmap:check fresh · typecheck 0 · lint 0 · test:coverage 411/411 files, 5019 tests (exit 0) | supervisor + sup-analyst adversarial review, 23 findings, 6 blockers + 11 should-fix closed in `6c10b57f` | report `reports/r02.md`; research under `research/r02-*.md`; lesson in ref lessons (`7869ad1e`) |
| U03 | R03 | closed | merge `ff4e08b9` (--no-ff, branch head `c103cf0d`, 9 commits from `d346349f` incl. one worker merge `98d9cf69`) + reconcile `df486f7a`; worktree removed, branch deleted, worker worktree/branch already gone, session `1c0e3c45` stopped | integrated: roadmap:check fresh · typecheck 0 · lint 0 · test:coverage 411/411 files, 5019 tests (exit 0; first attempt killed by host low memory, re-run green) | supervisor + sup-analyst adversarial review, 18 scenarios, 6 blockers + 10 should-fix closed in `14c5377f` | report `reports/r03.md`; lesson in ref lessons (`8718190b`) |
| U04 | R04 | closed | merge `5dcdd112` (--no-ff, branch head `36abda8f`, 14 commits from `98037ef7` incl. one worker merge `5acbabec`) + reconcile `287ae52f`; worktree removed, branch deleted, session `43613407` stopped | integrated: roadmap:check fresh · typecheck 0 · lint 0 · test:coverage 411/411 files, 5019 tests (exit 0) | sup-analyst cross-contract review, 12 scenarios, 12/12 closed in `16569461` + `faa205b8` | report `reports/r04.md`; 1.6 bound in doc 01 §1.6 (95 proofs, deletion tests, serial floor + wave 2-1/2-2); 2.6/3.1 consumption notes `661149e5`/`699de307`; CLAUDE.md/AGENTS.md name D330–D332 (`95004f52`) |

## Residue

- Every R01–R03 residue row was dispositioned by R04 (`reports/r04.md` §Resolved-decisions checklist,
  38 rows, each `resolved at <doc §>` or bound to a 1.6/2.6 task). Nothing is open before 1.6.
- Handed to the **Phase 1.6 coordinator** (`reports/r04.md` §Residue for the 1.6 coordinator): the
  floor's base SHA and both wave worktrees go in the 1.6 run plan before `2-1`/`2-2` dispatch; Task
  `2-1` may be split into units inside one session, never into another numbered task; proof totals
  §D330.11 27 · §D331.11 41 · §D332.11 27 = 95 rows plus the §5.2 unit test and six inventory entries;
  an optional 2.6 Task 5 docs item adds D330–D332 pointers to ref operator-trust /
  frontend-backend-integration / data-intake-and-edit-data.
- Operator-visible after 1.6 (by design, §D331.8): the first post-upgrade boot refuses
  `migrated-refused { key }` until the listed `.env` lines are removed.
- Prior coordinator workspace `platform-authority-reset-cd8c37470/`: RESOLVED — deleted by the foreign
  session at `f1ab64c9`.
- Handoffs in this workspace: none were created (every run closed successfully).

## Questions for the operator

- None blocking. One overridable ruling: the cancel-of-a-claimed-run request model (Decisions ratified,
  2026-09-04 coordinator ruling). Overturning it before 1.6 Task 4 costs one dated amendment in §D330.5/§D330.3/§D330.11.
