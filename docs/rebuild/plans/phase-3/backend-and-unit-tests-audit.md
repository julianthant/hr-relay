# Backend and unit-test restructuring audit

Status: static audit and supporting proposal, 2026-09-30. No test was executed or removed.
This is the test evidence for [the backend and unit-test plan](backend-and-unit-tests.md), not
acceptance of a numbered roadmap phase.

## Current execution pointer — 2026-10-01

The static inventory and findings below describe the 2026-09-30 baseline. Initiative Phase 1 is
accepted locally at `a46d792273af908dd9bfd29d6f5eb19b874a319e`; see the plan's
[Phase 1 acceptance record](backend-and-unit-tests.md#phase-1-acceptance--2026-10-01) for current
dispositions, collection, verification, baseline failures, and deferrals. Phases 2–5 remain proposed.
The acceptance is local to this initiative and does not admit a roadmap phase or later complex-suite
execution.

## Verified checkout and audit scope

- Checkout: `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend`.
- Branch: `codex/logs-backend`.
- Source HEAD: `27fd907207ab42fc938856954ef75a136da32f74`; clean before these planning documents.
- Approved Logs UI commit `1211a24b81547ec2b7c6e27837c4d57c081d259e` is an ancestor.
- All 666 discovered test files are tracked. Counts describe files, not executed test cases.
- Complete path, size, source hash, current family and direct-resource hints are saved in
  `/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-09-30/backend-unit-tests-planning/test-inventory.json`.

The inventory covers the complete discovered corpus. The semantic and quality review covers
selected cases at the affected runtime, confirmation, streaming and presentation seams. It does
not establish a quality verdict for every test in the repository. Import hints cannot justify
deletion: tests may reach resources indirectly through helpers, or read fixture data without
testing a resource boundary. Refresh the inventory against the actual execution base.

## Current runner topology

| Current family | Test files | Source lines | Actual collection |
| --- | ---: | ---: | --- |
| Unit, excluding architecture | 508 | 156,907 | Vitest `unit` project |
| Architecture | 82 | 30,943 | Vitest `architecture` project, nested inside `tests/unit/` |
| Scenario | 17 | 7,321 | Vitest `scenario` project |
| Browser parity | 59 | 9,501 | Separate Playwright parity runner |

The three Vitest projects currently collect 607 `.test.ts` files. No `.test.tsx` or `.spec.tsx`
files were found. The three `dry-run.scenario.ts` files are live manifests, deliberately outside
test collection. Their presence is not proof of a live run.

`npm run test` invokes `scripts/test-runner.ts run` across the configured projects. It is not
a unit-only command. `npm run test:coverage` runs the same projects with coverage and then the
suite-size report. `npm run test:architecture` selects the architecture project. Browser parity
uses `scripts/verify-parity-json.ts` and `playwright.parity.config.ts`.

The effective configuration and guard inventory declare global line/statement/function floors
of 60% and safety-critical floors of 80%. Branch targets of 50%/70% are declared policy values;
the current Vitest threshold object does not enforce branch thresholds. Historical prose and
historic green counts do not replace these current inputs or an executed coverage result.

Isolation uses forked workers, at most four test files at once, and 30-second default test/hook
timeouts. Individual tests can have explicit longer deadlines. Preserve these settings during
reorganization; do not raise them to hide a slow or blocked test.

## Findings and initial dispositions

### The unit folder is not a reliable boundary

Among its 508 files, 81 directly reference `node:sqlite`, 179 reference `node:fs`, 23 reference
`node:child_process`, and seven reference `node:http`. These counts overlap and omit indirect
resource use. They are discovery hints, not an exact integration-test count.

For example, `server/dashboard-stream.test.ts` uses `server/helpers/dashboard-harness.ts`, which
creates SQLite-backed timeline storage. `write-sequencer-restart-no-repeat.test.ts` reaches real
authority storage through a composition helper. Neither classification would be accurate from
the importing file's direct imports alone.

**Disposition:** inspect the test body and its harness, then move resource and composition proofs
to an explicit integration home while preserving their cases. Split mixed suites as their backend
module is reworked. Do not replace real storage proofs with fake-backed units and claim equivalent
durability evidence.

### Large suites mix unrelated responsibilities

Examples include `server/bff-flow.test.ts` (4,707 lines), `command-kernel.test.ts` (2,742),
`sqlite-authority-database.test.ts` (2,608), `worker-loop.test.ts` (2,026), and
`run-executor.test.ts` (1,835). Size is not evidence that their assertions are worthless.

`run-executor.test.ts` covers frozen operation binding, note-query composition, real stored
snapshot reopen, complete workflow walks, provenance, retries, cancellation and terminal
authority. One fixture changes many concerns at once.

**Disposition:** split by the public behavior being protected. Extract small unit-testable policies
alongside their source refactor; retain cross-boundary tests as cross-boundary tests. Prefer one
focused fixture per module to another large universal test world.

### Current buffering tests intentionally encode behavior we are changing

`browser-action-notes.test.ts` contains "holds successful gestures in memory until the operation
settles" and another case asserting the drain is empty during an active operation.
`write-sequencer.test.ts` separately protects post-settlement draining around external writes.
These are meaningful tests of the current design, not arbitrary failures to ignore.

**Disposition:** replace the ordinary-action buffering expectation with a controlled-promise test:
confirmation completes, the containing task remains blocked, and its confirmed display fact is
already available. Keep the external-write ordering assertion: logging must not introduce a
fallible operation between the durable fence and submit or cause a repeated submit after a logging
failure. A confirmed fill is not a confirmed external write.

### Existing confirmation and identity units protect useful behavior

`declared-action-confirmation.test.ts` rejects unrelated, stale, duplicate and cross-session
verification. `browser-action-notes.test.ts` verifies that a false or throwing verifier produces
no confirmed action. `dashboard/operation-structure-model.test.ts` checks exact action/capture
joins, withheld values, unavailable results and changed definitions.

**Disposition:** retain their useful behavior or map it to the replacement module. Move result
selection tests to the backend when result selection moves there. Keep frontend tests for the
mapping and rendering it still owns. Shared fixtures must remain visibly synthetic.

### Some complex tests have distinct, useful oracles

`server/dashboard-stream-backpressure.test.ts` includes a real paused HTTP client. It verifies
that the socket actually stalls, overflow becomes one reset, earlier envelopes remain ordered,
and disconnect releases the subscription. An in-memory queue unit cannot prove this socket path.

`write-sequencer-restart-no-repeat.test.ts` executes recovery over real authority storage and checks
that the second run does not stage, fence or click again. A pure decision unit can protect the
policy but cannot prove transaction persistence across reopen or recovery.

**Disposition:** retain and clearly relocate these existing proofs for later operator review.
Do not execute or expand them during the unit-focused development phases. Their unchanged presence
does not mean they passed against a new backend layout.

### Presentation assertions need relevance checks, not blanket retirement

`dashboard/operation-structure-component.test.ts` exercises Explorer/operation interactions,
including collapse controls. These are not automatically obsolete because the approved Logs feed
is always open. `parity/run-detail/logs-captures.spec.ts` delegates scene behavior to shared helpers;
its surface expectations need inspection against the approved UI before any reference change.

**Disposition:** retain Explorer assertions unless that feature is deliberately changed. New Logs
adapter/model units should assert served facts, order and screenshot ownership. Defer browser
scene redesign and visual reference review until the operator participates. Do not refreeze old
screenshots simply to make the suite green.

### No direct production caller currently supplies universal declared-action confirmation

`runDeclaredAction` is defined in `src/infra/browser/action-notes.ts`; the current production source
search finds its own recursion but no task caller elsewhere. Existing tests demonstrate its
contract using fixtures. The log redesign therefore needs a shared authoring/driver API and a real
composition connection, not just frontend styling or a subscription endpoint.

**Disposition:** unit-test the shared API, then connect it at the actual driver/task execution seam.
Use a synthetic task through the production executor wiring to check dependency injection without
claiming live page verification. Broad migration of existing workflows remains separate.

## Artifact and guard audit

`test-results/.last-run.json` is tracked in both the assigned continuation base and the primary
checkout. It contains only:

```json
{ "status": "failed", "failedTests": [] }
```

Its latest path commit is `6a8d46788`, a historical parity reference update. The current parity
configuration writes to ignored `tests/parity/.output/`. No current source/script reference to
`test-results` was found. This file cannot explain a failure or establish current test status.

**Disposition:** remove the tracked metadata file in the later test-artifact cleanup, once the
execution checkout has been re-inventoried. Remove a physical directory only if that exact owned
directory is empty afterward. Do not delete the primary checkout's folder or unknown contents.
Keep useful failure logs and reviewed parity references.

`scripts/test-runner.ts` already gives each run a scratch root, cleans successful scratch, and
retains failure information. Reuse that behavior. Do not create another artifact framework.
Document one output location per runner; keep reproducible source fixtures tracked, runtime output
ignored, and accepted evidence under the external task evidence root.

The guard manifest pins test include/exclude lists and checks complete, unique collection.
`tests/scenario/AGENTS.md` separately binds scenario kinds and manifest ownership. Moving files
requires corresponding collection, import, fixture-ownership and guard updates. Deleting a guard
that objects to a move is not a valid restructuring strategy. Inspect old path-specific rules for
their actual invariant, then preserve the invariant under the new module layout.

## Retirement rule for the implementation audit

Each moved, rewritten or retired file needs a row containing its original path, exercised behavior,
actual tier, decision, destination or surviving test, and evidence. Mixed suites need case-level
mapping where a file-level move would lose a behavior. "Too large", "uses mocks", "fails now" and
"complex" are not sufficient retirement reasons.

Retire a test only when its requirement was deliberately removed, or an identified survivor checks
the same failure at the same boundary with a meaningful independent expectation. Verify a replacement
can fail for the relevant defect. Do not add duplicates merely to increase the test count.

No current suite is approved for wholesale deletion by this audit. The approved direction is to
rebuild backend seams and their unit coverage together, make complex suites discoverable, and leave
their design and execution for the operator's later review.
