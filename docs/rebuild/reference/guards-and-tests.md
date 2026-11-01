# Guards and tests

This reference owns test selection, runner containment, coverage policy, and guard registration.
[The codebase map](codebase-structure.md) owns source and test locations. The assigned brief owns
acceptance scope and the gate schedule. A declared test, scenario ID, or guard is not evidence that
it ran.

## 1. Test layers and ownership

Tests mirror source once under `tests/`. A source path under `src/` drops that prefix. Tests for
`scripts/`, `duo-autopilot/`, and root configurations retain the complete source path. For example,
`src/backend/runs/start/enqueue.ts` maps to `tests/backend/runs/start/enqueue.test.ts`.
Unit and integration files sit together, distinguished by suffix. Topic suffixes split large files
without introducing a second module tree.

`tests/architecture/test-layout.test.ts` checks canonical filenames and existing tracked source
owners. It permits the exact `architecture/`, `parity/`, `perf/`, `types/`, and `support/` subtrees
to have their own organization. It rejects alternate test suffixes, unmatched source paths, and
helpers that hide test registrations behind a helper-style name.

| Layer | Owner and selection | Evidence |
| --- | --- | --- |
| Unit | `<module>.test.ts`; Vitest `unit` | Deterministic decisions, schemas, fake task contexts, and DOM wiring with injected ports. |
| Integration | `<module>.integration.test.ts`; Vitest `integration` | Real isolated SQLite, sockets, processes, browser adapters, and composed execution. |
| Architecture | `tests/architecture/**/*.test.ts`; Vitest `architecture` | Repository-wide boundaries, registries, source/AST checks, and negative controls. Some guards also exercise real adapters. |
| Types | `tests/types/`; `npm run typecheck` | Type inference and illegal calls pinned with `@ts-expect-error` and positive controls. |
| Parity | `tests/parity/`; `npm run test:parity` | Desktop pixels, accessibility, focus, keyboard, loading, and interaction behavior with mock values. |
| Performance | `tests/perf/**/*.test.ts`; Vitest `perf` via `npm run test:perf`. `tests/perf/dashboard-benchmark.ts` via `npm run perf:dashboard`. | Fixture performance checks outside coverage, deterministic structural counters, and separately reported host-dependent timings. |
| Local | `<module>.local.test.ts` and `<module>.local.integration.test.ts`; Vitest `local` via `npm run test:local`. | Tests that need the operator's machine or accounts: a live dry run against UCPath, Kuali, CRM or Duo, the real login Keychain, or the real store. The topic name `local` is that marker. |

A test that opens a database, including `:memory:`, starts a process or socket, drives a browser,
or executes a composed workflow belongs in integration unless it is a repository-wide architecture
guard or a performance test under `tests/perf/**` in the dedicated `perf` project. A DOM test opts
into `@vitest-environment jsdom` per file. DOM wiring assertions do not establish visual parity.

Shared reusable fixtures, helpers, and executable child entrypoints live under
`tests/support/{fixtures,helpers,processes}/`. Architecture fixtures and helpers may sit beside
their guard owner. `tests/architecture/tooling/test-data-ownership.test.ts` checks shared-data
imports and the recorded deferred-capability exceptions. Shared data stays inert at import:
credential, provider, database, and browser effects occur only through admitted executors.
`tests/architecture/tooling/test-runtime-root-isolation.test.ts` rejects test filesystem mutations
rooted in real runtime paths and requires browser factories to use isolated profile roots.

Retain each test that uniquely protects a failure mode. Consolidation requires the same failure
mode, seam, and oracle, with a mapped surviving test that still fails for the defect. Expected
answers remain independent of the producer under test. Tests never rewrite tracked generated files
or parity references in place. Generator behavior is exercised in scratch directories so parallel
readers cannot observe temporary corruption or silently repaired inputs.

Vitest fixtures and desktop parity use `America/Los_Angeles` explicitly. Parity browser contexts
use the same zone, so reviewed local dates and times do not depend on the host's time zone.

## 2. Vitest selection and commands

`vitest.config.ts` defines five named projects. `guard-manifest.test.ts` audits exact includes,
excludes, reporters, and single ownership of the test corpus. Unit, integration, architecture and
perf fail when empty. The local project may be empty: that is the absence of an operator-machine
test, and `npm run test:local` passes `--passWithNoTests=true` for it. Cloud runs select unit,
integration and architecture only. Coverage stays on those three and does not select local.

