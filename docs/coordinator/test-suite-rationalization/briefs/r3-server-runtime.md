# R3 brief — server/BFF/runtime/worker tests and real-port hermeticity

## Assignment

This is the umbrella scope for R3. Dispatch it through `r3a-server-runtime.md` (u13, u14, u16 in Wave 2) and `r3b-worker-review.md` (u15, u17, u18 after R2/R4/R3a). Do not dispatch this umbrella brief directly. Both supervisors treat the board as read-only.

**Run branch:** `feature/test-r3-server-runtime` from the coordinator-declared base
**Report:** `docs/coordinator/test-suite-rationalization/reports/r3-server-runtime.md`
**Writable evidence:** `docs/coordinator/test-suite-rationalization/artifacts/r3/u13-bff.md` through `u18-review.md`

## In scope

- `tests/unit/server/**` plus any root unit file whose primary SUT is server/BFF/runtime/CLI/process/worker/session/lease behavior.
- Route/wire identity and refusal behavior, SSE/download semantics, startup/shutdown, configuration admission, worker pools/claims/sessions/teardown/concurrency, runtime fixtures, port/state ownership.
- Vitest/runtime helper changes needed for hermetic state and ephemeral/owned ports.

## Out of scope

- Production port values or operational-isolation guarantees; stopping another task's legitimate dashboard just to pass tests; architecture/dashboard/scenario/parity ownership; live HR actions; threshold/exclusion weakening.

## Required method and evidence

1. Reproduce the known failure with 3938/5174 occupied and capture exact red evidence.
2. Make every test own ephemeral ports and isolated temp state while keeping production reserved-port checks intact. No retries, skipped cases, widened timeouts, global process kills, or fallback ports masquerading as assertions.
3. Audit server/runtime tests for duplicate lower-layer logic and duplicate scenario coverage. Retain HTTP/process boundaries only where a cheaper pure test cannot prove the risk.
4. Prove teardown: no leaked listeners, child processes, workers, locks, browser profiles, or temp authority.
5. Run the full coverage command with the legitimate dashboard still listening on both reserved ports. Record listener identity before and after and the full case/coverage/runtime result.
6. Audit output while running the owned family: every case must surface project/suite, file, and full behavior/refusal title; startup, request, worker, teardown, and other multi-stage harnesses need stable named phases whose failures include actionable non-secret context. Capture expected diagnostics in assertions; do not globally suppress output.
7. Independent review across correctness, silent failures, performance, tests, docs, security, and repository standards.

## Exit gate

Focused red/green, server/runtime family pass, active-port `npm run test:coverage`, typecheck, lint, applicable architecture/generated checks, diff check; representative labeled green progress and controlled actionable-red output; clean worktree/report. Do not edit the board or merge the coordinator branch. If production isolation would need to change, return `NEEDS COORDINATOR` instead.
