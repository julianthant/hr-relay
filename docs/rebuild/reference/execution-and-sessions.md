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
ownership rather than inventing a terminal result. The controller recovers that claim on child exit or the next startup.

One heartbeat renews the exact worker and `claimGeneration`; lost renewal aborts execution.
`RunRecordService` re-reads authority versions before lifecycle mutation.
Current execution also requires the retained physical worker lifetime, current profile admission,
slot, lease and process birth. The executor checks this authority after a child await, and native
worker mutations check it in their transaction. Pause and ordinary graceful stop do not revoke the
current item; exact-worker reset, lifecycle and recovery reservations still fence it. An independent
delegation edge stops ancestor cancellation propagation, without bypassing the child's own home-worker
or profile lifetime.

Worker composition renews its own lease every `WORKER_HEARTBEAT_INTERVAL_MS = 5_000`.
Heartbeat age never proves death or transfers a claim. Recovery follows actual child exit or
exclusive startup; workers do not reclaim each other's runs or leases.
`runWorkerLoop` creates one confirmed-action publisher with a fresh stream id and capacity 256.
It assigns sequence numbers within that incarnation. On exit it closes the publisher before
browser teardown and warns about pending events. Publication health does not settle a run or an
external write.

### 3.0 Startup claim recovery

The controller holds the exclusive runtime lifetime listener before selecting a profile. Workers
hold duplicated handles until exit, so a successor cannot acquire the listener while an earlier
worker survives. Before supervisor construction, `startup-crash-recovery.ts` reconciles every
claimed run in the selected profile. Workers never perform startup reconciliation themselves.
The controller also reconciles one exact worker generation synchronously on its child's OS exit.
A failed exit reconciliation blocks replacement and successful shutdown.

The explicit `recover-crash` lifecycle door requires the held controller and fences the exact run
version, claim generation, worker membership and lease generation. A run with no unfinished write
ends failed with `RUN_INTERRUPTED_BY_CRASH`, a structured failure and terminal result. One attempting
or parked write keeps its original intent and attempt and surfaces as `parked-write` with
`RUN_CRASH_WRITE_UNRESOLVED`. Other unproved write states refuse with
`STARTUP_CRASH_RECOVERY_REFUSED` before any cleanup commits. Normal worker terminalization continues
to require current execution authority.

Interrupted worker leases stop as crashed, their browser observations close, and held Duo leases
release in the same transaction. Never-claimed, ownerless queues from a previous local calendar day
are cancelled through the normal lifecycle transition after checking that no intent or checkpoint
exists. The cancellation records `RUN_STALE_QUEUE_CANCELLED`; today's queues and previously claimed
queues are preserved. Each cleanup publishes a durable notification; lifecycle events and
failure/park messages feed Logs and Queue. Repeated reconciliation preserves settled runs, writes
and notification identities.



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

Each browser open validates its exact retained configuration fingerprint and admitted system/instance.
`RuntimePreflight.prepareSession` freshly executes the selected system's endpoint and credential checks
plus `browser.assets` under their registered deadlines, then revalidates retained configuration and
protected-settings revision before launch. Missing, duplicate, unhealthy or failed detectors refuse the
open. A protected-settings change during preparation refuses as stale. These session checks do not run
the whole-authority storage doctor while the active run is writing checkpoints or timeline events.
Full workflow preflight remains required at start and worker claim; explicit storage doctor retains
its fail-loud mixed-authority-snapshot check.

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

The operator sentence is the catalog text for `DUO_TERMINAL_REFUSAL`. The refusal is almost never
Duo hand-approval. It is a Fast Duo signCount regression: this browser profile's stored counter
has fallen behind the value Duo has already observed for the shared credential. A counter that does
not advance is a cloned-key signal, which happens when any other profile using the same credential
signed more recently. Check the extension's stored signCount before changing
`timeouts.duoApprovalSeconds` or `timeouts.sessionAcquireMs`.

