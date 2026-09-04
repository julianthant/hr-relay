# Board — Phase 3 chronology refactor

**Project profile:** `docs/coordinator/phase-3-chronology-c01a836a6/project-profile.md`
**Coordination UUID:** `01a836a6-a417-444f-b789-ab8a11c3c2e3`
**Work key:** `phase-3-chronology`
**Coordinator title:** `Coordinate · phase-3-chronology · C01a836a6 · Refactor`
**Coordinator task/host:** task `01a06b20-5f0d-72d1-867b-ffbe98413cd4`; host unavailable
**Coordinator checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`
**Integration target:** `master`
**Board owner:** coordinator
**Write rule:** coordinator only
**Last verified:** 2026-09-04 at `188e2137`

## Facts every run needs

- D326 changed the visible hierarchy but left lettered filenames and active 3c-A/3c-B prose.
- The final workflow authoring path already deleted Separations descriptor/module fragments before the old Phase 3.2 controlled-write close.
- The operator requires all code-changing and read-only acceptance work before an immutable candidate freeze; controlled writes follow in Phase 3.3.
- Existing dirty changes belong to another session and must be preserved.

## Decisions ratified

- 2026-09-04 · chat grill Q2–Q16 → exact candidate freeze; read-only proofs in 3.2; defects return to 3.2; grouped revalidation with an exact crosswalk; four-task controlled sequence; decimal filenames; active-authority refactor; historical decisions preserved and superseded.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| U01 | local | complete | `188e2137` | decimal docs + complete crosswalk | authority consistency passed | 03a/03d renamed; 03b/03c preserved under superseded history; new 3.2/3.3 authoritative |
| U02 | local | complete | `188e2137` | roadmap binding 17/17 | dependency correctness passed | Active references use the decimal hierarchy; historical labels remain only as explicit history |
| U03 | local | complete | `188e2137` | D329 in owner + pointer index | decision integrity passed | Earlier decisions preserved; D329 supersedes chronology/allocation only |
| U04 | local | complete | `188e2137` | generated/focused/integrated gates below | rendered UI inspected | Browser snapshot confirmed 3.2 → 3.3 → 3.4 and corrected header/guide copy |

## Gate evidence

| Gate | Result |
|---|---|
| `npm run roadmap && npm run roadmap:check` | pass; generated `index.html` fresh |
| manifest/catalog checks | pass |
| roadmap binding + legacy disposition | 32/32 pass |
| roadmap UI | 6/6 pass |
| `npm run typecheck` | pass |
| `npm run lint` | pass, zero warnings |
| `npm run test:coverage` | pass: 411 files / 5,019 tests; 85.71% statements, 76.71% branches, 89.54% functions, 87.66% lines |
| `npm run test:parity` | baseline failure: all sampled scenes report only stored descriptor-set hash `ff8c5fd…` versus current pre-existing D324-era hash `7cb1e184…`; no Phase 3 visual delta was re-frozen |

## Residue

- The four pre-existing deletions under `docs/coordinator/platform-authority-reset-cd8c37470/` remain unstaged and untouched.

## Questions for the operator

- None.
