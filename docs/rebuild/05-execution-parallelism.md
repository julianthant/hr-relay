# 05 — Execution Kernel: Workers & Browser Sessions

Status: **revised 2026-08-02 through the Phase 1f worker-session runtime.** The executor-lane and
static per-system capacity design is retired. One worker handles one item at a time; parallelism
comes from starting more workers; workflows explicitly declare steps that require a fresh browser
session.

## Ownership (D1)

| This doc **OWNS** (siblings reference, never redefine) |
|---|
| Worker claim/heartbeat/recovery behavior and the one-item-in-flight invariant |
| Browser-session ownership, reuse, reset/close discipline, and explicit fresh-session boundaries |
| Worker spawning and queue dispatch/backpressure |
| The speed contract: condition waits, sleep-tax removal, and bounded operations |
| The page/subject-isolation invariant (§6.1) |

| This doc **references** (owner) |
|---|
| Task contract, `SessionNeed`, exclusive driver use, retry policy → **doc 01** |
| Run state machine, gates/parks, checkpoints, RunEnvelope → **doc 02** |
| Worker/run/task span wire schema, Session Panel projections, notes → **doc 03** |
| Command/claim authority, degraded storage mode, notifications → **doc 03** |
| Semantic UI ids, typed drivers, action evidence, scenarios → **doc 12** |
| OnBase cross-process identity lease → **D15** |

Grounding: today's daemon already has one `state.activeRun` per process. The rebuild keeps that
understandable ownership model and removes the proposed scheduler inside each process.

## Phase 1d session seam ratification (2026-08-01)

**D96 replaces the partial shapes in earlier drafts with one imported doc-01 `SessionNeed`:**
`{system, access:"read"|"transaction", session:"reuse-worker"|"fresh", exclusive?:true,
acceptDownloads?:true}`. This doc owns worker/session behavior but does not redefine that type.
Read tasks require read access; prepare/commit tasks require transaction access; mismatches fail at
the task/store boundary before an executor exists. `exclusive:true` is legal only for OnBase, and
OnBase is the only identity-exclusive provider declaration. Phase 1d may declare sessions and
fail-loud unwired login callbacks; acquisition, close ordering, fresh-boundary execution, and
cross-process lease behavior remain 1f runtime work.

As built on 2026-08-01, each of the nine browser stores declares exactly one matching
`SessionProvider`. Every placeholder login rejects with an explicit "declared but unwired in Phase
1d" error; none creates a browser or claims authentication. OnBase alone declares and requires
`exclusive:true`. The store/task boundary validates the full `SessionNeed` shape and effect/access
agreement now, while worker-owned acquisition, reuse, close/reset, and cross-process leases remain
absent until 1f.

## Phase 1f worker-session runtime (2026-08-02)

`WorkerSessionManager` now owns the callback-scoped driver lease for each
`(worker, system, resolvedInstance, configFingerprint)` identity.
The manager serializes use within that pair, performs a single authenticated start, and reuses the
resource only when that complete identity plus its download and exclusivity launch properties
match the authored need. A changed config fingerprint or resolved instance closes the old resource
and creates a new one; it can never reuse a context authenticated/configured under another run
snapshot. A clean callback must reset before release. A task failure, cancellation, or failed reset
poison-closes the resource; a `fresh` need proves the old page/context (and OnBase identity lease)
closed before the replacement emits `browser-session:start`.

Parking and worker stop first reject new leases, wait behind every in-flight callback, then close
all owned resources. A missing or failed close proof leaves the resource registered and poisoned:
the manager refuses reuse instead of treating an uncertain close as success. The same rule covers
failed-login cleanup, so a resource whose cleanup could not be proved cannot disappear from worker
ownership. The nine store providers now accept the worker resource's bounded authentication handle;
concrete browser creation remains a factory injected at the runtime composition boundary.

## Phase 1f concrete session factory (2026-08-03)

That injected factory is now real. `src/infra/browser/` launches Playwright's FULL bundled Chromium
(`channel: "chromium"`) in a persistent context with the Duo Autopilot extension loaded — all three
are requirements rather than preferences: Chrome stable dropped `--load-extension`, the lightweight
headless shell cannot run an extension, and an extension requires a persistent context. Profiles
live under the runtime-isolation `browserProfileRoot`/`browserSessionNamespace`, namespaced per
`(worker, system, resolvedInstance, configFingerprint)`, so D116's no-cross-snapshot-reuse rule also
holds for on-disk state, not just for the in-memory context.

