# R1 u06 — non-empty architecture project

## Contract

`npm run test:architecture` must fail if its named `architecture` Vitest project
collects no tests. An empty guard lane proves no architecture invariant, so the
root Vitest test configuration explicitly sets the inherited
`passWithNoTests: false` rather than permitting a permissive setting.

The control lives in `tests/unit/architecture-project-empty-collection.test.ts`,
which belongs to the independently collected `unit` project. It both reads the
resolved named-project setting and launches the real named project against a
known-missing architecture test path.

## Negative controls

An empty named project passes if Vitest receives the permissive override:

```text
$ vitest run --project architecture tests/unit/architecture/fixtures/does-not-exist.test.ts --passWithNoTests --reporter=dot
No test files found, exiting with code 0
projects: architecture
exit=0
```

With the actual configuration, the same zero-collection control fails:

```text
$ vitest run --project architecture tests/unit/architecture/fixtures/does-not-exist.test.ts --reporter=dot
No test files found, exiting with code 1
projects: architecture
exit=1
```

Temporarily changing the inherited setting to `passWithNoTests: true`
made the independent unit control fail with `true !== false`. The mutation was
restored before the green proof.

## Green proof

```text
$ npm run test -- --project unit tests/unit/architecture-project-empty-collection.test.ts
Test Files  1 passed (1)
Tests  2 passed (2)
```

The standard architecture command remains the exact named-project command;
the setting protects it from a mis-scoped include/exclude or an inherited
permissive empty-suite policy.

## Gate results

```text
$ npm run test:architecture
Test Files  70 passed (70)
Tests  701 passed (701)

$ npm run typecheck
exit=0

$ npm run lint
exit=0

$ npm run build:manifest:check
src/domain/workflow/generated-build-manifest.ts is current.

$ npm run roadmap:check
docs/roadmap/index.html is fresh.

$ git diff --check
exit=0
```
