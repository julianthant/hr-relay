# DCA fresh gate 24 — final acceptance

Status: **FAILED at first gate; sequence stopped as required.** No source/test/reference/package/config files were edited, staged, or committed.

Evidence directory: `docs/coordinator/worktree-completion/evidence/dca-fresh-gate24-20260831T213501Z/`

## Ordered gate receipt

The single held-lock sequence ran these commands exactly once, in order:

1. `env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage` — **exit 1**, wall ~85s; Vitest duration 83.56s; 336/338 files passed, 3994/3996 tests passed, 2 failed. Failures: unregistered `TMPDIR`/computed `scripts/verify-parity-json.ts` inventory entries in `runtime-environment-coverage.test.ts`, and the 30s timeout in `tests/unit/server/bff-flow.test.ts` (verified in `test-coverage.log`).
2. `npm run typecheck` — **NOT RUN** (stop on gate 1 failure).
3. `npm run lint` — **NOT RUN**.
4. `npm run roadmap:check` — **NOT RUN**.
5. `npm run build:manifest:check` — **NOT RUN**.
6. `env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:parity` — **NOT RUN**.

Raw gate log and exact timing/exit receipt: `test-coverage.log`, `gate-ledger.tsv`.

## Environment, lock, and evidence

`PARITY_UPDATE` was explicitly unset for the entire sequence. Gate 1 received `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`; no later repository gate ran. `/tmp/hr-dashboard-full-gate.lock` was immediately available, acquired once, held across the ordered sequence, and released after gate 1 stopped. `lock-queue.txt`, `environment.txt`, and `post-sequence.txt` record this; no holder remained at release.

The parity-reference inventory contains 591 files. Before and after inventories are byte-identical, each with SHA-256 `caf9b28dd29599b4a72b7b236b646db2626857dced2211312d923e884fa23866`; digest verifier: **PASS**. The required parity JSON verifier was **NOT RUN** because gate 6 was not reached. The existing `tests/parity/.output/results.json` is explicitly pre-existing/unattributed to gate 24 (SHA-256 `30e3eeb7794506c3083145e7600b45dbda7d17a60cf6278d0073606ea0fb5466`); no gate-24 final parity result exists. Consequently parity `expected/skipped/unexpected/flaky`: **N/A / not collected**, not guessed.

All captured-artifact hashes are in `artifact-sha256.tsv`.
