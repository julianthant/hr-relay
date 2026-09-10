# U — Queue and Activity consumer evidence

Assignment: **2.6.8.1**, approved U01–U06 brief in `decisions.md`, committed plan
`25ec4b5ed0f6bca575db8d9f204268b1dd840ff4`. One supervisor, zero workers and zero
independent reviewers. Full acceptance and independent review remain **2.6.9**.

## Binding and current status

- Exact V base: `ea83e77d378d2b8c000c425205f44887c65a9a94`.
- Branch: `codex/activity-views`.
- Worktree: `/Users/julianhein/Projects/hr-worktree-database-peer`.
- Implementation: `939ae45f0532faa5a1e1766b520b046a6acdf2ae`.
- Tested implementation tree: `99fe5127938aa96b3db1c1958b9f0b4cd7e6c3c4`.
- **U01–U05 focused PASS. U06 integration and incorporated cleanup pending.**
- Integration target last observed at `482f3491fd68fb1f7047cfbeb8521e64329e9134` on
  `master`, with unrelated, unstaged edits to `AGENTS.md` and `CLAUDE.md`. The approved
  clean-target condition is not met. U does not stage, stash, overwrite or commit those edits.
- H remains independent at `/Users/julianhein/Projects/hr-worktree-database-other`,
  branch `codex/archive-viewer`. No H files, refs, sessions or runtime resources were changed.

All observations are from 2026-09-10; revalidate volatile git state before integration.
External evidence is retained at
`/Users/julianhein/Projects/hr-u-activity-views-evidence-20260910/`.

## U01 — prerequisite admission

V's immutable receipts were present and verified before implementation and again at freeze:

| Receipt under `/Users/julianhein/Projects/hr-v-surfaces-evidence-20260910/` | SHA-256 |
| --- | --- |
| `release.json` | `af4cac6612d484eb1edd07488cf51a30ecd941ecf16c4b5aaf6b68b81682a734` |
| `integration.json` | `7a31662c2772f18779164224ac14bc6830cfaf8bd8cb82be4c60c512e832df3f` |
| `cleanup.json` | `534472c7f5e54f9e70681437e7a931f7b5cb9fa184a6247e74d4afb16438ee60` |

V already composes `queryQueueSummaries` and `queryActivitySummaries` into the day and
report projectors. The existing dashboard client strictly parses their public wires. Queue
rows are canonically enriched and retain served action descriptors; summary records do not
authorize commands. No new route, schema, registry, command, shared fixture or generated
runtime input was required. U was created at the exact V base, not at the later planning tip.

## U02–U04 — implementation and consumer controls

Queue's current summary connection, partitioning, ordering and toolbar remain intact. Desktop
verification found Enter/Space bubbling from a nested action into the row's selection handler,
preventing native keyboard action activation. The owned row now handles those keys only when
the row itself has focus. A regression failed before the fix (`run-d3sOhx`), then passed;
row selection and the exact served descriptor/revision dispatch both remain tested.

Activity now explains V's validated canonical identity count rather than retired keyed-pseudonym
generations. Sampled names resolve only against held Queue rows; missing rows remain identified
by their served run ID without fetching another identity. The extracted resolver is used by the
component, not an unused test export. Explicit invalid, inverted, incomplete and impossible date
ranges refuse visibly instead of silently selecting month-to-date. Only an empty navigation
selection receives the existing default. Async report state is bound to its selected range, so
a prior response/export is not presented while another range loads.

The required new unit files cover real SQLite cursor pagination and selected day membership,
Queue/Activity/CSV agreement without whole-history reads, operation containment, retry history,
canonical descriptor positive/negative controls, keyboard propagation, selected-range races,
repeated-person counts supplied by the server, missing identity, warnings, failed/unmeasured
durations and unavailable versus measured-zero facts. Existing `activity-render.test.ts` remains
unchanged and passes. No shared test fixture, guard, membership, assertion, timeout or coverage
floor was weakened. Unchanged Queue ordering/batch baselines also passed 29 cases in four files.

## U05 — focused gates

All final implementation gates below tested tree `99fe5127938aa96b3db1c1958b9f0b4cd7e6c3c4`.
The manifest `tested-inputs.json` records SHA-256 for 2,085 tracked source/test/configuration/
dependency inputs; aggregate identity is
`adb37a56e10e8cbacb7d825214da3d97682c426f2368e80a9322312976e742c3`.

| Check | Result | Retained evidence |
| --- | --- | --- |
| Required unit selectors, one worker | 3 files, 17 tests; exit 0 | `unit-final.log`, `run-NntwFe` |
| Affected architecture selectors, one worker | 5 files, 67 tests; exit 0 | `architecture-final.log`, `run-sPmDW2` |
| `npm run lint` | exit 0, zero warnings | `lint-final.log` |
| Roadmap documentation binding | 24 tests; exit 0 | `evidence-binding.log` |
| `git diff --check` | exit 0 | candidate freeze |
| Components desktop proof | exit 0, PASS | `desktop-final.log`, `desktop-states.log`, `desktop-zoom.log` |

