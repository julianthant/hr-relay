# Execution and sessions

This reference owns worker claims, pools, browser ownership, authentication, Duo leases, and teardown.
Related contracts own [run transitions](workflow-model.md), [task declarations](task-contract.md),
[write recovery](write-safety.md), [configuration](clock-config-secrets.md), and
[dashboard presentation](dashboard-surfaces.md).

## 0. Execution model

`src/backend/runtime/workers/worker-loop.ts` awaits one run per workflow-scoped worker.
Separate workers provide parallelism and own separate browser resources.

## 1. Runtime identities

| Unit | Identity and owner |
| --- | --- |
| Run | `RunRecord.envelope.runId`; `src/backend/runs/lifecycle/run-record-service.ts` owns lifecycle mutation. |
| Worker slot | `WorkerSlotRecord` in `src/models/run/worker-slot.ts`; `worker_slots` stores its workflow, global `ordinal`, `poolIndex`, and `membershipRevision`. |
| Worker lifetime | `WorkerLeaseRecord` in `src/models/run/worker.ts`; `worker_leases` retains each `leaseGeneration` and its process, lifecycle, control, heartbeat, and version. |
| Browser session | A resource's `sessionId`; `WorkerSessionManager` owns the context-backed driver, and `browser_sessions` stores observed identity and health. |
| Profile | `<browserProfileRoot>/w<ordinal>/<system>`; `workerProfileDirectory` in `src/backend/runtime/browser/browser-session-factory.ts` derives the path from an admitted slot. |
| Driver lease | Callback access through `WorkerSessionManager.withDriver` or the write sequencer's `withTransactionDriver`. |
| Workflow batch | `RunSessionRecord.sessionId` in `src/models/run/session.ts`; `run_batches` stores the grouping, and member run rows carry `batch_id`. |
| Duo lease | One credential-keyed row in `auth_leases`, exposed through `authority.duoCeremonyLeases`. |

A slot's worker id is `${workflow}-worker-${ordinal}`. The ordinal is globally allocated and
retained. `poolIndex` is a separate positive workflow member position. Neither a caller nor
a projection derives the worker id from the pool index.

## 2. Declared session needs

`SessionNeedSchema` in `src/models/sessions/session.ts` declares `system`, `access` as `read` or
`transaction`, and `session` as `reuse-worker` or `fresh`. The optional `exclusive` and
`acceptDownloads` properties admit only `true`. Compilation and task registration validate the
need before execution.

`src/workflow-kit/session.ts` owns the session provider contract. `defineWorkerSessionProvider`
authenticates the worker-owned handle; it does not launch a browser. `defineSessionProvider`
requires `exclusive:true` for OnBase and refuses it for other systems.

`reuse-worker` opens lazily or reuses a compatible resource. `fresh` proves closure before replacement.
Only authored needs create boundaries. `browser-session:close` and `browser-session:start` report
boundaries; `browser-session:reset` leaves the browser span open.

`BROWSER_SYSTEM_BINDINGS` in `src/backend/runtime/browser/system-bindings.ts` binds `ucpath`,
`crm`, `kuali`, and `new-kronos` to drivers, login recipes, and authenticated-application verifiers.
The factory refuses an absent binding before browser launch. It also refuses an identity-exclusive
session because the concrete OnBase lease is absent.

### 2.1 Gates and parks

`src/backend/runtime/execution/run-executor.ts` closes sessions through `closeAll("parked")`
before returning a parked outcome.

`WorkerSessionManager.closeAll` in `src/backend/runtime/workers/worker-sessions.ts` rejects new
leases while closing. It waits behind each system's pending callbacks and attempts every owned
system's close. A concurrent `closeAll` throws. Failed closure retains ownership and poison state,
and the aggregate failure names the systems that could not close.

## 3. Worker loop and lease lifecycle

