# R1 / U06 — externally anchored frozen provenance

## Finding and repair

`config/ports/legacy-architecture-provenance.json` carried each generated
legacy path snapshot beside its own SHA-256. That rejected accidental changes,
but not a coordinated substitution: a sorted same-count path replacement could
recompute the adjacent digest and still parse.

The frozen-provenance helper now owns a closed external anchor table for every
source commit, generated snapshot name/source command/content address, and
frozen legacy file path/blob pair. Parsing verifies that table before checking
the payload's Git-blob bytes and generated-path shape, and deep-freezes the
authenticated facts subsequently shared with consumer guards. The JSON remains
the single payload/schema seam; it is not duplicated into another input format.

## Red control

The focused provenance test replaced the first runtime inventory path with a
different, still sorted path, kept the inventory count unchanged, and recomputed
its SHA-256 address. Before the anchor check, the control failed red because
the parser accepted the tampered object:

```text
AssertionError: Missing expected exception.
```

The repaired parser rejects it at the external anchor:

```text
frozen legacy runtime.browserSystemFiles snapshot anchor mismatch for contentAddress
```

The existing parser-level malformed, unordered, duplicate, and missing-newline
controls continue to exercise `frozenLegacyPaths` directly after recomputing
their local digest; authenticated consumers only receive the parsed frozen
provenance object.

## Green gates

```text
HRAUTO_LEGACY_REPO=/definitely/nonexistent/hr-automation npm run test:architecture -- \
  tests/unit/architecture/legacy-selector-port-provenance.test.ts \
  tests/unit/architecture/runtime-dependency-coverage.test.ts \
  tests/unit/architecture/legacy-capability-disposition.test.ts \
  tests/unit/architecture/legacy-test-disposition.test.ts

Test Files  4 passed (4)
Tests  40 passed (40)

npm run typecheck
> tsc --noEmit

npm run lint
> eslint src tests scripts vitest.config.ts vite.dashboard.config.ts playwright.parity.config.ts --max-warnings 0

git diff --check
```
