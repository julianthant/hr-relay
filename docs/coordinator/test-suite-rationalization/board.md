# Board — test-suite rationalization

**Project profile:** `docs/coordinator/test-suite-rationalization/project-profile.md`
**Coordination UUID:** `f24df892-5171-48f4-97ff-4e91490f8622` (`Cf24df892`)
**Coordinator title:** `Coordinate · test-suite-rationalization · Cf24df892 · remaining test-suite work`
**Coordinator task/host:** `01a064e2-c3cf-7422-90c7-1dce60d194e5` / `local` (continued from `01a064c1-e4ef-7bc0-bcd7-0329b5dfd357`)
**Coordinator checkout:** `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/test-suite-rationalization-f24df892-coordinator`
**Integration target:** `feature/test-suite-rationalization`
**Board owner:** coordinator
**Write rule:** coordinator only; supervisors and workers read only
**Last verified:** 2026-09-02 at Wave 2A reservation commit `a638e8c3`; current coordinator checkout/task binding and prior R1/R6 cleanup verified

## Facts every run needs

- Test contract and gates: `project-profile.md`; normative topology in `docs/rebuild/reference/guards-and-tests.md` §§6–10.12.
- Intake evidence: `evidence/intake-2026-09-02.md`.
- Current integrated baseline: 394 Vitest files / 4,886 cases; 306 ordinary unit files / 111,579 lines, 70 architecture files / 27,336 lines, 18 offline scenario files / 7,296 lines; two non-collected live manifests; parity passes 281/281 after R6's evidence-backed duplicate-family removal.
- Port intake baseline: an unrelated legitimate dashboard occupied 127.0.0.1:3938 and 127.0.0.1:5174 and exposed 16 reserved-port failures. Both ports were free for the 2026-09-02 continuation gate; R3a still owns proving the full gate while a legitimate dashboard remains active.
- Continuation gates at `37c080bc`: typecheck PASS; lint PASS; architecture PASS 70/70 files and 703/703 cases; manifest/roadmap/diff checks PASS; parity PASS 281/281 in 59.9s; coverage PASS 394 files/4,886 cases in 169.38s at 85.41% statements, 76.42% branches, 89.49% functions, and 87.35% lines. Active-port hermeticity remains R3a work.
- Dated trap: a Vitest list imports architecture modules; at intake those modules fail unless the legacy repository is available. The operator has explicitly ruled that finished checks must be self-contained in this repo. R1 owns removing that gate dependency without erasing provenance.

## Decisions ratified

- 2026-09-02 · direct operator instruction → all lint, type, test, architecture, generated, and other checks must be self-contained in this repository; the old codebase is read-only reference material for building/copying verified facts, not a required test/runtime dependency → normative owner `docs/rebuild/reference/guards-and-tests.md`, with cross-repo rule reconciliation in the paired root instructions and decision pointer during R7.
- 2026-09-02 · operator objective → rationalize by unique risk/contract and red-capable evidence, not by file/test count; preserve all named safety and parity guarantees → normative owner `docs/rebuild/reference/guards-and-tests.md` during R7.
- 2026-09-02 · operator answered `all recommended`, decoded before action as `1 C · 2 B · 3 C · 4 C · 5 B · 6 B · 7 B · 8 B` → preserve unique failure protection first; duplicates require the same failure mode, seam, and oracle; deletion/consolidation requires a mapped survivor plus red-capable evidence or proof the old test could not fail meaningfully; use runner/type-first hybrid layout; reserve scenarios for distinct graph/boundary paths; allow targeted local iteration but require full type/lint/coverage at supervisor integration and before merge; target affected ≤30 s, full coverage ≤90 s, parity ≤75 s without sacrificing unique protection; organize files by coherent risk family with truthful behavior/refusal names. The operator required the question sheet to remain chat-only; R7/u40 owns normative `guards-and-tests`, D191, paired-rule, and decision-index ratification.
- 2026-09-02 · direct operator instruction → test output must show what is running at each legible step: project/suite, file, full behavior/refusal title, and stable named phases for long or genuinely multi-stage harnesses; failures must identify the exact operation with actionable non-secret context. Preserve speed with one streaming reporter, unchanged parallelism/isolation, no per-assertion chatter in short units, and measured reporter overhead. R7/u38 owns the durable runner/reporter contract and u42 proves representative green progress, actionable red output, and runtime impact.
- 2026-09-02 · direct operator instruction → after clean Wave 1 integration, expand to four non-overlapping supervisor worktrees and serialize only CPU-heavy full-suite coverage/parity gates.
- 2026-09-02 · continuation capacity → the unrelated Phase 3c worktree and the new coordinator worktree occupy two of the four auxiliary slots, so remaining runs launch at most two at a time until Phase 3c releases its slot; this changes scheduling, not scope or integration order.
- 2026-09-02 · R6 recommendation accepted under the operator's standing `all recommended` instruction → ratify the reproducible 5,569 day-wire statement baseline tied to D269's intentional worker-pool query; R7 adds a failure-capable non-duration performance check with the agreed structural bounds and reconciles the owning authority.
- 2026-09-02 · R6 recommendation accepted under the operator's standing `all recommended` instruction → preserve the complete unique-risk suite and the ≤90-second full-coverage target; measure the self-contained post-R1/R6 composition, then let R7 profile scheduling/fixtures if it remains over budget. Do not delete unique protection to hit the target.

