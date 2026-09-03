# R3a brief — server/BFF/runtime tests and real-port hermeticity

## Assignment

Invoke `/supervise` and complete only u13, u14, and u16 after R1/R6 integration. Own server/BFF/runtime/process test seams and close the reserved-port hermeticity defect while the legitimate dashboard remains active. Do not edit worker/session/lease tests reserved for R3b, the shared board, or another run's files.

**Run branch:** `feature/test-r3a-server-runtime` from the coordinator-declared base
**Report:** `docs/coordinator/test-suite-rationalization/reports/r3a-server-runtime.md`
**Writable evidence:** `docs/coordinator/test-suite-rationalization/artifacts/r3/u13-bff.md`, `u14-runtime.md`, and `u16-ports.md`

## Required method and evidence

1. Record an exact owned-file ledger before edits; reserve worker/session/lease/concurrency files for R3b.
2. Reproduce the 3938/5174 collision with the legitimate dashboard still listening, then make owned tests use ephemeral/owned ports and isolated state without changing production isolation values, retrying, skipping, widening timeouts, or killing unrelated processes.
3. Audit each retained route/runtime test for unique boundary risk and red-capable evidence. Record every deletion/move/merge with its retained owner and equivalence proof.
4. Prove teardown leaves no listeners, child processes, locks, or temp authority owned by the run.
5. Run with explicit progress output showing project/suite, file, full behavior/refusal title, and stable named phases for startup/request/teardown harnesses. Capture expected diagnostics; keep real failures actionable and non-secret.
6. Complete independent correctness, silent-failure, performance, tests, docs, security, and repository-standards review.

## Exit gate

Focused red/green; owned server/runtime family; an active-port proof scoped to owned seams; typecheck, lint, applicable architecture/generated checks, and diff check; representative labeled green progress and controlled actionable-red output; exact report and clean worktree. R3b owns final cross-layer consolidation and the full active-port coverage gate.
