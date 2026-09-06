# Task 3 · Cut over executor and worker lifecycle writers
<!-- roadmap: p1f-run-writers -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**Seam:** `src/core/run-record-service.ts`, `worker-loop.ts`, `run-executor.ts`,
`write-sequencer.ts`, `worker-sessions.ts` only where its existing lease boundary needs wiring, and
`src/server/worker/compose.ts`; also `src/core/write-recovery.ts` only for the shared
`executeSequencedWriteCommit()` continuation callers and `src/server/dashboard/compose.ts` only
for their service-port injection. Claim, heartbeat, worker transitions, terminalization and the recovery
sweep's `requeue` pass through one worker-owned service port; the loop, executor, sequencer and sweep
hold no lifecycle repository mutator. The executor keeps only its required read/evidence ports and
terminalizes through the worker under the claim fence; the 2026-08-25 fenced-write lesson,
`retainAfterFence()`, diagnostic-bundle atomicity and `span.ended`-after-commit ordering remain unchanged.
The worker also owns its half of §D330.11 #27: honour `cancelRequested` at the next non-fenced boundary,
never interrupt a retained fenced callback, and let recovery settle that request as `terminal/cancelled`
rather than requeueing it. The shared settlement helper also serves positive write recovery and
operator `resolve-write-present`; its `resume-queued` arm uses a separate, narrow command/recovery
continuation port backed by the existing `RunRecordService.transition`, carrying `writeResolution`,
`expectedVersion` and `startAt`. This port preserves the caller's existing admission and authority;
it grants no command operation to the worker port. Both arms retain one outer authority transaction.
**Does not touch:** the command kernel, `run-fan-out.ts`, dashboard command
publication or intake/capture creation (all Task 4); config consumers (Task 5); SQL schema/migrations,
the closed D330 operation set, downstream projections or UI. Existing request/interface schemas may
change only as needed to expose those admitted operations without adding one. **Owes:** §D330.11 #4–#7,
#9 and #10 through the real worker composition plus the worker/recovery half of #27; existing worker,
executor, sequencer and dry-run suites re-pointed with stable run/session/evidence identity byte-identical.
**Deletion test:** `worker-loop-writes-only-through-the-service` — a red-capable spy/structural oracle
that fails while the loop, executor, sequencer, composition or recovery sweep can call a lifecycle
repository mutator directly, including either arm of the shared settlement helper and the admitted
continuation adapters. Moving the direct call to another helper does not satisfy the oracle.
**Order:** third, after both wave-2 peers are effectively integrated.

- [x] Route claim, heartbeat, executor transitions, recovery requeue, cancellation settlement and
  terminal publication through the run service without changing stable run/session/evidence identity.
- [x] Guard or remove direct core-runtime lifecycle writes outside the service; preserve D118's
  attempting-write recovery admission, immutable attempt/claim-generation identity,
  `retainAfterFence()` and `span.ended` only after terminal commit (§D330.4, §D330.9).

#### Approved focused-session plan (2026-09-05)

**Approval and feasibility correction.** The operator approved this assignment on 2026-09-05.
D330.10 assigns `create` and command-family mutations to the command kernel while assigning
`claimNext`, `renewClaim`, `workerTransition`, `terminalize` and recovery `requeue` to the worker.
The earlier Task-3 sentence both excluded the command kernel and assigned its start/intake creation
work here. This plan resolves that contradiction: Task 3 owns the worker lifecycle seam above;
Task 4 owns start/intake/capture fan-out creation and the shared `run.queued` publication. Task 3
implements the worker/recovery half of #27 so Task 4 can prove the complete operator-command/tree/
projection behaviour without reopening the worker seam. No reference contract changes.

