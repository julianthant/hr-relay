# Execution and sessions

This reference owns worker claims, pools, browser ownership, authentication, Duo leases, and teardown.
Related contracts own [run transitions](workflow-model.md), [task declarations](task-contract.md),
[write recovery](write-safety.md), [configuration](clock-config-secrets.md), and
[dashboard presentation](dashboard-surfaces.md).

## 0. Execution model

`src/backend/runtime/workers/worker-loop.ts` awaits one run per workflow-scoped worker.
Separate workers provide parallelism and own separate browser resources.

Delegated dry-run preparation uses the same admission, worker release, child claims and parent
reclaim as ordinary delegation. A read-only child returns ordinary observations. A preview child
settles with its authenticated preview result and joins into a parent preview, without furnishing
ordinary workflow output or write authority. [Workflow model](workflow-model.md#21-preview-terminal-result)
owns preview eligibility, accounting and receipts.

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
The factory refuses an absent binding before browser launch. OnBase additionally acquires the
durable identity-session lease for its configured application directory and normalized account.
The identity is stored as a hash. A held lease has no expiry or worker-death takeover; waiters are
bounded and cancellation-aware. Exact generation/session release follows proved page/context
closure. Uncertain launch or closure retains the lease, and worker close proof requires its release.

Duo sign-up owns one compact normal Chromium window with native tab/address chrome,
exactly its setup and portal tabs, and its genuine child-process stop capability.
Window creation/removal is projected separately from process and file closure. Explicit Reopen
serializes by draft and window generation, positively stops the owned process, settles callbacks,
and performs native profile exclusion/removal before launching again. The browser-root owner
may recover only its exact retained signup closure failures inside that proof; new or unrelated
source failures stay fenced, and expired callbacks cannot remove files. Cancel writes its durable
abort intent only after the reversible closure phase succeeds. Confirmed methods and UNKNOWN
attempts survive window recovery without an automatic enrollment retry.

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
between runs. Pause claims nothing and keeps the process alive. Stop ends the loop after the
current run settles. An unreadable or malformed directive fails the loop. Worker Pause also pauses
the worker's claimed run, so its current step is cancelled (section 11.2).

SIGINT, SIGTERM, or an injected stop aborts the active run. The executor abandons interrupted
ownership rather than inventing a terminal result. The controller recovers that claim on child exit or the next startup.

One heartbeat renews the exact worker and `claimGeneration`; lost renewal aborts execution.
`RunRecordService` re-reads authority versions before lifecycle mutation.
Current execution also requires the retained physical worker lifetime, current profile admission,
slot, lease and process birth. The executor checks this authority after a child await, and native
worker mutations check it in their transaction. A requested pause or cancellation cancels the
current step (section 11.2); ordinary graceful stop does not revoke the current item. Exact-worker
reset, lifecycle and recovery reservations still fence it. An independent
delegation edge stops ancestor cancellation propagation, without bypassing the child's own home-worker
or profile lifetime.

Parallel child-run leaves enter through one canonical admission transaction. Every declared fan-out
is durable before the parent releases its execution claim once; the worker retains its home slot.
The running transition binds the owner; per-leaf admissions bind branch invocations and scope
evidence, and authenticated continuation receipts bind reused leaves. Each branch retains its manifest, retry history and terminal evidence. The
executor authenticates the complete release proof after the await. Missing branches, changed
bindings or an unproved release fail before parent continuation; UNKNOWN writes never redispatch.

A released delegation wait retains its run, attempt, queue position and enqueue time.
A read-only parent refresh retains those identities too. Its waiting phase cannot claim a worker;
settlement of the accepted retry cohort records one native wakeup. Retry/Recover audits include
actual synchronous parent version changes, while a later wakeup retains its own journal identity. Dashboard
reads authenticate the release and derive `running` at its owning step, or `blocked` when an awaited
descendant holds a `block-parent` edge. Approval stays on the run that owns the gate. Child changes
refresh every waiting ancestor. A manual retry pauses its parent through the existing pause control;
Resume binds its native command identity to the exact completed retry receipts before another claim.
For a factory-proved aggregate whose own graph is read-only, member Retry preserves the parent envelope
through manual Resume, including an existing continuation or its absence. Readiness authenticates
the latest applied native Resume independently of continuation issuance. The aggregate plan reuses
the unchanged children and joins current replacement outcomes at the current claim generation.
Always-rerun upstream prerequisites are read fresh; their exact output schema and payload must match
this parent's retained delegation scope before checkpoint publication or member admission. A changed
prerequisite produces a typed continuation refusal. Freshness policy remains unchanged. Derived
read-accounting consumers execute fresh. Before a member Retry owns an approved-record checkpoint,
a retained approved record is reobserved only after native factory, replacement-lineage and unwritten
proof; its schema and payload must match the retained continuation before publication. An unreferenced
missing step executes fresh, while same-run Resume with its own checkpoint keeps ordinary continuation
and write-proof validation. Old accounting checkpoints remain historical evidence;
they cannot satisfy a later superseding outcome. Checkpoint
and terminal publication recheck the same claim, Resume and member digests in their authority transaction.
Accounting capture checks a requested pause under the same native authority transaction. A Retry
at native success or failure admission acknowledges only its authenticated manual hold after refused
settlement unwinds, including failure settlement reached from a continuation refusal. Delegated Retry uses
the same checkpoint, transaction and uncertain-write validation as checkpoint recovery.

Fan-out revisions retain an unbroken native predecessor chain. A consumed result cites an exact
settlement, while current joins use the current member set. Cancellation and worker admission keep
custody of retained physical children. A read reused by a new review keeps its original observation
time; rebuilding the review cannot make an expired lookup fresh.

Queue parentage derives from authenticated native manifests and their complete retry histories.
Read-only snapshots share authenticated groups only for identical canonical manifest content and
return isolated copies. Wait results share the same synchronous snapshot lifetime. Neither cache
survives snapshot exit, an await or a mutation; scope-path-sensitive replay authentication stays direct.
Queue reads batch sibling parentage and reuse run, title and receipt joins within that read. Member
previews slice before joining authority. Calendar population uses indexed parent batches and day
aggregates rather than materializing every run summary.
Timeline ingestion folds each native page before publishing its affected rows. Publication reads
share one synchronous authority snapshot; subscribers run after that snapshot closes. Log entries
retain their individual ingestion cursors and order within the page.
Multi-event pages and multiple row patches publish one replacement snapshot so cursor jumps do
not force a reconnect or discard another row's patch.

Worker composition renews its own lease every `WORKER_HEARTBEAT_INTERVAL_MS = 5_000`.
Heartbeat age never proves death or transfers a claim. Recovery follows actual child exit or
exclusive startup; workers do not reclaim each other's runs or leases.

An uncertain browser launch throws `WorkerLaunchUncertainError` with a strict report containing
`state: "launch-uncertain"`, `custody: "held"`, worker and workflow identity. It retains root and
source custody and leaves the lease unchanged; it does not report a crashed or stopped lease.

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

Manual workbook Sync uses `runtime/browser/command-browser.ts` with a genuine profile-bound command
capability and the fixed `<browserProfileRoot>/commands/sharepoint` slot. Its owner is a command UUID
and request digest, never a worker or onboarding identity. The one browser-root registry records its
launch and native closure, and ordinary/stopped profile inventories retain its exact membership.
`storage-compose.ts` registers command activity beside worker activity so logout and shutdown cancel
and drain both before releasing storage. A command retains activity through import and final CAS,
even after its browser has closed. Unproved native or authentication closure retains the actual
owners and blocks reuse and clean profile closure. Command and worker Duo ceremonies share the
same credential-keyed durable lease; a command holder has a command UUID and no worker FK.

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
Claim admission returns typed `PREFLIGHT_BLOCKED` and `PREFLIGHT_OBSERVATION_CHANGED` refusals
without claiming the queued run. Standing workers stay alive, wait on the configured idle cadence,
and poll again; readiness still gates browser preparation and every claim. Drain workers exit with
`stopped: preflight-refused` and retain the exact refusal in their report, including a blocked or
changed-observation boot check. Standing workers defer boot readiness to the selected claim.
Other detector failures and unproved resource closure retain their failure behavior.
The doctor preserves every consistency comparison. SQLite read locks and forward-generation
changes between initial, corpus, run and final snapshots throw `StorageDoctorObservationChangedError`;
`authority.health` maps only that class to the observation-change refusal. Fingerprint drift without
a generation advance, backwards generations and other unavailable-source transitions remain ordinary
detector failures.

A successful callback resets to neutral entry and proves authentication again. Failure or
cancellation poison-closes the resource. Failed closure retains poison and refuses reuse;
`AggregateError` preserves both operation and cleanup failures.
Browser observations distinguish `starting` login from authenticated, leased unknown, failed and
proved closed states. The dashboard keeps closed system history separate from live browser identities.

`withTransactionDriver` gives the transaction a lease signal that follows the run's abort until
the sequencer's one-way `retainAfterFence()`. Before the fence, abort races the callback normally.
After the fence the lease stops following the run: only task deadlines bound the commit,
verification and settlement, and the callback keeps its resource until actual settlement. The run
then meets its abort at the next boundary, including after its last node. A callback that never
settles leaves the session and `attempting` write process-owned until process loss permits write
recovery.

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
| `src/backend/systems/i9/login.ts` | Exact I-9 Complete application origin, visible Search Options control, and absent TritON form. UCOP launch and campus selection join the shared backend Fast Duo ceremony. Training dismissal must complete before application proof. No authentication-only cookie is claimed. |

`verifyUcsdAuthenticatedApplication` in
`src/backend/systems/browser-shared/ucsd-sso.ts` combines the positive observation with absence
of the TritON form and any declared system sign-in controls. The factory's neutral reset uses the
same verifier. There is one definition of authentication for login and reuse.

### 4.2 Duo refusal and extension credentials

`waitForAuthenticatedLanding` in `src/backend/systems/browser-shared/ucsd-sso.ts` races landing
against Duo's rendered terminal refusal. The canceled-or-timed-out screen throws
`DuoTerminalRefusalError`; the runtime does not click Try again or wait for the acquisition envelope
to expire before reporting that outcome.

The operator sentence is the catalog text for `DUO_TERMINAL_REFUSAL`. A nonadvancing WebAuthn
count is a cloned-key signal. Check the backend's durable reservation lineage before changing
`timeouts.duoApprovalSeconds` or `timeouts.sessionAcquireMs`.

The WebAuthn counter belongs to the credential across sessions. `duo-credential-store.ts`
reserves `max(highWater + 1, nowSec)` in its existing encrypted native publication transaction.
`duo-signing.ts` then produces the Node ECDSA assertion. Failed signing, unknown publication and
crashes never refund a request ID or count. Signup uses the exact draft scope; ready workflow
sessions use genuine machine/profile admissions. Fast Duo uses the backend signer for both paths.

`fast-duo-extension.ts` stages an allowlisted runtime under the owned browser profile.
Signup uses `relay-manifest.json`; workflow sessions use `workflow-manifest.json` and the
credential-free workflow broker. The workflow extension has no storage permission, credential
installation or local signing service. Native extension sender, Duo origin, tab/frame/document
lifecycle and observed account are checked before and after signing and before reply. Public
credential selection stays in the backend. Only an explicit valid no-software-match response
hands off to native authentication; failures, cancellation and late replies reject.

`defineVerifiedLoginRecipe` remains the only ceremony-gate caller. Its existing lease callback
binds the actual token to the factory's signing scope. The broker may install and wait before a
ceremony, but signing and reply require that current unretired token, matching worker/system and
credential identity, unexpired TTL and current profile/worker ownership. Stop drains pending broker
work before closing its native context, within one shared proof deadline. Native closure is attempted
even if broker stop fails; either failure retains the profile reservation.
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
`assertFastDuoReady` checks the workflow extension manifest and admitted signing source before launch
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

`src/backend/app/composition/dashboard/shutdown-custody.ts` closes HTTP and stream consumers, stops
observers, and awaits `drainOwnedChildren`. The supervisor uses the ordinary graceful stop and
escalation policy, then observes owned child exits. Failure to observe exit is a shutdown failure.
Closing the supervisor cancels its timers and returns any remaining live-child evidence for the
structured fault sink. The dashboard closes its database before releasing its process lock and
runtime admission. After clean resource closure, the held lifetime owns verified person backups and last-three shutdown retention before it can release the listener. Failed closure or backup verification prevents a successful shutdown.

HTTP closure awaits admitted route tasks and response-body cancellation. A known client or shutdown
cancellation with fulfilled cleanup does not retain uncertain custody. Failed cancellation or local
failure observation keeps its original causes. Handled request failures retain their catalogued HTTP
response; only runtime/source-custody failures, including nested causes, hold later storage closure.

Confirmed application quit and whole-runtime shutdown first hold new-work admission, then request
pause on every nonterminal run except parked UNKNOWN writes. Active callbacks, including an in-flight
submit, settle before claim release and worker drainage. Queued, gate and delegation holds retain
their exact state. Shutdown closure proves stopped resources and unchanged browser and credential
membership while retaining paused runs and their exact parked write intents. A failed profile
activation closes the same way. Credential-copy closure requires settled writes and terminal runs;
logout closure requires settled writes and accepts paused runs. Settings saves cannot advance
the runtime generation while update or shutdown admission is held. Startup recovery classifies an
interrupted read as failed with structured failure evidence; an unfinished submit remains parked
UNKNOWN and is never automatically retried.

Logout holds new-run admission and drains workers, command activity and account resources before
publishing the logout operation or revoking the profile epoch. The drain cancels a claimed run that
stands alone (no parent, no live children) with Relay's logout reason. It pauses every other live
run, including claimed members of an operation or delegation, so never-claimed work and run graphs
resume after the next sign-in; each worker settles its paused claim at a step boundary before it
exits, as on quit. Worker cleanup and lease settlement retain their admitted
generation throughout that drain. Revocation requires the completed controller-owned proof of the
exact epoch and native custody snapshot; changed or unproved custody and UNKNOWN writes refuse
logout. The hold stays bound to its runtime generation, and fresh dashboard activation advances
that generation before admitting new work.

The application lifecycle query reports `installer-unavailable` without an update host and defers
updates while run, worker, browser, write, Duo, control or artifact owners remain. The tested idle
installation primitive holds admission before awaiting an injected host and retains the hold on
failure. There is no production idle/quit installer dispatch or native installer integration.

`src/backend/storage/admission/process-identity.ts` owns OS process-birth checks: a platform start
token per pid, so a reused pid with a different start token is a different process. No current
process writes records to the fixed lock root; any file there is an old build's and refuses startup
and stopped maintenance with `RUNTIME_OLD_BUILD_ARTIFACTS`.

The Darwin OS census in `src/backend/storage/maintenance/process-closure.ts` observes a filesystem
descriptor only when its name is a non-NUL absolute path equal to its normalized resolution. A
snapshot with an unresolved filesystem descriptor proves nothing; up to five descriptor snapshots
are taken, and only a fully resolved one proves the roots unused. A root match in any snapshot refuses.

### Offline cancellation of never-claimed queued runs

`storage cancel-queued-runs --plan --json` captures an established flat native6 installation
without changing source files or acquiring admission. `storage cancel-queued-runs --capture
<digest> --apply --json` rechecks that exact capture under restore admission and exclusive
installation custody, proves process/open-file/cwd absence, then cancels all eligible queued runs
in one transaction. Plan or apply refuses any other nonterminal run, prior claim, requeue,
checkpoint, write intent, delegation, active native resource, live owner or uncertain custody.
An old-build process record in the fixed lock root refuses plan and apply. Changes to captured database files, native inventory,
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
credential identity from the admitted backend `DuoSigningSource` when `features.duoWebAuthn` is
enabled. Identity excludes changing reservation counts. A missing source fails composition;
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

A fresh additive Run allocation refused before the spawner is entered has no child CLOSE to observe.
Its original supervisor records that positive control-flow proof privately, bound to the allocating
controller and exact refused command. Every spawner invocation irreversibly invalidates non-birth
proof before the call. During admitted drainage, a private capability-gated transaction may retire
only that exact final allocation using the existing Plan shapes, with an unchanged selected peer
roster and pool basis. Request, control, application, audit, slot and pool changes commit together;
consumption waits for the outermost COMMIT. The original refused Spawn and audit remain unchanged.
Replay never recreates proof or admits a missing settlement Plan, including its derived command
identity. Crash before COMMIT stays uncertain; completed retirement is historical settlement.
An absent child, lease, file or elapsed deadline never authorizes this path. Born children still
require actual CLOSE, and independent browser, write, database and backup closure requirements remain.

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

`pause-worker` also requests a pause on the worker's claimed run, under
`lifecycleCommandId("worker-pause", { workerId, runId, claimGeneration })`. An existing pause is
kept, and a pending cancellation wins. `resume-worker` resumes only runs paused under that id, and
refuses `worker-pause-settling` while such a pause is still requested. Stop on a worker cancels the
paused run its Pause holds, with its cascade-cancel children, through the operator Cancel arm in the
same admission transaction.

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

During a run the worker polls the run row every `WORK_CONTROL_POLL_MS` (250 ms). A requested pause
or a requested cancellation aborts the run's work signal; Stop is the reset's own run Cancel, so it
arrives as a requested cancellation. Stop is admitted while the claimed run's write is `attempting`
(a parked write still refuses it). The
executor settles the abort from the run row: a requested pause is acknowledged and the run requeues
paused, a requested cancellation terminalizes, and any other abort abandons. The cancelled step has no
checkpoint, so Resume replays completed checkpoints and runs it again under a new claim generation. A
transaction step is restartable until its fence. After the fence its write finishes, and the run
pauses or stops at the next boundary. A failure after the fence never becomes a pause: a settlement
that does not commit parks the write `UNKNOWN`, and a pause is never acknowledged over an
`attempting` write.

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

`storage/browser-roots.ts` owns the private `machine/browser-roots.json` registry outside person
SQLite. Reads and publications share the registry mutex, so readers inspect only settled publications.
Its strict bounded document records actual worker, signup or command ownership and launch generations.
Schema 2 assigns monotone, never-reused numeric handles. Signup roots use `browsers/onboarding/r<base36 handle>`;
their full operation, person, account and provider-generation binding stays in the registry. Reopening
the same registered owner keeps its handle; cleanup retires it. Unregistered physical targets refuse.
Each launch and native acquisition records intent before Chromium starts. A fresh full-Chromium
probe must acquire and close the exact profile before reuse or removal; saved closed/observed states
do not authorize effects. One row remains excluded through native closure, the awaited effect and
settlement. Only the scoped remover can delete that profile, and it expires when the effect returns.
Unknown files, ownership changes, unsafe paths and unproved closure hold the operation.

`runtime/browser/native-browser.ts` owns Playwright launch and page/context closure. Probes run
asynchronously under the registry owner. Read-only stopped inventory without a preparing receipt
must prove an empty browser census; a nonempty census requires recorded native preparation.
Unsupported credential envelopes refuse before preparation publishes its receipt. The stopped control converter records
its preparing receipt before probing, then captures credential copies and verifies its SQLite backup
before publishing browser registry, control and marker. Current control requires the external registry;
ordinary startup does not reconstruct it. An ordinary profile drain checks actual resource and registry
closure without minting native-unused permission. Closed roots retain their original session generation
across browserless Stop and a later sign-in; a drain refuses future-generation or unproved roots.
Physical retirement requires fresh native custody before scoped removal. Flat native6 maintenance keeps its finite stopped
owner and OS census. Busy profiles refuse with `BROWSER_PROFILE_STILL_CLOSING`; unproved native
closure refuses with `BROWSER_CLOSURE_UNPROVED` and retains the actual owner and root lifetime.
Stopped current-profile backup refuses any registered root whose launch is not closed or whose
native closure remains pending. A verified empty registry permits backup without an OS census.

Retained settings roots and authenticated verification scratch paths have distinct membership.
An absent directory is released only when the exact completed cleanup already proves owned context
closure and profile deletion. Startup `cleanup: interrupted` does not supply that evidence.

Duo onboarding derives its canonical directory from the authenticated operation, profile, account
and generation through `onboardingProfileDirectory`. Existing exact paths must pass native closure
before reuse or deletion, followed by a fresh exact owner check. Random or stale-owner directories
remain unknown and untouched. Recovery accepts missing paths only after the persisted finish or
abort step that follows actual owned drain. Failed retention or closure stays uncertain; startup
and extension message pumps settle before replacement. No Chromium PID or marker proves closure.

Application shutdown drains every tracked onboarding draft, then explicitly stops the owned Duo
provider even if a draft drain failed or no draft remains tracked. Provider stop revokes future
opens and awaits the existing attempt, extension pump, native browser and profile closure proofs.
A failed drain or stop remains a shutdown failure; it never clears UNKNOWN enrollment evidence.

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

Start replies once its enqueue commits; its capacity step runs after the reply, so the response
never waits for preflight or a member's ready handshake. A startup that then fails leaves the
workflow with failed worker cards or no worker, which the dashboard's sticky queued-run notice reports,
and reaches the supervisor fault log through the capacity's detached-failure report. While any capacity
step for a workflow is unsettled, that workflow's members that are not live are served as starting and
its queued rows carry no no-worker flag, so the notice appears only once startup has settled as failed.
The worker pool owns the detached step: stopping the pool for shutdown or logout closes starts, aborting a
pending worker preflight and refusing any later member start, and waits for the step to settle before
it returns.
Resume, Retry and Recover, single or bulk, still wait for capacity. Their response remains `applied` or
`already-applied` with the queued run targets when startup fails, and `workerStartup` carries
`RUN_QUEUED_WORKER_UNAVAILABLE`, the retained child command when available, and a distinct `refused`
or `unknown` startup state. The native control phase determines whether an admitted effect remains
uncertain. Exact replay asks for capacity again; it reconciles retained children without repeating
failed or uncertain effects or replacing a member that later crashed or was removed.
`src/backend/runs/commands/command-service.ts` runs one capacity step at a time per workflow and
admits one Start at a time per workflow, in separate lanes.

## Not built yet

- Wiring-base work connects the approved dashboard controls and session views to served worker and browser authority through the shared client.
- OnBase's concrete driver and login binding require live operator acceptance; fixture retrieval semantics do not establish live selector validity.
- Unbound browser systems need their driver and verified login binding before a workflow can use them.
- A workflow that declares `session:"fresh"` needs its node-ordering proof in addition to the manager's close-before-open tests.

Native results retain the exact terminal run context under `(runId, appliedVersion)`. Result creation and terminal authorization carry independent timestamps; retained run context uses its terminal authorization time. Receipts bind that same settlement. Current reads select the completion’s native applied version, or the exact terminal lifecycle evidence; an active run has no current settled output. Initial result and receipt payload bytes and initial receipt identities remain unchanged. Refreshed settlements receive distinct receipt identities; exact historical result reads authenticate the retained terminal authorization and its native command.
