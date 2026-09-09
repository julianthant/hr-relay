# Remaining database tables — planning discussion

## Scope and working agreement

On 2026-09-08 the operator asked to continue the existing table-by-table design discussion in the
current task and collect all resulting changes in one folder, like `database-parallel`. No separate
planning task or implementation worktree is needed. This folder is the single owner for the new batch.
The [earlier database batch](../database-parallel/README.md) retains its existing gate cadence and
in-flight evidence. Its affected product owners now carry the approved archive-report boundary
amendment; follow the ownership rule below rather than duplicating their implementation scopes.

This is a planning worklist, not an approved execution plan. Explain concrete workflows, propose
names/designs, obtain the operator's decisions and record the approved changes here. Do not infer
that every table needs a rename, consolidate tables solely to reduce their count, or implement an
undecided design. Use clear vocabulary consistent with the decisions already made in the earlier batch.

### One owner for each planned change

On 2026-09-08 the operator directed: “if we are going back to update the changes we made in the
existing plans, update those plans instead of overlapping the same table in a new plan.” Before
recording a revised table change, find its existing implementation owner. Amend that owner's scope,
proof, prerequisites and prompts together; this worklist should link to it rather than assign a
second implementation of the same change. Table renames do not create new ownership identities.
Shared tables/files between otherwise distinct changes still require one shared prerequisite owner
or an explicit ordering before launch. Never label conflicting assignments parallel-ready.

Distinguish completed historical scope from pending work: preserve completed evidence rather than
rewriting what an old candidate implemented. Record a new approved follow-up against that accepted
base when needed. For an in-flight owner, record a clearly dated amendment and reconcile its actual
candidate/remaining work before release; do not silently invalidate existing gates or launch a
competing task. This instruction does not authorize automatic task dispatch or messages.

Ownership check for the settings/version decisions: the current and committed sidetrack plans
contain no other pending assignment to consolidate these tables. The completed `worker-names` plan
at `d487254aa` explicitly kept `config_snapshots` unchanged and records accepted integration at
`1c8e294fe3510969c3a0f27dcf3506b922e4e42b`; its preservation requirement was for that completed
rename assignment, not a competing snapshot migration. Its working file is currently deleted by
another session; this planning change does not restore it. The earlier database-parallel batch
owns adjacent shared code, so execution allocation must still reconcile those prerequisites.

## Remaining discussion

