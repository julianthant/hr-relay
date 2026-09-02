# R1 u04 — static-gate scope and roadmap freshness registration

## Contract and membership

`tsconfig.json` has one program and its exact authored roots remain `src/**/*`,
`tests/**/*`, and `scripts/**/*`; it has no `exclude`. Its three explicit root
TypeScript config inputs are `vitest.config.ts`, `vite.dashboard.config.ts`, and
`playwright.parity.config.ts` (3 files). The guard derives every slash-free
`.ts` input from `tsconfig.include` and requires that observed set to equal
those same three files before checking each in lint and the ESLint typed block.
`npm run lint` now targets the three authored roots plus those exact three
config files (6 CLI targets), with `--max-warnings 0`. The ESLint strict typed
block names the same 3 configs; it does not introduce an arbitrary root-file
glob. Coverage thresholds, Vitest project membership, and all existing
exclusions are unchanged.

`roadmap:check` is registered exactly as:

```
tsx scripts/generate-roadmap.ts --check
```

The roadmap binding guard now owns that registration contract, so redirecting
the script or changing it to rendering mode is a test failure rather than an
unreviewed package-script drift.

## Red evidence

Before the lint implementation, the focused guard failed with the exact line:

```
AssertionError: lint must target vitest.config.ts; otherwise a root config is typechecked but escapes lint
```

After implementation, temporarily deleting `vitest.config.ts` from the ESLint
typed block failed with:

```
AssertionError: the typed ESLint config must explicitly cover vitest.config.ts; a command target without a strict block passes vacuously
```

Temporarily adding `"unlinted.config.ts"` to `tsconfig.include` failed with:

```
AssertionError: root TypeScript entries in tsconfig must remain the approved exact set; a new typechecked root config requires deliberate lint coverage
+   'unlinted.config.ts',
```

Temporarily changing `roadmap:check` to `tsx scripts/generate-roadmap.ts`
failed with:

```
Expected: "tsx scripts/generate-roadmap.ts --check"
Received: "tsx scripts/generate-roadmap.ts"
```

All temporary mutations were restored before commits.

## Green evidence

```
HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation \
  npx vitest run --project architecture \
  tests/unit/architecture/gate-coverage.test.ts \
  tests/unit/architecture/roadmap-doc-binding.test.ts --reporter=dot

Test Files  2 passed (2)
Tests  21 passed (21)
```

```
npm run typecheck
> tsc --noEmit

npm run lint
> eslint src tests scripts vitest.config.ts vite.dashboard.config.ts playwright.parity.config.ts --max-warnings 0

npm run roadmap:check
> tsx scripts/generate-roadmap.ts --check
docs/roadmap/index.html is fresh.

git diff --check
```

All commands exited 0.

## R7 residue

None from this seam: no broad package-script taxonomy or canonical contract
prose changed. The inherited architecture-test import still requires
`HRAUTO_LEGACY_REPO` because `helpers/guard-files.ts` resolves the legacy root
at module load; self-contained architecture collection is a separate R1
omission, not masked by this evidence.