The WebAuthn counter belongs to the credential across profiles. `nextSignCount` in
`fast-duo/src/sign-count.js` computes `max(stored + 1, nowSec)`. The extension serializes signs
within its background worker and persists the advanced counter in `chrome.storage.session`.
The credential-wide lease in section 10 serializes ceremonies across worker processes.

`fast-duo-extension.ts` stages an allowlisted runtime under the owned browser profile.
Signup uses `relay-manifest.json`; workflow sessions use `workflow-manifest.json` and
`src/workflow-background.js`, sharing Fast Duo's credential selection and signing service.
Neither runtime stages standalone bootstrap, packaged credentials or persistent key storage.

The factory installs the retained credentials and operator username in the owned workflow worker
before handing a page to a login recipe. The worker restricts session storage to
`TRUSTED_CONTEXTS`, verifies each write and binds keys to that operator account. Persistent
`duoCredentials` or `autopilotV1` in local storage refuses with
`duo-extension-provisioning-unavailable`. Enrollment is unavailable in workflow sessions.
Explicitly disabled `features.duoWebAuthn` launches Chromium with extensions disabled.

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
`assertFastDuoReady` checks the workflow extension manifest and configured credential before launch
when `features.duoWebAuthn` is enabled.

The factory's `#closeWithProof` bounds page and context closure by `browser.closeProofMs`, whose
default is 15,000 ms. It checks that every captured page is closed, no open replacement page
remains, and the context emitted its close event before releasing the in-process profile reservation.
It does not inspect browser PIDs or Chromium markers. Before claim, the manager retains a matching
owned context or probes native profile availability through the same launcher and verifies closure.
The probe reads no HR credentials, provisions no Duo state and performs no authentication or task
callback. Chromium profile-in-use refusal reports `BROWSER_PROFILE_STILL_CLOSING`; the selected run
remains unclaimed. Selection and version are checked again after asynchronous preparation.

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

The Darwin OS census in `src/backend/storage/maintenance/process-closure.ts` observes a filesystem
descriptor only when its name is a non-NUL absolute path equal to its normalized resolution. A
snapshot with an unresolved filesystem descriptor proves nothing; up to five descriptor snapshots
are taken, and only a fully resolved one proves the roots unused. A root match in any snapshot refuses.

An abandoned bound-worker process record can also be settled by explicit offline
`storage recover-worker-process --acquisition <uuid> --plan --json`, followed by
`--acquisition <uuid> --capture <digest> --apply --json`. Plan reads existing custody without
acquiring admission, opening SQLite or creating files. Apply requires the exact capture under fixed
restore admission and exclusive installation custody. This finite path supports an established
canonical flat native6 installation without profile-registry evidence; it does not authenticate an
owner or initialize a registry.

Recovery preserves the original bytes, physical file identity and nullable `releasedAt`. Its separate
immutable receipt binds the entire original record, canonical root and owner/locator witnesses,
fresh gone-owner and process/open-file/cwd observations, and independently closed native
lease/browser/Duo/control/run/write custody. Unresolved HR writes remain held. Changed sources,
unknown observations or failed resource closure refuse. Existing backup and claim consumers retain
their current native and owner proofs. Finite stopped device recertification still requires released
worker records. Unreleased singleton claims are admissible only when the normal process start-identity
check proves their owners gone; live or unprovable owners refuse. Their identities, file witnesses and
observations are bound into the capture and receipt without changing any claim file.

Receipts live in the fixed lock root's `worker-process-recovery/` directory. Publication uses a
private staged file, no-overwrite link, stage removal and directory fsync. A crash before the sole
final name is durable, partial bytes, an extra stage or multiple links refuses; it is never cleaned
up automatically. A complete sole final receipt is independently authenticated on fresh reads,
including exact original bytes/inode and current owning witnesses; no private flag or claimed prior
readback grants authority. A publisher that fails readback or custody release reports failure even
if a complete receipt remains available for independent verification. Receipt proof describes the
historical process closure event; it never replaces a consumer's current database/resource guards.

### Offline cancellation of never-claimed queued runs

