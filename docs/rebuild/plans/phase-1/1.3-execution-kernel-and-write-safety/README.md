# Phase 1.3 · Execution kernel and write safety

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## 1.3 · Execution kernel and write safety
<!-- roadmap: p1-kernel -->

### Task 1 · Build registry, workers, and command admission
<!-- roadmap: p1c-execution -->

Owns the workflow composition root, plan admission, queue claim/heartbeat/retry, provider budgets,
failure/result authority, and exhaustive command dispatch.

### Task 2 · Build sequenced write authority
<!-- roadmap: p1c-write-safety -->

Owns probe → prepare → binding proof → fence → commit → proof → atomic authority publication.

### Historical combined implementation record

<!-- roadmap-status: p1-kernel -->
- [x] the ONE `WORKFLOW_MODULES` composition root above workflows — every registry derives from that single tuple (`src/control/workflow-registry.ts`)
- [x] exact raw + canonical start plans and atomic consumption (D109, schema v6) — the ingress retains what an operator SUBMITTED beside the canonical snapshot, so a default or a transform can never erase it
- [x] one-item claims with unfinished-write recovery BEFORE requeue (D118), verified-neutral navigation and explicit fresh-session boundaries keyed by config fingerprint (D116/D117), and the required non-no-op provenance collector (D115)
- [x] minimal durable `FailureRecord` and terminal `RunResultRecord` under a strict pre-terminal authorization (D110/D114, schema v7→v8); the exact strict failure record is in non-rebuildable authority for every failed task and run, its `failureId` associated atomically with the failure transition
- [x] D112/D119 generic provider admission and fixed-window budgets (schema v9, 2026-08-03) — reserve before I/O, reconcile only on a strict measured result, retain the maximum on any uncertain outcome
- [x] ONE exhaustive command kernel with the Phase-1 arms active and later arms typed `capability-unavailable` (D113); the arm partition is checked against the D95 registry in BOTH directions at module load, so an action neither list carries — or both — throws before any command can dispatch (`src/core/command-kernel.ts`)
- [x] the write sequencer's beats ①–⑦ — probe → prepare → binding proof → fence → commit → proof → the one checkpoint/run/outbox transaction (D111); `write-safety-contract` is active and asserts durable ABSENCE over a real database (D188)
- [x] D120 — a session's authentication is a CONTENT-level proof, never a URL; live-verified on ucpath (~17 s) and crm (~12 s) including a real Duo ceremony
- [x] D75 — one BFF admission checkpoint derives only the strict configured solo actor; every schema-valid command `requestedBy` claim must match before handler effects (2026-08-29)
- [ ] the bulk `all-or-none` mode is declared and refuses `capability-unavailable` (D235) — owner `ref:frontend-backend-integration` §3.4
- [!] `supersede-active` is implemented in the kernel, unanticipated by the planner, and reported to the operator as unimplemented — three sites, two answers; owner `ref:dashboard-surfaces` §2.4
> 2026-08-29 | D75 authority close | verified the one admission checkpoint and command-claim match against the BFF route registry; left: the two lines above, both owned in reference docs

<!-- /roadmap-status -->

**COMPLETE 2026-08-04 — the core registry, workers, checkpoints, the command service and the write
sequencer.** This is the item that turned a set of contracts into a runtime, and it is the one
whose decisions (D109–D120) the rest of the program still runs on.

**The composition root.** `src/control/workflow-registry.ts` holds the ONE `WORKFLOW_MODULES` tuple
every registry derives from — the descriptor list, the store bindings, the start surfaces. A second
registry cannot exist because there is nowhere else to declare one.

**The interpreter never tracks a run version locally.** Heartbeat renewal bumps the version
concurrently with node transitions, so each transition re-reads the current row and CASes with the
constant claim token; a conflict then only ever means real ownership loss, and the worker abandons
rather than terminalizing over it. Entry validation runs in `validating` before any browser and
aggregates every problem into ONE no-node `FailureRecord`. `always-rerun` nodes structurally never
reach `loadCheckpoint`; replayed nodes emit no spans; a replayed checkpoint's exact stored record is
what terminal evidence reuses. Every task invocation races a mandatory injected monotonic deadline,
so a signal-ignoring driver cannot hold the worker.

**Terminal authority binds its consequence.** A failed run is settled only with the exact existing
`FailureRecord`; a done run only with a strict schema-bound `RunResultRecord` plus a pending
`run_terminal_outbox` row. Both validate the current run identity, version and claim, and write
every durable row and the terminal CAS in ONE outer authority transaction. Result dependencies come
from a factory-authenticated terminal view and retain either the exact checkpoint identity, output
and provenance digests and fingerprints, or a CLOSED `not-run` reason for a conditional node — never
a silent omission. The initial success path additionally carries the descriptor factory's
unforgeable in-process seal: a schema-valid caller-built result is not authority.

**The write sequencer owns beats ①–⑦ and is the sole `MutationCapability` mint.**
`src/core/write-sequencer.ts` sits behind the interpreter's seam; the capability is runtime-
unforgeable through a module-private WeakSet, and `task-driver-boundary` allowlists exactly that
file. Beat ⑦ is one outer authority transaction over run-claim revalidation, the Phase-1c four-row
primitive (nested savepoint), the `TransactionOutcome` checkpoint and the run transition.
Post-fence uncertainty parks intent-first, then the run; PRE-fence indeterminacy refuses with zero
fence and zero click. Dry-run is a separate `executeDryRun` arm — `executeTransaction` with
`dryRun` refuses loudly.

**D120 is the decision most worth re-reading.** A live UCPath login smoke had passed in ~3 seconds
having authenticated nothing: the recipe matched a host SUBSTRING, so the PUBLIC portal read as the
application. Every browser system now declares a verifier proving TWO independent facts — a
server-issued session artifact (`PS_TOKEN` for UCPath, `sid` for CRM) and the ABSENCE of every
sign-in form — and `defineVerifiedLoginRecipe` runs it after the flow on every return path,
including the neutral reset. A URL may be a necessary precondition; it is never the conclusion.

**Two decisions after Phase 1 fixed the recovery half without re-opening the contract.** **D200** —
a recovery mechanism that lives inside the thing it recovers cannot recover the thing it lives
inside: the D118 sweep runs in a RUNNING worker's maintenance ticker and is staleness-gated, so a
worker whose loop threw restarts and inherits its own fresh-heartbeat claim, wedged. The fix is that
the LEASE is the evidence — `workerLeases.start` succeeding proves no other process answers to this
id — so the sweep request grew a `workerId` scope rather than a widened `staleBefore`. **D218** —
the BFF's projection was fed by an in-process `onEvent` hook on its own span writer, which is a
single-process assumption wearing a cross-process contract; that one is 1g-spine's and is recorded
there.

**Guards standing at this step:** atomic plan-consumption crash and conflict tests; command
idempotency plus typed-unavailable zero-side-effect cases; one-active-item-per-worker;
recovery-before-requeue; exact config-key session reuse; the neutral-reset and fresh-boundary proof;
live and derived provenance completeness; result and failure authority integrity; no visible-root
fallback; dry-run commit-free; binding mismatch or unknown creating zero fence and zero click;
provider admission; the full beat-⑦ crash tests; and `authentication-proof-not-url`.

**What is LEFT on this node** is two filed items. The bulk `all-or-none` mode is declared and
answers `capability-unavailable` (D235). And
`supersede-active` has three sites giving two answers — implemented in the kernel, unanticipated by
the planner, reported to the operator as unimplemented — filed in `ref:dashboard-surfaces` §2.4
rather than fixed in a docs pass.
