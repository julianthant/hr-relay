# R3b brief — worker/session tests and server-family review

**Coordination UUID:** `f24df892-5171-48f4-97ff-4e91490f8622`
**Parent coordinator:** task `01a064e2-c3cf-7422-90c7-1dce60d194e5` / host `local`
**Canonical title:** `Supervisor · test-suite-rationalization · Cf24df892 · R03b · worker review`
**Profile/workspace:** `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/test-suite-rationalization-f24df892-coordinator/docs/coordinator/test-suite-rationalization/project-profile.md` · `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/test-suite-rationalization-f24df892-coordinator/docs/coordinator/test-suite-rationalization`
**Board:** `docs/coordinator/test-suite-rationalization/board.md` — read only; coordinator is sole writer
**Worktree allowance:** one slot total, consumed by the supervisor worktree; use read-only workers or sequential supervisor-owned implementation

## Assignment

Invoke `/supervise` and complete only u15, u17, and u18 after R2, R4, R3a, and R5a are integrated. Own worker/session/lease/concurrency tests, then reconcile the entire integrated R3 family against lower-layer units and scenarios. Exact carried residue from R3a is: `worker-pool-composition.test.ts` and `worker-pool-parallel-proof.test.ts` fail their active-5174 real-runtime shutdown paths, and the failed worker composition emits a cleanup-time artifact-reader `ENOENT`. Reproduce and fix the owned cause without retry, skip, timeout widening, or killing an unrelated process. The board is read-only.

**Run branch:** `feature/test-r3b-worker-review` from the coordinator-recorded reservation base; never merge into the coordinator branch
**Report:** `docs/coordinator/test-suite-rationalization/reports/r3b-worker-review.md`
**Writable evidence:** `docs/coordinator/test-suite-rationalization/artifacts/r3/u15-workers.md`, `u17-consolidation.md`, and `u18-review.md`

## Required method and evidence

1. Audit worker pools, claims, sessions, Duo leases, teardown, soak, and concurrency risks with an exact owned-file ledger and red-capable evidence.
2. Compare the integrated server/runtime/worker family against R2 core units, R4 dashboard tests, and scenario claims. Delete or relocate only with exact same-risk/seam/oracle proof and a mapped survivor.
3. Preserve process, HTTP, concurrency, teardown, refusal, and fail-loud risks that cheaper layers cannot prove. Prove no leaked listeners, workers, child processes, locks, browser profiles, or temp authority.
4. Run the full coverage gate while the legitimate dashboard owns 3938/5174; record listener identity before and after plus case/coverage/runtime results.
5. Run with explicit progress output showing project/suite, file, full behavior/refusal title, and stable named phases for worker/lease/teardown harnesses. Capture expected diagnostics; keep real failures actionable and non-secret.
6. Complete consequential review across correctness, silent failures, performance, tests, docs, security, and repository standards.

## Exit gate

Focused red/green, integrated server/runtime/worker family, active-port full coverage, typecheck, lint, applicable architecture/generated checks, and diff check; representative labeled green progress and controlled actionable-red output; exact report and clean worktree.