`storage cancel-queued-runs --plan --json` captures an established flat native6 installation
without changing source files or acquiring admission. `storage cancel-queued-runs --capture
<digest> --apply --json` rechecks that exact capture under restore admission and exclusive
installation custody, proves process/open-file/cwd absence, then cancels all eligible queued runs
in one transaction. Plan or apply refuses any other nonterminal run, prior claim, requeue,
checkpoint, write intent, delegation, active native resource, live owner or uncertain custody.
A stale dead worker process record can remain for subsequent `recover-worker-process`; this command
neither releases nor rewrites process records. Changes to captured database files, native inventory,
installation witnesses or process custody require a new plan.

The finite native6 path shares the ordinary lifecycle transition validator and version-fenced row
update. It records terminal `cancelled` with reason `cancelled offline: stale queued run`, the normal
lifecycle command and audit, terminal result evidence and timeline event. It changes no schema or
credentials and grants no profile runtime authority. The supported existing-data claim and upgrade
retain the cancelled outcome and reason.

## 7. Verification owners

Tests mirror implementation under `tests/backend/runtime/` and `tests/backend/storage/sqlite/`.
`tests/architecture/runtime/` owns `authentication-proof-not-url`, `driver-lease-boundary`,
`single-flight-login`, `fresh-session-boundary`, `bounded-task-deadline`, `duo-ceremony-lease`,
`multi-worker-overlap`, and `worker-teardown-soak` in their named `.test.ts` files.
`tests/fast-duo/src/sign-count.test.ts` checks cross-profile counter arithmetic.
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

The new-purpose Duo document keeps its own reserved counter. That counter is not the ceremony-lease
generation. Reservation publishes the next count before signing. An UNKNOWN or crashed attempt is not
retried or reset. Ordinary reads do not settle a pending publication. Stopped
`storage recover-duo-publication` can complete only the publication that was already written.
After erasure, the purpose decrypt owner checks the authenticated current retired identities and
canonical physical document before returning material. The refusal survives a later distinct
enrollment; valid same-enrollment backups retain their counter-floor contract. Decrypt-only currentness
rejects a pending publication without blocking the same-issued or stopped settlement owners.

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
Crashed capacity stays unmet until Run, Rerun or Sessions explicitly launches a worker. Dashboard
boot never launches a worker.

`admitWorkerPoolRoster` selects retained slots in ordinal order and records the exact selected and
excess roster. Scale-down stops each owned excess member through the bounded policy. Retirement
requires stopped process custody, a non-live lease, closed browser observations, exact membership,
and exclusive profile deletion through `composeWorkerProcessControl`. Only then does authority
retire the slot and update the declaration. A failed closure cannot become a smaller completed pool.

Internal pool retirement and lifetime shutdown request the durable stop directive, wait `WORKER_GRACEFUL_STOP_TIMEOUT_MS = 120_000`, sends
SIGTERM, waits `WORKER_SIGTERM_TIMEOUT_MS = 30_000`, then sends SIGKILL. Observed escalation stages
are a timestamped prefix of that policy. An initial acknowledgement records only the graceful
request, not future signals or exit. Failed delivery and uncertain stop effects remain visible.
During shutdown, final exit observation is bounded by `WORKER_EXIT_OBSERVATION_TIMEOUT_MS = 5_000`.

### 11.2 Durable worker and browser controls

`src/backend/runs/commands/command-kernel.ts` admits `plan-worker-count`, `spawn-worker`,
`pause-worker`, `resume-worker`, `refresh-browser`, and `reopen-browser` into
`worker_controls` before asynchronous effects. `src/backend/storage/sqlite/worker-control.ts`
binds every record to the exact stored command and any admitted roster. Fresh ordinary targeted
controls also capture their authenticated member and full process lifetime at admission, after the
exact control reservation. Worker cards project them only for that member and lifetime. Historical
records without this binding remain unavailable; reads and replay never attach current identity.

Pause and Resume carry `controlBasis` with `leaseGeneration` and `controlRevision`.
Refresh and Reopen also name `browserSessionId`. Reservation increments the control revision.
Heartbeats preserve the basis; another instruction or lifetime invalidates it. Composition and
child execution recheck the reserved basis before effects.