## Unit ledger

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| u01–u06 | R1 | closed | merged `--no-ff` as `81e6f3c3`; run worktree and branch removed; exact task `01a0645c-1e13-7581-8a20-67314a86e195` archived | integrated continuation gate at `37c080bc`: type/lint/70-file architecture/manifest/roadmap/diff PASS | complete | Self-contained architecture/static work retained on the integration line |
| u07–u12 | R2 | active | task `01a064e5-e38c-7e31-9f3c-90d108a186cd`; worktree `/Users/julianhein/.codex/worktrees/0b41/hr-automation-rebuild` | exact-base detached-start repair authorized before writes | required | Core/domain/workflow/write/storage units |
| u13, u14, u16 | R3a | planned | — | — | required | Wave 2 server/BFF/runtime and real-port hermeticity |
| u15, u17, u18 | R3b | planned | — | — | required | Post-Wave-2 worker/consolidation/review |
| u19–u24 | R4 | reserved | — | — | required | Wave 2A supervisor slot reserved; dashboard model/jsdom/component layer |
| u25, u26, u29 | R5a | planned | — | — | required | Wave 2 scenario inventory, T1, T1b authority |
| u27, u28, u30 | R5b | planned | — | — | required | Post-Wave-2 walks, dashboard scenarios, layout/review |
| u31–u36 | R6 | closed | merged `--no-ff` as `9d87f512`; run worktree and branch removed; exact task `01a0645c-1e18-7d70-9dfc-c7fb53fa0b66` archived | integrated continuation gate at `37c080bc`: parity 281/281 in 59.9s; coverage 394 files/4,886 tests in 169.38s | complete, 0 open findings | Removed one duplicate 6-case/18-reference-file parity family with durable equivalence and negative-control evidence; accepted recommendations remain R7 inputs |
| u37–u42 | R7 | planned | — | — | consequential | Cross-family integration, taxonomy, authorities, final proof |

## Residue

- D91's already-documented branch-floor gap is not silently in scope as a threshold change. Runs may measure and report it; changing the ratified floor requires an explicit owning-doc decision unless existing authority already determines the exact implementation.
- Existing unrelated Phase 3 workflow worktrees/branches are outside this project's cleanup ownership. Final evidence must distinguish pre-existing retained worktrees from this project's run worktrees; only this project's integrated branches must be removed.
- The old coordinator worktree `/Users/julianhein/.codex/worktrees/f14c/hr-automation-rebuild` was removed after its sole untracked dependency symlink was detached; it was replaced by the registered continuation checkout recorded above. The earlier coordinator task's exact id is unavailable, so no title-based or recency-based archival was attempted.
- R1 and R6 have no remaining registered worktree, physical directory, branch ref, or active sidebar task. The active Phase 3c worktree/branch remain explicitly retained and untouched.

## Questions for the operator

- None. Supervisors must surface `NEEDS COORDINATOR` for any new product-truth, scope, or guarantee tradeoff.
