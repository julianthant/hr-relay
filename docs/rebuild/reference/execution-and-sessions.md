# Execution and sessions — one-item workers, browser sessions, and the Duo ceremony

**What this doc is.** The contract for how work actually RUNS: the vocabulary (§1), the workflow
session contract (§2), the worker's claim/heartbeat/recovery lifecycle (§3), browser-session
ownership and the content-level authentication proof (§4), the speed contract (§5), failure
isolation (§6), the guards and the executed concurrency matrix (§7), a worked example (§8), the
settled defaults (§9), the built Duo ceremony lease (§10), and sessions plus the worker pool (§11).
Section 11 is deliberately split: its authority records and dashboard read view are built, while
the pool process and parallel proof remain designed. It is a REFERENCE spec: it states what holds,
and where the code differs the as-built is stated in the section it amends.

**Status, verified against the tree 2026-08-25 (D252, D267, D269).** §1–§9 are BUILT and running. One worker
owns one active run (`src/core/worker-loop.ts`), its browser sessions are callback leases keyed on
the whole `(worker, system, instance, configFingerprint)` identity (`src/core/worker-sessions.ts`),
the concrete factory launches Playwright's full Chromium with the Duo Autopilot extension and proves
every close (`src/infra/browser/browser-session-factory.ts`), four systems are bound
(`src/infra/browser/system-bindings.ts`), and D182's concurrency matrix executes the multi-worker
cases against real `runWorkerLoop` instances over one authority database (§7.1). §10 is built as
the durable D267 ceremony lease and recovery contract; §11's authority records and dashboard read
view are built, while its pool process and parallel proof remain designed. The executor-lane and
static per-system capacity design is retired and stays retired (§0).

