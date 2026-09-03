# Board — test-suite rationalization

**Project profile:** `docs/coordinator/test-suite-rationalization/project-profile.md`
**Integration target:** `feature/test-suite-rationalization`
**Board owner:** coordinator
**Write rule:** coordinator only; supervisors and workers read only
**Last verified:** 2026-09-02 16:17 PDT at coordinator commit `1a919de2`; Wave 1 worktrees and task identities reverified live

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
- 2026-09-02 · operator answered `all recommended`, decoded before action as `1 C · 2 B · 3 C · 4 C · 5 B · 6 B · 7 B · 8 B` → preserve unique failure protection first; duplicates require the same failure mode, seam, and oracle; deletion/consolidation requires a mapped survivor plus red-capable evidence or proof the old test could not fail meaningfully; use runner/type-first hybrid layout; reserve scenarios for distinct graph/boundary paths; allow targeted local iteration but require full type/lint/coverage at supervisor integration and before merge; target affected ≤30 s, full coverage ≤90 s, parity ≤75 s without sacrificing unique protection; organize files by coherent risk family with truthful behavior/refusal names. The operator required the question sheet to remain chat-only; R7/u40 owns normative `guards-and-tests`, D191, paired-rule, and decision-index ratification.
- 2026-09-02 · direct operator instruction → test output must show what is running at each legible step: project/suite, file, full behavior/refusal title, and stable named phases for long or genuinely multi-stage harnesses; failures must identify the exact operation with actionable non-secret context. Preserve speed with one streaming reporter, unchanged parallelism/isolation, no per-assertion chatter in short units, and measured reporter overhead. R7/u38 owns the durable runner/reporter contract and u42 proves representative green progress, actionable red output, and runtime impact.
- 2026-09-02 · direct operator instruction → after clean Wave 1 integration, expand to four non-overlapping supervisor worktrees and serialize only CPU-heavy full-suite coverage/parity gates.
- 2026-09-02 · R6 recommendation accepted under the operator's standing `all recommended` instruction → ratify the reproducible 5,569 day-wire statement baseline tied to D269's intentional worker-pool query; R7 adds a failure-capable non-duration performance check with the agreed structural bounds and reconciles the owning authority.
- 2026-09-02 · R6 recommendation accepted under the operator's standing `all recommended` instruction → preserve the complete unique-risk suite and the ≤90-second full-coverage target; measure the self-contained post-R1/R6 composition, then let R7 profile scheduling/fixtures if it remains over budget. Do not delete unique protection to hit the target.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| u01–u06 | R1 | running, policy cleared | isolated `feature/test-r1-architecture-static` from `7982650c`; exact task `01a0645c-1e13-7581-8a20-67314a86e195` | pending | required | Operator answer relayed; u02 worker branch remains supervisor-owned |
| u07–u12 | R2 | planned | — | — | required | Core/domain/workflow/write/storage units |
| u13, u14, u16 | R3a | planned | — | — | required | Wave 2 server/BFF/runtime and real-port hermeticity |
| u15, u17, u18 | R3b | planned | — | — | required | Post-Wave-2 worker/consolidation/review |
| u19–u24 | R4 | planned | — | — | required | Dashboard model/jsdom/component layer |
| u25, u26, u29 | R5a | planned | — | — | required | Wave 2 scenario inventory, T1, T1b authority |
| u27, u28, u30 | R5b | planned | — | — | required | Post-Wave-2 walks, dashboard scenarios, layout/review |
| u31–u36 | R6 | reported; held for R1-first integration | clean `feature/test-r6-parity-checks` at `090d3acd` from `7982650c`; exact task `01a0645c-1e18-7d70-9dfc-c7fb53fa0b66` | 281/281 parity in 68.20s; 43/43 Duo; pre-R1 coverage 390 files/4,838 tests in 152.53s with legacy override | 0 open findings | Removed one duplicate 6-case/18-reference-file parity family; operator accepted both R6 recommendations; final self-contained coverage follows R1 then R6 merge |
| u37–u42 | R7 | planned | — | — | consequential | Cross-family integration, taxonomy, authorities, final proof |

## Residue

- D91's already-documented branch-floor gap is not silently in scope as a threshold change. Runs may measure and report it; changing the ratified floor requires an explicit owning-doc decision unless existing authority already determines the exact implementation.
- Existing unrelated Phase 3 workflow worktrees/branches are outside this project's cleanup ownership. Final evidence must distinguish pre-existing retained worktrees from this project's run worktrees; only this project's integrated branches must be removed.
- During Wave 1 close, the registered and physical coordinator worktree `/Users/julianhein/.codex/worktrees/f14c/hr-automation-rebuild` disappeared while its branch and commits remained intact. The coordinator verified `feature/test-suite-rationalization` at `d107d647`, recreated that exact worktree path from the branch, and reverified it clean before continuing. Cleanup messages now explicitly exclude the coordinator, R6, and unrelated worktrees.

## Questions for the operator

- None. Supervisors must surface `NEEDS COORDINATOR` for any new product-truth, scope, or guarantee tradeoff.
