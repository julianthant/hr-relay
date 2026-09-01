# Repair26 — real-socket disconnect test synchronization

Date: 2026-08-31  
Checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
Branch/HEAD: `feature/dca4-archive-evidence` / `eda17b2708286e36542e1e18e9f8ef6a06cf3187`

## Red gate and diagnosis

Gate24's single `npm run test:coverage` invocation timed out at 30 seconds in
`tests/unit/server/bff-flow.test.ts` while 3994 of 3996 tests passed. The test awaited the real
verified-byte lease-close observer and then separately awaited a transfer-error observer. Production
has several valid post-handoff disconnect timings: each cancels and disposes the lease, while only the
rejected transfer arm reaches `onTransferError`. The second promise therefore made correct cleanup
depend on one race-specific observer arm.

Independent read-only diagnosis found the focused test green once plus 10/10 repeated runs, locating
the failure in full-suite scheduling rather than in the verified reader's disposal chain. Existing
`dashboard-http-server.test.ts` coverage separately owns the exact rejected-transfer reporting arm.

## Smallest repair

- Pause and destroy the actual Node response synchronously inside its response callback, before the
  promise returns control to the test.
- Await the response-owned lease-close authority, which is the behavior named by this BFF test.
- Permit zero or one local transfer report because both normal cancellation and rejected transfer are
  valid; if a report is present, require its message to name a closed or disconnected response.
- Record the non-obvious test ownership boundary in the nearest `AGENTS.md`.

No production implementation, timeout, retry policy, fallback, server contract, or browser behavior
changed.

## Green proof

- Focused real-socket regression plus required lint, chunk `ee130e`: selected BFF test passed in
  323 ms; lint exited `0`. (The command's name filter skipped the separately listed architecture
  file, so it is not claimed for that half.)
- Focused runtime-environment audit, chunk `8c7802`: 1 file / 6 tests passed.
- Relevant-path `git diff --check`: exit `0`.

Final SHA-256 values before re-review:

- `AGENTS.md`: `2712447dc947d5ffcb7a294662d474fa4b00e25fd29176e643f8b8c6a84622e3`
- `src/domain/runtime-environment.ts`: `0f4ceed3d0d09f54af56855a70ce5a752cb18f2c24d9f51bf9e53bc83c07e394`
- `tests/unit/server/bff-flow.test.ts`: `8c070001bfd45e31382e8dbd60d1ec1c665aa26c8fd62b3e4f3fb37c732f5f8c`

Status: focused repairs are green; independent re-review and the complete ordered acceptance sequence
remain required.