`composeWorkerRuntime` in `src/backend/app/composition/worker-compose.ts` admits the worker slot,
binds its exact process custody, starts its lease, and runs `runWorkerLoop`. CLI parsing requires
`worker <workflow-id> --pool-index <positive-int>` with a positive integer index. `--drain` exits
at the first idle claim result. Supervised launches additionally carry `--worker-id`, `--ordinal`,
`--membership-revision`, and `--launch-command-id`; `admitSupervisedWorker` verifies those values
against the executing Spawn reservation before admitting the child.

The loop handles browser controls, then reads the durable `run`, `pause`, or `stop` directive
between complete runs. Pause claims nothing and keeps the process alive. Stop ends the loop after
the current run settles. An unreadable or malformed directive fails the loop.

SIGINT, SIGTERM, or an injected stop aborts the active run. The executor abandons interrupted
ownership rather than inventing a terminal result. The claim sweeper owns subsequent recovery.

One heartbeat renews the exact worker and `claimGeneration`; lost renewal aborts execution.
`RunRecordService` re-reads authority versions before lifecycle mutation.

Worker composition uses `WORKER_HEARTBEAT_INTERVAL_MS = 5_000`,
`WORKER_CLAIM_STALE_AFTER_MS = 60_000`, and `WORKER_SWEEP_INTERVAL_MS = 30_000`.
Maintenance renews the worker lease and runs claim, write, and expired-worker recovery.
`runWorkerLoop` creates one confirmed-action publisher with a fresh stream id and capacity 256.
It assigns sequence numbers within that incarnation. On exit it closes the publisher before
browser teardown and warns about pending events. Publication health does not settle a run or an
external write.

### 3.0 Startup claim recovery

After `workerLeases.start` succeeds, composition calls `sweepWorkerClaims` for its own `workerId`
before claiming. The new lifetime proves old ownership ended, regardless of run heartbeat age.

`src/backend/runs/lifecycle/run-record-service.ts` owns both sweep scopes: startup uses `workerId`,
periodic maintenance uses `staleBefore`. Exactly one is required; both preserve write-intent checks.

An unfinished `attempting` write routes to recovery before requeue. A run without a legal park
transition remains held. Startup refuses with the run and required operator resolution named.
An unavailable or inconsistent write lookup cannot mean that no write exists.

### 3.1 Dispatch and fairness

`AuthorityDatabase.#claimNextRun` in `src/backend/storage/sqlite/authority-database.ts` selects
only queued runs in the worker's workflow. It orders them by interactive priority, then
`created_at`, then `id`, and excludes future `not_before` values. The canonical claim path also
excludes unsatisfied delegation dependencies and validates runtime settings inside the transaction.

A second active run for the same worker is refused as `worker-busy` through canonical authority;
the lower-level repository arm throws. The loop awaits the claimed run before polling again.

`src/backend/runtime/policies/idle-claim.ts` bounds idle waits by the current idle cadence and the
next eligibility instant. Retry backoff uses `not_before`; a worker does not retain an active run
while waiting for its retry time.

## 4. Browser ownership and reuse

`WorkerSessionManager.withDriver` serializes callback leases per worker and system. Acquisition
requires a bound run fingerprint and refuses during teardown.

`withBoundRunConfigFingerprint` binds the claimed envelope around execution and releases it in
`finally`. `createRunResourcesFactory` in `src/backend/app/composition/worker/run-resources.ts`
loads and verifies the retained settings snapshot, then supplies the session factory, Duo gate,
task deadline, acquisition deadline, and browser default for that run. It refuses retired `test`
instances. A newer current Settings snapshot does not replace the run's retained input.

`createBrowserProfileAuthority` in the run resource factory admits the slot and exact profile.
A prior browser observation must prove closure. An unrecorded existing directory refuses.
Changed instance or `signInFingerprint` requires profile reset and a new `profileRevision`.
`browserSignInFingerprint` binds system URLs, protected credential value ids, and Duo identity.
An ordinary config or presentation change keeps the admitted profile path.

In-memory reuse requires the same system, instance, `configFingerprint`, and browser mode.
Identity drift closes before replacement. Reuse also checks download acceptance and exclusivity;
incompatible launch properties refuse. Browser presentation is the envelope's `headed` or
`headless` value, or the retained configuration default when the envelope omits it.

