# Handoff — dashboard wiring review and remediation plan

**Date:** 2026-09-02  
**Paused at:** the current dashboard wiring has been reviewed read-only at
`211413a81f354ec059250cde039adfeb5e3fc44c`; no implementation has started. The development path is
coherent, but five consequential runtime defects, one shared-contract defect, documentation/test
drift, and the already-planned production-byte-path gap remain.  
**Cleanup owner:** the task that implements or explicitly dispositions this review.  
**Remove when:** every finding below is either fixed with its named proof or deliberately deferred in
an owning plan/spec, the final review and gates are recorded in durable authority, and this brief is
no longer needed to resume. Commit the deletion if this tracked brief has been committed.

## Task summary

Review the current dashboard end to end, determine whether browser, client, BFF, subscription,
projection, and runtime-lifecycle seams are wired correctly, and use current framework documentation
where it can distinguish framework behavior from repository behavior. The review did not authorize
feature implementation, a production deployment, live HR work, a new task, or subagent dispatch.

The main development path is internally consistent:

```text
React dashboard
  -> typed client/transport
  -> same-origin Vite dev proxy on 5174
  -> Hono BFF on 3938
  -> services / SQLite authority / ONE dashboard projection
  -> SSE dashboard-day envelopes
  -> client snapshot + patch reducer
```

The answer is therefore not “rewire everything.” Preserve the existing path and repair its admission,
lifecycle, stream correctness, and contract ownership at the narrow seams named below.

## Authority and verified git state

- Repository: `/Users/julianhein/Projects/hr-automation-rebuild`.
- Review commit and current HEAD: `211413a81f354ec059250cde039adfeb5e3fc44c`.
- Branch: `feature/03c-workflow-migration`; it has no configured upstream.
- Working tree was clean before this handoff was created. No source, test, plan, or generated file was
  changed during the review.
- The root checkout is shared. Three other registered worktrees existed at pause time:
  `feature/test-r7-integration-review`,
  `feature/phase-3c-migration-c57c2dec9-r3c-deletion-acceptance`, and
  `feature/test-suite-rationalization`. Re-run `git worktree list`; do not infer their present state
  from this snapshot or disturb them.
- No coordinator board or execution run plan owns this standalone review. Because remediation is
  multi-part, execution should begin through an explicitly invoked `/supervise` run with recorded,
  non-overlapping units and the repository's required worktree lifecycle. Do not dispatch ambiently.
- No remote operation, push, merge, dashboard process mutation, browser session, or live workflow
  occurred.

## What current framework documentation established

Context7-style dependency research is useful here only for version-sensitive framework semantics;
repository contracts remain authoritative for application behavior.

- Vite 8 source/documentation confirms that `preview.proxy` defaults to `server.proxy`, so the current
  development/preview proxy relationship is expected. A Vite build only emits static assets; it does
  not make the BFF a production static server.
- Hono's Fetch API model supports returning a Web `ReadableStream`, including SSE. The repository's
  custom Node adapter is legitimate and already has meaningful tests. Framework support does not,
  however, supply the repository's required queue bound, reset semantics, shutdown order, mutation
  admission, or durable-authority rules.
- Do not use dependency documentation to override `ref frontend-backend-integration`, D75, D294, the
  fail-loud rule, or the ONE-projection contract. Use it to validate APIs while designing the local
  fix.

## Findings, in execution priority

### P0 — Mutation admission is missing on two durable browser-reachable routes

Evidence:

- `src/server/dashboard/routes/api.ts:260-262` installs `operatorMutationIngressGuard` only for
  commands, bulk commands, and XLSX export.
- `POST /api/v1/start-plans` at `src/server/dashboard/routes/api.ts:592` parses a body and persists a
  start plan through `start-plan-service.ts:172-175` without that guard.
- `POST /api/v1/intake/files` at `src/server/dashboard/routes/api.ts:607` reads query/body bytes and
  creates or joins durable intake/session/artifact state without same-origin loopback admission.
- A direct Hono proof showed that `c.req.json()` accepts a valid JSON body sent as `text/plain`, so a
  hostile page can issue a simple no-CORS POST to loopback. That is a real server-first admission
  defect, not merely a missing client header.