| Project | Include | Exclude |
| --- | --- | --- |
| `unit` | `tests/**/*.test.ts` | `tests/**/*.integration.test.ts`, `tests/**/*.local.test.ts`, `tests/architecture/**`, `tests/parity/**`, `tests/perf/**` |
| `integration` | `tests/**/*.integration.test.ts` | `tests/**/*.local.integration.test.ts`, `tests/perf/**` |
| `architecture` | `tests/architecture/**/*.test.ts` | `tests/**/*.local.test.ts`, `tests/**/*.local.integration.test.ts` |
| `perf` | `tests/perf/**/*.test.ts` | `tests/**/*.local.test.ts`, `tests/**/*.local.integration.test.ts` |
| `local` | `tests/**/*.local.test.ts`, `tests/**/*.local.integration.test.ts` | `tests/parity/**` |

`tests/parity/` is outside Vitest. There is no scenario project or current `tests/scenario/`
corpus. Scenario declarations retained in workflow/contracts are graph metadata, not execution
results. Role-derived scenario paths do not prove that a file exists.

| Command | Exact package script or purpose |
| --- | --- |
| `npm run test -- <paths>` | `vitest run --project unit --project integration --project architecture --project perf`. A bare run does not select `local`. |
| `npm run test:unit -- <paths>` | `vitest run --project unit --passWithNoTests=false`. |
| `npm run test:integration -- <paths>` | `vitest run --project integration --passWithNoTests=false`. |
| `npm run test:architecture -- <paths>` | `vitest run --project architecture --passWithNoTests=false`. |
| `npm run test:local -- <paths>` | `vitest run --project local --passWithNoTests=true`. |
| `npm run test:coverage` | `vitest run --coverage --project unit --project integration --project architecture && tsx scripts/test/suite-size.ts`. |
| `npm run test:perf` | `vitest run --project perf --passWithNoTests=false`. |
| `npm run test:watch` | Interactive `vitest` on unit, integration, architecture and perf. |
| `npm run perf:dashboard` | `TZ=UTC tsx tests/perf/dashboard-benchmark.ts`. |

Package scripts pass extra arguments through to Vitest.
`scripts/test/project-policy.ts` rejects empty, duplicate, orphaned, and multiply owned listings;
`tests/architecture/tooling/guard-manifest.test.ts` applies that policy to the real corpus and
injected violations.

Vitest uses isolated forks, file parallelism, `maxWorkers: Math.min(4, availableParallelism())`,
`globals: false`, and one `verbose` reporter. Test and hook timeouts remain **30,000 ms**. Worker
arguments include `--no-experimental-webstorage`, avoiding process-global Node localStorage.
The worker default belongs to the root configuration so CLI limits apply to every named project.
Project/file/suite and full behavior or refusal titles remain visible. Short units do not emit
per-assertion progress messages. Multi-stage harnesses may emit stable phase markers.
CI runs five macOS groups. The matrix in `.github/workflows/ci.yml` assigns twenty ordinary
integration shards around one unit run, one architecture run with two file workers and two parity shards.
The three native browser process-proof files (browser control, onboarding Duo provider, worker supervisor) run first and serially in group 5, without competing
test files. Ordinary shards discover integration files through Vitest, remove those three paths,
then pass the remaining paths explicitly. Vitest 4.1.11's CLI exclusions do not reach these named
projects. Selection refuses if any native file is missing or no ordinary files remain.
Remaining integration files, unit and parity use two workers. Groups have 40-minute budgets (hang guards; groups need 22-29 minutes), and Spotlight indexing is off on every group and its RAM disk;
architecture runs `npm run test:architecture -- --maxWorkers=2` within its 15-minute budget.
CI sets `RELAY_TEST_TIME_SCALE=2.5`; `tests/support/time-scale.ts` multiplies the
Vitest test and hook limits, test wait helpers and the browser deadlines tests pass to product code by it.
Local runs use 1. Product defaults are unchanged. Remaining-file steps run after a failed proof
unless the workflow is cancelled, preserving failure visibility. An integration shard failure
does not stop its group's remaining shards, and any shard failure fails the group.

PR filtering uses these rules. Static and privacy always run.

