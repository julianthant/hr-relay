# R1 u03 — exact architecture project membership

## Contract

Ref `guards-and-tests` §10.9 requires architecture guards to be a named Vitest project, excluded
from `unit`, recursively complete, and addressable without a path filter. The public configuration
seam is now:

| Project | Include | Exclude |
|---|---|---|
| `unit` | `tests/unit/**/*.test.ts` | `tests/unit/architecture/**` |
| `architecture` | `tests/unit/architecture/**/*.test.ts` | none |
| `scenario` | `tests/scenario/**/*.test.ts` | none |

`npm run test:architecture` is exactly
`vitest run --project architecture --reporter=dot`. `guard-manifest` binds the project include,
unit exclusion, and script together; its synthetic refusals cover the old path filter, the wrong
project, file/glob narrowing, `--exclude`, an alternate config, a missing/narrow unit exclusion,
and a non-recursive/narrow architecture include.

## Red → green evidence

Red before configuration:

```text
$ HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation vitest run tests/unit/architecture/guard-manifest.test.ts --project unit --reporter=dot
FAIL |unit| ... > keeps architecture recursively complete and out of the unit project
Received:
  test:architecture must select only the named architecture project
  unit project include must remain tests/unit/**/*.test.ts
  unit project must exclude tests/unit/architecture/** exactly once
  architecture project must include every recursive tests/unit/architecture/**/*.test.ts file
Test Files 1 failed (1); Tests 1 failed | 5 passed (6)
```

Green after configuration:

```text
$ HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation vitest run tests/unit/architecture/{guard-manifest,gate-coverage}.test.ts --project architecture --reporter=dot
Test Files 2 passed (2)
Tests 11 passed (11)

$ vitest list --filesOnly --project unit
302 files
$ vitest list --filesOnly --project architecture
70 files
```

The two lists are disjoint: the unit list contains zero `tests/unit/architecture/` paths; every one
of the 70 architecture-list paths is under that recursive root. Static listing does not import test
modules and therefore requires no legacy checkout. Full import/execution without the checkout is
the u02 integration gate.

## Change and residue

- Changed `vitest.config.ts`, `package.json`, `guard-manifest.test.ts`, and
  `gate-coverage.test.ts`; recorded the operational rule in the paired root instructions.
- No test was deleted, no threshold changed, and default/coverage collection still selects all
  three current projects exactly once.
- The final five-project taxonomy and stale historical counts in `guards-and-tests` remain R7 work,
  per the run brief.
