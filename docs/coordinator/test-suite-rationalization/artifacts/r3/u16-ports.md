# R3a u16 — real-port hermeticity

## Pre-edit ownership ledger and red gate

Recorded on 2026-09-02 before any R3a source/test edit, at base
`39598d2fb9c0964e3ac819c5b3de3538724a8380`.

Mutation scope is `tests/unit/server/compose-real-port.test.ts`; production isolation remains owned
by `config/runtime-isolation.json`, `src/config/runtime-isolation.ts`, and the operational-isolation
architecture guard. `src/server/dashboard/compose.ts` already exposes the literal-`0`-only
`backendPortOverride` / `frontendPortOverride` test seam, while production omission still binds
3938/5174.

A legitimate `npm run dashboard` from the primary rebuild checkout owned both listeners:

| Port | Listener PID at red proof | Command role |
| ---: | ---: | --- |
| 3938 | 95609 | dashboard BFF |
| 5174 | 95590 | Vite dashboard |

With those listeners active, this exact red-capable command failed:

```text
npm exec vitest run -- --project unit tests/unit/server/compose-real-port.test.ts \
  --reporter=verbose -t 'serves bootstrap, day, and SSE through the real client'
```

The failure was `dashboard preflight refused startup: ports.available: reserved port ownership is
invalid for backend 3938 and frontend 5174 (owner-proof-unconfigured)` at
`src/server/dashboard/compose.ts:1272`. The test’s two narrow catch-and-return arms also made older
`EADDRINUSE` / backend-only collision messages vacuously green. The correct fix is to use both
literal-zero overrides, remove the catches, assert the returned port is nonzero and not 3938, and
retain the real bootstrap/day/SSE client path.

R3a’s exact brief owns the focused active-port proof; R3b owns the final full active-port coverage
gate. No production port or isolation contract will change.

## Verification record

The red was reversed with the legitimate dashboard still active:

```text
npm exec vitest run -- --project unit tests/unit/server/compose-real-port.test.ts \
  --reporter=verbose \
  -t 'serves bootstrap, day, and SSE through a real ephemeral listener and releases it at teardown'

Test Files  1 passed (1)
Tests       1 passed | 63 skipped (64)
Duration    2.71s
```

One test-local wrapper now forces both literal-zero override seams for every composition in the
file, so its 64 cases cannot claim 3938 or 5174. The focused case keeps the real client path,
encloses all post-start assertions in teardown authority, closes its SSE subscription, awaits the
runtime stop, and then binds a fresh Node server to the exact returned ephemeral port. That bind is
the direct teardown oracle; its own listener also closes in `finally`.

Before and after the focused and full owned-family gates, `lsof` reported the same legitimate
listeners: PID 95609 on 127.0.0.1:3938 and PID 95590 on 127.0.0.1:5174. No process command referenced
this worktree afterward, no matching temp-authority directory remained, and the rebuild lock root
contained no entry.

A deliberately broader diagnostic that crossed the brief's ownership boundary still found active-
port failures in `worker-pool-composition.test.ts` and `worker-pool-parallel-proof.test.ts`, plus a
cleanup-time artifact-reader `ENOENT` after that failed worker composition. Those files are unchanged
and remain R3b u15/u17/u18 residue; the R3a exit gate is the exact owned family above, while R3b owns
the full active-port coverage gate.
