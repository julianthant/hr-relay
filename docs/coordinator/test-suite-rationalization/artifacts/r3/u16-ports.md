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

With those listeners active, this exact base-revision command failed under the test's former title:

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

After the title changed, a controlled negative mutation removed the test-local wrapper overrides
and the final case's redundant overrides. The current exact selector then failed with exit 1 while
printing only `startup:begin` and the same actionable `ports.available` refusal at
`src/server/dashboard/compose.ts:1272`. The mutation was restored before commit. The restored test
then passed with the legitimate dashboard still active:

```text
npm exec vitest run -- --project unit tests/unit/server/compose-real-port.test.ts \
  --reporter=verbose \
  -t 'serves bootstrap, day, and SSE through a real ephemeral listener and releases it at teardown'

Test Files  1 passed (1)
Tests       1 passed | 63 skipped (64)
Duration    3.24s
```

The verbose output included these stable, non-secret lifecycle markers:

```text
[r3a:compose-real-port] startup:begin
[r3a:compose-real-port] startup:complete
[r3a:compose-real-port] request:begin
[r3a:compose-real-port] request:complete
[r3a:compose-real-port] teardown:begin
[r3a:compose-real-port] teardown:complete
```

One test-local wrapper now forces both literal-zero override seams for every composition in the
file, so its 64 cases cannot claim 3938 or 5174. The focused case keeps the real client path,
encloses all post-start assertions in teardown authority, closes its SSE subscription, awaits the
runtime stop, and then binds a fresh Node server to the exact returned ephemeral port. That bind is
the direct teardown oracle; its own listener also closes before the test returns. Body, subscription,
runtime-stop, rebind, and probe-close failures are retained in primary-first order, and multiple
failures surface as one `AggregateError` rather than allowing an earlier cleanup failure to prevent
the remaining cleanup attempts.

Before and after the focused and full owned-family gates, `lsof` reported the same legitimate
listeners: PID 95609 on 127.0.0.1:3938 and PID 95590 on 127.0.0.1:5174. No process command referenced
this worktree afterward, no matching temp-authority directory remained, and the rebuild lock root
contained no entry.

The exact residue commands and results were:

```text
ps -Ao pid=,ppid=,command= \
  | rg '/Users/julianhein/.codex/worktrees/cf5e/hr-automation-rebuild' \
  | rg -v 'rg /Users|ps -Ao'
# no output

find /tmp -maxdepth 1 -type d \
  \( -name 'hrauto-compose-*' -o -name 'hrauto-dashboard-*' -o -name 'hrauto-perf-*' \) -print
# no output

find .tracker-rebuild/locks -mindepth 1 -print
# no output

lsof -nP -iTCP:3938 -sTCP:LISTEN  # node PID 95609, 127.0.0.1:3938
lsof -nP -iTCP:5174 -sTCP:LISTEN  # node PID 95590, 127.0.0.1:5174
```

A deliberately broader diagnostic that crossed the brief's ownership boundary still found active-
port failures in `worker-pool-composition.test.ts` and `worker-pool-parallel-proof.test.ts`, plus a
cleanup-time artifact-reader `ENOENT` after that failed worker composition. Those files are unchanged
and remain R3b u15/u17/u18 residue; the R3a exit gate is the exact owned family above, while R3b owns
the full active-port coverage gate.
