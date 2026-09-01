# Board — separations completion

**Project profile:** docs/coordinator/separations-completion/project-profile.md
**Integration target:** master (via feature/03b-live-close, --no-ff)
**Board owner:** coordinator
**Write rule:** one writer; R1 supervisor authorized at run close only, this exact path
**Last verified:** 2026-08-31 at master 50adf8a9, clean, sole worktree, .env present

## Facts every run needs
- Separations stands 8/9 (doc 03b §Exit criteria); only criterion 5 is open — A2–A5 + A8.
- 4537 / `finalization-canary` is the SOLE registered subject (D284). 2026-08-28 S7 equality is
  historical; current S7/subject facts are unobserved.
- §9.32: the 2026-08-30 refusal was the assigned WORKTREE lacking `.env`. The primary checkout has
  `.env`; run there. Not a code defect.
- Order: ② UCPath filing → immediate ① pending sweep on ②'s new row → ③ Kuali finalization.
  One ALWAYS-GATE per write. No reRead after ②. UNKNOWN stops, never re-run.
- Gates: typecheck · lint · test:coverage · build:manifest clean · test:parity · roadmap:check ·
  git diff --check.

## Decisions ratified
- (none this workspace; D284/D287/D290–D293 pre-exist in their owners)

## Unit ledger
| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| u1 | R1 | briefed | — | — | — | admission + fresh 4537/S7 |
| u2 | R1 | briefed | — | — | — | rehearsal + 0/0/0 |
| u3 | R1 | briefed | — | — | — | ②①③, gated |
| u4 | R1 | briefed | — | — | — | A5 measurements |
| u5 | R1 | briefed | — | — | — | A8 close-out, merge |

## Residue
- Out of scope, already owned elsewhere: 4568/R3 (§9.29), storage-span visibility (Phase 4,
  dashboard-surfaces §9.8), Run-modal touch targets (Phase 4).

## Questions for the operator
- The run needs you live for the three ALWAYS-GATE approvals (and any STOP decision). Confirm a
  window before starting the supervisor.