Required outcome:

1. Reuse or generalize one admission policy so Host and Origin must be the exact allowed loopback
   same-origin pair before any body, query, authority, or provider work occurs.
2. Require `application/json` for start-plan creation before parsing the body.
3. Preserve intake's binary/media-type contract; require Host/Origin there, not JSON.
4. Return the established named wire-error shape and fail before side effects.
5. Audit `POST /api/v1/runs/:runId/advisory` separately. It is described as non-command, but it can
   spend provider budget and write provider-admission metering. Recommendation: give it the same
   loopback-origin admission unless its owning contract explicitly records a different boundary.

Regression proof:

- Route tests for absent, malformed, foreign, and Host-mismatched Origin; wrong start-plan media type;
  valid start-plan JSON; valid binary intake.
- Prove rejected requests do not consume the body and do not call planner, intake, authority, or
  provider dependencies.
- Add/update the architecture authority snapshot so every browser-reachable durable mutation is
  classified and guarded.

### P0 — Production signals bypass the composed runtime's shutdown contract

Evidence:

- `src/core/runtime-composition.ts:229-237` starts dashboard composition in a detached promise chain,
  writes the listening message, and discards `running.stop`.
- `scripts/dev-dashboard.ts` forwards SIGINT/SIGTERM to the BFF child.
- `src/server/dashboard/compose.ts:1378` owns the real ordered stop: HTTP ingress, hub/timers,
  supervisor/drain backup, database, and process lock. The CLI entrypoint never calls it on signals.

Required outcome:

1. Give the dashboard command an awaited lifecycle that retains the composed runtime.
2. Install idempotent SIGINT and SIGTERM handlers at the production entrypoint boundary; call
   `stop()` exactly once, await it, report aggregate failure loudly, and only then complete/exit.
3. Prevent racing signals and remove listeners so tests and other CLI commands do not leak handlers.
4. Keep `composeDashboardRuntime.stop()` as the shutdown authority; do not duplicate its ordering in
   the CLI.

Design choice to settle before editing: either make the CLI runner explicitly asynchronous or add a
small dashboard lifecycle runner that the CLI awaits. Recommendation: an explicit async lifecycle is
clearer than hiding process ownership in another detached callback, but first inventory all callers
of `startRebuildRuntime` so the change does not silently alter unrelated commands.

Regression proof:

- Unit/integration test with an injected signal seam proving two signals still invoke `stop()` once
  and completion waits for the stop promise.
- Child-process smoke through the real `src/cli.ts` registration proving the production composer is
  used, the lock is released, and the process exits after graceful shutdown.
- Where practical, prove the graceful-drain backup path with actual composition rather than a no-op
  stop fake.

### P1 — Duplicate or older SSE cursors are not idempotent

Evidence:

- `src/dashboard/client/subscription.ts:99-139` applies snapshots and patches without first ignoring a
  cursor at or behind `lastCursorNumber`.
- `ref frontend-backend-integration` requires duplicate/current cursors to be idempotent.
- A duplicate removal patch can remove an already-removed run, trigger a protocol error, and force an
  unnecessary resnapshot; an older snapshot can regress the displayed day.

Required outcome:

1. After validating the cursor and before snapshot/patch effects, ignore envelopes whose cursor is
   less than or equal to the held cursor.
2. Preserve generation-change behavior: a replacement generation must clear/rebase cursor authority
   before its first snapshot, not smuggle an older snapshot through this rule.
3. Continue to resnapshot on a genuine forward gap and on patch/projection mismatch.

Regression proof: duplicate patch, duplicate removal patch, older patch, duplicate snapshot, older
snapshot, valid next cursor, forward gap, and generation/hash replacement.

### P1 — Permanent stream failures reconnect forever and hide the reason

Evidence:

- `src/dashboard/client/subscription.ts:167-170` handles both normal completion and rejection as the
  same reconnect action and drops the rejection value.
- `DashboardClientError` already distinguishes retryable network failures from nonretryable
  HTTP/protocol/schema failures.

Required outcome:

1. Retry normal EOF and explicitly retryable failures according to the existing reconnect contract.
2. Stop on nonretryable `DashboardClientError` and publish that error to state.
3. Normalize unknown rejections according to an explicit contract; do not silently guess them into a
   permanent retry loop.
4. Ensure the React day hook replaces stale loaded state with the failed state users can see.

Regression proof: retryable disconnect reconnects; nonretryable HTTP rejection stops; protocol
rejection stops; hook-level test observes the terminal error rather than stale data plus
“reconnecting.” Any visible UI change must use `/ui` and run parity.

### P1 — The route-to-Node SSE path loses the hub's queue bound after subscription

Evidence:

- `src/server/dashboard/subscriptions/dashboard-stream.ts:156-169` bounds only the queue used before
  a listener is registered. Once registered, `#push` invokes the listener synchronously.
- `src/server/dashboard/routes/api.ts:684-696` immediately calls `controller.enqueue()` for every
  notification without consulting downstream demand.
- The custom Node adapter can respect `res.write()` backpressure, but that does not stop the upstream
  Web Stream queue from growing while a client is slow.

Required outcome:

1. Add a bounded, demand-aware bridge between hub envelopes and the response stream.
2. Preserve order; never silently drop a state-bearing envelope.
3. When the bound is exceeded, collapse queued state to exactly one `reset-required` envelope, using
   the protocol's current cursor/generation semantics, then resume from a snapshot.
4. Close the hub connection on stream cancellation, transfer failure, and server shutdown.

Evaluate two implementations before choosing: a Web Stream `pull()` bridge with its own bounded
queue, or hub-level pause/delivery semantics. Recommendation: keep the bound in one authority (the
hub/connection abstraction) and let `pull()` drain it, so route code does not grow a second subtly
different queue policy. Hono's `streamSSE` helper alone does not solve this repository-specific
backpressure contract.

Regression proof:

- Slow consumer that does not read, followed by more than `maxPending` publishes: memory/queue stays
  bounded and exactly one reset-required supersedes the pending state.
- Resume after reset yields an authoritative snapshot.
- Cancel closes the connection once.
- Real Node adapter test pauses downstream reads and proves bounded upstream behavior and cleanup.

### P2 — Start-plan schemas have two owners and the client copy is weaker

Evidence:

- `src/dashboard/client/commands.ts:29-70` declares client-local start-plan request/response schemas
  with generic strings and `unknown[]` submissions.
- `src/server/dashboard/commands/start-plan-service.ts:38-75` independently declares stricter domain
  schemas. A comment says the client mirrors a server-owned shape, which is exactly the drift-prone
  arrangement the shared-wire architecture is meant to prevent.

Required outcome:

1. Move start-plan ingress and response wire schemas to one shared owner under
   `src/domain/dashboard/`.
2. Infer request/response types from that owner and import them from both client and server.
3. Retain strict objects, domain ID/fingerprint/instant schemas, defaults only at the server ingress
   boundary, and the rule that omitted-step facts never echo back.
4. Delete the duplicate definitions; do not introduce a compatibility adapter unless an existing
   caller proves it is necessary.

Regression proof: architecture/duplicate-wire guard, client preflight rejection of malformed input,
server acceptance of the shared shape, and a compile-time/types test for the exported contract.

### P2 — Direct owner tests are missing at several wiring seams

Add these while touching their owning units, not as an isolated mock-only sweep:

- Execute the production `runCli` dashboard registration path in `src/cli.ts`; current runtime tests
  inject a fake composer and do not prove the entrypoint wire.
- Invoke the actual middleware installed by `vite.dashboard.config.ts`, including valid nonce, absent
  nonce 404, and unrelated path/method pass-through. Isolate modules because configuration captures
  environment at module load.
- Decide whether the shared client transport should explicitly attach the base Origin on guarded
  mutation requests for Node/fake portability. Browser requests supply Origin, but current fakes do
  not prove the production admission header. Server enforcement is mandatory regardless of this
  choice.
- Add generation/hash transition coverage in subscription tests.
- Add the terminal-error hook test named above.

### P3 — Documentation currently describes retired or nonexistent surfaces

Reconcile after behavior lands so documentation describes the final state:

- `src/dashboard/AGENTS.md` still claims `capture.html` and `phone/` exist, although D294 retired
  mobile/phone capture. Update its `CLAUDE.md` twin byte-identically if both are present.
- `src/dashboard/DESIGN.md` says the Vite config has three inputs; it currently has two (`index` and
  `kit`).
- `docs/rebuild/reference/frontend-backend-integration.md` still describes the retired mobile capture
  bundle/nine routes as implemented and has a stale “Left” list. Preserve diagnostic screenshots,
  run Capture tiles, receipts, Archive evidence, and intake; remove only retired phone/mobile claims.

### Planned, separate unit — production dashboard static-byte path

This is a known plan gap, not a newly discovered regression. The owning reference already records
that `npm run dashboard:prod` passes `--prod`, `runtime-composition.ts` only consumes the command
position, and the BFF has no static handler for `dist/dashboard`.

Implement this as a separate unit after the P0/P1 correctness work:

1. Parse `--prod` explicitly and pass mode to composition.
2. Serve the built dashboard from `dist/dashboard` in production mode while preserving API/events/
   artifact routing.
3. Pin traversal rejection, asset content types, cache behavior, SPA fallback, missing-build failure,
   and API precedence.
4. Do not use Vite preview as the production server; Vite itself documents preview as a local build
   preview.

### Optional performance unit — one snapshot per day/cursor

`dashboard-stream.ts:130` currently rebuilds a day snapshot once per subscriber on a count-bearing
snapshot change. Group subscribers by day, build one immutable envelope for each distinct day/cursor,
and fan it out only if a benchmark/call-count test shows worthwhile duplication. This is lower
priority than backpressure and correctness and may be deliberately deferred.

## Recommended implementation/run plan

Do not land one catch-all dashboard commit. The safe dependency order is:

1. **Ingress admission:** start-plan and intake guard behavior, red tests, implementation, authority
   inventory, and owning documentation in one logical unit. Treat advisory admission as a separately
   stated decision or subunit.
2. **Runtime lifecycle:** explicit async ownership, signal tests, real CLI registration smoke, and
   graceful-stop proof.
3. **Client stream correctness:** duplicate/older cursor handling and rejection classification, with
   state/hook coverage. Invoke `/ui` only if rendered behavior changes.
4. **Server stream pressure:** bounded queue/reset semantics and slow-client tests. This is the most
   design-sensitive unit and should receive a consequential correctness review.
5. **Shared start-plan contract:** move schemas, delete duplication, update boundary guards/tests.
   Land after admission unless moving the schema first materially simplifies those tests.
6. **Remaining wiring tests:** actual Vite owner middleware, transport Origin decision, generation
   transitions.
7. **Documentation reconciliation:** dashboard AGENTS/CLAUDE twin, DESIGN, and owning reference.
8. **Production-byte path:** execute as its own planned feature unit with static-serving security
   tests.
9. **Snapshot fanout optimization:** benchmark first; implement or record explicit deferral.
10. **Independent `/review`:** correctness, silent failure, security, tests, docs, and performance;
    then final full gates and integration cleanup.

For every feature unit, update/remove its tests and the nearest applicable AGENTS/CLAUDE guidance in
the same logical commit as required by repository policy. Stage exact paths only; never `git add -A`
or `git add .`. Run units in non-overlapping worktrees only under the recorded `/supervise` lifecycle,
merge in dependency order, verify a clean tree, and sweep registered/physical worktrees and branches.

## Gate matrix

Run focused red/green tests for each unit, then its required structural gates:

| Unit | Focused proof | Additional gate |
| --- | --- | --- |
| Ingress | BFF route/admission and no-body/no-effect tests | `npm run test:architecture` |
| Lifecycle | runtime-composition, CLI entrypoint, child-process shutdown | typecheck + lint |
| Client stream | subscription, reducer, hook state | parity only if visible UI changes |
| Server stream | hub, route, Node adapter slow-consumer/cancel | typecheck + lint |
| Shared schema | client/server start-plan + wire-boundary guards | `npm run test:architecture` |
| Vite/transport | actual config middleware + transport headers | typecheck + lint |
| Docs | twin equality and doc/reference assertions | `npm run roadmap:check` only if roadmap source changes |
| Production bytes | prod CLI/static handler/security/asset tests | `npm run web:build`; parity if rendered output changes |