A successful callback resets to neutral entry and proves authentication again. Failure or
cancellation poison-closes the resource. Failed closure retains poison and refuses reuse;
`AggregateError` preserves both operation and cleanup failures.

`withTransactionDriver` adds the sequencer's one-way `retainAfterFence()` transition. Before the
fence, abort races the callback normally. After the fence, cancellation reaches the task but
cannot detach the callback or reset, close, or return its resource before actual settlement.
Cancellation and callback failures remain visible together. A callback that never settles leaves
the session and `attempting` write process-owned until process loss permits write recovery.

### 4.1 Authentication proof

`src/backend/systems/browser-shared/authenticated-application.ts` owns
`defineVerifiedLoginRecipe` and `assertAuthenticatedApplication`. Every recipe probes before and
after navigation. A proven warm session returns `already-authenticated`; otherwise the recipe
runs its ceremony and verifies inside the Duo lease before returning `logged-in`.

| System recipe | Positive evidence |
| --- | --- |
| `src/backend/systems/ucpath/session.ts` | Non-empty PeopleSoft `PS_TOKEN` cookie on the expected domain. `PS_TOKENEXPIRE` is insufficient. |
| `src/backend/systems/crm/session.ts` | Non-empty Salesforce `sid` session cookie. |
| `src/backend/systems/new-kronos/session.ts` | Non-empty WFD `kronosAuthToken` cookie, polled up to 80 times at 250 ms intervals after landing. |
| `src/backend/systems/kuali/session.ts` | Rendered Kuali Build application chrome. The recipe has no verified authentication-only cookie and records that weaker marker. |

`verifyUcsdAuthenticatedApplication` in
`src/backend/systems/browser-shared/ucsd-sso.ts` combines the positive observation with absence
of the TritON form and any declared system sign-in controls. The factory's neutral reset uses the
same verifier. There is one definition of authentication for login and reuse.

### 4.2 Duo refusal and extension credentials

`waitForAuthenticatedLanding` in `src/backend/systems/browser-shared/ucsd-sso.ts` races landing
against Duo's rendered terminal refusal. The canceled-or-timed-out screen throws
`DuoTerminalRefusalError`; the runtime does not click Try again or wait for the acquisition envelope
to expire before reporting that outcome.

The WebAuthn counter belongs to the credential across profiles. `nextSignCount` in
`duo-autopilot/src/sign-count.js` computes `max(stored + 1, nowSec)`. The extension serializes signs
within its background worker and persists the advanced counter in `chrome.storage.session`.
The credential-wide lease in section 10 serializes ceremonies across worker processes.

The factory's `provisionDuoSession` writes credentials to the owned extension worker on each launch,
restricts access to `TRUSTED_CONTEXTS`, and verifies every field. Persistent `duoCredentials` in
`chrome.storage.local` refuses with `duo-extension-provisioning-unavailable`.
No packaged credential copy is required.

### 4.3 Acquisition deadline

`WorkerSessionManager.#acquireBounded` arms `timeouts.sessionAcquireMs` on the monotonic scheduler
and links a separate acquisition signal to the run signal. The default is 60,000 ms. The bound
covers session acquisition and authentication, including time spent waiting for the Duo lease.
It is separate from `timeouts.taskMs`, whose default is 180,000 ms.

Expiry fails acquisition without ordinary retry. Late resources poison-close; failed cleanup
retains poison and emits the abandoned-acquisition warning.

## 5. Deadlines and condition waits

Browser drivers wait for observable readiness, with bounded quiet windows where application
refreshes need them. `tests/architecture/tooling/helpers/ratchet-arms.ts` prohibits `waitForTimeout` in
system source. Polling cadences for claims, leases, and authentication are bounded checks of a
condition, not evidence that an operation succeeded.

### 5.5 Task deadline

`src/backend/runtime/execution/run-executor.ts` requires an injected `taskDeadlineMs` and races
task invocations against the monotonic scheduler. `src/backend/runtime/writes/write-sequencer.ts`
owns the corresponding transaction invocation deadline. Both propagate cancellation and preserve
failure evidence. The transaction resource remains owned after the fence until its callback
settles, even when the task deadline has expired.

