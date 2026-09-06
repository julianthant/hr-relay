# Task 4 · Cut over operator run commands, Rerun planning, and archive/delete writers
<!-- roadmap: p1f-run-commands -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**Seam:** `src/core/command-kernel.ts` (the run family and version-archive family through the service:
start/intake fan-out `create`, internal compatibility retry/restart, cancel, bump, rename, gate/write
continuations, archive, relaunch, `delete` / `delete-archived-run` with the D308 member tree, bulk as N
children, purge as evidence retention; D334 source-bound Rerun planning; the typed settlement
vocabulary with `target-deleted` and §D330.5's wire mapping), `src/core/run-fan-out.ts`,
`src/core/run-record-service.ts`, `src/core/write-recovery.ts`, `src/domain/{commands,run/start-plan}.ts`,
`src/services/{start/plan,trust/diagnostic-retention}.ts`,
`src/server/dashboard/{compose,commands/command-service}.ts`, the dry-run-scenario enqueue composition,
the shared post-commit `run.queued` builder/publication used by dashboard, intake and dry-run starts,
and their focused tests. The operator-approved D335 extension also owns
`src/domain/{dashboard/start-plan,run/envelope,write-safety}.ts`, the relevant strict schemas in
`src/infra/sqlite/{run-store-contracts,storage-records}.ts`, the write-intent JSON queries/fence admission
in `authority-database.ts`, `src/core/{run-executor,write-sequencer,write-recovery}.ts`, and their
composition/evidence consumers only as needed for confirmed repeat occurrences and source-bound
execution. Minimum frontend compatibility ownership is `src/dashboard/surfaces/run-start-kit.tsx`
(logical row keys and no pre-Confirm trace), `context-rail.tsx` and its model (retire the obsolete
checkpoint-save action), shared command-result folds, associated unit fixtures and affected parity
references. The full modal, its defaults/launchers and warning interaction remain 3.1 Task 11-2;
`tests/unit/architecture/no-lifecycle-sql-outside-the-adapter.test.ts` lands HERE with its entry flipped
`planned → active` in the commit that removes the last direct mutator import, carrying the
`runs-view-has-no-reader` arm and its stub-throws negative control (ref guards-and-tests §5.2 A3).
`edit-data-field-policy` retires in that implementation commit under D334 and is replaced by the
active `rerun-prefill-boundary` guard with its own violating fixtures. **Does
not touch:** `deriveRunStatus` and its two callers (A2, 2.6), the projector's `runs_view` writes (A3, 2.6),
SQL schema/migrations, the full Rerun modal/prefill UI, browser controls/drivers, or retired
Capture. Strict request/plan/envelope/write-intent JSON and adapter query changes are admitted only
for D334/D335; no DDL. The minimum frontend compatibility/reference changes named above are admitted;
the earlier blanket frontend/parity exclusion is superseded. **Owes:** §D330.11 #24; the kernel suites re-pointed; every command's idempotence, stale CAS
and worker-race arms through the real kernel. **Gate:** base + `npm run test:architecture` with the guard
active. **Deletion test:** the guard itself (#24) — red on any lifecycle SQL or mutator import outside
the two-module literal allowlist. **Order:** fourth. **Cancel of a claimed run:** the coordinator ruled
option A on 2026-09-04 and it is landed in §D330.5 (the request arm), §D330.3 (self-edge and tree sentence),
§D330.11 #27 and the `cancelling` served status — an operator `cancel` on a `claimed`/`validating`/`running`
row sets `cancelRequested` under CAS and the worker settles `terminal/cancelled` at its next non-fenced
boundary; this task implements exactly that arm and owes #27.
Task 3's approved shared-settlement amendment also supplies the service-backed `resume-queued` arm
used by positive recovery and operator `resolve-write-present`, with its narrow dashboard injection.
Task 4 retains command dispatch/admission, remaining write-resolution paths and the full command-family
cutover; it must preserve Task 3's atomic settlement, continuation, refusal and replay proofs.

- [ ] Route dashboard/dry-run start, internal retry/restart compatibility, cancel, rename, gate/write
  continuation, archive, relaunch, D308 terminal-only delete/tombstone, bulk and retention purge through
  the run service; route start/intake fan-out creation through `create` and its one post-commit `run.queued` publication; one typed settlement/
  conflict vocabulary with actor/version attribution (§D330.5, §D330.8, D233, D235, D308).
- [ ] Implement D334's backend boundary: plans carry logical runs and optional source/prefill provenance
  but no `runId`/`traceId`; Confirm mints identities in the create transaction; retire the in-place
  `edit-checkpoint` writer; source-bound Rerun submissions create a new authoritative run and
  never mutate or silently replay the source. Carry D335's warned confirmation into a separately
  fenced selected transaction occurrence; preserve replay, concurrency and unknown-write safety.
- [ ] Prove typed settlements, idempotence, stale CAS, worker races and relaunch lineage through the
  real kernel; activate `no-lifecycle-sql-outside-the-adapter` (#24) in the same commit.

#### Approved focused-session plan (2026-09-05)

**Approval and resolved decisions.** The operator approved D334 in chat on 2026-09-05: run identity is
created only when the final modal submission actually queues the run; Rerun opens the same Run modal
at Steps for both failed/interrupted and successful sources; completed-step values are optional
editable prefill; the operator controls
steps and values independently; submitted modal values/omissions are authoritative; and the source run
never changes. D334 is normative in `ref dashboard-surfaces` §2.4/§9.1/§9.3.1 and
`ref data-intake-and-edit-data` §6. It supersedes D166's in-place checkpoint edit and D314's direct
no-input/no-omission recovery surface while preserving D313 and every uncertain-write fence.

**Operator-approved amendment after the original launch inspection.** The operator approved the
narrow scope amendment, then clarified that a selected completed transaction must warn and may be
submitted again after explicit confirmation. The final operator clarification names one **Rerun**
action for both outcomes. Failed/interrupted sources default to failed/unfinished steps; successful
sources default to ALL steps, including previously omitted steps. These defaults never restrict
eligible selection. On proceeding from Steps with a selected previously submitted transaction, a
warning popup offers **Cancel / Confirm**. Cancel returns to Steps; warning Confirm acknowledges and
advances to **Values**, without consuming a plan, creating a run or submitting anything. The operator
edits values, then the modal's final submission consumes the plan and queues the new run. References
to backend plan-consumption Confirm below mean this final submission, never the warning button.
Values edits retain acknowledgment when the warned transactions/keys/evidence remain the same;
changed warning facts require renewed acknowledgment. Exact final-command replay still creates only
one run. A later deliberate Rerun flow may authorize a new submission.
The operator then instructed this session to persist these choices and resolve feasibility during
`/phase-plan`, before another supervisor launch. D335 is ratified in `ref write-safety` §D335 and
`ref dashboard-surfaces` §9.1 in this same planning commit. This amendment supersedes original plan
`816f8084812dde63de172cbbfc8d8eaadca49a96` only at the explicit scope/behavior/gate changes below;
all other acceptance rows remain. No Task-4 implementation or review is claimed.

**Feasibility corrections.** The following contradictions are resolved in scope rather than deferred:

1. D109 start plans currently pre-mint `runId`/`traceId`, contrary to D330.1. New plans retain the
   exact logical run/input/item/step/omission set but no lifecycle identity. The service mints identity
   inside create; exact replay returns the originally journaled ids without calling the id factory.
   Existing short-lived plans with reserved ids remain readable only to refuse consumption and require
   replanning. This is a strict persisted-JSON/type change, not SQL DDL.
2. The current `run.edit-checkpoint` arm directly changes `tasks.envelope.injected`, so the Task-4
   guard cannot activate while it survives. Remove that product mutation. A D334 source-bound start
   plan carries the source id/version, contextual intent, effective step selection, authoritative
   values/omissions and optional copied-from coordinates. Same derived item may retain `retryOf`; a
   changed item is fresh and may not claim retry lineage.
3. D294 retired Capture Mode and its command family. Task-4's stale capture-fan-out wording is deleted;
   no capture module, route, fixture or UI may return.
4. The current CLI has no generic run verbs, and D330.10 lists only `phase`, `dry-run-scenario` and
   `storage`. This task cuts over the existing dry-run-scenario enqueue composition; it adds no CLI
   grammar. D330's `retry`/`restart` service operations remain compatibility operations and are proved
   through the kernel, but 3.1 Task 11-2 replaces direct dashboard Retry/Restart controls with the
   source-bound plan flow.
5. Removing proposal identities reaches `run-start-kit.tsx:181/233`: the renderer keys by `runId`
   and displays `traceId`. Removing the command reaches `context-rail.tsx:778` and the client's strict
   parse in `src/dashboard/client/commands.ts:99`. Minimum compatibility edits and their specific
   reference changes are now owned here. Leaving a visible save that cannot pass client validation
   or displaying `undefined` is not a backend-only completion.
6. New ids alone do not isolate execution. `run-executor.ts:807–822` reads item-wide checkpoints;
   the existing restart marker suppresses only read/compute reuse. `write-sequencer.ts:1764–1798`
   replays a transaction checkpoint or permanent intent. The new source-bound marker and D335's
   repeat authorization are now owned here; internal compatibility retry/restart remains unchanged.
7. `write_intents` has both a unique digest and the v2 unique `(system,idempotency_key)` index
   (`migrations.ts:394/782–795`). Reopening a completed intent would rewrite source evidence. D335
   instead retains a distinct authorized occurrence in the existing strict JSON-backed tables.
   `WriteIntentRecordSchema` and the repository's existing JSON queries (`authority-database.ts`
   `writeIntents.listAttemptingByItem/listByRun`) establish the available storage mechanism; a NEW
   business-key/occurrence query and atomic admission check are explicitly owned here. A suffixed
   key without that query would bypass unresolved sibling occurrences and fails acceptance.
8. Existing `proofFromPresentProbe` can return the older receipt. Positive recovery and operator
   resolution must distinguish the new occurrence; a business-level present result alone is not
   fresh completion. Normal commit still uses fresh existing verifier/binding contracts; unknown
   occurrence-specific results retain evidence-resolution actions. This is source-bound replay and
   recovery adaptation, not a redesign of Task 3's lifecycle service or worker loop.

**Planning feasibility evidence (inspected at original base `816f8084`).**

| Requirement | Current mechanism / missing piece | Admitted owner | Disproof / assigned proof |
|---|---|---|---|
| Identity only at Confirm | Service create already mints ids in its authority transaction; plan/wire and rendered card still reserve/display them | Steps 2/3/5; schemas, planner, fan-out, minimum renderer | No proposal identity; real Confirm mint; kth-create rollback; reference card contains no premature trace |
| Submitted values only | Item-wide task/transaction checkpoints and durable-intent reuse survive a new run id | Steps 2/4; source-bound envelope marker, executor/sequencer | Same item with changed/cleared values executes selected steps afresh; own-run recovery still works |
| Explicitly repeat completed transaction | Old natural-key uniqueness cannot represent a second independent intent under the same key; JSON admits optional occurrence provenance | Steps 2/4; strict schemas, adapter queries/fence, sequencer | Missing/stale acknowledgment spends nothing; exact confirmation replays one occurrence; two confirmations cannot bypass an active sibling |
| Fresh repeat outcome | Generic recovery can find old proof; no old-proof success is allowed for the new occurrence | Step 4; sequencer/recovery and evidence consumers | Crash plus old receipt remains unresolved; occurrence-qualified positive evidence settles atomically |
| No new modal early | Current card/save action consume removed contracts; new modal defaults/warnings are later scope | Step 5 minimal compatibility; 2.6.1-2 reads; 3.1.11-2 full UI | Typecheck and scoped reference changes now; later UI proves defaults and warning/confirmation interaction |
| No DDL / one lifecycle writer | Existing JSON storage plus adapter transaction can retain occurrence metadata; lifecycle service operations already suffice | Step 4 bounded adapter changes; Step 6 exact two-module guard | No migration; no mutator bypass; fence/recovery tests use real temporary authority |

The earlier feasibility run passed two files/four tests (`run-executor-restart` and
`write-sequencer-restart-no-repeat`) plus root lint on `816f8084`. Those prove the old reuse behavior,
not D335 acceptance. No live/production experiment was used. Supervisor proof must show actual
fresh submission with synthetic drivers, not merely assert a new run id. The planner checked the
current API/schema/renderer paths; implementation proof is still owed.

**Planning validation (2026-09-05).** No product code, test, schema, configuration or guard manifest
changed. Typecheck and lint passed. The complete coverage gate plus suite-size check passed in the
owned isolated worktree with two file workers: **416 files / 5,211 tests**, all floors; global
statements/branches/functions/lines **85.57/76.75/89.73/87.64%**. The first primary-checkout run failed
with timeouts/worker-start errors and the existing `.env` migrated-key refusal; the isolated run
resolved those gate conditions without changing test membership, assertions or timeouts. Only final
prose/ownership clarification and this evidence were added after that test snapshot; runtime/test
sources are byte-identical to the tested base. Roadmap generation/check, manifest check, documentation
instruction-pair/size audit and diff checks passed on the final planning tree. Logs:
`/tmp/hr-1-6-4-plan-isolated-typecheck.log`, `-isolated-lint.log`,
`/tmp/hr-1-6-4-plan-final-coverage.log`, `-final-suite-size.log`, `-final-roadmap.log`,
`-final-manifest.log` and `-final-doc-audit.log`. These are prerequisite/planning gates, not evidence
that the planned D334/D335 behavior has been implemented. No live HR or visual reference changed.

**Verified prerequisite and execution binding.** Task 1.6.3's reviewed cutover merge
`2c4e1af69fc8d5d97e38a3a4d14db4423ce51786` and completion record
`e29dd119c92bd44356d50927380595b6d8838a2d` are ancestors of original plan `816f8084`.
The primary checkout was clean at this amendment's start. The earlier supervisor created the assigned
worktree/ref but made no implementation edits; only a temporary recovery brief was present. After
this amendment is committed and that brief's facts are consumed here, planning removes only that
owned worktree/ref and verifies their absence. The same worktree may validate an exact copy of this
documentation candidate with a private example environment; that is not product implementation. The new supervisor creates the SAME assigned
branch/path from the full amendment commit returned in its verified prompt. Recheck current target,
ancestry, ref/path availability and the four-auxiliary-worktree budget before the first edit; never
reset a collision. The primary checkout remains integration-only for implementation.

**Implementation sequence.** One supervisor performs these stable steps in order:

1. Reverify the approved plan/contract, Task-3 ancestry, clean integration target and assigned
   worktree/ref. Inventory every remaining production lifecycle repository mutation/read reached by
   command, start/intake/dry-run fan-out, gate/write resolution, version archive and retention sweep.
   Freeze the proof matrix below before changing code; use only synthetic authority/runtime roots.
2. Land D334's strict domain boundary. Make new start plans source-aware when entered by Rerun,
   remove proposed `runId`/`traceId`, bind source id/version, intent, effective selected/omitted steps,
   submitted values and optional copied-from coordinates into the request fingerprint, and ensure old
   identity-bearing plans parse only to a named replan refusal. Bind D335 warning-set acknowledgment
   and occurrence provenance into the strict start request/plan, source-bound envelope and write-intent
   JSON. Keep the Steps warning acknowledgment separate from final plan consumption; revalidate its
   source/selection/business-key/evidence scope against the submitted Values. Preserve acknowledgment
   across Values edits that do not change warning facts. Warning Confirm has zero lifecycle effects.
   Missing/stale acknowledgment is confirmation-required with zero consumption; completion alone
   is not an invalid-state refusal. Retire `run/edit-checkpoint` as a product mutation. Do not add a
   lifecycle operation or SQL migration.
3. Inject one `RunRecordService` capability into the kernel over the same `AuthorityDatabase` and
   replace `fanOutQueuedRuns`' lifecycle writes with service calls. Preserve one outer product-command
   transaction across plan consumption, enqueue policy/supersession, session creation and N creates.
   Give each nested lifecycle call a stable domain-separated command id. Pass title/subtitle/actor only
   as after-commit publication context, never into the lifecycle journal; publish exactly one shared
   `run.queued` root per newly applied run after the outermost commit and none on refusal/rollback/replay.
4. Cut over every remaining command-side lifecycle write: compatibility retry/restart; cancel tree and
   claimed cancellation request; bump/rename; gate and absent-write continuations; version-bump archive;
   relaunch; queue/archive D308 delete; and diagnostic evidence purge. Map service refusals exhaustively
   to product results, including `target-deleted`, without converting lost/replay/cursor/identity or
   retention faults into plausible operator answers. Preserve Task 3's positive write-resolution
   settlement and atomicity. Correct the service's cancel-tree arm if needed so running members and the
   anchor each receive their own cancellation request and no operator transaction settles a claimed row.
   Implement source-bound fresh execution and the confirmed-repeat protocol at `ref write-safety`
   §D335: business-wide adapter query plus atomic fence, deterministic confirmation/node occurrence,
   no source checkpoint/intent mutation, fresh prepare/binding/commit/verification, and occurrence-aware
   recovery/resolution. Keep normal/internal compatibility paths unchanged. Query active/unknown
   occurrences even when their originating run is absent; a key suffix cannot evade that admission.
   Neither an old transaction checkpoint nor a generic old-receipt probe settles the new occurrence.
5. Recompose dashboard, intake and dry-run-scenario callers. Remove duplicate command-service
   publication and projection-derived queue-root titles. Keep best-effort bulk as deterministic N child
   commands and retain the explicit all-or-none refusal. Remove premature trace rendering/use logical
   card keys; retire the obsolete Context-rail checkpoint-save action while retaining read-only data.
   Adapt affected shared result folds/fixtures to confirmation-required. Use `/ui` for these minimum
   compatibility changes and deliberately review only their affected visual references. Full modal
   defaults, warning and confirmation UI remain 3.1 Task 11-2. Do not add Capture or generic CLI commands.
6. Activate `no-lifecycle-sql-outside-the-adapter` and its guard-inventory entry only after the final
   direct mutator/import is gone. Its literal allowlist is the SQLite adapter plus run service; prove
   SQL, mutator-import and `runs_view`-reader arms against checked-in violating fixtures. Repoint kernel,
   start-plan, intake, archive, recovery, retention and BFF suites through real service composition.
   Retire `edit-data-field-policy` with `retiredBy: D334` and `replacedBy: rerun-prefill-boundary`;
   activate that replacement only with its descriptor/source/version/provenance negative controls.
7. Run focused checks during implementation, then the full candidate gates below without compiler/
   linter contention with coverage. Commit the exact candidate and evidence, record `awaiting independent
   review`, dispatch `/supervise`'s fresh read-only `sup_review`, fix tactical findings in this worktree
   with focused red/green proof, and renew review until PASS. Integrate only the accepted candidate,
   run integration gates, record evidence/cleanup and mark only Task 4 complete. No push.

**Acceptance and disproof matrix.** Prove backend rows through production composition, not
direct-repository fixtures. For modal rows, 1.6.4 proves warning acknowledgment has zero lifecycle
effects and final-consumption enforcement; 3.1 Task 11-2 proves the specified labels/navigation and
Values interaction. Those later UI assertions do not require the full modal in this candidate:

| Boundary | Required result | Forbidden effect / disproof |
|---|---|---|
| Plan → Confirm → N create | Proposal contains exact logical entries but no run/trace ids; Confirm returns N service-minted identities in one applied product result | Any id exists before Confirm; a kth-create refusal leaves a consumed plan, earlier row or queued publication |
| Exact/divergent replay | Exact product/lifecycle replay returns the original ids/versions and publishes nothing; divergent reuse refuses | Id factory runs again, a second row/root appears, or replay becomes conflict/success |
| Rerun source plan | Source id/version is revalidated; submitted modal input/omissions alone shape the new run; source row stays byte-identical | Old checkpoint is inherited without submission, source envelope changes, or stale/deleted source queues work |
| Step/value customization | Any descriptor-eligible step may be selected/omitted and any offered value copied/changed/cleared; omitted transaction emits no new intent/attempt/proof | UI prefill becomes execution authority, an unselected step runs, or assertion provenance claims observation/write proof |
| Confirmed repeat authorization | Steps warning Cancel stays at Steps; warning Confirm advances to Values with zero lifecycle effects; final submission binds actual values and exact warning acknowledgment. Unchanged warning facts retain acknowledgment through Values edits; changed warned keys/selection/source/evidence require renewal | Warning Confirm consumes a plan, mints ids, creates/publishes a run or submits a transaction; completion-history veto; unacknowledged final submit; generic force flag; cross-node/key consent reuse; source mutation |
| Repeat fence / concurrency | One occurrence per consumed confirmation/node; natural-business-key checks include all original/repeat occurrences atomically | Double-click/replay submits twice; different occurrence key bypasses an attempting/parked sibling; ordinary writes miss a repeat fence |
| Repeat recovery / proof | New commit uses fresh verification; recovery must identify the new occurrence; old-only evidence remains unknown | Earlier receipt silently becomes new proof; claim loss/rollback/cancellation re-clicks; unsupported negative observation releases a new generation |
| Source-bound execution / compatibility | Other runs' task/transaction checkpoints are never inherited; own-run checkpoints still resume; internal retry/restart retains existing semantics | New run identity alone passes the test; source-bound mode leaks into legacy-compatible internal operations |
| Modal defaults / ownership | One Rerun action; failed/interrupted source defaults to remaining steps, successful source to all steps. Backend admits any explicit eligible selection and separates warning acknowledgment from final consumption; 3.1.11-2 owns Steps → optional Cancel/Confirm warning → Values → final submission | Separate operator Retry path; source's old selected set constrains Rerun; completed transaction disabled; warning Confirm starts execution; 1.6.4 grows the full later modal |
| Item lineage | Same derived item may cite `retryOf`; changed match key creates a fresh item without false retry lineage | Different item is forced under source item or loses authoritative submitted input |
| Queue-root publication | Dashboard, intake and dry-run use one builder after outermost commit, once per applied run | Direct kernel call produces a rootless committed run; rollback/replay publishes; command service emits a duplicate |
| Cancel tree / worker race | Queued/parked members settle; claimed members and claimed anchor receive CAS requests; worker settles outside retained fence | Operator settles a claimed row, omits the anchor request, or loses Task-3 fence/atomicity |
| Archive/relaunch/delete | Version CAS and digest/refusal mapping are typed; D308 tree deletes leaves-first behind one tombstone per run; relaunch lineage is exact | Member-alone/nonterminal/digest mismatch removes anything; deleted target maps to not-found; spent identity returns |
| Gate/write/retention | Gate and absent-write resume plus evidence purge use service operations and preserve outer transaction semantics | Any non-allowlisted module imports/calls a lifecycle mutator; retention-not-due becomes operator success |
| Architecture guard | Real tree passes; each SQL/mutator/runs-view violating fixture fails for its intended reason | Literal allowlist expands, a dead walker passes, or the planned inventory entry is marked active without the guard |

**Gate cadence and verification scope.** Use focused TDD after each related step:

```text
npm run test -- --project unit tests/unit/run-record-service/service.test.ts tests/unit/start-plan.test.ts tests/unit/server/start-plan-omissions.test.ts tests/unit/command-kernel.test.ts tests/unit/command-kernel-restart.test.ts tests/unit/retry-item-attempt.test.ts tests/unit/command-kernel-step-omission-carry.test.ts tests/unit/intake-command-arms.test.ts tests/unit/edit-data.test.ts tests/unit/archive-model.test.ts tests/unit/write-recovery.test.ts tests/unit/run-fan-out-step-omission.test.ts tests/unit/diagnostic-capture.test.ts tests/unit/server/bff-flow.test.ts tests/unit/server/intake-surface.test.ts tests/unit/run-executor-restart.test.ts tests/unit/write-sequencer-restart-no-repeat.test.ts tests/unit/write-sequencer.test.ts tests/unit/source-bound-repeat.test.ts
npm run test -- --project architecture tests/unit/architecture/no-lifecycle-sql-outside-the-adapter.test.ts tests/unit/architecture/rerun-prefill-boundary.test.ts tests/unit/architecture/worker-loop-writes-only-through-the-service.test.ts tests/unit/architecture/control-command-single-path.test.ts tests/unit/architecture/command-result-exhaustive.test.ts tests/unit/architecture/guard-manifest.test.ts
```

`tests/unit/source-bound-repeat.test.ts` is the new production-composed D334/D335 proof suite owned
by Steps 2–6. Include acknowledged fresh commit, consent mismatch, concurrent confirmations, absent
originating run, old-proof recovery, dry-run zero effects and source-byte preservation. Existing
compatibility suites remain required. Add the minimum component/result-fold tests with their owners.

Before the implementation commit and again on the integrated candidate, run serially:

```text
npm run typecheck
npm run lint
npm run test:coverage
npm run build:manifest:check
npm run roadmap:check
npm run test:architecture
npm run test:parity
git diff --check
```

Coverage uses at most four file workers and runs after compiler/linter completion. If host contention
requires fewer workers, the equivalent complete coverage gate is `npm run test -- --coverage
--maxWorkers=2 && node_modules/.bin/tsx scripts/suite-size.ts`; retain all suite membership, floors,
isolation and timeouts. Full parity assertion remains required.

**Verified gate environment.** The primary checkout's existing `.env` caused the CLI lifecycle test
to refuse a migrated key during planning; do not overwrite it or turn this task into a Settings
migration. In the owned worktree, safely create a missing mode-600 `.env` from `.env.example` only.
The full suite's CLI lifecycle smoke uses synthetic runtime state but reserves rebuild port 3938;
verify it is free, preserve any other owner's listener, and serialize this concrete gate conflict.
After integration, run gates on the exact integrated `master` tree in the owned worktree (fast-forward
its owned branch to the integrated commit after checking cleanliness), retaining that isolated
example environment. Verify its HEAD/tree matches the integration target; do not substitute the
pre-merge candidate if the target changed. Record both commit identities with the gate evidence.
No live HR login or real transaction is part of this smoke.

 The operator-approved compatibility changes may deliberately update ONLY
the affected confirmation-card and retired-checkpoint-editor reference scenes through the repository's
`test:parity:update` workflow; inspect their rendered/a11y changes and stage exact reference paths.
No unrelated refreeze or baseline weakening is allowed. Read dashboard module rules and `/ui` before
those edits. Browser checks here use synthetic fixture servers, never a live HR system; follow the
platform browser playbook when manual inspection is required. No live HR run, real write, real
`.tracker` state, performance lane, or production fixed port is required. Preserve synthetic parity's
own declared startup/isolation protocol.

**Operator-approved reference amendment (2026-09-05).** The implementation changes generated
descriptor and implementation fingerprints through their transitive import closures. Refresh their
provenance metadata and displayed hash text/pixels across otherwise unchanged reference scenes,
using `test:parity:update` and inspecting the resulting diffs. All other DOM, copy, control and
layout changes remain limited to the confirmation-card and retired-checkpoint-editor compatibility
scenes admitted above. This amendment does not permit unrelated UI changes or weaker assertions.

Stop only for a NEW material SQL/DDL need, new lifecycle operation, full-modal/driver/Capture/CLI
expansion, unowned downstream implementation, changed prerequisite, or an actual blocker. The exact
JSON, adapter-query/fence, executor/sequencer/recovery, shared-result and minimum frontend/reference
changes above are already admitted: do not send them back as the same scope question. A completed
transaction selected and explicitly confirmed is not an authorization question to re-ask. Tactical
review fixes stay with this supervisor; independent review and all existing gates remain required.

**Supervisor sizing and assignment.** Keep one supervisor for this serial task after rechecking the
amendment. The source-bound plan/acknowledgment, create transaction, occurrence fence and execution
proof share the same request, envelope and command boundaries; two independent candidates would
not pass in either merge order. No writer is dispatched before the shared boundary is stable. The
additional work is bounded to D335 and the named compatibility consumers; full modal/read projection,
workflow drivers, DDL and later-task features stay excluded. Fresh independent review covers the
whole amended candidate, including repeat recovery and the exact reference updates.

| Assignment | Branch | Absolute worktree | Base / start prerequisite | Owned files and resources | Acceptance gates | Merge condition |
|---|---|---|---|---|---|---|
| `1.6.4` | `codex/phase-1-6-run-commands` | `/Users/julianhein/Projects/hr-worktree-run-commands` | Verified full approved-plan commit on local `master`, containing Task 1.6.3 completion `e29dd119c92bd44356d50927380595b6d8838a2d`; recheck ancestry/path/ref/capacity before creation | Task-4 seam plus named D334/D335 JSON, adapter-query/fence, source-bound execution/recovery, minimum UI compatibility/reference edits and tests; synthetic authority/runtime/parity roots only; no DDL, full modal, driver, Capture, live HR state or write | Acceptance matrix, focused unit/architecture suites, typecheck, lint, full coverage, manifest/roadmap checks, standalone architecture, full parity with only approved compatibility reference changes, diff check | Freeze exact candidate and obtain fresh `sup_review` PASS. Against latest local `master` still containing the approved plan and Task-3 prerequisite, integrate without a behavior-changing conflict or renew review; run integration gates, record review/merge/gate evidence, remove only owned worktree/ref, and mark only Task 4 complete. No push. |

**Task 4 candidate — awaiting independent review (2026-09-05).** Approved plan/base
`db368866c2c2d2ea13ef8dea1bc2bbf197dcebd6`; implementation `5e4df715` and reference refresh
`ae11918c2b4bef8da9b84b17348e616489c2d2b6` form the candidate range. The operator approved the
fingerprint-only reference amendment above before its refresh. Task 4 remains open until fresh
independent review, integration gates and cleanup. Local `master` still points to the clean approved
base. Task-3 merge `2c4e1af6` and completion `e29dd119` ancestry, branch/path availability and worktree
capacity were rechecked before creating the assigned isolated branch/worktree.

Steps 1–6 are implemented: strict logical/source-bound plans and separate warning acknowledgment;
service-owned atomic fan-out and command lifecycle writes; source-bound fresh execution and D335
occurrence admission/recovery; shared post-commit publication; narrow card/read-only-data compatibility;
and active lifecycle/prefill guards. The production-composed `source-bound-repeat` suite has 17 cases,
including actual fresh submission, zero-effect acknowledgment, stale/deleted source, Values/selection
changes, omission, replay/concurrency/orphan fences, kth-create rollback, claim-loss/old-proof recovery
and dry-run zero effects. Existing kernel, archive, retention, recovery and BFF suites use the real
service composition. Both lifecycle-guard SQL/mutator/view fixtures and prefill negative controls pass.

| Candidate gate | Evidence |
| --- | --- |
| Typecheck and lint | PASS; `/tmp/hr-164-candidate-typecheck.log`, `-lint.log` |
| Complete coverage and suite-size | PASS; 418 files / 5,222 tests, two workers, all floors; statements/branches/functions/lines 85.56/76.90/89.73/87.67%; `/tmp/hr-164-candidate-coverage.log` |
| Manifest and roadmap checks | PASS; `/tmp/hr-164-candidate-manifest.log`, `-roadmap.log` |
| Standalone architecture | PASS; 76 files / 761 tests; `/tmp/hr-164-candidate-architecture.log` |
| Full assert-mode parity | PASS; 269 tests, zero skipped/flaky/failed; `/tmp/hr-164-candidate-parity.log` |
| Diff and reference audit | PASS; `/tmp/hr-164-reference-audit.json`; no unrelated reference-content change |

Coverage used the exact admitted two-worker equivalent, after compiler/linter completion. The only
subsequent guard-catalog edit restored original formatting of unchanged entries; parsed JSON equality
was checked and standalone architecture then passed. All gates used the private mode-600 example
`.env` and synthetic authority/runtime roots; the primary environment was preserved. No live HR,
real submit, DDL, Capture, generic CLI or later-task UI was introduced.

Reference review covers 210 a11y files, 210 metadata files and 48 PNGs. Non-hash content changes are
confined to 58 run-data scenes, two diagnostic-gallery backgrounds carrying the retired editor, and
eight confirmation-card scenes (four retain that same card after submission). All other a11y bodies
are identical after normalizing generated hashes; metadata differs only in descriptor hash. The only
changed PNG outside compatibility scenes is the displayed descriptor hash behind the paper-ink
archive-version dialog, within x131–166/y320–328. Desktop/narrow cards/data and the diagnostic/dialog
captures were visually inspected. Scoped UI finishing review passed; it is not the independent
whole-candidate review required below. The full modal and its warning navigation remain 3.1.11-2.

Owned manual browser/server and gate processes are stopped. The temporary scope-blocker handoff was
verified and consumed after operator approval; its surviving facts are recorded here and in the
candidate. Keep the assigned worktree/ref for review and exact integrated-tree gates. No push.

**Task 4 renewed candidate — awaiting independent review (2026-09-05).** Fresh read-only reviewer
`/root/sup_review_run_commands` (`sup_review`, Sol 5.6/high) reviewed the complete base-to-
`734dba6da7dbc36e806049934b1c9a5c21c7a88b` candidate and returned CHANGES REQUIRED: Rerun admitted
archived, cancelled, discarded and superseded sources. D334 admits live successful/failed/interrupted
sources; archived returns require the separate digest-bound relaunch path. No other material finding
remained. The reviewer inspected gate evidence and independently reconciled all 48 PNG diffs; it did
not rerun write-producing gates.

Fix `1dd76ecb0d57d3bed6a9ba1bc68dbc6462bf7bfe` checks the authoritative archive disposition and
allowed terminal outcomes in the shared planner used by proposal and final consumption. Eight real-
composition regression cases cover all four exclusions at both boundaries, including strict stored
pre-fix plans. They assert no plan persistence/consumption, lifecycle identity, authority mutation,
run creation or publication. All eight failed for the intended admission defect before the fix
(`/tmp/hr-164-eligibility-red.log`); the fixed neighboring suites passed 7 files / 166 tests
(`/tmp/hr-164-eligibility-green.log`).

The unchanged fixed code/test tree passed typecheck, lint, complete two-worker coverage (419 files /
5,230 tests; statements/branches/functions/lines 85.56/76.90/89.73/87.67%), manifest and roadmap checks,
standalone architecture (76 files / 761 tests), full assertion parity (269 passed, no skipped/flaky
tests), and diff check. Logs are `/tmp/hr-164-revised-{typecheck,lint,coverage,manifest,roadmap,architecture,parity}.log`.
Generated manifest and reference files remain unchanged. The same private example environment and
synthetic isolation apply. Task 4 remains open pending renewed review, integration gates and cleanup.

#### Task 4 completed (2026-09-05)

**COMPLETE.** Independent reviewer `/root/sup_review_run_commands` (`sup_review`, Sol 5.6/high)
returned **PASS** on renewed candidate `03a2f5083234e0d5aa3a4c79abb91c1310529a92`, against
approved plan/base `db368866c2c2d2ea13ef8dea1bc2bbf197dcebd6`. The source-eligibility finding is
resolved by `1dd76ecb0d57d3bed6a9ba1bc68dbc6462bf7bfe`; no new material findings remained.
The reviewer checked the complete initial candidate and reference audit, then the correction and
regression evidence. Gate logs were inspected, not independently rerun; read-only Git identity and
diff checks were independently verified. All seven steps and the assigned acceptance matrix are
satisfied within Task 4's backend and minimum UI compatibility scope.

The accepted candidate was merged without conflicts into local `master` as
`5d050d3ddb38b09b194f0cc047535a691cd1820c`. Its tree
`ba06c58d03b93b2f2ec998087d54b5235712124c` exactly matches the reviewed tree. The owned branch
was fast-forwarded to that integration commit, and the complete committed gates ran serially there
with the private mode-600 example environment and synthetic state. Rebuild port 3938 was verified
free before coverage; compiler/linter completed before the two-worker coverage run.

| Integration gate | Result on `5d050d3d` |
| --- | --- |
| Typecheck and lint | PASS |
| Full coverage and suite-size | PASS; 419 files / 5,230 tests; all floors; statements/branches/functions/lines 85.56/76.90/89.73/87.67% |
| Manifest and roadmap checks | PASS; generated outputs current |
| Standalone architecture | PASS; 76 files / 761 tests |
| Full assertion parity | PASS; 269 tests, no failed/skipped/flaky tests |
| Diff and tested-tree identity | PASS; both checkouts clean, exact integrated HEAD/tree retained through gates |

Logs: `/tmp/hr-164-integrated-{identity,typecheck,lint,coverage,manifest,roadmap,architecture,parity}.log`.
The observed red/green eligibility tests and initial production-composed repeat proofs remain
applicable to this unchanged implementation. No additional reference refresh was needed.

Cleanup was verified before this completion record: all owned gates and manual browser/server work
had stopped; `/Users/julianhein/Projects/hr-worktree-run-commands`, its Git registration and
`codex/phase-1-6-run-commands` were removed with ordinary Git cleanup. Its private environment,
dependency symlink and synthetic outputs were removed with the worktree; the primary environment
and dependency installation were preserved. Three attributable failed-test scratch directories were
removed only after owner identity and stopped process groups were verified. External gate logs are
retained as evidence. Supporting agents had no separate sidebar tasks to archive.

This closes only Task 1.6.4. Full Rerun modal navigation/defaults remain Task 3.1.11-2. No DDL,
Capture or generic CLI expansion, live HR verification, real submit, push or next-task dispatch occurred.