Final gate, run without a concurrent compiler/linter/coverage process:

```bash
npm run typecheck
npm run lint
npm run test:coverage
```

Run `npm run test:parity` if any `.tsx`, CSS, visible state, or rendered asset changes. Run
`npm run build:manifest` only if a descriptor import closure changes. Run `npm run roadmap:check` if
roadmap source or generated site changes. A focused rerun does not erase a full-gate failure.

## Baseline verification already completed

At review commit `211413a8`:

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- Focused dashboard/runtime gate — 6 files, 215 tests passed:

```bash
npx vitest run \
  tests/unit/runtime-composition.test.ts \
  tests/unit/server/dashboard-http-server.test.ts \
  tests/unit/server/bff-flow.test.ts \
  tests/unit/dashboard/client-transport.test.ts \
  tests/unit/architecture/wire-connectivity.test.ts \
  tests/unit/architecture/dashboard-wire-boundary.test.ts \
  --reporter=dot
```

- `npm run test:architecture` — 71 files, 698 tests passed in 46.46 seconds.
- Final `git status --short` and `git diff --stat` were empty; HEAD was unchanged.
- No parity/visual run was performed because the work was a read-only wiring review.

These green gates are a baseline, not evidence that the untested runtime behaviors above are safe.

## Resume verification commands

```bash
git status --short --branch
git rev-parse HEAD
git log --oneline -5
git worktree list --porcelain
git diff --check
rg -n 'operatorMutationIngressGuard|/api/v1/start-plans|/api/v1/intake/files|/api/v1/runs/:runId/advisory' src/server/dashboard/routes/api.ts
rg -n 'stream.done.then|lastCursorNumber|controller.enqueue|#maxPending|compose\(input.isolation\)' src/dashboard src/server/dashboard src/core/runtime-composition.ts
```

If HEAD moved, inspect the intervening commits and revalidate each cited seam before implementing;
do not mechanically apply this plan to superseded code.

## Open decisions and recommendations

1. **CLI lifecycle shape.** Recommendation: explicit async ownership at the CLI/runtime boundary,
   after inventorying every caller; do not add another detached process-global callback.
2. **Advisory admission.** Recommendation: guard it because it spends a constrained provider and
   records metering, but first ratify the classification in its owning contract.
3. **Explicit Origin from the client transport.** Recommendation: keep server-first validation and
   make test/Node behavior explicit only if the transport API can do so without contradicting browser
   restrictions. Do not weaken the server for a fake transport.
4. **Backpressure owner.** Recommendation: one bounded queue policy in the hub/connection abstraction,
   drained by Web Stream demand; overflow becomes reset-required, never silent loss.
5. **Snapshot fanout.** Recommendation: benchmark/call-count first and defer if immaterial.
6. **Production static bytes.** Recommendation: separate supervised unit after admission, lifecycle,
   and stream correctness, because its security and cache rules deserve an independent review.

None of these decisions authorizes broader dashboard redesign, changes to the ONE projection,
reintroduction of D294 mobile capture, or service of the intentionally pending `review`, `people`, and
`context-evidence` wire arms in `config/pending-wire-bindings.json`.

## Suggested skills on resume

- `/supervise` for the multi-unit implementation and its required recorded worker lifecycle.
- `debug --fast` only after establishing the exact red command for a known-cause seam.
- `tdd` after confirming the test seams with the operator; likely seams are admission, lifecycle,
  subscription, and slow-consumer bridge.
- `/ui` for any user-visible error-state or rendered dashboard change.
- `/review` after integration and before declaring the wiring complete.
- `/handoff` again if work pauses before the findings are durably resolved.

## Paste-ready resume prompt

Read `docs/handoffs/2026-09-02-dashboard-wiring-remediation.md` and the owning dashboard references,
then verify git/worktree state and every cited seam before editing. Resume at P0 mutation admission,
execute the numbered units through an explicitly invoked `/supervise` run, preserve the existing
React → typed client → BFF → authority/projection → SSE architecture, and do not treat the known
production-byte-path gap or pending wire arms as surprise regressions.
