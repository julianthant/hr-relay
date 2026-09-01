# DCA fresh gate 27 — final acceptance

Status: **FAILED at gate 6 (parity); sequence stopped as required.** The valid sequence invoked each named gate exactly once. No source/test/reference/package/config file was edited, staged, or committed.

Checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
Branch: `feature/dca4-archive-evidence`  
Evidence: `docs/coordinator/worktree-completion/evidence/dca-fresh-gate27-20260831T215209Z-35767/`

## Ordered gate receipt

| # | Command | Exit | Wall | Result |
|---|---|---:|---:|---|
| 1 | `npm run test:coverage` | 0 | 77s | 338/338 files; 3996/3996 tests; statements 85.16%, branches 75.43%, functions 88.57%, lines 87.22% |
| 2 | `npm run typecheck` | 0 | 16s | pass |
| 3 | `npm run lint` | 0 | 28s | pass |
| 4 | `npm run roadmap:check` | 0 | 0s | fresh |
| 5 | `npm run build:manifest:check` | 0 | 2s | current |
| 6 | `npm run test:parity` | 1 | 276s | 271 tests: 229 passed, 42 failed |

Parity stats: expected **229**, skipped **0**, unexpected **42**, flaky **0**. The failures are stored-reference drifts in the raw parity log. The required body-backed evidence verifier: **PASS** (no verifier-error line; see `parity-verifier-outcome.txt`).

## Environment, lock, and hashes

`HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`; `PARITY_UPDATE` was unset throughout. `/tmp/hr-dashboard-full-gate.lock` was immediately available (no queue), acquired at `2026-08-31T21:52:17Z`, held over the full sequence, and released at `2026-08-31T21:58:56Z`.

Manifest before/after SHA-256: `66d399b7cc1370018778a9101dd9fedd6dcc478b02bd35b214aabe60288a5a49` (identical). Reference inventory before/after: 591 files, SHA-256 `b0f5c1cbb449fa700be06fae48c1951522f32c93e61575d1fa84166c92f2552c` (identical). Final parity `results.json`: `abcf25941881fa0dfc429630c07c0389312d00943e3f9e8d82fe8b735131a129`; pre-run copy: `30e3eeb7794506c3083145e7600b45dbda7d17a60cf6278d0073606ea0fb5466`.

An earlier harness preflight at `dca-fresh-gate27-20260831T215112Z-34551` failed to launch npm because `lockf` sanitized PATH; it ran no test process. The receipt above is the corrected authoritative sequence.