Ordinary controls expire after 180,000 ms. Their phases are `admitted`, `ready`, `executing`, `succeeded`,
`refused`, and `uncertain`. Replay consults the retained outcome rather than repeating the effect.
An unresolved control blocks another effect in its scope. An expired unstarted request refuses;
an expired executing request becomes uncertain. Reused command identity with different bytes
refuses. Requested directives remain distinct from observed lifecycle.

Public Stop returns a pending command identity after durable admission; the same-process worker
completes reset independently of the HTTP client. Before new admission, the supervisor must prove
its exact born, running child and member against the current lease PID/start identity. A stopped
failed lifetime instead requires original retained birth custody and proven OS death before browserless
replacement admission. External live, unborn, changed or uncertain ownership refuses without
reservation. Exact journal replay
does not depend on current child ownership. New Stop admission requires `membershipRevision` and
`controlBasis`; optional carried `expectedVersion` is observation evidence and does not gate Stop
on a heartbeat row version. The internal `admitWorkerReset` boundary binds the existing journal to the exact
member, process lifetime, reserved control revision, current run/claim/attempt or explicit absence,
and queued cascade dependencies. A separately claimed child refuses as foreign custody. Admission
atomically blocks subsequent claims and both write-fence paths. A prior fenced callback remains
owned by its sequencer and may settle or park UNKNOWN; reset never cancels or retries that write.

The worker observes reset during current execution, acquisition and sign-in using a work abort
signal separate from lifetime shutdown. Actual read callback promises retain run/claim/attempt
ownership across deadline races and loop iterations. An admitted reset blocks another claim and
cannot report idle while callbacks remain unresolved. Ordinary task deadlines remain bounded.
A scheduled observer remains live through callback and browser-close waits; expiry marks uncertainty
while retaining ownership and reservation. After actual callbacks settle, the lifecycle service cancels
safe residual work and queued cascade members atomically. Settled committed receipts remain intact;
a safely released parked UNKNOWN remains parked and resolvable without delaying browserless idle.
The session manager closes its actual acquisitions and browsers and proves Duo/exclusivity release.
It mints a one-use closure capability bound to its immutable member and lifetime; any new driver,
authentication or reopen invalidates that proof. Only the dedicated authority settlement transaction
can persist exact closed-session identities, same-generation idle, reset acknowledgement, application
and audit before releasing the claim barrier. It rechecks the entire graph and parked write identity.
Missing callback, custody or closure proof retains uncertainty; generic journal setters and ordinary
audit cannot release a reset. Historical success survives later work in the same worker lifetime.
Historical Stop journal bytes remain immutable evidence. Missing historical reset authority remains
unavailable and reserved when unresolved, and cannot authorize replay or a reset success.

Remove and Retry use the same native worker-control journal and pool exclusion. They bind the
selected member revision, old process lifetime, control basis and pool version. Remove admits
only an actually owned idle child without current work. The session manager closes its warm and
late resources and releases Duo before recording the exact closure milestone. The supervisor
then sends the authenticated internal shutdown, observes OS exit and proves process/profile
custody release. Its one-use effect capability binds that original operation to actual retirement.
A dedicated transaction rechecks release, tombstones only the selected slot, decrements the pool
once and persists application/audit together. Surviving identities and ordinals remain unchanged;
the last member leaves a zero-size pool. Missing closure or exit proof retains the member and
reservation, and replay never repeats an uncertain effect.