| Changed paths | Routine suites selected |
| --- | --- |
| Markdown only | None. |
| Source, scripts, configuration, dependencies, shared test helpers or fixtures, unknown non-Markdown paths | All four. |
| Unit test files only | Unit and architecture. |
| Integration test files only | Integration and architecture. |
| Architecture test files only | Architecture. |
| Parity test files or references only | Parity and architecture. |
| Parity helpers, fixtures or entrypoints | All four; unit and integration also import these. |
| Local or perf test files only | Architecture; local remains machine-only and perf remains release-only. |

Mixed changes select the union. Machine-readable inputs under `docs/`, including the guard
inventory, count as configuration. Push events bypass filtering and always select all four suites.
Required summaries always run on Ubuntu, including when no macOS group was selected. They require
successful change detection and either an explicit omission or successful scheduled groups.
Failure or cancellation of any scheduled group fails each selected suite's summary.

Membership verification compares an unsharded `vitest list --filesOnly --json` for unit,
integration and architecture with the union of the exact CI selections. Unit and architecture
are unsharded; each native file is selected once. For every ordinary integration shard, use
`vitest list --project integration <ordinary paths> --shard=N/20 --json=/absolute/shard-N.json`
with the same discovered path array as CI. Deduplicate test rows into files within each shard, then require
no duplicate files across shards, no missing files and no extra files against the baseline.
Vitest 4.1.11's `list --filesOnly` does not apply sharding, so it cannot prove shard membership.
Parity retains its two Playwright shards; their `--list --reporter=json` test identities must
also form the unsharded listing exactly once. Coverage, perf and local selection are unchanged.

## 3. Private test temporary directory

`tests/support/private-temp-setup.ts` is Vitest's global setup. It creates one directory with
`fs.mkdtemp` under `os.tmpdir()` (mode `0700` on POSIX; the per-user temp on Windows), points
`TMPDIR`, `TMP`, and `TEMP` at it for the workers, and removes it when the run ends.
`KEEP_TEST_TMP=1` keeps the directory. `tests/support/private-temp.test.ts` checks the directory
the workers see.

On macOS, `scripts/test/ram-tmp.sh <mebibytes>` formats an APFS RAM disk with `newfs_apfs` as
the current user, enables volume ownership with `sudo -n /usr/sbin/diskutil enableOwnership`,
sets the volume root to mode `755`, creates a `0700` directory on it, and prints that path. The
script fails if that volume still shows `noowners` or is not owned by the current user. The CI
mount step also fails if the volume still shows `noowners`. Point `TMPDIR` at the printed path
before Vitest; the private-temp setup still nests its own directory underneath and keeps its
checks. Eject with `scripts/test/ram-tmp.sh eject` and the volume path (the parent of the
printed directory). CI macOS test jobs mount 2048 MiB and export `TMPDIR` before the suite.
The mount logs physical memory, CPU count and requested disk size. Test jobs use 7 GB Apple Silicon
runners. Keep room for Node and Chromium;
raise the disk size only after a measured peak no longer fits.

Parity launches Playwright directly. After 180 seconds without output it kills that child and
its descendants, and only then releases the command lock. It does not take a suite lock. The
command lock remains the private file under `.tracker/data/locks`.

`scripts/test/artifact-policy.ts` and its architecture owner keep generated coverage/test output
untracked and ignored. Accepted task evidence belongs in the main checkout's ignored `.work/`
folder; the artifact policy's external-evidence-root check covers its injected listing, not that
brief receipt convention.

### 3.10 Durable run and receipt evidence

An execution claim uses the real composed production signal and admission path with an isolated
scratch environment. Fixture values alone do not prove execution, deadline handling, authority
admission, or persistence. Tests preserve the real schema parser, provenance collector, command
kernel, timeline writer, and receipt derivation at the seam they claim to cover.
Composition tests that replace browser sessions also pass the lease-backed `fixtureDuoCeremonyGates(clock)` through `duoCeremony`; they retain the real worker drain and never read operator credentials.

`tests/architecture/runs/evidence-receipt.test.ts` owns receipt schema/evidence checks.
`tests/backend/runs/provenance/evidence-receipt.live-workflow-composition.integration.test.ts`
exercises composition. `tests/architecture/storage/storage-recovery.test.ts` owns real isolated
backup/recovery behavior; projection-only replay cannot stand in for preserved authority.
The run's retained result and receipt are distinct from emitted progress events.

### 3.15 Local values and egress checks