**Approved shared-settlement amendment (2026-09-05).** Step-1 inspection at `e8d0fd54` found
`executeSequencedWriteCommit()` in `write-sequencer.ts` serves both the claimed worker's
`advance-running` arm and `write-recovery.ts`'s positive-recovery/operator-resolution `resume-queued`
arm. The latter calls `runs.resume()` directly; leaving it fails the assigned deletion oracle, while
routing a parked-write continuation through worker `requeue` would change the admitted operation.
The operator approved the minimal shared-helper adaptation: Task 3 may adapt those two continuation
callers, their interface types and focused tests, and dashboard composition's service-port injection.
The helper receives only the narrow capability for its selected arm: worker `workerTransition` for
`advance-running`, existing command-owned `transition` for `resume-queued`. The command/recovery
caller retains proof, actor, target and version admission; the helper does not mint that authority.
Use the same `AuthorityDatabase` as the caller's outer transaction. Derive domain-separated lifecycle
command ids so a kernel product-command id cannot collide with its nested lifecycle journal entry;
retries retain the same identity and divergent requests remain refused. No new lifecycle operation,
SQL schema/migration, reference contract or UI change is admitted. `command-kernel.ts`, unrelated
write-recovery/resolution paths (including `resolveAbsent`), settings consumers and command publication
remain excluded. Task 4 consumes this shared-helper adaptation and owns the remaining command cutover.

The initial supervisor verified the prerequisites and created then removed the untouched assigned
worktree/ref at `e8d0fd54`; no implementation, gates or independent review occurred. This amendment
resolves that recorded scope blocker. Revalidate prerequisites before resuming; do not treat the
inspection as implementation acceptance.

**Operator-approved recovery-read amendment (2026-09-05).** Step-1 inspection proved that
run-based intent enumeration can miss a same-item attempting intent which the existing D118 sweep
detects. The operator authorized one strict, transaction-safe read-only
`writeIntents.listAttemptingByItem({ workflowId, itemId })` method in
`src/infra/sqlite/authority-database.ts` and focused tests. This preserves the existing
workflow/item/status scan, deterministic ordering and fail-loud parsing without a migration,
new lifecycle operation or contract change. Base/worktree: `7e2b7607`,
`codex/phase-1-6-run-writers`, `/Users/julianhein/Projects/hr-worktree-run-writers`.

**Verified prerequisite and current state.** Accepted Task 2-1 and completed Task 2-2 are both ancestors
of `master`. Task 2-2 was restored on `master` with full integration gates passing. The original Task-3
plan commit `f34c9021` is an ancestor of `master`; the resume base must also contain the
commit recording this approved shared-settlement amendment. Current worktree inventory is one primary checkout;
the proposed branch/path were absent when planned. Recheck SHA ancestry, path/ref availability and the
four-worktree budget at supervisor start. Never recover Task 2-2 inside this assignment.

**Implementation sequence.** One supervisor performs these stable steps in order:

1. Verify the restored Task-2-2 prerequisite, approved plan content, assigned branch/worktree and owned
   seams, including this approved amendment. Inventory every production lifecycle mutation reachable
   from worker composition and both shared-settlement callers; identify the acceptance/proof matrix
   before implementation. Establish synthetic authority/runtime roots only.
2. Introduce one narrow worker lifecycle port backed by `RunRecordService`. Give executor/sequencer only
   their required read/evidence ports; derive stable lifecycle command identities and map every typed
   refusal without converting `lost`, `runtime-stale`, `none-eligible` or `heartbeat-live` into success.
   Define the separate command/recovery continuation capability for the shared helper, with stable,
   domain-separated lifecycle identities; do not expose `transition` on the worker port.
3. Compose the service in `src/server/worker/compose.ts`. Preserve the durable directive recheck and full
   runtime token inside claim admission; route claim and heartbeat through the service without widening
   the worker's one-active-item rule. Inject the continuation service port into the existing dashboard
   write-resolution composition over the same database; leave command dispatch and admission unchanged.
4. Put startup/global recovery mutation behind the service's existing `requeue` operation. Preserve the
   self-sweep proof, stale-heartbeat admission, D118 attempting-write check and park/refuse split in the
   same authority transaction; a recovery race must return its typed refusal and an attempted cancel must
   settle cancelled, never queued.
