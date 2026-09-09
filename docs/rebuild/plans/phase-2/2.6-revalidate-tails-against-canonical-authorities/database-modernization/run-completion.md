# Run completion storage

**Current assignment:** the operator approved the [C01–C05 execution brief](#approved-execution-brief--2026-09-09)
on 2026-09-09. It supersedes this file's older waiting, retained-checkout, no-master-merge and
per-task review instructions. T and C are locally integrated as scoped development releases. C closure evidence is recorded below; full gates and complete independent review remain in 2.6.9.

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

> **Combined-plan amendment — 2026-09-09.** This file retains the approved product scope,
> acceptance proofs and historical inspection below. [The combined workflow](README.md) and
> [prerequisite releases](prerequisites.md) now exclusively own assignment IDs, dependencies,
> write-set allocation, candidate release, gates, review timing, integration and launch status.
> Earlier A/B/T1/T2/P/D/G execution allocations, per-unit full gates/reviews, master prerequisites
> and provider-owned integration below are superseded for this unlaunched batch. They are not
> alternate launch instructions. Every product proof remains required; heavy proof and independent
> review run in the final session. Existing in-flight timeline T1 keeps its own schedule.

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

The approved [run-summary owner](decisions.md#approved-group-5-dryrun-results-and-shared-run-summaries)
also consumes completion/result/receipt/failure facts. Bind settlement and relevant summary updates
through the shared prerequisite so Queue/Activity agree after commit. This unit owns completion,
not a second summary schema or calculation; reconcile overlap before revised dispatch.

Archive design owner: [independent archive reports](decisions.md#approved-group-3-independent-archive-reports-and-no-relaunch).
This is a planning amendment. Preserve existing in-flight gate schedules, candidate evidence and
accepted work; it does not launch implementation or reschedule reviews. New launch readiness awaits
the complete revised allocation and verified prompts.

## Assignment and approval

**Owner: `side/run-completion`. Prerequisite A in the [combined execution plan](README.md). Implementation
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

- [Root instructions](../../../../../../AGENTS.md), [document routing](../../../../../README.md),
  [roadmap governance](../../../../../roadmap/roadmap.md), and
  [operating reference](../../../../../../.agents/skill-library/repository-work/REFERENCE.md).
- [Dashboard surfaces: run completion storage](../../../../reference/dashboard-surfaces.md#run-completion-storage)
  owns this amendment to D110/D114 and D330 completion, replay and storage presentation.
- [Execution and sessions](../../../../reference/execution-and-sessions.md),
  [workflow model](../../../../reference/workflow-model.md),
  [operator trust](../../../../reference/operator-trust.md), and
  [write safety](../../../../reference/write-safety.md) retain claim, result, failure and submit rules.
- [Clock/config/secrets](../../../../reference/clock-config-secrets.md), D321/D322/D332,
  owns backup/upgrade and paired authority. [Guards and tests](../../../../reference/guards-and-tests.md),
  §3.14 D191, owns gates; [frontend/backend integration](../../../../reference/frontend-backend-integration.md)
  owns wire shapes and parity.
- [Timeline history](history/timeline-t1.md) T2 is the direct predecessor; consume its completed
  event authority and retired operation outbox. The [combined execution plan](README.md) places this completion
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
4. **S4 Development release:** focused proof, lint and affected freshness; record the committed
   candidate for final 2.6.9 validation, repair and independent review.

| Proof | Required result and negative control |
| --- | --- |
| P1 Ownership | A loses assignment 1, B takes assignment 2: A cannot finish, B can. A later owns assignment 3: its old assignment 1 still cannot finish. Competing connections cannot accept conflicting outcomes. Wrong version/state/worker/generation fails before writes. |
| P2 Atomicity and replay | Inject failures at each actual composite write, including timeline append; no partial completion/result/failure/event survives. Simulate commit followed by lost acknowledgement and reopen: identical replay returns the same settlement, divergent replay refuses without new events. Existing result factory/dependency and failure-node negative controls remain effective. |
| P3 Migration and recovery | Populated done/failed plus cancelled/interrupted/active/requeued fixtures migrate without fabricated completion or changed logical identities. Partial/mismatched authorization/outbox/result rejects atomically. Supported old backup restore, interrupted upgrade before/after commit, exact resume and repeated no-write upgrade pass. Old divergent outbox replay still refuses. |
| P4 Lifecycle and archives | Explicit Retry creates a new linked run and leaves original completion unchanged; interrupted requeue remains valid. Archive/rename and supported later commands preserve immutable completion and issued fingerprints. Old archive snapshots still parse without byte/digest rewrites. D308 retains tombstones and removes exact owned records without damaging shared evidence. |
| P5 Failure and transitive consumers | Failure lookup/search/fingerprint/remediation, diagnostic bundles, evidence receipts, child-result joins, queue/detail/Archive and timeline keep exact behavior. Failure FKs remain valid. Completion information is not leaked into public protected-data projections. |
| P6 Retirement and presentation | New success creates no outbox or replacement delivery obligation. No current reads/writes of retired tables remain. Storage Doctor CLI/BFF/dashboard removes only the obsolete metric; supported historical backups still inspect correctly. Guard replacement has a violating fixture and inventory evidence; full parity/build passes. |

## Execution ownership

Use [the combined workflow](README.md), [prerequisite releases](prerequisites.md) and
[launch registry](PROMPTS.md). One Astra/high supervisor owns this assignment; default zero
implementation workers. Shared migrations, composition and fixture work belongs to its prerequisite.
Return a committed development candidate after focused checks, lint and affected freshness; final
2.6.9 owns heavy gates, independent review, all remaining repairs and operator-assigned integration.
No per-peer review, master merge, provider-owned integration or automatic task dispatch remains.

## Focused checks and final proof

Suggested selectors from source inspection, to verify on the actual prerequisite release:

- `npm run test -- tests/unit/terminal-authorization.test.ts tests/unit/run-terminal-authority.test.ts tests/unit/run-result.test.ts tests/unit/run-executor.test.ts`
- `npm run test -- tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts`
- `npm run test -- tests/unit/archive-model.test.ts tests/unit/archive-protected-identity.test.ts tests/unit/dashboard/settings-storage-doctor.test.ts`
- `npm run test:architecture -- tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/storage-recovery.test.ts tests/unit/architecture/worker-teardown-soak.test.ts`

Add real populated migration, concurrent connection and fault-injection tests for the proof rows;
replace retired guards with meaningful negative controls and deciding inventory evidence. Preserve
all assertions, test membership, coverage floors, isolation and timeouts. Run lint whenever tests
run. A focused pass is not complete product acceptance. The full required typecheck/coverage/
architecture/parity/build/recovery and generated gates are owned by [2.6.9](final-validation.md).
Use /ui for frontend work and deliberate parity changes; preserve the scoped product exclusions.

No live external submission, real provider/key wiring, operator database upgrade or source cleanup
is authorized here. An operator-root upgrade/cleanup is a separately assigned action after accepted
integration, verified stopped ownership, source-bound backup, supported upgrade plan/apply/doctor
and sanitized before/after identity/count evidence. This planning work changes no runtime data.

**WAITING ON:** the assignment's actual prerequisite development release. C0's execution allocation is admitted below; no future base is guessed.
All earlier planning checks remain historical Git evidence, not gates for the new implementation.

## C0 execution allocation — 2.6.5 C

Prerequisite: **T committed development release**. One Astra/high supervisor, zero implementation workers.
Use the exact `C` branch and absolute worktree in [PROMPTS.md](PROMPTS.md#binding-registry).
This allocation supersedes older shared-file/side-task ownership in this owner; product proof is retained.
Current inspected baseline is R `60b356dd119140dc972a077751ad16af934acb2e`, schema39/floor37.
Future prerequisites build the explicitly named new modules before peers launch; names do not assert readiness.

Ordered outcomes: Validate exact settlement provenance; append completion conversion and failure rename; replace terminal factories/composites and retire terminal outbox consumers; prove replay/rollback and current served behavior; release to F.

### Exclusive changing paths

- `src/infra/sqlite/migrations.ts`
- `src/infra/sqlite/authority-database.ts`
- `src/infra/sqlite/storage-records.ts`
- `src/infra/sqlite/recovery-contracts.ts`
- `src/infra/compat/backup-inspection.ts`
- `src/infra/compat/settings-database-upgrade.ts`
- `src/domain/authority.ts`
- `src/domain/run/deleted-run.ts`
- `src/server/storage/compose.ts`
- `src/server/storage/upgrade.ts`
- `src/core/command-kernel.ts`
- `src/domain/commands.ts`
- `src/server/dashboard/compose.ts`
- `src/server/worker/compose.ts`
- `src/server/dashboard/commands/command-service.ts`
- `src/cli.ts`
- `src/domain/run/record.ts`
- `src/domain/run/terminal-authorization.ts`
- `src/domain/run/terminal-outbox.ts`
- `src/domain/trust/failure.ts`
- `src/core/terminal-authorization.ts`
- `src/core/run-executor.ts`
- `src/core/run-record-service.ts`
- `src/infra/sqlite/run-terminal-contracts.ts`
- `src/server/dashboard/queries/storage.ts`
- `src/domain/dashboard/storage.ts`
- `src/dashboard/surfaces/settings.tsx`
- `src/dashboard/surfaces/settings-model.ts`
- `src/server/dashboard/projectors/run-queue-projection.ts`
- `src/server/dashboard/queries/run-trust.ts`
- `src/services/archive/archive-service.ts`

### Proof and test ownership

All P1–P6 remain. C proves current same-row archive compatibility; A/H/2.6.9 own independent-report rendering after source deletion. Read /ui before the admitted Storage Doctor metric removal; no unrelated layout changes.

- `tests/unit/terminal-authorization.test.ts`
- `tests/unit/run-terminal-authority.test.ts`
- `tests/unit/run-result.test.ts`
- `tests/unit/run-executor.test.ts`
- `tests/unit/storage-upgrade.test.ts`
- `tests/unit/storage-upgrade-tombstones.test.ts`
- `tests/unit/storage-backup.test.ts`
- `tests/unit/storage-restore-drill.test.ts`
- `tests/unit/archive-model.test.ts`
- `tests/unit/archive-protected-identity.test.ts`
- `tests/unit/dashboard/settings-storage-doctor.test.ts`

Run the owned unit files with `VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1`
followed by their explicit paths above (exclude a performance script from Vitest). New paths must exist
and collect meaningful cases before release. Use `npm run lint`; run affected architecture guards
with `--project architecture --maxWorkers=1`, and the affected manifest/catalog/roadmap generators
before their `:check` commands. Preserve existing floors, membership, assertions and timeouts.
Desktop visual work uses `/ui`; focused rendering/accessibility proof is due here, complete parity/build
and all heavy gates remain 2.6.9. Preserve every inherited proof row; record exact tested tree and exits.

The prerequisite owns shared fixtures, registries, global unions and generated inputs; create only
owned fixture files beside the new tests. Shared architecture guard retirement is recorded by the
prerequisite with violating fixtures and guard-inventory evidence. No peer may edit another peer
or prerequisite path. A newly discovered required shared edit blocks peer release until its owning
prerequisite is amended and revalidated. Do not replace a missing baseline with an unused export.

## Approved execution brief — 2026-09-09

The operator approved this complete proposal after requesting: “make sure to merge and cleanup at
the end” and “the full gates run at the end of 2.6. not here.” This is assignment **2.6.5 C** only.
It retains all product contracts and P1–P6 above. The following execution controls supersede older
conflicting controls in this file, the combined workflow, prerequisite registry and generic prompts.
Planning saves and validates the brief, commits it, verifies committed content and prerequisites,
then returns a fresh-session supervisor prompt; it implements no product code.

### Binding and allocation

| Field | Approved binding |
| --- | --- |
| Owner | One GPT-6 Astra/high supervisor; zero implementation workers and no task-local independent reviewer. The same supervisor owns tactical fixes, integration and cleanup. |
| Mode | Create a dedicated branch/worktree at execution. The primary repository remains the integration checkout. |
| Branch | `codex/run-completion` |
| Worktree | `/Users/julianhein/Projects/hr-worktree-database-contracts` |
| Verified prerequisite | T integration `5e446a90f018456d11ad38442c0fe3ba13e31dd1`, including candidate `58376a7d7f9a6af65dd443cecb934ce0a812593d` and integration repairs. R, C0 and accepted T1 are in its ancestry. |
| Implementation base | The exact committed approved-plan SHA returned by the planner, on master and descended from the T integration. Verify that committed owner before the first edit. No prerequisite-only SHA substitutes for the approved plan. |
| Integration | The C supervisor locally merges its committed candidate into `master` at `/Users/julianhein/Projects/hr-automation-rebuild` after all assigned focused checks pass, then verifies the combined tree and performs owned cleanup. No additional merge permission is needed. |
| Release | Record the actual C candidate, integration SHA/tree and focused evidence for F (2.6.6). Do not launch F or mark Phase 2.6 accepted. |

Planning observed a clean primary checkout at the T integration, no auxiliary worktrees, and no C
branch or physical lane. Names are proposals, not reservations. At execution recheck refs, path,
ownership, prerequisite ancestry and the four-auxiliary-worktree capacity limit. Create the missing
lane with its own branch from the verified plan commit; do not require removed predecessor branches.
Never reset a colliding ref, switch another session's checkout or hide unrelated changes. If master
advances, inspect its diff for relevant drift and recheck integration; do not blindly overwrite it.

This is one cohesive sequential assignment: the schema, settlement factories, lifecycle journal,
recovery and served storage contract must change together. Splitting them would create dependent
partial interfaces. F and the independent domain tasks remain outside C's ownership.

### Feasibility and required negative controls

Inspection is bound to `5e446a90f018456d11ad38442c0fe3ba13e31dd1`; no implementation checks were
run by planning. The current migration maximum is 40. Append migration versions and preserve all
released statements/fingerprints and supported floors. No actual operator database application is
assigned: use reproducible synthetic fresh/historical roots, not the dated real-target counts above.

| Requirement and current evidence | C-owned change and proof |
| --- | --- |
| `authority-database.ts` terminal composites write authorization/result-or-failure/outbox/run; `run-record-service.ts` wraps settlement plus lifecycle event and journal in the outer transaction. | Move completion onto the run and remove the outbox while keeping the whole settlement atomic. P1/P2 inject failure at each actual write, including timeline and journal; reopen after lost acknowledgement and compare exact durable facts. |
| `run-record-service.ts:inspectJournal` hashes the complete terminal request; success currently includes authorization and outbox identities. T's conversion exposed and repaired an analogous historical fingerprint break. | Pin a real synthetic pre-conversion success/failure request, command/audit and accepted replay before schema changes. After conversion, exact old replay must succeed without rewriting journal fingerprints; changed outbox/worker/generation/version/time/result/failure must refuse with zero extra writes. New requests create no outbox identity or delivery obligation. P2/P3 own this adapter and proof. |
| `assertTerminalAuthorizationConsequence` checks immediate settlement version/time; lifecycle replay separately permits later run versions. | Preserve original settlement evidence while allowing already-authorized rename/archive/retry behavior. P1/P4 cover lost generation 1, reassignment 2, same worker returning at generation 3, later mutations and competing connections. Never infer authorization from a terminal state or latest timeline timestamp. |
| `migrations.ts`, storage record schemas, authority integrity SQL and D308 deletion enumerate the old tables; diagnostic snapshots and run receipts reference failures. | Convert and reconcile exact historical authority before retirement, preserve failure IDs/FKs/fingerprints and tombstones, replace guards with equivalent negative fixtures. P3/P5/P6 cover partial, missing and contradictory data, stopped upgrade/restore, interrupted conversion and repeated no-write upgrade. |
| Archives freeze projected row/detail/failure/receipt content and content digests in `domain/archive/model.ts`; archive capture and issued references authenticate that content. | Keep existing stored archive bytes/digests and reference identity valid. Do not inject completion into frozen content or weaken current live-run parsing to accept missing completion. Historical format adapters, if needed, remain explicitly versioned. P4/P5 preserve archive commands, same-row membership and shared evidence. Independent report conversion/rendering belongs to A/H/2.6.9. |
| Storage Doctor exposes `runTerminalOutbox` through recovery/domain schemas, CLI composition and the Settings count list; loaded-doctor parity covers both themes and desktop viewports. | Remove only the obsolete metric across current producers/consumers and fixtures, retain historical backup inspection, and verify the changed rendered states. P6 owns deliberate focused reference updates; full parity/build remain in 2.6.9. |

At the public settlement entry, exact historical replay after rename/archive must preserve its
accepted identity; a reused command with a changed legacy outbox must refuse before mutation even
when the run is already terminal. A new settlement with a stale claim must write nothing. A valid
current claim must reach settlement, so negative tests cannot pass through broken setup. A fault
after the database composite but before lifecycle timeline/journal completion must roll back all
changes. These interacting rows supplement, not replace, P1–P6 and UNKNOWN resubmit refusal.

### Ordered steps

1. **C01 — Admission.** Verify binding, approved plan, T ancestry, current instructions and released
   migration history. Pin synthetic old-format success/failure, journal replay and frozen-archive
   fixtures before conversion. Record the exact completion representation and old/new replay map.
2. **C02 — Storage.** Implement immutable completion on `workflow_runs`, rename `failures` to
   `run_failures`, append conversion/recovery support and retire terminal authorization/outbox
   tables. Preserve IDs, logical versions, generations, timestamps, fingerprints, receipt evidence
   and foreign keys; inconsistent conversion fails atomically. Run P3 and relevant P4/P5 controls.
3. **C03 — Runtime.** Adapt terminal factories, composites, lifecycle-journal replay, integrity and
   deletion together. Completion/result-or-failure/timeline/journal settle atomically. Exercise P1/P2
   stale-owner, competing-writer, rollback, exact replay and divergence controls at actual entry points.
4. **C04 — Consumers.** Preserve retries, cancellation/interruption, child results, diagnostics,
   protected projections and frozen archives. Remove the obsolete Storage Doctor metric across
   CLI/API/UI. Update affected tests, fixtures and safety guards with negative controls; complete
   focused P4–P6 and current-source Storage Doctor visual verification.
5. **C05 — Release and integration.** Fix all focused failures, commit by logical category using
   exact paths, and record candidate SHA/tree and proof results. Locally merge into master, resolve
   in-scope conflicts and rerun checks invalidated by integration changes. Preserve evidence, verify
   incorporation and remove only C's owned worktree and local branch. Save F's actual prerequisite
   and deferred phase requirements. Stop after C; no automatic successor or observer task.

### Source, test and documentation ownership

Retain the complete **C0 execution allocation — 2.6.5 C** source list above. C also owns direct
compatibility changes in `src/domain/archive/model.ts` and `src/core/run-result.ts` only where needed
by the approved completion/identity conversion; this does not authorize a new archive schema or
result meaning. Lifecycle replay is explicitly owned in `src/core/run-record-service.ts`.

Retain all eleven existing unit test paths above. Add explicit ownership of
`tests/unit/run-record-service/service.test.ts`, its `race-worker.ts` helper,
`tests/unit/sqlite-authority-database.test.ts`, and new completion-specific fixtures/tests beside
these files. C owns affected terminal-contract call-site fixtures and architecture guards,
including `tests/unit/architecture/migration-history-immutability.test.ts`,
`tests/unit/architecture/storage-recovery.test.ts`,
`tests/unit/architecture/strict-boundary-schemas.test.ts`,
`tests/unit/architecture/guard-manifest.test.ts` and deciding entries in
`docs/rebuild/guard-inventory.json`. No guard is removed merely for naming a retired table.

The bounded visual write set is the existing Settings source/model, the loaded Storage Doctor
cases in `tests/parity/dashboard-reference.spec.ts`, affected fixture fields in
`tests/parity/helpers/fixture-day.ts`, and only their affected reference artifacts. Use `/ui` locally:
lead Components, support Verification, no delegated specialists. Read the dashboard rules, design,
parity contract and browser playbook before the visual edit. Preserve themes, desktop membership,
zoom/accessibility, unrelated counts and error states. No layout redesign or completion panel.

C owns necessary completion-contract status corrections, this task's evidence, its roadmap/registry
release bindings and affected generated manifest/catalog/roadmap outputs. Product contracts remain
at their existing owners; do not duplicate them here or change another domain's approved behavior.
New pure completion schema/compatibility files within these owned seams are routine implementation
choices. An unrelated shared-API redesign returns for amendment; a necessary direct caller or
fixture adaptation for the admitted retirement stays with this supervisor and is recorded.

### Gate schedule and evidence

Run focused tests during implementation at the earliest stable C02/C03/C04 boundary, and rerun the
complete affected focused set on the committed release candidate. Preserve suite membership,
assertions, timeouts, coverage floors and failure semantics. Record exact commands, tested SHA/tree,
effective worker count, exits and log paths. Use one effective Vitest file worker; verify resolved
runner configuration or observed child processes rather than assuming an environment flag works.
Own synthetic database roots and logs under `/tmp/run-completion-*`; never use operator state as a fixture.

```sh
npm run test -- --project unit --maxWorkers=1 tests/unit/terminal-authorization.test.ts tests/unit/run-terminal-authority.test.ts tests/unit/run-result.test.ts tests/unit/run-executor.test.ts tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts tests/unit/archive-model.test.ts tests/unit/archive-protected-identity.test.ts tests/unit/dashboard/settings-storage-doctor.test.ts tests/unit/run-record-service/service.test.ts tests/unit/sqlite-authority-database.test.ts
npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/storage-recovery.test.ts tests/unit/architecture/strict-boundary-schemas.test.ts tests/unit/architecture/guard-manifest.test.ts
npm run lint
npm run test:parity -- tests/parity/dashboard-reference.spec.ts --grep "loaded storage doctor"
```

Add exact selectors for new meaningful completion/recovery tests and any additional directly
affected guards. If an owned test moves with a retired module, record its replacement and preserve
its behavior/negative controls; an empty selector is not proof. Intentionally changed visual
references use the same filtered selector with `npm run test:parity:update`, visual inspection,
then the assertion command above. Verify current-source provenance; do not refreeze unrelated
states or loosen tolerances. Any build required by the focused browser harness is only its setup,
not a claim that the full phase build/parity gate ran.

For affected generated inputs, run `npm run build:manifest`, `npm run stores:catalog` or
`npm run roadmap`, followed by the matching `:check` command; skip unaffected generators with
recorded input evidence. Generation precedes freshness. Serialize mutable parity/reference and
generated outputs; avoid unnecessary overlapping test processes. Lint/focused tests must pass
before release. Repeat affected checks after integration changes; reuse unchanged results only
with tested input/tree comparison under D191. Documentation-only recording commits use scoped
binding/link/instruction-pair/whitespace and affected freshness checks, with explicit unchanged-input reuse.

Do not run full typecheck/coverage, the whole architecture suite, broad parity/build or performance
gates here. Final 2.6.9 owns all those gates, full migration/recovery/scenario/concurrency/redaction/
production-route acceptance and a fresh complete read-only `sup_review` on Astra/high. C introduces
no reviewer dispatch or intermediate finalizer. All P1–P6 remain required; distinguish focused proof
completed here from broad acceptance left for 2.6.9. Keep T's two context-blocked reviews and existing
performance failures (day statements 5,574 > 5,569; archive freeze 3,234 > 13) visible there; neither
is a PASS or a new C gate. Review and remaining phase repairs belong to the final supervisor.

### Merge, cleanup and stop conditions

After focused PASS, freeze the committed candidate and inspect target HEAD, clean status and
ownership. Use a local merge preserving candidate history, preferably `--no-ff`. The operator has
already authorized C integration and cleanup before final phase review. In-scope integration repairs
remain here and require affected focused checks; a material contract/scope change stops for amendment.
Never weaken UNKNOWN refusal, factory/dependency authentication, historical identity or immutable
evidence to make migration/replay pass. No replacement completion table, delivery queue, dual-write
authority, provider wiring, run summaries, archive transfer or new retention behavior is assigned.

Preserve ignored proof artifacts before removal, with content hashes and a durable location outside
the owned checkout. Verify the candidate is incorporated, final status is clean, owned processes
are stopped, and refs/worktree registrations identify only C's resources. Change to the safe primary
checkout before removing the auxiliary worktree; never remove the primary repository or another
task's work. Delete only C's integrated branch and verify registered and physical absence. Record
candidate/integration identities, evidence location, cleanup results and F's actual master-based
prerequisite; F must recreate the absent lane rather than require retained C refs. No push, operator
database upgrade, live HR submission, cutover or next-task dispatch. Completion means a merged scoped
development release; Phase 2.6 remains open until 2.6.9 acceptance.

At start/resume and after every verified step, report Done / Now / Remaining before the next tool
call, including integration, cleanup and the explicitly deferred final review/gates. Use the existing
owner for current state and the final delivery assessment; unique interrupted state uses `/handoff`.

Release committed candidate/base/tree and focused evidence to the next named consumer. No master
integration, independent review, heavy-gate waiver, sibling dispatch or live database application.
Future-base binding remains WAITING ON the actual prerequisite release, not a fabricated SHA.

Authored evidence stays in this task's existing `run-completion.md` owner; shared indices remain read-only.

### Planning verification and handoff

The operator's approval was received in this planning session on 2026-09-09. Persistence changes
only this assignment's execution documentation, its contract/registry pointers, the stale T
prerequisite status and generated roadmap; no source, test, configuration or dependency inputs change.
The planner verifies the final committed owner and returns its exact SHA as C's implementation base.

| Planning check | Evidence |
| --- | --- |
| Prerequisites | T integration `5e446a90f018456d11ad38442c0fe3ba13e31dd1`, T candidate `58376a7d7f9a6af65dd443cecb934ce0a812593d`, C0 `c7b8b1e037bf27dd70d4df62bbfcac407e475631`, R `60b356dd119140dc972a077751ad16af934acb2e` and T1 `46930920696ab214b036d5f2681b8ffb4e5620ea` are verified ancestors of the planning base. |
| Document binding | `npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/roadmap-doc-binding.test.ts`: PASS, 24 tests; `/tmp/run-completion-plan-binding.log`. Repeat after the final evidence edit and on the committed plan. |
| Lint | `npm run lint`: PASS, exit 0, zero warnings; `/tmp/run-completion-plan-lint.log`. The subsequent evidence edit and generated roadmap do not change any lint input. |
| Generation/freshness | `npm run roadmap` and `npm run roadmap:check`: PASS. Repeat after the evidence edit and check the committed output. |
| Links/instructions | 163 scoped local links/anchors resolve; nine existing instruction pairs match byte-for-byte; maximum project instruction chain 17,333 UTF-8 bytes. Verification recipe: `/tmp/run-completion-plan-doccheck.py`. |
| Whitespace | `git diff --check`: PASS; repeat on the final candidate. |
| Not claimed | No product implementation, runtime migration proof, full phase gate, independent review, operator database application or HR submission ran in planning. |

C is READY only after the exact committed plan content, reachability, final documentation checks
and clean branch/path availability are verified by the outgoing handoff. No implementation checkout
or agent is created by this planning stage. C remains planned; F waits for C's actual merged release.


## C execution evidence — 2026-09-09

**Current state:** C01–C04 complete; C05 release and local integration verified. The durable
closure receipt below records final owned worktree/ref cleanup before handoff. Supervisor only, zero
workers/reviewers. Plan/base `dce3efc91685a33fc868376c054b15b7c0aad6f3`; prerequisite
`5e446a90f018456d11ad38442c0fe3ba13e31dd1` is an ancestor. Branch `codex/run-completion`, owned
checkout `/Users/julianhein/Projects/hr-worktree-database-contracts`; master remains the local
integration target. Logs and capture recipe: `/tmp/run-completion-evidence` (preserve before cleanup).

C01 captured synthetic schema-40 success/failure requests, accepted lifecycle commands/audits and
frozen archives before implementation. The committed JSON fixtures record the exact source commit;
no operator database or HR system was used. The capture recipe is preserved with the gate logs.

Representation: `workflow_runs.record_json.completion` is a strict version-1 value binding accepted
worker/generation, expected version, timestamp and result digest/failure ID. Run/envelope identity
remains on its existing owner. Initial settlement requires the current claim; later completion is
immutable. Supported later revisions require the existing lifecycle journal. Migration 41 appends
failure-table rename and authorization/outbox retirement; floor 40 requires the stopped upgrade path.
Released migrations 1–40 are unchanged. Historical authorization and receipt JSON bytes live in a
versioned inert completion extension; current success requests create no outbox identity. The
historical request parser retains the complete old request before journal hashing, so old command
fingerprints are never rewritten. Archive content and issued reference fingerprints remain unchanged.

Focused proof already observed (pre-candidate inputs; repeat the complete affected set at release):

| Boundary | Result | Evidence |
| --- | --- | --- |
| Initial service + stopped upgrade | PASS, 129 tests | `c02-c03-first.log` |
| Historical conversion + terminal controls | PASS, 23 tests | `c02-c03-expanded.log` |
| Actual settlement writes, timeline and journal; reopened replay | PASS, 24 tests | `c03-faults.log` |
| Lost generation 1, B generation 2, A generation 3, competing connections, Retry | PASS, 54 tests | `c03-ownership.log` |
| Recovery guard replacement | PASS, 94 tests; followed by complete five-suite PASS (112 tests) | `c04-guards.log` |

Vitest's root `--maxWorkers=1` did not override the inherited per-project value (4). The temporary
`/tmp/run-completion-vitest.config.mts` imports the real repository config and changes only root and
per-project `maxWorkers` to 1. `runner-config.json` verifies unit/architecture each use one isolated
fork. Membership, assertions, timeouts and coverage settings are unchanged. Release commands use this
config with the approved explicit selectors. Full typecheck, coverage, architecture, parity/build,
performance and complete independent review remain assigned to 2.6.9. T's two context-blocked reviews
and performance failures (day 5,574 > 5,569; archive freeze 3,234 > 13) remain unresolved there.

Direct caller/fixture adaptations include receipt, seeded parity, lifecycle-walk and performance
fixtures; these retire the old settlement argument without changing their underlying expectations.
The pure activity projection fixture now declares completion explicitly instead of constructing a
current done run without evidence. Terminal events add optional historical-compatible worker/claim
fields and current producers fill them. No unrelated workflow behavior or archive transfer changed.

C04 follow-up: four filtered Storage Doctor cases pass in both themes and 1440×900/1024×768.
Visual inspection and all four accessibility reference diffs show only removal of `terminal outbox 0`.
The prescribed wrapper initially rejected a filtered run with no declared body-backed a11y evidence;
the four owned cases now declare and attach their actual body snapshot with its exact digest, using
the existing parity evidence protocol. The wrapper was not weakened. Current-source bundle freshness
is verified by the harness. Terminal timeline identity also required the existing executor-event
schema to admit optional worker/generation fields. Populated schema-40 backup restore and re-upgrade
preserve frozen archive identities and original journal replay; active/queued/requeued/cancelled/
interrupted records remain byte-identical without invented completion. Pure receipt and pseudonym
fixtures explicitly declare synthetic completion; frozen pre-D309 receipt files are unchanged.

## C scoped release and local integration — 2026-09-09

This is the focused development release for 2.6.5, not Phase 2.6 final acceptance.
One supervisor performed C01–C05; no supporting worker or independent reviewer was dispatched.
The operator's approved exception assigns full gates and complete independent review to 2.6.9.

| Evidence | Verified result |
| --- | --- |
| Implementation | `5a74cf6ee`; receipt negative-fixture follow-up `89d167332` |
| Tested candidate | `89d167332e3eebe99519adc85f92607e9dbef1e8` |
| Tested tree | `6bf896b93fb70ecd0707b46605c3e0b80d546054` |
| Local master integration | `0dd02a89056bd4ccec1a2089bacd8bd7f6cf2645`; exact candidate tree, no conflicts or unrelated drift |
| Focused units | 26 files / 524 tests, exit 0 |
| Focused architecture | 6 files / 134 tests, exit 0; migration bytes 1–40 unchanged |
| Lint | `npm run lint`, exit 0, zero warnings |
| Generated inputs | manifest and store catalog regenerated then freshness checked, exit 0; generated bytes unchanged |
| Filtered Storage Doctor | four cases, both themes and desktop widths, exit 0; exact body-backed a11y evidence and current-source build stamp |
| Runtime safety | original UNKNOWN refusal, terminal replay, ownership fences, D308 and frozen receipt/archive identities retain focused proof |

Exact commands, exits, durations, tested input objects and one-worker configuration are in
[release-results.json](/Users/julianhein/Projects/hr-run-completion-evidence-20260909-baad4b2f2/release-results.json) and
[tested-input-objects.json](/Users/julianhein/Projects/hr-run-completion-evidence-20260909-baad4b2f2/tested-input-objects.json).
All release commands ran serially. Earlier repaired failures remain in their original logs,
including the first candidate's fixture-only receipt guard failure. The complete affected set
was rerun on the final committed candidate. No assertions, timeouts or suite membership were relaxed.

[Closure receipt](/Users/julianhein/Projects/hr-run-completion-evidence-20260909-baad4b2f2/closure.json) is the final integration, worktree registration/path,
branch-ref and process verification record. [Evidence index](/Users/julianhein/Projects/hr-run-completion-evidence-20260909-baad4b2f2/README.md) and
[SHA-256 manifest](/Users/julianhein/Projects/hr-run-completion-evidence-20260909-baad4b2f2/SHA256SUMS) retain logs, capture recipe, runner config, synthetic
fixture provenance, parity report and build provenance outside the removable checkout.

F (2.6.6) consumes actual master prerequisite `0dd02a89056bd4ccec1a2089bacd8bd7f6cf2645` with this candidate's source tree.
The operator must open its planning/supervisor session; C launches nothing. Its approved plan base
must descend from this integration and include its own committed brief. C's old branch/path are not
prerequisites. The sequential lane can be recreated after the closure receipt verifies removal.

2.6.9 still owns full typecheck/coverage, broad architecture/parity/build/performance, complete
migration/recovery/scenario/concurrency/redaction/production-route acceptance and a fresh complete
read-only `sup_review` on Astra/high. T's two incomplete context-blocked reviews and measured
performance failures (day 5,574 > 5,569; archive freeze 3,234 > 13) are retained there. A/H/2.6.9 own
independent archive-report rendering after live-source deletion. No operator DB upgrade, HR
submission, push, automatic F launch or unrelated cleanup occurred.