`tests/architecture/logs/redaction-surface-scan.test.ts` audits declared surface origins and
canary-bearing producers. `tests/architecture/logs/no-secret-values-in-logs.test.ts` checks secret
interpolation and diagnostic boundaries. Complete local operator evidence retains supplied values;
provider prompts and OS notifications have separate egress restrictions. The source owners are
`src/rules/redaction/redaction.ts`, the receipt producers under `src/backend/runs/provenance/`,
and notification producers under `src/backend/runs/notifications/`.

Canary tests first prove the planted value reaches the input, then exercise the real boundary.
A fake emitter or no-op collector that bypasses validation cannot prove the persistence schema or
provenance contract. Producer union coverage enumerates every emitted arm, including early-return
and refusal arms, rather than sampling a few shapes.

## 4. Verification checklist

The brief names exact paths and commands for focused work. A changed behavior gets its focused
test, lint, and affected static or generated checks. A lint failure is a task failure. Assertions,
collection membership, isolation, coverage floors, and timeouts remain unchanged unless the
operator explicitly authorizes a change.

Before `staging` is promoted to `main`, the root working instructions require this order:

```sh
npm run typecheck
npm run lint
npm run web:build
npm run test:parity
npm run test:coverage
npm run test:perf
```

Coverage runs alone and selects unit, integration, and architecture without perf. The perf project
runs afterward without coverage instrumentation. Separate full unit, integration, and architecture
reruns add no acceptance evidence for unchanged inputs. The brief may additionally
require `npm run build:manifest:check`, `npm run stores:catalog:check`, or other affected freshness
checks. Derived output is regenerated at its source before its freshness check.

Before coverage, the operator gate still requires free memory, no swap pressure, and no listener
on port 3938:

```sh
lsof -nP -iTCP:3938 -sTCP:LISTEN
```

Resource refusal leaves coverage unrun and recorded as such. It does not authorize raising a
timeout, weakening isolation, or lowering a floor. Focused success is evidence only for its selected
scope. Required broad checks remain assigned to their finalizer.

Documentation-only work uses applicable link, generated-output, and whitespace checks. Reuse of a
code check records its tested tree, command/result, current candidate, and verified unchanged
inputs. A changed contract, generator input, fixture, config, or documentation parsed by a test
invalidates its affected evidence. A recording-only commit does not by itself invalidate unchanged
code results. Old live results remain dated observations, never current external readiness.

`scripts/test/suite-size.ts` measures unique selected files and line counts for each configured
project. Empty selection throws. `test:coverage` chains it only after Vitest succeeds. The report
is for review, not a maximum-file or line-count limit. Test count and timing targets never justify
removing unique protection or disguising an unrun gate.

## 5. Guard registration and removal

`docs/rebuild/guard-inventory.json` is the machine-readable guard inventory. Every active entry
names a unique guard, file, owner, invariant, and `replacementRequired: true`.
`tests/architecture/tooling/guard-manifest.test.ts` compares active files to recursive discovery of
`tests/architecture/` in both directions. An unregistered file or missing active file fails. A
planned or retired file cannot appear as an unclaimed architecture test.

A new guard accompanies a real recurring mistake. Its production target, violating fixture,
inventory row, and owning documentation land together. A positive control establishes the valid
case; a negative control establishes that the actual guard rejects the defect. An active scanner
must resolve a nonempty production file set. A literal name, comment, or unused function is not
executable enforcement.

Removal names where the invariant goes and updates its inventory entry and consumers in the same
change. The manifest protects against accidental removal or glob orphaning. It cannot prevent a
coordinated edit to both a guard and its inventory row. Review and operator authorization remain
the boundary for deliberate loss of protection. The inventory still uses machine-owned retirement
and activation fields; this prose does not alter their schema or statuses.

### 5.1 Required source scanners

`tests/architecture/tooling/helpers/ratchet-arms.ts` owns the nine scanners named in
`rebuildRatchetActivation.requiredGuardNames`. `guard-manifest.test.ts` runs each over the real tree
and its own violating scratch fixture. The scanners are not separate inventory guard files.

