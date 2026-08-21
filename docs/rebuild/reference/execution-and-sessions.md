# Execution and sessions — one-item workers, browser sessions, and the Duo ceremony

**What this doc is.** The contract for how work actually RUNS: the vocabulary (§1), the workflow
session contract (§2), the worker's claim/heartbeat/recovery lifecycle (§3), browser-session
ownership and the content-level authentication proof (§4), the speed contract (§5), failure
isolation (§6), the guards and the executed concurrency matrix (§7), a worked example (§8), the
settled defaults (§9), and the two things this doc has DESIGNED and the tree has not yet built —
the Duo ceremony lease (§10) and sessions plus the worker pool (§11). It is a REFERENCE spec: it
states what holds, and where the code differs the as-built is stated in the section it amends.

**Status, verified against the tree 2026-08-21 (D252).** §1–§9 are BUILT and running. One worker
owns one active run (`src/core/worker-loop.ts`), its browser sessions are callback leases keyed on
the whole `(worker, system, instance, configFingerprint)` identity (`src/core/worker-sessions.ts`),
the concrete factory launches Playwright's full Chromium with the Duo Autopilot extension and proves
every close (`src/infra/browser/browser-session-factory.ts`), four systems are bound
(`src/infra/browser/system-bindings.ts`), and D182's concurrency matrix executes the multi-worker
cases against real `runWorkerLoop` instances over one authority database (§7.1). §10 and §11 are
**DESIGNED, NOT BUILT** and say so in their own status blocks. The executor-lane and static
per-system capacity design is retired and stays retired (§0).

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
- **Session** (§11, designed, not built) — a dashboard-started GROUP of runs, and the only unit in
  this list that names more than one run. It is not a browser session and not a worker; it is what
  an operator starts when they dispatch a batch, and the thing a worker pool serves. Today the word
  appears in this doc only as "browser session"; §11 is where the group sense is specified.

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

### 3.1 Dispatch and fairness

Within a workflow queue, claim order is priority then FIFO. Interactive work may be server-stamped
ahead of bulk members, but there is no reserved interactive lane. Across workflows, the operator
chooses worker counts per workflow, and each worker claims only its workflow's rows. A large fan-out
cannot consume another workflow's workers.

Provider capacity is a separate admission domain, not a browser lane. Before a service task calls
a remote provider, Phase 1f's generic capability admission service reserves the applicable
concurrency/rate/daily-use/cost budget from the run's immutable config snapshot. If admission is not
available, the kernel records the typed wait/unavailable reason and releases or reschedules with
`not_before`; it does not keep a worker asleep and cannot fall through to the adapter. Phase 2h
adds production pools and consumers over this core, not a second scheduler.

**D112 durable admission as built (2026-08-03).** Capability-global authority counters use fixed
UTC-minute rate and fixed UTC-day request/cost windows, while each decision retains the requesting
run's exact immutable config snapshot and fingerprint. Reservation atomically expires stale leases,
rolls windows, reserves one request plus the adapter's conservative maximum cost, and either grants
or records a typed denial before any remote call. Settlement releases concurrency and may reconcile
cost down; invoke failure, timeout, crash/unknown, and lease expiry retain the full reservation.
Actual cost above the estimate blocks that capability through the UTC day and fails loud. A
retryable denial maps its exact `retryAt` to run `not_before` with cause `provider-capacity`; abort,
timeout, and adapter-unavailable carry no retry instant. No admission path sleeps while holding a
worker.

---

## 4. Browser-session behavior

- Driver use is exclusive while held.
- `release("clean")` navigates to the system's verified neutral reset state before reuse. The next
  read owns navigation from that neutral state; neutral reuse is not reuse of the prior subject
  page, and it is not a fresh context unless the authored need says `session:"fresh"`.
- A failed reset, aborted Playwright call, subject mismatch, or `release("poisoned")` closes the page
  and session; the next need creates a fresh one.
- A `session:"fresh"` boundary uses the same close proof before replacing the session.
- OnBase releases its identity lease only after every page/context close is proven.
- Login is bounded and single-flight within that worker/system session creation. There is no
  cross-worker login promise or shared context.

### 4.1 Authentication is a content-level observation, never a URL (D120)

**A session is authenticated only when the page proves it. A URL never proves it.** A URL is chosen
by whoever served the redirect; a system's sign-in page and its application routinely share a host,
and PeopleSoft's signon renders at the same route shape as the application it guards. Every browser
system therefore declares an **authenticated-application verifier** returning a discriminated probe,
and it must establish TWO independent facts:

1. a **positive** fact — a session artifact the server issues only after a completed authentication
   (UCPath: PeopleSoft's `PS_TOKEN` cookie; CRM: Salesforce's `sid` Communities cookie). An
   app-only DOM marker is an acceptable positive fact where no such artifact exists; and
2. a **negative** fact — no sign-in form of any kind is on the page (the shared UCSD TritON form,
   plus the system's own application-side login form).

A URL predicate may be a NECESSARY precondition a verifier checks first — it is never sufficient,
and it is never the conclusion. A probe that cannot RUN reports "not authenticated" with a reason
that says so; "I could not check" must never read as "it passed".

**The verification is unskippable and singly defined.** A login recipe is built by
`defineVerifiedLoginRecipe`, which runs the verifier AFTER the recipe's flow whatever the flow
returned, so `already-authenticated` and `logged-in` are labels on the same proven state and a later
early `return` cannot reintroduce a bypass. The clean-release neutral reset asserts through the same
verifier — there is one definition of "authenticated", not one per call site. The evidence that
proved it travels on a required channel so an operator surface can show WHAT was observed, and
`browser-session:start` carries the distinct `LoginResult` so a run that never authenticated cannot
look like one that did.

This ratifies a 2026-08-03 live finding: a UCPath login smoke reported success in ~3s having never
authenticated, because the recipe matched a host substring on the PUBLIC UCPath portal and the
neutral reset accepted a signon page. `authentication-proof-not-url` (ref guards-and-tests) pins the shape.

An individual workflow may declare internally proven parallel work, such as OCR provider page
concurrency. That is workflow-owned behavior with its own tests, not a generic executor capacity
model.

The Session Panel shows worker phase, queued count, trace id, current step, browser health tiles,
wait reasons, and failure state. It does not show lane or per-system capacity counters. Settings has
no lane/budget reference page.

**As-built (D248, 2026-08-20).** The panel's card is this section's lease — `workflow`, lifecycle
phase, the operator's standing directive, the started/stopped instants, the stop reason and the row
version — joined with the browser sessions the worker's own spans have open. Two items of the list
above are NOT drawn, each for a producer that does not exist in this platform rather than for a
surface that was skipped. There are no **wait reasons**: §1 partitions a browser profile per
`(worker, system, instance, configFingerprint)`, so a second worker opens its own UCPath window
rather than queueing behind the first, and there is no cross-worker lease to name a holder for.
And there is no **health** on a tile: nothing probes a live session, so a tile states which system
its session speaks to and how long it has been open, and reads `Not checked` — which is the honest
verdict and must never be drawn as a passing one. `stop-worker` and `pause-worker` reach the lease
from the panel; `spawn-worker` and `refresh`/`reopen-browser` do not, because their process effects
refuse by name in the dashboard process (this section's live lane owns them).

---

## 5. Speed engineering

Removing lanes does not preserve the fixed-sleep tax:

1. Replace `waitForTimeout` calls with waits on actual readiness predicates plus a bounded quiet
   window where PeopleSoft fragment refreshes require it.
2. Live-verify each replacement and record the selector/state proof.
3. Extend the wait-for-timeout ratchet to rebuild code with a zero allowlist for new files and a
   shrink-only allowance for ported files.
4. Record cumulative fixed-sleep time and real wait time on task spans.
5. Keep tasks and transactions under immutable, abortable deadlines. A service that ignores abort
   cannot occupy a worker indefinitely.

For batch speed, start more workers. A warm worker amortizes login across sequential items unless a
workflow-authored fresh boundary or failed reset requires replacement.

**As-built after the Phase-1 live exit run (2026-08-04) — the budget is met at zero, and wall clock
is not the budget.** This section's quantity is **fixed sleep time**, and nothing else. On the exit
run (`4ebf7275-0158-49af-a78f-1f37948efb27`, master plan §Phase 1) `sleepMs` was **absent from every
task span**: the executor emitted no fixed sleeps whatsoever, so item 4's "cumulative fixed-sleep
time" is zero and legacy's ~24s of `waitForTimeout` on the UCPath person-org read path is removed
rather than reduced.

The same run's **total wall clock** for that read was **22.5s**, dominated by UCPath's own page
loads. That figure is an observation and is deliberately **not** a threshold here: it is a total,
the ~24s it is often set beside was legacy's sleep alone, and **22.5s is not materially below 24s**.
Reporting it as a speed win would be comparing two different measurements, which is exactly the kind
of plausible-but-unearned claim this program bans elsewhere. Whatever wall clock remains after the
sleep tax is gone is real work at the far end of the network; reducing it is a separate exercise
with its own evidence, not something this criterion has already claimed.

---

### 4.2 A refused Duo ceremony is an OBSERVATION, and the counter it refuses on is SHARED (D243, 2026-08-19)

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

---

## 6. Failure isolation

### 6.1 Page/subject-isolation invariant

> A page belongs to at most one task execution at any instant. It is reusable only after a
> successful bounded reset to the system's neutral state; otherwise it is closed. Before a write
> fence, the driver freshly observes the declared subject on the staged page and the kernel requires
> an exact normalized match. Mismatch or unknown prevents commit and closes the session.

One worker never shares its page with another worker. One workflow never borrows another workflow's
authenticated context.

### 6.2 Failure matrix

| Failure | Blast radius | Mechanism |
|---|---|---|
| Task throws | Its run/worker | Release clean or poisoned; apply retry policy; worker claims next eligible row |
| Cancel during Playwright | Its page/session | Abort-racing proxy + poison-close |
| One system session wedges | That worker's system session | health ladder → close/re-auth or structured failure |
| Worker crashes | Its one active run | claim-generation recovery; transaction recovery before replay |
| Retry storm | No head-of-line block | `not_before`; idle workers claim other eligible rows |
| Authority DB degraded | All mutation stops | ref dashboard-surfaces storage-health gate; dashboard remains diagnostic |

---

## 7. Mechanical guards

| Risk | Required guard |
|---|---|
| A worker starts two items concurrently | worker-soak test asserts max active claims per worker is exactly 1 |
| UI/config reintroduces capacity fields | unit guard rejects worker/session fixtures containing `lanes` or `budgets`; dashboard verification asserts capacity copy is absent |
| Parallelism silently serializes | spawn test starts N workers and proves N distinct worker ids/browser owners |
| Fresh-session request is ignored | descriptor scenario asserts close proof precedes new-session start and node execution |
| Session boundary is inferred | descriptor projection test proves only authored `session:"fresh"` produces a boundary |
| Config/instance drift crosses runs | session-manager test proves reuse requires exact `(worker,system,resolvedInstance,configFingerprint)` identity and closes before replacement |
| Expired claim bypasses unfinished write recovery | claim-sweep crash fixture proves an `attempting` intent reaches recovery before any queued/claimable transition |
| Provider exhaustion bypasses admission | deterministic budget fixtures prove zero adapter calls and no sleeping worker when capability admission is unavailable |
| Dirty page crosses people | alternating-subject scenario proves reset-or-close + subject observation before write fence |
| Raw page APIs bypass ownership | imports/newPage are restricted to driver/session internals |
| Fixed sleeps return | wait-for-timeout ratchet + span sleep budget |
| OnBase overlap | identity-lease test proves close-before-release and dead-owner takeover |

### 7.1 The 2j concurrency matrix — executed (D182)

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

`composeWorkerRuntime` cannot host these rows: it derives its id from `phase1WorkerId(workflowId)`,
so two composed workers on one workflow collide on the authority worker LEASE by design, and
`createPhase1WorkerRuntimeExecutor` refuses `desiredWorkers !== 1`. N-worker overlap is
`runWorkerLoop` called N times with distinct `workerId`s against one shared database — which is
exactly the shape §2 says a later phase spawns as processes.

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
| — | Exclusive driver use and login single-flight per `(worker,system)`; fresh-boundary close-before-open; abort-race poison-close; `closeAll("parked")` waits for an active callback; D116 fingerprint identity; D125 bounded acquisition | `worker-sessions.test.ts` |
| — | Second live process on one worker id refused; stale lease reclaimed at boot; graceful mid-run stop; close-proof failure records the lease `crashed` | `worker-composition.test.ts` |
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

**The standing rule.** A new execution or command surface that can be reached by two callers adds a
row here in the commit that lands it, naming the test that executes it. A surface whose concurrency
is "obviously fine" gets a row saying which existing test proves it; the one thing it may not have
is no row.

---

## 8. Worked example — 10-person I-9 Check

Choosing **3 workers** creates three independently authenticated UCPath/I-9 session sets. Each
worker claims one member, runs it to park/terminal, resets its sessions, and claims the next. No
worker has a second in-flight item and no capacity counter participates.

If a specific step needs a clean UCPath context, the I-9 Check descriptor marks that node
`session:"fresh"`; other steps reuse their worker-local session.

---

## 9. Settled defaults

1. One active item per worker.
2. Parallelism is explicit worker count, chosen per workflow.
3. Session reuse is the descriptor default; fresh boundaries are explicit and observable.
4. No global executor lane budget, lane chip, per-system capacity chip, pool-mode table, or
   lane-based fairness math.
5. Queue admission is blocked only by authority/storage correctness; worker availability affects
   when work starts, not whether it may be enqueued.