5. Route executor and write-sequencer worker state changes and terminal composites through the worker
   port. Adapt the shared helper's positive-recovery and operator-present continuation callers to the
   separate `transition` port, preserving `writeResolution`, CAS and `startAt`. Keep both helper arms'
   write/checkpoint/outbox/lifecycle/journal settlement in one outer transaction; any refusal must unwind
   prior evidence writes rather than return a successful partial composite. Keep result/authorization
   and prepared diagnostic-bundle settlement atomic; emit run `span.ended` only after an applied or
   exact-replay terminal settlement commits, respecting the outermost transaction. Honour
   `cancelRequested` only outside the one-way fenced window; retained callbacks finish uninterrupted.
6. Complete and self-audit the proof matrix developed alongside Steps 1–5 and the intended-red
   `worker-loop-writes-only-through-the-service` oracle. Run the focused and repository gates, commit the exact candidate and record `awaiting independent review`
   without marking Task 3 complete.

**Acceptance and disproof.** Map #4–#7, #9 and #10 to production-composed tests, not direct repository
fixtures: competing composed workers yield one claim winner; stale runtime claims write nothing; an
expired claim requeues once while the zombie loses; a live heartbeat is unchanged; injected terminal
failure rolls back the whole composite; exact/divergent replay is distinguished. Prove D118's
attempting-write park/refusal, cancellation settlement outside the fence, diagnostic-bundle atomicity,
and absence of `span.ended` before commit. The deletion test must go red when any direct lifecycle
mutator call is reintroduced. These results would disprove the plan's highest-risk assumption if the
existing service/outer transaction boundary could not retain atomic evidence settlement; nested
authority savepoints and after-outermost-commit callbacks are the inspected current mechanism that
makes the scope feasible. The shared-helper amendment additionally requires:

| Entry boundary | Required result and forbidden effects |
|---|---|
| Claimed-worker `advance-running` | Claim-fenced service transition commits with write intent/attempt, checkpoint, outbox and lifecycle journal; stable run/session/attempt/claim-generation identity is preserved. |
| Positive recovery and real kernel `resolve-write-present` | Existing proof/actor/target admission is retained; `resume-queued` uses the continuation service port, preserves `startAt`, and atomically settles write/checkpoint/outbox/lifecycle/journal evidence. Cover both callers, not only a direct helper fixture. |
| Stale CAS/claim, wrong intent/generation or divergent replay | Named refusal reaches the owning caller; no committed evidence or lifecycle change, no continuation, and no premature publication. Test refusal after earlier evidence writes to prove the outer rollback. |
| Exact replay and command identity | Exact replay writes nothing and preserves the continuation and evidence identity; changed payload under the same id refuses. A kernel product command and its nested lifecycle command coexist without journal collision. |
| Outer rollback and publication | Inject failure after inner service settlement, including after prepared diagnostic-bundle persistence; all lifecycle/checkpoint/write/result/authorization/outbox/diagnostic/journal changes roll back. After-commit callbacks wait for the outermost commit and never fire on rollback/refusal. Run `span.ended` follows only applied or exact-replay terminal settlement. |
| Cancellation, fences and recovery | A non-fenced boundary settles an admitted cancellation as terminal/cancelled; `retainAfterFence()` callbacks finish uninterrupted. Expired/self-sweep cancellation settles cancelled rather than queued, subject to D118's attempting-write park/refuse admission. |
| Deletion oracle | Reintroducing a direct lifecycle mutator in either helper arm or its admitted continuation adapters makes the guard red; the worker port cannot acquire command-family `transition` authority. Existing loop/executor/composition/sweep coverage remains intact. |

During Steps 1–5, pair relevant focused unit/composition/architecture runs with lint and run typecheck
when it informs the next action; do not repeat known-failing root gates during unfinished wiring.
Step 6 runs every candidate gate below, including an observed intended-red mutation and restoration.
Per-commit and integration gates remain mandatory; full coverage uses at most four file workers with
no concurrent compiler/linter contention. Preserve assertions, membership, isolation and deadlines.
Run:

