# R4b debug evidence — dates `source` provenance

Date: 2026-09-02. Branch: `feature/r4b-dates-provenance-repair`. Base: `5eb736ec`.

## Exact authority symptom

- Run: `05d9d8fa-22e0-4b5c-9e38-2df095162284`
- Failure: `3a7959e9-c230-44ae-8c8c-0cd3e5d32278`
- Fingerprint: `d0e11f1e85783ee4067addac7c971b8963a145dbffaac248b535bcccf0591644`
- Summary: `task workflow:separations/read-separation-dates has no recorded provenance for output field source`
- Write state: `not-attempted`

## Deterministic red

Command:

```text
npm run test -- tests/unit/separations-dates-provenance.test.ts
```

Before production code changed, the new test ran the production dates task through the production
provenance collector under the real `separations` descriptor with validated `plan` and `timecard`
checkpoint evidence. It failed in 622 ms:

```text
FAIL tests/unit/separations-dates-provenance.test.ts
Error: task workflow:separations/read-separation-dates has no recorded provenance for output field source
at src/core/task-provenance.ts:285
Test Files 1 failed (1)
Tests 1 failed (1)
```

## Root cause and smallest fix

D307 added required output leaf `source` to the reconciled dates schema, while
`readSeparationDatesTask`'s `ctx.recordData` batch continued to end at `dateChangeComments`.
The executor correctly enumerated `source` as a parsed output leaf and refused before checkpointing.

The fix is one point in the existing batch:

```text
{ direction: "read", field: "source", value: output.source }
```

No schema, collector, executor, replay, checkpoint, runtime-row, or fallback behavior changed.

## Deterministic green and hardening

The same command passed after the fix. The final regression also routes the recorded batch through
production `redactObservedDataPoints`, then asserts both:

- `source` has `derived` fact provenance and retains the oldest upstream `originalObservedAt`;
- the observed-data sink carries exact value `kronos-timesheet` under declared
  `safe-diagnostic` / `allow` classification.

The original unminimized structural composition stayed green: 1 file, 25 tests.

## Final gates

| Gate | Result |
|---|---|
| focused provenance regression | 1/1 passed |
| separations structural composition | 25/25 passed |
| `npm run typecheck` | passed |
| `npm run lint` | passed, zero warnings |
| `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage` | 390/390 files, 4,819/4,819 tests, zero skips; statements 85.26%, branches 76.33%, functions 89.21%, lines 87.20% |
| `npm run build:manifest:check` | current |
| `npm run roadmap:check` | fresh |
| `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:parity` | 287/287 passed; no update |
| `git diff --check` | passed |

The first worktree coverage launch lacked the explicit legacy-repository override and was stopped
after the guard reported a nonexistent sibling path. The next launch proved 16 expected reserved-port
refusals while the shared dashboard held 3938/5174. After the profile-required dashboard quiesce,
the unchanged full command above passed. Neither invalid attempt is product evidence.

## Review and cleanup

- Native Terra Correctness: one initial medium test-sink finding; resolved in `647ed013`; rerun PASS.
- Native Terra Silent failures: PASS, including rerun after the test hardening.
- Native Terra Spec: PASS.
- Native Luna Standards: PASS.
- Native Luna Tests: PASS.
- Native Luna Docs: see the paired review recorded in the supervisor report.
- No R4b `[DEBUG-*]` instrumentation or temporary harness was introduced.
- No live retry, browser operation, gate decision, HR write, or runtime-row mutation occurred.
