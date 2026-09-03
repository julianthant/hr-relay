# R2 report — core, domain, workflow, write, storage, and event units

**Status:** `COMPLETE`. The coordinator accepted the green R2-owned lane and explicitly carried the
two foreign 30-second timeouts into R3a without suppression or reclassification.

**Branch:** `feature/test-r2-core-domain`

**Base:** `a638e8c3`

**Implementation head before this report:** `f7b9fd95`

## Outcome

| Surface | Before | After | Proof |
| --- | ---: | ---: | --- |
| R2-owned test files | 81 | 82 | exhaustive u07–u11 ledger |
| R2-owned expanded cases | 1,151 | 1,156 | 82/82 files and 1,156/1,156 final pass |
| deleted/merged/moved cases | 0 | 0 | no unique-risk equivalence justified removal |
| truthful output-label corrections | 0 | 5 | three transitional workflow suites, one write-safety suite, one command refusal |

The material addition is five direct cases for `projectTransactionOutcome`: committed and
already-present projections, exact nested output/proof schema-hash binding, and strict value parsing.
A controlled reversal of the production output-hash comparison made all five fail with the project,
file, full title, and source location; the restored implementation passed all five. Independent
review then caught a positive-case weakness, and the case now round-trips distinct non-default output
and proof values so hard-coded re-derivation cannot pass.

No test was deleted. Apparent duplicates protect distinct boundaries: recipe registry/compiler
conformance versus fixed public equivalence; direct write recovery versus command-kernel parked-write
lifecycle; repair mutation versus doctor acceptance versus writer prevention for late span roots;
and omission propagation at planner, kernel, fan-out, executor, and result transitions.

## Ownership and residue

- u07 owns 16 files / 312 cases for base/domain/config/intake/OCR/date/trust behavior.
- u08 owns 19 files / 157 cases for workflow compiler/graph/task/omission/provenance behavior.
- u09 owns 15 files / 219 cases for command/planning/execution/result/Edit Data behavior.
- u10 owns 18 files / 230 cases for write authority, receipts, identity, proof, and recovery.
- u11 owns 14 files / 238 cases for SQLite/file authority, ledger, outbox, checkpoints, and events.
- Primary server/BFF/runtime/worker cases remain R3; dashboard/UI cases remain R4; scenarios and live
  dry-run authority remain R5; cross-family physical moves and final taxonomy remain R7.

`workflow-recipe-conformance.test.ts` still contains a server projection block and two write/storage
files have adjacent Explain/doctor composition. R2 records these as later taxonomy moves and does not
edit them opportunistically. D317's final recipe deletion/rename remains active Phase 3c product work.

## Final gates

| Gate | Result |
| --- | --- |
| exact R2 family | PASS — 82 files / 1,156 cases in 17.24s |
| focused changed seam | PASS — 1 file / 5 cases in 1.28s after review fix |
| full ordinary unit, before | RED outside R2 — 305/306 files; 4,040/4,041 cases; Archive disconnect timeout; 126.45s |
| full ordinary unit, after | RED outside R2 — 305/307 files; 4,039 passed, 1 failed, 6 skipped / 4,046 total; Archive disconnect + dashboard perf setup timeouts; 122.71s |
| architecture | PASS — 70 files / 703 cases in 39.24s |
| typecheck / lint | PASS / PASS, zero lint warnings |
| manifest / roadmap | current / fresh |
| diff | `git diff --check` PASS |

The Archive client-disconnect case timed out at the same 30-second boundary before and after R2. The
final full run additionally timed out the dashboard performance fixture's 30-second `beforeAll`,
which skipped its six cases. Both files are explicitly R3-owned by the brief. R2 neither changes nor
suppresses them. The coordinator assigned the Archive route timeout to R3a/u13's server/BFF route
ownership and the server performance-fixture setup timeout to R3a/u14's runtime/composition
ownership.

## Review

The preliminary independent target was `a638e8c3...b6dedad2`. Repository standards passed. The test
review found one P2 positive-oracle weakness, fixed in `f7b9fd95`. The spec review correctly noted
that the final u12/report were not yet present at that interim target and requested a more explicit
retained-case mapping; u12 now records the exhaustive mapping protocol and expanded family totals.
Final pinned-target review results follow in the report-closing commit.

Performance diff review is inapplicable because R2 changes no production hot path, runner,
parallelism, fixture topology, or timeout. Security remains supervisor-owned: no auth, credential,
permission, dependency, browser, command-execution, or authority-writing production behavior changed;
the new cases exercise existing strict write-outcome parsing with redacted fixture ids only.

## Commits

- `72883fac` — `test(workflow): pin transaction outcome projection`
- `6fd3971e` — `test: make core suite labels truthful`
- `b6dedad2` — `docs(test): record R2 family inventories`
- `f7b9fd95` — `test(workflow): prove stored outcome preservation`

## Coordinator action

The coordinator ruled that both exact full-unit timeouts are R3a residue and accepted R2's green
owned lane as its return evidence. No unique-risk removal or guarantee tradeoff requires an operator
decision.

## Coordinator-board observation

The read-only board blob remained `a3d42f3204979819022c8dbb9bec409a9e3c5c62` from intake through
the close read. This branch did not edit, stage, or commit the board.
