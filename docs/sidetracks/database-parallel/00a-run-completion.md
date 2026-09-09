# Run completion storage

## Archive-report amendment — 2026-09-08

The operator approved moving completed archived runs out of live storage into independent saved
reports. This plan continues to own live completion/failure semantics. It supplies the complete
settled completion/results/failure/receipt values to the archive conversion boundary and proves
removal cannot strand shared evidence. It does not implement a second archive database or transfer.
Historical snapshot readers below are required only at supported conversion/restore boundaries;
after report conversion, the archive viewer must not depend on this plan's live run schema.
P4 must additionally prove the saved completion report remains readable after its live rows and
old workflow implementation are removed. Original byte/digest checks still apply to source evidence
before conversion; converted reports have their own verified integrity.

The approved [run-summary owner](../database-remaining/README.md#approved-group-5-dryrun-results-and-shared-run-summaries)
also consumes completion/result/receipt/failure facts. Bind settlement and relevant summary updates
through the shared prerequisite so Queue/Activity agree after commit. This unit owns completion,
not a second summary schema or calculation; reconcile overlap before revised dispatch.

Archive design owner: [independent archive reports](../database-remaining/README.md#approved-group-3-independent-archive-reports-and-no-relaunch).
This is a planning amendment. Preserve existing in-flight gate schedules, candidate evidence and
accepted work; it does not launch implementation or reschedule reviews. New launch readiness awaits
the complete revised allocation and verified prompts.

## Assignment and approval

**Owner: `side/run-completion`. Prerequisite A in the [parallel execution plan](README.md). Implementation
WAITING ON accepted integration of `side/timeline-history-2` and its unchanged prerequisites.**
The operator's 2026-09-08 parallel-execution amendment removes the provider-usage dependency.
Complete this whole assignment before the shared foundation; leave the four running plans unchanged.

On 2026-09-08 the operator approved `run_failures`, questioned the need for a separate completion
authorization table when the run already owns its worker assignment, and selected removal of the
unused run-result outbox. After the proposed design and separate-plan boundary were explained,
they instructed **“okay lets do it.”** This records approval to prepare this plan; product
implementation belongs to a fresh supervisor session.

The three changes are:

1. Move the evidence in `run_terminal_authorizations` onto `workflow_runs` as a strict, immutable
   completion record, then remove the authorization table.
2. Rename `failures` to `run_failures` with unchanged failure IDs, meaning and consumers.
3. Remove `run_terminal_outbox` and its unused delivery machinery, contracts and pending counts.

Keep active ownership on the run, `run_results` for successful output, and `timeline_events` for
history. Save completion, result/failure and the required timeline event in one authority transaction.
No worker-history table, new run-attempt table, replacement outbox or separate completion table.

## Authorities and boundaries

- [Root instructions](../../../AGENTS.md), [document routing](../../README.md),
  [roadmap governance](../../roadmap/roadmap.md), and
  [operating reference](../../../.agents/skill-library/repository-work/REFERENCE.md).
- [Dashboard surfaces: run completion storage](../../rebuild/reference/dashboard-surfaces.md#run-completion-storage)
  owns this pending amendment to D110/D114 and D330 completion, replay and storage presentation.
- [Execution and sessions](../../rebuild/reference/execution-and-sessions.md),
  [workflow model](../../rebuild/reference/workflow-model.md),
  [operator trust](../../rebuild/reference/operator-trust.md), and
  [write safety](../../rebuild/reference/write-safety.md) retain claim, result, failure and submit rules.
- [Clock/config/secrets](../../rebuild/reference/clock-config-secrets.md), D321/D322/D332,
  owns backup/upgrade and paired authority. [Guards and tests](../../rebuild/reference/guards-and-tests.md),
  §3.14 D191, owns gates; [frontend/backend integration](../../rebuild/reference/frontend-backend-integration.md)
  owns wire shapes and parity.
- [Timeline history](../timeline-history/README.md) T2 is the direct predecessor; consume its completed
  event authority and retired operation outbox. The [parallel execution plan](README.md) places this completion
  assignment before all remaining shared-schema work. Provider, diagnostics and artifact peers cannot
  modify this assignment's shared files while it runs.

Own the run/completion/failure domain and repository contracts; terminal factories and executor/service
callers; SQLite migrations, integrity, recovery, deletion and backup adapters; failure references;
Storage Doctor's obsolete count in CLI/BFF/dashboard; associated tests, generated catalogs and owner
documentation. Read nearest instructions, including `src/server/AGENTS.md`, `src/control/AGENTS.md`
and `src/dashboard/AGENTS.md` where applicable; read linked lessons for each changed seam.

Do not change assignment/heartbeat policy, queue membership, retry behavior, workflow outcomes,
checkpoint/result meaning, diagnostic retention, protected-data projection, external-write fencing,
UNKNOWN resubmit rules, provider wiring or archive membership. No new notification/export/delivery
consumer. UI scope is removing the obsolete Storage Doctor count and required schema adaptation;
no layout redesign or new completion panel. No runtime reading from retired tables as a fallback.
No live HR writes, automatic database application, push, cutover or automatic next-task dispatch.

## Current mechanisms and feasibility

Planning inspected master `7ebda4975f29564d87282159229e7efc8861504e`, source, contracts and sanitized
read-only target metadata. This SHA is an observation base, not the future implementation base.

| Mechanism and source | Required preservation or change |
| --- | --- |
| `src/domain/run/record.ts`: active lifecycle carries worker ID and heartbeat; `claimGeneration` survives requeues and increments on each assignment. Terminal lifecycle drops the active worker fields. | Retain this active ownership protocol. Completion preserves the accepted finishing worker and generation separately from current ownership, on the same run row. |
| `src/domain/run/terminal-authorization.ts` and `core/terminal-authorization.ts`: evidence binds run/workflow/attempt, descriptor identity, expected version, worker/generation, timestamp and exact result/failure consequence. | Move this information; do not reduce it to a worker name. The immutable completion identifies the exact accepted settlement after active ownership ends. |
| `authority-database.ts` terminal composites check ownership/version, authenticate result construction and dependencies, then atomically write authorization/result-or-failure/outbox/run. Replay compares exact content and final consequences. | Replace the authorization insert with run completion storage and remove outbox creation; preserve initial authorization and divergent replay refusal. Include predecessor timeline writes in the transaction. |
| `domain/run/terminal-outbox.ts`: a pending result handoff, containing run/workflow/attempt/result digest. Source search found insertion, read/integrity and diagnostic consumers, but no active delivery consumer. | Retire it without replacing it. Preserve any historical receipt needed for old replay/integrity; do not invent an event delivery obligation or claim an old pending item was delivered. |
| `diagnostic_bundles` and `evidence_receipts` have failure foreign keys; failures also serve fingerprint searches, remediation, diagnostics and archives. | Rename the full storage contract and constraints while retaining IDs, fingerprints, evidence and consumer behavior. A log/event is not a replacement failure record. |
| Storage Doctor serves `runTerminalOutbox` through recovery contracts, server summary, dashboard settings and parity fixtures. | Remove the live metric everywhere together. Preserve historical backup parsing through explicit versioned readers. Update reviewed parity for the intentionally removed text. |
| Explicit Retry creates a new linked run; recovery may requeue an interrupted run in place. Existing authorizations cover done/failed, not every cancelled/interrupted outcome. | Preserve retry/recovery and existing outcome distinctions. Do not fabricate a worker completion or mandatory success/failure evidence for cancellation/interruption. |

Actual target at `2026-09-08T20:59:57.440538+00:00`:
`/Users/julianhein/Projects/hr-automation-rebuild/.tracker/state.db` had 12 workflow runs,
12 authorizations (two done, ten failed), two run results, ten failures, two pending terminal outbox
rows and zero archive rows. Quick check was `ok`; FK violations were zero. Payloads, credentials
and subject values were not printed. This is count/health evidence, not full migration proof. Populated
archive, historical-version and divergent-state fixtures remain necessary. Recheck target identity,
schema, supported upgrade floor and stopped ownership before any separately assigned application.

## Completion and migration contract

**Active versus completed ownership.** Keep the existing active claim as the sole permission to
work. Add a strict versioned completion value to the run authority, stored in its row rather than
another table. It binds the exact accepted done/failed outcome, finishing worker ID, assignment
generation, pre-completion expected version, completion timestamp, execution/descriptor identity,
and result digest or failure ID. Bind fields already on the run rather than maintaining contradictory
copies. The physical indexed-column/JSON representation is an implementation choice; SQL and domain
validation must agree. The completion record is historical authority, not a live worker claim.

Completion is absent before settlement. Once accepted it cannot be edited by rename, archive, retry,
heartbeat or stale callbacks. The current code's consequence check assumes the completion immediately
follows the expected run version; preserve equivalent exact-settlement evidence while accommodating
only already-authorized later mutations. Do not weaken replay to “the run is already finished.”
Keep the factory seal, exact checkpoint/dependency/result validation and failure node validation.

Cancelled and interrupted states retain their current authorized transition paths and available
provenance. They must not gain fabricated worker IDs or success/failure records merely to fit the new
schema. Requeued interrupted runs regain a fresh active claim; an explicit Retry keeps the original
run and its completion intact and creates the existing linked new row. This assignment moves the
existing done/failed authorization responsibility, not every lifecycle transition into a new protocol.

**One completion transaction.** Validate the current claim, generation, version and state before
writes. Save the immutable completion on the run, its matching result or failure, and the required
SQLite timeline event together. Failure at any database write rolls back the whole transaction;
after-commit notification loss cannot erase completion. Exact replay returns the accepted outcome
without duplicate rows/events. Changed worker/generation/version/result/failure/time under the same
settlement identity refuses. Preserve external-effect uncertainty: a database error after an HR
submission never authorizes another submit.

Assignment history stays in predecessor timeline events. Verify that existing claim/reassignment
and completion events retain the relevant run/worker/generation identity and fill only missing
producer fields necessary to satisfy this contract. The current run claim remains authority; never
pick the latest timeline timestamp to decide ownership. Worker-only events are not run completions.

**Historical migration.** Use the supported stopped upgrade path, with appended migration versions
and unchanged released statement fingerprints. Join each historical authorization to its exact run
and result/failure; validate its original version, claim, timestamp and consequence before moving it.
Preserve run IDs, logical versions, generations, timestamps, result/failure digests and fingerprints.
Do not fabricate history from the current worker or current configuration. Missing or conflicting
authority fails with an actionable typed refusal; it is not silently repaired or discarded.

Validate old outbox identity against the accepted result/authorization before retirement. Preserve
legacy-only identity/receipt bytes in a versioned historical completion extension when required for
supported exact replay or historical inspection, including any projected receipt. This is inert
migration provenance, not another pending queue, delivery obligation or newly generated outbox ID.
New completions have no outbox identity. Old same-request replay remains exact; a changed legacy
outbox identity cannot be normalized into an accepted replay. Explicitly define supported historical
input adapters and keep their scope separate from new runtime contracts.

Keep source content, original digests, evidence receipts, issued references and command replay
identities valid through this completion conversion. Historical archive inputs may embed the old
run representation: admit them at the supported conversion/restore boundary, then let the archive
owner produce an independent report with separately verified integrity. Do not require historical
run-schema readers in the final archive viewer. Before the archive transfer lands, existing views
retain their current membership; afterward, archive lookup resolves the independent report and live
completion is removed only after verified capture. D308 deletion remains distinct from transfer and
preserves its tombstone/shared-evidence rules.
Failure rename preserves diagnostic/receipt FKs, searchable fingerprints, indexes and integrity checks.

Retire the two physical tables, inserts/read repositories, current serializers, pending metrics and
obsolete guards together. Replace safety guards with equivalent completion/result/run checks; never
remove a safety assertion merely because it names a retired table. Historical backup/upgrade adapters
may recognize old tables strictly as historical input. No dual-write or permanent duplicate authority.

## Execution and proof

1. **S1 Admission:** verify accepted timeline T2 integration and existing prerequisite ancestry, approved
   plan availability, current consumers, scope ownership, instruction/lesson requirements and base.
   Record the exact completion representation, old/new replay map and immutable archive handling.
2. **S2 Storage and migration:** implement versioned run completion, failure rename, old-record
   conversion, integrity and restore support with populated negative fixtures.
3. **S3 Runtime and retirement:** adapt both terminal composites, factories and callers; preserve
   timeline atomicity/history; retire the outbox and Storage Doctor count across all served shapes.
4. **S4 Acceptance:** complete proof/gates, commit and freeze candidate, obtain independent review,
   fix/re-review, then operator-assigned integration, integration gates and owned cleanup.

| Proof | Required result and negative control |
| --- | --- |
| P1 Ownership | A loses assignment 1, B takes assignment 2: A cannot finish, B can. A later owns assignment 3: its old assignment 1 still cannot finish. Competing connections cannot accept conflicting outcomes. Wrong version/state/worker/generation fails before writes. |
| P2 Atomicity and replay | Inject failures at each actual composite write, including timeline append; no partial completion/result/failure/event survives. Simulate commit followed by lost acknowledgement and reopen: identical replay returns the same settlement, divergent replay refuses without new events. Existing result factory/dependency and failure-node negative controls remain effective. |
| P3 Migration and recovery | Populated done/failed plus cancelled/interrupted/active/requeued fixtures migrate without fabricated completion or changed logical identities. Partial/mismatched authorization/outbox/result rejects atomically. Supported old backup restore, interrupted upgrade before/after commit, exact resume and repeated no-write upgrade pass. Old divergent outbox replay still refuses. |
| P4 Lifecycle and archives | Explicit Retry creates a new linked run and leaves original completion unchanged; interrupted requeue remains valid. Archive/rename and supported later commands preserve immutable completion and issued fingerprints. Old archive snapshots still parse without byte/digest rewrites. D308 retains tombstones and removes exact owned records without damaging shared evidence. |
| P5 Failure and transitive consumers | Failure lookup/search/fingerprint/remediation, diagnostic bundles, evidence receipts, child-result joins, queue/detail/Archive and timeline keep exact behavior. Failure FKs remain valid. Completion information is not leaked into public protected-data projections. |
| P6 Retirement and presentation | New success creates no outbox or replacement delivery obligation. No current reads/writes of retired tables remain. Storage Doctor CLI/BFF/dashboard removes only the obsolete metric; supported historical backups still inspect correctly. Guard replacement has a violating fixture and inventory evidence; full parity/build passes. |

One GPT-6 Astra/high supervisor implements this cohesive completion unit locally with zero
implementation workers. One fresh read-only `sup_review` on Astra/high reviews the complete frozen
candidate, all P1–P6 and integration fixes where necessary. At most two active agents. The reviewer
receives pinned base/head/tree, complete diff, approved plan and evidence, never the author's working
conversation. Review does not implement or delegate. No planning dispatch or implementation checkout.

| Assignment | Branch / checkout | Base / integration condition |
| --- | --- | --- |
| `side/run-completion` | Create `codex/run-completion` in `/Users/julianhein/Projects/hr-worktree-run-completion`; recheck availability/capacity first. | Actual accepted local-master integration of timeline T2 and its prerequisites, containing this approved plan. Record full base SHA before editing. No unfinished peer branch or planning HEAD substitutes for that prerequisite. |

The operator assigns integration into local master at `/Users/julianhein/Projects/hr-automation-rebuild`
after review PASS and gates. Recheck target ownership and serialize the assigned integration; gate
the combined tree and independently re-review behavioral conflict fixes. Remove only this accepted
task's branch/worktree from a safe checkout. No push, integration before review/gates, or next-task dispatch. The prerequisite launch assigns local integration.
Material scope, evidence-loss or ownership conflicts return for amendment; routine fixes remain local.

The [parallel execution plan](README.md) owns the new batch's resource allocation, prerequisite release,
compact handoffs and subsequent peer integration. This task is a sequential prerequisite, not one
of those peers. Complete all P1–P6 locally; its accepted integration releases only the shared
foundation, never the three peers directly. Record the accepted SHA and cleanup here.

## Gates

Focused iteration selectors (verify their current paths after predecessor integration):

- `npm run test -- tests/unit/terminal-authorization.test.ts tests/unit/run-terminal-authority.test.ts tests/unit/run-result.test.ts tests/unit/run-executor.test.ts`
- `npm run test -- tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts`
- `npm run test -- tests/unit/archive-model.test.ts tests/unit/archive-protected-identity.test.ts tests/unit/dashboard/settings-storage-doctor.test.ts`
- `npm run test:architecture -- tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/storage-recovery.test.ts tests/unit/architecture/worker-teardown-soak.test.ts`

Add meaningful multi-connection, composite rollback, historical replay and archive fixtures for the
proof rows. Replace renamed/retired selectors with equivalent proof and record the mapping. Run lint
whenever tests run. Focused tests do not replace full gates or require duplicate unchanged coverage.

Each implementation commit/candidate and material integration requires `npm run typecheck`,
`npm run lint`, `npm run test:coverage`, `npm run web:build`, `npm run test:parity`, affected generated
checks and `git diff --check`. Use `/ui` for the scoped Storage Doctor change and follow module parity
rules; reference changes must be deliberate, reviewed removal of the metric, not a blanket refreeze.
Run affected `build:manifest`, `stores:catalog`, `roadmap` generation before their `:check` commands;
never hand-edit generated output. Guard replacements update the inventory with deciding evidence.

Use at most four effective file workers, keep coverage free of this task's compiler/linter contention,
and serialize shared mutable coverage/parity/build outputs. Independent typecheck/lint/freshness may
overlap within verified capacity; coordinate evidenced host conflicts without killing peer processes.
Record exact tested SHA/tree, commands/exits, logs, resolved workers and P1–P6 evidence. Reuse only
with unchanged relevant inputs and original command/identity/result; new input, failure or unresolved
proof requires rerun. Documentation-only records use D191 scoped checks, not claims of runtime proof.

No live HR operation is necessary. Acceptance uses synthetic workers, isolated populated databases
and offline composed consumers. Operator database application remains a separately assigned action
after integration: recheck schema/executable/stopped locks, take a verified explicit backup, use
supported storage upgrade planning/application and doctor commands, and verify sanitized counts,
completion identities, result/failure preservation, FK integrity and intended runtime state.

## Progress and launch status

- Original product scope remains approved. On 2026-09-08 the operator explicitly approved revising
  the remaining plans for parallel execution, including their ownership, prerequisites and gates.
- Earlier inspection/check records are historical planning evidence. This amendment's validation
  is recorded in the [parallel execution plan](README.md); no product tests are claimed from planning.
- S1–S4 and P1–P6: **not started**. Required product proof, gates, independent review, accepted integration
  and cleanup remain unfinished until linked to exact evidence.
- Launch: **WAITING ON accepted timeline T2 integration and its existing prerequisites**. Verify the committed plan revision, base, branch/path ownership
  and capacity. Do not substitute a planning commit or unmerged sibling for the prerequisite.

The operator launches [the prerequisite task](00-prerequisites.md) once. It executes this internal
`side/run-completion` unit locally, then B after A's accepted integration and cleanup. Do not separately
launch this file or a sibling supervisor. The prerequisite launch assigns this unit's local integration.
This is an approved side-work assignment. This side plan is the task owner wherever `/supervise`
refers to a task/phase section. Record progress, review, gate evidence and completion here; do not
create a phase number or mark roadmap tasks complete. Preserve repository contracts, Astra/high,
fresh read-only `sup_review`, all required gates and the linked integration/cleanup conditions.
Send Done / Now / Remaining at start/resume and after each verified step. No automatic task launch,
push or application to the operator database.
