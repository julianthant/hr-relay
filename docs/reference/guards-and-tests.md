# Guards and tests

This reference describes test selection, runner containment, coverage policy and guard registration.
[Root instructions](../../AGENTS.md#checks) own agent check schedules and runner authorization.
[The codebase map](codebase-structure.md) owns source and test locations. The assigned brief owns
acceptance scope and the gate schedule. A declared test, scenario ID, or guard is not evidence that
it ran.

Tracked TypeScript files use LF on every platform through `.gitattributes`. The build id and
reviewed-source pins hash the exact checkout bytes; consistent line endings preserve those byte
checks when generation moves between Windows, macOS and Linux.

## Contract fingerprints and build id

`compileWorkflow` computes `descriptor.contractFingerprint` in memory from the declared shapes only: the
workflow-kit version (`WORKFLOW_KIT_VERSION`), id, version, input, canonical input and result schema
hashes, the entry graph, and each task contract's id, effect and schema hashes. `taskImplFingerprint`
derives a checkpoint's `implFingerprint` the same way. No file is generated and no source is read, so
compilation stays browser-safe, and shared code edits never invalidate Retry, Recover or claims.

The app build id (`src/backend/runtime/build-id.ts`) hashes the worker-runnable source under `src/backend`,
`src/workflow-kit`, `src/workflows`, `src/models`, `src/rules` and `src/cli.ts`, the `package-lock.json`
entries those files load (ordinary, optional and peer dependencies with nested resolution, every recorded
platform binary included) and the Node version. `src/dashboard` and frontend-only packages are excluded.
`scripts/dev/secure-env-bootstrap.ts` captures it before loading the application graph; a worker refuses
to start when its id differs from its parent's. A missing source root, an unresolved required dependency
or an unclassifiable import specifier stops startup by name. The id is stamped on each run envelope and
checked only before a write's first effect; it never enters a contract fingerprint or claim, Retry or
Recover admission.

`scripts/build/windows-observer-policy.ts` bundles the canonical shared `privatePathRejects`
implementation as CommonJS for the two isolated Windows SQLite observers. esbuild is a direct
pinned build dependency; Node builtins and Koffi remain external. The ignored artifact and input/digest
metadata live under `node_modules/.cache/relay/`. `npm run build:observer-policy` prepares them; it runs
before the CLI, dashboard, backend, smoke and benchmark commands and from the Vitest and Vite configs.
`npm run build:observer-policy -- --check` rebuilds expected bytes in memory and refuses missing or stale
outputs without writing. Unchanged bytes keep their timestamps.

Only Windows observer calls validate the metadata's confined public source/dependency inputs and
artifact SHA256; the child checks its artifact again before loading the shared native policy. Missing,
stale or changed assets refuse explicitly. There is no runtime build or TypeScript loader. POSIX
children retain plain CommonJS and never read this Windows asset. Restart source tools after changing
canonical policy inputs. Future desktop packaging must embed and bind expected metadata, ship the
artifact and Koffi, and validate independently before bundling; absent source files never imply a
packaged mode. That packaging mode is not implemented by this source build.

## 1. Test layers and ownership

The [root codebase instructions](../../AGENTS.md#codebase) own source mirroring and filenames.

`tests/architecture/test-layout.test.ts` checks canonical filenames and existing tracked source
owners. It permits the exact `architecture/`, `mocks/`, `perf/`, `types/`, and `support/` subtrees
to have their own organization. It rejects alternate test suffixes, unmatched source paths, and
helpers that hide test registrations behind a helper-style name.

| Layer | Owner and selection | Evidence |
| --- | --- | --- |
| Unit | `<module>.test.ts`; Vitest `unit` | Deterministic decisions, schemas, fake task contexts, and DOM wiring with injected ports. |
| Integration | `<module>.integration.test.ts`; Vitest `integration` | Real isolated SQLite, sockets, processes, browser adapters, and composed execution. |
| Architecture | `tests/architecture/**/*.test.ts`; Vitest `architecture` | Repository-wide boundaries, registries, source/AST checks, and negative controls. Some guards also exercise real adapters. |
| Types | `tests/types/`; `npm run typecheck` | Type inference and illegal calls pinned with `@ts-expect-error` and positive controls. |
| Mock scenes | `tests/mocks/`; `npm run mocks` | `/ui-mock` frames rendered from the mock build. Not a test gate; CI never runs it. |
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
in place. Generator behavior is exercised in scratch directories so parallel
readers cannot observe temporary corruption or silently repaired inputs.

Vitest fixtures and mock scenes use `America/Los_Angeles` explicitly. Mock browser contexts
use the same zone, so reviewed local dates and times do not depend on the host's time zone.

## 2. Vitest selection and commands

`vitest.config.ts` defines five named projects. `guard-manifest.test.ts` audits exact includes,
excludes, reporters, and single ownership of the test corpus. Unit, integration, architecture and
perf fail when empty. The local project may be empty: that is the absence of an operator-machine
test, and `npm run test:local` passes `--passWithNoTests=true` for it. Cloud runs select unit,
integration and architecture only. Coverage stays on those three and does not select local.

| Project | Include | Exclude |
| --- | --- | --- |
| `unit` | `tests/**/*.test.ts` | `tests/**/*.integration.test.ts`, `tests/**/*.local.test.ts`, `tests/architecture/**`, `tests/mocks/**`, `tests/perf/**` |
| `integration` | `tests/**/*.integration.test.ts` | `tests/**/*.local.integration.test.ts`, `tests/perf/**` |
| `architecture` | `tests/architecture/**/*.test.ts` | `tests/**/*.local.test.ts`, `tests/**/*.local.integration.test.ts` |
| `perf` | `tests/perf/**/*.test.ts` | `tests/**/*.local.test.ts`, `tests/**/*.local.integration.test.ts` |
| `local` | `tests/**/*.local.test.ts`, `tests/**/*.local.integration.test.ts` | `tests/mocks/**` |

`tests/mocks/` is outside Vitest. There is no scenario project or current `tests/scenario/`
corpus. Scenario declarations retained in workflow/contracts are graph metadata, not execution
results. Role-derived scenario paths do not prove that a file exists.

| Command | Exact package script or purpose |
| --- | --- |
| `npm run test -- <paths>` | `vitest run --project unit --project integration --project architecture --project perf`. A bare run does not select `local`. |
| `npm run test:unit -- <paths>` | `vitest run --project unit --passWithNoTests=false`. |
| `npm run test:integration -- <paths>` | `vitest run --project integration --passWithNoTests=false`. |
| `npm run test:architecture -- <paths>` | `vitest run --project architecture --passWithNoTests=false`. |
| `npm run test:local -- <paths>` | `vitest run --project local --passWithNoTests=true`. |
| `npm run test:coverage` | Local only: `vitest run --coverage --project unit --project integration --project architecture`. No workflow runs coverage; floors are unchanged. |
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
`staging.yml` (`Staging`) triggers for staging pull requests and pushes to `staging` and admits the `checks.yml`
call with kind `portable`; its `staging` gate fails when `names` or `checks` failed or was cancelled.
The merge train runs after that gate, on a push and on auto-merge, outside admission. `production.yml`
(`Production`) triggers for main pull requests or an operator manual start with a required `title` input
and admits `checks.yml` with kind `release`, which plans the native and complete release pipeline; its
`production` gate fails when `checks` failed or was cancelled, and for a pull request head other than `staging` or `hotfix/*`.
Both workflows call the same file, which uses shared typed
selection/result/timing policy from `scripts/test/ci-plan.ts` and explicitly retain test budgets.
The root check rules own platform placement and release authorization.
`scripts/test/ci-files.ts` names the native
files: `NATIVE_FILES` (storage closure, backup and restore proofs requiring native runners, unit and
integration) and `SERIAL_FILES` (native browser process proofs that require file isolation). `scripts/test/ci-run.sh` lists a project through
Vitest, selects the job's files with that script and passes the paths explicitly; Vitest 4.1.11's
CLI exclusions do not reach these named projects. Local unit and integration projects exclude every
`NATIVE_FILES`, `SERIAL_FILES` and `SERIAL_STORAGE_FILES` entry unless `RELAY_TEST_NATIVE=1`.
`ci-run.sh` sets that variable before it lists, so each slice still selects the same files. Naming
an excluded file on the Vitest command line prints that the variable is required and does not run
the file. `npm run test:pc` sets `RELAY_TEST_NATIVE=1` for its Vitest listing and for the remote
Vitest run. Its native filter is unchanged. Selection refuses when a named file is no longer
listed. Files are packed longest first onto the least-loaded job using
the preceding successful run's `ci-timings` artifact, seeded by `scripts/test/ci-durations.json`
when none is retained; unmeasured files count as the positive median, or one second.
Zero-rounded measurements still receive positive work. Native proofs and `SERIAL_STORAGE_FILES`
count their full time and run in separate single-worker invocations. The padded-receipt upgrade
and startup-upgrade fixture run in the storage group: their stopped backups and real native
closure probes require isolation from competing storage files within their existing budgets.
Other native files count half because two workers share them.

| Job | Runner | Jobs | Contents |
| --- | --- | --- | --- |
| unit | Ubuntu | 3 | unit files except `NATIVE_FILES`, plus `LINUX_NATIVE_FILES` |
| architecture | Ubuntu | 2 | architecture files |
| integration | Ubuntu | 30 | integration files except `NATIVE_FILES` and `SERIAL_FILES`, plus `LINUX_NATIVE_FILES` |
| perf | Ubuntu | 1 | `npm run test:perf` on ready pull requests |
| smoke | Ubuntu | 1 | `npm run test:smoke` on the built dashboard on ready pull requests |
| native | macOS, operator-started full releases only | 5 | `SERIAL_FILES` alone, `SERIAL_STORAGE_FILES` alone, then native unit and other integration files |

Full staging runs also include `lint`, `static`, `privacy`, `perf` and `smoke`. The job-level whole-pipeline FIFO
admission and draft policy are described in [repository governance](../repository-governance.md).
Each shard downloads the same `ci-balancing` input and uploads Vitest JSON reports as `durations-*`.
Report basenames include the runner OS and selection group, so merged artifacts preserve both platforms.
For a file reported by both platforms, the shared timing map retains the slower observation regardless
of report order. CI merges successful groups into inherited timings and publishes `ci-timings` for the next run;
omitted suites retain their prior measurements. When shard end times spread more than a minute,
also refresh the committed seed from a successful run:
`gh run download <run-id> -n ci-timings -D <dir>` then copy its generated `ci-durations.json` to
`scripts/test/ci-durations.json`. Corrupt reports and download failures fail CI.
A new test file requiring native platform proofs belongs in `NATIVE_FILES`, outside Ubuntu shards.
`LINUX_NATIVE_FILES` names the `NATIVE_FILES` members that pass on Linux (28 files, never a serial or storage file; the READY-bound upgrade proof is four files that share `tests/support/helpers/storage/ready-bound-upgrade.ts`): Ubuntu shards run them because `ci-run.sh` sets `RELAY_TEST_NATIVE=1`, and the macOS native shards still run them. `npm run test:pc` sets that variable for its listing and remote run, so its unchanged filter still keeps them. `tests/scripts/test/ci-files.test.ts` pins the list.
Both platforms select from this one list; platform refusals remain failures until their proof is implemented.

### Pre-push tests on the PC

The PC runner executes the whole portable architecture suite and the unit and integration tests
affected by the diff against `origin/staging` in WSL Ubuntu. Before a push is cleared, the main Mac
runs `npm run test:pc` without file arguments. A backend host runs
`npx vitest run --project architecture`, then
`npx vitest run --project unit --project integration --changed=origin/staging` in the ticket checkout
under its assigned test slot.
The [root check rules](../../AGENTS.md#checks) and assigned local operations note govern its use:

```sh
export RELAY_TEST_HOST=user@your-wsl-tailnet-node
npm run test:pc                            # all architecture + affected unit and integration
npm run test:pc -- tests/scripts/test/pc.test.ts
npm run test:pc -- 'tests/backend/runs/**/*.integration.test.ts'
```

The PC needs tailnet-only SSH (prefer Tailscale SSH with its systemd service enabled), Node
satisfying `package.json`, Git, flock, and Chromium's libraries installed with
`npx playwright install --with-deps chromium`. Keep its private host in local configuration.
Normal SSH host verification applies.

With no file arguments, Vitest lists the architecture project in full and lists unit and integration
with `--changed=origin/staging`. With file arguments, it lists all three projects without a changed
filter and selects only the requested paths or globs. The runner subtracts `NATIVE_FILES`,
`SERIAL_FILES` and `SERIAL_STORAGE_FILES`, except `LINUX_NATIVE_FILES`, with one skip note. Those files run in GitHub CI. Each leased slot fetches
`origin/staging`'s pinned commit directly from the public GitHub repository. The Mac verifies that
base is advertised by origin before sending a binary Git patch of the allowed candidate tree.
The patch includes committed-but-unpushed, staged, unstaged and untracked non-ignored files,
deletions, renames, executable modes and binary bytes. Credentials, private inputs, runtime state,
dependencies and build output remain excluded from the candidate and filtered base. Absolute,
escaping and private-target symlinks are refused; safe relative links retain their targets.

Before install or tests, the slot checks the applied Git tree and independently hashes the actual
file set, paths, executable modes, symlink targets and raw contents against the Mac's candidate.
Any mismatch fails the run. There is no full-source fallback. Each run has a private local object
store/index; each slot retains its own Git object cache and `node_modules` under its lease.
Git checkout filters and line-ending conversions are disabled for source materialization.
Edits after candidate capture belong to the next run. Remote test Git metadata retains the Mac's
index for inventory guards, without history; the transport cache is outside the test checkout.

Three independent slots under `~/.cache/relay-test-pc/` retain separate `node_modules` while the
lockfile hash is unchanged. A kernel lock holds the slot through sync and execution; a run takes
a free slot or waits. After measuring integration load,
capacity can be set in `~/.config/relay-test-pc/slots` (1..16; change only while idle). Integration
runs build the dashboard as CI does. Test environment values come from `checks.yml`, temp files
use `/dev/shm`, and each run uses at most two Vitest workers.

Output streams and is saved with a final `result.json` under the main checkout's ignored
`.work/test-pc/<run-id>/`. The printed result path records selected files, slot, exit code and
elapsed time. Its `source` records `baseCommit`, candidate Git `tree`, raw tree `identity` (SHA-256)
and `deltaBytes` (patch payload size). The command exits with the remote test result.

The receipt also contains its `runId`, `timings` and `timingErrors`. Each timing records `phase`,
`startedAt` (UTC), `durationMs` and `outcome` (`completed`, `failed` or `skipped`). Local phases are
`listing`, `source-capture` (published base verification and candidate snapshot), `admission`
(waiting for the slot marker), `source-sync` and `request-sync`. Remote phases are `source-prepare`
(GitHub fetch, patch application and identity proof), `install` (npm plus Chromium installation,
or a cache hit), `build`, `test`, `cleanup` (tmpfs)
and `lease-release`. Skipped builds and cached installs are explicit; phases never reached after a
failure are absent. All durations use Node's monotonic clock, including the shell's install/release
timers. Compare durations rather than subtracting clocks across machines.

Remote timing lines carry the invocation UUID and are validated before collection. Malformed or
foreign timing events are reported on stderr and retained in `timingErrors`; they do not replace
the command's exit code. A receipt with timing errors cannot establish complete phase measurements.
Source membership, private exclusions, index binding and deadlines are unchanged. A failed source
preparation releases its normally held lease without running install or tests; an interrupted
connection still retains its lease for ownership verification.

To run in the background:

```sh
npm run test:pc -- tests/scripts/test/pc.test.ts > /tmp/relay-test-pc.log 2>&1 &
```

A dropped connection can retain a slot's `lease` directory. Verify that its sync, install, build
and tests have stopped before removing that exact empty directory with `rmdir`. Never remove a
live lease. GitHub CI remains the merge gate.

### CI scheduling

A full staging run uses three Ubuntu unit shards, two architecture shards and thirty integration shards, plus lint, static, privacy, perf and smoke. Ubuntu unit and integration use three workers. macOS native unit and integration use two. Serial and storage use one. Ubuntu jobs put test temp on tmpfs and have 20-minute
budgets; macOS jobs use a RAM disk with Spotlight indexing off and have 30-minute budgets. Budgets are
hang guards. CI sets `RELAY_TEST_TIME_SCALE=2.5`; `tests/support/time-scale.ts` multiplies the
Vitest test and hook limits, test wait helpers and the browser deadlines tests pass to product code by it.
Local runs use 1. Product defaults are unchanged. Remaining steps run after a failed serial proof
unless the workflow is cancelled, preserving failure visibility, and any shard failure fails its suite.

PR filtering uses these rules. Lint, static and privacy always run, including on a draft pull request. Every ready pull request also runs
perf and smoke in separate Ubuntu jobs, including Markdown-only changes. Both jobs install Chromium,
build the dashboard and use tmpfs for test temp, like an Ubuntu integration shard. Drafts and
manual releases select neither job. Draft PRs select only affected unit files;
`ready_for_review` triggers all applicable suites. Only operator-started manual full-release
dispatches bypass the draft limit.

| Changed paths | Routine suites selected |
| --- | --- |
| Markdown only | None. |
| Source, scripts, configuration, dependencies, shared test helpers or fixtures, unknown non-Markdown paths | Unit, integration and architecture. |
| Unit test files only | Unit and architecture. |
| Integration test files only | Integration and architecture. |
| Architecture test files only | Architecture. |
| Mock scene files only | Architecture. |
| Mock scene helpers, fixtures or entrypoints | Unit, integration and architecture; unit and integration also import these. |
| Local or perf test files only | Architecture; local remains machine-only. Ready PRs also run perf and smoke. |

Select the union for mixed changes. Staging PRs execute the portable plan plus perf and smoke.
Valid `staging` or `hotfix/*` → `main` releases also select native work. Other heads into main omit
native work and fail the required source-head check. Operator manual releases select all routine
native suites. Machine-readable docs count as configuration. Release authorization belongs to the
root check rules. Protected branch pushes do not repeat CI.

Both event entries use per-PR/manual-branch workflow concurrency with cancellation enabled. New
pushes supersede older runs for the same workflow/PR-or-ref key. Each entry admits one complete
reusable check call with `queue: max` and `cancel-in-progress: false`. Staging uses the `ci-runners`
FIFO. Release runs in its own lane and neither waits behind nor blocks staging pull-request runs.
Every mandatory proof, including perf and smoke, and timing publication remains
inside that callee; no callee reacquires admission. Merge train follows the five top summaries
outside the admitted call; the standalone staging-push train is unchanged.

`checks.yml` is the only file that defines test jobs and has no `timings` job. Its jobs are `changes`, `lint`, `static`,
`privacy`, `ubuntu`, `macos`, `unit-proofs`, `integration`, `architecture`, `perf`, `smoke` and `unit`; the plan
empties `macos` outside a full release, and `unit-proofs` runs only for the release kind. Its `unit` runs unless cancelled, with one checkout and one install.
It checks proofs, merges durations, uploads `ci-timings` only when every proof passed, then runs
final verification, rejecting failed, cancelled or missing outcomes. Cancellation stops its checkout/install work.
It requires successful perf and smoke results on ready PRs, and exactly skipped results when omitted. The required outer `unit` always validates
both the complete call result and inner unit output as success. Train is excluded from the inner
fence because it runs downstream. Portable selected suites require Ubuntu success. Selected
eligible full-release unit/integration require both native platforms to succeed, regardless of
matrix absence or emptiness; native omission is valid only outside such a selected suite.
An expected omission must be exactly skipped. Invalid
selectors, matrix counts and missing outputs never become successful defaults.

Timing discovery first enumerates registered IDs for exactly the CI and release workflow paths.
It can therefore use CI history before a new release workflow is registered, without ignoring a
404 or any other API error. Both successful feeds are sorted together; the newest retained timing
artifact wins, and no-history/no-retained-artifact is the valid committed-seed case.

Membership verification compares an unsharded `vitest list --filesOnly --json` for unit,
integration and architecture with the union of the exact CI selections. `tests/scripts/test/ci-files.test.ts`
proves the selections give each file to exactly one job, so selected paths need no Vitest sharding.
`tests/scripts/test/ci-plan.test.ts` tests the shared typed plan, proof and timing policy.
`tests/scripts/test/ci-files.workflow.test.ts` tests actual event entry filters, supersession and transitive admission coverage,
selection/history adapters and actual summary-shell failures for staging, source/head, Markdown
and manual cases. Source/API-list checks are not the Actions graph proof: the operator reviews
the actual published staging graph to confirm no release workflow is loaded.
Coverage is local only through `npm run test:coverage`, with unchanged floors. Local project selection is unchanged.

## 3. Private test temporary directory

`tests/support/private-temp-setup.ts` runs once from Vitest's root global setup, shared by all
selected projects. It creates one directory with
`fs.mkdtemp` under `os.tmpdir()` (mode `0700` on POSIX; the per-user temp on Windows), points
`TMPDIR`, `TMP`, and `TEMP` at it for the workers, and removes it when the run ends.
`KEEP_TEST_TMP=1` keeps the directory. `tests/support/private-temp.test.ts` checks the directory
the workers see; `private-temp.integration.test.ts` checks project setup, invocation isolation,
permissions, compiled-loader reuse and parent/peer-safe teardown.

`compiled-process-setup.ts` transpiles source, scripts and shared test fixtures once into that
private directory. Test child commands use `testProcessImport()` instead of tsx. Its Node hook
loads cached JavaScript while retaining source URLs, direct-execution checks, IPC and scratch
checkout resolution. Each module is keyed by its TypeScript/TSX loader and source bytes; changed
or test-created sources are compiled on first use. A new run rebuilds the cache with the current
compiler and configuration. Product launch commands and the explicit tsx serialization test keep
tsx. The mock scene runner's global setup shares the same preparation and cleanup.

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

The mock scene runner launches Playwright directly. After 180 seconds without output it kills that child and
its descendants, and only then releases the command lock. It does not take a suite lock. The
command lock remains the private file under `.tracker/data/locks`.

`scripts/test/artifact-policy.ts` and its architecture owner keep generated coverage/test output
untracked and ignored, checking ignore rules independently of index membership. Correcting the
index is an explicit repository operation. Accepted task evidence belongs in the main checkout's ignored `.work/`
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

`tests/architecture/logs/redaction-surface-scan.workbook.test.ts` pins the exact 55
`captured-hr-value` origins for mutable type labels, required-field IDs and values-only workbook
actions across request, status and durable records. These private values remain in
`operator-loopback` or `durable-authority` custody without retention exceptions. Each omitted
origin fails independently, and every leaf refuses process and OS-notification egress. The guard
also pins the exact five-field type shape and origin membership in retained workbook references
and start-plan references, keeping mutable editor metadata out of those retained types.

Canary tests first prove the planted value reaches the input, then exercise the real boundary.
A fake emitter or no-op collector that bypasses validation cannot prove the persistence schema or
provenance contract. Producer union coverage enumerates every emitted arm, including early-return
and refusal arms, rather than sampling a few shapes.

## 4. Verification checklist

The [root check rules](../../AGENTS.md#checks) own focused work, documentation-only validation,
pre-review checks and release gates. The assigned brief supplies exact paths and commands.

Coverage selects unit, integration and architecture without perf. The perf project runs without
coverage instrumentation. Focused success covers only selected files. Required broad checks
remain assigned to the finalizer; a resource refusal leaves a check unrun.

Reused evidence identifies its tested tree, command/result, current candidate and verified unchanged
inputs. A changed contract, generator input, fixture, config or test-parsed document invalidates
affected evidence. A recording-only commit leaves unchanged code evidence applicable. Dated live
results describe their observation time, rather than current external readiness.

## 5. Guard registration and removal

`docs/guard-inventory.json` is the machine-readable guard inventory. Every active entry
names a unique guard, file, owner, invariant, and `replacementRequired: true`.
`tests/architecture/tooling/guard-manifest.test.ts` compares active files to recursive discovery of
`tests/architecture/` in both directions. An unregistered file or missing active file fails. A
planned or retired file cannot appear as an unclaimed architecture test.

A new guard accompanies a real recurring mistake. Its production target, violating fixture,
inventory row, and owning documentation land together. A positive control establishes the valid
case; a negative control establishes that the actual guard rejects the defect. An active scanner
must resolve a nonempty production file set. A literal name, comment, or unused function is not
executable enforcement.

`names-check` (`tests/architecture/tooling/names-check.test.ts`) runs the shipped `names:check`
command over the shared table in `tests/support/helpers/names-check-cases.ts`. A wrong name was
reaching CI and spending a full run. Allowed branches are `main`, `staging`, `dependabot/*`,
`feature/<kebab>`, `task/<kebab>/<kebab>`, `fix/<kebab>-<kebab>`, `chore/<kebab>-<kebab>`, and `design/<kebab>`. A staging pull request head must be `feature/*`, `fix/*` or `chore/*`, except
`dependabot/*`. A non-dependabot title must be `<Area>: <text>`; a conventional title such as
`feat(ci): add names check` is rejected. An origin branch that already matches
`task/<feature>/<lane>` stays valid when its lane is an older name. A worktree folder is
`.worktrees/<feature>` or `.worktrees/<feature>.<lane>`. `.github/workflows/staging.yml` runs that
command as its first job, and every other job waits on it. `pull_request` includes `edited`, so a
title change at the same head runs the check again. `--all` lists off-pattern local branches and
worktrees, and a local branch or linked worktree whose Concord ticket is `complete` or `closed`,
including a detached worktree named by `tasks.worktree`. An open ticket that owns the path, an
open ticket on the checkout branch, or an open ticket on a branch named by a path owner, keeps
that worktree unlisted. A closed checkout branch still lists the path when no open ticket owns it
and no open ticket names a branch recorded on that path. The ledger is
`~/.concord-ledger/<package.json name>/.concord/concord.db`, or the `--ledger` path.
A missing ledger adds no ticket rows. An unreadable ledger fails the command. `--all` only lists;
it never deletes.

Removal names where the invariant goes and updates its inventory entry and consumers in the same
change. The manifest protects against accidental removal or glob orphaning. It cannot prevent a
coordinated edit to both a guard and its inventory row. Review and operator authorization remain
the boundary for deliberate loss of protection. The inventory still uses machine-owned retirement
and activation fields; this prose does not alter their schema or statuses.

The workflow-ID guard (`no-workflow-id-branches`) admits registered ids in generic code only at the
files, and the one directory prefix `src/dashboard/surfaces/workflows/mocks/`, listed with a reason
for named ids; a new branch elsewhere, a stale entry or a missing reason fails.

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
| `frontend-tailwind-compliance` | `src/dashboard` | Palette literals, raw hex colors, arbitrary z-index, motion without reduced-motion handling, and images without alt text. `#245d9e` and `#ffffff` are allowed only in `src/dashboard/surfaces/shell/app-logo.ts`: they are the Baton app icon's fixed plate and white glyph. Any other hex there, or either color in another dashboard file, still fails. |

The catch scanner's reviewed exceptions live in
`tests/architecture/tooling/helpers/reviewed-catch-defaults.ts`. Each file keeps its reviewed reason
and a multiset of statement kind, SHA256 and positive occurrence count. The hash covers the exact
AST source slice from `getStart(source)` to `end`: the complete try/catch/finally statement or the
complete promise `.catch(...)` call, including receiver and arguments. In-span whitespace and
comments remain significant; coordinates and statement order do not participate.
Every finding-bearing statement must match a pin, every pin must match a finding-bearing statement,
and occurrence counts must match exactly. Multiple findings in one handler share one statement pin.
The manifest proves unsafe added catches, changed guarded bodies/handlers/finally blocks and in-span
comments require re-review; deleted, empty, duplicate or overcounted pins fail. Outside comments and
insertions preserve the allowance. This guarantees exact statement identity; changes to callers,
helpers or imports outside the span can still change meaning and need ordinary code review.
`runner-invocation-audit.ts` walks the bounded local executable import, re-export, and require closure of each package-declared runner and refuses chains, unresolved or escaping modules, and over-bound walks.

### 5.2 Gate and scope guards

`tests/architecture/runtime/gate-coverage.test.ts` pins the exact `typecheck`, `lint`, `test`,
`test:coverage`, and `test:perf` scripts, the single TypeScript program, all authored `src`, `tests`,
and `scripts` roots,
and the three root configs `vitest.config.ts`, `vite.dashboard.config.ts`, and
`vite.mocks.config.ts`. Both lint CLI targets and typed ESLint blocks must cover those inputs.
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

## 7. Mock scenes

`npm run mocks` runs Playwright through `playwright.mocks.config.ts` to render `/ui-mock` scenes.
It is not a test gate; CI never runs it.

The lane uses headless Chromium, 1280×720, device scale factor 1, no mobile/touch emulation,
`fullyParallel: true`, two workers, zero retries, and a **120,000 ms** test timeout. Default scenes
use `graphite-warm` with `data-demo-theme="dark"`. Explicit interaction cases may exercise other
supported desktop conditions.

`tests/mocks/helpers/global-setup.ts` builds or verifies the mock bundle once before workers.
`helpers/bundle.ts` owns `dist/mock-dashboard` and its input/output stamp.
`helpers/workflow-composition.ts` explicitly selects fixture or seeded composition. BFFs use
owned temporary state and ephemeral ports, not live runtime ports or HR state. A fixture must
contain the exact state its assertion claims to cover.

Outputs live under ignored `tests/mocks/.output/`.

The mock runner child uses runner containment with an inactivity bound of **180,000 ms** without
stdout/stderr. A stall fails, preserves diagnostics, and stops the group with TERM then KILL.
Continuous output can defeat an inactivity bound; it does not prove progress. Inner deadlines
remain unchanged. [The mock scene runner](../../src/dashboard/MOCKS.md) owns scene rules; [frontend/backend integration](frontend-backend-integration.md) owns wiring
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
where relevant. A visible assertion pairs with an independent wire or authority fact.

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

The `dry-run-preview` arm requires a transaction graph with preparation-only support for every transaction.
Full preview evidence accounts for every declared node and retains the ordered previewed transaction IDs.
The `live-read` evidence arm requires a graph without transactions or delegated effects that its
zero-delta proof cannot observe. A transaction preview uses `dryRun: true`; a transaction-free
read uses its ordinary mode. Assertions compare per-run authority evidence and exact
write-intent/attempt/outbox deltas, never progress text. Ordinary checkpoints, gate results, and
terminal rows are legitimate rehearsal effects. Complete ordered receipt verification retains
absent, ambiguous, and unknown verdicts separately.

A case may declare `screenshots: { nodes: [...] }` with ordered unique task-point IDs.
Declared browser boundaries require capture regardless of `captureBrowserScreenshots`.
Verification requires exact node order, checkpoint attempts and
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

- Wiring-base and per-workflow acceptance still need the operator's served-screen sign-off and admitted live evidence; fixture success cannot supply either.
- Current workflows have no executable `tests/scenario/` rehearsal corpus; manifest-backed live proof must exist before it can be reported as run.