`close()` returns a proof only after observing every page closed AND the context's own close event
inside a bounded deadline; an unproven or hung close throws, and the manager's existing poison rule
does the rest. A clean release re-navigates to the system's entry route and re-runs the system's
full authentication proof (§4.1), so "reusable" is an observation. Login recipes stay with their
stores (`stores/<system>/session.ts`), which — together with `src/infra/browser/**` — are the two
raw-browser owner families the task-driver boundary permits; task and workflow code may reach
neither, transitively or otherwise. UCPath and CRM are bound today; a system without both a driver
and a login recipe refuses at open rather than launching an unusable browser, and the exclusive
OnBase identity lease is explicitly not landed here.

## Session acquisition is bounded separately from the task (D125, 2026-08-04)

**`timeouts.sessionAcquireMs` (default 60 000 ms) bounds ONE browser-session acquisition — the
factory `open` plus that system's login recipe — and it is a different bound from
`timeouts.taskMs`.** The kernel-owned `MonotonicDeadlineScheduler` arms it, the acquisition runs
under its own linked `AbortSignal` so a cooperative recipe cancels itself, and expiry FAILS the
lease with a message naming both leaves. It is never converted into a retry.

**Why the whole-task deadline could not do this job.** The Phase-1 live exit run
(`4ebf7275-0158-49af-a78f-1f37948efb27`, master plan §Phase 1) spent **262.9 s** inside one
`withDriver` when the CRM browser died. Every step *inside* the login recipe was already bounded —
each navigation by `navigationMs`, the Duo window by `duoApprovalCrmSeconds` — but **nothing bounded
the chain**, and the only outer bound reaching that code was `taskMs`. `taskMs` must stay generous
because it covers the real read (UCPath person-org ≈22 s; Kuali fill→save→reload→verify 8–10 s per
cycle), so it is structurally the wrong instrument for "is this session alive?". In that run it
never fired: the D118 claim sweep (60 s staleness on a 30 s cadence, measured on the WALL clock)
requeued the run first, the next heartbeat reported the claim lost, and the task span closed
`cancelled` at 4 m 23 s. Claim expiry is recovery, not a liveness bound — it is the last line, and
it was doing first-line work.

**Why 60 s is safe.** Acquisition is not the slow part of a healthy run: §4.1 authentication is
live-verified at ~17 s (UCPath) and ~12 s (CRM) with Duo Autopilot clearing the ceremony hands-off
(charter §9), so the default is >3x the measured worst case. It cannot fail a legitimately slow
*read*, because a read happens after acquisition, under `taskMs`. A deployment that reverts to a
HANDS-ON Duo approval must raise `sessionAcquireMs` above `duoApprovalSeconds` — the inner Duo wait
would otherwise outlive its own envelope — and the refusal message says exactly that.

**An acquisition that outlives its bound is UNCERTAIN.** A cooperative recipe rejects on the
acquisition signal and runs `#openAndLogin`'s own proven cleanup. A non-cooperative one may still
land a live session afterwards; that session is poison-closed rather than inherited by the next
lease as a warm reuse, and a close that cannot be proven leaves the system poisoned so the next
acquisition refuses by name (§4, doc 05 poison rule).

The `fresh-session-boundary` guard is now ACTIVE against these pieces (doc 10 §5): the boundary
close reason exists only in the session-ownership modules, every authored `session:` need is a
string literal rather than a computed value, repeated `reuse-worker` needs mint no boundary, and
both an authored `fresh` need and a D116 identity mismatch close with an accepted proof before the
replacement opens. Its one outstanding arm — descriptor-level node-execution ordering — lands with
the first workflow that authors a fresh-boundary node.

---

## 0. Settled decision

1. **No executor lanes.** There is no global `lanes` number, lane reservation, capacity chip, or
   per-workflow lane cap.
2. **No static per-system capacity math.** There is no `ucpath 1/1` or `crm 1/2` budget contract.
   Concrete browser health tiles show the sessions that actually exist.
3. **One worker, one active item.** A worker does not claim a second run until its active run parks
   or reaches a terminal state.
4. **Parallelism is worker count.** Starting N workers for a workflow creates N independent workers.
   The Add-workers UI does not invent a hidden lease calculation or global cap.
