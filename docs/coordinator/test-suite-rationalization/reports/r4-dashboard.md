# R4 report — dashboard model, jsdom, and component tests

**Coordination UUID:** `f24df892-5171-48f4-97ff-4e91490f8622`

**Run:** R04 · units u19–u24

**Branch:** `feature/test-r4-dashboard`

**Base:** `a638e8c3543199f9baa93e18113ec4eeb716bdb5`

## Outcome

R4 rationalizes the dashboard unit family without changing product behavior. Eight source-token
geometry cases had stronger existing browser owners: seven in the member touch-target parity spec
and one in the Top Bar search touch-target parity spec. The two generic `IconButton` contracts that
were genuinely lower-layer behavior now live in a truthfully named Node test. Three existing jsdom
files declare React's act environment locally, removing 36 misleading diagnostics without globally
suppressing output.

The result is 104 → 103 dashboard-owned unit files and 1,056 → 1,050 cases. The 21 jsdom files and
258 interaction/focus/lifecycle cases are unchanged. Full browser parity remains 281/281, the
affected T2 scenario remains 9/9, and full coverage remains green at 4,880 cases.

## Exact changes

- Deleted `tests/unit/dashboard/queue-touch-target.test.ts`; parity owns its member/name/info
  geometry. Re-homed caller-class forwarding and accessible naming to
  `tests/unit/dashboard/icon-button-semantics.test.ts`.
- Deleted `tests/unit/dashboard/top-bar-search-a11y.test.ts`; it asserted only class-token geometry,
  while `tests/parity/top-bar-search-touch-target.spec.ts` measures real Chromium hit geometry.
- Added the local `IS_REACT_ACT_ENVIRONMENT` declaration to `ui-catalog-surface`,
  `failure-record-render`, and `run-detail-timeline-render`.
- Added an assertion-level intake ledger: all 1,056 collected cases have one classification,
  disposition, retained owner, intake file, and full title.

## Evidence by unit

| Unit | Durable evidence | Result |
| --- | --- | --- |
| u19 | `artifacts/r4/u19-inventory.md` | Complete 1,056-row assertion ledger and baseline/runtime split |
| u20 | `artifacts/r4/u20-models.md` | Pure decisions retained; two primitive semantics independently red-capable |
| u21 | `artifacts/r4/u21-jsdom.md` | jsdom stays 21/258; focused React diagnostics 36 → 0 |
| u22 | `artifacts/r4/u22-overlap.md` | Exact parity/T2 ownership and two controlled Chromium geometry reds |
| u23 | `artifacts/r4/u23-layout.md` | Capability placement and truthful filename/title changes |
| u24 | `artifacts/r4/u24-review.md` | Independent review dispositions and complete gate table |

## Verification

| Command / control | Result |
| --- | --- |
| `npx vitest run --project unit tests/unit/dashboard/icon-button-semantics.test.ts tests/unit/dashboard/ui-catalog-surface.test.ts tests/unit/dashboard/failure-record-render.test.ts tests/unit/dashboard/run-detail-timeline-render.test.ts --reporter=verbose --passWithNoTests=false` | 4 files / 37 cases; zero React act diagnostics |
| Deliberately omit IconButton caller class, then accessible label | Each exact native-button test failed independently; restored 2/2 |
| Deliberately reduce Top Bar/member coarse target | Chromium reported `24 < 44` and `25 < 44`; production restored |
| `npx vitest run --project unit tests/unit/dashboard --reporter=verbose --passWithNoTests=false` | 103 files / 1,050 cases; 29.04 s wall; actionable full titles visible |
| `npx vitest run --project scenario tests/scenario/dashboard/separations/identity-gate.scenario.test.ts --reporter=verbose --passWithNoTests=false` | 1 file / 9 cases |
| `npm run test:parity` | 17 specs / 281 cases; 58.03 s wall; references unchanged |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, zero warnings |
| `npm run test:architecture` | 70 files / 703 cases |
| `npm run build:manifest && npm run roadmap:check` | PASS; generated files unchanged |
| `npm run test:coverage` | 393 files / 4,880 cases; 85.41/76.42/89.47/87.34%; 253.70 s wall |
| `git diff --check` | PASS |

The dashboard family itself is below 90 seconds. The project-wide coverage run remains 253.70
seconds; R7 owns that cross-family runtime residue. R4 leaves parallelism, isolation, membership,
coverage floors, and timeouts intact.

## Review and integration notes

Independent Standards, Tests, Performance, and Spec reviewers examined the immutable implementation
candidate. Standards found one stale draft claim; Tests found two unscoped matchers and one count
error; Spec required the assertion-level ledger and final proof; Performance found no issue. All
findings are resolved. Spec re-review of `298ef1b9` found no remaining issue. The Docs review found
four record-only issues—missing close status, one whitespace-sensitive title, an abbreviated range,
and two command ellipses—which this close commit corrects. Correctness, silent-failure, and security
review found no changed production surface and no unowned removed behavior.

Coordinator integration should merge this branch after review verification, run its integration
gate, then perform the recorded worktree/branch/task cleanup. Do not edit the R4 branch's evidence
or reinterpret the project-wide runtime residue as permission to weaken a gate.
