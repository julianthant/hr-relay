# Remaining database tables — planning discussion

## Scope and working agreement

On 2026-09-08 the operator asked to continue the existing table-by-table design discussion in the
current task and collect all resulting changes in one folder, like `database-parallel`. No separate
planning task or implementation worktree is needed. This folder is the single owner for the new batch.
The [earlier database batch](../database-parallel/README.md) remains unchanged.

This is a planning worklist, not an approved execution plan. Explain concrete workflows, propose
names/designs, obtain the operator's decisions and record the approved changes here. Do not infer
that every table needs a rename, consolidate tables solely to reduce their count, or implement an
undecided design. Use clear vocabulary consistent with the decisions already made in the earlier batch.

## Remaining discussion

| Group | Current tables / relationship | Decision |
| --- | --- | --- |
| Approvals | `gates`, `ocr_approvals` | Approved: remove unused projection and placeholder; preserve working approvals and future OCR durability requirements. See below. |
| Settings and version changes | `settings_current`, `runtime_config`, `version_plans`, `version_bump_applications` | Settings behavior directed: activate saved configuration for new runs without restart; existing runs retain theirs. Names and version-change design remain open. |
| Relaunch and deletion | `archive_relaunches`, `deleted_runs` | Open |
| Messages and notes | `notifications`, `notes` | Open |
| Testing and activity privacy | `dry_run_scenario_results`, `activity_person_pseudonyms`, `activity_person_pseudonym_generations` | Open |
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

## Group 2: immediate configuration activation for new runs

On 2026-09-08 the operator corrected the proposed restart-based settings behavior: “it should
active the new configuration for new runs. old runs keep thier own config. but new ones will take
the new config without restart.” Record this as the required product behavior for the new batch,
not as behavior already implemented. No table names in this group have been approved.

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
- Resolve retry/new-attempt, relaunch and delegated-child inheritance rules before execution
  admission. Distinguish resuming an existing run from creating a new run; the current retry path
  also compares its source configuration with the active runtime. Inventory process-wide settings
  separately from run-bound settings and specify how updates take effect without operator restarts.
  Credentials retain their separate protected-storage rules; no secret values enter snapshots.

### Proof and allocation required before launch

Focused tests must cover a settings save followed by a new run without restart, unchanged execution
configuration for existing running/queued/paused runs, mixed-snapshot worker execution, concurrent
save/create ordering, invalid saves/rollback, restart recovery, and preserved ownership fencing.
Assert effective execution settings as well as stored fingerprints. Add proof for the resolved
retry/relaunch/start-request rules and affected command/UI contracts.

This crosses settings application, run creation, worker execution and shared authority contracts;
it is a behavior change, not a mechanical table rename. Resolve shared prerequisites and existing
batch ownership before allocating parallel work. Carry the agreed final-session heavy gates and
independent review cadence. No implementation, contract ratification or launch prompt is authorized
by this discussion record alone; execution admission remains pending the complete batch plan.