Retry admits only a stopped failed lifetime with proven owned-child OS death or authenticated
retained birth custody, and released process, browser, Duo and write custody. A stopped lease alone cannot prove death. Replacement retains the
logical slot and advances its lease generation, using the admitted current descriptor and effective
settings. Actual supervised birth produces the starting acknowledgement and application/audit;
a separate same-generation initialization barrier prevents claims until required browser systems
are physically authenticated. Initialization uses registered session needs without creating a run,
releases its config binding on success or failure and retains warm resource provenance. Authentication
failure remains a worker lifetime failure, independent of the starting acknowledgement. Stop can
abort initialization work and, after actual closure, atomically cancel its readiness barrier while
recording reusable browserless idle. Browserless replacement mode opens no session. Public Stop
recovery for a dead failed lifetime retains its original reset binding and adds an exact browserless
replacement binding. The supervisor records actual replacement birth before the fresh new owner
can finalize original-to-replacement idle, application and audit. Missing effect evidence retains the
barrier across generations; an ordinary Retry acknowledgement cannot prove that reset. For a stopped
owner with safe pre-fence work, strict reset binding and canonical residual cancellation occur in the
same synchronous admission transaction before the full owner-death/release check. Failed proof
rolls back the original claim, cancellation journal, command and reservation together. No external
shutdown, cleanup or spawn occurs before that transaction commits.

The Day resource serves exactly `running`, `starting`, `idle`, `waiting`, `paused` and `failed`.
Every card names its standing member revision. A live phase requires current owner custody;
current-run joins require the active claim's exact membership and lease generation. Browser spans
and parked historical runs cannot supply current activity. Actual acquisition, authentication and
closure report `waiting`; failed closure remains unavailable until actual closure is proved.
`workerAuthority` retains member references when evidence is unavailable. `workerOperations`
retains exact native command outcomes, including retired members and confirmations preceding later
work, without exposing native lock custody snapshots.

Dashboard composition borrows the held controller lifetime. Bootstrap retains it through HTTP,
worker and account drains; unproved resource closure retains custody. Composition and crash
reconciliation require the same capability retained by the installation and profile admission.
Restore writers bind the canonical target and exclude retained children before creating restore records;
that binding does not replace authenticated workspace startup.
Production entrypoints use the configured singleton port; fixture-chosen ports do not bind distinct roots to one workspace.

Workers receive the controller's listening handle, port and canonical workspace over IPC before
authority admission. The controller retains each transferred child until its actual `close` event.
Exclusive installation admission refuses while a transferred child remains unclosed; handle transfer
refuses while an exclusive installation admission is held. Lease start
records the admitted command as `startCommandId` for replacement and standing recovery. It retains
exact member, lease-generation, control, settings and reservation fences. The actual supervisor's
child exit event triggers interrupted-run recovery; heartbeat age does not authorize reassignment.

Profile quiescence authenticates current reservation and retirement lineage, exact member and lease
state, and actual supervisor exit evidence. Runs, unfinished writes, browser observations, Duo leases,
pending controls and pending artifacts all keep the profile busy. Cancellation awaits the owned-child
drain and refuses incomplete resource closure. PID files and OS process census do not decide quiescence.

Dashboard preflight reports runtime/configuration, filesystem, authority and reserved-port readiness.
Worker liveness comes from owned supervisor child events; preflight does not inspect PID records.
Optional provider warnings report registered provider availability.

The dashboard owns one serial Nominatim service. It accepts requests only over each spawned
worker's existing IPC channel; workers have no direct Nominatim fetch path. The queue spaces actual
fetch starts by at least one second, preserves deadlines and cancellation, and never replays a
request after disconnect. Standalone execution composes its own service while holding the exclusive
root listener. Shutdown retains the controller until active geocode work drains; failed closure
refuses release. There are no geocode election, endpoint or PID files.

`runtime/browser/native-profile-probe.ts` owns the native launcher and verified page/context close
used by preclaim and maintenance. Taking the root listener excludes Node owners; a surviving
Chromium still requires a native profile probe before file replacement or credential erasure.
Async closure paths await the probe directly. Synchronous inventory callbacks await a finite child
through `native-profile-probe`; no controller, credential, provider or login is initialized in that
selector. The request names existing private directories and deadlines. Its nonce and request digest
bind one strict result to the full closed-directory list, followed by actual child completion.
Busy profiles refuse with `BROWSER_PROFILE_STILL_CLOSING`; missing, malformed, failed or unproved
closure refuses with `BROWSER_CLOSURE_UNPROVED`. Neither refusal permits erasure or replacement.