| Scanner | Current scope | Refusal |
| --- | --- | --- |
| `fail-loud-catch-default` | `src` | Catch or promise-catch returning/assigning a bare default instead of a distinguishable result or failure. |
| `nullish-literal-data-fallback` | `src` except `src/dashboard/` | Data-shaped `??` expressions supplying literal data defaults. |
| `wait-for-timeout-allowlist` | `src/backend/systems`, `src/backend/processing`, `src/workflows` | `waitForTimeout` calls. |
| `inline-selectors-workflows` | The preceding roots, paths containing `/tasks/` | Raw page/locator operations or types inside tasks. Driver recipe anchors own the separate driver selector boundary. |
| `evaluate-named-fn` | Systems, processing, workflows | Named functions passed to `evaluate` or `evaluateAll`. |
| `import-cycles` | `src` | Runtime import cycles. Erased type imports are excluded; value, mixed-value, side-effect imports and exports remain covered. |
| `control-layering` | `src` | Lower-to-higher imports against its current layer classification, including type imports. |
| `code-conventions` | `src` | Disallowed default exports, filenames, non-dashboard TSX, console calls, and raw control bytes. |
| `frontend-tailwind-compliance` | `src/dashboard` | Palette literals, arbitrary z-index, motion without reduced-motion handling, and images without alt text. |

The catch scanner's reviewed exceptions live in
`tests/architecture/tooling/helpers/reviewed-catch-defaults.ts`. Each pins current source bytes,
a reason, and a nonzero original finding. The manifest proves unsafe-catch and independent
comment-only changes invalidate the allowance. This is a source-bound exception, not a growing
count-only waiver.
`runner-invocation-audit.ts` walks the bounded local executable import, re-export, and require closure of each package-declared runner and refuses chains, unresolved or escaping modules, and over-bound walks.

### 5.2 Gate and scope guards

`tests/architecture/runtime/gate-coverage.test.ts` pins the exact `typecheck`, `lint`, `test`,
`test:coverage`, and `test:perf` scripts, the single TypeScript program, all authored `src`, `tests`,
and `scripts` roots,
and the three root configs `vitest.config.ts`, `vite.dashboard.config.ts`, and
`vite.parity.config.ts`. Both lint CLI targets and typed ESLint blocks must cover those inputs.
Warnings and unmatched patterns fail. An inert wrapper containing the expected words fails.

`guard-manifest.test.ts` also pins Vitest topology, reporter selection, exclusion-list digest,
minimum floors, and executable scanners. Registration proves a command remains wired; only its
actual recorded run proves its checks passed.

## 6. Coverage policy

`vitest.config.ts` instruments `src/**/*.ts` and `src/**/*.tsx` with V8 and reports `text` and
`lcov`. Its configured hard floors are:

| Scope | Lines | Statements | Functions | Branches |
| --- | --- | --- | --- | --- |
| Global | 60% | 60% | 60% | Reported, not enforced. |
| Named safety files and globs | 80% | 80% | 80% | Reported, not enforced. |

The exact safety-file list is `coverage.thresholds` in `vitest.config.ts`; it includes runtime
execution, commands, claim/terminal/run services, write sequencing/recovery/binding, checkpoint and
gate paths, evidence/summary/artifact projections, provider invocation, authority storage, and
maintenance. Its broad patterns include `src/**/*write-sequencer*.ts`,
`src/backend/runtime/**/write-sequencer.ts`, `src/**/*recovery*.ts`, and
`src/**/*projection*.ts`. The configuration, rather than a second prose list, owns their membership.

`REBUILD_COVERAGE_FLOORS.branches` declares 50 global and 70 safety-critical values, but
`coverage.thresholds` contains no branch threshold. Those constants do not create a branch gate.
The global configured floor is 60, not 80.

The sole exclusion is `src/generated/**/*.ts`, declared planned with owner `src/generated` and
reason "Generated projections are verified by determinism guards." The manifest verifies the
serialized exclusion-list SHA-256 from `guard-inventory.json`. A planned owner must not exist or
match files. An active owner must exist and match files. Owners must be exact, independent paths,
with nonempty reasons. An exclusion cannot silently grow into a parent scope.

## 7. Desktop parity

`npm run test:parity` invokes `tsx scripts/verify-parity-json.ts assert`. The wrapper launches
Playwright through `playwright.parity.config.ts`, owns the JSON report, and validates current
execution evidence. `npm run test:parity:update` selects explicit update mode. A reference update
requires the operator-approved UI change or signed-off served-workflow switch and a separate commit;
wiring does not refresh references to pass.

The lane uses headless Chromium, 1280×720, device scale factor 1, no mobile/touch emulation,
`fullyParallel: true`, two workers, zero retries, and a **120,000 ms** test timeout. Default captures
use `graphite-warm` with `data-demo-theme="dark"`. Explicit interaction cases may exercise other
supported desktop conditions.