## 6. Failure isolation and teardown

### 6.1 Page and subject isolation

`src/backend/runtime/writes/write-sequencer.ts` freshly observes the staged subject before a write
fence and requires an exact normalized match. Mismatch or unknown prevents commit. This
transaction check is separate from authentication and browser reuse.

### 6.2 Observed closure

`PlaywrightWorkerSessionFactory` launches full bundled Chromium with `channel: "chromium"` in a
persistent context. The configured Duo extension needs that browser and context combination.
`assertDuoAutopilotReady` checks the extension manifest and configured credential before launch
when `features.duoWebAuthn` is enabled.

The factory's `#closeWithProof` bounds page and context closure by `browser.closeProofMs`, whose
default is 15,000 ms. It checks that every captured page is closed, no open replacement page
remains, and the context emitted its close event. `#releaseProfile` then observes the owned
Chromium process as gone within another close-proof bound before releasing the profile reservation.
A resolved Playwright `close()` promise alone proves neither step.

`WorkerSessionManager.closeAll` throws `WorkerSessionClosureUnprovedError`, an `AggregateError`
retaining cleanup failures, when closure cannot be proved. `runWorkerLoop` returns accumulated
outcomes with required `closure: "proved" | "unproved"`; other closure errors still reject.
Unproved closure ends the worker span as failed and settles its lease as crashed. The worker CLI
prints the closure classification and exits nonzero; the dry-run runtime refuses with the named error.

`src/backend/app/composition/worker-compose.ts` stops maintenance and resource owners, then closes
the database before releasing its process record. Database closure failure retains that record;
aggregated cleanup preserves the runtime error.

`src/backend/app/composition/dashboard/compose.ts` closes HTTP and stream consumers, stops
observers, and awaits `drainOwnedChildren`. The supervisor uses the ordinary graceful stop and
escalation policy, then observes owned child exits. Failure to observe exit is a shutdown failure.
Closing the supervisor cancels its timers and returns any remaining live-child evidence for the
structured fault sink. The dashboard closes its database before releasing its process lock and
runtime admission. Shutdown does not create a backup.

`src/backend/storage/sqlite/runtime-process-locks.ts` owns acquisition-specific process records
and OS process-birth checks. Database closure precedes their release.

## 7. Verification owners

Tests mirror implementation under `tests/backend/runtime/` and `tests/backend/storage/sqlite/`.
`tests/architecture/runtime/` owns `authentication-proof-not-url`, `driver-lease-boundary`,
`single-flight-login`, `fresh-session-boundary`, `bounded-task-deadline`, `duo-ceremony-lease`,
`multi-worker-overlap`, and `worker-teardown-soak` in their named `.test.ts` files.
`tests/duo-autopilot/src/sign-count.test.ts` checks cross-profile counter arithmetic.
`tests/backend/app/composition/dashboard/compose.worker-pool-parallel-proof.integration.test.ts`
and `compose.worker-browser-control-process.integration.test.ts` exercise real children.
A test's presence does not establish a current pass or external availability.

### 7.1 Concurrency evidence

Overlap and soak tests sample claims during multiple worker loops over one database. They assert
one active run per worker and simultaneous fleet work. Final counts cannot prove either invariant.
[Guards and tests](guards-and-tests.md) owns commands and gate policy.

## 10. Credential-wide Duo lease

### 10.1 Credential identity

`duoCeremonyCredentialKey` in `src/backend/runtime/gates/duo-ceremony-gate.ts` resolves the public
credential identity when `features.duoWebAuthn` is enabled. `resolveSecretFileIdentity` hashes the
configured credential's public `rpId` and `credentialId` pairs. Missing identity fails composition;
the key is not logged. With the feature disabled, the key derives from `config.actor.id` for
hands-on approval. Neither mode is a fallback for the other.

`AuthorityDatabase.#buildDuoCeremonyLeaseRepository` stores one row per key in `auth_leases`.
Acquisition and release advance its version under CAS. The row stays retained across generations.