```text
npm run lint && npx vitest run tests/unit/run-record-service/service.test.ts tests/unit/worker-loop.test.ts tests/unit/worker-composition.test.ts tests/unit/claim-sweep-recovery.test.ts tests/unit/run-executor.test.ts tests/unit/write-sequencer.test.ts tests/unit/write-recovery.test.ts tests/unit/write-resolution-binding.test.ts tests/unit/command-kernel.test.ts tests/unit/dry-run-scenario-composition.test.ts
npm run lint && npx vitest run --project architecture tests/unit/architecture/multi-worker-overlap.test.ts tests/unit/architecture/worker-teardown-soak.test.ts tests/unit/architecture/worker-loop-writes-only-through-the-service.test.ts
npm run typecheck && npm run lint && npm run test:coverage
npm run build:manifest:check && npm run test:architecture
git diff --check
```

Any descriptor import-closure change requires `npm run build:manifest` before its check. Any test run
is paired with lint. A needed SQL/contract/new-operation change returns to a newly numbered 0.3 task.
Do not run Playwright parity or live-browser verification. A required UI/browser, SQL schema/migration,
contract, new-operation or other excluded-scope change stops this assignment for operator resolution.
No live HR write or push is authorized.

**Initial Task 3 candidate evidence (2026-09-05; originally awaiting independent review).** Implementation
`20715548d08325e67ca2070131c5bc7aeb219594` on `codex/phase-1-6-run-writers`, based on
`7e2b76076e0542c2f40c6ea4be5c3a61252cb061`, follows the original plan `f34c9021` and
approved amended plan `7e2b7607`, plus the operator-approved recovery-read amendment above.
Prerequisites were verified before creation: accepted Task 2-1 `bc82fe47`, Task 2-2 restoration
`94464920` with the restored seam matching `0e38b82f`, and both approved plans are in the base.
The assigned worktree and branch were absent; only the primary checkout occupied capacity.
Synthetic authority roots and an empty private test `.env` were used. No browser or live run occurred.

Steps 1–5 are implemented: the five-operation worker port, separate continuation capability,
production claim/heartbeat/sweep composition, service cancellation settlement, and atomic terminal
and shared-write composites. The executor retains its original claim across diagnostic capture;
all terminal publication uses after-outermost-commit callbacks. D118 enumeration includes attempts
whose run row is absent, and sweep recovery preserves the run attempt and claim generation.
At this candidate stage, Task 3 remained open pending independent review, integration gates and owned cleanup.

