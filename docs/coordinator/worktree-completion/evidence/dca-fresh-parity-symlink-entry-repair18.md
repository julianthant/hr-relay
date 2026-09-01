# Repair18 — canonical parity-wrapper entry

Date: 2026-08-31  
Checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
Branch/HEAD: `feature/dca4-archive-evidence` / `eda17b2708286e36542e1e18e9f8ef6a06cf3187`

## Finding and red gate

Independent Correctness review found that `scripts/verify-parity-json.ts` compared canonical
`import.meta.url` with lexical `process.argv[1]`. A wrapper invoked through a symlinked checkout path
therefore skipped `main()` and returned green without locking, running Playwright, or verifying JSON.

- Direct process red, chunk `56e044`, exit `1` from the assertion harness: child exit `0`, empty
  stdout/stderr, final signal `RED: symlinked entry skipped main and accepted invalid mode`.
- Regression red, chunk `e21cad`, exit `1`: 1 failed / 31 passed; the new process-boundary test observed
  status `0` for the symlinked invalid-mode invocation.

## Smallest repair

- `scripts/verify-parity-json.ts`: canonicalize both sides of the executable-entry comparison with
  `realpathSync`.
- `tests/unit/scripts/verify-parity-json.test.ts`: invoke the real wrapper through a temporary checkout
  symlink and require a nonzero invalid-mode refusal.
- `docs/rebuild/reference/lessons.md`: extend D132's owning lesson with the canonical-entry invariant.

No fallback, wait, threshold, reporter, schema, lock scope, reference byte, or product behavior changed.

## Green proof

- Focused regression, chunk `5e66af`, exit `0`: 1 file / 32 tests passed.
- Original process gate, chunk `d9a035`, exit `0` from the assertion harness: child exit `1` and exact
  refusal `parity JSON wrapper requires explicit mode: assert or update`.
- `git diff --check` for the three repair paths: exit `0`.

Final path SHA-256 values before re-review:

- verifier: `d08157f683ba1ac2b22300f2fceabc24fe8d988f574b14e00780af89dad57b20`
- verifier test: `e836ab231f4e9083b4be698725a27a765f182648dec92a1a65c0647ef67fdd14`
- D132 lesson: `89f9de8f2644089bd9ffe60f40d11584168920d30689e4f1eb1f59b96ac4339b`

Status: implementation complete; focused Correctness, Silent-failures, Tests, Standards, and supervisor
Security re-review remain required before browser allocation.
