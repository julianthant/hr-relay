# R3b u17 — R3 layering, duplication, and naming consolidation

## Decision

No test was deleted, moved, or renamed. Read-only Analyst review and supervisor source inspection
found superficial subject overlap but no row with the same risk, seam, and oracle. The current names
identify their true layer; a move would hide rather than simplify ownership.

| R3 owner | Apparent overlap | Why it is not equivalent | Required survivor before removal |
| --- | --- | --- | --- |
| `server/worker-pool-parallel-proof.test.ts` C12 | R2 direct worker loops; architecture C1–C8; R4 pool controls; scenarios | Only C12 runs two real OS children through the composed kernel door and proves durable birth leases, PIDs, worker/server lock release, HTTP shutdown, and no orphan | A replacement executing the same composed door with two real children and the same lease/PID/lock/refusal oracle |
| `server/worker-pool-composition.test.ts` W3 | `worker-loop.test.ts` pool executor facts and W5 FIFO | W3 injects phase-A→C CAS loss and proves no directive/escalation effect; the direct executor and W5 do not observe that command-kernel basis transition | A composed-kernel test with the same external CAS injection and untouched-effect assertions |
| `server/worker-supervisor.test.ts` | W3/W5 composed consumers | The deterministic unit owner alone explores pre-birth errors, missing PID, signal-undelivered, in-flight stop races, timer cancellation, and roster pre-scan state transitions | A deterministic supervisor-state test for each removed refusal arm |
| `worker-composition.test.ts` | architecture overlap/soak and server runtime | It owns CLI/settings admission, process-record cleanup, boot claim sweep, stale config refusal, and crash recording; the other layers start after those boundaries | A worker-runtime composition test at the same startup/recovery seam |
| `worker-sessions.test.ts` and browser/Duo files | architecture C6/C7 and R6 Duo self-test | Guards select lifecycle invariants; R6's 43-case extension suite proves crypto encoding. Neither replaces identity drift, acquisition bound, close proof, credential generation, or token routing | Same session/factory/store seam plus the same negative oracle |
| R4 dashboard worker/session tests | R3 worker identity and pool subjects | R4 sends and renders served CAS bases and card state only; it cannot observe process or driver effects | Not a candidate survivor for R3 process behavior |
| R5 scenarios | Dashboard composition and worker-visible facts | Scenarios prove cross-slice operator flows, not worker process/session lifecycle authority | Not a candidate survivor for R3 lifecycle behavior |

## Naming and layout

`worker-loop` contains the pool executor contract because that executor is the loop-facing typed
seam; `worker-composition` contains both worker boot and dashboard-composed compatibility arms because
it owns runtime assembly; and `server/worker-pool-*` names the composed dashboard/process boundary.
Those placements are intentional, not deletion-safe duplication. The only output change is the
W5 phase prefix `[r3b:w5:<proof>]`, which makes concurrent verbose output attributable without
changing test identity or project membership.

## Verification

- Focused R3b family: 10 files / 238 cases, all pass under occupied 3938/5174.
- Adjacent architecture matrix: 70 files / 705 cases, all pass; the 8 worker/session guards remain
  registered and independently red-capable through their violating fixtures.
- Full coverage: 393 files / 4,887 cases, all pass under the same occupied ports.
- No unique risk was removed and no threshold, timeout, fixture size, or production isolation value
  changed.
