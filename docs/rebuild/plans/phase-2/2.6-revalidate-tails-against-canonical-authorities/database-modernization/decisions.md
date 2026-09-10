# Remaining database tables — planning discussion

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

## Scope and working agreement

On 2026-09-08 the operator asked to continue the existing table-by-table design discussion in the
current task and collect all resulting changes in one folder, like `database-parallel`. No separate
planning task or implementation worktree is needed. This folder is the single owner for the new batch.
The [earlier database batch](foundation.md) retains its existing gate cadence and
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
| Database maintenance | `authority_meta`, `authority_upgrades` | Approved: retain behavior and rename to `database_state` / `database_upgrades` in R; retain existing backups and exports. Manual upgrades still record recovery progress. |
| Remaining table audit | `spans`, `operator_xlsx_exports` | Approved: F removes unused SQL spans while preserving timeline events and required historical-file readers. F/G consolidate export metadata and verified file evidence into generated_artifacts; retire operator_xlsx_exports. No report_exports table. |
| Run/operation relationships | Historical `run_operation_attempts` links to `workflow_runs` across retry, re-fencing, archive and deletion | Open; inspect the completed operation-name finding in Git at `58d4fbcba:docs/sidetracks/operation-names/README.md` |

For each group, explain which action creates or updates a row, its readers and linked rows, a
concrete example, and whether it is durable evidence, current state or a rebuildable read model.
Distinguish implemented behavior from reserved storage and planned functionality.

## Approved rename-first allocation — 2026-09-09

The operator approved inserting 2.6.2 R before C0 (now 2.6.3), moving all seven naming-only
changes to [renames.md](renames.md). Existing F/D/S plans consume those names and retain their
behavioral changes. Keep maintenance state/recovery, backups and exports; no automatic dashboard
update or change to displayed app-version policy is introduced. Scope remains planned, not implemented.
The focused-task/full-finalization cadence is a trial for **Phase 2.6 only**.

## Approved remaining-table disposition — 2026-09-09