Commands from the U worktree:

```sh
VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/summary-surfaces/queue.test.ts tests/unit/summary-surfaces/activity.test.ts tests/unit/dashboard/activity-render.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/one-projection-counts.test.ts tests/unit/architecture/wire-connectivity.test.ts tests/unit/architecture/dashboard-wire-boundary.test.ts tests/unit/architecture/dashboard-refresh-boundary.test.ts tests/unit/architecture/dashboard-memo-prop-stability.test.ts
npm run lint
VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/roadmap-doc-binding.test.ts
git diff --check
```

Vitest's explicit CLI `--maxWorkers=1` overrides its four-worker default. No coverage, broad
architecture, full typecheck, full parity, build or performance command was run. The five changed
implementation/test paths do not change descriptor import closures, store catalog inputs,
roadmap declarations or generator configuration. Manifest/catalog generation is therefore not
affected. The evidence-only recording does not change the tested code/configuration/dependencies.
Roadmap generation/freshness and instruction/link checks are recorded at evidence closure.

Evidence closure: `npm run roadmap` and `npm run roadmap:check` both exited 0; generation
changed no tracked output. The new evidence file then passed the documentation-binding selector
(24 cases, `run-XU1IrV`, `evidence-binding-final.log`). Root and dashboard instruction twins
are byte-identical (`cmp`, exit 0); this evidence adds no Markdown link targets. The only
recording change is this owned file, so the implementation gates above are reused by exact
source/test/configuration/dependency identity, not claimed as rerun against a different product.

## Desktop proof and limits

Lead: **Components**, support: none, local. Existing design tokens, primitives, geometry and
themes were preserved. `desktop.mts` launches U's Vite source and the existing synthetic fixture
BFF on loopback 5191 plus an ephemeral BFF port recorded in `desktop-ports.json`. It reads no
operator database, secrets or live provider. Its cache and browser profiles are outside U.

Run from the external evidence directory:

```sh
playwright-cli -s=hr-u-activity run-code --filename=desktop-proof.js
playwright-cli -s=hr-u-activity run-code --filename=desktop-states.js
playwright-cli -s=hr-u-zoom run-code --filename=desktop-zoom.js
```

Snapshots preceded locator selection. Screenshots cover 1024×720 and 1440×900 in Paper Ink and
Graphite Warm, Queue filtering and operation containment, Activity category grouping and its
canonical-count popover. Keyboard Enter reaches filters, popovers and the existing `bump` command
for synthetic run `00000000-0009-4000-8000-000000000009`, expected version 9. The request is
retained in `desktop-final.log`; no command vocabulary or target revision was manufactured.
The queued filter deliberately contains two top-level roots and one queued member; the top-level
badge is not a second count of all displayed descendants.

`activity-invalid-range.png`, `activity-loading.png`, `activity-stale.png` and
`activity-unavailable.png` prove refusal/loading distinctions and absence of stale export controls.
The separate owned Chromium profile sets the observed Page zoom control to 125%; runtime
`devicePixelRatio` is 1.25 and neither consumer has horizontal page overflow. Zoom screenshots
are `activity-browser-zoom125.png` and `dashboard-browser-zoom125.png`. Representative screenshots
were visually inspected for clipping, readability, focus and preserved layout.

Queue/Activity have no page-number or next-page controls at this frozen V boundary. Cursor
pagination is exercised against the real SQLite query in U's unit proof; desktop evidence proves
the resulting served rows and bounded Activity samples, not a nonexistent pagination widget.
The inherited synthetic BFF returns selected canned reports, so SQL membership/counting claims
come from the database-backed tests, not its screenshots. Existing CSV/XLSX server calculations
are unchanged; U's new CSV agreement test supplements rather than replaces V's export proof.

Expected browser diagnostics are the absent fixture favicon (404), a fixture-only missing detail
for the synthetic selected run (404), and the deliberately injected stale-summary 409. The initial
keyboard failure and corrected filter assertion are iteration evidence, not accepted behavior.
No unhandled render failure remained. This is focused desktop proof, not full visual parity,
mobile/coarse-pointer acceptance, an automated accessibility audit or independent review.

## U06 — integration and cleanup gate

The implementation is committed and available for focused integration. Do not mark the entire
assignment complete until clean-target admission, local merge, input-identity reuse or invalidated
checks, release recording, and incorporated worktree/ref removal are verified. Preserve the
external evidence and H. Do not push or dispatch a successor.

Before merging, recheck target HEAD/branch/cleanliness and U/H ownership. After a successful local
merge, append candidate/merge/final-tree identities and integration checks here, then remove only
the incorporated U worktree and `codex/activity-views` from a safe primary checkout. Never clear
someone else's edits merely to meet the clean-target condition.