Four dated Phase-1 stage blocks (1d's seam ratification, the 1f runtime, the 1f concrete factory and
D125's bound) stood above §0 until 2026-08-21; their contracts are folded into §2, §4, §4.1 and §4.3
and the originals are preserved verbatim in
`history/superseded/2026-08-21-execution-and-sessions-phase-1-stage-ratifications.md`.

## Ownership (D1)

| This doc **OWNS** (siblings reference, never redefine) |
|---|
| Worker claim/heartbeat/recovery behavior and the one-item-in-flight invariant |
| Browser-session ownership, reuse, reset/close discipline, and explicit fresh-session boundaries |
| Worker spawning and queue dispatch/backpressure |
| The speed contract: condition waits, sleep-tax removal, and bounded operations |
| The page/subject-isolation invariant (§6.1) |
| Authentication as a content-level observation, and the per-credential Duo ceremony (§4.1, §4.2, §10) |
| What a SESSION is — a dashboard-started group of runs — and the worker pool that serves one (§11) |

| This doc **references** (owner) |
|---|
| Task contract, `SessionNeed`, exclusive driver use, retry policy → **ref task-contract** |
| Run state machine, gates/parks, checkpoints, RunEnvelope → **ref workflow-model** |
| Worker/run/task span wire schema, Session Panel projections, notes → **ref dashboard-surfaces** |
| Command/claim authority, degraded storage mode, notifications → **ref dashboard-surfaces** |
| The write fence, its recovery and its typed operator resolutions → **ref write-safety** |
| Semantic UI ids, typed drivers, action evidence, scenarios → **ref operator-trust** |
| `timeouts.*`, `browser.*`, the config snapshot and D116's fingerprint → **ref clock-config-secrets** |
| Every guard named in §7, and the test tiers a dry-run scenario belongs to → **ref guards-and-tests** |
| OnBase cross-process identity lease → **D15** |

Grounding: legacy's daemon has one `state.activeRun` per process. The rebuild keeps that
understandable ownership model and removes the proposed scheduler inside each process.

---

## 0. Settled decision

1. **No executor lanes.** There is no global `lanes` number, lane reservation, capacity chip, or
   per-workflow lane cap.
2. **No static per-system capacity math.** There is no `ucpath 1/1` or `crm 1/2` budget contract.
   Concrete browser session tiles show the sessions that actually exist (§4's D248 as-built).
3. **One worker, one active item.** A worker does not claim a second run until its active run parks
   or reaches a terminal state. This is enforced as a THROW, not a typed outcome: `claimNext`
   refuses while a worker id still owns a non-terminal run (§3.0).
4. **Parallelism is worker count.** Starting N workers for a workflow creates N independent workers.
   The Add-workers UI does not invent a hidden lease calculation or global cap. **As built, the
   runtime starts one worker per workflow, from the CLI** — `createPhase1WorkerRuntimeExecutor`
   refuses a plan for `desiredWorkers !== 1` and the dashboard's supervisor refuses to spawn a
   process by name (`src/core/worker-loop.ts`, `src/server/dashboard/compose.ts`). The pool that
   makes item 4 reachable from a surface is §11, and it is designed, not built. Nothing about the
   kernel serializes: §7.1's matrix runs N real loops over one authority database today.
5. **Browser sessions belong to a worker.** Distinct workers own independent system sessions, down
   to independent on-disk profile directories (§1).
6. **Workflows declare fresh-session boundaries.** Reuse is normal. If a particular step must run
   in a new browser session, the workflow descriptor says so explicitly. The kernel never infers a
   boundary from a counter, step name, or queue state.
7. **No cross-workflow browser pool.** Authenticated pages are not shared between unrelated
   workflows.

**One resource is shared whether we like it or not, and item 7 does not reach it.** Every UCSD
system authenticates through one SSO credential, and Duo's WebAuthn signature counter for that
credential lives on Duo's side while every profile keeps its own unsynchronised copy (§4.2). So two
workers that never share a page still share a counter. That is not a pool and cannot be fixed by
declaring one; §10 serializes the CEREMONY instead.

“Lane” remains valid terminology for test suites (`stub lane`, `live lane`) and visual workflow
graph branches. Those uses do not describe executor capacity and are unaffected.

---

## 1. Units, named precisely
<!-- roadmap: phase-1 -->
<!-- roadmap: parallel-runs -->

- **Run** — one item's execution of a workflow.
- **Worker** — one long-lived process assigned to one workflow. It owns at most one active run and
  its browser sessions. Its id is its identity in authority: the worker LEASE admits exactly one
  live process per id, which is what makes "every row still claimed by this id is orphaned" a
  statement a process may make about itself (§3.0).
- **Browser session** — one authenticated `BrowserContext` and controlled page/window set for one
  system inside one worker.
- **Profile instance** — the on-disk Chromium profile directory a browser session runs in. Chromium
  locks a profile directory, so two live sessions may never share one. The path is
  `<browserProfileRoot>/<browserSessionNamespace>/<workerId>/<system>-<instance>-<fingerprint12>`
  (`workerProfileDirectory`, `src/infra/browser/browser-session-factory.ts`). **Read the segments
  precisely**: `instance` here is the runtime ENVIRONMENT (`prod` | `test`,
  `src/domain/config/instance.ts`), not a per-worker counter — the per-worker separation is the
  `workerId` segment, and the fingerprint segment is D116's rule applied to disk state so a config
  change cannot be inherited through a warm profile. The namespace segment is what keeps a rebuild
  profile from ever being the legacy one even if both roots pointed at the same directory (D216).
- **Driver lease** — exclusive task-length access to a system driver backed by the worker's current
  browser session. A transaction may retain it across prepare → fence → commit → proof.
- **Fresh-session boundary** — an authored workflow instruction that closes the current session for
  a named system before the next node and authenticates a new one.
- **Session** (§11) — a dashboard-started GROUP of runs, and the only unit in this list that names
  more than one run. It is not a browser session and not a worker; D269 persists the authority
  grouping and P4 renders its day-wire membership, while the process pool that serves it remains
  unbuilt.

---

## 2. Workflow session contract
<!-- roadmap: p1-authority -->

<!-- roadmap-status: p1-authority -->
- [x] ONE imported `SessionNeed` (D96), owned by ref task-contract and never redefined here (`src/domain/session.ts:4`)
- [x] all nine browser systems declare exactly one session provider, OnBase alone `exclusive:true`, enforced at `defineSessionProvider` and by the `task-store-boundaries` guard
- [x] `session` is authored as a string literal or supplied by the schema default; a computed value is refused (`fresh-session-boundary`)
- [ ] the descriptor-level node-execution-ordering arm of `fresh-session-boundary` — no workflow authors a `session:"fresh"` node yet, so the arm has nothing to execute
- [ ] the OnBase identity lease (D15): `onbaseSession` declares `exclusive:true` and the store is a three-line stub with no driver and no login (`src/stores/onbase/session.ts`)
> 2026-08-21 | docs-cohesion execution-and-sessions | verified against src/domain/session.ts, src/base/session.ts, src/stores/*/session.ts and guard-inventory.json; the 1d block's "every placeholder login rejects with 'declared but unwired in Phase 1d'" is no longer true of any store — that refusal moved to the factory
<!-- /roadmap-status -->

The descriptor compiler resolves every browser-backed node to an explicit policy. The type is
**imported from ref task-contract, never restated** (D96) — this doc owns worker/session BEHAVIOR
and does not own the shape:

```ts
export const SessionNeedSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  access: z.enum(["read", "transaction"]),
  session: z.enum(["reuse-worker", "fresh"]),
  exclusive: z.literal(true).optional(),
  acceptDownloads: z.literal(true).optional(),
});
```

- `reuse-worker` uses the worker's current healthy authenticated session for that system, creating
  one lazily if none exists.
- `fresh` first performs the bounded close protocol, then creates and authenticates a new session
  before the node begins.
- Read tasks require read access; prepare/commit tasks require transaction access. A mismatch fails
  at the task/store boundary, before an executor exists.
- Authoring may omit `session` only where the descriptor schema supplies the literal, test-pinned
  default `reuse-worker`. Runtime code never guesses, and `fresh-session-boundary` refuses a
  `session:` value that is a computed expression rather than a literal.
- `exclusive:true` is legal only for OnBase, and OnBase is the only identity-exclusive provider
  declaration. `defineSessionProvider` refuses both halves — an OnBase provider without it, and any
  other system with it.
- A session boundary is visible in the Explorer and worker/run spans as
  `browser_session:close` followed by `browser_session:start`, including system and reason.
- A workflow that needs several sessions states boundaries at the exact nodes. It does not raise a
  worker-wide number or create a second item slot.

**As built.** All nine browser systems declare exactly one provider through
`defineWorkerSessionProvider` (`src/base/session.ts:144`), whose whole body is one bounded
`handle.authenticate(system, options)` against the worker-owned handle — browser and context
creation stay with the factory. The Phase-1d placeholder that threw *"declared but unwired in Phase
1d"* is no longer any store's provider: `defineUnwiredSessionProvider` survives only as a
type/behaviour fixture in `tests/`. The refusal it used to carry now lands one layer down and
earlier, at the factory: a system with no landed `(driver, login recipe)` binding throws
*"has no landed browser-session binding … refusing to open a browser that cannot be used"* before a
browser exists (`bindingFor`, `src/infra/browser/browser-session-factory.ts`). Four systems are
bound today — **ucpath, crm, kuali, new-kronos** (`src/infra/browser/system-bindings.ts`); i9,
servicenow, old-kronos, onbase and sharepoint declare a provider and refuse at open.

### 2.1 Gates and parks
<!-- roadmap: p1-kernel -->

A parked run owns no browser resources. Before parking, the worker resets/closes active sessions
according to the provider policy and releases identity leases. Resume is a fresh claim. An overnight
approval holds neither a browser nor an execution slot.

The teardown is ordered, not best-effort: `closeAll("parked")` and `closeAll("worker-stop")` first
REJECT new leases, then wait behind every in-flight callback, then close every owned resource
(`WorkerSessionManager.closeAll`, `src/core/worker-sessions.ts:379`). A second concurrent `closeAll`
throws by name rather than racing the first, and a close whose proof fails leaves the resource
registered and poisoned — §7.1 row C6/C7 execute both.

---

## 3. Worker lifecycle and claiming

**Worker-table naming amendment (2026-09-08; [side/worker-names](../../sidetracks/worker-names/README.md)).**
Schema 35 names the worker lifecycle authority `workflow_workers` (formerly `leases`)
and the credential-scoped Duo lock `worker_auth` (formerly `duo_ceremony_leases`).
`worker_pools` retains its name and declaration/CAS role. Worker repository interfaces,
lease generations, heartbeats, directives, authentication scope and timings are unchanged.
`worker_auth` holds one expiring authentication lock per credential across workers and
systems; it stores no password. Historical schema, trigger names and dated evidence retain
released names. D267 and D269's behavior below is unchanged.
<!-- roadmap: p1-kernel -->

<!-- roadmap-status: p1-kernel -->
- [x] the one-item worker loop: directive → claim → one awaited run → heartbeat, with every wait bounded (`runWorkerLoop`, `src/core/worker-loop.ts:190`)
- [x] the claim protocol in authority — owner, attempt, claim generation, heartbeat renewal, fenced terminalization, dead-worker recovery (1c/1f; `run-authority.test.ts`)
- [x] D118 — an expired claim holding an `attempting` write intent reaches ref write-safety recovery before any queued/claimable transition (`claim-sweep-recovery.test.ts`)
- [x] D200 — the startup self-sweep, scoped by `workerId` because the won lease is the evidence (§3.0; `src/server/worker/compose.ts:472`)
- [x] D116 — the claimed run's immutable `configFingerprint` is bound for exactly the execution window through the one shared `withBoundRunConfigFingerprint` helper (`src/core/worker-sessions.ts:245`)
- [x] the callback-leased browser sessions, their poison rule and their proven close (§4; `src/core/worker-sessions.ts`)
- [x] the content-level authentication proof on every return path (§4.1; `authentication-proof-not-url`)
- [ ] more than one worker per workflow reachable from a surface — the kernel takes N loops today (§7.1), the runtime composes ONE (§0 item 4, §11)
> 2026-08-21 | docs-cohesion execution-and-sessions | verified against src/core/worker-loop.ts, src/core/worker-sessions.ts, src/server/worker/compose.ts and src/infra/sqlite/run-store-contracts.ts; the illustrative loop snippet that stood here named three functions that do not exist and was replaced by the real shape
<!-- /roadmap-status -->

Each worker is workflow-scoped and runs the claim-generation protocol. The shape, as built
(`runWorkerLoop`, `src/core/worker-loop.ts`):

```ts
while (!stopSignal.aborted) {
  const directive = controlPoll();                 // durable, read BETWEEN items only
  if (directive === "stop") break;                 // the active run always settled first
  if (directive === "pause") { await boundedWait(idleRepollMs); continue; }

  const claimed = authority.runs.claimNext({ workflow, workerId, now });
  if (claimed.state === "idle")     { await boundedWait(idleRepollMs); continue; }
  if (claimed.state === "deferred") { await boundedWait(min(untilNextEligible, idleRepollMs)); continue; }

  const heartbeat = startHeartbeat({ runId, claim, intervalMs, onLost: abortRun });
  try {
    // D116: the run's immutable config fingerprint is part of every driver lease's identity
    await withBoundRunConfigFingerprint(sessions, run.envelope.configFingerprint,
      () => executeClaimedRun({ … }, { run, claim, signal }));
  } finally { heartbeat.stop(); }
}
// on every exit path, including a throw:
await sessions.closeAll("worker-stop");
```

- Claim authority is SQLite with owner, attempt, claim generation, heartbeat renewal, fenced
  terminalization, dead-worker recovery, and bounded re-poll.
- A worker renews exactly its one active claim. A renewal that reports the claim LOST aborts the
  run's signal; the loop abandons rather than terminalizing over a new owner (§7.1 row C4).
- A gate parks the run and frees the worker to claim another item.
- Retry backoff rides `not_before`: `claimNext` answers `deferred` with the next eligible instant,
  and the loop waits the SHORTER of that and `idleRepollMs`. A worker never sleeps while owning a
  run merely to wait for a retry time, and never sleeps unboundedly.
- Durable worker directives (`run` | `pause` | `stop`, ref dashboard-surfaces §2.4) are read
  BETWEEN items, never mid-run: `stop` ends the loop only after the active run settled, `pause`
  stops claiming without ending the worker, and a directive that cannot be read throws the loop
  loudly — an unreadable directive is never treated as `run`.
- `+ Add workers` chooses a workflow and a count. Starting 5 would create 5 independently owned
  workers and browser-session sets — the kernel is built for it and §7.1 proves it, but the control
  and the pool behind it are §11.
- An expired claim is not ordinary requeue authority. Before the claim sweeper can transition an
  interrupted run back to `queued`, it checks the authoritative write-intent set for the run's
  workflow/item/node. Any unfinished `attempting` intent routes to ref write-safety recovery first
  and keeps the run unclaimable for normal execution. Only a schema-valid positive recovery
  completion or a schema-valid safe-to-retry/confirmed-absent resolution may release it to the
  corresponding terminal/new-generation path. An unavailable or inconsistent intent lookup
  parks/refuses; it never means “no unfinished write.”

### 3.0 A worker sweeps its OWN id before its first claim (D200)
<!-- roadmap: p1-kernel -->

`claimNext` refuses while a worker id still owns a non-terminal run — §0.3's "one worker, one active
item", enforced as a throw, not a typed outcome. The D118 sweep that would release such a row lives
in the maintenance ticker of a RUNNING worker, whose first beat already fires before the loop's first
claim. **That beat is staleness-gated, and the gap is exactly there.** A worker whose loop throws
settles its LEASE on the way out and leaves its claimed row where it was; the next process wins the
lease seconds later, and the row it inherits carries a heartbeat far younger than the 60s threshold,
so the sweep skips it and the first poll throws `worker … already holds active run …`. Before this,
the only ways out were starting a DIFFERENT workflow's worker or cancelling the run — neither of
which is a recovery path.

So the composition runs one **self-sweep** immediately after `workerLeases.start` succeeds, before
the loop. Three properties make it safe and keep it from becoming a second recovery path:

1. **The lease is the evidence, not a timer.** `start` succeeded, therefore no other process answers
   to this worker id, therefore every row still under it belongs to a process that is gone —
   regardless of heartbeat. That is a claim a process may make about ITSELF and about nobody else,
   which is why the sweep request carries a `workerId` scope rather than a widened `staleBefore`.
   Widening the threshold instead would release every live sibling worker's fresh claim at the same
   instant. `RunClaimSweepRequestSchema` therefore admits **exactly one** proof of death —
   `staleBefore` or `workerId`, never both and never neither.
2. **It is the SAME sweeper.** Only the scan predicate differs; the D118 write-intent gate, the
   park/requeue routing and the transition legality check are one code path. A run whose logical item
   holds an unfinished `attempting` intent parks (`parked-write`) or stays held, and NEVER requeues.
   A startup path that re-implemented "release my own rows" would hand a possibly-landed real HR
   write straight back to the executor.
3. **What no sweep may release is reported, not endured.** A `claimed`/`validating` row holding an
   attempting intent has no legal parked-write edge, so it stays owned and the worker id stays
   wedged. Startup refuses with that run named and ref write-safety §4.1's typed operator resolutions named as
   the way out, instead of letting the first poll throw `already holds active run` with no reason
   attached.

The sweep is not a cadence question and does not change the ticker: the periodic sweep stays global
and staleness-gated, because it knows nothing about who owns a row.

**As built** (`src/server/worker/compose.ts`): the composition reclaims a stale worker LEASE, calls
`workerLeases.start`, and only then runs `runs.sweepExpiredClaims({ workerId, now })` — in that
order, because the lease is the evidence and it has to be held before it can be cited. The startup
refusal for a row no sweep may release names the run and points at ref write-safety §4.1's typed
operator resolutions. `RunClaimSweepRequestSchema` (`src/infra/sqlite/run-store-contracts.ts:171`)
carries the exclusivity as a `superRefine`: exactly one of `staleBefore` / `workerId`, never both
and never neither.

### 3.1 Dispatch and fairness
<!-- roadmap: p1-kernel -->

Within a workflow queue, claim order is priority then FIFO — literally
`ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END, created_at, record_key`
(`claimNext`, `src/infra/sqlite/authority-database.ts:4063`). Interactive work is therefore
server-stamped ahead of bulk members with no reserved interactive lane, and the third key makes the
order total, so two rows created in the same millisecond still claim deterministically. Across
workflows, the operator chooses worker counts per workflow, and each worker claims only its
workflow's rows. A large fan-out cannot consume another workflow's workers.

Provider capacity is a separate admission domain, not a browser lane. Before a service task calls
a remote provider, the generic capability admission service reserves the applicable
concurrency/rate/daily-use/cost budget from the run's immutable config snapshot. If admission is not
available, the kernel records the typed wait/unavailable reason and releases or reschedules with
`not_before`; it does not keep a worker asleep and cannot fall through to the adapter. Phase 2h's
production pools and consumers sit over this core, not beside a second scheduler.

**D112 durable admission as built (2026-08-03).** Capability-global authority counters use fixed
UTC-minute rate and fixed UTC-day request/cost windows, while each decision retains the requesting
run's exact immutable config snapshot and fingerprint. Reservation atomically expires stale leases,
rolls windows, reserves one request plus the adapter's conservative maximum cost, and either grants
or records a typed denial before any remote call. Settlement releases concurrency and may reconcile
cost down; invoke failure, timeout, crash/unknown, and lease expiry retain the full reservation.
Actual cost above the estimate blocks that capability through the UTC day and fails loud. A
retryable denial maps its exact `retryAt` to run `not_before` with cause `provider-capacity`; abort,
timeout, and adapter-unavailable carry no retry instant. No admission path sleeps while holding a
worker. (`src/core/provider-admission.ts`; `provider-admission.test.ts`, `provider-pool.test.ts`,
`advisory-provider-exhaustion.test.ts`.)

---

## 4. Browser-session behavior
<!-- roadmap: p1-kernel -->

**A browser session is a callback LEASE, not a handle a caller holds.**
`WorkerSessionManager.withDriver(need, instance, signal, operation)` is the whole surface
(`src/core/worker-sessions.ts`, `WorkerSessionManager.withDriver`): it serializes use per system inside the worker, acquires or
reuses the resource, runs the callback with the concrete driver, and decides what happens next from
how the callback ENDED. There is no `release("clean")` call for a caller to forget.

Ref write-safety has one explicit specialization rather than weakening that general contract:
`withTransactionDriver` gives only the write sequencer a one-way `retainAfterFence()` transition.
Before the sequencer calls it, parent abort races acquisition/use and poison-closes exactly like
`withDriver`. After a durable fence, parent abort is recorded and forwarded to the task, but the
manager cannot return, reset, or close while the callback remains unsettled. Once it settles, the
original cancellation/failure is raised and the ordinary poison-close runs exactly once. A callback
that never settles therefore leaves its session and `attempting` intent process-owned until process
loss makes ref write-safety §4 recovery the owner; it never becomes detached live I/O.

- **Driver use is exclusive while held**, serialized per `(worker, system)`.
- **A callback that RETURNS resets.** The resource re-navigates to the system's entry route and
  re-runs that system's full authentication proof (§4.1) before it may be reused — so "reusable" is
  an observation, not an assumption, and a reset that lands anywhere but the authenticated
  application refuses by name (`#resetToNeutralState`,
  `src/infra/browser/browser-session-factory.ts:339`). The next read owns navigation from that
  neutral state: neutral reuse is not reuse of the prior subject page, and it is not a fresh context
  unless the authored need says `session:"fresh"`.
- **A callback that THROWS poison-closes**, as does a failed reset, an aborted Playwright call or a
  subject mismatch. If the poison-close itself cannot be proven, both failures are raised together
  in one `AggregateError` and the resource is RETAINED as poisoned — the next lease for that system
  refuses by name rather than inheriting an uncertain page.
- **A fenced transaction callback cannot be abort-detached.** Its parent cancellation is retained
  until actual callback settlement; deadline-first plus parent-abort preserves the callback failure
  first and the later cancellation second, while parent-first cancels the still-pending task bound.
- **Reuse requires the COMPLETE identity** — this manager (the worker), the system, the resolved
  instance and the run's bound `configFingerprint` (D116) — plus agreement on the two launch
  properties, downloads and exclusivity. Any drift closes the old resource with an accepted proof
  BEFORE a replacement is authenticated; a context configured under another run snapshot is never
  reused, on disk or in memory (§1's profile path).
- **Browser presentation is immutable run input (D306).** A dashboard start plan records exactly
  `headless` or `headed`, copies it into every fan-out/retry/relaunch envelope, and the worker binds
  that value before the first lease. It is part of in-memory reuse compatibility and the persistent
  profile partition, so changing presentation closes the old context before opening another one.
  The Run Options surface defaults a new or reset dashboard start to `headed`; the operator may
  explicitly select `headless`, and either choice is persisted rather than inferred by the worker.
  Historical/programmatic envelopes that predate the field retain `browser.headless` from their
  captured config as their compatibility default; a newly planned dashboard run never omits it.
- **A `session:"fresh"` boundary uses that same close proof** before replacing the session, and a
  D116 identity mismatch takes the identical path — which is why `fresh-session-boundary` audits
  both arms.
- **A driver lease is impossible without a bound run.** `withDriver` refuses when no
  `configFingerprint` is bound (D116) and refuses while the manager is closing for `parked` or
  `worker-stop`.
- **OnBase releases its identity lease only after every page/context close is proven.** Declared,
  not landed: the OnBase store is a provider declaration with no driver and no login recipe.
- **Login is bounded and single-flight** within that worker/system session creation
  (`single-flight-login`): two concurrent leases for one system produce exactly one open and one
  authentication. There is no cross-worker login promise or shared context — which is precisely why
  the Duo ceremony needs its own cross-worker lease (§10).

**The concrete factory** (`src/infra/browser/`) launches Playwright's FULL bundled Chromium
(`channel: "chromium"`) in a persistent context with the Duo Autopilot MV3 extension loaded. All
three are requirements rather than preferences: Chrome stable dropped `--load-extension`, the
lightweight headless shell cannot run an extension, and an extension requires a persistent context.
The prerequisites are proven BEFORE a browser exists — `assertDuoAutopilotReady` refuses a missing
or unreadable `manifest.json` and reads the credential through the single secret reader — so a
missing extension is a legible refusal rather than a login that hangs on an unanswerable prompt.
Profiles live at §1's partitioned path.

**`close()` returns a proof only after observing THREE facts** inside `browser.closeProofMs`
(15 s): every page reports `isClosed()`, no new page appeared, and the context emitted its own
`close` event. `await context.close()` resolving proves none of them. An unproven or timed-out close
throws, and the manager's poison rule does the rest (`#closeWithProof`).

**Where browser knowledge lives.** Login recipes stay with their stores (`stores/<system>/session.ts`),
which — together with `src/infra/browser/**` — are the two raw-browser owner families the
`task-driver-boundary` guard permits; task and workflow code may reach neither, transitively or
otherwise. A system without BOTH a landed driver and a landed login recipe refuses at open rather
than launching an unusable browser (`bindingFor`). Four are bound: ucpath, crm, kuali, new-kronos.

An individual workflow may declare internally proven parallel work, such as OCR provider page
concurrency. That is workflow-owned behavior with its own tests, not a generic executor capacity
model.

**What the Session Panel shows** (ref dashboard-surfaces owns the surface): worker phase, queued
count, trace id, current step, the lease's launch-time browser-system requirements, the exact
sessions currently open, and failure state. Ref dashboard-surfaces §9.9 owns how those separate facts
are drawn. It does not show lane or per-system capacity counters, and Settings has no lane/budget
reference page.

**As-built (D248, 2026-08-20).** The panel's card is this section's lease — `workflow`, lifecycle
phase, the operator's standing directive, the started/stopped instants, the stop reason and the row
version — joined with the browser sessions the worker's own spans have open. Two items of the list
above are NOT drawn, each for a producer that does not exist in this platform rather than for a
surface that was skipped. There are no **wait reasons**: §1 partitions a browser profile per worker,
so a second worker opens its own UCPath window rather than queueing behind the first, and there is
no cross-worker lease to name a holder for. *(§10 introduces exactly one such lease — for the Duo
ceremony, not for the session — and a waiter blocked on it will have a holder to name. That is a
producer this sentence gains when §10 lands, and the reason the two sections cross-reference.)*
The lease persists the descriptor's ordered browser-system set when the worker starts; the
dashboard never re-derives that set from its own potentially newer code. An older lease without the
field remains readable and projects explicit unavailable authority. Ref dashboard-surfaces §9.9
owns the requirement/open-session overlay. Because the card set is lease authority while the
projection's change triggers are spans, the dashboard's span-tail tick also re-reads the exact
lease set the cards render, plus the pool declarations, and publishes a fresh snapshot when a
served fact moves — a lease born before its first span, the ticker's `starting` → `idle`, an
operator directive, a crash or expiry settled by another process, or a `plan-worker-count`.
Heartbeat instants and the versions they bump draw nothing and publish nothing. Pool workers are
launched through `scripts/secure-env-bootstrap.ts cli`, the CLI's sole invoker; a launch naming
`src/cli.ts` directly spawns an inert child that exits 0 before proving its lease birth. There is no **health** on an open tile: nothing probes a
live session, so it states which system its session speaks to and how long it has been open, and
reads `Not checked`
(`src/dashboard/surfaces/shell.tsx:710`) — which is the honest verdict and must never be drawn as a
passing one. `stop-worker` and `pause-worker` reach the lease from the panel; `spawn-worker` and
`refresh`/`reopen-browser` do not, because their process effects refuse by name in the dashboard
process (§11 owns the spawn half).

### 4.1 Authentication is a content-level observation, never a URL (D120)
<!-- roadmap: p1-kernel -->

**A session is authenticated only when the page proves it. A URL never proves it.** A URL is chosen
by whoever served the redirect; a system's sign-in page and its application routinely share a host,
and PeopleSoft's signon renders at the same route shape as the application it guards. Every browser
system therefore declares an **authenticated-application verifier** returning a discriminated probe,
and it must establish TWO independent facts:

1. a **positive** fact — a session artifact the server issues only after a completed authentication.
   An app-only DOM marker is an acceptable positive fact where no such artifact exists; and
2. a **negative** fact — no sign-in form of any kind is on the page (the shared UCSD TritON form,
   plus the system's own application-side login form).

| system | positive fact | recorded strength |
|---|---|---|
| ucpath | PeopleSoft's `PS_TOKEN` cookie (`PS_TOKENEXPIRE` is deliberately NOT accepted — PeopleSoft writes it on the signon page too) | server-issued |
| crm | Salesforce's `sid` Communities cookie | server-issued |
| new-kronos | WFD's own issued session cookie, observed twice `NEW_KRONOS_SESSION_COOKIE_POLL_MS` apart after landing | server-issued |
| kuali | rendered Kuali Build application chrome | **weaker, and said so in the code**: Kuali issues no cookie this repo has verified as an authenticated-only issuer, so the marker is paired with an explicit SSO-form absence and the weakness is recorded rather than smoothed over |

A URL predicate may be a NECESSARY precondition a verifier checks first — it is never sufficient,
and it is never the conclusion. Every verifier here refuses the URL first with its own named reason
(new-kronos's is worth quoting: *"the ForgeRock sign-on host shares the mykronos.com domain and is
refused here"*), and then proves the two facts. A probe that cannot RUN reports "not authenticated"
with a reason that says so; "I could not check" must never read as "it passed" — which is why a
timeout inside a positive probe returns `holds: false` with the timeout as its detail instead of
throwing past the decision.

**The verification is unskippable and singly defined.** A login recipe is built by
`defineVerifiedLoginRecipe` (`src/infra/browser/authenticated-application.ts:159`), which runs the
verifier AFTER the recipe's flow whatever the flow returned, so `already-authenticated` and
`logged-in` are labels on the same proven state and a later early `return` cannot reintroduce a
bypass. The flow is handed the SAME verifier as its `probe`, so its "are we already in?" decision is
the identical two-fact check rather than a cheaper URL guess. The clean-release neutral reset
asserts through the same verifier (§4) — there is one definition of "authenticated", not one per
call site — and `assertAuthenticatedApplication` additionally refuses evidence produced for a
DIFFERENT system than the one being proved. The evidence that proved it travels on a required
channel so an operator surface can show WHAT was observed, and `browser-session:start` carries the
distinct `LoginResult` so a run that never authenticated cannot look like one that did.

This ratifies a 2026-08-03 live finding: a UCPath login smoke reported success in ~3s having never
authenticated, because the recipe matched a host substring on the PUBLIC UCPath portal and the
neutral reset accepted a signon page. `authentication-proof-not-url` (ref guards-and-tests) pins the
shape: every recipe is built by the wrapper, no recipe produces a `LoginResult` outside it, every
landed binding supplies a verifier rather than an `isAuthenticatedUrl` predicate, and the factory's
neutral reset asserts through `assertAuthenticatedApplication`.

### 4.2 A refused Duo ceremony is an OBSERVATION, and the counter it refuses on is SHARED (D243, 2026-08-19)

- [x] the login wait races Duo's rendered terminal refusal, so a dead ceremony refuses in ~9.5 s instead of burning the envelope (`waitForAuthenticatedLanding`, `src/infra/browser/ucsd-sso.ts:340`)
- [x] the presented counter is `max(stored + 1, nowSec)`, monotonic across every profile sharing the credential (`duo-autopilot/src/sign-count.js`)
- [x] the rule is pinned in THIS repo's gate, not the extension's offline lane (D244; `tests/unit/duo-sign-count.test.ts`)
- [x] the ceremonies are serialized by §10's per-credential lease (D267, `cb7f17f8`) — the arithmetic removes the counter GAP, the lease removes the RACE
> 2026-08-21 | docs-cohesion execution-and-sessions | verified against src/infra/browser/ucsd-sso.ts, duo-autopilot/src/sign-count.js and src/domain/config/schema.ts (sessionAcquireMs 60 000 vs duoApprovalSeconds 180); left: §10's lease

**A login recipe MUST refuse on Duo's own terminal refusal, and MUST NOT wait for its landing bound
to expire in order to learn that Duo already answered.** `waitForAuthenticatedLanding` races the
landing predicate against Duo's rendered refusal (`ucsd-sso.ts`, live-observed 2026-08-19: *"Your
login request using your security key was canceled or timed out"*, offering only a manual **Try
again**, which nothing here clicks). That screen is TERMINAL for this runtime — it was observed
unchanged for 46 s — so a login that reaches it is already dead and every further second is spent
watching a page that has stopped being about our request.

**Why the wait could not learn this by timing out.** The landing bound is `duoApprovalSeconds`
(180 s) and the acquisition envelope is `sessionAcquireMs` (60 s), so on any Duo stall the envelope
fires FIRST and cancels the wait. `describeStalledLanding` — the function whose entire job is to
explain a stalled Duo login — is therefore **unreachable at the shipped defaults**, and the operator
receives D125's bound message naming Duo hand-approval and `duoApprovalSeconds` instead: a real
cause, and never this one (separations §9.17 item 5 recorded exactly that mis-attribution). The
repair is not to move either leaf — §4.1's rule applies here too. Authentication is decided by
CONTENT, and so is its refusal: Duo says so in words about a second after the assertion, so the
recipe observes that instead of inferring it from elapsed time. The generic stall message survives
for a prompt that is merely slow, and a negative control keeps the two arms distinct.

**The counter is a shared resource with unsynchronised writers.** Duo's WebAuthn signature counter
is per CREDENTIAL and lives on Duo's side; Duo Autopilot's copy lives in `chrome.storage.local`,
which is per BROWSER PROFILE; and §1 partitions profiles per
`(worker, system, instance, configFingerprint)`. One credential covers every UCSD system
(`duo-autopilot/README.md`), so N profiles write one server-side counter and none of them can see
another's copy. **The counter a ceremony presents must therefore be computed from a source every
profile shares.** `duo-autopilot/src/sign-count.js` floors it at wall-clock seconds
(`max(stored + 1, nowSec)`); `stored + 1` is forbidden, because a cold profile's import stamp jumps
the shared counter to `now` while a warm profile creeps by one, and a warm profile that was
cold-stamped earlier can then never catch up — every subsequent login on it is refused, permanently,
with profile deletion as the only exit. That is the whole of the "browser-profile wedge" recorded in
separations §9.17 item 5 / §9.20 item 6 and root-caused in §9.21. The rule is pinned by
`tests/unit/duo-sign-count.test.ts`, whose load-bearing case is the two-profile simulation rather
than any single arithmetic example: the defect is only visible across writers.

**What this section does NOT fix.** The arithmetic removes the counter GAP between a cold-stamped
profile and a warm one. It does not remove the RACE: two profiles that begin a ceremony inside the
same second present the same floored value, and the second assertion Duo compares does not ADVANCE.
That is the same cloned-key signal, reached a different way, and it is reachable today whenever two
workflows' workers cold-start together. §10 is the serialization that closes it.

---

### 4.3 Session acquisition is bounded separately from the task (D125)
<!-- roadmap: p1-exit -->

<!-- roadmap-status: p1-exit -->
- [x] `timeouts.sessionAcquireMs` exists as its own leaf, default 60 000 ms (`src/domain/config/schema.ts:196`)
- [x] the bound is scheduler-armed and the acquisition runs under its OWN linked signal, so a cooperative recipe cancels itself rather than only being raced (`#acquireBounded`, `src/core/worker-sessions.ts:449`)
- [x] an acquisition that lands AFTER its bound is poison-closed, never inherited as a warm reuse (`#abandonAcquisition`)
- [x] the refusal names both leaves and says what to raise for a hands-on Duo deployment (`src/core/worker-sessions.ts:144`)
- [x] D243 corrected the message this bound used to be blamed for: a REFUSED Duo ceremony now refuses on content in ~9.5 s (§4.2)
> 2026-08-21 | docs-cohesion execution-and-sessions | verified against src/domain/config/schema.ts (60 000 / 180 000 / 15 000 / 180 / 60) and src/core/worker-sessions.ts; folded here from the dated block that stood above §0
<!-- /roadmap-status -->

**`timeouts.sessionAcquireMs` (default 60 000 ms) bounds ONE browser-session acquisition — the
factory `open` plus that system's login recipe — and it is a different bound from
`timeouts.taskMs` (180 000 ms).** The kernel-owned `MonotonicDeadlineScheduler` arms it, the
acquisition runs under its own linked `AbortSignal` so a cooperative recipe cancels itself, and
expiry FAILS the lease with a message naming both leaves. It is never converted into a retry.

**Why the whole-task deadline could not do this job.** The Phase-1 live exit run
(`4ebf7275-0158-49af-a78f-1f37948efb27`) spent **262.9 s** inside one `withDriver` when the CRM
browser died. Every step *inside* the login recipe was already bounded — each navigation by
`navigationMs` (15 s), the Duo window by `duoApprovalCrmSeconds` (60 s) — but **nothing bounded the
chain**, and the only outer bound reaching that code was `taskMs`. `taskMs` must stay generous
because it covers the real read (UCPath person-org ≈22 s; Kuali fill→save→reload→verify 8–10 s per
cycle), so it is structurally the wrong instrument for "is this session alive?". In that run it
never fired: the D118 claim sweep (60 s staleness on a 30 s cadence, measured on the WALL clock)
requeued the run first, the next heartbeat reported the claim lost, and the task span closed
`cancelled` at 4 m 23 s. Claim expiry is recovery, not a liveness bound — it is the last line, and
it was doing first-line work.

**Why 60 s is safe.** Acquisition is not the slow part of a healthy run: §4.1 authentication is
live-verified at ~17 s (UCPath) and ~12 s (CRM) with Duo Autopilot clearing the ceremony hands-off
(ref charter §9), so the default is >3x the measured worst case. It cannot fail a legitimately slow
*read*, because a read happens after acquisition, under `taskMs`. A deployment that reverts to a
HANDS-ON Duo approval must raise `sessionAcquireMs` above `duoApprovalSeconds` (180 s) — the inner
Duo wait would otherwise outlive its own envelope — and the refusal message says exactly that.

**That inequality has a consequence D243 had to fix, and it is not a reason to move either leaf.**
At the shipped defaults the envelope (60 s) always fires before the landing bound (180 s), so on a
Duo stall the operator receives THIS section's message naming hands-on approval — a real cause, and
in the refused-ceremony case the wrong one. §4.2 fixes it where authentication is decided: on
CONTENT. Both leaves keep their values.

**An acquisition that outlives its bound is UNCERTAIN.** A cooperative recipe rejects on the
acquisition signal and runs `#openAndLogin`'s own proven cleanup. A non-cooperative one may still
land a live session afterwards; that session is poison-closed rather than inherited by the next
lease as a warm reuse, and a close that cannot be proven leaves the system poisoned so the next
acquisition refuses by name (§4's poison rule).

**§10 changes what this bound covers, and says so there.** A worker waiting on the Duo ceremony
lease is waiting inside its acquisition envelope, so the lease's TTL is `sessionAcquireMs` plus
grace and a bounded waiter must refuse before the envelope does — otherwise every queued worker
would report D125's message instead of naming the holder.

---

## 5. Speed engineering
<!-- roadmap: phase-1 -->

<!-- roadmap-status: phase-1 -->
- [x] the fixed-sleep tax is removed, not reduced: zero `sleepMs` on every task span of the exit run, and no `sleepMs` field exists in `src/` at all
- [x] `waitForTimeout` is forbidden outright by the `wait-for-timeout-allowlist` ratchet arm over `src/stores`, executed against a violating fixture by `guard-manifest.test.ts`
- [x] every task invocation runs under an immutable scheduler-armed abortable deadline (`bounded-task-deadline`), and a task that ignores its signal still lands terminal `failed` with its session poison-closed
- [x] item 5's per-invocation bound is what `bounded-task-deadline`'s invariant cites as "§5.5" — this section has no §5.5; the numbered item is the reference
- [-] item 4's span sleep budget: RETIRED with the `sleep-budget` guard (D188, 2026-08-09) — there is no authored sleep left for a budget to measure
- [ ] the arm's roots are `src/stores`; `src/infra/browser/**` is outside its reach and contains no `waitForTimeout` today
> 2026-08-21 | docs-cohesion execution-and-sessions | verified against tests/unit/architecture/helpers/ratchet-arms.ts:53, guard-inventory.json (sleep-budget retired) and a tree-wide grep for sleepMs, which finds none in src/
<!-- /roadmap-status -->

Removing lanes does not preserve the fixed-sleep tax:

1. Replace `waitForTimeout` calls with waits on actual readiness predicates plus a bounded quiet
   window where PeopleSoft fragment refreshes require it.
2. Live-verify each replacement and record the selector/state proof.
3. Ban `waitForTimeout` outright rather than shrinking an allowlist. **As built this is stronger
   than the item asked for**: the `wait-for-timeout-allowlist` ratchet arm carries no allowlist at
   all — a single call anywhere under `src/stores` fails the gate, and the arm is executed against
   a checked-in violating fixture so a walker that resolved nothing could not report the tree clean.
4. ~~Record cumulative fixed-sleep time and real wait time on task spans.~~ **RETIRED (D188,
   2026-08-09) with the `sleep-budget` guard, because the quantity is identically zero.** There is
   no `sleepMs` field in `src/` and no authored sleep for a budget to measure; the invariant lives
   in items 3 and 5 instead — nothing may sleep, and every wait is a scheduler-armed deadline. A
   budget measuring a quantity that cannot be non-zero is a check that cannot fail.
5. Keep tasks and transactions under immutable, abortable deadlines. A service that ignores abort
   cannot occupy a worker indefinitely. This is `bounded-task-deadline`: `taskDeadlineMs` is a
   REQUIRED dependency with no default, both invocation arms race the deadline controller, and a
   task that ignores its signal still lands terminal `failed` with the wedged session poison-closed.

For batch speed, start more workers. A warm worker amortizes login across sequential items unless a
workflow-authored fresh boundary or failed reset requires replacement. (Today "start more workers"
means starting more CLI processes — §11.)

**As-built after the Phase-1 live exit run (2026-08-04) — the budget is met at zero, and wall clock
is not the budget.** This section's quantity is **fixed sleep time**, and nothing else. On the exit
run (`4ebf7275-0158-49af-a78f-1f37948efb27`) `sleepMs` was **absent from every task span**: the
executor emitted no fixed sleeps whatsoever, so item 4's "cumulative fixed-sleep time" is zero and
legacy's ~24 s of `waitForTimeout` on the UCPath person-org read path is removed rather than reduced.

The same run's **total wall clock** for that read was **22.5 s**, dominated by UCPath's own page
loads. That figure is an observation and is deliberately **not** a threshold here: it is a total,
the ~24 s it is often set beside was legacy's sleep alone, and **22.5 s is not materially below
24 s**. Reporting it as a speed win would be comparing two different measurements, which is exactly
the kind of plausible-but-unearned claim this program bans elsewhere. Whatever wall clock remains
after the sleep tax is gone is real work at the far end of the network; reducing it is a separate
exercise with its own evidence, not something this criterion has already claimed.

---

## 6. Failure isolation
<!-- roadmap: p1-kernel -->

### 6.1 Page/subject-isolation invariant

> A page belongs to at most one task execution at any instant. It is reusable only after a
> successful bounded reset to the system's neutral state; otherwise it is closed. Before a write
> fence, the driver freshly observes the declared subject on the staged page and the kernel requires
> an exact normalized match. Mismatch or unknown prevents commit and closes the session.

One worker never shares its page with another worker. One workflow never borrows another workflow's
authenticated context. The write half is executed by `subject-before-fence`, whose load-bearing case
is two alternating EIDs through ONE pooled page, each binding to its own fenced digest — a single
subject could not falsify it.

### 6.2 Failure matrix

| Failure | Blast radius | Mechanism |
|---|---|---|
| Task throws | Its run/worker | The lease's callback threw, so the resource poison-closes; apply retry policy; the worker claims the next eligible row |
| Cancel during Playwright | Its page/session | The operation is raced against the run signal, then poison-closed |
| One system session wedges | That worker's system session | Poison-close on the failing lease, and the NEXT lease for that system refuses by name until a replacement can be opened. **There is no health ladder and nothing probes a live session** — §4's D248 as-built is the same fact from the surface's side, which is why a tile reads `Not checked` |
| Poison-close cannot be proven | That worker's system session, until a human looks | The resource is RETAINED poisoned and one `AggregateError` names both failures (§7.1 row C7) |
| Worker crashes | Its one active run | Claim-generation recovery, plus D200's startup self-sweep for the row the dead process left under its own id; ref write-safety recovery runs before any replay |
| Retry storm | No head-of-line block | `not_before` and `claimNext`'s `deferred` outcome; idle workers claim other eligible rows |
| Authority DB degraded | All mutation stops | ref dashboard-surfaces storage-health gate; dashboard remains diagnostic |
| A Duo ceremony is refused | **That PROFILE, across every later login on it** — not one run | The only remediation found is deleting the profile directory (§4.2). This row is the one whose blast radius outlives its run, and the reason §10 prevents rather than recovers |

---

## 7. Mechanical guards

Every row names the risk and the mechanism that executes it TODAY, with its status. Six guards in
`docs/rebuild/guard-inventory.json` name this doc as their owner — `authentication-proof-not-url`,
`bounded-task-deadline`, `driver-lease-boundary`, `multi-worker-overlap`, `single-flight-login`,
`worker-teardown-soak` — plus `fresh-session-boundary`, co-owned with ref clock-config-secrets, and
the retired `sleep-budget`. ref guards-and-tests owns the guard umbrella itself; this table is the
risk register those guards answer.

| Risk | Mechanism, and its status |
|---|---|
| A worker starts two items concurrently | **Executed.** `worker-teardown-soak` (D182) drains 30 runs across 3 real loops and `multi-worker-overlap` row C1 samples the durable claim set at every span event and driver call. The bar was raised deliberately: this row named "a worker-soak test" that did not exist until D182 wrote it |
| Parallelism silently serializes | **Executed.** `multi-worker-overlap` asserts the observed MAXIMUM of workers holding work simultaneously EQUALS the worker count — the opposite assertion to the row above, made by the same sampler so the pair cannot be satisfied by serializing everything onto one worker |
| Fresh-session request is ignored | **Executed, one arm outstanding.** `fresh-session-boundary` proves an accepted close proof precedes the replacement's open. Its descriptor-level node-execution-ordering arm lands with the first workflow that authors a `session:"fresh"` node — none does yet |
| Session boundary is inferred | **Executed.** `fresh-session-boundary`: the `fresh-boundary` close reason exists only in the session-ownership modules, every authored `session:` need is a string LITERAL rather than a computed value, and repeated `reuse-worker` needs mint no boundary |
| Config/instance drift crosses runs | **Executed.** `fresh-session-boundary`'s D116 arm plus `worker-sessions.test.ts`: reuse requires the exact `(worker, system, resolvedInstance, configFingerprint)` identity and closes before replacement |
| A login concludes from a URL | **Executed.** `authentication-proof-not-url` (D120, §4.1): every recipe built by `defineVerifiedLoginRecipe`, no `LoginResult` produced outside it, every landed binding supplying a verifier, and the neutral reset asserting through the same check |
| Two concurrent leases double-login one system | **Executed.** `single-flight-login`: two concurrent leases for one system produce exactly one open and one authentication |
| A task occupies a worker indefinitely | **Executed.** `bounded-task-deadline`: `taskDeadlineMs` required with no default, both invocation arms racing the controller, and a signal-ignoring task still landing terminal `failed` with its session poison-closed |
| Expired claim bypasses unfinished write recovery | **Executed.** `claim-sweep-recovery.test.ts` proves all four D118 arms reach ref write-safety recovery before any queued/claimable transition |
| Provider exhaustion bypasses admission | **Executed.** `provider-admission.test.ts` / `provider-pool.test.ts` / `advisory-provider-exhaustion.test.ts`: zero adapter calls and no sleeping worker when admission is unavailable |
| Dirty page crosses people | **Executed.** `subject-before-fence` (owned by ref write-safety), whose load-bearing case is two ALTERNATING EIDs through one pooled page |
| Raw page APIs bypass ownership | **Executed.** `task-driver-boundary` confines Playwright types and page operations to the two raw-browser owner families; `driver-lease-boundary` proves a driver exists only inside `withDriver`'s callback and that only the worker loop constructs an ownership scope |
| Fixed sleeps return | **Executed, half retired.** The `wait-for-timeout-allowlist` ratchet arm forbids `waitForTimeout` outright over `src/stores`. The "span sleep budget" half retired with the `sleep-budget` guard (D188) — the quantity is identically zero (§5 item 4) |
| A Duo ceremony presents a stale counter | **Executed.** `tests/unit/duo-sign-count.test.ts`, in THIS repo's gate rather than the extension's offline lane (D244), with a two-profile simulation as the load-bearing case |
| UI/config reintroduces capacity fields | **NOT GUARDED.** No test rejects a `lanes` or `budgets` field, and nothing asserts capacity copy is absent from the dashboard. The absence is real rather than enforced: `grep` finds no `lanes` in `src/` outside test-lane vocabulary, and `capacityChip` in `src/dashboard/surfaces/shell-model.ts` is a style helper, not a capacity number. Recorded here rather than quietly dropped |
| Two Duo ceremonies race one credential | **NOT GUARDED, and reachable today.** §4.2's arithmetic removes the counter gap; nothing serializes the ceremonies. §10 is the design |
| OnBase overlap | **NOT BUILT.** `onbaseSession` declares `exclusive:true` and nothing else exists — no driver, no login recipe, no identity lease, no test. D15 stands unbuilt |

### 7.1 The 2j concurrency matrix — executed (D182)
<!-- roadmap: p2-2j -->

<!-- roadmap-status: p2-2j -->
- [x] C1–C4, the dependency half, against real `runWorkerLoop` instances over one authority database (`tests/unit/architecture/multi-worker-overlap.test.ts`)
- [x] C5–C8, the control half — teardown, `closeAll` re-entry, an unprovable poison-close, and the bounded fleet soak (`tests/unit/architecture/worker-teardown-soak.test.ts`)
- [x] C9–C10, the intake half (`tests/unit/concurrency-matrix.test.ts`)
- [x] every other test this table cites resolves at HEAD: `run-authority`, `claim-sweep-recovery`, `kuali-transaction-proof`, `architecture/ledger-projector`, `worker-sessions`, `worker-composition`, `worker-loop`, `capture-durability`, `intake-session`, `intake-command-arms`
- [x] C11, the Duo ceremony lease — two real `runWorkerLoop`-equivalent `WorkerSessionManager`s over ONE authority database, the second's ceremony beginning after the first's verifier returned, plus the waiter refusal and the TTL takeover (`tests/unit/duo-ceremony-gate.test.ts`, `1c244a40`)
- [x] the standing rule's §11 pool row: C12, the W5 two-child parallel proof over the composed kernel pool door, with REAL child processes (`tests/unit/server/worker-pool-parallel-proof.test.ts`)
> 2026-08-25 | parallel-runs P3 follow-up | `composeWorkerRuntime` now requires a pool index and derives a distinct stable worker id; concurrent process admission is per worker process and duplicate identity reaches the authority lease. `createPhase1WorkerRuntimeExecutor` remains the explicitly one-worker compatibility arm
> 2026-08-26 | W5 parallel proof | C12 landed: two real spawned worker children prove birth via their own durable leases under their own OS pids, the W3b per-workflow mutex is observed at the door (same workflow serializes, different workflows interleave), locks release at shutdown with close() evidence on the fault sink, and spawn ENOENT / undelivered signal / stop-channel throw each surface typed — never as an applied ack. Measured numbers in this section's 2026-08-26 as-built note
> 2026-08-26 | C12 live extension (W6) | the same door driven LIVE: two panel-spawned separations workers ran two composed dry runs concurrently against real Kuali/UCPath/New Kronos — simultaneously `running` 19:32:18→19:32:48Z, C11's lease serializing ceremony generations g1…g8 across both workers with one by-name waiter refusal and no counter burn, the identity gate approved through the ceremony and its resume claimed by the OTHER member, 0/0/0 write rows. Evidence: docs/rebuild/migrations/separations.md §9.27
<!-- /roadmap-status -->

The table above names *risks*. This one names **cases**, and every row names the exact test that
executes it. A risk table can be satisfied by a plausible-sounding sentence; a case table cannot,
because the third column is a file you can open.

Three rules decide what belongs here and how it is written.

1. **A concurrency case is proved by more than one live caller, not by a second call.** Most of this
   tree's concurrency coverage issues the second `claimNext`, the second `renewClaim`, or the second
   command *from the test*. That proves the STORE refuses an illegal pair, which is necessary and is
   not sufficient: a single-worker fixture satisfies `(runId, worker)` uniqueness by never having a
   second worker, so it cannot falsify a loop that asks for a row it already holds. Rows C1–C8 run
   real `runWorkerLoop` instances, more than one at a time, over ONE `AuthorityDatabase`.
2. **The observation is sampled, not read at the end.** A double claim that was released before the
   drain finished is invisible to a post-hoc read of the run table. C1 and C8 therefore sample the
   durable claim set — grouped by owner, straight out of authority, never from an in-memory counter
   a loop could keep consistent while the database disagreed — at every span event and every driver
   call, and fail at the sampling instant.
3. **"No worker holds two rows" and "the fleet genuinely overlaps" must be asserted together.** They
   pull in opposite directions, and a matrix that proved only the first would be fully satisfied by
   a runtime that silently serialized everything onto one worker — §7's third risk row. So the same
   sampler that caps per-worker ownership at 1 also records the maximum number of workers holding
   work at once, and the soak asserts that maximum **equals the worker count**.

`composeWorkerRuntime` now accepts an explicit pool index and can host distinct worker identities;
its process records coexist and aggregate into D181's restore observation. The C1–C8 matrix still
drives `runWorkerLoop` directly, which predates the dashboard process supervisor; the supervisor
(§11, D271) has its own row below — C12 drives it through the composed kernel pool door with real
child processes. `createPhase1WorkerRuntimeExecutor` continues to refuse `desiredWorkers !== 1` on
its separately explicit compatibility path.

**Dependency — claim, heartbeat, sweep, terminal authority**

| # | Case | Executed by |
|---|---|---|
| C1 | Two live loops race one queue: every run executed once, one owner per run, ≤1 active row per worker at every sample, and 2 workers observed holding work simultaneously | `architecture/multi-worker-overlap.test.ts` |
| C2 | A row held by a live loop is never served to a sibling `claimNext`; the holder's own second `claimNext` throws by name | `architecture/multi-worker-overlap.test.ts` |
| C3 | A sweep interleaved with a live heartbeat: the renewed claim keeps owner/generation/attempt, only the genuinely stale row requeues, and the requeued row is re-claimed by the live loop | `architecture/multi-worker-overlap.test.ts` |
| C4 | A zombie heartbeat whose row was swept and re-owned reports `lost` and abandons instead of stamping over the new owner | `architecture/multi-worker-overlap.test.ts` |
| C8 | Bounded fleet soak, then whole-database invariants | `architecture/worker-teardown-soak.test.ts` |
| — | Interactive before bulk with a second worker present; cross-workflow isolation; claim-generation monotonicity; a second active claim for one worker; transition refused on stale version or lost claim | `run-authority.test.ts` |
| — | D118: an `attempting` write intent reaches recovery before any queued/claimable transition (all four arms) | `claim-sweep-recovery.test.ts` |
| — | Two workers on ONE permanent write key admit exactly one fence | `kuali-transaction-proof.test.ts` |
| — | Two ledger projectors race one `(system,date)` lease | `architecture/ledger-projector.test.ts` |

**Control — worker lifetime, directives, browser sessions**

| # | Case | Executed by |
|---|---|---|
| C5 | Stop mid-run abandons rather than terminalizing, closes the interrupted lease as `poisoned`, LEAVES the row under its stale claim, and the recovery sweep — not the dying loop — releases it to a successor that drains it to `done` | `architecture/worker-teardown-soak.test.ts` |
| C6 | `closeAll("worker-stop")` closes nothing while a driver callback is in flight; a SECOND concurrent `closeAll` throws by name; no new lease may start once teardown began | `architecture/worker-teardown-soak.test.ts` |
| C7 | An operation failure whose poison-close cannot prove closure raises one `AggregateError` naming BOTH, retains the resource poisoned, refuses reuse, and worker-stop still names every failing system | `architecture/worker-teardown-soak.test.ts` |
| C12 | The §11 pool door (D271/W5), with REAL child processes: two spawned worker CLIs supervised concurrently under one composed supervisor, each proving birth via its OWN durable lease under its OWN OS pid, with exact pool identities (`<workflowId>-worker-<n>` argv, workflow, pool index) and no cross-talk; the W3b per-workflow FIFO mutex observed at the door — a same-workflow command may not ENTER before its predecessor exits, while different workflows interleave inside each other's windows; concurrent stops settle applied, both children observe the durable directive and die (PID-proved), worker and server process locks record their release, and dashboard shutdown reports every still-live child to the structured sink; spawn ENOENT, an undelivered escalation signal and a durable stop-channel throw each surface as their typed refusal or fault, never an applied acknowledgement and never a journal row | `server/worker-pool-parallel-proof.test.ts` |
| — | Exclusive driver use and login single-flight per `(worker,system)`; fresh-boundary close-before-open; abort-race poison-close; `closeAll("parked")` waits for an active callback; D116 fingerprint identity; D125 bounded acquisition | `worker-sessions.test.ts` |
| — | Second live process on one worker id refused; stale lease reclaimed at boot; old-generation queued runs refused after restart; an apply crossing generation precheck/claim rolls the claim back; graceful mid-run stop; close-proof failure records the lease `crashed` | `worker-composition.test.ts` |
| — | Single-worker drain; heartbeat renews exactly one claim; lost claim aborts without terminalizing; stop/pause directives between items | `worker-loop.test.ts` |

**Capture and intake — command arms and the finalize projection**

| # | Case | Executed by |
|---|---|---|
| C9 | Two callers finalize one session on the same reviewed version: one applies, the other is refused `invalid-state`, ONE outbox row is minted, and every arm refused for a `finalizing` session moves ZERO authority rows | `concurrency-matrix.test.ts` |
| C10 | Two finalize projectors drain one pending outbox: exactly one handoff lands, the loser loses the session version CAS and escapes loud with its whole transaction — including its handoff — unwound | `concurrency-matrix.test.ts` |
| — | Duplicate and reordered phone requests never duplicate photos; restart mid-finalize converges to ONE artifact and ONE handoff; retry-finalize mints the next generation; version drift alone is not a CAS conflict | `capture-durability.test.ts` |
| — | Intake session version CAS refuses a raced write | `intake-session.test.ts` |
| — | The one CASing intake arm conflicts when the session moved since review; a manifest fans out exactly once | `intake-command-arms.test.ts` |

**Two things this matrix settles that were previously only implied.**

**A capture command's `expectedVersion` is not a CAS, and that is deliberate.** Five of the six
intake arms and all seven capture arms validate CURRENT authority inside the kernel's own
transaction instead of comparing the caller's claim; the version CAS is reserved for the one
irreversible step (`enqueue-intake-manifest`) and for the storage layer underneath. For capture the
irreversible step is guarded by the **state machine** instead: a second `capture-finalize` meets a
`finalizing` session and is refused by name, and the finalize `stableKey` folds
`(sessionId, generation, ordered photo digests)` so even a duplicate that got past the state gate
could not mint a second outbox. C9 executes that whole chain, so the surprising half — a required
`expectedVersion` that does not gate — is now pinned rather than inferred from a target schema.

**A dying worker never releases its own claim.** C5 asserts the row is still owned by the dead
worker after teardown, which reads like an orphan and is the opposite: terminalizing there would be
the loop deciding, with no browser left, that nothing happened, and requeueing there would race
D118's write-intent check. The claim sweep is the ONLY release path, and C5 carries it through to a
successor draining the row, so "left claimed" is proved to be a window rather than a leak.

**As-built (2026-08-09).** The soak measured here is **3 workers × 30 queued `person-lookup` runs
over one authority database in ~440 ms** wall, entirely deterministic: `manualClock` plus the
manual monotonic scheduler, so no real timer participates and no `sleep` is spent. It samples the
claim set 318 times, observes all 3 workers holding work simultaneously, and finishes with every
run terminal `done` at claim generation 1 / attempt 1, zero rows in `claimed|validating|running`,
exactly one `run_terminal_outbox` row per run, zero unresolved write intents, zero pending ledger
outbox, and `AuthorityDatabase.inspectExistingReadOnly` re-reading the file so its ~30 named SQL
invariants, `quick_check` and the foreign-key scan all pass. That last read is the point: a soak
that only counted outcomes would report 30 clean runs over a corrupted claim index. The ledger
projector is asked and must AGREE it has nothing to project — a read-only workflow mints no ledger
entries, and asserting that is different from assuming it.

**As-built (2026-08-26, W5).** C12's numbers, measured by
`npx vitest run tests/unit/server/worker-pool-parallel-proof.test.ts --project unit` on an Apple M3
Pro · 11 cores · 18 GB · node v26.1.0 · darwin-arm64 — three consecutive runs, all green, ranges
across the three; a contended laptop, so read durations as ±15 % (the convention ref
frontend-backend-integration §7.4 records for this machine). A REAL spawned
child (node + tsx booting the stub worker CLI, opening the same authority database and writing its
own lease) proves birth in **255–306 ms** of pool-door effect time at a 50 ms birth poll; the second
same-pool spawn, submitted concurrently, acknowledges at **511–564 ms** because the W3b mutex
serializes the whole first command ahead of it — and the mutex's own cost is the FIFO handoff gap
between one command's door exit and the next's entry, measured at **0.65–0.77 ms**. Two concurrent
stop commands acknowledge in **2 ms**, and both children observe the durable stop directive and exit
within **54–56 ms** of submission (the stub polls its lease every 25 ms). The suite prints these as
a `W5-MEASURED` line on every run, so re-measuring is re-running.

**The standing rule.** A new execution or command surface that can be reached by two callers adds a
row here in the commit that lands it, naming the test that executes it. A surface whose concurrency
is "obviously fine" gets a row saying which existing test proves it; the one thing it may not have
is no row.

---

## 8. Worked example — 10-person I-9 Check

- [x] the kernel side of this example is real: N loops over one queue, one item each, per-worker profiles and sessions (§7.1)
- [ ] the i9 system has no landed browser binding — `src/stores/i9/session.ts` is a provider declaration and `BROWSER_SYSTEM_BINDINGS` does not name it, so a session for it refuses at open
- [ ] no `i9-check` descriptor exists (`src/workflows/` holds two rail-level workflows — `person-lookup` and `separations` — with the latter's six timeline-step folders and five nested harnesses)
- [ ] "choose 3 workers" is not startable from a surface — the count comes from three CLI processes today (§0 item 4, §11)
> 2026-08-21 | docs-cohesion execution-and-sessions | verified against src/workflows/, src/infra/browser/system-bindings.ts and src/stores/i9/session.ts; this section is the SHAPE the migration targets, and every prerequisite it is missing is named

This is the shape order 5 targets, not a description of a run that has happened. Read it as the
contract the pool must satisfy.

Choosing **3 workers** creates three independently authenticated UCPath/I-9 session sets — three
worker ids, three profile directories under §1's path, three independent claim rows. Each worker
claims one member, runs it to park/terminal, resets its sessions, and claims the next. No worker has
a second in-flight item and no capacity counter participates. Ten members over three workers is
ten claims and three warm login amortizations, not a scheduler decision.

If a specific step needs a clean UCPath context, the I-9 Check descriptor marks that node
`session:"fresh"`; other steps reuse their worker-local session. That authored `fresh` node is also
what finally executes `fresh-session-boundary`'s outstanding descriptor arm (§7).

**Two prerequisites this example does not have yet**, both named rather than assumed: the `i9`
system has no landed `(driver, login recipe)` binding, so a session for it refuses at open today;
and the count of 3 is three CLI processes, because the pool and its control are §11. Neither is a
kernel gap — §7.1 runs three real loops over one database — which is exactly why they are worth
naming separately.

## 9. Settled defaults

Built and holding:

1. One active item per worker.
2. Parallelism is explicit worker count, chosen per workflow.
3. Session reuse is the descriptor default; fresh boundaries are explicit and observable.
4. No global executor lane budget, lane chip, per-system capacity chip, pool-mode table, or
   lane-based fairness math.
5. Queue admission is blocked only by authority/storage correctness; worker availability affects
   when work starts, not whether it may be enqueued.
6. Authentication is decided by CONTENT, and so is its refusal (§4.1, §4.2).

Settled by ruling — §10 is built, while §11's authority and read view are built and its process
supervisor/proof work remains explicit below. Neither ruling is re-openable without a new operator
decision:

7. **Every Duo ceremony is serialized per CREDENTIAL** (R12, §10). Not per worker, not per system,
   not per profile — the counter is per credential, so the lease is too.
8. **A session is a dashboard-started group of runs, and workers coordinate through AUTHORITY only**
   (R11, §11). Run claims, session leases, write fences and the concurrency matrix; never peer
   messaging.

---

## 10. The Duo ceremony lease — one ceremony at a time per credential (R12)
<!-- roadmap: duo-lease -->

<!-- roadmap-status: duo-lease -->
- [x] BE `duo_ceremony_leases` in authority, keyed on the CREDENTIAL, with acquire / release / expire and a generation (`bfc7d318` — schema v16, `AuthorityDatabase.authority.duoCeremonyLeases`)
- [x] BE the `DuoCeremonyLeaseToken` the SSO helpers require, minted only by the lease store and unforgeable at runtime (`bfc7d318` mint/retire, `cb7f17f8` the helpers assert it)
- [x] BE bounded waiters that refuse by name before the acquisition envelope fires, naming the holder (`cb7f17f8` — `DuoCeremonyLeaseHeldError`, `src/core/duo-ceremony-gate.ts`)
- [x] BE the fresh-profile-once recovery, holding the lease across the retry and failing by name on the second refusal (`cb7f17f8` — `WorkerSessionManager.#openAndLogin`, `PlaywrightWorkerSessionFactory.discardProfile`)
- [x] BE the grace leaf, registered as a post-baseline optional leaf so an existing `config_snapshots` row still parses (D133) (`bfc7d318` — `timeouts.duoCeremonyLeaseGraceMs`, generation 3)
- [x] BE the guard, with a violating fixture, registered in `guard-inventory.json` in the same commit (`37e747f0` — `duo-ceremony-lease`)
- [x] PROOF two workers' cold starts serialize — unit, manual clock (`1c244a40`, `tests/unit/duo-ceremony-gate.test.ts`) AND the LIVE two-worker cold start, 2026-08-21: `live-a` / `live-b`, one credential, lease generations 3 → 4, no overlap, zero waiter refusals (§Live proof below)
- [x] DOCS the decision — this section is its normative text; `reference/decisions.md` gets the pointer line in the same commit (D267)
> 2026-08-21 | duo-lease E1 | built as-built in five commits (bfc7d318 store+token+leaf, cb7f17f8 gate+wiring+recovery, 37e747f0 guard, 1c244a40 proof, 23231b37 compose seam + manifest); the live two-worker cold start is the one box left open and is documented below
> 2026-08-21 | duo-lease E2 | the LIVE two-worker cold start RAN against real UCPath SSO and real Duo — both workers `logged-in`, ceremonies serialized at generations 3 → 4 with no overlap; the record, both timings and the one harness change it needed are §Live proof below
<!-- /roadmap-status -->

**AS-BUILT (D267, 2026-08-21).** This section is the owning contract for the tree's `{#duo-lease}`
node and the normative text of D267. Everything below exists in `src/` at the cited commits.

**The hazard this closes.** Duo's WebAuthn signature counter is per CREDENTIAL and lives on Duo's
side; Duo Autopilot's copy lives in `chrome.storage.local`, which is per browser PROFILE; and §1
partitions profiles per worker. One credential covers every UCSD system, so N profiles write one
server-side counter and none can see another's copy. D243's arithmetic (`max(stored + 1, nowSec)`)
removed the counter GAP; it did not remove the RACE (§4.2): two ceremonies inside the same wall-clock
second present the same floored value, the second does not ADVANCE, and Duo reads a non-advancing
counter as a cloned key — which BURNS the profile (D243: three further logins refused with counters
more than a thousand ahead; only a fresh directory recovered). So the lease's job is to stop the
FIRST refusal; its correctness bar is that no two ceremonies for one credential ever overlap.

**1. The lease is per CREDENTIAL** (`src/domain/duo-ceremony-lease.ts`, table `worker_auth` since schema 35; originally `duo_ceremony_leases` in
schema v16). The key is `duoCeremonyCredentialKey(config)` (`src/core/duo-ceremony-gate.ts`): with
`features.duoWebAuthn` on (the shipped default) it is `resolveSecretFileIdentity("duoWebauthnCredential")`
(`src/domain/secrets.ts`) — a SHA-256 over the credential file's PUBLIC `(rpId, credentialId)` pairs,
never a secret byte, never interpolated into a message (the `no-secret-values-in-logs` guard refuses
it); an unresolvable identity THROWS at worker boot. With the feature off (a hands-on Duo deployment)
there is no Autopilot counter, one human approves one prompt at a time, and the human IS the
credential, so the key derives from `config.actor.id`. Neither arm is a fallback for the other, and
there is no per-worker key anywhere. ONE row per credential, UPDATED across generations (the row IS
the lock), never deleted (`duo_ceremony_leases_never_deleted`); every mirrored column is pinned to
the record by the integrity audit (`duo-ceremony-lease-columns-match-record`).

**2. The scope is "navigate to SSO" until the content verifier proves the session.** `defineVerifiedLoginRecipe`
(`src/infra/browser/authenticated-application.ts`) is now `{system, verify, navigate, ceremony}`: it
probes, runs `navigate`, probes again, and runs `ceremony` ONLY inside `context.duoCeremony.withCeremony`,
with §4.1's `assertAuthenticatedApplication` INSIDE that scope — so the lease closes when the
two-fact proof returns, on success or on failure. A warm profile whose probe answers
`already-authenticated` never reaches `ceremony` and never takes the lease. All four store recipes
(ucpath · crm · kuali · new-kronos) are this shape; `flow` no longer exists.

**3. TTL is `timeouts.sessionAcquireMs` plus `timeouts.duoCeremonyLeaseGraceMs`** (default 20 000 ms:
`browser.closeProofMs` 15 000 + margin, covering the holder's proven cleanup after its envelope
fires). The leaf is generation 3 in `snapshot-generations.ts`, so every stored `config_snapshots` row
still parses (D133). A `held` row at or past `expiresAt` is taken over by `acquire` at `generation + 1`
(`tookOver` names whom). The holder arms its own TTL deadline on the kernel scheduler and CANCELS an
in-flight ceremony through the acquisition's abort channel (`DuoCeremonyLeaseExpiredError`); a release
that finds the row at a later generation is REPORTED by the store (`superseded`, never written over
the successor) and thrown loud by the gate. At the shipped defaults the holder's envelope (60 s)
always fires before its TTL (80 s), so takeover of a live process's lease is unreachable by
construction; the arms exist for the clock-skewed and crashed cases.

**Known window: a monotonic cancel racing a wall-clock takeover across sleep (review finding 2,
2026-08-21).** The holder's own TTL cancel is armed on the kernel scheduler against
`clock.monotonicMs()` (`performance.now()`); takeover, at the store, compares `expiresAt` — a wall-
clock ISO instant — against `Date.parse(request.now)`. The two clocks agree while the process stays
awake, and they diverge across a macOS sleep: `performance.now()` pauses (or at least does not track
wall time 1:1) for the duration of the sleep, while `Date.now()`/`Date.parse` keep advancing. So a
holder (process A) that suspends mid-ceremony can wake to find its own monotonic deadline has not
yet fired — its scheduled TTL cancel is still pending — while the WALL-CLOCK `expiresAt` it armed
before sleeping is long past. A waiter (process B), which only ever reads wall-clock time through
`acquire`, sees the row past `expiresAt` and takes over at `generation + 1` the moment it next polls.
A's resumed browser then still presents an assertion under the superseded generation 1 token; A
learns only when its own `#release` runs and the store reports `superseded`
(`DuoCeremonyLeaseExpiredError`'s message names the generation that overtook it). This is a genuine
consequence of using two different clocks for the same lease's two halves — the holder's cancel MUST
be monotonic (a wall-clock deadline is not safe to schedule against, ref clock-config-secrets), and
takeover MUST be wall-clock (the row is read by a different process with its own monotonic origin,
so a monotonic `expiresAt` would be meaningless to it). The spec accepts this window rather than
resolving it: it is bounded by how long a sleep can last before a worker's next scheduled action
would have fired anyway, it is the SAME class of "TTL fires while ceremony is in flight" the
`DuoCeremonyLeaseExpiredError` arm already exists to cancel and report, and neither clock is a
candidate for the other's job. No clock changes; this paragraph is the record that the window is
known and named.

**4. Waiters are bounded and refuse by NAME, before the envelope fires.** The gate polls `acquire`
every `DUO_CEREMONY_LEASE_POLL_MS` (250 ms — a cadence, not an outcome) with a budget of the
remaining envelope MINUS the grace, and at the budget throws `DuoCeremonyLeaseHeldError` naming the
holder's worker id, system, generation and `expiresAt` — 20 s before §4.3's message could have
blamed hands-on approval. No retry loop: the acquisition fails, the opened context is closed with
proof, and the lease is left to its holder.

**5. Recovery is a FRESH profile, once, under the same lease.** `waitForAuthenticatedLanding` throws
the distinct `DuoTerminalRefusalError` on §4.2's terminal refusal (both the raced arm and the
post-timeout diagnosis). The gate keeps the lease across the FIRST such refusal; `WorkerSessionManager.#openAndLogin`
then poison-closes with proof, calls `factory.discardProfile` (the SAME path removed and recreated,
refusing anything outside the rebuild's profile namespace), and runs the login ONCE more under the
held token. A second refusal fails loud naming the profile directory and does not delete a third
time; a factory without `discardProfile` refuses the recovery by name; `gate.dispose()` in `finally`
releases whatever a recovery that died between the two attempts still held.

**6. The token is unforgeable, and the SSO helpers require it.** `src/base/duo-ceremony-lease.ts`
holds the declare-only brand, the module-private minted/retired `WeakSet`s, `mint`/`retire` (one
permitted caller: the lease store in `authority-database.ts`) and `assertDuoCeremonyLeaseToken`;
`waitForSsoForm`, `fillSsoCredentials`, `submitSsoForm` and `waitForAuthenticatedLanding` take the
token and assert it (minted, not retired, minted for this system) before touching the page — the
click in `submitSsoForm` is where the assertion is PRESENTED. The wrapper is the ONE caller of
`withCeremony`; the gate (`src/core/duo-ceremony-gate.ts`) is the one caller of `acquire`/`release`.

**7. The guard** `duo-ceremony-lease` (`tests/unit/architecture/duo-ceremony-lease.test.ts`, registered
in `guard-inventory.json` in `37e747f0`): mint/retire named only by their module and the store; the brand
conjured by `as`/`satisfies` nowhere else; `withCeremony` called only by the wrapper; every store
recipe in the `{navigate, ceremony}` shape presenting `token` to every SSO helper. Each arm runs
against `fixtures/duo-lease-recipe-violation.ts`, the exact pre-lease recipe shape.

**8. Proof.** `tests/unit/duo-ceremony-gate.test.ts` (`1c244a40`): two real `WorkerSessionManager`s over
ONE authority database, fake factories running the REAL wrapper, manual clock — B's ceremony begins
strictly after A's verifier returned; the waiter refusal at exactly the budget (40 s of a 60 s
envelope) naming A; TTL takeover at generation 2 with A's in-flight ceremony cancelled and A's late
release thrown as superseded; the three recovery arms plus an ordinary-failure control. §7.1 carries
the row. **The LIVE two-worker cold start has now been run** — §Live proof below is its record.

### Live proof (2026-08-21) — two cold workers, one credential, serialized ceremonies

Two `scripts/live-browser-login-smoke.ts` PROCESSES, launched in the same second against real UCPath
SSO and real Duo, each `--cold` (its own profile home removed first) and each under its own worker id:

```
npx tsx --env-file=.env scripts/live-browser-login-smoke.ts ucpath --cold --worker live-a &
npx tsx --env-file=.env scripts/live-browser-login-smoke.ts ucpath --cold --worker live-b &
wait
```

Every instant below is UTC and comes from one of two independent sources: each smoke's own stdout
(timestamped per line as it was written) and a 150 ms sampler reading `duo_ceremony_leases` out of the
one authority database both processes shared.

| | `live-b` | `live-a` |
| --- | --- | --- |
| process start (`--cold` clear) | 20:49:35.554 | 20:49:35.553 |
| navigate to SSO (hop 01) | 20:49:36.868 | 20:49:36.868 |
| lease ACQUIRED | **20:49:37.401** (generation 3) | **20:49:58.261** (generation 4) |
| Duo hop (`api-….duosecurity.com`) | 20:49:41.783 | 20:50:03.325 |
| lease RELEASED (the verifier returned) | **20:49:58.033** | **20:50:12.451** |
| ceremony held | **20.632 s** | **14.190 s** |
| `[session] … login=logged-in` | +22.5 s | +36.9 s |
| login + neutral reset verified · closed | 23.2 s · 23.3 s | 37.2 s · 37.3 s |

**The serialization, stated as the thing under proof: the second ceremony began after the first
ended.** `live-a` navigated to SSO at 20:49:36.868 and then did nothing for 21.7 s — its next
navigation is 20:49:58.574 — because §2's scope puts everything from the SSO form to the content
verifier inside `withCeremony`. `live-b` released at 20:49:58.033 and `live-a` acquired at
20:49:58.261: **228 ms later, inside the 250 ms `DUO_CEREMONY_LEASE_POLL_MS` cadence, with zero
overlap.** Neither process printed a `DuoCeremonyLeaseHeldError` — `live-a` waited ≈20.6 s against a
budget of the 60 s envelope minus the 20 s grace, so §4's refusal was never close to firing — and both
ended `logged-in` with both halves of §4.1's proof on the login AND on the neutral reset (a non-empty
`PS_TOKEN` for `universityofcalifornia.edu`; the TritON and PeopleSoft signon forms absent).

**The row is per CREDENTIAL and the row IS the lock.** One row throughout, under the same credential
key for both workers (the SHA-256 over the credential file's public `(rpId, credentialId)` pairs —
never printed here and never logged by the runtime), `version` 5 → 8 across the four transitions,
holder `live-b` at generation 3 then `live-a` at generation 4, both `released`, nothing deleted. No
takeover happened and none should have: each holder's `expiresAt` (acquire + 80 s) stood ~60 s past its
own release, which is §3's "unreachable by construction at the shipped defaults", observed.

**What the serialization cost, against a solo baseline taken minutes earlier.** The same smoke alone,
cold (`live-a`, 20:47:48), reported `logged-in` at +19.1 s / 19.6 s total with its ceremony held 17.1 s
(generation 2, 20:47:50.382 → 20:48:07.485). So the pair cost the WAITER ~17.6 s over its solo number
and the holder nothing — the intended trade: a Duo ceremony is ~14–21 s, and one worker pays that once
instead of both burning a profile.

**Two harness facts this run established, because a proof nobody else can re-run is not one.**

1. **The `live-smoke` runtime lock is per ROLE, so two smokes could not run side by side as the how-to
   described.** `acquireRuntimeProcessLock` refuses a second LIVE holder of a name by design, and the
   name is a closed enum. The smoke now scopes its lock ROOT by worker id
   (`.tracker-rebuild/locks/live-smoke/<workerId>/live-smoke.lock.json`), so two processes under ONE
   worker id — one profile directory, one `--cold` clear of it — still refuse each other, while two
   DIFFERENT worker ids serialize only on the ceremony lease, which is the thing under proof. What that
   gives up is named in the script beside the change: two differently-named smokes may open the
   authority database together, so the database must already be at the current schema — run ONE cold
   smoke first, which is also how this proof's `state.db` was created and migrated.
2. **A fresh checkout needs the EXTENSION's packaged credential, not only the runtime one.** Duo
   Autopilot imports `duo-autopilot/credentials/duo-webauthn.json` (gitignored) into
   `chrome.storage.local` on a cold profile, while `config.paths.duoCredential`
   (`.auth/duo-webauthn.json`) is the separate file the smoke's own precondition checks. With the
   packaged file missing the ceremony gets no auto-answer, nothing refuses, and the acquisition burns
   the whole 60 s `sessionAcquireMs` envelope — observed once at 20:46 in this worktree. That is NOT
   §4.2's terminal refusal: no assertion was ever presented, so no profile was burned, and the lease
   was still acquired and released correctly across the failure (generation 1, 20:46:10.282 →
   20:47:08.214). One note for whoever re-runs this: that failure leaves `main()` through the
   top-level catch, which is past the `processLock.release()` / `database.close()` at the end of
   `main`, so the lock file stays marked held by a now-dead pid. Harmless — `acquireRuntimeProcessLock`
   refuses only a LIVE pid and the next acquire advances the generation — but it is why a held-looking
   lock file after a failed smoke is not evidence of a running smoke.

**What this does not do.** It does not serialize logins (a warm reuse and any non-Duo authentication
are untouched), it does not serialize runs or claims, and it does not make a burned profile
recoverable. D243's arithmetic stays: two ceremonies separated in TIME still need a counter that
advances across profiles.

---

## 11. Sessions and the worker pool (R11)
<!-- roadmap: parallel-runs -->

<!-- roadmap-status: parallel-runs -->
- [x] BE the worker pool — N workers per workflow, spawned and stopped from the dashboard: the W4 Session Panel controls (`b45431db`) over the W3 supervisor's real `child_process` spawn (`src/server/dashboard/compose.ts`), live-exercised end to end 2026-08-26 (plan 2 → spawn ×2 → D271 replacement spawn ×2 → stop ×2, all from the panel — `docs/rebuild/migrations/separations.md` §9.27)
- [x] BE pool-indexed worker ids: the CLI requires a positive pool index and composition carries `<workflow>-worker-<index>` into the authority lease; distinct indices retain distinct rows and duplicate ownership is refused
- [x] BE the projection serves a worker-POOL version — `worker_pools` (schema v17) is the CAS basis: `plan-worker-count` and `spawn-worker` target `{workflowId, expectedVersion}` where `expectedVersion` is the POOL row's version (0 for an unplanned workflow), the kernel refuses a stale one with `conflict` naming the current version BEFORE the runtime seam, and the day wire serves `workerPools[]` (`93b7b18e` store · `b4f30ea0` kernel · `24b04dfa` wire — D269)
- [x] BE a durable session record and its grouping, membership derived from authority — `run_sessions` (schema v17, insert-only, member-less) written by `fanOutQueuedRuns` BEFORE its first member; every run row carries `sessionId` (`tasks.session_id`, read forward) and `runs.listBySession` IS the membership; a retry inherits its session; the queue row serves `session` (`93b7b18e` · `57f2bb9c` · `24b04dfa` — D269)
- [x] FE the session view — worker cards show authority membership and what each worker is doing; groups exact queue-row session ids, joins the claiming card by exact `runId`, preserves absent reasons and distinguishes declared pool size from non-terminal authority worker cards (`97a55b07`)
- [x] PROOF two separations dry-run scenarios in parallel, recorded; plus a §7.1 row in the same commit — LIVE 2026-08-26: docs 4502 (preview terminal, gate approved through the ceremony) and 4495 (the genuine S7 refusal) simultaneously `running` 19:32:18.305→19:32:48.009Z on `separations-worker-1`/`-2` under one D269 session, ceremonies serialized g1…g8 with no overlap and no counter burn; the §7.1 row is C12 (W5), whose live extension note cites the same evidence (`docs/rebuild/migrations/separations.md` §9.27)
- [x] needs §10 first — the pool multiplies the hazard the lease removes (§10 landed, D267)
> 2026-08-21 | docs-cohesion execution-and-sessions | DESIGNED, NOT BUILT — verified the five kernel command arms exist and validate (src/domain/commands.ts:181), createDashboardWorkerSupervisor refuses spawn BY NAME (src/server/dashboard/compose.ts:322) and createPhase1WorkerRuntimeExecutor refuses desiredWorkers !== 1 (src/core/worker-loop.ts:379)
> 2026-08-21 | parallel-runs P12 | the AUTHORITY half is built (D269): schema v17 `worker_pools` + `run_sessions` + `tasks.session_id` (93b7b18e), the pool CAS in the kernel (b4f30ea0), the session written at every fan-out and inherited by retry (57f2bb9c), the day wire's `workerPools[]` block and the row's `session` (24b04dfa); left: the pool PROCESS (spawn + pool-indexed ids, P3), the FE session view (P4), the parallel PROOF
> 2026-08-25 | parallel-runs P3 | pool-indexed identity is built: `worker <workflow> --pool-index N` validates positive N, derives the stable id and starts authority under that lease identity. The dashboard process supervisor, FE session view and parallel proof remain unbuilt
> 2026-08-25 | parallel-runs P3 review | worker processes use per-start durable records aggregated into D181's unchanged restore arm; distinct indices coexist and duplicate identity reaches authority. Singleton admission is an atomic filesystem claim (16 synchronized processes admit one), generation 1 is reserved for never-run so first start is 2, restore holds exclusive admission through staged checksum verification and swap, runtime starts check before/after their record, and ownership binds PID to OS process birth (Darwin C/UTC epoch seconds, with honest one-second resolution). Pool supervision, FE and parallel proof remain unbuilt
> 2026-08-25 | parallel-runs P4 | the FE session view reads only the D269 day wire (`97a55b07`): `QueueSurface.session.sessionId` groups membership, `WorkerCard.currentRun.runId` joins a claiming worker, and the absent session arm retains its served reason. Pool declaration and non-terminal authority worker cards remain separate facts; no process command is exposed
> 2026-08-26 | parallel-runs PROOF | the live two-worker pass (§9.27): pool planned+spawned+stopped from the Session Panel, two dashboard-started composed dry runs concurrently `running` for 29.7 s on distinct pool identities under one session, the D267 waiter refusal and the D214 cross-worker park+resume both exercised live, 0/0/0 write rows. Found and NAMED, not fixed: the Duo preflight proves the config credential instead of the packaged one a worktree lacks; macOS timer throttling starves an idle spawned worker's heartbeat until a peer's sweep stops its lease; a cold system's first `plan-worker-count` is unreachable from the panel
<!-- /roadmap-status -->

**AUTHORITY HALF AS-BUILT (D269, 2026-08-21); POOL-INDEXED IDENTITY AND FE VIEW AS-BUILT
(P3/P4, 2026-08-25); the dashboard process supervisor AS-BUILT and the parallel PROOF RECORDED
(W3–W5 + the 2026-08-26 live pass, `docs/rebuild/migrations/separations.md` §9.27).** This section is the
owning contract for the tree's `{#parallel-runs}` node and the normative text of D269. Points 1, 4,
5 and 6 carry the built authority, identity and view; the supervisor and its panel controls carry
points 2 and 8 as built and live-proved.

**1. A session is a dashboard-started group of runs.** It is not a browser session (§1), not a
worker, and not a workflow. It is what an operator starts when they dispatch a batch — ten I-9
members, a separations list — and it is the unit the dashboard reports progress against. A session
is DURABLE: it has an id, a workflow, the actor who started it, its creation instant, and its
membership. Membership is DERIVED from authority — a run row carries its session id — never held in
a supervisor's memory, because a supervisor's memory does not survive the process and a session an
operator can see after a restart is the entire point.

**2026-09-07 naming and presentation amendment:** SQL `run_sessions` is renamed to
`workflow_run_batches`; `tasks` is renamed to `workflow_runs`. The batch identity, origin and
membership remain durable and immutable. Only `group_in_queue` and its monotonically advancing
presentation version may change, through the journaled batch command. The queue presentation,
new-batch defaults, historical migration behavior and retry display are owned by
[dashboard-surfaces](dashboard-surfaces.md#workflow-batch-presentation)
in the workflow-batch paragraph immediately before D330.4. References below to the original schema
and session terminology describe the released implementation.

_As-built (D269):_ `run_sessions` (schema v17, `93b7b18e`) is the row — `RunSessionRecord
{sessionId, workflow, origin, startedAt, createdAt}`, insert-only by trigger (UPDATE and DELETE
abort, the archive tables' shape), and it holds **no member list**: `RunRecord.sessionId` (the
mirrored, nullable `tasks.session_id` column, indexed) is the membership and `runs.listBySession`
is how it is read, so a session can never claim a run the run table does not show and a restart
loses nothing. **One session per fan-out, N ≥ 1** — there is no threshold, because a minimum would
put a judgment call where a rule belongs: `fanOutQueuedRuns` (`57f2bb9c`) inserts the session row
BEFORE its first member inside the caller's transaction, so a refusal on run 39 of 40 unwinds the
session with everything else, and `runs.enqueue` refuses a member that names a session authority
never wrote or another workflow's session. The four fan-out callers mint the id and name the
`origin`: `start-run` (`{start-plan, startPlanId, actorId}`), `enqueue-intake-manifest`
(`{intake-manifest, intakeManifestId, actorId}`), `relaunch-archived-run` (`{archive-relaunch,
archivedRunId, actorId}`) and the capture handoff (`{capture-handoff, captureSessionId,
intakeManifestId}` — NO actor, because the capture session row records none and `local-operator`
there would be a value nobody recorded; its id folds from the same stable key as its run and
manifest so a D174 replay names the same group). **A retry mints no session: it inherits the
retried run's** — it is the same item's next attempt (D221), so the group the operator started keeps
reporting the item it contains; a retry of an ungrouped (pre-v17) run stays ungrouped. Pre-v17 rows
carry no `sessionId` and are read forward as "no session" (D133); nothing back-fills a group nobody
started. The queue's absence reason covers BOTH durable cases — *"this run predates D269 session
grouping, or retries a run that does"* — rather than claiming every absent row was itself enqueued
before v17. **Archive schema generation 4 freezes that required QueueSurface `session` arm.** A
generation-1/2/3 archived row has no key and reads forward as *"no session recorded (archived before
D269)"*; the archive read arm adds that sentence only to the served wire, never to stored JSON or
its `contentDigest`, while a generation-4 record without the arm refuses. The LIVE QueueSurface
schema remains required. D235's bulk strip is NOT a session producer: a bulk `retry` re-dispatches
members of the groups they already belong to, one child transaction each, and `bulkCommandId` never
reaches the kernel.

**2. Every workflow follows the SAME browser-profile recipe; each worker owns its own profile
directory.** Nothing new is needed here and nothing may be special-cased: §1's path already
partitions by `workerId`, Chromium locks a profile directory, and D116 puts the config fingerprint
in the path. The pool's obligation is only to give each worker a distinct id — see part 4.

**3. Coordination is through AUTHORITY only, never peer messaging.** Workers learn what the others
are doing from run claims, worker leases, write fences, the §10 ceremony lease and the invariants
§7.1 executes. No worker sends another worker a message, and no in-process registry is consulted:
D218's lesson is that an in-process hook feeding a cross-process fact is a single-process assumption
wearing a cross-process contract, and D200's is that a WON LEASE — not a heartbeat age, and
certainly not a peer's assertion — is the only statement one process may make about another's death.
Sessions do not share information with each other either; two sessions of the same workflow are two
groups of rows over one queue.

**4. The pool's first concrete change is the worker ID.** The pool mints pool-indexed ids, and the
authority lease refusal proves each pool member is singular. D181's process-lock layer must not
preempt that identity check: each worker start has its own durable process record, while observation
strictly aggregates all records (plus the old root-level `workers.lock.json`) into the existing
single `processLocks.workers` restore arm. Any live worker blocks restore; malformed records refuse;
every start/restart advances the aggregate generation beyond the reserved never-run generation 1.
The singleton server uses an atomic hard-link claim, and every new process/restore owner is identified
by PID plus OS process birth rather than PID occupancy alone; Darwin normalizes `ps` to C/UTC epoch
seconds and retains the kernel stamp's one-second resolution. `createPhase1WorkerRuntimeExecutor` keeps
refusing `desiredWorkers !== 1` until the unbuilt supervisor reconciles the declared pool size.

_As-built (2026-08-25):_ `poolWorkerId(workflowId, poolIndex)` derives
`${workflowId}-worker-${poolIndex}` from a branded `PositiveInt`. The CLI requires
`--pool-index <positive-int>` with no default, and `composeWorkerRuntime` uses that derived id for
the loop, browser-profile partition and `workerLeases.start`. Thus indices 1 and 2 retain distinct
stable lease rows, while a second process given the same index reaches the existing live-lease
conflict. `phase1WorkerId` remains only on the explicitly single-worker runtime-executor
compatibility arm; assigning and launching N members belongs to the unbuilt dashboard supervisor.

**5. The spawn control needs a CAS basis before it needs a button.** `spawn-worker` and
`plan-worker-count` target `{workflowId, expectedVersion}` (`src/domain/commands.ts`), and until
D269 the projection served no pool version — `WorkerCardWire.revision` is one worker's row. A
frontend that guessed an `expectedVersion` would be inventing the exact fact the CAS exists to
check, which is why there is no `+ Add workers` control today and why the pool version is a
prerequisite of the control rather than a detail of it. The dashboard's supervisor keeps refusing
spawn BY NAME (*"the dashboard process does not launch browser workers; start worker X with `npm
run cli worker <workflowId> --pool-index <positive-int>`"*) until a real process effect exists — a
refusal, not a stub, so no
acknowledgement can claim an effect that did not happen.

_As-built (D269):_ `worker_pools` (schema v17, `93b7b18e`) is the basis — `WorkerPoolRecord
{workflow, desiredWorkers, plannedBy, plannedAt, version, createdAt, updatedAt}`, one row per
workflow keyed on the workflow id, UPDATED under a version CAS (a pool is a standing declaration,
not a history) and never deleted. **A workflow with no row is at version 0**: nothing seeds rows at
boot (a `desiredWorkers` nobody planned would be a fabricated operator intent, and the composed
runtime's single worker is a fact about the PROCESS, not this table), so `expectedVersion` on both
arms is `NonNegativeInt` and 0 is the honest basis for the first plan, which creates the row at 1.
The kernel (`b4f30ea0`) CAS-checks the pool version FIRST on both arms and answers a stale one with
`conflict` naming the current version (`CommandResult.conflict.currentVersion` and
`versionChanges.before` admit 0 for exactly this target); `plan-worker-count` then consults the
runtime seam — which still refuses any count but one until part 4's reconciliation lands — and only
then writes `desiredWorkers` under CAS, reporting a `worker-pool` target with its version change, so
the pool never records a count the runtime refused; `spawn-worker` stays refused by the supervisor,
past a true check rather than a guessed version. The day wire (`24b04dfa`) serves
`workerPools[] {workflowId, desiredWorkers, version, plannedBy, plannedAt}` — authority rows only,
in workflow order; a workflow absent from the list has no row and its basis is 0 — read whole on
every snapshot exactly as `workerCards` are. It is a SNAPSHOT-level block by construction: the D4
day patch stream carries queue-row splices and nothing else, so a changed pool reaches the client on
the next snapshot, never through a patch — the same shape the cards and the inbox already have.
`desiredWorkers` is a declaration; what is actually running is the worker leases (§3), kept apart
for the reason the lease separates `control` from `lifecycle`.

**6. What the dashboard shows.** The session and its workers: membership, per-member run state, and
what each worker is doing — every value read from authority through the ONE projection
(ref dashboard-surfaces). _As-built (P4, `97a55b07`):_ the Session Panel groups every day
`QueueSurface` whose `session` is `{present, sessionId}` by that exact id, retaining row order and
its served run status. A worker is shown on that member only where its authority
`WorkerCard.currentRun.runId` exactly equals the row's `runId`; an absent session arm remains outside
the group with its served `reason`, never a guessed session. A pool row is a declaration only:
`desiredWorkers` is shown alongside non-terminal authority worker-card facts, and a missing
`workerPools[]` row reads as no declaration rather than version 0 or a target of one. The two
honesty rules carry over unchanged: requirement and open-session facts stay distinct as ref
dashboard-surfaces §9.9 specifies, and a wait reason is drawn only where a real holder can be named
— which, once §10 lands, is exactly one place.

**7. This does not weaken any per-run invariant.** One worker still owns one active item (§0.3);
a parked run still owns no browser resources (§2.1); the write fence is still per permanent key
(ref write-safety), so two members touching one external transaction still admit exactly one fence;
and a session is a GROUPING, never a transaction — cancelling a session cancels its member runs one
by one, through the same command arms, with the same refusals.

**8. Proof.** Two separations dry-run scenarios in parallel, recorded — which is also the
end-to-end tier's first exercise (ref guards-and-tests §test tiers) — plus a §7.1 row in the commit
that lands the pool. It needs §10 first: the pool multiplies the hazard the ceremony lease removes,
and shipping it in the other order would make the first parallel cold start the thing that burns a
profile.

_Recorded (2026-08-26):_ the §7.1 row is C12 (W5, real child processes over the composed pool
door); the live half is `docs/rebuild/migrations/separations.md` §9.27 — docs 4502 and 4495 concurrently
`running` for 29.7 s on `separations-worker-1`/`-2` under one D269 session, started, gated,
approved and stopped entirely through the dashboard, with the §10 lease serializing all eight
ceremony generations and 0/0/0 write rows. §10 first was the RIGHT order, proved the hard way: the
one live waiter refusal (`5026b1ed`) fired during the pass's first parallel cold start, by name,
before its envelope, exactly as designed.

### D271 — worker-pool process semantics are ratified (2026-08-26; designed, not built)

The operator selected A for all five `worker-pool` items. A scale-down names the **explicit member
indices** to stop; the future supervisor stops each selected member only after its active item
settles. B's arbitrary idle-member selection and C's immediate abort were rejected for
non-determinism and for violating the between-items/write-fence contract.
It records a 120s graceful wait, SIGTERM, 30s wait, then SIGKILL, leaving the claim stale for the
existing recovery sweep; B's unbounded wait and C's immediate termination were rejected as
respectively unbounded and unsafe. **An initial workflow pool is capped at three workers**: B's cap
of two discards the proven three-worker soak, while C's unbounded/N≥1 pool exceeds current proof.
This amends the earlier unbounded wording in this section: N≥1 still describes session membership,
not permissible dashboard pool capacity. Raising the cap above three requires a named concurrency
proof **at the proposed size** before that size can be exposed. A crashed member's card exposes its
stop reason, the declaration stays visibly unmet, and only then may an explicit `spawn-worker`
replace it; B's one automatic retry and C's continuous reconciliation were rejected because a crash
is evidence, not capacity to silently erase. After restart, a supervisor reconstructs all cards but
controls only durably proven children; every other live member is reported as **externally running**
and is not controlled. B's PID adoption and C's false stopped state were rejected. D269's
authority/pool distinction and D181/D200 recovery/identity rules remain unchanged.

## Provider storage foundation

**2026-09-08 — approved, pending implementation.**
[Side task `side/provider-usage`](../../sidetracks/provider-usage/README.md) owns the successor to
D112's two storage tables: `provider_admissions` → `provider_requests` and
`provider_budget_counters` → `provider_usage`. The operator explicitly limited this assignment to
provider-neutral tables/storage logic and compatibility; real API keys, provider-specific adapters,
pool selection, quota retrieval and presentation remain future work.

Request records retain exact execution/config/request identity, budgets, reservations, lifecycle
and evidence, with explicit legacy/unattributed/attributed scope. Generic storage accepts opaque
caller-supplied provider/credential/model/shared-quota references, never secrets; these references
do not register providers. Usage retains cumulative tracked amounts and current windows separately,
including reservations, unknown charges, limit provenance and locally calculated remaining values.
Tracking start and incomplete history are explicit. Unknown cost/quota is not a measured zero.

Existing runtime admission remains capability-scoped through a compatibility mapping into the new
tables. No current key attribution is fabricated. Reserve/settle/expire and request/accounting writes
remain atomic and replay-fenced; window rollover cannot erase lifetime totals or reconcile against
the wrong window. D308 deletes request details while retaining non-personal cumulative accounting,
finalizing pending reservations conservatively and refusing callbacks for deleted owners.

The application-only usage assumption governs future local accounting, not a claim of provider
verification. The plan follows accepted timeline/history T2 integration and carries migration,
restore, concurrency and deletion proof. This amendment records approved scope; it does not assert
implementation, authorize operator-database conversion or amend any running predecessor plan.
