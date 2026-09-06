# Task 6 · Manage worker pools and run sessions
<!-- roadmap: parallel-runs -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: parallel-runs -->
- [x] BE the worker pool — N workers per workflow, spawned and stopped from the dashboard: the W4 Session Panel controls over the W3 supervisor's real spawn, live-exercised end to end 2026-08-26 (plan 2 → spawn ×2 → replacement spawn ×2 → stop ×2, `docs/rebuild/migrations/separations.md` §9.27)
- [x] BE pool-indexed worker ids — the CLI requires a positive pool index, derives a stable id, and authority refuses duplicate ownership of that index
- [x] BE the projection serves a worker-POOL version — `worker_pools` (schema v17) is the CAS basis `spawn-worker`/`plan-worker-count` cite (0 for an unplanned workflow); the kernel refuses a stale one by name before the runtime seam; the day wire serves `workerPools[]` (`93b7b18e` · `b4f30ea0` · `24b04dfa`, D269)
- [x] BE a durable session record and its grouping — `run_sessions` (insert-only, member-less), written by every fan-out before its first member; membership is `tasks.session_id` / `runs.listBySession`; a retry inherits; the queue row serves `session` (`93b7b18e` · `57f2bb9c` · `24b04dfa`, D269)
- [x] FE the session view — worker cards show authority membership and what each worker is doing; groups exact queue-row session ids, joins the claiming card by exact `runId`, preserves absent reasons and distinguishes declared pool size from non-terminal authority worker cards (`97a55b07`)
- [x] PROOF two separations dry-run scenarios in parallel, recorded — LIVE 2026-08-26: docs 4502 (preview terminal, gate approved through the ceremony, resumed by the OTHER pool member) and 4495 (the genuine S7 refusal) simultaneously `running` for 29.7 s on `separations-worker-1`/`-2` under one D269 session, all ceremonies lease-serialized, 0/0/0 write rows (`docs/rebuild/migrations/separations.md` §9.27; ref execution-and-sessions §7.1 C12 live-extension note in the same commit) — still open beyond this node: the two-full-chain-preview variant awaits a second past-dated subject (§9.27 §1; doc 4495 unlocks 09/02), and the T1b canary gate (doc 4537, ≥2026-08-28) is unaffected
> 2026-08-20 | docs-cohesion 03a | the kernel command arms exist and are validated (src/core/command-kernel.ts:95) while createDashboardWorkerSupervisor refuses spawn by name (src/server/dashboard/compose.ts:322) and the FE has no Add-workers control for the CAS reason quoted in src/dashboard/surfaces/shell.tsx:1036
> 2026-08-21 | parallel-runs P12 | the authority half landed (D269) — ref execution-and-sessions §11 points 1 and 5 carry the as-built; left: the pool process (spawn + pool-indexed ids), the FE session view, the parallel proof
> 2026-08-25 | parallel-runs P3 | pool-indexed identity landed — `worker <workflow> --pool-index N` validates a positive N, derives `<workflow>-worker-N`, and starts authority under that exact lease id; distinct indices retain distinct lease rows and duplicate N is refused. Left: the real dashboard process supervisor, FE session view and parallel proof
> 2026-08-25 | parallel-runs P3 review | the CLI/identity seam admits concurrent workers through per-start records while D181 atomically admits the singleton server, reserves generation 1 for never-run, binds ownership to PID + OS process birth (Darwin normalized to C/UTC epoch seconds), and holds exclusive restore admission through staged-byte verification and swap; unproven WAL/SHM rollback is explicit companion-state-uncertain. This does not build pool supervision, FE or the parallel dry-run proof
> 2026-08-25 | parallel-runs P4 | the FE session view is built from the D269 day wire (`97a55b07`): every present `QueueSurface.session.sessionId` groups membership, `WorkerCard.currentRun.runId` joins the current worker, and an absent arm keeps its served reason; no process control was added. Left: the pool process and the parallel proof
> 2026-08-26 | parallel-runs PROOF (W6) | the live two-worker pass closed the node (§9.27): pool planned+spawned+stopped from the Session Panel, two dashboard-started composed dry runs concurrently running, the D267 waiter refusal and D214 cross-worker park+resume both live. Findings NAMED there, not fixed: the Duo preflight proves the wrong credential file for a fresh worktree; macOS timer throttling starves an idle spawned worker's heartbeat until a peer's sweep stops it; a cold system's first `plan-worker-count` is unreachable from the panel; the start-result list's duplicate React key `run`; the open panel's worker card does not follow the day stream
<!-- /roadmap-status -->

**A session is a dashboard-started group of N runs.** Every workflow follows the same
browser-profile recipe, and every worker owns its own profile INSTANCE — Chromium locks a profile
directory, and `ref execution-and-sessions` §1's `(worker, system, instance, configFingerprint)`
partition is what keeps them apart. N workers per workflow, spawned and stopped from the dashboard;
today the runtime starts one process per workflow, so the pool is the build.

**Coordination is through AUTHORITY only, never peer messaging.** Workers know what the others are
doing through run claims, session leases, write fences and the concurrency matrix
(`ref execution-and-sessions` §7.1). Sessions never share information with each other. This is not a
style preference: a claim is the one statement a process may make about ITSELF that another process
can trust, which is the same argument D200 used when it made a won lease — not a heartbeat age —
the evidence that a stale claim is orphaned.

**What is already true, and what the seam actually needs.** _(D269, 2026-08-21: the CAS basis and
the session record this paragraph asks for are BUILT — `worker_pools` and `run_sessions`, schema
v17; ref execution-and-sessions §11 points 1 and 5 are the as-built. The paragraph below is kept as
the record of why.)_ The command arms are real and composed:
`plan-worker-count`, `spawn-worker`, `stop-worker`, `pause-worker`, `resume-worker` all carry
schemas, authority validation, the journal and typed refusals (`src/core/command-kernel.ts:95`). Two
things are missing and only one of them is obvious. The dashboard's `WorkerProcessSupervisor` throws
by name — *"the dashboard process does not launch browser workers; start worker X with
`npm run cli worker <workflowId> --pool-index <positive-int>`"* — which is a correct refusal rather
than a stub, so no acknowledgement can claim an effect that did not happen. D269 now serves the
pool's exact CAS version in `workerPools[]`; the frontend still has no `+ Add workers` control
because the supervisor refuses the process effect, not because the client lacks a CAS basis.

**The identity path is now as-built (2026-08-25).** The worker CLI requires an explicit positive
`--pool-index`; composition derives the stable worker id from it and uses that id for the loop,
browser-profile partition and authority lease. There is no default index. The dashboard process
supervisor that will assign and launch N members remains unbuilt.
Worker process starts append independent durable lock records, so distinct members coexist and
duplicate identity reaches the authority lease; D181 still observes them through one strict
aggregate restore arm. The adjacent restore interlock atomically admits singleton roles and binds
current ownership to OS process birth, so neither contention nor PID reuse can make that arm report
a false stopped/live state. Its never-run generation is reserved, so the first start/release fences
an earlier proof; Darwin's normalized start token retains an honest one-second resolution limit.

**Done looks like** a pool that spawns and stops from the dashboard against a real CAS basis, a
durable session record the worker cards read their membership from, and TWO separations dry-run
scenarios running in parallel and recorded — which is also the end-to-end tier's first exercise and
what `{#workflow-authoring-core}` reads as its parallel case. It needs the Duo lease first.
