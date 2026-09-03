# R3b u15 — worker, session, lease, and concurrency audit

## Scope and retained ownership

The audit at base `18e5294de0b07f147349a2d62edcc6a5728fcf15` covers 19 files / 277
cases. The focused R3b worker/session family is 10 unit files / 238 cases; nine adjacent
claim/architecture files / 39 cases are retained as cheaper or cross-cutting controls rather than
counted twice as R3b implementation tests.

| File | Cases | Unique risk / oracle | Disposition |
| --- | ---: | --- | --- |
| `tests/unit/worker-loop.test.ts` | 74 | Direct loop claim, heartbeat, directive, pool-ack, and phase-1 compatibility semantics | retain |
| `tests/unit/worker-sessions.test.ts` | 23 | Exclusive driver leases, fingerprint identity, abort/fence behavior, poison-close, and bounded acquisition | retain |
| `tests/unit/worker-composition.test.ts` | 33 | Worker boot/settings admission, process record, claim recovery, graceful stop, and CLI composition | retain |
| `tests/unit/browser-session-factory.test.ts` | 11 | Profile isolation, full Chromium/Duo admission, credential redaction, authentication proof, and close proof | retain |
| `tests/unit/duo-ceremony-lease-store.test.ts` | 5 | Credential-keyed lease generation, live-holder refusal, expiry takeover, and unforgeable token | retain |
| `tests/unit/duo-ceremony-gate.test.ts` | 9 | Two-worker ceremony serialization, named waiter refusal, one fresh-profile recovery, and release failure | retain |
| `tests/unit/duo-sign-count.test.ts` | 5 | Monotonic WebAuthn sign count across profiles sharing one credential | retain |
| `tests/unit/server/worker-supervisor.test.ts` | 54 | Deterministic process state machine: birth, crash, signal escalation, uncertainty, roster pre-scan, and close | retain |
| `tests/unit/server/worker-pool-composition.test.ts` | 17 | Real kernel pool door, command basis/CAS behavior, durable lease directives, and dashboard shutdown ordering | retain + fix |
| `tests/unit/server/worker-pool-parallel-proof.test.ts` | 7 | C12 real-child/PID/lock/HTTP proof, same-workflow FIFO, cross-workflow overlap, typed ENOENT, and orphan-free teardown | retain + fix |
| `tests/unit/claim-sweep-recovery.test.ts` | 7 | D118 attempting-intent recovery before any requeue; adjacent R2 write-recovery owner | retain adjacent |
| `tests/unit/architecture/authentication-proof-not-url.test.ts` | 5 | Authentication content proof cannot degrade to URL success | retain guard |
| `tests/unit/architecture/bounded-task-deadline.test.ts` | 2 | Long task/session waits remain explicitly bounded | retain guard |
| `tests/unit/architecture/driver-lease-boundary.test.ts` | 5 | Driver access cannot bypass the typed session lease | retain guard |
| `tests/unit/architecture/duo-ceremony-lease.test.ts` | 5 | Duo helpers cannot bypass the one lease owner/token route | retain guard |
| `tests/unit/architecture/fresh-session-boundary.test.ts` | 5 | Authored fresh boundaries prove close-before-open | retain guard |
| `tests/unit/architecture/multi-worker-overlap.test.ts` | 4 | C1–C4 sampled durable claim overlap and lost-claim behavior | retain guard |
| `tests/unit/architecture/single-flight-login.test.ts` | 2 | Login construction remains single-flight | retain guard |
| `tests/unit/architecture/worker-teardown-soak.test.ts` | 4 | C5–C8 stop/recovery, teardown exclusion, aggregate close failure, and bounded fleet soak | retain guard |

The source of truth is `docs/rebuild/reference/execution-and-sessions.md` §§7.1 and 11. The matrix
there deliberately separates direct loop rows C1–C8 from C12's composed real-process proof.

## Active-5174 red / green

An owned rebuild dashboard was started from the primary checkout because the coordinator worktree
has no local `.env`. It listened on backend PID 59949 / `127.0.0.1:3938` and frontend PID 59931 /
`127.0.0.1:5174`.

Red command before the fix:

```text
npx vitest run --project unit tests/unit/server/worker-pool-composition.test.ts \
  tests/unit/server/worker-pool-parallel-proof.test.ts --reporter=verbose

Test Files  2 failed (2)
Tests       2 failed | 22 passed (24)
both failures: dashboard preflight refused startup: ports.available: reserved port ownership is
invalid for frontend 5174 (owner-proof-unconfigured), compose.ts:1272
```

Both fixtures already set `backendPortOverride: 0` but omitted the paired test-only
`frontendPortOverride: 0`. Commit `4691ff0e` adds that literal override to only the two composed
shutdown tests. The production `rebuildRuntimeIsolation` contract remains 3938/5174.

Green command under the same listeners:

```text
npx vitest run --project unit tests/unit/server/worker-pool-composition.test.ts \
  tests/unit/server/worker-pool-parallel-proof.test.ts --reporter=verbose

Test Files  2 passed (2)
Tests       24 passed (24)
Duration    3.21s
```

The complete focused family also passed under the occupied ports: 10 files / 238 cases in 4.80s.
Commit `72ff492e` adds stable `startup`, `spawn-and-birth`, `graceful-stop`, `shutdown`, and
`teardown` begin/complete markers to the long W5 proofs; verbose output still supplies project,
file, and complete behavior/refusal titles.

## Cleanup-time ENOENT classification

The R3a broad diagnostic reported an artifact-reader `ENOENT` after the two preflight failures.
The exact worker-composition red case was repeated 20 times while 5174 was occupied: every run
failed only at the expected port preflight and none emitted an artifact-reader or cleanup ENOENT.
The fixed 10-file family and the 393-file full coverage run likewise emitted no unexpected ENOENT
and no `afterEach cleanup failed` aggregate. Source inspection shows the artifact reader is created
before initial preflight, but has no background operation in either shutdown test; preflight's
failure arm closes the hub/timers/supervisor/database/lock itself before throwing.

Therefore the prior line cannot be reproduced as a worker-owned reader cleanup defect. The only
demonstrated cause in the failing worker paths was premature composition refusal on the occupied
frontend port; once both tests use their owned ephemeral preflight probe, the secondary line
disappears from focused and full execution. This records the narrower evidence instead of adding a
catch, retry, timeout increase, or speculative artifact-reader change.

## Leak proof

After focused and full gates: no `worker-stub-cli` process referenced this worktree; no
`hrauto-worker-pool-*`, `hrauto-w5-*`, or `hrauto-shutdown-*` temp root remained; no run-worktree
process lock remained; and the same dashboard PIDs still owned 3938/5174.
