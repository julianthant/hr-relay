# R7 u38 — final taxonomy, runner, output, and added-test inventory

## Executable topology

`vitest.config.ts` owns three disjoint projects: `unit` (306 files, excluding architecture),
`architecture` (70 files), and `scenario` (17 files). The scenario project explicitly excludes the
future live-dependent `tests/scenario/combined/**` tier until its own executor/script exists.
`guard-manifest` now enumerates every authored `.test.ts`/`.test.tsx` and refuses zero or multiple
offline owners (including an accidentally collected or otherwise orphaned combined test), while the independent unit
witness proves an empty architecture selection fails. `test:coverage` executes the same complete
three-project corpus once and then the suite-size report; `test` remains the all-project targeted
convenience and `test:architecture` selects only architecture. File isolation, fork pooling,
four-worker maximum, per-file parallelism, and 30-second test/hook bounds are unchanged.

One configured built-in `verbose` reporter owns every Vitest entry point. Package scripts do not
layer a second reporter. Its stream includes `|project| file > suite > full behavior/refusal title`.
The ten-stage operator lifecycle walk now emits only stable phase begin/complete markers for its ten
real stages; short unit cases emit no added chatter.

## Every test source added since kickoff `7982650c`

| Added test source | Cases | Declared layer and unique behavior |
|---|---:|---|
| `tests/unit/architecture-project-empty-collection.test.ts` | 3 | unit-side subprocess witness that architecture cannot pass with no collected guards |
| `tests/unit/workflow-recipe.test.ts` | 7 | recipe schema/compiler behavior |
| `tests/unit/workflow-recipe-equivalence.test.ts` | 4 | public workflow recipe/descriptor equivalence |
| `tests/unit/workflow-recipe-conformance.test.ts` | 4 | registry-wide recipe conformance |
| `tests/unit/workflow-transaction-outcome.test.ts` | 5 | committed/already-present outcome projection and strict proof binding |
| `tests/unit/dashboard/icon-button-semantics.test.ts` | 2 | primitive label and caller-class forwarding after browser-geometry deletion |
| `tests/scenario/workflows/person-lookup/structural.scenario.test.ts` | 8 | the single workflow-owned consolidation of two pre-existing T1a sources; zero net cases |
| `tests/scenario/dashboard/separations/run-projection.scenario.test.ts` | 6 | renamed/consolidated T2 start/queue/timeline projection owner |
| `tests/scenario/dashboard/separations/needs-you.scenario.test.ts` | 4 | distinct parked-gate notification projection after pure ledger claims moved to units |

The three recipe files (15 cases) and transaction-outcome file (5) are genuinely new behavior
coverage. The empty-project (3), icon semantics (2), person structural (8), and two T2 sources (10)
are replacement/consolidation owners whose removed predecessors or moved cases are mapped in u37.
Support-only `tests/unit/architecture/helpers/frozen-legacy-architecture-provenance.ts` is not a test
source and is correctly excluded from this table.

## Other runners and structural performance

Playwright remains a separate 17-spec/281-case lane with its own single `list` stream and secured
JSON evidence. Performance owns exact non-duration bounds: day-wire SQL ≤5,569, patch whole-day
parses =0, Logs span parses =0, Logs files ≤2, archive-freeze SQL ≤13, member-preview delta SQL ≤6.
The benchmark applies them before reporting, and its unit owner increments every counter to prove
the named refusal. Smoke, Duo, manifest, and roadmap commands retain their existing intended
triggers; none is folded into Vitest or made dependent on legacy state.
