# Unit 25 — runtime environment inventory repair

## Red source

Gate 24's recorded `test-coverage.log` identified the first-gate failures as the runtime
environment inventory audit. Reproduced before the repair with:

```text
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npx vitest run --reporter=verbose tests/unit/architecture/runtime-environment-coverage.test.ts
```

The audit reported nine unregistered `TMPDIR` occurrences in
`tests/unit/scripts/verify-parity-json.test.ts` (lines 899, 902, 904, 909, 910, 1117, 1120,
1132, 1133) and one unregistered bulk computed reader:
`scripts/verify-parity-json.ts|main|bulk|read|e4db44daa6ead5a1e592c02fa32cfe50b23a07fb388949c32664a0ea298f82ea`.

## Repair

`src/domain/runtime-environment.ts` now registers `TMPDIR` as a test-only key owned by the parity
unit test, and records the wrapper's `main` environment pass-through through the strict
test-only `parity-command-child` boundary and the scanner's exact expression fingerprint.

## Green proof

```text
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npx vitest run --reporter=verbose tests/unit/architecture/runtime-environment-coverage.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)

npm run lint
eslint src tests scripts --max-warnings 0
exit 0
```

No typecheck, full coverage, parity, browser, staging, or commit was run for this seam.

## Artifact hash

```text
0f4ceed3d0d09f54af56855a70ce5a752cb18f2c24d9f51bf9e53bc83c07e394  src/domain/runtime-environment.ts
```