`tests/parity/helpers/global-setup.ts` builds or verifies the parity bundle once before workers.
`helpers/bundle.ts` owns `dist/parity-dashboard` and its input/output stamp.
`helpers/workflow-composition.ts` explicitly selects fixture or seeded composition. BFFs use
owned temporary state and ephemeral ports, not live runtime ports or HR state. A fixture must
contain the exact state its assertion claims to cover.

`tests/parity/references/` stores PNG, `.a11y.yml`, and `.meta.json` reference triples.
`helpers/reference-store.ts` compares accessibility and metadata byte for byte. Screenshot checks
use `maxDiffPixels: 0` and `threshold: 0.2`. Zero counted differing pixels are allowed. The threshold
is per-pixel color tolerance, so a subtle uniform color change can escape that comparison.
Token, semantic, and interaction checks cover separate claims. Assert mode uses
`updateSnapshots: "none"`; missing or changed references fail and remain unchanged. One explicit
update mode refreshes all halves together.

`scripts/verify-parity-json.ts` refuses reporter, output, retry, and snapshot-policy bypasses.
It rejects stale/malformed JSON, unsafe report paths, missing required accessibility declarations
or body-backed attachments, duplicate evidence names, wrong digests, and non-passing required
producers. The child exit and fresh validated JSON are both required. An old report is not evidence
for a new run. Outputs live under ignored `tests/parity/.output/`.

The parity child uses runner containment with an inactivity bound of **180,000 ms** without
stdout/stderr. A stall fails, preserves diagnostics, and stops the group with TERM then KILL.
Continuous output can defeat an inactivity bound; it does not prove progress. Inner deadlines
remain unchanged. [Dashboard parity](../../../src/dashboard/PARITY.md) owns detailed scene and
verification rules; [frontend/backend integration](frontend-backend-integration.md) owns wiring
acceptance.

## 8. Behavior and safety test owners

The owning references define domain protections. The inventory points to their guards; this table
names current test homes rather than duplicating every invariant or registered name.

| Seam | Architecture owner | Production enforcement owner |
| --- | --- | --- |
| Declaration, graph, task effects and strict schemas | `tests/architecture/workflow-kit/` | `src/workflow-kit/`, `src/models/`, and registry composition under `src/backend/app/registries/`. |
| Prepare/commit pairing, permanent key, atomic outbox, negative recovery, artifacts, receipts | `tests/architecture/runs/` | `src/backend/runtime/writes/`, `src/backend/runs/`, and `src/backend/storage/sqlite/`. |
| Subject and identity approval, session leases, deadlines, Duo, worker teardown | `tests/architecture/runtime/` | `src/backend/runtime/{writes,gates,browser,workers,scheduling}/`. |
| Native authority and lifecycle SQL, backups and stopped admission | `tests/architecture/storage/` | `src/backend/storage/{sqlite,admission,maintenance}/`. |
| Semantic UI registry and UCPath identity extraction | `tests/architecture/systems/` | `src/backend/systems/<system>/driver/`. |
| Intake mapping, canonical fields, OCR parity and provider boundaries | `tests/architecture/processing/` | `src/backend/processing/` and schema/registry owners. |
| Served wire, component/module boundaries, counts, settings, connectivity | `tests/architecture/dashboard/` and `tests/architecture/runs/one-projection-counts.test.ts` | `src/backend/transports/http/`, `src/backend/runs/projections/`, and `src/dashboard/`. |
| Local/remote evidence and secret egress | `tests/architecture/logs/` | Classified producers, `src/rules/redaction/`, and `src/backend/logs/`. |

A test name can outlive a removed product capability. Its current assertions, source owner, and
inventory status determine what it proves. A pure graph test cannot certify live selector or system
readiness. A mocked notification port cannot certify OS delivery. An unchanged table count cannot
certify preservation of its contents.

## 9. Change checklists

A workflow change accounts for its contract schemas, implementations, task registries, compiled
workflow, projections, fixtures, type tests, and served consumers. Tests cover changed bindings,
branches, omission/retry rules, and completion/refusal arms at their actual owning seams.
Write behavior also preserves subject proof before fencing, prepare/commit lease identity,
no-write rehearsal, crash/recovery atomicity, permanent-key reuse, saved-effect verification,
and UNKNOWN-submit refusal. [Write safety](write-safety.md) owns those runtime rules.

