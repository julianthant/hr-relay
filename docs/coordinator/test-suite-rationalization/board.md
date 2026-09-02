# Board — test-suite rationalization

**Project profile:** `docs/coordinator/test-suite-rationalization/project-profile.md`
**Integration target:** `feature/test-suite-rationalization`
**Board owner:** coordinator
**Write rule:** coordinator only; supervisors and workers read only
**Last verified:** 2026-09-02 15:55 PDT at `12ae781b`

## Facts every run needs

- Test contract and gates: `project-profile.md`; normative topology in `docs/rebuild/reference/guards-and-tests.md` §§6–10.12.
- Intake evidence: `evidence/intake-2026-09-02.md`.
- Exact collected baseline: 390 Vitest files / 4,838 cases; 302 ordinary unit files / 110,270 lines, 70 architecture files / 26,962 lines, 18 offline scenario files / 7,296 lines; two non-collected live manifests; 17 Playwright specs / 287 cases; 22 jsdom files.
- Port baseline: an unrelated legitimate dashboard owns 127.0.0.1:3938 and 127.0.0.1:5174. It is evidence for the hermeticity defect and must not be stopped merely to make tests pass.
- Intake gates: typecheck PASS; lint PASS; architecture PASS 70/70 files and 689/689 cases; manifest/roadmap/diff checks PASS. Full coverage intentionally deferred to R3 because prior evidence proves 16 reserved-port failures under an active dashboard.
- Dated trap: a Vitest list imports architecture modules; at intake those modules fail unless the legacy repository is available. The operator has explicitly ruled that finished checks must be self-contained in this repo. R1 owns removing that gate dependency without erasing provenance.

## Decisions ratified

- 2026-09-02 · direct operator instruction → all lint, type, test, architecture, generated, and other checks must be self-contained in this repository; the old codebase is read-only reference material for building/copying verified facts, not a required test/runtime dependency → normative owner `docs/rebuild/reference/guards-and-tests.md`, with cross-repo rule reconciliation in the paired root instructions and decision pointer during R7.
- 2026-09-02 · operator objective → rationalize by unique risk/contract and red-capable evidence, not by file/test count; preserve all named safety and parity guarantees → normative owner `docs/rebuild/reference/guards-and-tests.md` during R7.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| u01–u06 | R1 | briefed | — | — | required | Architecture guards, static gates, self-contained inputs |
| u07–u12 | R2 | planned | — | — | required | Core/domain/workflow/write/storage units |
| u13–u18 | R3 | planned | — | — | required | Server/BFF/runtime/worker and ports |
| u19–u24 | R4 | planned | — | — | required | Dashboard model/jsdom/component layer |
| u25–u30 | R5 | planned | — | — | required | Scenario corpus and evidence provenance |
| u31–u36 | R6 | briefed | — | — | required | Playwright parity/perf/smoke/Duo/generated checks |
| u37–u42 | R7 | planned | — | — | consequential | Cross-family integration, taxonomy, authorities, final proof |

## Residue

- D91's already-documented branch-floor gap is not silently in scope as a threshold change. Runs may measure and report it; changing the ratified floor requires an explicit owning-doc decision unless existing authority already determines the exact implementation.
- Existing unrelated Phase 3 workflow worktrees/branches are outside this project's cleanup ownership. Final evidence must distinguish pre-existing retained worktrees from this project's run worktrees; only this project's integrated branches must be removed.

## Questions for the operator

- None at kickoff. Supervisors must surface `NEEDS COORDINATOR` for any genuine product-truth, scope, or guarantee tradeoff.
