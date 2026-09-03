# R3b brief — worker/session tests and server-family review

## Assignment

Invoke `/supervise` and complete only u15, u17, and u18 after R2, R4, and R3a are integrated. Own worker/session/lease/concurrency tests, then reconcile the entire integrated R3 family against lower-layer units and scenarios. The board is read-only.

**Run branch:** `feature/test-r3b-worker-review` from the coordinator-declared base
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