### 10.2 Ceremony scope and token

`defineVerifiedLoginRecipe` skips the lease for a proven warm session. Otherwise it leases the
SSO ceremony through final verification and releases on settlement.

`src/workflow-kit/duo-ceremony-lease.ts` tracks minted and retired tokens in private weak sets.
The authority repository mints tokens. SSO helpers assert the token's active identity and system
before form lookup, credential fill, submission, or landing wait. A structural cast cannot supply
a usable token.

### 10.3 Expiry and takeover

The gate sets TTL to `timeouts.sessionAcquireMs + timeouts.duoCeremonyLeaseGraceMs`. Grace defaults
to 20,000 ms and must be smaller than the acquisition envelope. A holder schedules monotonic TTL
cancellation. The repository compares wall-clock `expiresAt` and allows expired takeover at the
next generation. A late release cannot overwrite the successor; `superseded` raises an error.

Across machine sleep, wall-clock takeover can precede the holder's monotonic cancellation.
That overlap window remains possible; supersession reports it.

### 10.4 Waiters and release failures

The gate polls every `DUO_CEREMONY_LEASE_POLL_MS = 250`. Its waiter budget ends at the acquisition
envelope deadline minus grace. Exhaustion raises `DuoCeremonyLeaseHeldError` with the holder's
worker, system, generation, and expiry before the general acquisition timeout fires.

`DuoCeremonyLeaseExpiredError` cancels an expired holder. A failed release retains the held token
so disposal can retry the update. `DuoCeremonyReleaseFailedError` preserves the earlier ceremony
failure as its cause. These failures never report a released or successful ceremony without proof.

### 10.5 One fresh-profile recovery

On the first `DuoTerminalRefusalError`, the gate retains its lease. Outside operator browser
controls, the session manager proves
closure, calls the factory's `discardProfile` for the admitted profile, and attempts authentication
once more under that same gate. A second refusal fails with the profile named; a factory without
`discardProfile` refuses recovery. Disposal releases any retained lease and preserves cleanup errors.

`deleteOwnedBrowserProfile` checks containment, ownership, types, links, permissions, reservations,
and Chromium singleton markers before deletion, then verifies absence.

## 11. Workflow batches and worker pools

`RunSessionRecord` stores origin `start-plan` or `intake-manifest`, workflow, actor, and creation
instant in `run_batches`. `runs.listBySession` derives membership from runs; retry retains the
session id. `groupInQueue` and version affect presentation only. [Workflow model](workflow-model.md)
owns fan-out.

`worker_pools` stores a nonnegative `desiredWorkers` count, planner, time, and version.
The count equals the nonretired admitted slot roster after each membership transaction. Missing
or inconsistent roster authority refuses admission; leases never reconstruct membership.

### 11.1 Process effects and retirement

`createWorkerPoolRuntimeExecutor` freezes requests and validates acknowledgements against the
original member. `src/backend/runtime/workers/worker-supervisor.ts` launches argv without a shell
and requires the child's own lease birth before acknowledgement. The dashboard
uses `scripts/dev/secure-env-bootstrap.ts` with `cli`; `workerCliArgv` adds the exact admitted
member and launch-command identity.

Mutating controls require this supervisor's live child with matching member, PID, and lease start.
External leases grant no control or adoption. Restart does not reconstruct ownership from PIDs.
Crashed capacity stays unmet until explicit launch; there is no background restart.

`admitWorkerPoolRoster` selects retained slots in ordinal order and records the exact selected and
excess roster. Scale-down stops each owned excess member through the bounded policy. Retirement
requires stopped process custody, a non-live lease, closed browser observations, exact membership,
and exclusive profile deletion through `composeWorkerProcessControl`. Only then does authority
retire the slot and update the declaration. A failed closure cannot become a smaller completed pool.

