# SQLite timeline and transaction history

## Assignment and approval

**Owner: `side/timeline-history`. Approved planning; implementation WAITING ON accepted
integration of `side/operation-names`.** This is a separate successor, not an amendment to
any running rename assignment and not a roadmap phase.

On 2026-09-08 the operator selected separate checkpoints and timeline events, Activity derived
from database records, transaction details assembled into an archived-run snapshot, and exports
generated on request instead of maintaining ledger files. After the three-part scope was explained,
the operator instructed: **“no don't amend it. just let that chat know. im running it right now.
and make a plan for this change.”** The operation-name task was notified to finish its existing
three renames, including `operation_outbox`, unchanged. Its supervisor acknowledged that scope.

Three product outcomes belong together:

1. Keep `run_checkpoints` separate and make `timeline_events` the SQLite source of timeline history.
2. Read Activity and generate transaction exports from retained database facts; retire daily ledger
   delivery, `ledger_partitions`, `ledger_projections` and the superseded `operation_outbox`.
3. Store the transaction presentation needed by Archive in each existing `archived_runs` row.

The work is larger than a rename. Use two sequential, separately gated and reviewed implementation
sessions in this one plan: **T1 `side/timeline-history-1`**, then **T2 `side/timeline-history-2`**.
The operator opens each session. No implementation, database conversion or task creation is
authorized in this planning session. Neither implementation unit is complete or ready to launch.

## Authorities and execution boundaries

- [Document routing](../../README.md), [root instructions](../../../AGENTS.md),
  [operating reference](../../../.agents/skill-library/repository-work/REFERENCE.md), and
  [roadmap governance](../../roadmap/roadmap.md), D1/D263/D344.
