# R4b — dates provenance repair

Status: **COMPLETE — ready for coordinator integration**. Date: 2026-09-02.

Board mode: `coordinated-read-only` at
`/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/separations-completion/board.md`.
The supervisor did not edit, stage, or commit the board. Run branch:
`feature/r4b-dates-provenance-repair`, based exactly on `5eb736ec`.

## Outcome

R4a's immutable failure is deterministically reproduced and repaired. D307 added required
reconciled-dates output leaf `source`, but the task implementation did not add that leaf to its
`ctx.recordData` batch. The real executor-owned provenance collector therefore refused the parsed
output before it could become a checkpoint. The repair records `output.source` as a strict read
point; the existing contract still derives its provenance from the exact `plan` and `timecard`
dependencies. Validation was not weakened and no fallback was added.

Detailed red/green evidence:
[`evidence/r4b/debug-red-green.md`](../evidence/r4b/debug-red-green.md).

## u19 commits

| Commit | Category | Result |
|---|---|---|
| `3d59c1a4` | production fix + deterministic regression | records `source`; exact live symptom red before fix and green after |
| `74bf0195` | paired repository instructions | records the schema-leaf / real-collector testing lesson; twins byte-identical |
| `cc7f8e36` | generated build manifest | refreshes only the affected separations task fingerprint/source digest |
| `647ed013` | review hardening | exercises production observed-data redaction and asserts the exact source observation |

The report and evidence are committed in the containing report commit.

## Regression proof

`npm run test -- tests/unit/separations-dates-provenance.test.ts` failed before the fix with:

```text
task workflow:separations/read-separation-dates has no recorded provenance for output field source
```

The final test runs the production task, real separations descriptor and dependencies, production
collector finalization, and production observed-data redaction. It asserts the `source` fact is
`derived`, retains the oldest upstream observation, and emits exact `kronos-timesheet` evidence under
its declared classification. Removing the one-line production point restores the exact red failure.
The broader separations structural composition remains 25/25 green.

## Review

| Axis | Native role | Result |
|---|---|---|
| Correctness | `sup_terra` | initial medium finding that the observation sink was a no-op; fixed in `647ed013`; rerun PASS |
| Silent failures | `sup_terra` | PASS; rerun PASS after test hardening |
| Spec | `sup_terra` | PASS; smallest fail-loud fix, no forbidden scope |
| Standards | `sup_luna` | PASS |
| Tests | `sup_luna` | PASS; red path and both provenance surfaces pinned |
| Docs | `sup_luna` | PASS |
| Performance | supervisor | skipped: no loop, I/O, polling, render, or resource-lifetime behavior changed |
| Security | supervisor | skipped: no auth, permission, secret, command, dependency, or untrusted-input boundary changed |
| Simplify | supervisor | skipped: the production repair is one point and the test scaffolding is the minimum real collector seam |

Review totals: Correctness 0 after repair; Silent failures 0; Spec 0; Standards 0; Tests 0; Docs 0.

## Gates

| Gate | Final result |
|---|---|
| focused provenance test | 1/1 passed |
| unminimized separations structural scenario | 25/25 passed |
| `npm run typecheck` | passed |
| `npm run lint` | passed, zero warnings |
| `npm run test:coverage` with the worktree's explicit legacy-path override | 390/390 files, 4,819/4,819 tests, zero skips; all coverage floors exceeded |
| `npm run build:manifest:check` | current |
| `npm run roadmap:check` | fresh |
| `npm run test:parity` | 287/287 passed; no parity update |
| `git diff --check` | passed |
| instruction twins | byte-identical |

The first coverage attempt was invalid because the fresh worktree had no legacy sibling; it was
stopped and rerun with the supported exact override. A second run reported only the 16 reserved-port
refusals expected while the shared dashboard was up. The final run passed after the project
profile's required quiesce. The dashboard was restored after all port-sensitive gates.

## Scope and next run

- No live retry, browser operation, gate decision, HR write, runtime-row mutation, replay change,
  board write, integration-target merge, master merge, or push occurred.
- The immutable R4a failure remains evidence and was not repaired in place.
- Operator direction received during R4b: **R4c must use document `4495` for the post-repair live
  test instead of `4502`.** This report carries the choice; it does not execute it.
- R4c remains a fresh-supervisor run after coordinator integration. No handoff is needed for this
  coherent completion.