A dashboard change accounts for the client/shared schema, producer/view-model, callbacks, mounted
controls, and every consumer of changed shared data. Wiring tests exercise both command refusal
arms (`rejected` and `conflict`), late settlements, request identity, and focus/remount behavior
where relevant. A visible assertion pairs with an independent wire or authority fact. Parity proves
presentation with mock values; it does not prove production service readiness.

Focused tests establish the changed behavior, then lint and affected generated checks establish
the candidate. Full acceptance uses the assigned final gate. Actual commands, exits, failures,
reused evidence, and unrun obligations appear in the brief receipt. Workarounds remain findings,
not silent passes.

## 10. Rehearsal and test-data provenance

Workflow execution uses the signed-in dashboard Run surface and its canonical start-plan,
command and worker composition. `src/models/trust/dry-run-scenario.ts` owns rehearsal
declarations; `tests/support/helpers/dry-run-scenario-fixtures.ts` owns verification-only evidence
assertions and orchestration. Its injected operations use current canonical owners; it grants no
runtime authority. `src/backend/app/dry-run/manifests.ts` retains manifests used to validate
committed test-target inputs.

The `dry-run-preview` arm requires a transaction graph and its derived stopping transaction.
The `live-read` evidence arm requires a graph without transactions or delegated effects that its
zero-delta proof cannot observe. A transaction preview uses `dryRun: true`; a transaction-free
read uses its ordinary mode. Assertions compare per-run authority evidence and exact
write-intent/attempt/outbox deltas, never progress text. Ordinary checkpoints, gate results, and
terminal rows are legitimate rehearsal effects. Complete ordered receipt verification retains
absent, ambiguous, and unknown verdicts separately.

A case may declare `screenshots: { nodes: [...] }` with ordered unique task-point IDs. The
operator's Run choice must enable browser screenshots to collect that evidence; the declaration
does not change runtime options. Verification requires exact node order, checkpoint attempts and
unique bundle/artifact pairs. Canonical run capture and timeline readers bind run, node, attempt,
browser session, bundle and artifact identities. Generic lease diagnostics do not satisfy these
assertions. A declaration alone does not prove an executed run.

### 10.5 The subject registry — labels in the repo, values outside it

`config/test-data.json` owns shared subjects, named files, and synthetic samples.
`src/models/config/test-data.ts` owns its strict grammar.
`src/backend/app/registries/test-data.ts` owns tracked reads relative to this checkout's module
location or an explicit absolute repository root. It rejects duplicate keys, path escapes,
missing/empty files, and a declared PDF without PDF bytes. Reusable samples are frozen; builders
return independent mutable copies.

`src/backend/app/registries/test-target-registry.ts` validates subject labels, availability,
workflow/kind arms, provenance, pending fields, and usage restrictions.
Unavailable subjects or pending leaves block before private input reads and browser composition.
An available subject with incomplete undeclared input is a defect, not a successful skip. A dated
availability claim is not a current observation of the external HR system.

Private named values live only in ignored `config/test-data.local.json`, with its tracked example.
`src/backend/storage/configuration/test-data-local.ts` validates requested inputs and files.
It does not search another CWD/worktree or fall back to `.env` or protected Settings. Refusals name
public labels and input keys, not private values. A configured input proves addressability only;
readiness requires the actual admitted execution and evidence.

### 10.6 Durable rehearsal evidence

`src/backend/runs/provenance/test-data-usage.ts` records value-free source identity in run
provenance. `src/models/trust/dry-run-scenario-result.ts` defines the durable
`dryrun_results` record, inserted through `src/backend/storage/sqlite/authority-database.ts`.
The result binds manifest digest, subject label, run/trace identity, assertion outcomes, verdict,
time, and measured duration. `met`, `blocked`, and `failed` remain distinct. A blocked result proves
that execution did not proceed, and a changed manifest invalidates reuse of an earlier result for
the new assertions. Durable receipt evidence is separate from terminal display status.
`dryrun_results` admits exact result-id replay and refuses divergent replay or updates; deletion requires the owning `deleted_runs` tombstone.

## Not built yet

- Wiring-base and per-workflow acceptance still need the operator's served-screen sign-off and admitted live evidence; fixture/parity success cannot supply either.
- Current workflows have no executable `tests/scenario/` rehearsal corpus; manifest-backed live proof must exist before it can be reported as run.
