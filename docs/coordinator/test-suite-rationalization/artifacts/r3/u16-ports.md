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

Pending red/green reversal, listener identity before/after, ephemeral rebind, and temp/lock cleanup.