- [Dashboard surfaces, database history amendment](../../rebuild/reference/dashboard-surfaces.md#sqlite-timeline-history)
  owns the pending event-storage, Activity, archive and retention changes to D218/D236/D301/D308.
- [Write safety, database history amendment](../../rebuild/reference/write-safety.md#sqlite-operation-history)
  owns replacing the committed-write outboxes while preserving fencing and exact evidence.
- [Operator trust](../../rebuild/reference/operator-trust.md),
  [workflow model](../../rebuild/reference/workflow-model.md), and
  [execution and sessions](../../rebuild/reference/execution-and-sessions.md) own evidence,
  checkpoint reuse, claims and lifecycle semantics.
- [Clock/config/secrets](../../rebuild/reference/clock-config-secrets.md), D321/D322/D332/D343,
  [guards and tests](../../rebuild/reference/guards-and-tests.md), §3.14 D191 and §5.2, and
  [frontend/backend integration](../../rebuild/reference/frontend-backend-integration.md) own
  upgrade/backup, protected data, gates, transport and parity.
- [Operation names](../operation-names/README.md), [command groups](../command-groups/README.md),
  and [worker names](../worker-names/README.md) remain unchanged. Consume their actual accepted
  integrations. Their old names in inspection evidence below are historical observations.
- [Phase 2.6 owner](../../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/README.md)
  retains its adapter-retirement, proof and closure work. This side assignment does not complete
  those tasks or resurrect retired historical formats/adapters. Reconcile newly admitted overlapping
  implementation before starting; shared migration/upgrade edits cannot run against moving owners.

This is a storage/read-path redesign, not workflow behavior, UI layout or general schema cleanup.
Keep operation/request/worker names from the predecessors, `run_checkpoints`, `checkpoint_payloads`,
`run_results`, operation/attempt identities, commands/audits, canonical run membership and existing
queue/archive doors. No checkpoint/event merge, new run-attempt table, run-link FK redesign,
automatic retry, UNKNOWN resubmit, external HR writes, legacy runtime dependency, cutover, push,
or automatic next-task dispatch. Keep artifact and run-terminal outboxes outside retirement unless
a separately approved amendment assigns their consumers. Notes are not part of this timeline move.

## Current mechanisms and feasibility

Planning inspected source, owning contracts, tests, Git and sanitized read-only target metadata.
It did not run a workflow, product test, migration, backup or UI. The three rename worktrees are
active; no implementation checkout is created for this successor during planning.

| Consequential question | Inspected evidence and required change |
| --- | --- |
| What is the timeline source today? | `src/infra/events/span-jsonl-writer.ts` writes the validated span union to per-workflow/day files. Worker, dashboard and dry-run-scenario compositions instantiate it. `run-queue-projection.ts` tails/rebuilds those files across processes. Replace all production event producers and the cross-process read path together in T1; an in-process callback is insufficient. |
| Are all events run-scoped? | `src/events/types.ts` includes run/task, worker/browser, gate, replay, omission and lifecycle events. Preserve each supported kind, scope and identity. Worker events may have no run ID; reused checkpoints retain their original observation and need a separate current-run replay event. |
| What makes a checkpoint different? | `src/domain/workflow/checkpoint.ts` stores output, schema/code identities, provenance and freshness. It may represent an operator assertion rather than execution. Keep loader/replay/freshness rules and output storage; timeline rows reference evidence rather than becoming resume authority. |
| Where does atomicity need work? | The write sequencer's committed operation, attempt, checkpoint and two outboxes are written in an authority transaction. Several executor terminal events use `afterAuthorityCommit`. T1 must move required state-change event persistence inside the owning transaction; only UI wakeups may remain after commit. External browser success is never made atomic with SQLite: preserve existing uncertain-submit recovery. |
| What unique transaction facts must survive? | The ledger outbox records actor, environment instance, confirmation/fence timestamps, optional external timestamp, completion kind, proof source, subject binding and exact identities. Some are not present on the operation row alone. T1 establishes the durable confirmed-operation event with these facts and exact operation/attempt/checkpoint references; T2 proves all required historical ledger facts remain reconstructible before removing any outbox. Never derive old actor/instance/configuration from current settings. |
| Does the ledger writer run? | `createLedgerProjector` is implemented and tested but has no production caller; the archive/Activity file reader is wired. T2 replaces those readers and removes the obsolete writer; it does not activate the currently unwired producer as a prerequisite. |
| How is Archive stored? | `archived_runs` already freezes row/detail/receipt/failure/sections while retaining the original terminal run. Transaction detail currently resolves `(system,date,sequence)` pointers against files. T2 adds a validated frozen transaction section to the same archive row, preserving original immutable content and command identities for historical rows. |
| What does Activity count? | The transaction block folds ledger entries by confirmed local date, system and prod/test instance. T2 uses confirmed automation operations from database history, once per operation/generation, including retained archived runs and excluding deleted runs. Observed-present discoveries, previews and mere successful workflow outcomes are not submissions. Other Activity metrics keep their current canonical sources. |
| What is deleted or retained? | D308 removes owned run/operation history behind a tombstone. Existing span files remain until their 30-day prune; ledger files are outside the normal prune. New SQLite ordinary events keep the 30-day policy; confirmed-operation history is retained until its authorized owner deletion. Archive snapshots remain until archive deletion. Shared operation/retry ownership must not be guessed from a single current `runId`. |
| Can the current backup prove file import? | `AuthorityBackupService` backs up SQLite, not a complete immutable set of span/ledger source files. T1 must add a verified stopped conversion source manifest/copy for the exact file bytes it imports, bound to the authority backup and upgrade receipt. A SQLite backup alone cannot establish replay of changed external files. |

Observed target at `2026-09-08T19:01:47.102584+00:00`:
`/Users/julianhein/Projects/hr-automation-rebuild/.tracker/state.db`, schema 33,
12 workflow runs, zero archives/deletion tombstones/operations/attempts/operation-outbox rows/
ledger partitions/ledger projections, two run-terminal-outbox rows, quick check `ok`, zero FK
violations. The root held three span JSONL files with 292 lines and zero JSON parse failures;
notes and ledger had zero files. This is syntax/count evidence, not full event-schema or historical
conversion proof. Empty operation/archive tables make populated historical fixtures essential.
Recheck exact target identity, schema, source-file content, permissions, locks and backup at each
explicitly assigned application. Never print private event payloads, credentials or canary values.

## Agreed data and lifecycle rules

**Timeline records.** Use one strict, versioned `timeline_events` authority table with durable event
identity, scope, recorded/occurred time, an indexed database-assigned ingestion cursor and validated
payload. The cursor is delivery order, not a fabricated cross-process causal clock. Preserve original
timestamps and stable tie handling. No per-day sequence-management table. Emitters append through a
shared database service; readers page by cursor and rebuild only derived views. A duplicate event
identity with exact content is replay; divergent content fails. Missing/corrupt evidence stays explicit.

Run/step outcomes, operations and checkpoints retain their own authority. Ordinary timeline rows
carry references and necessary display facts rather than full copies of checkpoint/failure/operation
records. A confirmed-operation event additionally retains historical facts that cannot safely be
derived later, plus validated references to the exact immutable proof/output. The migration must
demonstrate lossless reconstruction of existing ledger and committed-span payloads from retained
records. Do not drop a unique field because the current UI does not display it.

Store state-change events inside their state transaction: enqueue/claim/requeue/terminalization,
gate and checkpoint outcomes, and external-write settlement. Standalone observational events can
use their own append transaction. Preserve original callback settlement and claim-loss behavior;
event write failure cannot mask a possible external submission or permit another click. Tests must
inject failure at the actual transaction seams, not merely call an event repository directly.

**Retention and deletion.** Preserve ordinary event eligibility at 30 days using the original
append-day/time semantics, not the imported-at time. Retain confirmed-operation events until D308
owner deletion, irrespective of normal event pruning or archiving. Purge only explicitly eligible
classes; never cascade history because a UI cursor advanced. New run-owned timeline rows are
removed transactionally on authorized run deletion and included in its accurate tally. Worker-only
history follows its own ordinary retention. Preserve tombstones, command/audit history, non-terminal
delete refusal and ownership of shared retry evidence. Activity must not resurrect deleted history
from old files, an archive copy or an old export.

**Archive snapshots.** Retain the original run and its operational records. Archive membership
continues to be the existence of a valid archive row. Freeze the transaction section at archive time
with identity, displayed action, available confirmation and explicit absence, source/time/environment
and evidence references, using existing protected-data projection rules. Do not put secrets or
unredacted protected identifiers into a public snapshot. Capture against the same consistent database
snapshot as the archive. Subsequent workflow changes cannot change this frozen presentation.

Historical archive JSON, its original content digest, issued references and command replay identities
must remain valid. Add versioned transaction snapshot storage on the same archive row, with its own
integrity binding to the original archive identity, rather than rewriting historical content to make
its old digest invalid. New and enriched historical rows use one verified transaction-section reader.
Unknown historical detail is a reasoned absence, not an empty success list or an invented confirmation.
Large artifacts stay referenced and retain existing resource admission/download rules.

**Activity and exports.** Query a consistent snapshot of retained run/operation/attempt/confirmed-event
facts. Join by exact identities; do not count archive snapshots as new runs or count replayed success
twice. Keep local-day windows and UTC-source instants distinct, prod/test separation, protected-data
rules and current non-transaction metrics. Existing Activity CSV/XLSX exports keep their supported
shape but use the new source. Provide an explicit on-demand transaction-history export through the
CLI, with date/system selection and caller-selected output, using the same query and retained facts;
its exact command grammar is an implementation choice documented in CLI help and tests. It creates
an output file, not a continuously maintained authority. Do not overwrite an existing output silently,
add automatic exports or change the visual layout. Files already exported are not retroactively
rewritten when their source run is later deleted.

## Migration and source authority

Both units append new schema migrations after their accepted base; no released statement, digest,
historical backup fingerprint or tombstone is rewritten. Current floor/upgrade admission follows
D332's stopped, explicitly backed-up route, never an ordinary-startup conversion.

T1 inventories and validates original span sources under the exact rebuild root, with path/byte
identity, deterministic line provenance and a verified immutable conversion copy. Strictly parse
the current or explicitly admitted historical grammar; preserve original event identity and time.
Interrupted input, malformed rows, divergent duplicate identities, unexplained orphan references
or a changed source refuse conversion before committing its authority. A known deletion tombstone
explains excluded historical run events; record counts/disposition rather than creating phantom runs.
Keep separate legitimate events that happen to have the same timestamp or text. A committed import
resumes exactly once after a crash; imported files never remain an alternate live source.

T2 inventories old/new operation outboxes, ledger assignments and any actual ledger files. Coalesce
matching ledger/committed-span representations into the same confirmed-operation fact using exact
operation/generation identity and field agreement, not display text. Existing file bytes are evidence
to verify against their recorded digest, never an excuse to replace conflicting database facts.
Missing files do not justify dropping durable outbox content; a verifiable database reconstruction
may be used with its recorded provenance. Conflicting content or irrecoverable required identities
block before retirement. File-only history without a retained owner or an explanatory tombstone
requires an explicit disposition before conversion; do not silently manufacture operation/run rows.

Enrich historical archive transaction sections and verify new Activity/export results before dropping
`ledger_partitions`, `ledger_projections` and `operation_outbox`. Use a phased converter within the
stopped upgrade transaction/settlement protocol so a failure retains the original source and backup.
Retire production ledger readers/writers, span-file tail/rebuild and current aliases. Preserve admitted
historical adapters only; never let displaced JSONL, ledger files or old cache tables change a current
response. Original import files may remain as verified recovery material until explicit cleanup after
accepted application; they are not live authority, and this planning session deletes none.

## Unit ownership, order and checkout binding

Planning baseline: `d94cfcc6f452963ca490e383992f8a76c85fef72` on local master. This does not
satisfy the unfinished rename prerequisite. There are four registered worktrees at inspection;
execution must wait for owned predecessor cleanup and recheck the four-worktree ceiling.

| Unit | Owned outcome and source scope | Branch / absolute checkout | Required base |
| --- | --- | --- | --- |
| T1 `side/timeline-history-1` | Strict timeline schemas/repository/migrations, verified source import and backup/restore, span emitters and all worker/dashboard/scenario compositions, core/control lifecycle/gate/checkpoint/operation transaction seams, cross-process projection/timeline/log/worker readers and retention, current storage doctor/recovery, corresponding tests/guards/contracts/generated output. | Create `codex/timeline-events` at `/Users/julianhein/Projects/hr-worktree-timeline-events`. | Verified local master containing this approved plan and accepted `side/operation-names` integration with all its prerequisite/review/gate evidence. Resolve and record actual SHAs before edits. |
| T2 `side/timeline-history-2` | Database transaction-history query, Activity and existing exports, explicit CLI transaction export, archive derivation/storage/enrichment/protected read models, ledger/outbox retirement and write settlement adaptation, deletion tallies, current recovery/backup/upgrade readers, necessary dashboard models/copy, corresponding tests/guards/contracts/generated output. | Create `codex/history-views` at `/Users/julianhein/Projects/hr-worktree-history-views`. | Verified local master containing T1's accepted reviewed integration and this plan. Resolve actual SHA from this owner; no future SHA or dirty prerequisite import. |

T1 temporarily preserves the existing operation outboxes and ledger consumers for compatibility;
it also writes the canonical confirmed event atomically. T2 removes that temporary duplication after
proving source completeness. T1 must be independently runnable and gated; T2 cannot start against
unfinished T1 contracts. The temporary boundary is explicit and expires in T2, not a second permanent
authority. This sequencing is required by shared ownership and migration dependencies.

Each unit uses one GPT-6 Astra/high supervisor implementing locally, zero implementation workers,
and one fresh complete read-only `sup_review` on Astra/high (R1 for T1, R2 for T2). At most two
active agents per unit; no planning delegation. R2 covers T2 plus all T1/T2 interactions, not a partial
file review. Reviewers receive pinned plan/base/head/tree, complete diff, proof map and gate evidence,
not the author's implementation conversation. Fix and re-review required findings before acceptance.

Integration target is local master at `/Users/julianhein/Projects/hr-automation-rebuild`, only when
operator-assigned after complete review PASS and gates. Recheck ownership and target state, use the
assigned serialized `--no-ff` integration, gate materially changed combined inputs and re-review
behavioral conflict fixes. Remove only owned accepted worktree/branch from a safe checkout; no push,
automatic integration, next-unit dispatch or deletion of peer resources. New material scope,
retention, evidence loss, ownership or allocation conflicts return for amendment; routine fixes do not.

## Ordered work and proof

1. **T1 admission/design binding:** verify prerequisites, canonical authority contracts, module
   instructions/lessons and current consumers; record actual base and exact typed event/identity map.
2. **T1 storage/import:** implement authority table, strict replay/order/retention and stopped source
   conversion with backup/restore/interruption proof before any production-source switch.
3. **T1 producer/reader switch:** integrate every supported emitter and atomic state seam; replace
   cross-process tail/rebuild with database cursor reads. Preserve public timeline behavior and
   canonical run authority; capture required confirmed-operation facts while old outboxes remain.
4. **T1 acceptance:** prove P1–P5/P9, gate, commit/freeze, obtain R1, fix/re-review, then hand back
   for assigned integration/gates/cleanup. Record actual accepted base for T2.
5. **T2 history/archive/export:** implement database queries, frozen transaction snapshot and old
   archive enrichment, shared export query and protected output. Prove populated old/new results.
6. **T2 retirement:** convert/deduplicate remaining legacy history, remove two ledger tables and
   operation outbox plus their live dependencies, update deletion/recovery/retention and references.
7. **T2 acceptance:** prove P1–P9 as applicable to combined behavior, gate and obtain complete R2;
   fix/re-review, then assigned integration/gates/cleanup. No completion claim before these finish.

| Proof | Required result and forbidden effects |
| --- | --- |
| P1 Atomicity and identity | Real enqueue/claim/gate/checkpoint/terminal/write composites roll back required events with failed state writes. No saved committed operation without its required event. Duplicate exact delivery replays; divergent identity fails. Preserve pre-click fencing and UNKNOWN recovery; a post-click failure never authorizes a new click. |
| P2 Complete event scope | Run/task/worker/browser, gate open/resolve, failed/interrupted/cancelled, replayed checkpoint, operator assertion, omitted step and retry events remain correctly identified. Reuse does not pretend an old observation happened now. Concurrent real database connections and a restarted BFF observe each durable event once through paging/cursor reset; no in-process-only proof. |
| P3 Import and backup | Populated multi-file/multi-day histories import with preserved bytes/meaning/time and exact provenance. Same timestamp is not a duplicate key. Malformed/torn/divergent/changed inputs refuse before conversion. Verified file-source copy and SQLite backup bind the same stopped import. Test precommit failure, postcommit/pre-settlement failure, exact resume, no-write repeat, old/current backup admission and full restore. No phantom runs from orphan events. |
| P4 Retention and deletion | Thirty-day ordinary retention does not delete confirmed-operation history or archive snapshots. Local-day/UTC boundaries and expired historical import behave as specified. D308 removes only owned rows, updates honest tallies and excludes deleted transactions from Activity/export without destroying another retry's evidence. Corrupt/missing shared ownership fails rather than being guessed. |
| P5 Transitive readers | Composed queue, run detail, logs, worker cards, SSE, scenarios, storage doctor and recovery use SQLite events while canonical lifecycle remains the sole run authority. Stale files/cache mutations after conversion cannot alter a response. Lost UI notification is repaired by reading durable events. Full parity and build pass. |
| P6 History counts and integrity | Database Activity equals verified populated ledger history for retained runs: one count per confirmed automation operation, correct system/instance/date; no count for dry run, observed-present, replay, archive duplication or deleted owner. Every old ledger/span-outbox fact is reconstructible from retained records; missing file alone cannot erase a pending outbox. Conflicting legacy evidence blocks retirement. |
| P7 Archive truth | New snapshot and historical same-row enrichment show exact transaction details, explicit missing values and protected projections. Original archive JSON/digest, issued references and command replay remain valid. Changing current workflow code or deleting obsolete source files cannot change frozen archived presentation. Resource access still checks canonical archive membership. No sensitive data in public snapshots. |
| P8 Export and retirement | Existing Activity CSV/XLSX uses the same database query and preserves shape. Explicit transaction export supports selected range/system, safe output ownership and deterministic content for a pinned source snapshot; no automatic export or silent overwrite. Current retired tables/aliases and producer consumers are absent after T2. Historical recovery data does not become a fallback authority. |
| P9 Compatibility and unchanged semantics | All supported fresh/historical upgrade routes, settings/credential coupling, released migration fingerprints, checkpoint freshness/replay, operation proof/idempotency, commands/audits and non-terminal archive/delete admission remain correct. Guard replacements carry violating fixtures and inventory evidence. Notes, artifact outbox, run-terminal outbox and unrelated workflows retain their assigned behavior. |

## Gates and resources

Read nearest instructions before editing (`src/server/AGENTS.md`, `src/control/AGENTS.md`, and
`src/dashboard/AGENTS.md` where applicable). Use `/ui` for any dashboard changes; preserve layout
and existing user flows. Read relevant lessons by event, archive, recovery and deletion seams.

Focused iteration selectors include:

- `npm run test -- tests/unit/events/span-events.test.ts tests/unit/events/jsonl-writers.test.ts tests/unit/run-record-service/service.test.ts tests/unit/run-executor.test.ts tests/unit/worker-composition.test.ts tests/unit/dry-run-scenario-composition.test.ts`
- `npm run test -- tests/unit/write-sequencer.test.ts tests/unit/write-sequencer-restart-no-repeat.test.ts tests/unit/server/run-queue-projection.test.ts tests/unit/storage-span-authority-reconciliation.test.ts`
- `npm run test -- tests/unit/archive-model.test.ts tests/unit/archive-ledger-read-through.test.ts tests/unit/archive-protected-identity.test.ts tests/unit/ledger-activity-fold.test.ts tests/unit/server/activity-report.test.ts tests/unit/server/activity-export.test.ts`
- `npm run test -- tests/unit/storage-upgrade.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts tests/unit/storage-upgrade-tombstones.test.ts`
- `npm run test:architecture -- tests/unit/architecture/atomic-write-outbox.test.ts tests/unit/architecture/ledger-projector.test.ts tests/unit/architecture/archive-invariants.test.ts tests/unit/architecture/migration-history-immutability.test.ts`

Replace retired boundary tests with meaningful negative controls in the same unit; do not just remove
failing guards. Add actual cross-process, atomic rollback, historical import and snapshot tests for the
proof rows. Focused selectors do not replace full gates or require duplicate runs after unchanged full
coverage. Run lint whenever tests run. Group related corrections into logical exact-path commits.

| Boundary | Required checks |
| --- | --- |
| Each implementation commit/candidate | `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run test:parity`, `npm run web:build`, affected generated/document checks, `git diff --check`. Record exact tested SHA/tree, commands/exits, effective workers, logs and proof map. |
| Each material integration | Same checks on actual combined inputs; independent review renewed for behavioral conflict fixes. |
| Generated inputs | If affected, `npm run build:manifest`, `npm run stores:catalog`, `npm run roadmap`, then corresponding `:check` scripts. Never hand-edit generated output. Inspect descriptor closure even for comments; record guard inventory deciding evidence. |
| Planning/recording | D191 scoped links, instruction-pair/chain, affected doc guards/generated freshness and whitespace checks. No claim that unchanged code proves the redesign. Reuse only with original tested identity/result and inspected unchanged relevant inputs. |

Use installed runner/configuration, at most four effective file workers, and verify resolved project
settings before changing concurrency. Keep coverage free of this task's compiler/linter contention.
Independent typecheck/lint/freshness can overlap within verified resources; generation precedes its
check. Serialize mutable coverage/parity/build output and actual shared-target operations. Do not
weaken assertions, test membership, isolation, floors or timeouts or kill peer processes.

No live transaction is necessary for this storage/read redesign. Product acceptance uses populated
synthetic databases, immutable historical copies and composed offline consumers, not another UCPath
submission. Actual operator database application is separately assigned after accepted integration:
recheck target/schema/executable and stopped locks, take the verified backup including required import
sources, run `npm run cli -- storage upgrade --plan --json`, apply
`npm run cli -- storage upgrade --json`, then `npm run cli -- storage doctor --json` and sanitized
before/after data/history checks. Preserve settings, credentials, source evidence and intended runtime
state. No deletion of original import material until the explicitly assigned cleanup is safe and verified.

## Progress and launch status

- Approval: the operator's 2026-09-08 instruction to make this separate plan, retaining two tables
  for checkpoint versus timeline responsibilities and leaving the running rename plan unchanged.
- Notification: `Process operation names` acknowledged unchanged scope; no integration window
  was assigned there at the time of coordination.
- T1: **WAITING ON** accepted operation-name integration and execution-time ownership/capacity.
- T2: **WAITING ON** accepted T1 integration. No base SHA is invented for either future result.
- All implementation steps, P1–P9, R1/R2, integration, cleanup and real database application remain open.
- Planning validation (2026-09-08): roadmap document-binding guard passes 24 tests;
  `npm run lint` exits 0 with zero warnings; `npm run roadmap:check` reports fresh output.
  Sixteen plan links/anchors and owning-contract backlinks resolve; all test selectors exist.
  Nine instruction pairs remain byte-identical and project instruction chains remain below
  32,768 bytes. All unit/proof/review bindings are retained; both future branch/path pairs
  are available at inspection. All three earlier side plans remain byte-identical to
  baseline `d94cfcc6f452963ca490e383992f8a76c85fef72`. Whitespace checks pass.
  Only this new plan and its pending dashboard/write-safety/decision amendments change.
  Typecheck, coverage, parity, build and implementation review are unrun; no product-gate
  evidence is claimed or reused for this unimplemented design.

Each supervisor sends **Done / Now / Remaining** at start/resume and after every verified step,
before the next tool call, with review/integration/cleanup visible. Record actual plan/base/head/tree,
proof/gate evidence, findings and next step here; use `/handoff` for interrupted unique recovery state.
Stop after the assigned unit; no automatic next-unit dispatch. The launch prompt must include the exact
unit ID, absolute owner path, full approved plan SHA, branch/absolute checkout, resolved accepted base,
prerequisites and operator-assigned integration conditions, and this adaptation:

> This is an approved side-work assignment. The side plan is the task owner wherever /supervise
> refers to a task/phase section. Record progress, review, gate evidence and completion there.
> Do not create a phase number or mark roadmap tasks complete. Preserve repository contracts,
> independent review, required gates and authorized integration/cleanup conditions.