5. **Browser sessions belong to a worker.** Distinct workers own independent system sessions.
6. **Workflows declare fresh-session boundaries.** Reuse is normal. If a particular step must run
   in a new browser session, the workflow descriptor says so explicitly. The kernel never infers a
   boundary from a counter, step name, or queue state.
7. **No cross-workflow browser pool.** Authenticated pages are not shared between unrelated
   workflows.

“Lane” remains valid terminology for test suites (`stub lane`, `live lane`) and visual workflow
graph branches. Those uses do not describe executor capacity and are unaffected.

---

## 1. Units, named precisely

- **Run** — one item's execution of a workflow.
- **Worker** — one long-lived process/instance assigned to one workflow. It owns at most one active
  run and its browser sessions.
- **Browser session** — one authenticated `BrowserContext` and controlled page/window set for one
  system inside one worker.
- **Driver lease** — exclusive task-length access to a system driver backed by the worker's current
  browser session. A transaction may retain it across prepare → fence → commit → proof.
- **Fresh-session boundary** — an authored workflow instruction that closes the current session for
  a named system before the next node and authenticates a new one.

---

## 2. Workflow session contract

The descriptor compiler resolves every browser-backed node to an explicit policy:

```ts
export interface SessionNeed<S extends BrowserSystemId> {
  system: S;
  access: "read" | "transaction";
  session: "reuse-worker" | "fresh";
  exclusive?: true;
  acceptDownloads?: true;
}
```

- `reuse-worker` uses the worker's current healthy authenticated session for that system, creating
  one lazily if none exists.
- `fresh` first performs the bounded close protocol, then creates and authenticates a new session
  before the node begins.
- Authoring may omit `session` only where the descriptor schema supplies the literal, test-pinned
  default `reuse-worker`. Runtime code never guesses.
- A session boundary is visible in the Explorer and worker/run spans as
  `browser_session:close` followed by `browser_session:start`, including system and reason.
- A workflow that needs several sessions states boundaries at the exact nodes. It does not raise a
  worker-wide number or create a second item slot.

### 2.1 Gates and parks

A parked run owns no browser resources. Before parking, the worker resets/closes active sessions
according to the provider policy and releases identity leases. Resume is a fresh claim. An overnight
approval holds neither a browser nor an execution slot.

---

## 3. Worker lifecycle and claiming

Each worker is workflow-scoped and runs the proven claim-generation protocol:

```ts
export async function runWorker(config: WorkerConfig): Promise<void> {
  const sessions = new WorkerSessions(config.workflow);
  while (!state.shuttingDown) {
    const run = await claimNextRun({ workflow: config.workflow });
    if (!run) {
      await parkUntilWakeOr(IDLE_REPOLL_MS);
      continue;
    }
    await driveRunStateMachine(run, sessions); // one awaited run
  }
}
```

- Claim authority remains SQLite with owner, attempt, claim generation, heartbeat renewal, fenced
  terminalization, dead-worker recovery, and bounded re-poll.
- A worker renews exactly its one active claim.
- A gate parks the run and frees the worker to claim another item.
- Retry backoff rides `not_before`; a worker never sleeps while owning a run merely to wait for a
  retry time.
- `+ Add workers` chooses a workflow and a count. Starting 5 creates 5 independently owned workers
  and browser-session sets.
- An expired claim is not ordinary requeue authority. Before the claim sweeper can transition an
  interrupted run back to `queued`, it checks the authoritative write-intent set for the run's
  workflow/item/node. Any unfinished `attempting` intent routes to doc 09 recovery first and keeps
  the run unclaimable for normal execution. Only a schema-valid positive recovery completion or a
  schema-valid safe-to-retry/confirmed-absent resolution may release it to the corresponding
  terminal/new-generation path. An unavailable or inconsistent intent lookup parks/refuses; it
  never means “no unfinished write.”

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
neutral reset accepted a signon page. `authentication-proof-not-url` (doc 10) pins the shape.

An individual workflow may declare internally proven parallel work, such as OCR provider page
concurrency. That is workflow-owned behavior with its own tests, not a generic executor capacity
model.

The Session Panel shows worker phase, queued count, trace id, current step, browser health tiles,
wait reasons, and failure state. It does not show lane or per-system capacity counters. Settings has
no lane/budget reference page.

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
| Authority DB degraded | All mutation stops | doc 03 storage-health gate; dashboard remains diagnostic |

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