| Group | Current tables / relationship | Decision |
| --- | --- | --- |
| Approvals | `gates`, `ocr_approvals` | Approved: remove unused projection and placeholder; preserve working approvals and future OCR durability requirements. See below. |
| Settings and version changes | `settings_current`, `runtime_config`, `config_snapshots`, `version_plans`, `version_bump_applications` | Approved: `app_settings` plus `settings_snapshots`, activated on save for new runs; existing runs retain theirs. Combine version proposal/application into `version_changes` with renewed review for changed archive membership. |
| Archive and deletion | `archived_runs`, `archive_relaunches`, `deleted_runs` | Approved: independent `archive.sqlite` with `archive_records`; verified transfer removes archived runs from live storage. Remove archive relaunch. Keep `deleted_runs` for explicit live/archive deletion, separate from transfer. |
| Messages and notes | `notifications`, `notes` | Approved: keep `notifications`; remove unused SQL `notes` projection only. Preserve diagnostic log files/readers and handle notification links after archive transfer. |
| Testing and Activity read model | `dry_run_scenario_results`, `activity_person_pseudonyms`, `activity_person_pseudonym_generations` | Approved: `dryrun_results`; shared derived `run_summaries` for Queue/Activity, using validated existing person identities for server-side counts in place of the two pseudonym tables. |
| Database maintenance | `authority_meta`, `authority_upgrades` | Open |
| Run/operation relationships | Historical `run_operation_attempts` links to `workflow_runs` across retry, re-fencing, archive and deletion | Open; use the [existing deferred finding](../operation-names/README.md#inspected-feasibility-and-separate-relationship-finding) |

For each group, explain which action creates or updates a row, its readers and linked rows, a
concrete example, and whether it is durable evidence, current state or a rebuildable read model.
Distinguish implemented behavior from reserved storage and planned functionality.

## Agreed execution cadence for this future batch

The operator explicitly requested reviews last, focused tests during parallel implementation, and
heavy tests plus remaining fixes in one new final session. Carry this scoped exception into the
approved execution briefs and the owning gate/governance references when those briefs are admitted:

1. Finish shared prerequisites first, with real working interfaces and meaningful focused proof.
2. Parallel tasks implement their complete scopes, fix discovered in-scope issues, run focused tests,
   lint and affected freshness checks, then return exact committed candidates. No peer reviews or
   repeated full coverage/parity runs at this stage.
3. A new final-validation session combines the candidates, owns all remaining repairs, runs the
   complete required heavy gates, and obtains fresh independent read-only review. It fixes findings
   and reruns affected checks there; no repair handbacks to completed peers or idle observer loops.
4. Master integration and final completion require passing full gates and independent review.
   A focused-tested prerequisite/peer commit is a development candidate, not final acceptance.

Keep Astra/high, strict proof/coverage/assertion requirements, isolated implementation branches,
one final integration/repair owner and evidenced test-resource allocation. Determine the actual
parallel split after examining shared schemas, callers, fixtures and the earlier batch's ownership.
Do not claim that independent planning means independent implementation. Preserve already running
assignments and the earlier batch's admitted schedule; create no additional task in this discussion.

After product decisions are approved, keep the complete prerequisite, peer, final-validation plans
and exact prompts together in this folder. No executable launch prompt is ready yet.

## Initial inspection: approvals

Read-only source inspection at master `cd47a750e4157f42fb1ca7268f1c19bbb4574006` found:

- `gates` is registered as a projection table. The real operator gate-result record is stored by
  `authority.gateResults` in `checkpoint_payloads`, not in the physical `gates` table.
- The gate command records run/gate/command identity, actor/time, expected version and the typed
  result, then transitions the run back to queued. The executor reads that durable result to resume.
- `ocr_approvals` exists as an opaque repository/table. Source search found no application writer
  outside the storage layer; the dashboard contract explicitly describes its intended machinery as
  unimplemented. Do not describe that planned OCR approval system as current runtime behavior.

Evidence: `src/domain/gates.ts`, `src/core/command-kernel.ts`,
`src/infra/sqlite/authority-database.ts`, and
[dashboard approval durability](../../rebuild/reference/dashboard-surfaces.md#44-durability-the-approval-manifest-is-part-of-the-contracts-execution-ported-as-is).
No code tests or database writes ran. Recheck consumers and migration behavior against the accepted
timeline implementation before executing the approved retirement direction below.

## Approved group 1: retire unused approval tables

On 2026-09-08 the operator approved the two proposed removals with “okay do that.” This approves
their inclusion in the new batch; it does not launch implementation or approve an executable
parallel split. Keep the complete execution briefs and prompts in this folder once the remaining
groups and shared prerequisites have been resolved.

| Table | Approved change | Behavior that must remain |
| --- | --- | --- |
| `gates` | Remove the unused physical gate projection and its storage-only scaffolding. | Workflow gate nodes, paused-run presentation, approval commands, durable gate answers and resumption. |
| `ocr_approvals` | Remove the unused OCR-specific opaque placeholder and its storage-only scaffolding. | The planned requirement to durably accept an OCR review and reliably create the intended child runs without duplicates after recovery. |
| `checkpoint_payloads` | Keep the table and existing name. | Existing authoritative gate-result records, including run/gate/command identity, actor/time, expected version, schema and result. |

### Concrete workflow to preserve

For an identity-confirmation gate in a separations workflow:

1. The workflow pauses; `workflow_runs` records the parked gate and worker/browser resources are
   released.
2. The operator submits a confirmation through the command system. It validates the current run,
   gate, version and answer schema; `commands` and `command_audits` retain the action and outcome.
3. The accepted answer is saved through `authority.gateResults` in `checkpoint_payloads`, and the
   run transitions back to `queued`.
4. A worker claims the queued run, reads the persisted answer and continues past the gate without
   requesting the same confirmation again.

The physical `gates` projection is not the authority for that answer. Current source inspection
found no application consumers of it; this is not evidence that every existing database is empty.

The OCR review-and-dispatch flow is future functionality, not an implemented replacement to claim
as complete here. Its eventual design should use shared gate/command and run-creation mechanisms
where appropriate, with explicit proof of durable acceptance, atomic/replay-safe dispatch and crash
recovery. A saved gate answer alone does not prove those dispatch guarantees. This batch removes
the unused placeholder; it does not implement OCR dispatch or erase its requirements.

### Requirements for the eventual execution brief

- Recheck actual readers/writers, the accepted timeline base, generic repository registration,
  migrations, upgrades, backups/restores and storage/recovery fixtures before retiring either table.
  Resolve newly discovered real consumers or authoritative stored data before destructive migration;
  do not silently discard it or widen scope into an in-flight assignment.
- Put shared schema, migration and recovery ownership in the prerequisite when it overlaps other
  groups. Do not assign two peers to edit the same authority surfaces independently. Establish the
  upgrade policy for supported existing databases, including populated legacy tables, before launch.
- When admitting the execution brief, update the owning approval/storage contracts and decision
  pointers to distinguish the retired tables from preserved behavior and future requirements.
  Remove obsolete registration and adjust relevant fixtures/catalogs/guards with deciding evidence;
  preserve unrelated projections and do not weaken assertions merely to pass removal tests.
- Focused proof must cover approval validation, durable answer storage and queued resumption,
  duplicate/stale command handling, and recovery using the saved answer. Verify fresh database
  creation plus supported upgrade/restore behavior and retired-table consumer absence. Exercise
  existing tests where sufficient; add tests for changed migration or runtime behavior as needed.
- Follow this folder's agreed cadence: focused tests, lint and affected freshness checks during
  implementation; heavy gates, remaining repairs and fresh independent Astra/high review in the
  final-validation session. No master integration or final acceptance before those gates and review.

Status: two table removals approved for planning; implementation, migration policy, parallel
allocation and launch prompts remain pending. The settings direction below is also recorded; other
discussion groups remain open.

## Approved group 2 settings: current settings and retained snapshots

On 2026-09-08 the operator corrected the proposed restart-based settings behavior: “it should
active the new configuration for new runs. old runs keep thier own config. but new ones will take
the new config without restart.” Record this as the required product behavior for the new batch,
not as behavior already implemented. The operator then accepted the proposed two-table direction
with the naming correction “just change it to settings snapshots.” Use `settings_snapshots` in
place of the proposed retained name `config_snapshots`. Version-change decisions are recorded in
the following section.

### Approved storage design

| Existing tables | Planned table | Responsibility |
| --- | --- | --- |
| `settings_current` and `runtime_config` | `app_settings` | One current row containing saved ordinary preferences, revision and command/audit identity, plus a reference to the complete snapshot selected for new runs. |
| `config_snapshots` | `settings_snapshots` | Immutable complete resolved configurations and their provenance. Runs retain a reference to the snapshot used for their execution; multiple runs may share one snapshot. |

Preserve the distinction between an explicit preference and an unset preference that uses an
application default. `app_settings` must not duplicate the entire resolved snapshot. The snapshot
records the actual resolved values for execution; it does not become a mutable settings row.

Saving validates and resolves settings, inserts the snapshot, updates the current settings and
snapshot reference, and records the command/audit in one transaction. A newly created run binds the
current snapshot atomically. Existing run references and snapshot contents remain unchanged.
Encapsulate save-and-activate and run creation so callers cannot partially perform this protocol.

Retire the separate physical `runtime_config` row after moving necessary current-selection and
consistency responsibilities into this design. Preserve worker authorization and ownership fencing
independently of run snapshot selection. Plan supported upgrades, initial/default settings bootstrap,
restore, snapshot references and historical fingerprint compatibility before execution. Do not
rewrite immutable historical configuration values merely to adopt the new name.

### Required behavior

- Saving valid run configuration activates it for subsequently created runs without requiring the
  operator to restart the dashboard or workers. An unsuccessful save must not partially activate it.
- Each run remains bound to an immutable configuration snapshot. Existing running, queued and
  paused runs keep their snapshot when settings change; they must remain executable/resumable.
- Example: run A is created with a 60-second task timeout. The operator saves 90 seconds. Run B
  created after the successful save uses 90 seconds. Run A keeps 60 seconds, including if it was
  queued or paused when the save happened. This is an illustrative value change, not a new default.
- Settings save/activation and run creation need a transactional boundary so concurrent requests
  choose one complete configuration, never mixed values. Define handling for reviewed but not yet
  accepted start requests; do not silently change reviewed execution semantics during acceptance.

### Inspected implementation and planning implications

- `src/domain/config/settings-current.ts` and `src/server/settings-runtime.ts`: current SQLite
  settings include actual ordinary values plus revision/command/audit identity. Settings reads
  authenticate the durable journal. Preserve that consistency when removing restart requirements.
- `src/server/dashboard/compose.ts` currently creates a configuration snapshot and activates
  `runtime_config` during dashboard boot. The settings result/runtime status currently requires a
  restart. Activation must become available on successful settings application, with read paths and
  UI status reflecting the new semantics.
- `src/server/dashboard/commands/start-plan-service.ts` currently receives configuration identity
  through composition-time dependencies. New requests must resolve the appropriate current identity
  after saves rather than retaining boot-time values.
- `src/core/run-executor.ts` already reads the retained snapshot named by the run envelope.
  However, `src/server/worker/compose.ts` captures runtime tokens and several resource/time-limit
  settings at composition, while `src/core/run-record-service.ts` and claim storage bind eligibility
  to active runtime configuration. Merely changing the active row would strand older work or leave
  effective settings stale. Inspect and update the complete execution/resource path.
- Separate current worker authorization/ownership checks from the run's retained configuration.
  Preserve stale-owner rejection, lease fencing and command replay protection; do not remove these
  checks wholesale to permit multiple configuration snapshots.
- Resolve retry/new-attempt and delegated-child inheritance rules before execution
  admission. Distinguish resuming an existing run from creating a new run; the current retry path
  also compares its source configuration with the active runtime. Inventory process-wide settings
  separately from run-bound settings and specify how updates take effect without operator restarts.
  Credentials retain their separate protected-storage rules; no secret values enter snapshots.

### Proof and allocation required before launch

Focused tests must cover a settings save followed by a new run without restart, unchanged execution
configuration for existing running/queued/paused runs, mixed-snapshot worker execution, concurrent
save/create ordering, invalid saves/rollback, restart recovery, and preserved ownership fencing.
Assert effective execution settings as well as stored fingerprints. Add proof for the resolved
retry/start-request rules and affected command/UI contracts. Archive relaunch is being removed by
the approved group 3 decision below, so do not build a new settings activation path for it.

This crosses settings application, run creation, worker execution and shared authority contracts;
it is a behavior change, not a mechanical table rename. Resolve shared prerequisites and existing
batch ownership before allocating parallel work. Carry the agreed final-session heavy gates and
independent review cadence. No implementation, contract ratification or launch prompt is authorized
by this discussion record alone; execution admission remains pending the complete batch plan.

## Approved group 2 versions: one change row from proposal to completion

On 2026-09-08 the operator approved the recommendation with “okay do that”: combine
`version_plans` and `version_bump_applications` into **`version_changes`**, and require an updated
review when the affected archive membership changes after preview. This replaces the earlier
unapproved two-table naming suggestion and the proposed name `app_version`.

### Approved design and workflow

One row represents one proposed version change, not the single current application version. It
supports whole-application or selected-workflow scope and moves `planned` → `applying` → `applied`
once, with recoverable progress during cross-database transfer. Multiple
proposals can target the same version, so the target version is not the row's unique identity.

Store shared scope, target version and change explanation once. Preserve the reviewed identities,
candidate membership, actor/time and review fingerprint separately from the eventual applied
identities, actual archive membership and application actor/time. The proposal stays fixed; applying
adds the outcome without rewriting what was reviewed. Completed rows are immutable. Saved reports
live in `archive.sqlite` → `archive_records`, with a stable version-change identifier and sufficient
saved change metadata to display without a live-database join. The archive section below owns
transfer, report storage and visibility; this section owns version-change review and lifecycle.

1. Preview creates a `planned` row with the exact proposed change and archive candidates/blockers.
2. Apply authenticates the reviewed row/revision/fingerprint and rechecks the current build,
   workflow identities, archive candidates and unresolved-run blockers inside the transaction.
3. If archive candidate membership has changed (added or removed runs), do not silently apply the
   new set. Return a distinct review-required outcome and present an updated preview for explicit
   review before application. Blockers clearing does not itself authorize additional archive members.
   Define the reviewed replacement/supersession protocol in the execution brief without overwriting
   earlier reviewed evidence or allowing stale confirmation to apply the replacement.
4. If valid, bind the approved membership and begin the recoverable archive transfer defined below.
   The public lifecycle now needs an in-progress `applying` stage: `planned` → `applying` → `applied`.
   Use the existing change row for durable progress rather than creating a second command or outbox
   authority. Local transactions remain atomic; do not claim that two SQLite databases and attachment
   files roll back together. Failure leaves explicit recoverable progress; exact replay resumes the
   same transfer or returns its completed result without duplicate archives. Competing applies cannot
   both win. Mark `applied` only after all selected reports are verified/published and live cleanup is
   confirmed. Define exact journal/audit results for pending, resumed and completed requests.
5. Archive/history reads use the same completed change row. Minor changes still archive nothing;
   major changes preserve all existing unresolved-submit and terminal-state restrictions. These
   commands do not install code or make the database the authority for the running build identity.

### Inspected evidence and required execution planning

`src/domain/archive/model.ts` defines the current reviewed plan and applied record;
`src/core/command-kernel.ts` creates, revalidates and applies them. The current apply path recomputes
archive membership, so renewed review for changed membership is a deliberate behavior change.
`src/infra/sqlite/migrations.ts` gives applications a unique plan reference and makes archive records
reference applications. `src/infra/sqlite/authority-database.ts` enforces plan consumption and immutable
application storage. The dashboard archive query reads both. These relationships can be represented
by one lifecycle row while retaining their proofs; no migration or runtime test has been executed.

Before admitting the execution brief:

- Define strict planned/applying/applied shapes, fenced one-time transitions, proposal immutability,
  completed immutability and archive visibility that cannot present a merely planned transfer as
  finished. Keep command and
  audit ownership in their existing tables; this consolidation does not duplicate command history.
- Plan supported conversion for unapplied plans and applied plan/application pairs. Preserve original
  identities and review/application meaning. Bind former archive references to verified converted
  reports; old source digests can remain migration provenance, not validators over newly formatted
  report bytes. Reject inconsistent pairs rather than fabricate a missing outcome. Reconcile ID
  mapping, old backups/restore and integrity checks at the shared migration owner.
- Ratify the changed archive-review behavior and storage ownership at the owning dashboard/archive
  contracts with decision pointers. Update command/API/read-model consumers and affected UI together.
- Focused proof must cover preview without application, successful recoverable application, applied-row
  immutability, exact replay, concurrent apply, stale review/build/workflow rejection, added/removed
  candidate review requirements, blockers, minor no-archive behavior, local transaction rollback,
  cross-database interruptions and verified report conversion through upgrade/restore. Use targeted UI proof for
  the updated-preview path. Final heavy gates and independent review follow this folder's cadence.
- Resolve overlap with the approved archive-relaunch retirement below, remaining deletion discussion
  and the shared database prerequisite.
  Do not assign competing archive-schema, migration or command-kernel edits to independent peers.

Status: product direction and name approved; complete execution allocation, migration policy,
review-replacement protocol, contract admission and launch prompts remain pending. No implementation
or separate task is launched by this record.

## Approved group 3: independent archive reports and no relaunch

On 2026-09-08 the operator directed: “remove the relaunch from archive feature” and confirmed that
archive records remain viewable when workflow versions differ because their original data is
preserved. This supersedes the unapproved suggestions to move relaunch lineage onto `workflow_runs`
or add a prefilled archive-relaunch review form. Do neither as a new feature.

The operator then clarified that archives exist to avoid ongoing legacy-run code, proposed a
separate archive database, and approved the recommended design with “yes lets do that. how will we
revise them”. This supersedes the earlier requirement to keep old archive payloads coupled to live
run schemas and preserve their exact representation forever. Preserve the information needed for
the saved report; convert representation deliberately and verify the result.

### Required behavior and scope

- Remove the archive Relaunch action and its execution entry points, including
  `relaunch-archived-run`. Retire producer-only planning, fan-out and lifecycle wiring when no
  supported caller remains. A stale client/direct command cannot create a run through the retired
  action. Keep historical command/audit envelopes readable without re-enabling execution.
- Archive viewing renders the saved report, workflow identity and captured results even if
  the current workflow changed or is no longer registered. Current descriptor availability cannot
  gate historical viewing. Preserve existing honest absence/retention behavior for old fields or
  separately stored evidence; do not invent unavailable data.
- Preserve normal new-run creation and existing non-archive retry/restart behavior. Archive transfer
  removes verified terminal runs and exclusively owned live records only after their report is safe;
  it is distinct from operator deletion. No archived run can be resumed/retried through a live door.
  Deleting a saved archive remains an explicit separate operation, with revised ownership checks.
- Inventory populated `archive_relaunches`, historical command/audit/batch-origin references and
  existing descendant runs. Decide historical storage disposition before admitting execution.
  Removing the feature does not automatically authorize deleting its historical lineage evidence;
  do not migrate that evidence into a second new table without an approved need.

### Storage and viewing boundary

- Add one independently stored `archive.sqlite` database with one `archive_records` table for saved
  reports. Use stable identifiers plus indexed workflow ID/name, workflow version, outcome,
  completion/archive timestamps and approved searchable person/item metadata. Use columns for
  cross-archive filtering, not separate tables per workflow/version. Final paths are bound through
  runtime isolation in the execution prerequisite; do not invent a second live authority root.
- Each row holds a standalone display document with generic labelled values, typed data tables,
  text/log sections and attachment references. Freeze all information in the agreed displayed-run
  inventory, including relevant settings, steps/results, failure/diagnostic state and activity at
  archive time. Do not serialize live `RunRecord`, current dashboard wire schemas or arbitrary
  workflow objects and then require their old parsers in the viewer. Define additional structured
  filters in the report contract where needed; a screenshot/opaque text blob alone is insufficient.
- A generic report renderer and query interface must read archives without workflow descriptors,
  live run/failure/settings records or current-version domain parsers. The archive format is its own
  small contract; future live schema edits must not force historical run adapters. Supported older
  report formats may be converted during archive-format upgrades instead of preserving every old
  runtime schema indefinitely. Retire old runtime compatibility paths only after proving no live or
  supported restore consumer needs them.
- Required attachment bytes must have durable archive-owned storage or verified independent
  retention before live cleanup. Persist the approved display content with existing redaction and
  secret boundaries. Record genuinely absent evidence honestly. Retention cannot silently remove
  files promised by a completed archive; deletion reclaims only exclusively owned bytes.
- After conversion/transfer, remove `archived_runs` from the main database and retire its live
  serializers/joins. Remove the archived run and exclusively owned checkpoints/results/failures/
  other records from live storage. Shared settings, imports, files, provider aggregates and records
  still needed by another run require reference-aware handling, not a blanket cascade.

### Recoverable transfer and consistency

One archive/version-change implementation owner must define and prove the following protocol:

1. Validate reviewed membership and terminal eligibility, then fence the selected source records so
   concurrent mutation/deletion cannot change the report or remove an uncaptured source. Record the
   transfer identity and progress on the existing `version_changes` row. Unresolved submissions and
   non-terminal dependent trees remain blockers; do not settle them merely to archive.
2. Build reports while their source data is readable. Write reports and required files durably with
   stable run/transfer identities, then verify completeness and integrity. Repeated writes must
   verify the same content or refuse a divergent transfer, never create duplicate reports.
3. Only after verification, remove exclusively owned live records in recoverable local transactions.
   Preserve a distinct archived disposition: moving to archive is not operator deletion. Define
   lookup, stale-command rejection, run-ID uniqueness and run/attempt numbering after live rows are
   gone. Do not reuse the existing delete cascade as though it had correct archive semantics.
4. Publish archive visibility and finish the change only when transfer and cleanup are confirmed.
   Precisely bind staging/publication to durable progress; interrupted partial batches must remain
   distinguishable and resumable, with no loss, duplicate final visibility or false completion.
   Do not erase a durable archive to conceal a cleanup failure.
5. Back up and restore both databases plus retained archive files as a defined recoverable set.
   Ordinary backup remains explicit-only. Specify how supported old backup formats are converted;
   recovery must not revive already moved/deleted runs or produce broken cross-store references.

### Existing archive conversion

Convert populated current `archived_runs` records once into the report format, using their stored
content rather than today's workflow to invent missing details. Preserve report-visible values and
necessary references; validate new report integrity separately from old source digests. Verify each
report and its files before removing the old archive row or retained live records. Empty archives
are not sufficient migration proof. Keep narrowly scoped old-format readers at the conversion/
restore boundary where required; the normal archive viewer must not import them.

### Approved deletion semantics

On 2026-09-08 the operator accepted the deletion recommendation with “okay. is that all?” Keep
the existing `deleted_runs` name and use the same deletion-receipt mechanism for explicit deletion
of live runs and archive reports. Do not create a second archive-deletion ledger.

- Archiving saves a report and removes its owned live records after verified transfer. It remains
  viewable and has an archived disposition, not an explicit-deletion receipt.
- Deleting a live run removes its owned data without producing a saved archive report. Preserve
  terminal/tree eligibility, command identity/replay, stale-run rejection and numbering protection.
- Deleting an archive removes its report and exclusively owned files. The receipt identifies the
  archive origin. A receipt is minimal deletion evidence, not a retained copy of the run/report.
- Keep deletion command/audit ownership in the existing command system. Define recoverable
  coordination between the shared receipt mechanism, archive database and file cleanup before
  implementation. A crash or failed cleanup must not become a false completed deletion; repeating
  the command must safely finish or return the established result. Preserve shared-file references.
- Backup/restore and transfer/delete races must respect the deletion result without reviving removed
  runs or treating an archived run as deleted. Resolve durable progress, lookup and receipt format
  within this existing archive/deletion owner and its shared prerequisite, not a competing plan.

Extend focused proof with explicit live deletion, explicit archive deletion, absence of deletion
receipts for archive transfer, stale-command and run-number protection, repeated/concurrent deletion,
interrupted cross-database/file cleanup, shared attachments and backup/restore after deletion.

### Proof and ownership before launch

Use this existing section as the sole owner of report storage, transfer, conversion and viewer work;
keep version-change lifecycle in its section above. The earlier batch's run-completion, diagnostic,
artifact and provider owners are amended in place for their data/retention boundaries. Do not assign
them duplicate archive-table or transfer implementations. Allocate the common migration, authority,
backup, run lookup and command surfaces to one prerequisite before parallel peers launch. Ratify
archive/storage contracts at their existing owners when admitting the complete brief. Reissue exact
prompts only after all changed owners and dependency boundaries are verified.

Focused proof must cover archive-relaunch retirement; report completeness and cross-workflow filters;
viewing after removal of live rows and old workflow code; changed live schemas with unchanged report
rendering; populated conversion including absent fields and files; interruption at each transfer/file/
cleanup/publication boundary; exact replay and concurrent apply/delete; mixed completed/in-progress
batches; archived versus deleted lookup; numbering/ID protection; provider accounting; shared-file
retention; and full-set backup/restore. Test normal new-run/retry behavior separately from retired
archive execution. Prove the renderer has no old run/workflow-schema import dependency. Apply this
batch's final-session heavy gates and independent review cadence; earlier in-flight gate schedules
and completed evidence remain intact.

Status: separate archive/report design, relaunch removal and deletion semantics approved for planning. Implementation,
historical lineage storage disposition, exact report/transfer contract, complete allocation and
launch prompts remain pending.

## Approved group 4: keep notifications and retire unused note projection

On 2026-09-08 the operator approved this pair with “okay lets do that.” Keep `notifications` and
its name. Remove only the unused SQL `notes` projection; preserve existing diagnostic note/log
files, their reader/writer and their content. This does not add user-authored notes, lessons or new
workflow logging producers.

### Behavior and inspected evidence

- `src/services/notifications/inbox.ts` publishes durable actor-scoped notification rows before
  optional desktop delivery, folds matching repeat triggers into a count/latest occurrence, and
  preserves independent read/unread and snooze state. Keep these behaviors, command/audit identity
  and actor/version checks. Reading an alert does not approve a workflow gate.
- `src/server/dashboard/compose/trust.ts` and dashboard composition connect gate observations to
  the inbox. `src/core/command-kernel.ts` updates notification read/unread/snooze state; the operator
  query reads the stored rows. The table has actual application consumers and remains useful.
- `src/infra/sqlite/authority-database.ts` registers SQL `notes` as a generic projection repository.
  Source search found no application caller of that repository; generic storage tests reference it.
  This is not proof that every existing database has zero note projection rows.
- `src/infra/events/note-jsonl-writer.ts` writes diagnostic messages and redacted structured fields
  to JSONL, and `src/server/dashboard/queries/run-logs.ts` reads those streams. Explicit emission
  calls found in this inspection were in tests/fixtures; do not claim all workflows currently emit
  notes. Table retirement must not remove this separate file-based capability.

### Scope, proof and existing ownership

1. Recheck consumers against the accepted execution base, retire the physical SQL projection and
   unused repository/catalog registration, and update relevant storage/upgrade/restore tests.
   Determine the supported treatment of populated projection rows before migration; do not mistake
   a projection for the authoritative note files or discard unexpectedly unique data silently.
2. Preserve log reading, redaction, scope, pagination and file retention. The existing archive-report
   owner captures available displayed notes/logs into the standalone report before live cleanup;
   the archive viewer must not depend on the original note files. Do not assign a second archive
   capture implementation to this group.
3. Preserve notification state while defining valid navigation after archive transfer. Retained
   links must resolve to the archive report, not a missing live run/failure route. Keep deletion
   handling explicit and prevent late notification publication from recreating moved/deleted run
   state. Implement common run/archive lookup changes at the existing archive prerequisite owner.
4. Focused proof covers durable inbox publication, repeat folding, read/unread/snooze, actor/version
   refusal, independent gate approval, absent SQL projection after fresh creation/upgrade, unchanged
   note-file readback/redaction, archive report log capture and notification navigation/deletion.
   Preserve supported backup/restore handling; classify actual historical inputs before retirement.

No other inspected pending sidetrack assigns this note-table retirement. Shared projection schema
changes belong with the already approved `gates` retirement in the common prerequisite, not in
competing peer migrations. Reconcile any newly accepted timeline changes at admission without
rewriting in-flight evidence. Apply this batch's focused-test/lint/freshness cadence and final-session
heavy gates/independent review. Complete allocation, migration policy and launch prompts remain
pending; no implementation or database writes are performed by this approval record.

## Approved group 5: dryrun results and shared run summaries

On 2026-09-08 the operator directed “change it to dryrun results” and questioned the necessity of
the two Activity identity tables. Rename `dry_run_scenario_results` to **`dryrun_results`**. This
supersedes the unapproved `workflow_test_results` suggestion. The subsequent Activity decision below
selects a shared summary read model rather than merely renaming its two identity tables.

Preserve the scenario-result behavior: assertion verdicts, scenario/manifest identity, subject label,
duration and execution identity when a run started. A subject-unavailable result can exist without a
run. Keep both dry-run-preview and transaction-free live-read arms; this naming decision does not
change execution safety or merge test assertions into workflow outputs. It does not include general
unit-test results. `src/server/dry-run-scenario/compose.ts` writes the result through the existing
repository; `src/domain/trust/dry-run-scenario-result.ts` owns its shape.

Plan the rename, source/consumer/registration changes and supported upgrade/restore proof at the
existing shared database prerequisite. Preserve IDs and result content, started/not-started checks,
execution-arm validation, run deletion and capture of displayed results during archive transfer.
Coordinate with the archive owner rather than creating another result-export plan. Focused tests
and lint/freshness precede final-session heavy gates and independent review; execution remains pending.

Read-only investigation of Activity found a possible simpler source: the current Separations
backfill already reads validated `run_results.result.value.approved.emplId` before deriving its
pseudonym. The pseudonym table provides per-run comparison identifiers; the generation table binds
one generation label to one key identity. They support the current privacy design rather than being
mathematically necessary to count distinct people. A server-side count over existing canonical
identities, returning only aggregates to Activity, is an alternative for operator discussion.
It requires explicit source/coverage rules and contract review before adoption, including missing or
ambiguous identities, retries/group members, and archive metadata if archives enter the selected
count. The approved summary design below builds on this observation; execution still requires the
specified source/coverage and privacy contract work.

### Approved shared read model

The operator asked for a prepared table so the dashboard would not gather data from many sources
on each request, then approved `run_summaries` with “yes lets do that. is it just that one table?
what else?” This is one additional stored read model serving both Queue and Activity, not separate
queue/activity calculation authorities. `archive_records` already owns prepared archived reports;
`notifications` remains the ready inbox state. Do not add generic summary tables for every screen.

- One `run_summaries` row represents one live run and references its source `workflow_runs` row.
  Store the display/filter facts required by Queue and Activity: workflow/date/status, start/end
  timestamps and completed duration, warning/completion/failure classification, grouping and
  parent/member relationships, plus validated person identity/availability for internal counting.
  Determine the complete field inventory from both consumers before fixing the schema. It must
  not duplicate the entire run, result, receipt, checkpoint or diagnostic payload.
- Preserve current eligible-run, timezone/date, grouping, member-containment, completion/warning,
  failure and unknown-duration semantics. Identity data stays inside the server boundary; Activity
  returns aggregates only. Never infer identities from names or arbitrary fields that resemble IDs.
  Preserve explicit unavailable counts for missing/ambiguous identities. This adopts existing
  canonical-identity counting and retires `activity_person_pseudonyms` and its generation-binding
  table after replacement proof and the owning privacy-contract amendment. Do not invent a new
  secret/key-generation mechanism to replace them.
- Backend updates the summary when relevant source facts change. Use one reusable derivation for
  initial fill, incremental updates and rebuilds. Same-database authoritative changes and summaries
  should commit together; file/event-derived inputs require a durable consumed position and explicit
  freshness handling. Preserve worker/command safety checks against source authority: no action is
  authorized by a cached summary. Replay must not double-count, and a failed update cannot silently
  serve stale totals as current. Parent rollups must refresh when contributing members change.
- Persist timestamps so elapsed displays can advance without rewriting every run each second.
  Derive immutable completed duration only from known timestamps. Trigger updates on relevant
  changes rather than every unrelated authority write or heartbeat.
- Queue uses indexed filtering, ordering and bounded pagination on summaries. Activity uses indexed
  range filters and aggregate queries over the same rows, without reconstructing every run from
  its receipt/failure/checkpoint stores. Distinct people and duration statistics must be calculated
  over the selected set; do not add daily distinct counts or average daily medians. No daily totals
  table is admitted by this approval.
- Rebuild from live sources, validate and publish a consistent summary generation; never expose a
  half-built table. Updates during rebuilding must be captured or excluded by a proven snapshot/
  catch-up protocol. Missing/corrupt/stale summaries need an explicit recovery/status path, not
  plausible defaults or an unannounced expensive alternate query path.
- Archive transfer captures a complete report while sources exist, then removes the live summary
  with live cleanup. Archive filtering reads `archive_records`. Preserve current Activity scope
  unless separately changed; cross-archive/all-time person counting is not implicitly authorized.
  Explicit deletion also removes the summary while preserving its deletion receipt.

### Read-path inspection and selective improvements

Source inspection (not a latency benchmark) found that the Activity client already makes one report
request. The work is server-side: `RunQueueProjection.buildActivityReportWire` enumerates canonical
live runs before filtering dates, constructs surfaces, and reads receipts/failures/person evidence.
`RunRecordService.list` loads workflow rows, checks archive membership per run, then slices pages;
`listCanonicalRuns` repeatedly calls that listing to obtain all pages. The archive index enumerates
both live/archived sets and loads individual archive records. The existing in-memory queue fold
therefore does not eliminate source lookups during serving.

Use the new shared summaries and independent archive index to replace these repeated list-time
reads. Push filters/pagination into indexed SQL and batch remaining relation lookups; a small indexed
join is acceptable and may be cheaper than maintaining another table. Detail pages keep their
bounded section-specific queries and load expensive sections when requested. Inbox/worker/settings
surfaces can use their existing prepared/current tables. Independently sourced operation/timeline
metrics retain their meaning and owner; do not silently relabel them as run counts to fit this table.

### Ownership, proof and admission

This section owns summary schema, derivation, consumer queries, rebuild and the two pseudonym-table
retirements. Amend the earlier foundation and completion/diagnostic boundary owners to provide one
coherent update seam; they must not create competing summary tables or calculations. Shared schema,
run mutations, grouping/annotation hooks, upgrade/recovery, archive cleanup and source adapters must
be assigned before independent peers launch. Reconcile timeline read paths at their actual accepted
base, preserving in-flight work. Ratify the shared Queue/Activity and privacy contracts at their
current owners when admitting the brief.

Focused proof must compare Queue and Activity results from the same selected data, including
grouped/ungrouped batches, members, retries, repeat people across days, missing identities, warnings,
failures and duration absence. Cover every meaningful mutation, exact replay, rollback, restart,
concurrent updates/rebuild, stale-generation refusal, archive/delete and populated migration.
Verify internal person IDs cannot leak through Activity responses/exports/logs. Benchmark isolated
representative fixtures before/after with query counts, rows scanned, latency and update overhead;
no unmeasured speedup is claimed. Preserve existing bounded-scan tests, floors and assertion meaning.
Use focused tests/lint/freshness during implementation and full gates/fresh independent review in
the final session. Complete field/source mapping, prerequisite allocation and prompts remain pending.
