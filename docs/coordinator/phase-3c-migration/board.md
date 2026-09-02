# Board — Phase 3c workflow migration

**Project profile:** `project-profile.md`
**Integration target:** `feature/03c-workflow-migration` at base `414d77b810f713d5813c79035fd38064ba04e73c`
**Board owner:** coordinator
**Write rule:** coordinator only; supervisors and workers read only
**Last verified:** 2026-09-02 15:46 PDT at `414d77b810f713d5813c79035fd38064ba04e73c`

## Facts every run needs

- Local `master` merged `feature/03b-live-close` with `--no-ff` at `414d77b8`; no remote push occurred.
- Phase 3b's R4e/R4f controlled-live proof remains open and is not a Phase 3c completion claim.
- D311's recipe/compiler seam is the plan-owned prerequisite to orders 1–7 and 9. Person lookup and separations are its exact equivalence fixtures.
- Orders retain the risk/reuse sequence 1, 2, 3, 4, 5, 6, 7, 9. No later order begins implementation before its declared predecessor is integrated unless the plan marks the work cross-cutting and the paths/authority are disjoint.
- The phase owns thirteen remaining workflow migrations, 47 open legacy capabilities at the recorded baseline, generic recipe/dashboard conformance, per-workflow T1, and T2/T3 only for genuinely new UI behavior.
- Live reads and dry runs are pre-authorized. Every actual external write still needs an exact operator-approved target/disposition.
- The operator's separate `codex/session-panel` worktree is out of scope; avoid that seam and its parity states.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| u01–u06 | R1 | briefed | — | — | required | D311 compiler, two conversions, projections, conformance/deletion, order-0 T1 |
| u10–u12 | R2 | briefed | — | — | required | Order 1 migration intake and live/provenance discovery only |
| u20–u24 | R3 | blocked on R1+R2 | — | — | required | Order 1 implementation and proof |
| u30–u35 | R4 | planned | — | — | required | Order 2 downloads + viewer |
| u40–u44 | R5 | planned | — | — | required | Order 3 OCR pipeline + Review capability |
| u50–u54 | R6 | planned | — | — | required | Order 4 OCR fan-out/light writes |
| u60–u64 | R7 | planned | — | — | required | Order 5 I-9 check + workbook projection/export |
| u70–u74 | R8 | planned | — | — | required | Order 6 work-study + Kronos pay rule |
| u80–u84 | R9 | planned | — | — | required | Order 7 oath upload + OnBase |
| u90–u94 | R10 | planned | — | — | required | Order 9 onboarding |
| u100–u105 | R11 | planned | — | — | required | remaining cross-cutting capability closure and zero-open audit |

## Residue

- Separations R4e/R4f controlled-live proof → `docs/coordinator/separations-completion/`; preserved, not absorbed into this board.
- Session panel → external operator-dispatched `codex/session-panel` worktree; receive separately before any overlapping UI integration.
- ServiceNow and OnBase live probes → R9 unless a target becomes available earlier; absence blocks rebuild-ready rather than permitting a substitute.
- Actual write canaries for R6, R8, R9 and R10 → operator decision after each supervisor returns an exact packet.

## Questions for the operator

- None at kickoff. Supervisors must surface only genuinely unresolved product/write-target choices as `NEEDS COORDINATOR`; this coordinator will batch them into decision-brief form.