Retained settings roots and authenticated verification scratch paths have distinct membership.
An absent directory is released only when the exact completed cleanup already proves owned context
closure and profile deletion. Startup `cleanup: interrupted` does not supply that evidence.

Duo onboarding derives its canonical directory from the authenticated operation, profile, account
and generation through `onboardingProfileDirectory`. Existing exact paths must pass native closure
before reuse or deletion, followed by a fresh exact owner check. Random or stale-owner directories
remain unknown and untouched. Recovery accepts missing paths only after the persisted finish or
abort step that follows actual owned drain. Failed retention or closure stays uncertain; startup
and extension message pumps settle before replacement. No Chromium PID or marker proves closure.

Standalone browser verification holds the exclusive runtime listener throughout its admitted lifetime.
Its reservation binds the installation/profile, lock port, fresh scratch profile, browser system and
Duo credential. Startup retires an interrupted verification-only reservation before new admission,
including reservations without a worker lease. One transaction checks exact reservation/member/pool
revisions, refuses unexpected run or write ownership, closes bound browser observations, releases
exact held Duo versions, and records retirement and durable cleanup notifications. It inspects no
PID or Chromium marker and deletes no browser root.

Native `worker-standing-recovery` reserves an existing idle or paused member after its exact stopped lifetime,
browser, Duo, write and profile release. The lease retains its last observed healthy phase and pause
intent through internal shutdown. A fresh replacement completes the original grant before any
acquisition, authentication or claim, atomically recording browserless idle or paused and the audit.
Starting, running and waiting hard losses do not automatically respawn; explicit Retry or eligible
Stop remains available after definitive release. Failed members remain explicit, and retired or
zero-size pools never recover. Pending grants and controls retain their original reservation after
crash; durable authenticated effect milestones may finish settlement, while missing evidence never
causes a second spawn or replays an uncertain write.

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

Run and Rerun have no worker choice. `src/backend/runs/commands/run-worker-capacity.ts` uses the
workflow's live standing workers, including live paused members, and starts exactly one when none
has verified live process custody. Only Sessions Add workers expands the pool. An overtarget pool
stays intact.
A proved-dead lifetime is durably stopped with its observed crash reason after run, write, Duo and
browser release is verified. Missing or uncertain custody refuses recovery. Capacity reuses stopped
members through native Spawn before adding a shortfall; replacement preserves pool membership and
rechecks exact old-lifetime death and release immediately before launch.
Preview and zero-item plans create no worker effects.

Capacity adds members through the native journaled Plan and Spawn path. The retained Plan roster
fixes the new member identities, and each Spawn retains its command identity, actor, timestamp,
and CAS basis. Capacity replaces a proved-dead member in place; it never stops a live member or removes
membership. Free workers share
the workflow's unclaimed items, including workers that become free or are added in Sessions later.
Created workers remain in the pool, idle after their work finishes.

Enqueue can commit before startup. A startup refusal reports the queued run ids and child command.
Exact replay reconciles retained children without repeating failed or uncertain effects or replacing
a member that later crashed or was removed. A capacity shortfall on replay without retained startup
evidence reports unknown startup and requires reconciliation.
`src/backend/runs/commands/command-service.ts` serializes enqueue and startup per workflow.

### 11.4 Browser-login verification

The browser-login verifier reserves its temporary member through the native lifecycle journal's
`worker-verification-admission` and `worker-verification-retirement` intents. Admission binds the
actual live-smoke process acquisition. New verifier profiles use that acquisition ID as their
`profileRunId`; claim creation and profile admission require that exact binding. Its reservation
excludes membership controls, claims and worker lease birth until browser closure, profile removal and Duo release are proved. An uncertain
cleanup retains the member and reservation. Explicit recovery requires the original immutable
process acquisition and release, a gone owner, and exact slot custody and closure evidence; it
cannot adopt a PID or infer a member from a historical process-only claim.