The operator directed “put it there for xlsx” and “remove spans.” The existing
[artifact plan](artifacts.md#xlsx-consolidation-amendment--2026-09-09) owns export consolidation;
F supplies the single-row schema/conversion/baseline, G supplies publication and verification.
Each explicit XLSX export is one generated_artifacts file row with request, status and verified
output evidence. Keep independent request identities, historical receipt/download references,
authorization and exact content checks; retire the separate export table without dual writes.

F owns removal of the unused SQL spans projection, including registration, generic repository
and obsolete projection-only tests. Preserve timeline_events, logs and retained span-file inputs
needed by supported conversions/recovery. No blanket deletion of span directories or timeline data.
Focused absence/current-history tests belong to F; full recovery proof stays at 2.6.9.
These changes are structural and do not expand the seven-name R assignment.

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
[dashboard approval durability](../../../../reference/dashboard-surfaces.md#44-durability-the-approval-manifest-is-part-of-the-contracts-execution-ported-as-is).
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

## C0 execution allocation — 2.6.6.4 S

The [approved S01–S06 brief](#approved-s-execution-brief--2026-09-09) below supersedes this historical allocation. It retains all product proof, repairs the prerequisite binding, and includes the operator-approved focused merge/cleanup and test amendments.

## Approved S execution brief — 2026-09-09

The operator approved S01–S06 by asking to edit this plan and its prompt after the complete
proposal, then required the updated parallel protocol. The earlier request explicitly authorizes
local master merge and owned cleanup here and defers full gates and independent review to 2.6.9.
This section supersedes the C0 S allocation's obsolete prerequisite, no-master/retained-candidate
and separate `04-settings-evidence.md` instructions. Product requirements remain at
[group 2 settings](#approved-group-2-settings-current-settings-and-retained-snapshots) and
[the C0 settings contract](../../../../reference/clock-config-secrets.md#c0-settings-activation-and-recovery--2026-09-09).
S01–S06 are complete: focused integration PASS and owned worktree/ref cleanup verified.
A scoped S release is not final Phase 2.6 acceptance.

### Prerequisite, allocation and isolation

The common runtime prerequisite is **`2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`**, containing F's
complete resolver-port repair. Its tested candidate is `f917ffe7b2308b4746e2aba16719a68cbafdb56c`.
The [F repair record](foundation.md#f-resolver-port-repair--2026-09-09) and
[complete cleanup receipt](/Users/julianhein/Projects/hr-database-foundation-resolver-evidence-20260909/closure.json)
bind focused proof and removal of F's branch/worktree. Planning inspected master
`d3a4d121b2611bdd277663fabb953ea29f6dfa13`, a documentation-only descendant; no S runtime proof
is inferred from F's 1,195 unit cases, 199 guards and 67 filtered UI cases.

| Assignment | Binding |
| --- | --- |
| Supervisor and workers | One operator-opened GPT-6 Astra/high supervisor; zero implementation workers and zero reviewers in S. The coupled settings transaction, execution and proof fit one assignment. |
| Branch and checkout | Create `codex/settings-activation` at `/Users/julianhein/Projects/hr-worktree-settings-activation`; never implement in the primary master checkout. |
| Implementation base | The verified committed S plan containing this entire section and repaired F. The planner resolves its exact SHA in the launch prompt after persistence; do not start from F alone or uncommitted prose. |
| Capacity | Recheck refs, physical paths and `git worktree list --porcelain`. At inspection the unrelated `codex/separation-accounting-final` occupied one auxiliary slot. The four-auxiliary limit includes it; no removal, borrowing or capacity assumption is authorized. |
| Integration | The S supervisor merges only S into local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`, after S05 focused PASS and verified exclusive access to that actual mutation. |
| Order and independence | P/D/G/S consume the same repaired runtime inputs without unmerged sibling APIs. Either S/peer merge order is permitted; do not impose a whole-task queue. Preserve any actual active owner's boundary. |
| Downstream and final acceptance | L consumes the recorded S candidate/integration with the other actual releases. Final 2.6.9 owns combined pair/order proof, remaining repairs, full gates and fresh complete read-only `sup_review`. No new handoff handshake is required for these already assigned duties. |

### Exact write ownership

The eleven production files remain unchanged from the admitted allocation:

```text
src/infra/sqlite/settings-activation.ts
src/core/run-settings.ts
src/core/run-claim-admission.ts
src/server/worker/run-resources.ts
src/server/settings-runtime.ts
src/server/dashboard/commands/settings-service.ts
src/server/dashboard/commands/start-plan-service.ts
src/server/dashboard/queries/settings.ts
src/server/dashboard/queries/settings-editor.ts
src/dashboard/surfaces/settings.tsx
src/dashboard/surfaces/settings-model.ts
```

S owns the eight unit files below, new local fixture/support files under
`tests/unit/settings-activation/`, and settings-specific cases in
`tests/unit/worker-composition.test.ts` and `tests/unit/server/compose-real-port.test.ts`.
These two bounded amendments replace explicit old restart expectations with the new contract;
preserve corruption, protected-settings, historical and stale-owner negative controls. No P/D/G
test ownership intersects these additions. Other suites may be run/read but not rewritten.

S also owns new `tests/parity/settings-activation.spec.ts`,
`tests/parity/helpers/fixture-settings-activation.ts` and
`tests/parity/references/settings-activation-*`. Use isolated fixtures and reference names;
do not modify shared fixture-day/bff helpers or unrelated references. Do not edit D's resolution
cases in command-kernel/four-way-independence or P's authority-database invariant.

This section is the sole authored plan, progress, evidence and delivery-assessment owner. Serialize
only necessary S pointer/status updates in the combined README, prerequisites, PROMPTS, parent
2.6 README, roadmap source/generated site, D191 and decision pointer index. Shared generators own
their outputs; source registries, migrations, guard inventory, global unions, composition roots
and peer production files remain excluded. Any new required shared code change returns for an
ownership amendment before dependent work proceeds.

### Feasibility and acceptance proof

| Requirement and inspected mechanism | Required implementation/proof at the earliest stable boundary |
| --- | --- |
| Atomic save and full resolution | F now supplies `(settings) => ResolvedConfig` from dashboard and stopped-upgrade composition. S retains that result and uses existing snapshot/current/activation repositories inside the kernel transaction. Prove one complete commit, unchanged generation/journal/audit/snapshot selection on failure, revision conflict, malformed resolution and injected audit failure. |
| Host defaults and historical integrity | The returned configuration includes provenance and fingerprint; never infer a hidden host default from a previously overridden snapshot. Clear both display overrides and prove established host defaults return without materializing defaults in saved settings. Preserve old snapshots, valid historical restart-required audits and command binding; corrupt/missing authority fails distinctly. |
| New creation and accepted replay | F routes direct creation, intake/fan-out, retry/restart and existing parent-linked creation through S's selector inside their transactions. Prove current selection, one snapshot per atomic group, later child selection, and exact accepted-command replay after another save without new runs/snapshots/resolution. Do not add an automatic child producer or archive-relaunch functionality. |
| Reviewed start acceptance | F calls S's current-settings predicate before plan consumption. Prove changed settings yield `replan-required`, no plan consumption/run/session publication, and a freshly confirmed replacement uses current settings. Accepted replay precedes this check and retains original results. |
| Mixed execution and ownership | Worker composition now reads the current token in the directive/claim transaction and resolves resources from each run's retained snapshot. S separates current authorization from old/new snapshot eligibility. Prove queued/running/paused/resumed old runs remain executable, new runs use new actual timeout/browser/display/session/provider configuration, and stale owners/claims still cannot execute. No blanket removal of fencing. |
| Save/create ordering and restart | Use independent SQLite connections and valid positive controls: create before save keeps old settings; create after save gets new; an in-flight competing writer cannot observe a partial state. Reopen authority and prove selection and historical references survive. No operator DB or live upgrade is involved. |
| Process and safety boundaries | Current idle cadence applies at the next idle boundary without retiming active work. Retained run resources govern execution. Preserve runtime-isolation, host-probe and provider-environment process scope, shared quota counters, protected next-use rules, original inputs/instance/dryRun/delegation checks, operation keys, checkpoint eligibility and UNKNOWN refusal. A new snapshot never relabels reused observations as new effects. |
| Settings readback and UI | Real ordinary save returns no restart requirement and readback identifies current saved configuration; existing runs remain explicitly bound to their originals. Verify valid save, invalid/conflicting save, pending/error states, refreshed reads, reset-to-default, keyboard/focus and desktop layout. Current production HTTP and worker regressions require updating two formerly restart-based test cases/areas rather than leaving knowingly failing tests for 2.6.9. |

The resolver and shared creation/acceptance/composition blockers discovered during planning are
closed by F. Source inspection proves owners and reachable boundaries, not S behavior. No actual
deployment, operator-state migration or live-target acceptance is assigned; synthetic isolated
runtime/SQLite/browser fixtures are the proof target. Preserve the original historical recovery
and final phase-wide acceptance obligations for 2.6.9.

### Ordered execution

| Step | Outcome and completion evidence |
| --- | --- |
| S01 — Bind scope | Verify approved plan/F ancestry, complete F receipt, exact branch/path ownership and capacity. Create the isolated lane, read nearest server/dashboard rules, and record base/HEAD. |
| S02 — Atomic activation | Implement complete save-and-activate plus authenticated readback within the existing transaction; pass save/create, rollback, reset-to-default, historical and replay cases. |
| S03 — Execution and replay | Implement mixed-snapshot claim eligibility and retained effective resources. Prove new retry/child versus same-run resume, concurrent order, stale-owner refusal and restart. Preserve all safety identities and shared accounting. |
| S04 — Review and Settings UI | Complete stale-plan/fresh-confirmation and exact replay proof. Use `/ui` locally, Components/Content with existing design, and update Settings copy/status and focused desktop proof. |
| S05 — Focused release | Run the complete focused commands below, fix owned failures, commit logical categories with exact paths and freeze evidence against candidate SHA/tree. S remains unfinished until integration/cleanup. |
| S06 — Merge and cleanup | Verify master target ownership/cleanliness and plan/candidate identity; integrate only S, run invalidated integration checks or prove unchanged-input reuse, record the scoped release, preserve evidence and remove owned resources with verified absence. |

Send Done / Now / Remaining at start/resume and after each verified step, before the next tool
call. Keep every unfinished S step, integration and cleanup visible; state that complete review
and full phase acceptance remain at 2.6.9. Do not dispatch siblings or a reviewer from S.

### Reproducible focused gates and evidence cadence

The installed Vitest config inherits project settings; bind one effective file worker at root and
project level. Recreate an external resource-only adapter in
`/tmp/hr-settings-activation-proof/vitest-one.config.mts` with this content:

```ts
import baseline from "/Users/julianhein/Projects/hr-worktree-settings-activation/vitest.config.ts";
export default { ...baseline, test: { ...baseline.test, maxWorkers: 1,
  projects: baseline.test!.projects!.map((project) => {
    if (typeof project !== "object") throw new Error("unexpected project configuration");
    return { ...project, test: { ...project.test, maxWorkers: 1 } };
  }),
} };
```

Verify by inspection/object comparison that only root/project `maxWorkers` differs; retain the
adapter and resolved/observed worker evidence. Preserve project include/exclude lists, isolation,
deadlines, assertion membership and coverage floors. The four-effective-worker batch ceiling
includes other active invocations; use actual process/resource evidence, not a reservation survey.

From the S worktree, use
`VITEST_MAX_WORKERS=1 npm run test -- --config /tmp/hr-settings-activation-proof/vitest-one.config.mts --project unit --maxWorkers=1`
followed by all these explicit selectors for the committed focused release:

```text
tests/unit/settings-activation/save-create.test.ts
tests/unit/settings-activation/mixed-execution.test.ts
tests/unit/settings-activation/retry-child.test.ts
tests/unit/settings-activation/stale-plan.test.ts
tests/unit/server/settings-runtime-reader.test.ts
tests/unit/server/settings-facts.test.ts
tests/unit/dashboard/settings-editor-surface.test.ts
tests/unit/dashboard/settings-editor-client.test.ts
tests/unit/worker-composition.test.ts
tests/unit/server/compose-real-port.test.ts
tests/unit/sqlite-settings-authority.test.ts
tests/unit/run-record-service/service.test.ts
tests/unit/command-kernel-restart.test.ts
tests/unit/start-plan.test.ts
tests/unit/server/start-plan-omissions.test.ts
tests/unit/intake-command-arms.test.ts
tests/unit/worker-loop.test.ts
tests/unit/database-foundation/four-way-independence.test.ts
```

Use the same invocation with `--project architecture` for:

```text
tests/unit/architecture/sqlite-settings-authority.test.ts
tests/unit/architecture/settings-catalog.test.ts
tests/unit/architecture/strict-boundary-schemas.test.ts
tests/unit/architecture/dashboard-wire-boundary.test.ts
tests/unit/architecture/worker-loop-writes-only-through-the-service.test.ts
tests/unit/architecture/roadmap-doc-binding.test.ts
```

Run `npm run lint` whenever tests run. Run affected generators before freshness checks:
`npm run build:manifest` / `npm run build:manifest:check`, `npm run stores:catalog` /
`npm run stores:catalog:check`, and `npm run roadmap` / `npm run roadmap:check`.
Check local Markdown links, instruction twins/32,768-byte chains and `git diff --check` for records.

Desktop commands:

```sh
npm run test:parity -- tests/parity/settings-activation.spec.ts --workers=1
npm run test:parity -- tests/parity/dashboard-reference.spec.ts --grep 'settings|start' --workers=1
```

The dedicated test covers actual served save/refusal/readback behavior, both themes, minimum
1024×720 desktop, zoom/wrapping, keyboard/focus, pending/error/conflict and reset-to-default.
Deliberately create only its new references with `/ui` visual inspection and
`npm run test:parity:update -- tests/parity/settings-activation.spec.ts --workers=1`, then run the
assert command. Existing references remain unchanged. The filtered runner's necessary candidate
bundle build is allowed; broad production-build acceptance remains deferred. Manual browser work
uses the required playwright-cli playbook; do not switch to prohibited browser MCPs.

Iteration runs affected subsets; logical candidate commits require the complete applicable focused
evidence. Record commands/exits, selectors, tested SHA/tree, inputs and logs at this owner. Evidence
recording alone uses documentation checks and explicit unchanged-input comparisons, not fabricated
runtime reruns. Integration changes rerun every invalidated check and neighboring safety cases;
same execution/test/configuration/dependency inputs permit documented D191 reuse. No failing check
is waived or assertion weakened. Full typecheck/coverage, whole architecture/parity, broad
build/performance, original phase-wide recovery/scenario proofs and independent review remain
**2.6.9**, not a prerequisite to an S commit or merge.

### Updated parallel coordination and completion

Read `~/.agents/skill-library/parallel-agent-work/REFERENCE.md` and **Parallel coordination** in
`~/.agents/skill-library/focused-sessions/REFERENCE.md` at execution. Default to independent work
and **no peer messages**. Following the protocol does not request check-ins, reservation rounds,
readiness announcements or a group-wide slot. Existing grants for actual shared mutations remain
binding until verified release; do not infer acquisition from silence, elapsed time or clean Git.

Use committed plans, Git and existing evidence first. Message only the exact affected known owner
when an unresolved blocker, conflicting write/resource claim, changed required input or necessary
duty transfer requires that owner's action and cannot be resolved from primary evidence. No
broadcasts, acknowledgment loops, copied gate reports or proactive release relays. For an actual
conflict use a supported acquisition check if available, otherwise one request to the owner and
one verified release only when needed to unblock that named waiter. This plan creates no lock,
queue, scheduler or new task. Keep worktree-local work running while only the conflict waits.

Shared planning documents/indexes and master merge/regeneration are real shared mutations.
Recheck target HEAD and ownership immediately before them, preserve every sibling change, stage
exact paths and release after that operation. Worktree-local reports, temporary fixtures and
ephemeral ports remain isolated. Do not request group availability for a clean checkout. On a new
scope or actual overlapping code claim, stop that dependent operation for amendment rather than
taking another owner's file. P's limited DB invariant and D's test/timeline additions remain theirs.

After S05, the S supervisor still owns S06; recording a candidate does not transfer integration or
cleanup. L and 2.6.9 already own their recorded downstream duties and need no new acceptance
handshake or status message. Use native delivery/committed evidence; explicitly obtain acceptance
only when transferring a duty S still owns. End the active turn once assigned work/processes are
complete. Do not monitor siblings, invent automation or launch successors. Resume only for an
owned repair/missing evidence/assigned verification or the operator's continuation; preserve unique
interrupted state with `/handoff` if it is not already recorded here.

For S06, apply `/worktree-sweep` to the exact S lane. From a safe integration checkout after
switching command work away from the owned checkout, verify S is integrated, preserve ignored
proof outside it, stop only owned processes, remove with ordinary `git worktree remove`, and delete
with `git branch -d`. Verify registration, physical path and ref absence; never remove the primary
checkout, an active supervisor checkout, unrelated lane or dependency target. Record final master,
candidate/integration/tree identities, gate/reuse evidence and actual cleanup results in this
section and a preserved machine-readable receipt. No current task archival, push, live DB upgrade,
HR submission or unrelated cleanup is authorized. Report residue instead of claiming closure.

### Planning persistence and launch state

Approval covers S01–S06, the two settings-specific test amendments, isolated desktop proof, local
merge/cleanup and updated coordination protocol. Planning persists this full section and synchronized
S pointers, runs documentation gates/lint/freshness, commits exact paths, verifies committed content
and prerequisite ancestry, then provides a resolved prompt and stops. No product implementation
or child launch occurs in this planning session. The dated verification record below binds actual
plan/base identities after commit; the runtime prerequisite alone is never the S plan SHA.


### S planning verification — 2026-09-09

Approved plan and exact implementation base: `d22b6e8e657e442f2c287b679833e96c1e7173f8`; plan tree
`83d2cb244030bb26437ca9feffda9d334df1c0c3`. The planner read the complete section back with
`git show`, matched the prepared full proposal, verified repaired F ancestry and its complete
resolver cleanup receipt, and verified S branch/path absence. All source/test/configuration/
dependency inputs match repaired F. One unrelated auxiliary worktree remains; capacity is a
mandatory volatile recheck at launch, not a promised reservation.

The documentation-only plan passed 24 roadmap-binding tests, lint, roadmap generation/freshness,
210 local links, nine instruction-pair comparisons, the 17,333-byte maximum project instruction
chain and whitespace. Logs, exact changed paths, plan hash and command exits are retained in
`/Users/julianhein/Projects/hr-settings-plan-evidence-20260909/`. Full runtime gates and review
were not run and are not claimed; they remain in 2.6.9.

The resolved prompt in PROMPTS uses this exact plan/base, the isolated branch/path, updated
no-default-messaging protocol and scoped merge/cleanup conditions. This prompt/verification
record changes only documentation; rerun affected document checks and reuse lint only after
confirming its executable inputs are unchanged. The planner holds the actual shared write only
through final validation/commit and releases it to the already identified waiting P owner after
verified completion. This is a specific resource release, not a group scheduling protocol.
Implementation remains unstarted; planning creates no worktree, implementation agent or new task.

### S execution record — 2026-09-09

Current state: S01–S06 complete, integrated locally with focused PASS and verified owned cleanup. This is a scoped development release only. L and final 2.6.9 retain their existing
assigned duties; no messages, new acceptance handshake, worker or reviewer were dispatched.

- Exact approved plan/base: `d22b6e8e657e442f2c287b679833e96c1e7173f8`; required ancestor
  `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` verified by `git merge-base --is-ancestor`.
- Branch `codex/settings-activation`, checkout `/Users/julianhein/Projects/hr-worktree-settings-activation`.
  The branch/path were absent before creation. Three unrelated auxiliary worktrees existed;
  S brought the total to four. All unrelated work was preserved.
- The complete F resolver cleanup receipt was read and its branch, physical checkout and
  worktree registration were confirmed absent. S does not infer its own runtime proof from F.
- Test-only schema amendment explicitly approved in this session: repair exactly the three
  unchanged `compose-real-port.test.ts` fixtures that still expected schema40/floor39 and a
  future schema41. They now test schema47/floor46 and future schema48. Downgrade refusal,
  zero early settings/resolver reads, untouched database bytes and process-lock release remain.
- Implementation retains the resolver's complete result, authenticates its fingerprint, inserts
  the immutable snapshot and activates it inside the kernel transaction before the exact audit
  and saved-row advance. Both historical `restartRequired: true` and current `false` audits
  remain authenticated; a new false audit must bind its active saved identity.
- Mixed-snapshot admission preserves current generation authorization and independent claim
  ownership. The existing claim path still checks each run's exact retained snapshot. F's
  creation, reviewed-plan, retained-resource and idle-cadence hooks remain the shared inputs.
- Iteration logs and the one-worker adapter are retained in `/tmp/hr-settings-activation-proof`.
  Save/create rollback, malformed resolution, restored host defaults, retained snapshots, real
  connection exclusion and reopen passed. Production worker and HTTP tests preserve corruption,
  protected next-use and historical replay controls. Stale-plan refusal followed by fresh
  confirmation and accepted replay passed without run/session publication on refusal.

The old restart-expectation tests were changed under the approved contract, not merely to match
implementation output. The nested-save rollback test now injects an ownership failure after the
valid save; separate current/stale-token and real stale-owner controls distinguish this from the
newly valid save-before-claim ordering. Source-preserving proof uses the actual seeded retained
snapshot identity rather than the fixture's pre-seeding placeholder fingerprint.


#### S05 focused candidate and evidence

Runtime/UI/tests candidate: `e2f65428f0f580381121d8be1bda9d754cdcb2b3`; tested index and committed
tree: `64d279ca59050d4b3d1dbd667550cfa02f9f75c2`. All 28 changed production/test/reference paths
are inside the admitted scope and explicit three-fixture amendment. Six of the eleven permitted
production files changed; the other five retain F's real composition hooks.

| Focused gate | Result and preserved primary evidence |
| --- | --- |
| All 18 assigned unit selectors | PASS, 350 tests; `candidate-unit.log` |
| All six assigned architecture selectors | PASS, 49 tests; `candidate-guards.log` |
| `npm run lint` | PASS, zero warnings; `candidate-lint.log` |
| Manifest, store catalog, roadmap generators and freshness checks | All six commands PASS; no generated diff |
| Dedicated desktop assertion | PASS, both themes, two cases; `candidate-desktop.log` |
| Existing settings/start + dedicated accessibility evidence | PASS, 34 cases; `candidate-filtered-desktop.log` |
| Documentation checks | PASS, local links, nine instruction twins, longest chain 17,333 bytes; `git diff --check` PASS |

[Preserved freeze receipt](/Users/julianhein/Projects/hr-settings-activation-evidence-20260909/freeze.json),
[exact commands/exits/log hashes](/Users/julianhein/Projects/hr-settings-activation-evidence-20260909/candidate-gates.json),
and [complete tested input hashes](/Users/julianhein/Projects/hr-settings-activation-evidence-20260909/candidate-inputs.json)
bind this candidate. The final run reported no changed inputs. The adapter's object comparison
proves only root/project `maxWorkers` changed; each project resolves to one. Observed effective
Vitest concurrency was two including peers, below four. At creation S was the fourth auxiliary;
a later P checkout briefly brought the observed total to five, then G's independently completed
cleanup restored four. S created no additional lane and never removed or borrowed peer resources.

The exact prescribed existing-only parity filter passed all 32 tests but its wrapper failed because
it selected no required body-backed accessibility evidence. The repair adds the owned Settings spec
to that same command: `npm run test:parity -- tests/parity/dashboard-reference.spec.ts tests/parity/settings-activation.spec.ts --grep 'settings|start' --workers=1`.
This retains every original selected test and reference, adds two cases and satisfies the wrapper;
no failure was waived. Dedicated saved/reset references were deliberately created, visually inspected
in both themes at 1024×720 and 125% zoom, then asserted. Keyboard focus, pending save, current
readback, revision conflict, network error, invalid path and reset-to-host-default are covered.
The invalid-path case exposed a synchronous validation exception; the UI now reports it inline.

Mixed execution proof reaches the real browser factory's launch boundary with synthetic, isolated
profiles and a launch sentinel. It verifies retained viewport, headless mode, task/session limits,
provider model chains and the same authority accounting object without authentication or HR writes.
The explicit idle proof verifies an existing wait is unchanged by save and the next wait uses the
saved cadence. Retry/new child select current settings; same-run resume retains the original envelope.

The manual `settings-activation` browser session and owned specimen Vite server are stopped.
S06 will recheck master ownership/cleanliness, merge only S and rerun invalidated focused evidence
on its actual integration tree. Independent review, full typecheck/coverage, broad architecture,
parity/build/performance and original phase-wide recovery/scenario acceptance stay at 2.6.9.

#### Delivery assessment

The schema-fixture scope omission and parity wrapper/filter incompatibility were discoverable
planning omissions. The operator authorized exactly three schema fixture repairs; this adds no
product scope. The invalid-path handling defect was found by the planned desktop proof and fixed
inside S's owned UI model. Synthetic resource fixtures required corrections for process-only paths,
artifact-root identity, session timeout bounds and explicit instance; these are proof implementation
repairs, not weakened runtime constraints. Iteration and failed-run logs remain preserved alongside
final PASS evidence. Review count is zero by the explicit S approval; review belongs to 2.6.9.
Supervisor work crossed automatic compaction and resumed from verified files/gates; no worker was
resized or recycled. Exact total historical repair/time telemetry is not inferred. Final candidate
and integration runs are required validation, separate from those repair rechecks. Future briefs
should validate current schema fixtures and the filtered runner's accessibility requirement before
freezing their test ownership/commands.



#### S06 scoped release and cleanup — 2026-09-09

S is released to L through this committed record. L and final 2.6.9 retain their previously assigned
combined proof, repairs and independent review; no new acceptance handshake or successor launch occurred.

| Identity / result | Verified evidence |
| --- | --- |
| Original runtime/UI candidate | `e2f65428f0f580381121d8be1bda9d754cdcb2b3`, tree `64d279ca59050d4b3d1dbd667550cfa02f9f75c2` |
| Original S evidence tip | `8c060098cbfb1854cdd12e2c0cdc09f217612aaf` |
| First local integration | `2fa5a9166ef25af970c2e5585c1e1912faea01dd`, tree `8adf8854729ce7a7f6daf6617bb360da3e57720c` |
| Final test-only candidate | `d2744ea658f44730eadbc35f7fa83a68ee7b7ff7`, tree `ce1d486e96addbb75a1515367d33db0a92eb1bf7` |
| Test-only local integration | `c7336ec9ba6557a9980c2996a04c68ff027e7284`, tree `b64f534119ab7c601d19ac30d79f0adf44cce9d8` |
| Integration focused units | PASS, all 18 files / 350 tests on merged P/D/G/S inputs |
| Integration guards / lint / freshness | PASS, six guards / 49 tests; lint and all six generation/check commands |
| Integration desktop | PASS, dedicated two cases plus unchanged settings/start and dedicated evidence: 34 cases |
| Final resource proof | PASS, four cases; six guards / 49 tests and lint rerun after the test-only strengthening |
| Cleanup | Ordinary worktree removal and `git branch -d` PASS; physical path, registration and branch ref absent |

[Integration commands and log hashes](/Users/julianhein/Projects/hr-settings-activation-evidence-20260909/integration-gates.json),
[final resource proof](/Users/julianhein/Projects/hr-settings-activation-evidence-20260909/provider-final-gates.json),
[input-identical reuse](/Users/julianhein/Projects/hr-settings-activation-evidence-20260909/provider-reuse.json), and
[complete closure receipt](/Users/julianhein/Projects/hr-settings-activation-evidence-20260909/closure.json)
retain the exact candidate/tree, final master/tree, input/log hashes and cleanup commands. The
integration run observed no changing inputs. Final strengthening changed only the owned resource
test: actual OCR adapters now prove both ordered retained model chains with fixed synthetic process
credentials. All 17 other unit files (346 cases), production/dependency/configuration and desktop
inputs are byte-identical; reuse is explicitly proven rather than assumed. The complete original
candidate remains reachable through local master.

The only merge conflict joined two independent additions at the same location in this S section:
planning receipt `21786a207` and execution receipt `8c060098c`. Both complete sections were kept;
no product or sibling content was dropped. Primary HEAD/index/cleanliness were checked immediately
before each shared mutation. All implementation and the test-only follow-up were made in S's
worktree. The final record/pointer update changes documentation and generated roadmap output only;
its affected documentation/roadmap gates and executable-input reuse are preserved in the receipt.

Ignored bundle, parity output and manual browser evidence were copied outside the worktree before
removal. The owned manual browser/server and gate processes exited; the dependency symlink's target
was preserved. Other worktrees/branches and operator state were untouched. No push, operator DB
upgrade, HR submission, task archive, peer message, worker/reviewer or sibling launch occurred.
Full typecheck/coverage, broad architecture/parity/build/performance, combined pair/order and
phase-wide recovery/scenario proof, and complete independent review remain explicitly at 2.6.9.

The final proof inspection added the actual provider-construction assertion because stored snapshot
checks alone did not prove the production adapter received the model chain. This was one further
owned proof repair, with no production change or new product scope. Its affected rechecks are
separate from the required first integration run.


## C0 execution allocation — 2.6.7.1 A

Prerequisite: **one frozen L release, identical to Q base**. One Astra/high supervisor, zero implementation workers.
Use the exact `A` branch and absolute worktree in [PROMPTS.md](PROMPTS.md#binding-registry).
This allocation supersedes older shared-file/side-task ownership in this owner; product proof is retained.
Current inspected baseline is R `60b356dd119140dc972a077751ad16af934acb2e`, schema39/floor37.
Future prerequisites build the explicitly named new modules before peers launch; names do not assert readiness.

Ordered outcomes: Verify archive/identity/cleanup/summary hook baseline; implement generic capture, historical conversion, version-change transfer and explicit archive deletion; prove each cross-store interruption; release to V.

### Exclusive changing paths

- `src/services/archive/report-capture.ts` (new target)
- `src/services/archive/archive-transfer.ts` (new target)
- `src/services/archive/version-changes.ts` (new target)
- `src/infra/sqlite/archive-records.ts` (new target)
- `src/server/dashboard/queries/archive-reports.ts` (new target)

### Proof and test ownership

All approved archive/version/deletion proof remains, including populated historical relaunch provenance, membership change requiring re-review, immutable source and report integrity, required file custody, live/shared-owner preservation, stable numbering and no deletion receipt on transfer. L supplies real backup/restore, explicit tombstones, source fences and live cleanup including summary removal; A cannot edit Q derivation or shared command/authority files.

- `tests/unit/archive-transfer/capture.test.ts` (new required test)
- `tests/unit/archive-transfer/recovery.test.ts` (new required test)
- `tests/unit/archive-transfer/deletion.test.ts` (new required test)
- `tests/unit/archive-transfer/historical-conversion.test.ts` (new required test)

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

Release committed candidate/base/tree and focused evidence to the next named consumer. No master
integration, independent review, heavy-gate waiver, sibling dispatch or live database application.
Future-base binding remains WAITING ON the actual prerequisite release, not a fabricated SHA.

Authored release evidence: `05-archive-evidence.md` in this folder (new, exclusively owned by A).
The shared `decisions.md`, prerequisite and registry files remain read-only during peer work;
only the consuming prerequisite/finalizer updates shared status.

## C0 execution allocation — 2.6.7.2 Q

The approved Q01–Q06 brief below supersedes the historical three-file allocation and its
no-master/retention wording for Q only. All [Group 5 product proof](#approved-group-5-dryrun-results-and-shared-run-summaries)
remains required. A's ownership and the final 2.6.9 acceptance are unchanged.

## Approved Q execution brief — 2026-09-09

The operator requested `/phase-plan 2.6.7.2`, local merge and cleanup, full gates only at the end
of 2.6, and the parallel-work protocol. After inspection identified the excluded shared hooks,
the operator approved the recommended narrow Q ownership expansion with “okay do it.” This
brief implements that allocation decision; it does not mark Q implemented or launch a supervisor.
Full typecheck, coverage, broad architecture/parity/build, phase recovery/performance acceptance,
and fresh complete independent review remain with **2.6.9**, not Q.

### Assignment and isolation

| Assignment | Binding |
| --- | --- |
| Implementer | One GPT-6 Astra/high supervisor; zero implementation workers and zero reviewer dispatches here. The coupled mutation/publication/query seam fits one supervisor; splitting it would create dependent writers. Final 2.6.9 owns fresh complete `sup_review` coverage of Q and combined archive/served behavior. |
| Branch / checkout | Create `codex/run-summaries` at `/Users/julianhein/Projects/hr-worktree-database-other`. Both were absent at planning; recheck ownership/capacity before creation. Never use master for implementation. |
| Product base | `5d47c27ac114f91c8a0574cfe5649ed96f876c3a`, containing L candidate `08d9f4f5334eb20a49334acda268727b622b1163` and integration `a8ee826dc`. Use the committed approved planning release that descends from this base as the execution start; the resolved prompt supplies its exact SHA. Preserve L's frozen interfaces used by A. |
| Integration owner | Q supervisor owns Q's local integration into `master` at `/Users/julianhein/Projects/hr-automation-rebuild`, after Q focused PASS, and owned cleanup. This planner owns only this approved documentation integration. No peer receives a new duty. |
| Peer independence | A owns its five archive implementation files and archive-transfer tests; Q owns the summary files and narrow shared sections below. Neither consumes the other's unmerged implementation. Either order is permitted, subject to unchanged A contracts and Q's independent archive-baseline regression proof. V consumes both actual releases. |
| Coordination | Follow [Parallel coordination](/Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md#parallel-coordination) and [supporting-agent protocol](/Users/julianhein/.agents/skill-library/parallel-agent-work/REFERENCE.md). No check-in, reservation chain, peer messages or dispatch by default. Only shared-target mutation is serialized. An actual conflicting write blocks that integration, not unrelated worktree-local work. |
| Resources | At planning only the main worktree existed; the planner uses owned `hr-worktree-summary-plan`. Tests use runner-owned temporary SQLite roots and one effective worker; benchmark uses its own synthetic temporary root. No browser, provider, operator database or shared runtime port is needed. Never steal a lock or alter another task's processes. |

### Changing ownership and exclusions

Q owns `src/core/run-summary.ts`, `src/infra/sqlite/run-summaries.ts`, and
`src/server/dashboard/queries/run-summaries.ts`. The approved expansion additionally permits:

- `src/infra/sqlite/authority-database.ts`: summary query/refresh entrypoints, affected-source
  tracking and summary publication at outer transactions, including nested rollback bookkeeping
  and relevant source-writer notifications. Preserve authority generation and all command/archive
  identity, fencing, deletion, capture, backup and recovery semantics.
- `src/core/run-lifecycle-storage.ts`: summary ports only; all archive and paired-recovery exports
  remain compatible. `src/domain/run/summary.ts`: summary source, publication and internal query
  types only. Keep persisted historical rows readable or explicitly rebuild-required; no silent
  defaults and no public identity fields.
- Owned `tests/unit/run-summaries/{derivation,mutations,rebuild,privacy,queries}.test.ts`, local
  fixture helpers, and `tests/perf/run-summaries.ts`. In
  `tests/unit/lifecycle-foundation/source-hooks.test.ts`, update only assertions tied to the
  superseded every-row/every-authority-generation rewrite, replacing them with stronger freshness,
  affected-row and rollback assertions. Keep other L tests/fixtures read-only and run them.
- Q alone authors `06-summary-evidence.md` in this folder. Generated manifest/catalog outputs may
  be regenerated from owned inputs, never hand-edited; reconcile combined output at integration.

No live migration, new table, historical migration rewrite, new public route/wire, dashboard/UI
cutover, archive policy edit, pseudonym replacement, guard retirement, daily-totals table or
transaction-metric redefinition. Existing summary indexes permit workflow/range partitioned reads
and parent lookups; cross-workflow queries must enumerate indexed partitions and combine bounded
pages/selected aggregates, not materialize every source row. If measured query plans establish that
new persistent DDL is necessary, return that concrete evidence for amendment before changing it.
V owns real served-route composition and U owns surface changes. Q supplies executable, validated
internal query ports for V; it must not claim the existing dashboard already uses them.

### Feasibility and acceptance evidence

Inspected at the product base; these are source findings, not executed Q proof. Contracts:
[shared read model](#approved-shared-read-model),
[dashboard target](../../../../reference/dashboard-surfaces.md), and
[aggregate privacy](../../../../reference/operator-trust.md).

| Boundary / inspected mechanism | Q change and required proof |
| --- | --- |
| `AuthorityDatabase.#withTransaction` refreshes all summaries after every dirty authority commit; `createRunSummaries.refresh` deletes/rebuilds all live rows. | Track contributing changes and update affected runs plus parents in the same transaction. Unrelated writes/heartbeats must not rederive or rewrite every summary. Test creation, lifecycle/result/receipt/failure/resolution, title, batch/group, dependencies and relevant timeline events, exact replay, multiple writes, nested rollback and outer rollback; committed source and summary must never diverge. |
| Global authority generation and `read` currently demand the same generation on every row; existing L tests assert that implementation. | Separate publication freshness from a row's last contributing source revision. A validated publication can include unchanged older rows; an unaccounted source change cannot be accepted. Rebuild old-format rows explicitly as needed. Prove unrelated writes remain readable, meaningful changes update immediately, corruption/stale publication refuses after restart, and no default zero totals escape. |
| `refresh` is already called under `BEGIN IMMEDIATE`; timeline inputs are SQLite rows with durable cursors. | Reuse the transaction/snapshot boundary for atomic rebuild publication. A rebuild failure preserves the previous committed generation, never a partially rebuilt table. Prove independent reader/writer connections, update before/during/after rebuild, blocked or serialized writers, rollback, restart and exact replay; no new in-memory-only freshness authority. |
| `readRunSummaries` loads every row; the query module is only a pass-through. Existing workflow/day/state and parent indexes are available. | Add bounded internal Queue filtering/order/pagination and selected-set Activity aggregation through the real authority read snapshot. Verify SQL query plans, query/row counts, bounded relation reads and stable pagination ties. No receipt/checkpoint/failure reconstruction per displayed row; never silently fall back to the old whole-run reader. |
| Current Activity uses local enqueue day, counts operations once but excludes operation-members from top-level totals, includes eligible member identities, and uses the lower median over the selected durations. | Compare independent expected results and the retained projector on identical synthetic sets: grouped/ungrouped batches, members, retry attempts, repeated people across days, date/timezone boundaries, unknown duration, completion/warning/failure and unregistered workflows. Preserve existing status and duration contracts; distinguish source defects from legitimate unavailable facts. Do not sum daily distinct counts or average daily medians. |
| `deriveCanonicalPerson` validates Separations result/schema and run tuple; L already retired current pseudonym tables. | Preserve validated server-internal identities and explicit unavailable counts. Identity mismatches refuse; unsupported/missing identity stays unavailable. Verify aggregate/query serialization and export-compatible projections expose no person IDs or protected-derived digests; sanitized errors/benchmark logs do not leak. Existing Activity export tests remain unchanged and pass; V owns later route/export wiring. |
| L provides real capture/transfer/deletion with summary cleanup, independently of A. | Exercise Q against L alone with summary-first/archive-first fixtures, transfer/deletion/replay and reopened databases. No live summary resurrection or archive included in generic Activity. Run L peer-contract and two-store-recovery tests without editing them. A's immutable source digest/report and shared file ownership remain unaffected. |

No actual-target preflight applies: this assignment runs synthetic databases only. It does not
upgrade the operator's database or spend a live HR session. L's release evidence is in
[prerequisites.md](prerequisites.md#l06-scoped-release--2026-09-09). Its baseline tests prove usable
ports, not Q's incremental/query acceptance; the generation and full-scan gaps above are assigned
here rather than passed to supervisor discovery.

### Ordered execution

| Step | Outcome and proof |
| --- | --- |
| Q01 — Bind and measure | Verify plan/base/L ancestry, exact branch/path and scope; inspect the retained consumers and source-writer map. Build owned synthetic fixtures and capture baseline read/update measurements with reproducible parameters before replacing behavior. |
| Q02 — Derivation and atomic maintenance | Complete one reusable derivation and contributing-source inventory; implement affected-run/parent updates with transactional rollback-safe tracking and explicit freshness. Prove every mutation and no-op/unrelated-write controls at the earliest stable boundary. |
| Q03 — Rebuild and recovery | Publish complete generations using the source snapshot/cursor contract; prove concurrency, interruption, replay, restart, corruption and historical populated-source rebuilding without half-publication. |
| Q04 — Indexed query ports | Implement bounded Queue queries and selected-set Activity calculations over summary rows. Prove range/group/filter/duration/identity semantics, privacy, stable paging and query plans independently of A or new routes. |
| Q05 — Focused candidate | Run all scoped gates below, compare baseline/new measurements, fix in-scope failures and freeze exact candidate SHA/tree and evidence. Preserve negative controls and thresholds. No full-gate or independent-review claim. |
| Q06 — Integrate and clean | Recheck master HEAD/index/dirty ownership, integrate Q only, reconcile generated output and run invalidated checks. Record candidate/base/integration trees and input-based reuse. From the primary checkout remove only Q's owned auxiliary worktree and merged branch; verify physical path, registration and ref absent. Preserve evidence outside the removed worktree. Release to V without launching it. |

### Exact scoped gates and evidence

Run from Q's worktree. Unit gate (all files must collect real cases):

```sh
VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/run-summaries/derivation.test.ts tests/unit/run-summaries/mutations.test.ts tests/unit/run-summaries/rebuild.test.ts tests/unit/run-summaries/privacy.test.ts tests/unit/run-summaries/queries.test.ts tests/unit/lifecycle-foundation/source-hooks.test.ts tests/unit/lifecycle-foundation/peer-contracts.test.ts tests/unit/lifecycle-foundation/two-store-recovery.test.ts tests/unit/server/activity-report.test.ts tests/unit/server/activity-export.test.ts tests/unit/server/run-queue-projection.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/no-lifecycle-sql-outside-the-adapter.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/roadmap-doc-binding.test.ts
npm run lint
TZ=UTC ./node_modules/.bin/tsx tests/perf/run-summaries.ts
npm run build:manifest
npm run build:manifest:check
npm run stores:catalog
npm run stores:catalog:check
npm run roadmap
npm run roadmap:check
git diff --check
```

The performance script is a focused diagnostic, not the phase-wide performance gate. It must use
synthetic stable seeds/cardinalities and record baseline versus new query counts, actual measured
rows visited (or explicitly distinguish an unavailable metric from a query-plan estimate), latency
and write overhead. Include growing out-of-range populations and fixed selected pages; assert
bounded materialization and unchanged-row write behavior without inventing a speedup target.
No private identity values in reports. Measure real executable paths, not only mocked call counts.

During iteration use the relevant selectors plus lint whenever tests run. Before implementation
commits/candidate run the complete scoped batch; retain command/exits, effective worker count,
fixture sizes, input hashes and tested tree in Q's evidence. The runner's real config must retain
suite membership, isolation, timeouts and floors. No compiler/coverage contention is needed here.
Generation finishes before its check. Integration reuses only proven input-identical results;
changed code/tests/config/dependencies or combined generated inputs require affected reruns.
Documentation-only recording runs roadmap binding/freshness, scoped links, existing instruction
pair/chain audit and whitespace checks, with explicit unchanged executable-input evidence.

Tactical fixes stay with this supervisor. New shared ownership, required DDL, changed archive
interfaces, weakened privacy or changed user-visible semantics return for amendment. No nested fix
workers, peer launch, push, automatic next task, live migration or UNKNOWN-submit retry. Report
Done / Now / Remaining at start/resume and after each verified step, keeping integration, cleanup
and deferred 2.6.9 acceptance explicit. A scoped Q release is not full Phase 2.6 acceptance.

### Q planning validation — 2026-09-09

Prepared on `5d47c27ac114f91c8a0574cfe5649ed96f876c3a` in the isolated documentation branch
`codex/summary-plan`. The final four-file planning diff changes Markdown only; source, tests,
configuration, dependencies, migration statements and runtime generated inputs are unchanged.
No product implementation or Q acceptance is claimed.

| Check | Result |
| --- | --- |
| Roadmap binding | PASS: one architecture file, 24 tests, one worker; command is the Q architecture selector narrowed to `roadmap-doc-binding.test.ts` |
| Repository lint | `npm run lint`: exit 0 |
| Roadmap generation/freshness | `npm run roadmap` then `npm run roadmap:check`: exit 0; generated output unchanged |
| Added local links/anchors | PASS: ten newly added local links/anchors resolve |
| Instructions | `python3 /Users/julianhein/.agents/skills/docs/scripts/audit.py . --check`: exit 0; existing pairs equal and project chains below 32,768 bytes |
| Whitespace / input scope | `git diff --check`: exit 0; no executable inputs changed |

Full gates and independent review were not run or represented as passed; they remain 2.6.9 duties.
The planner verifies the committed section and prerequisite ancestry before returning the exact
resolved supervisor prompt. Only planning documents are merged and cleaned up in this session.

## C0 execution allocation — 2.6.8.1 U

Prerequisite: **one frozen V release, identical to H base**. One Astra/high supervisor, zero implementation workers.
Use the exact `U` branch and absolute worktree in [PROMPTS.md](PROMPTS.md#binding-registry).
This allocation supersedes older shared-file/side-task ownership in this owner; product proof is retained.
Current inspected baseline is R `60b356dd119140dc972a077751ad16af934acb2e`, schema39/floor37.
Future prerequisites build the explicitly named new modules before peers launch; names do not assert readiness.

Ordered outcomes: Verify served summary APIs and fixed client wiring; update Queue/Activity consumers on their existing surfaces; prove filters/grouping/pagination and accessible desktop rendering; release to 2.6.9.

### Exclusive changing paths

- `src/dashboard/surfaces/queue.tsx`
- `src/dashboard/surfaces/queue-model.ts`
- `src/dashboard/surfaces/queue-toolbar.tsx`
- `src/dashboard/surfaces/activity.tsx`
- `src/dashboard/surfaces/activity-model.ts`

### Proof and test ownership

Preserve existing Queue/Activity selected scope, group containment, durations, warnings, unavailable states, keyboard/zoom/resizing and authorized actions. V supplies all commands/client/wires/shared components; U requires no H renderer or fixture. No redesign of unrelated surfaces.

- `tests/unit/summary-surfaces/queue.test.ts` (new required test)
- `tests/unit/summary-surfaces/activity.test.ts` (new required test)
- `tests/unit/dashboard/activity-render.test.ts`

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

Release committed candidate/base/tree and focused evidence to the next named consumer. No master
integration, independent review, heavy-gate waiver, sibling dispatch or live database application.
Future-base binding remains WAITING ON the actual prerequisite release, not a fabricated SHA.

Authored release evidence: `07-activity-ui-evidence.md` in this folder (new, exclusively owned by U).
The shared `decisions.md`, prerequisite and registry files remain read-only during peer work;
only the consuming prerequisite/finalizer updates shared status.

## C0 execution allocation — 2.6.8.2 H

Prerequisite: **one frozen V release, identical to U base**. One Astra/high supervisor, zero implementation workers.
Use the exact `H` branch and absolute worktree in [PROMPTS.md](PROMPTS.md#binding-registry).
This allocation supersedes older shared-file/side-task ownership in this owner; product proof is retained.
Current inspected baseline is R `60b356dd119140dc972a077751ad16af934acb2e`, schema39/floor37.
Future prerequisites build the explicitly named new modules before peers launch; names do not assert readiness.

Ordered outcomes: Verify descriptor-independent served report and download APIs; implement generic archive rendering and indexed filters; prove deletion/unavailable behavior and protected attachment access; release to 2.6.9.

### Exclusive changing paths

- `src/dashboard/surfaces/archive.tsx`
- `src/dashboard/surfaces/archive-model.ts`
- `src/dashboard/surfaces/archive-report.tsx` (new target)
- `src/dashboard/surfaces/archive-report-model.ts` (new target)

### Proof and test ownership

Preserve approved generic report values/tables/logs/attachments, indexed filters and explicit missing/deleted facts. Prove rendering after removal of original workflow and live records, read-only captured resolution, rejected stale relaunch and protected downloads. V owns shared routes/client/navigation and old relaunch controls outside these surfaces.

- `tests/unit/archive-report-ui/render.test.ts` (new required test)
- `tests/unit/archive-report-ui/no-live-schema.test.ts` (new required test)
- `tests/unit/archive-report-ui/download.test.ts` (new required test)
- `tests/unit/dashboard/archive-render.test.ts`
- `tests/unit/dashboard/archive-detail-render.test.ts`

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

Release committed candidate/base/tree and focused evidence to the next named consumer. No master
integration, independent review, heavy-gate waiver, sibling dispatch or live database application.
Future-base binding remains WAITING ON the actual prerequisite release, not a fabricated SHA.

Authored release evidence: `08-archive-ui-evidence.md` in this folder (new, exclusively owned by H).
The shared `decisions.md`, prerequisite and registry files remain read-only during peer work;
only the consuming prerequisite/finalizer updates shared status.
