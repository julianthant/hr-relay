# SQLite timeline and transaction history

> **Historical evidence, relocated 2026-09-09.** Original source: `46930920696ab214b036d5f2681b8ffb4e5620ea:docs/sidetracks/timeline-history/README.md`;
> source SHA-256 `ca29a158c724ab7a54bfacdf36e8a75375c4c0b53e1ed6b7ba2bf06f52c4d7ee`. Only this banner and Markdown link
> destinations changed during relocation. Requirements, candidate/review/gate/cleanup records below
> are preserved as recorded; old pending instructions are historical, not launch authority.
> Current remaining work belongs to [the combined workflow](../README.md), including
> [timeline T2](../timeline.md). Do not rerun completed work from an old prompt here.

> **Pending T2 ownership amendment — 2026-09-09.** The operator moved remaining T2 into
> [Phase 2.6.2's combined workflow](../timeline.md).
> The T2 allocation/launch instructions below are historical and must not launch duplicate work.
> Active T1, its candidate, requirements, gate schedule, review and evidence remain unchanged.
> Reconcile this pointer when integrating T1's plan evidence; do not replace that evidence.

## Assignment and approval

**Owner: `side/timeline-history`. T1 COMPLETE under the parallel execution amendment;
implementation, independent review, master integration gates and owned cleanup are finished.
Remaining T2 work belongs to the combined Phase 2.6.2 plan linked above.** This is a separate successor, not an amendment to
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
authorized by the original planning session alone. The later execution amendment below admits T1;
neither implementation unit is complete.

## Authorities and execution boundaries

- [Document routing](../../../../../../README.md), [root instructions](../../../../../../../AGENTS.md),
  [operating reference](../../../../../../../.agents/skill-library/repository-work/REFERENCE.md), and
  [roadmap governance](../../../../../../roadmap/roadmap.md), D1/D263/D344.
- [Dashboard surfaces, database history amendment](../../../../../reference/dashboard-surfaces.md#sqlite-timeline-history)
  owns the pending event-storage, Activity, archive and retention changes to D218/D236/D301/D308.
- [Write safety, database history amendment](../../../../../reference/write-safety.md#sqlite-operation-history)
  owns replacing the committed-write outboxes while preserving fencing and exact evidence.
- [Operator trust](../../../../../reference/operator-trust.md),
  [workflow model](../../../../../reference/workflow-model.md), and
  [execution and sessions](../../../../../reference/execution-and-sessions.md) own evidence,
  checkpoint reuse, claims and lifecycle semantics.
- [Clock/config/secrets](../../../../../reference/clock-config-secrets.md), D321/D322/D332/D343,
  [guards and tests](../../../../../reference/guards-and-tests.md), §3.14 D191 and §5.2, and
  [frontend/backend integration](../../../../../reference/frontend-backend-integration.md) own
  upgrade/backup, protected data, gates, transport and parity.
- [Operation names](operation-names.md), [command groups](command-groups.md),
  and [worker names](worker-names.md) remain unchanged. Consume their actual accepted
  integrations. Their old names in inspection evidence below are historical observations.
- [Phase 2.6 owner](../../README.md)
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

### T1 parallel execution amendment — 2026-09-08

The operator instructed **“do this in parallel”** after the prerequisite and capacity
check. T1 therefore starts alongside the rename integration, with one local supervisor
and no implementation workers. Its isolated branch is `codex/timeline-events` at
`/Users/julianhein/Projects/hr-worktree-timeline-events`, initially based on the accepted
operation-name recording commit `394bf4c631b5f01207cb3a3dd1aaaf06b1eb714c`.
The approved plan is copied without changes from
`121df12e817c3e19708217d1b9e22d50b8787477` before this amendment. This explicitly
replaces T1's launch wait and temporarily permits a fifth auxiliary worktree while the
four predecessor/integration checkouts remain occupied. No peer resources are changed.

The rename integration owns its combined schema numbering and master mutation. T1
owns only its isolated timeline implementation and records its additive migration after
the actual accepted rename sequence. No dirty predecessor files are imported. Before
T1 candidate gates and R1, reconcile onto the accepted integrated master and verify
all predecessor names, released migration bytes, historical adapters and recovery paths.
Integration of T1 itself remains separately operator-assigned after gates and R1 PASS;
T2 and real database application remain separate assignments.

Current execution: checkout admission complete; draft storage/import, emitter/reader
switch and atomic lifecycle/checkpoint/confirmed-operation wiring are in the isolated
working tree. Nothing is committed or integration-ready. The draft migration is
temporarily numbered 36 against its operation-name-only base; before candidate gates
it MUST move after the accepted worker35/operation36/command37 sequence, to 38, with
the boot floor and every historical schema threshold reconciled. The integration task
confirmed that sequence and exclusively owns its master and gate windows.

Focused iteration evidence (not candidate gates): the foundation timeline suite passed
11 tests with lint exit 0 before composition changes. The subsequent seven-file run
(`events/timeline-history`, `architecture/atomic-write-outbox`, `run-record-service/service`,
`command-kernel`, `server/run-queue-projection`, `storage-upgrade`, `storage-span-root-repair`;
`--maxWorkers=2`) exited 1: 223 passed, seven failed in 24.41 seconds, logged at
`/tmp/timeline-events-focused-2.log`. Its accompanying root lint exited 0 at
`/tmp/timeline-events-lint-3.log`. Failures were exact command replay's already-applied
state, three historical receipt fixtures carrying a future timeline field, a historical
raw-delete fixture retaining newly introduced FK rows, an obsolete file-doctor expectation,
and the atomic-commit guard's old signature. Corrections remain unverified. Typecheck's
last three reported issues were corrected but not rerun. No passing full gate is claimed.

New draft proofs exercise populated multi-file conversion, precommit source change,
postcommit interruption, exact resume without originals, explicit verified-copy selection
after old-backup restoration, cross-process cursor delivery, composed enqueue/claim/terminal/
gate rollback, confirmed-history reconstruction and retention, shared retry evidence and
last-owner collection. Current doctor and root repair consume SQLite; retired-file mutation
controls replace file-authority expectations. Assertion resume now records its exact original
checkpoint reference. Recovery-copy reads/writes use held synchronous directory traversal,
strict no-follow file reads, immutable hashes and backup binding. Additional negative controls
for gate-event persistence, damaged attempt ownership, symlinks and snapshot mutation await
execution. Syntax parsing passes across 64 changed TypeScript files; whitespace checks pass.

The rename-integration task owns the currently evidenced heavy-gate resource conflict
(lifecycle AST guard timing). Its short diagnostic window was acquired and released after
focused tests and lint exited. No owned gate process remains. A next approximately three-minute
diagnostic window is requested; code and fixture work continues independently. The peer's
accepted master integration and final migration identities remain prerequisites for candidate
gates, not a reason to discard or integrate unfinished work.

Latest iteration: the expanded 15-file run exited 1 with **433 passed / 3 failed**
in 31.69 seconds (`/tmp/timeline-events-focused-3.log`). Passing complete files:
atomic-write-outbox 12; command-kernel 65; dry-run-scenario-composition 21;
timeline-history 18; run-record-service 50; run-queue-projection 59; storage-restore-drill
25; storage-span-root-repair 2; storage-upgrade 29; worker-composition 37;
write-sequencer-restart-no-repeat 3; write-sequencer 52. The remaining failures were
executor outer-transaction visibility, the omission fixture's disconnected recording
emitter, and explicit undefined optional span fields reaching canonical serialization.
Those fixes are drafted; assertion replay and local-day retention controls passed.
Typecheck exited 2 for four branded-type comparisons/fixtures, now corrected but not
rechecked (`/tmp/timeline-events-typecheck-3.log`); accompanying lint exited 0
(`/tmp/timeline-events-lint-4.log`). No owned gate process remains.

Observed Vitest inherited project defaults produced up to four file forks despite CLI
`--maxWorkers=2`. The temporary adapter `/tmp/timeline-events-vitest.config.mts` imports
the real configuration and changes only root/project worker counts (root 2; unit 2,
architecture 1, scenario 1). A structural equality check excluding those exact keys
passed; membership, isolation, floors and deadlines remain unchanged. Verify observed
workers on its first use. No test configuration change is proposed for the repository.
Further draft corrections bind current replay claims, retain original optional historical
checkpoint claim metadata, record actual confirmation append time, use indexed filtered
paging, and refuse doctor reconciliation when timeline/run snapshots changed generation.
The unused recovery-cancellation callback and dashboard command-service writer/read ports
are retired; lifecycle persistence owns those events. New tests cover ordinary executor
checkpoint rollback and contradictory source-root refusal. Conversion now checks the selected
source history with the admitted historical scanner before importing, then rechecks exact
source/copy digests before commit. Archive ledger fixtures bind the retained run configuration
and instance; checkpoint fixtures establish their retained owner first. These changes await
the next focused/typecheck/lint window. Syntax parsing last passed across 68 TypeScript files;
subsequent small edits have only a passing whitespace check so far.

UI verification uses `/ui`'s narrow unchanged-rendering route (Components lead, local): no
frontend layout/copy/component change is intended; existing composed regressions and the full
project parity lane must verify that claim before candidate acceptance. No snapshots are refrozen.

The event map is explicit: `span` retains the strict existing run/task/worker/browser
wire; `checkpoint-recorded` binds a newly persisted checkpoint; `checkpoint-replayed`
binds the old checkpoint to the current run/claim without refreshing observation time;
`operation-confirmed` retains historical ledger fields and exact attempt/checkpoint
proof/output references. Timeline cursor and its authenticated JSON mirror are assigned
by SQLite; ordinary retention uses original append day, imported from the source filename.

Remaining implementation/proof work: verify current doctor and shared-evidence deletion,
complete checkpoint/assertion and transient lifecycle proof, adapt remaining real fixtures to
SQLite producers and mandatory atomic checkpoints, and resolve all focused failures. Verify
retention/date boundaries, malformed/missing ownership and stopped source-copy recovery.
Reconcile accepted rename master (timeline38/floor37), update contracts and guard evidence,
run every required gate/generated check, commit/freeze, obtain R1, fix/re-review, and hand
back for separately assigned integration/cleanup. P1–P5/P9 acceptance, full candidate gates
and R1 remain open. No live migration, HR write, push or T2 work occurred.

Latest diagnostics (fourth focused batch): 13 files, **419 passed / 5 failed**, 37.12 seconds,
`/tmp/timeline-events-focused-4.log`; typecheck exited 0
(`/tmp/timeline-events-typecheck-4.log`), lint exited 1 with one unbound-method test fixture
(`/tmp/timeline-events-lint-5.log`). Failures were two stale schema-floor fixtures, two BFF
file-backed span fixtures and a concurrent-doctor test expecting a returned report where the
existing outer snapshot guard throws. These are corrected but not rerun. The scheduling-only
external Vitest adapter constrained the observed process tree to two active unit workers;
no membership, isolation, timeout or floor changed. Every owned gate process exited and the
window was released to rename integration.

Source-only follow-up ports current recovery/diagnostic guards to SQLite and keeps filesystem
bounds, symlink, descriptor and transient-swap protections directly on the migration scanner.
Doctor history now carries its complete authority fingerprint from the same event read snapshot;
canonical reconciliation can separately name malformed owners. Root-directory traversal remains
no-follow. Timeline schema diagnostics expose only schema-owned fields, and source I/O diagnostics
withhold raw messages. Added negative controls cover immutable owner tuples, matching versus
contradictory deletion tombstones, source I/O privacy and ignored retired files. These latest
changes remain unverified beyond syntax/whitespace checks.

Under the operator's explicit parallel-work instruction, one bounded read-only `sup_scout`
(Astra/high, `/root/sup_scout_recovery_tests`) mapped the remaining recovery/privacy guards while
the supervisor implemented locally. It performed no edits or gates and returned its mapping;
zero implementation workers and the later fresh complete R1 remain unchanged. Native role-policy
check passed. No worker branch/worktree was created. A further approximately three-minute diagnostic
window is reserved after rename integration's current full gate chain. Release must notify both
rename integration and legacy task `01a082a7-ce00-7b83-8bb8-5ece9dfa8b7c`; neither peer's processes
or checkout may be modified. The accepted master prerequisite is still outstanding.

Latest diagnostics (fifth focused batch): 16 files, **607 passed / 4 failed**, 58.96 seconds,
`/tmp/timeline-events-focused-5.log`; typecheck and lint exited 0
(`/tmp/timeline-events-typecheck-5.log`, `/tmp/timeline-events-lint-6.log`). The four
failures were stale schema fixtures, an exact malformed-authority diagnostic expectation,
an unowned other-run event fixture, and the explicit SQLite-module boundary allowlist.
All four are corrected but await rerun. Atomic-write 14, timeline 19, upgrade 36, privacy 56
and 93 dynamic recovery cases passed. The adapter again produced two active file workers;
all owned processes exited and both peer tasks received the window release. Rename review
remains outstanding. A source audit also found the receipt seed compressed away attempt 1;
it now records that checkpoint during its actual first claim before requeueing attempt 2.
This fixture correction also awaits verification. Exact timeline identity replay now validates
retained ownership after an attempt advance; only a new event requires the current attempt.
A real-authority regression covers checkpoint/confirmation exact replay, divergent identity,
stale new-event rejection and unchanged generation. It awaits the next diagnostic batch.
No accepted-candidate evidence is claimed.

Sixth focused batch: 13 files, **327 passed / 1 failed**, 33.45 seconds,
`/tmp/timeline-events-focused-6.log`. All four prior failures, receipt attempt chronology,
exact checkpoint/confirmation replay after attempt advancement and the operator lifecycle
walk passed. The only failure was the deliberately stale trust-fold fixture lacking its
retained owner in the fold's separate SQLite fixture. It now seeds the supplied real run;
its original canonical gate assertions are unchanged. The focused rerun passed **6/6** in
2.40 seconds (`/tmp/timeline-events-focused-7.log`). Typecheck exited 0 before that final
fixture-only edit (`/tmp/timeline-events-typecheck-6.log`); full lint exited 0 afterward
(`/tmp/timeline-events-lint-7.log`). Two effective file workers were observed. Every process
exited and both peer tasks received the explicit window release. No known focused failure
remains, but final accepted-master reconciliation and all candidate gates remain open.

### Accepted rename reconciliation — 2026-09-08

The integration owner released accepted master **`1c8e294fe3510969c3a0f27dcf3506b922e4e42b`**
(schema 37/floor 36). Candidate `445fe42451b85701b805ceb98f5e5b1aa8d8440d` received complete independent review from `/root/sup_review_combined_names`: PASS, 67/67 paths and
no findings, 5,761 tests, 262 parity cases, typecheck and lint. These are predecessor evidence,
not T1 gates. T1 fast-forwarded from `394bf4c631b5f01207cb3a3dd1aaaf06b1eb714c` to that exact
accepted commit. Its 78 owned draft paths were saved in recovery stash
`a7058d8198b4cefc08076e5cf7e1a607b8c838fc` before restoration. The stash remains until verified
reconciliation; no other checkout, branch or stash was modified. Future planning through
`910ff111fd464d56621e2800bc5a8e5c22cb551f` remains intact.

The sides were accepted worker/operation/command-group storage changes and T1's timeline
implementation. Hunk decisions preserve both assigned behaviors:

| File | Resolution and source intent |
| --- | --- |
| `src/domain/authority.ts` | Keep released upgrade versions through 37; admit timeline 38 and require its source receipt only at 38. |
| `src/infra/compat/backup-inspection.ts` | Preserve renamed historical fingerprint layouts and admit schema 37 as historical. |
| `src/infra/compat/settings-database-upgrade.ts` | Keep command-group migration/credential ownership and add timeline source verification/import; both imports remain. |
| `src/infra/sqlite/authority-database.ts` | Keep command-group derivation and add timeline evidence/repository imports; the command implementation is preserved. |
| `src/infra/sqlite/migrations.ts` | Keep released worker35, operation36 and command37 statements byte-for-byte; append timeline38 and advance floor to37. |
| `src/infra/sqlite/recovery-contracts.ts` | Admit historical versions through37, preserving existing refused gaps. |
| `src/server/dashboard/commands/command-service.ts` | Keep shared command-group derivation; remove only imports whose old presentation/event emission dependencies were retired by T1. |
| `src/server/storage/upgrade.ts` | Pass both credential ownership and verified timeline source/copy arguments to plan and apply conversion. |
| `tests/unit/architecture/sqlite-settings-authority.test.ts` | Pin current schema38; retain all settings SQL assertions. |
| `tests/unit/server/compose-real-port.test.ts` | Preserve downgrade/no-settings-read guards; assert current38, floor37 and newer39. |
| `tests/unit/sqlite-authority-database.test.ts` | Preserve stopped-upgrade refusal, historical admissions and renamed request table; seed checkpoint owner and add timeline generation case. |
| `tests/unit/storage-restore-drill.test.ts` | Keep stopped-upgrade and timeline emitter imports and both restore proof sets. |
| `tests/unit/storage-upgrade.test.ts` | Preserve complete appended worker/auth/request tests and complete appended timeline import tests; extend historical admission through37. |

All 13 conflicting files have explicit resolutions; no conflict marker remains. The plan's
three-way merge preserved the accepted document and T1 progress. Syntax parsing passed all 78
changed TypeScript files. Migration38's appended framed digest is
`e4d84f51231d458c51fcc20524fe51e48b38a5ff42ae31b2557f7c7199fb0778`; earlier literals remain
untouched. Focused reconciliation and complete candidate gates are now running under the released
shared CPU window. Integration of T1 to master remains separately operator-assigned after R1.

Reconciliation diagnostics passed 425 cases and exposed three failures: the historical-layout
map lacked schema37, and the operation-deletion fixture combined incompatible workflow tuples.
The map now explicitly preserves schema37's command/delegation layout. Deletion inspects both
same-item evidence and rows explicitly owned by the run/its attempts, so contradictory workflow
or item metadata cannot silently escape validation. The deletion test aligns only its synthetic
owner tuple; the separately pinned historical source/fingerprint is unchanged. Real negative
controls refuse contradictory operation ownership without a tombstone or generation change.
The subsequent three-file batch passed **121/121**, 12.60 seconds
(`/tmp/timeline-events-reconciled-focused-2.log`).

The first full coverage attempt tested tree `e568aedfb3f7529572e27f2016e40390f874c444` using
the unchanged `test:coverage` command body (`test-runner.ts run --coverage` then `suite-size.ts`)
with the verified scheduling-only external config. The npm script's trailing `&& suite-size.ts`
means a trailing npm argument would not configure Vitest; the explicit body supplies the adapter
to the actual runner. Both effective workers were observed and no owned compiler/linter overlapped.
Result: **450 files; 5,811 passed / 13 failed**, 610.72 seconds, exit1
(`/tmp/timeline-events-candidate-coverage.log`); floors and suite-size did not complete.
Typecheck/lint before that run exited0 (`/tmp/timeline-events-candidate-typecheck.log`,
`/tmp/timeline-events-candidate-lint.log`). This is diagnostic evidence, not a passed gate.

The 13 failures were resolved as follows: executor/worker assertions now read the real SQLite
emitter and service-owned lifecycle facts; two synthetic descriptor codes now obey the existing
two-character trace grammar; repeat-root publication now uses the transaction's SQLite sink;
checkpoint-loss tests assert both terminal settlement refusal and reopening refusal; the private
SQLite boundary admits exactly the new conversion/repository modules; existing-authority conversion
requires a source digest explicitly before computing its identity. All **145 tests in the 10 affected
files passed**, 13.54 seconds (`/tmp/timeline-events-coverage-fixes-focused.log`). Assertions,
negative controls, membership, floors and deadlines were retained. Repeated complete gates remain
required. Nine instruction pairs match; largest project chain is 16,659 bytes. Manifest/catalog/
roadmap generation passed and produced no tracked differences.

### T1 candidate gate and proof record — 2026-09-08

Candidate status: **awaiting independent review (R1)**. The implementation and tests are complete
for T1, with P1–P5/P9 subject to independent acceptance. T2, integration, cleanup and actual operator
database application remain separately assigned. Candidate branch is `codex/timeline-events` in
`/Users/julianhein/Projects/hr-worktree-timeline-events`, based on accepted master
`1c8e294fe3510969c3a0f27dcf3506b922e4e42b`. No implementation worker wrote this candidate; the
bounded read-only recovery scout supplied navigation evidence only. The approved complete R1 will
review all 95 changed paths, including the contracts, fixtures, tests and shared-boundary interactions.

All runtime gates below tested frozen tree `824c3ca85f1612480c666e3570c6ff90fb34a19c`.
Only this evidence/wording record changes afterward; source, tests, configuration, dependencies,
reference snapshots and generated artifacts are unchanged. D191 reuse is explicit for those inputs.
The candidate commit is the commit containing this record; its exact SHA/tree and generated path
inventory are bound in the R1 dispatch rather than guessed before commit.

| Gate | Result and evidence |
| --- | --- |
| `npm run typecheck` | PASS, exit0; `/tmp/timeline-events-candidate-typecheck-2.log`. |
| `npm run lint` | PASS, exit0, zero warnings; `/tmp/timeline-events-candidate-lint-2.log`. |
| Full coverage command body with scheduling adapter | PASS, exit0: 5,824 tests / 450 files, 617.84 seconds; `/tmp/timeline-events-candidate-coverage-3.log`. Statements 85.98%, branches 77.99% (report-only), functions 90.12%, lines 88.25%; all configured floors pass. Suite-size completed: unit 353, scenario 17, architecture 80 files. |
| `npm run test:parity -- --workers=4` | PASS, exit0: 262/262, 1.2 minutes; `/tmp/timeline-events-candidate-parity.log`. No reference updates or skipped/flaky cases. |
| `npm run web:build` | PASS, exit0; `/tmp/timeline-events-candidate-build.log`. Nonfatal bundle-size warning remains. |
| `npm run build:manifest:check`, `npm run stores:catalog:check`, `npm run roadmap:check` | All PASS, exit0; generated outputs are current and unchanged. |
| Scoped evidence checks | All 16 owner links/anchors resolve, 9 instruction pairs are byte-identical, maximum project chain 16,659 bytes. `git diff --check` and staged whitespace checks pass. The affected roadmap document-binding guard passes 24/24 after recording (`/tmp/timeline-events-candidate-doc-guard.log`). |

The passing coverage command is the exact package-script body with its scheduling-only argument:
`npm exec -- tsx scripts/test-runner.ts run --coverage --config /tmp/timeline-events-vitest.config.mts`
followed by `npm exec -- tsx scripts/suite-size.ts`. The external adapter imports the checked-in
config and changes only effective file scheduling: root/unit 2, architecture/scenario 1. Two actual
forks were observed; no owned compiler/linter overlapped. Assertions, membership, isolation,
coverage floors and deadlines remain unchanged. After peer heavy-gate release, an intervening
unchanged-tree default-four-worker run passed 5,822 cases but timed out both lifecycle-SQL scans
(40.502s/34.845s; `/tmp/timeline-events-candidate-coverage-2.log`, exit1, 461.12 seconds). It finished
before termination was needed. The passing two-worker rerun completes those same checks in
27.918s/25.624s within the unchanged 30s deadlines. This is scheduling evidence, not a waived failure.

| Proof | T1 implementation and deciding coverage | Boundary retained for T2 |
| --- | --- | --- |
| P1 Atomicity and identity | `run-record-service/service.test.ts` injects required-event failures into create/claim/requeue/terminal/gate state transactions and outer queue-root rollback. `command-kernel.test.ts` covers gate-result/resume/event rollback and exact replay. `architecture/atomic-write-outbox.test.ts` checks checkpoint, operation, attempt, confirmed event and both compatibility outboxes at every injected storage step. `events/timeline-history.test.ts` covers exact/divergent event identity and replay after the owner's attempt advances. Existing write-sequencer restart/no-repeat and UNKNOWN/fence suites remain in full coverage. | Existing operation outboxes remain active; their retirement is T2. |
| P2 Complete event scope | `run-executor*.test.ts`, `step-omission-d313.test.ts`, `worker-loop.test.ts`, `claim-sweep-recovery.test.ts` and real scenario/operator walk cover lifecycle, gate, assertion, omitted-node and checkpoint replay events. `events/timeline-history.test.ts` uses a separate producer process and real SQLite connections to prove lost-notification/restart visibility, equal-time identity, fixed page horizon, cursor non-reuse and local-day retention. `server/run-queue-projection.test.ts` exercises the composed cursor reader/rebuild and worker/task folds. | New Activity/archive presentation is T2. |
| P3 Import and backup | `events/timeline-history.test.ts` checks multi-file bytes/provenance, original retention days, torn/malformed/changed sources, resource/path admission and recovery-copy identity. `storage-upgrade.test.ts` checks populated stopped conversion, contradictory/missing owner refusal, tombstone exclusion, precommit source change, postcommit interruption, exact resume and explicit source-copy recovery after old-backup restore. `storage-restore-drill.test.ts`, storage backup and historical admission matrices preserve old/current backup behavior. | Ledger/outbox-file conversion is T2. |
| P4 Retention and deletion | `events/timeline-history.test.ts` proves ordinary pruning preserves confirmed history and lossless evidence reconstruction; deletion preserves shared retry checkpoints/operations until the last owner, and rejects missing/contradictory owners without mutation. `run-record-service/service.test.ts` retains terminal-only admission, leaves-first deletion, tombstone replay and accurate timeline tallies. Archive rows are outside ordinary pruning. | Activity/export source replacement and archive transaction-section enrichment are T2. |
| P5 Transitive readers | Worker/dashboard/scenario compositions use the SQLite emitter. `server/run-queue-projection.test.ts`, BFF flow, stream, logs/collision and read-scan-bound tests exercise current readers; stale JSONL is ignored. Current doctor/recovery tests cover same-snapshot fingerprint/generation checks, corrupted timeline refusal, root reconciliation and stopped root repair. Full parity and dashboard build are candidate gates. | Activity remains on the explicitly preserved compatibility source until T2. |
| P9 Compatibility | Released migrations 1–37 and their immutable fingerprints are preserved; timeline migration38/floor37 is appended. Historical upgrade/admission, credentials/settings coupling, command groups, operation names, checkpoint/replay, proof/idempotency, archive/delete, notes/artifact/terminal outbox and unrelated workflow suites remain in complete coverage. Private SQLite boundary guards admit only the new repository/conversion modules; guard-inventory entries retain deciding negative-control evidence. | No ledger table or operation-outbox retirement is claimed. |

### R1 blocked review and repair round — 2026-09-08

Candidate `5cc60fa1626cd4069607b869904127b1fa593ab6` (tree
`7842d98c2b18d7acc8270f233c568c28f910d3b9`) received **BLOCKED**, not acceptance, from
`/root/sup_review_timeline_r1`. Automatic compaction ended the native review; no substantive review
continued afterward. Its initial pass inspected the 95-path inventory (5 docs, 34 production,
56 tests/fixtures), but final per-path/proof reconciliation, recovery counterexamples and some gate
evidence checks remained open. No partial coverage is carried forward as PASS.

| Finding | Evidence and repair disposition |
| --- | --- |
| R1-1 High: transitive retry deletion | Real service deletion in A→B→C removed A's checkpoint/operation while queued C survived. The temporary probe's before/after booleans are in `/tmp/timeline-events-R1-chain.json`; canonical service deletions both applied. Permanent keys/checkpoints are looked up by exact workflow/item, so collection now waits until no other retained run in that group can consume them. Owner/tombstone and peer identity checks remain strict. The three-generation regression confirms retention after B deletion and accurate collection on C deletion. |
| R1-2 Medium: presentation rename emitted a duplicate gate opening | Real create/claim/park/rename changed persisted gate openings and the production fold from 1 to 2 (`/tmp/timeline-events-R1-rename.json`). Transition journaling now compares the previous and resulting lifecycle before emitting a state-change event. Rename/replay preserves one event and one projected gate. |
| R1-3 P9 recovery concern, confirmed by supervisor | The prior changed M18 expected a healthy doctor after restoring a backup that lost a fenced run. No approved amendment retired §2.5/D332.7's warning. Its restored regression fails on `5cc60fa1`; current doctor now compares bounded, no-follow quarantined SQLite evidence with the same current authority snapshot. Missing runs and lost write attempts remain explicit warnings, without importing authority or reading retired JSONL. Unsafe, corrupt, changed or unsupported copies remain unavailable rather than healthy. |

The first two temporary probes ran against clean pinned `5cc60fa1`, with 2 selected cases passing as
measurements, not acceptance; the other copied cases were unselected. Lint on that pinned candidate
passed (`/tmp/timeline-events-R1-probes-lint.log`). The role-policy command reported the unused retired
`sup_terra.toml` definition; it did not pass globally. The dispatched `sup_review` itself matched
Astra/high/read-only policy. No personal configuration changed.

All three permanent regression assertions failed for the intended behavior before repair
(`/tmp/timeline-events-R1-regressions-red.log`). Initial repair exposed SQLite's legitimate read-cache
initialization and two eager-parse diagnostic regressions; those were corrected without suppressing
malformed current authority. The subsequent eight-file batch passed **227/227**, 18.13 seconds
(`/tmp/timeline-events-R1-focused-3.log`). The recovery family additionally covers a lost attempt while
the original run survives at the same version, explicit deletion accounting, corrupt/symlinked and
read-time-mutated copies, and file/database/byte bounds. First-read empty WAL/shared-memory cache
initialization is distinguished from changes to authority-bearing database/WAL bytes.

The first full repair coverage attempt on intermediate tree
`afa948a478191cb7d6bde7d2a0ee594157c554bf` was deliberately interrupted (exit143;
`/tmp/timeline-events-R1-coverage.log`) when a missing Settings wire consumer was found.
Only the verified owned runner group was stopped; no result is claimed for that incomplete run.
The strict dashboard wire union now accepts `restore-loss`, and both missing-run and restore-loss
rows display the possible-external-write warning. Three wire/rendered-state regressions first failed
(`/tmp/timeline-events-R1-settings-red.log`); the corrected three-file batch passed **60/60**
(`/tmp/timeline-events-R1-settings-green.log`). No layout, primitive or reference snapshot changed.

Typecheck/lint after the initial repair passed (`/tmp/timeline-events-R1-typecheck-3.log`,
`/tmp/timeline-events-R1-lint-3.log`); this interim checkpoint preceded the final repair gates recorded below. No DDL, released migration
fingerprint, note/artifact behavior, T2 ownership or integration authorization changes in this round.

Full repair coverage on tree `0f5e3826a68c88ae7e615174c1a9429c93e6c6fb` finished with
**5,836 passing / 1 failing** case, 450 files, exit1, 489.359 seconds
(`/tmp/timeline-events-R1-coverage-final.log`). The remaining operation-rename fixture expected
collection while another retained run shared the same workflow/item. Its updated regression now
asserts preservation after the first deletion, collection of exactly two outboxes, five attempts and
four operations at the last deletion, unchanged historical receipt names, and settled receipt tallies.
The corrected two-file deletion/timeline batch passed **43/43**, 10.07 seconds
(`/tmp/timeline-events-R1-deletion-neighbors-2.log`), and typecheck/lint passed
(`/tmp/timeline-events-R1-typecheck-6.log`, `/tmp/timeline-events-R1-lint-6.log`). The first
updated assertion exposed only tally array order; the final assertion retains exact order and counts.
This is the same R1 repair round; no production behavior changed after that coverage run.

Review sizing is reassessed before replacement: the complete working diff at this point measures
498,258 UTF-8 bytes / 8,500 lines. The single complete review format remains required; it is not split
into partial approvals. A fresh reviewer must independently cover the entire final inventory and
P1–P5/P9, reconcile all three findings, and prioritize bounded semantic diffs plus exact callers.
Historical progress prose and repeated fixture literals are not a reason to reread whole ledgers or
monolithic files; unchanged fixture identities can be compared directly by script, with deciding
assertions inspected at their sources. No prior partial verdict substitutes for unfinished scope.
If complete review cannot fit under that reading allocation, it remains BLOCKED and the review
arrangement must be reconsidered rather than repeating an unchanged oversized dispatch.

### Repaired T1 candidate — awaiting fresh complete R1b

The R1 repair candidate covers **98 paths** (36 production, 57 tests/fixtures and 5 documentation
paths) from accepted base `1c8e294fe3510969c3a0f27dcf3506b922e4e42b`. Runtime gates tested frozen tree
`f4e381c82a7fb20b4b5164dca985bf3379be9d9f`. Only this evidence record changes afterward; source,
tests, configuration, dependencies, generated artifacts and parity references remain unchanged.
The exact implementation/evidence commit and resulting tree are pinned in the R1b inventory/dispatch.
The complete P1–P5/P9 proof map above still applies, supplemented by all R1 regressions and the Settings
wire/rendered warning tests. Acceptance remains open until a fresh complete verdict.

| Gate | Result and evidence |
| --- | --- |
| Typecheck and lint | PASS, exit0; `/tmp/timeline-events-R1-typecheck-6.log`, `/tmp/timeline-events-R1-lint-6.log`. |
| Full coverage and suite-size | PASS, exit0: **5,837 tests / 450 files**, 526.49 seconds; `/tmp/timeline-events-R1-coverage-final-2.log`. Statements 86.00%, branches 78.04% (report-only), functions 90.16%, lines 88.28%; configured floors pass. Membership remains 353 unit, 17 scenario and 80 architecture files. |
| Full desktop parity | PASS, exit0: **262/262**, 68.998 seconds, zero skipped/unexpected/flaky; `/tmp/timeline-events-R1-parity.log`. No reference changes. |
| Dashboard build | PASS, exit0; `/tmp/timeline-events-R1-build.log`. Existing nonfatal bundle-size warning remains. |
| Generated freshness | Manifest, store catalog and roadmap checks all PASS, exit0; `/tmp/timeline-events-R1-manifest-check.log`, `/tmp/timeline-events-R1-catalog-check.log`, `/tmp/timeline-events-R1-roadmap-check.log`. Generation produced no changed artifact. |
| Scoped evidence checks | Roadmap document-binding guard PASS **24/24** (`/tmp/timeline-events-R1-doc-guard.log`); 9 instruction pairs match, maximum chain 16,659 bytes, all 16 owner links/anchors resolve. Roadmap freshness and whitespace checks pass. |

Coverage uses the same checked-in-config adapter and exact package-script command body recorded
above. Two actual forks were observed, with no owned compiler/linter overlap; no assertions,
membership, isolation, deadlines or floors changed. Runtime gates are reused only for subsequent
pure evidence edits under D191, with scoped document/instruction/link/freshness/whitespace checks.
The prior BLOCKED R1 is preserved without acceptance credit. R1b is fresh because R1 exhausted its
context and the repairs affect recovery and lifecycle/evidence boundaries. Bounded semantic reads
and primary-source proof reconciliation replace repeated whole-file/history dumps; the complete
98-path and P1–P5/P9 review scope is unchanged.

### R1b blocked review and additional proof — 2026-09-08

Implementation/repair HEAD is **`8747821c5fbc88567efd6b95b1b2e21a6bf8ff98`**, tree
`89ac2d3c1683e1d42b5f8d6bd0aa03207eb7c35d`, on `codex/timeline-events` in
`/Users/julianhein/Projects/hr-worktree-timeline-events`. The repair commit follows
`5cc60fa1626cd4069607b869904127b1fa593ab6`; accepted base remains
`1c8e294fe3510969c3a0f27dcf3506b922e4e42b`. Inventory is
`/tmp/timeline-events-R1b-inventory.json`. Review and probe execution left this candidate clean.

Fresh complete reviewer `/root/sup_review_timeline_r1b` returned **BLOCKED after unexpected automatic
compaction**. It generated the inventory and inspected semantic changes across all 98 paths,
verified unchanged released migrations 1–37, and inspected the principal gate logs and scheduling
adapter. It confirmed no new actionable defect before interruption. Its provisional inspection of
the three R1 repairs is not acceptance: final path/proof reconciliation, restored-lost-evidence/current
boot and historical recovery challenge, full failure-history reconciliation, requested probes and
applicable UI review procedure remained unfinished. Neither native review supplies complete-scope
acceptance. The bounded-reading adjustment did not make this complete native assignment fit; no
third unchanged native review is dispatched.

The supervisor completed R1b's requested external diagnostics against the unchanged pinned candidate:

| Probe | Deciding assertions and result |
| --- | --- |
| Required requeue event | A SQLite trigger rejects `run.requeued` inside real `RunRecordService.requeue`. Run, authority metadata/generation, timeline events, commands and audits remain identical; no journal entry survives. Removing the trigger permits the same request, then exact replay returns `applied-already` without changing state/generation/events/journal. Exactly one requeue event remains. |
| Multi-page read and cursor reset | Two real SQLite connections append 1,005 task events after one queued event. `readTimelineRecords` returns all 1,006 unique event IDs and consecutive cursors across three pages; production projection folds them once. A controlled lower cursor in this synthetic database triggers named degradation and one scheduled rebuild. Rebuild restores one retained event; a later append/ingest is counted once and repeated ingestion is inert. |

Both probes pass (**2/2 selected**, 110 copied cases unselected, 3.01 seconds, exit0;
`/tmp/timeline-events-R1b-probes-3.log`). Exact command:
`npm exec -- tsx scripts/test-runner.ts run --config /var/folders/pt/fjkm2v7952902hpx0jcdxfnh0000gn/T/timeline-r1b-probes-bcyb_o3x/vitest.config.mts -t 'R1b probe'`.
Sources copy the candidate fixtures with absolute imports and append only these diagnostics; they
live in that external temporary directory. Repository lint passed, exit0
(`/tmp/timeline-events-R1b-probes-lint.log`); this lint checks the unchanged repository, not external
copied harness files. Initial probe construction mistakes (wrong journal table name, then expecting
`applied` instead of `applied-already` on replay) are retained in `...R1b-probes.log` and
`...R1b-probes-2.log`; neither was a product defect. These final probe results have not yet received
complete independent acceptance.

A concrete standalone root-review prompt is prepared at
`/tmp/timeline-events-standalone-review-prompt.md`. It preserves complete 98-path/P1–P5/P9 coverage,
read-only independence, exact-candidate acceptance and all prior findings, while permitting verified
root-context recovery after compaction. The operator subsequently answered **“do it”** to the
standalone-review approval request, authorizing that arrangement and creation of the independent
Astra/high review task using the existing saved project directly and the pinned timeline checkout.
The explicit review amendment below replaces the pending proposal; integration remains separately
operator-assigned.

Cleanup is held pending acceptance. Recovery stash
`a7058d8198b4cefc08076e5cf7e1a607b8c838fc` contains 68 tracked plus 10 untracked draft paths;
all 78 exist in the committed candidate, with accepted-base reconciliation recorded above. Both
owned probe directories remain available for the next review; unrelated stash
`b5ba4102748f304ab4c22a10dddf0f5a52f317be` and peer resources remain untouched.

### Approved standalone complete review R1c — 2026-09-08

The operator's **“do it”** approves one fresh standalone root review task on GPT-6 Astra/high,
using the existing saved project directly and reading the stable timeline checkout. This complete
verdict replaces the unfinished native R1/R1b acceptance arrangement; neither partial review carries
acceptance credit. Scope remains all 98 candidate paths, P1–P5/P9 and relevant shared-boundary
interactions. R1c must independently reconcile every prior finding and the latest external probes.
No implementation worker or additional product scope is introduced.

Bind base `1c8e294fe3510969c3a0f27dcf3506b922e4e42b`, implementation
`8747821c5fbc88567efd6b95b1b2e21a6bf8ff98`, implementation tree
`89ac2d3c1683e1d42b5f8d6bd0aa03207eb7c35d`, and the evidence commit containing this amendment.
The supervisor resolves its exact SHA and pins it as frozen checkout HEAD in the launch prompt;
only owner evidence prose differs from implementation. R1c regenerates inventory and checks identity
before source reads and its verdict. Review is independent and read-only: no edits, write-producing
gates, servers, browsers, delegation, integration or external effects. Required validation returns
to the original supervisor task `01a082a8-92ac-7031-8eb2-31708e7b0aad`.

Automatic compaction is allowed for this standalone ROOT reviewer only. Before compaction it
checkpoints exact identities, evidence-backed per-path/proof dispositions, findings, remaining scope
and next checks in visible working state. On resume it verifies checkout/branch/SHAs/dirty state,
reconciles coverage and reopens uncertain deciding evidence. Missing state reopens coverage;
summaries alone cannot establish PASS. No context-limit increase, nested review or native-subagent
exception is authorized.

Acceptance requires one complete exact-candidate PASS, no required open finding or proof gap,
all prior-finding dispositions and verified mandatory gate provenance. Original supervisor retains
repairs, renewed gates/review, final evidence and cleanup responsibility. Master integration, live
application, T2 dispatch and push remain outside this approval. The temporary approval handoff was
consumed after git/evidence verification; all surviving state is in this owner and the launch prompt.

### R1c completed review and F1 repair — 2026-09-08

Independent standalone task `01a084d4-8279-7490-ade2-cd7e2fdfa19b` (Astra/high) returned
**CHANGES REQUIRED**, covering all 98 paths and P1–P5/P9 at implementation `8747821c5fbc88567efd6b95b1b2e21a6bf8ff98`
and frozen evidence `67ef93c50f8538123c83c2d95cbbbdc39707767f`. R1-1 and R1-2 were resolved;
R1-3 retained one P2 finding, F1. The review otherwise reconciled the complete candidate and prior
proof/gate history. It supplies no acceptance until F1's repair is reviewed.

F1's production diagnostic backed up a running v4 fenced attempt, committed it through
`executeSequencedWriteCommit` with the real lifecycle port (v5), restored the v4 backup, then ran
`sweepWorkerClaims`. Recovery parked the run at v5 without the committed attempt/checkpoint/event,
but doctor incorrectly changed from exit 1 to exit 0. The preserved database still held the confirmation.
This is loss of the required warning, not evidence of an automatic repeated click.
Deciding source: `/var/folders/pt/fjkm2v7952902hpx0jcdxfnh0000gn/T/timeline-r1c-sweep-probe-tsxs9dnl/restore.test.ts`;
measurement `/tmp/timeline-events-R1c-post-restore-sweep.json`; selected diagnostic and matching
repository lint logs `/tmp/timeline-events-R1c-post-restore-sweep.log` and
`/tmp/timeline-events-R1c-post-restore-sweep-lint.log`, both exit 0. The earlier direct-adapter probe
was insufficient on its own; the real settlement and startup sweep established reachability.

The permanent two-arm regression now uses that same production path. The clean red run
`/tmp/timeline-events-R1c-regression-red-2.log` failed only the lost-confirmation arm (expected doctor
exit 1, received 0); the already-accounted confirmation control passed. The initial red harness also
had an invalid heartbeat request; that setup error was corrected before the deciding red run.
The repair projects hashes of immutable confirmation content (excluding database-local cursor)
from the same read-only snapshot and requires preserved confirmations to remain accounted for
independently of run version/attempt IDs. Existing deletion identity and unsafe-copy checks remain.
The control restores a backup containing the confirmation and advances its run by a real heartbeat,
which must remain healthy. The full storage-command family passed 22 tests in
`/tmp/timeline-events-R1c-regression-green-3.log`. Initial typecheck/lint exposed missing branded
claim fields and a missing diagnostic-union narrowing in the copied harness. Those were corrected;
the intermediate `green-2` run exposed use of the full heartbeat-bearing claim schema where only
claim identity was needed. The final test parses the two branded identity fields and all 22 cases
pass. These were test construction defects, not additional production findings. Full renewed gates and commit-bound repair review
remain pending. No live authority was read or migrated.

### R1c repair candidate gates and renewed-review binding

The F1 repair is **awaiting independent repair review**. Runtime gate tree:
`b2169a5047408b08f48606b55562d6dfb97a00c1`; subsequent candidate-record prose in this owner is the
only difference. No code, test, contract, configuration, dependency or generated input changed.
D191 permits this recording commit to reuse those runtime gates with scoped documentation checks.

| Gate | Command / evidence | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck`; `/tmp/timeline-events-R1c-typecheck-3.log` | Exit 0 |
| Lint | `npm run lint`; `/tmp/timeline-events-R1c-lint-3.log` | Exit 0, zero warnings |
| Full coverage | `npm exec -- tsx scripts/test-runner.ts run --coverage --config /tmp/timeline-events-vitest.config.mts` then `npm exec -- tsx scripts/suite-size.ts`; `/tmp/timeline-events-R1c-coverage.log` | Exit 0; 5,839 tests, 450 files; 506.75 s |
| Coverage floors | Same full run | Statements 86.01%, functions 90.17%, lines 88.28%; floors pass. Branches 78.05%, report-only. |
| Membership/scheduling | Real config imported by scheduling-only adapter; observed two fork workers with no compiler/linter contention | 353 unit, 17 scenario, 80 architecture files; unchanged isolation, assertions, deadlines and floors |
| Desktop parity | `npm run test:parity -- --workers=4`; `/tmp/timeline-events-R1c-parity.log` | Exit 0; 262/262, 66.054 s runner duration; references unchanged |
| Production build | `npm run web:build`; `/tmp/timeline-events-R1c-build.log` | Exit 0; existing bundle-size warning |
| Generated freshness | `npm run build:manifest:check`, `npm run stores:catalog:check`, `npm run roadmap:check`; `/tmp/timeline-events-R1c-{manifest,catalog,roadmap}-check.log` | All exit 0; generated outputs unchanged |
| Documentation/whitespace | `python3 /tmp/timeline-events-doc-check.py`, `git diff --check`, `git diff --cached --check` | Nine equal instruction pairs, maximum chain 16,659 bytes, 16 valid owner links/anchors; whitespace clean |

Scoped recording checks also passed: `/tmp/timeline-events-R1c-record-doc-guard.log` (24/24)
and `/tmp/timeline-events-R1c-record-lint.log` (exit 0); roadmap freshness, instruction/link
checks and both whitespace checks passed after the evidence-only update.

Renewed review remains with independent standalone task `01a084d4-8279-7490-ade2-cd7e2fdfa19b`,
under the explicitly admitted same-task repair rule. It authored no repair. This bounded correction
restores the existing loss-warning requirement and changes no architecture or lifecycle identity.
It must reopen the six changed paths and relevant recovery/confirmation/deletion neighbors, verify
unchanged coverage against its complete R1c verdict, reconcile R1-1/R1-2/R1-3/F1 and P1–P5/P9, and
return a complete exact-candidate verdict. The supervisor pins the resulting implementation commit
and tree in the follow-up after scoped recording checks; no acceptance is inferred from green tests.

### Accepted T1 candidate and cleanup — 2026-09-08

**Candidate accepted; integration is not yet assigned or completed.** Independent standalone R1c
(`01a084d4-8279-7490-ade2-cd7e2fdfa19b`, GPT-6 Astra/high) returned **PASS** for implementation/evidence
commit `84d9158de1305a0cc790bee271de4e96e9f54fa1`, tree
`63be4ea9dc88f4e413259f5543d3771d4b20edc0`. Repair-review turn
`01a084f2-f365-78f0-ade4-f386ef926ad2` completed in 135.302 seconds. It independently reopened all
six repair paths and relevant confirmation/recovery/deletion neighbors, verified the other 92 paths
unchanged, and accepted the complete 98-path candidate (36 production, 57 tests/fixtures, five docs).
P1–P5/P9 all PASS. R1-1, R1-2, R1-3 and F1 are resolved; no required finding or proof gap remains.
The earlier native R1/R1b verdicts remain historical BLOCKED reviews and provide no acceptance credit.
The full verdict is retained in the review task and `/tmp/timeline-events-R1c-pass-verdict.md`;
its preceding complete path ledger remains `/tmp/timeline-events-R1c-complete-verdict.md`.
Reviewer gates were independently inspected supervisor logs, not reviewer-executed test runs.

The accepted implementation remains byte-unchanged while this owner records final provenance.
The runtime gate tree and all required passing candidate gates are recorded immediately above.
Final evidence uses D191 scoped documentation checks and verified reuse of unchanged code/test/
contract/configuration/dependency inputs; it does not require a new implementation review.

| Cleanup item | Verified disposition |
| --- | --- |
| Owned recovery stash `a7058d8198b4cefc08076e5cf7e1a607b8c838fc` | Removed after exact identity and clean accepted HEAD verification. All 68 tracked plus 10 untracked draft paths were incorporated; 50 match exactly and the other 28 have recorded accepted-base reconciliation or independently reviewed later changes. |
| Five temporary R1/R1b/R1c probe harnesses | Removed after review; their local `node_modules` symlinks were unlinked without touching the target. Logs, JSON measurements, review verdicts and permanent regressions remain. Historical probe-source paths above are now cleanup history. |
| `codex/timeline-events` / `/Users/julianhein/Projects/hr-worktree-timeline-events` | Retained for separately assigned integration; this is deliberate residue, not an integrated or stale worktree. |
| Peer worktree and stash | Preserved. Peer stash `b5ba4102748f304ab4c22a10dddf0f5a52f317be` remains; no peer branch, checkout or task was modified. |
| Standalone review task | Kept available with the accepted verdict; no task was archived as part of repository integration. |

The initial harness cleanup refused dependency symlinks before removing any harness directory.
Their exact local targets were then inspected, and only the symlink entries plus owned harness files
were removed. No active test, compiler, linter or parity process from this assignment remains.

Integration handback: use the accepted base `1c8e294fe3510969c3a0f27dcf3506b922e4e42b` and reviewed
candidate above; include this final evidence commit. Recheck current master drift and destination
ownership, obtain the separately assigned integration window, merge with required integration gates,
renew review for behavioral conflicts, then remove the incorporated branch/worktree. Do not infer a
future master SHA from this record. T2 remains a separately operator-opened unit after accepted T1
integration. No push, live database upgrade, HR transaction or T2 execution occurred.

Final recording checks: `/tmp/timeline-events-final-doc-guard.log` passed 24/24;
`/tmp/timeline-events-final-lint.log` exited 0 with zero warnings. Roadmap freshness, nine equal
instruction pairs, the 16 owner links/anchors and whitespace checks passed. Diff against accepted
`84d9158de1305a0cc790bee271de4e96e9f54fa1` contains only this owner evidence prose, so all accepted
implementation gates and the exact-candidate review remain applicable.

### Delivery assessment — accepted T1 candidate

The approved scope remained T1/P1–P5/P9, with one complete independent reviewer at a time and no
implementation workers. The operator's parallel execution amendment changed launch sequencing;
accepted naming integration changed the prerequisite schema/base. These are documented operator and
external/prerequisite changes, not evidence that timeline product requirements were omitted.

The first candidate required fixture/reader reconciliation after consuming the accepted naming base.
R1 then identified implementation/proof defects within already assigned lifecycle, retention and
recovery requirements: transitive retry evidence collection, duplicate gate openings on rename, and
lost possible-write warnings after restore. These findings form one repair round. Tracing the restore
finding through the strict dashboard wire and Settings renderer exposed another missing consumer;
the complete repair gate exposed one old deletion expectation. Earlier production-entry and
consumer-path checks for P4/P9 could have caught these before full candidate gates. No requirement
or test floor was waived.

Two native complete reviews suffered automatic compaction and returned BLOCKED; neither supplied
complete acceptance. R1b retained complete scope with a revised bounded reading allocation, but
still did not finish. The operator then approved standalone root review R1c with verified recovery
after compaction. Exact review outcomes remain in the provenance record. Gate logs distinguish initial
fixture failures, a default-four-worker lifecycle-scan timeout, the proven two-worker schedule, an
interrupted repair run, a completed stale-expectation failure and the final green run. These are
observed events, not an estimate of wasted time or quality. Total planning/implementation time and
parent-context counts were not measured; no savings or broader comparison is claimed.

R1c completed the full 98-path review and found one residual restoration defect: a real startup
stale-claim sweep advanced a restored run to the preserved run's version while confirmation evidence
remained lost. R1's comparison had conflated mutable lifecycle progress with retained evidence.
This was a second repair round within the existing restore-warning requirement. The correction
compares immutable confirmation content independently; the permanent regression uses the real
sequenced commit, backup/restore and worker recovery entrypoints, with an already-accounted control.
The first typed harness iterations exposed claim-schema and union-narrowing mistakes; those are
recorded separately from the product defect. Full renewed candidate gates passed and R1c repair review supplied final candidate acceptance. Earlier production-path recovery probes would have caught
this gap before candidate gating. No scope, safety rule, test floor or acceptance requirement changed.


- Approval: the operator's 2026-09-08 instruction to make this separate plan, retaining two tables
  for checkpoint versus timeline responsibilities and leaving the running rename plan unchanged.
- Notification: `Process operation names` acknowledged unchanged scope; no integration window
  was assigned there at the time of coordination.
- T1: **COMPLETE — INTEGRATED AND CLEANED UP**; accepted rename base `1c8e294fe3510969c3a0f27dcf3506b922e4e42b`, reviewed implementation `84d9158de1305a0cc790bee271de4e96e9f54fa1`.
- T2: **MOVED** to the combined Phase 2.6.2 owner linked above; no duplicate launch from this historical plan. T1 integration is complete.
- T1 implementation, complete R1 acceptance, candidate/integration gates and owned branch/worktree cleanup are complete. T2 and real database application have not started here.
- Planning validation (2026-09-08): roadmap document-binding guard passes 24 tests;
  `npm run lint` exits 0 with zero warnings; `npm run roadmap:check` reports fresh output.
  Sixteen plan links/anchors and owning-contract backlinks resolve; all test selectors exist.
  Nine instruction pairs remain byte-identical and project instruction chains remain below
  32,768 bytes. All unit/proof/review bindings are retained; both future branch/path pairs
  are available at inspection. All three earlier side plans remain byte-identical to
  baseline `d94cfcc6f452963ca490e383992f8a76c85fef72`. Whitespace checks pass.
  Only this new plan and its pending dashboard/write-safety/decision amendments change.
  At that planning checkpoint product gates and implementation review were unrun. The later T1
  candidate gate record above supersedes that historical implementation status only.

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

### Operator-assigned T1 integration — 2026-09-09

The operator's “do it” assigned local master integration of accepted T1. Preparation reused
`/Users/julianhein/Projects/hr-worktree-timeline-events` on temporary branch `codex/timeline-merge`;
no additional worktree or worker was created. The original candidate remains
`535c16c6650ac0aa7cd818cd4480c58de51b0f87`, including accepted implementation
`84d9158de1305a0cc790bee271de4e96e9f54fa1` and complete R1c PASS.

Initial target `58d4fbcba32197e088a7fd162a54854ae73f8fbe` merged without conflicts. Tested tree
`707c506ad3dbf1f8841ff10984345eee6886bc7c` was committed as the no-ff checkpoint
`6bbf8492cc027dc5e10123c4b3a608b6d8bfc86a`. All integration runtime gates were rerun:

| Gate | Evidence | Result |
| --- | --- | --- |
| Typecheck and lint | `/tmp/timeline-integration-typecheck.log`, `/tmp/timeline-integration-lint.log` | Exit 0 |
| Full coverage | `/tmp/timeline-integration-coverage.log` | 5,839 tests / 450 files; 528.84 s; exit 0 |
| Floors and membership | Same coverage run; imported real config, observed two forks, no compiler/linter contention | Statements 86.01%, functions 90.17%, lines 88.28%; floors pass. Branches 78.05%, report-only. 353 unit / 17 scenario / 80 architecture files. |
| Desktop parity | `/tmp/timeline-integration-parity.log`, retained JSON `/tmp/timeline-integration-parity-results.json` | 262/262; exit 0, 68.253 s runner duration; references unchanged |
| Build | `/tmp/timeline-integration-build.log` | Exit 0; existing bundle-size warning |
| Generated freshness | `/tmp/timeline-integration-{manifest,catalog,roadmap}.log` | All exit 0 |

During those gates, master received policy commit `d61dc6fe6efc3f0c47ebe5581991a2d45e7ee2fc` and
combined planning commit `a524b70bf43e0c5ad0587d8c0ce38d7054a78686`. Planning task
`01a07ea4-e289-73a2-a4b4-2f0a4b461f48` explicitly released shared-target writes at the latter SHA.
Both commits are preserved. Their merge was conflict-free; its only T1 owner change was the six-line
T2 ownership pointer above. T2 belongs to the combined Phase 2.6.2 plan and is not dispatched here.

The final combined tree differs from the runtime gate tree only in committed planning/policy docs,
their generated roadmap, and this integration record. An explicit diff proved unchanged `src`,
`tests`, `scripts`, runtime config, package files and build/test configuration. New policy preserves
T1's in-flight requirements/cadence. D191 therefore permits verified runtime-gate reuse while rerunning
the affected roadmap/documentation checks. Those pass 24/24 in
`/tmp/timeline-integration-doc-guard.log`; instruction/link checks verify nine equal twins,
a 16,921-byte maximum chain and 17 owner links. The inherited `parallel-finalizers.md` had one extra
blank line at EOF; it was removed without changing prose after the whitespace gate identified it.
No behavioral conflict or acceptance change requires another implementation review.

Shared-master uncommitted deletions of the three predecessor sidetrack READMEs and the two untracked
handoffs remain outside T1 ownership. They must survive the master update unchanged. Candidate
integration and final cleanup will be verified before this task reports completion; no live upgrade,
HR transaction, T2 execution or push is included.

### Verified T1 closure — 2026-09-09

Local master was advanced to the combined no-ff merge, initially `40c43b5cdbf9974cf3bf2272fc2a1c9e50e17576`,
with accepted T1 and planning release `a524b70bf43e0c5ad0587d8c0ce38d7054a78686` in its ancestry.
This final evidence update amends that merge commit; no implementation or acceptance input changes.
The complete independent PASS and full integration gates recorded above remain applicable.

After master advancement, exact comparisons verified all three unrelated predecessor-plan deletions,
two untracked handoffs and the unstaged/index patches unchanged. No uncommitted peer content entered
the merge. Cleanup verified no process held the T1 checkout as cwd; its ignored contents were only
inspected generated coverage/build/parity outputs, local dependencies and a zero-byte parity lock.
Ordinary `git worktree remove` succeeded without force; the physical path and registration are absent.
`git branch -d` removed both incorporated `codex/timeline-events` and `codex/timeline-merge` refs.
Only the main checkout remains registered; peer removals were performed by their respective tasks.
The completed standalone R1c task was archived by its exact recorded identity. The calling task
remains available. The unrelated stash and handoffs are preserved; there is no owned cleanup residue.

T1 is complete. No push, live authority upgrade, HR transaction or T2 execution occurred. The next
work is governed by the combined Phase 2.6.2 owner, not this plan's historical T2 launch instructions.

Closure recording gates: `/tmp/timeline-integration-closure-doc-guard.log` passed 24/24,
`/tmp/timeline-integration-closure-lint.log` exited 0, and the closure roadmap freshness check passed.
Nine instruction twins remain equal, maximum chain 16,921 bytes, and all 17 owner links resolve in
the candidate tree. The three predecessor files intentionally absent from the shared working copy
were checked through their committed blobs; this does not label those unrelated deletions clean.
Only owner evidence prose changes after the final gated combined tree; runtime acceptance remains
bound to the recorded code/test/configuration identity. Whitespace checks pass.