| Proof boundary | Candidate evidence and forbidden effects |
|---|---|
| Composed claim/runtime admission (#4–#5) | `worker-composition.test.ts`: four workers, stale settings and stale epoch cases; `multi-worker-overlap.test.ts`: one execution per row, sibling exclusion. Stale admission unwinds its outer transaction before browser acquisition. |
| Heartbeat/recovery (#6–#7, #27 worker half) | `claim-sweep-recovery.test.ts`, worker overlap/teardown, and composition startup: live heartbeat retained, zombie loses, self/global sweep preserves attempt/generation. Startup cancellation becomes terminal/cancelled without claim/browser; attempting writes park/refuse. Service regression covers a same-item attempting intent from an absent run. |
| Terminal settlement (#9–#10) | Service exact/divergent terminal replay; executor success/failure, refusal and outer rollback; diagnostic capture failure injected after bundle persistence. Run/result/failure/authorization/bundle/journal evidence rolls back together and no run-ended event escapes refusal/rollback. The diagnostic-await replacement-worker regression proves the executor cannot borrow a new claim. Existing service callback tests pin outermost-commit behavior. |
| Claimed shared-write arm | `write-sequencer.test.ts`: actual fenced settlement, stale CAS/claim failures, step-injection rollback, exact helper replay with zero authority-generation delta and divergent checkpoint rejection. Write intent/attempt, checkpoint, both outboxes and lifecycle journal share one transaction. |
| Recovery/command continuation arm | `write-recovery.test.ts` positive recovery and `parked-write-round-trip.test.ts` real kernel resolve-present preserve proof/actor/target/version admission. Injected refusal after checkpoint insertion and failure after lifecycle transition leave all evidence unchanged. Exact helper replay retains `startAt`; changed continuation refuses. Product and nested lifecycle command ids coexist; exact kernel replay writes nothing. |
| Cancellation and retained callback | Executor cancellation settles before a non-fenced operation. Sequencer test holds an actual `retainAfterFence()` callback while requesting cancellation: no interruption/close/terminal event, then write settlement completes before cancellation. |
| Deletion oracle | New type-resolved `worker-loop-writes-only-through-the-service` guard scans runtime/helpers plus admitted continuation adapters, detects relocated/aliased mutators and checks the five-operation port. Reintroduced direct `runs.transition` in the shared helper made the production guard fail (exit 1); exact original bytes restored and guard passed. Inventory updated with this evidence. |

Step 6 candidate gates passed on the implementation tree: focused candidate run 12 files/358 tests,
then the final claim-fence regression 18 executor tests and 11 focused architecture tests; typecheck
and root lint passed. Full coverage passed **416 files / 5,206 tests**, including all assigned focused
suites; global statements/branches/functions/lines **85.56/76.72/89.71/87.62%**, core
**87.70/78.20/92.90/90.17%**, all ratified floors unchanged. Coverage ran with at most four file
workers after compiler/linter completion. Suite-size check passed. Manifest check reported current;
standalone architecture passed **75 files / 758 tests**; `git diff --check` passed.
Local logs: `/tmp/hr-run-writers-full.log`, `/tmp/hr-run-writers-final-gates.log`, and
`/tmp/hr-run-writers-deletion-red.log`. These commands and counts are the durable evidence;
logs are temporary. The evidence-only commit is the next commit after the implementation SHA above
and repeats the mandatory typecheck/lint/full-coverage gate before committing.

Exclusions remain as approved: no command-kernel/fan-out/start creation, shared queued publication,
negative recovery/resolveAbsent, config consumer, SQL migration, contract, projection or UI changes.
No push. No next-task dispatch. Review must bind this implementation range and its evidence commit.

**Independent review and correction round 1 (2026-09-05).** Fresh read-only Codex
`sup_review_run_writers` (`sup_review`, Sol 5.6/high) reviewed base `7e2b7607`, implementation
`20715548`, and evidence/head `49670b65`; verdict **CHANGES REQUIRED**. It inspected the complete
43-file diff and gate logs without running write-producing checks. Three findings were accepted:

- R1 (high): failure authorization could absorb a cancellation committed between its boundary
  read and current-row read. Success/failure admission now refuses a current cancellation inside
  the service transaction; executor cancellation settlement occurs after a refused composite
  unwinds. The exact failure interleaving reproduced red (`failed` instead of cancellation), then
  passed with neighboring terminal/diagnostic tests. A second regression covers cancellation
  arriving at success admission after authorization.
- R2 (medium): recovery cancellation lacked its run-ended event. Startup and global maintenance
  now supply the existing JSONL emitter through a required sweep publication callback, registered
  only for a newly applied cancellation via `afterAuthorityCommit`. Both real composition paths
  reproduced zero terminal events before the fix. They now publish one stable run identity even
  after repeated process startup. The sweep test proves outer rollback suppresses publication,
  outer commit delays it correctly, and repeated sweeps add no event or authority generation.
- R3 (medium): global recovery parsed retained run history under the writer lock. The adapter's
  read-only `listClaimRecoveryCandidates` now uses the original active-state plus stale-heartbeat/
  worker/workflow predicates and ordering, with strict request/record validation. All mutation and
  D118 admission remain inside the service sweep transaction. A SQLite-boundary regression failed
  before the fix and now proves filtering occurs before JSON reads and forbids whole-workflow
  enumeration. This is a tactical adapter read adaptation; no migration, contract or lifecycle
  operation changed.

Correction gates passed: `npm run typecheck`, `npm run lint`, the assigned focused suites plus
adjacent diagnostics/kernel round-trip tests (**12 files / 364 tests**), full coverage
(**416 files / 5,211 tests**, all floors; global statements/branches/functions/lines
**85.57/76.75/89.73/87.64%**, core **87.73/78.30/93.02/90.20%**), suite-size check,
manifest check (current), standalone architecture (**75 files / 758 tests**) and diff check.
Coverage ran after compiler/linter completion with at most four file workers. Red/green evidence:
`/tmp/hr-run-writers-review-r1-red.log`, `-r1-green.log`, `-r2-red.log`, `-r2-green.log`,
`-r3-red.log`, `-r3-green.log`; full gate log `/tmp/hr-run-writers-review-fix-gates.log`.

The correction and this evidence are committed together on the assigned branch; their immutable
commit is the commit adding this paragraph, based on reviewed head `49670b65`. The supervisor
supplies that full SHA for renewed review. The corrected candidate was then submitted for renewed independent review; these finding
dispositions alone did not claim acceptance or integration. Final acceptance follows below.

**Supervisor sizing and assignment.** One supervisor fits: the worker port, service composition,
terminal atomicity and recovery proofs are one coupled seam; a split would overlap every hard boundary.
This is serial work, not a parallel wave.

| Assignment | Branch | Absolute worktree | Base / start prerequisite | Owned files and resources | Acceptance gates | Merge condition |
|---|---|---|---|---|---|---|
| `1.6.3` | `codex/phase-1-6-run-writers` | `/Users/julianhein/Projects/hr-worktree-run-writers` | Verified latest local `master` SHA containing restored Task 2-2, original plan `f34c9021` and the committed shared-settlement amendment; record the amendment SHA and verify all before the first edit | Task-3 seam, the bounded shared-helper/recovery continuation adaptation and tests above; synthetic authority/runtime roots only; no real state, browser or fixed port | Assigned proof matrix, focused suites, full coverage gate, manifest check, architecture | Freeze the exact candidate; record evidence and obtain fresh independent `sup_review` PASS. Then, against latest local `master` still containing restored Task 2-2 and the approved plan, integrate without a behavior-changing conflict, or re-review such a fix; run integration gates, record review/merge/gate evidence, remove only owned worktree/ref, and mark only Task 3 complete. No push. |

#### Task 3 completed (2026-09-05)

**COMPLETE.** The same independent reviewer, `/root/sup_review_run_writers` (`sup_review`,
Sol 5.6/high), returned **PASS** on corrected candidate
`a2c37bbada408e693cdd89415749f08e46478b65`, against approved plan/base
`7e2b76076e0542c2f40c6ea4be5c3a61252cb061` (original plan `f34c9021`). All three findings
above are resolved; no acceptance or evidence gaps remain. The reviewer inspected code, regression
red/green logs and gate evidence, and reran read-only Git identity/diff checks only.

The candidate was integrated into local `master` as
`2c4e1af69fc8d5d97e38a3a4d14db4423ce51786`, without conflicts or any change to the reviewed
tree. Required integration gates ran on that exact merge commit in the owned worktree's private test
environment: typecheck, root lint, full coverage **416 files / 5,211 tests**, all ratified floors,
suite-size check, manifest check (current), standalone architecture **75 files / 758 tests**, and
`git diff --check` all passed. Integration global statements/branches/functions/lines were
**85.57/76.75/89.73/87.64%**; core **87.73/78.30/93.02/90.20%**. Coverage used at most four
file workers with no concurrent compiler/linter. Log: `/tmp/hr-run-writers-integration-gates.log`.
The earlier observed intended-red deletion oracle and its restored passing proof remain applicable
to this unchanged integrated guard.

The final documentation gate first exposed an existing primary-environment refusal: secure bootstrap
rejects a retired environment key. No environment/configuration change was made. The exact completion
files were validated in the recreated assigned worktree with an empty private `.env`; its tree was
compared byte-for-byte with the primary completion tree before that validation worktree/ref was
removed again. The isolated gate preserves the assignment's test-environment requirement rather
than changing primary credentials or weakening the lifecycle test. Logs:
`/tmp/hr-run-writers-completion-gates.log` (environment refusal) and
`/tmp/hr-run-writers-completion-isolated-gates.log` (final isolated validation).


Cleanup was verified before this completion record: reviewer completed; no owned gate remained
active; `/Users/julianhein/Projects/hr-worktree-run-writers`, its Git worktree registration and
`codex/phase-1-6-run-writers` were removed. The primary checkout's environment was never copied or
overwritten. No browser/parity/live verification or push occurred. This closes only Task 1.6.3;
Task 4 and the rest of §1.6 retain their existing scope and remain unstarted by this session.