`--recover-owned-slot <acquisitionId>` repairs only the exact recorded reservation when its normal
`.closed.json` proof is missing. It requires the immutable original claim and process release, a gone
owner, unchanged native membership and roots, no unresolved controls, and the same worker/system's
released Duo lease. On Darwin it freshly scans process arguments and open files for the derived
system profile under the original acquisition ID, deletes only that profile through the
owned-profile guards, then checks absence again. Query failure or uncertain ownership refuses recovery without retiring the reservation.

`LIVE_SMOKE_RECOVERY_REFUSED` means required proof failed for the original claim, process release,
owner death, native membership or roots, control absence, Duo release, or profile absence. The
reservation remains in place. Missing-proof recovery refuses claims whose `profileRunId` differs
from the original native acquisition ID, including profiles created with unrelated random IDs.
It does not infer or rewrite their identity. Normal retirement with an existing closure proof
retains its claim-based profile path.

Recovery writes an exclusive `<originalAcquisition>-<recoveryAcquisition>.recovered.json` with current
observations and binds it to the live recovery process and original claim fingerprint. Native
retirement independently requires the claim profile ID to equal the original native acquisition ID
and validates that selected proof and authority before committing. It never manufactures a
normal closure proof. A failed retirement retains the claim and recovery evidence; a new recovery
process can retry with fresh observations even when the profile is already absent. Successful
retirement removes only the selected claim and current recovery proof; prior interrupted proofs and
unrelated files remain. The global `--retire-owned-slots` path keeps its strict directory rules.

`storage retire-orphan-verification --acquisition <original-acquisition-uuid> --plan` checks whether
one exact reservation can be retired without binding or deleting its profile. Run the same command
without `--plan` to append its retirement. Both modes hold exclusive offline installation admission,
acquire no runtime process lock, and require the original acquisition and claim custody,
a gone owner, no unresolved controls or live worker lease, no held runtime lock, and no held Duo
lease anywhere. Failed or unknown checks refuse with `ORPHAN_VERIFICATION_RETIREMENT_REFUSED`
before a lifecycle command is appended. An absent original release file is recorded as
`ownerRelease: null`; it does not replace any owner-death or root-wide offline check. A present release
must be safe, valid and bound to the original acquisition and time. Native retirement freshly
rechecks the same observed release or absence before appending. Bound recovery still requires its
original release file.

On Darwin the command checks process arguments, open files and working directories across the entire
`<stateRoot>/scratch/live-smoke` and `<stateRoot>/browsers` roots, including profiles whose IDs cannot
be bound to the acquisition. The global open-file scan includes unlinked files and removed working
directories; incomplete or malformed process/file records refuse. Unsafe paths or symlink escapes refuse. The command requires the
ordinary browser root to be the admitted default: a custom root in saved settings or the active
configuration refuses retirement. Settings and snapshots are authenticated through their ordinary
storage readers; genuinely uninitialized settings are an explicit empty-override case.

The appended cleanup arm is `mode: "offline", evidence: "orphan-retired"`. Its embedded proof binds
the original native admission and slot, exact claim and file custody, roots, ordinary configuration
and fingerprints, stopped runtime snapshot and current absence observations. Native retirement
independently rechecks these conditions with live exclusive admission and proof age at most 30
seconds. The historical reader validates the recorded bindings without requiring later runtime
inactivity. Plan changes no journal, slot, pool or settings records. Execution appends the retirement
command/audit and updates only its native slot and pool projections; claims and profile folders
remain for a separate cleanup.

The factory contract uses `BrowserSessionClosureUnprovedError` for an uncertain launch or failed
setup cleanup. An ordinary login/diagnostic `AggregateError` with proved closure remains the primary
operation failure and does not poison subsequent cleanup. Duo release and actual close failures
continue to retain custody.


## Not built yet

- Wiring-base work connects the approved dashboard controls and session views to served worker and browser authority through the shared client.
- OnBase needs a concrete driver, verified login recipe, and identity-exclusive session lease whose release follows proven browser closure.
- Unbound browser systems need their driver and verified login binding before a workflow can use them.
- A workflow that declares `session:"fresh"` needs its node-ordering proof in addition to the manager's close-before-open tests.