Stop requests the durable directive, waits `WORKER_GRACEFUL_STOP_TIMEOUT_MS = 120_000`, sends
SIGTERM, waits `WORKER_SIGTERM_TIMEOUT_MS = 30_000`, then sends SIGKILL. Observed escalation stages
are a timestamped prefix of that policy. An initial acknowledgement records only the graceful
request, not future signals or exit. Failed delivery and uncertain stop effects remain visible.
During shutdown, final exit observation is bounded by `WORKER_EXIT_OBSERVATION_TIMEOUT_MS = 5_000`.

### 11.2 Durable worker and browser controls

`src/backend/runs/commands/command-kernel.ts` admits `plan-worker-count`, `spawn-worker`,
`pause-worker`, `resume-worker`, `stop-worker`, `refresh-browser`, and `reopen-browser` into
`worker_controls` before asynchronous effects. `src/backend/storage/sqlite/worker-control.ts`
binds every record to the exact stored command and any admitted roster.

Pause, Resume, and Stop carry `controlBasis` with `leaseGeneration` and `controlRevision`.
Refresh and Reopen also name `browserSessionId`. Reservation increments the control revision.
Heartbeats preserve the basis; another instruction or lifetime invalidates it. Composition and
child execution recheck the reserved basis before effects.

Controls expire after 180,000 ms. Their phases are `admitted`, `ready`, `executing`, `succeeded`,
`refused`, and `uncertain`. Replay consults the retained outcome rather than repeating the effect.
An unresolved control blocks another effect in its scope. An expired unstarted request refuses;
an expired executing request becomes uncertain. Reused command identity with different bytes
refuses. Requested directives remain distinct from observed lifecycle.

`worker-browser-channel.ts` uses SQLite as the cross-process channel and polls at 50 ms within
the request's expiry. `worker-browser-control.ts` consumes only ready requests for its exact
worker lifetime, between whole runs. Kernel admission and child execution both refuse busy
workers with `worker-browser-busy`. A busy refusal queues no deferred browser effect.
The claim transaction blocks while that lifetime has an unaudited browser control.

Refresh uses the selected resource's neutral reset and authentication proof, retaining the
session id. Reopen proves closure and opens a replacement with a new session id, the same profile,
and the resource's retained factory, configuration, instance, browser mode, and launch properties.
Neither operation substitutes newer Settings or clears credentials. `WorkerSessionManager`
excludes run binding during controls and retains failed or uncertain health.

### 11.3 Capacity for a submitted start

`src/backend/runs/commands/run-worker-capacity.ts` ensures one usable workflow worker after a
start queues runs. A `run`-directed lease in `starting`, `idle`, or `busy` supplies capacity,
including an external worker. Preview and a zero-run confirmation create no worker effects.

Absent capacity, the service reuses a stopped slot or adds one through journaled
Plan and Spawn. It preserves directives and refuses a Plan covering a pending stop. It starts one
member, retaining command identity, actor, timestamp, and CAS basis for replay.

Enqueue can commit before startup. A startup refusal reports the queued run ids and child command;
it does not call the queued runs rejected. Exact replay does not restart a settled launch after
another crash. Replay without retained startup evidence or a usable worker reports unknown startup
and requires reconciliation. `src/backend/runs/commands/command-service.ts` serializes
enqueue and startup per workflow.

### 11.4 Browser-login verification

The browser-login verifier reserves its temporary member through the native lifecycle journal's
`worker-verification-admission` and `worker-verification-retirement` intents. Admission binds the
actual live-smoke process acquisition. Its reservation excludes membership controls, claims and
worker lease birth until browser closure, profile removal and Duo release are proved. An uncertain
cleanup retains the member and reservation. Explicit recovery requires the original immutable
process acquisition and release, a gone owner, and exact slot custody and closure evidence; it
cannot adopt a PID or infer a member from a historical process-only claim.

## Not built yet

- Wiring-base work connects the approved dashboard controls and session views to served worker and browser authority through the shared client.
- OnBase needs a concrete driver, verified login recipe, and identity-exclusive session lease whose release follows proven browser closure.
- Unbound browser systems need their driver and verified login binding before a workflow can use them.
- A workflow that declares `session:"fresh"` needs its node-ordering proof in addition to the manager's close-before-open tests.
