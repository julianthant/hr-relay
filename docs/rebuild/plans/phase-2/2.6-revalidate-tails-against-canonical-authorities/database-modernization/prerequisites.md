# Prerequisite release plans

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

Use the [workflow](README.md) for scope, identities, integration ownership and gate timing.
All prerequisites have one Astra/high supervisor, zero implementation workers by default, their
own branch/worktree at execution, and no master integration except the approved C/F scoped
merge-and-cleanup exceptions. This file describes outputs and
acceptance; the exact path manifest and verified bases must be recorded before implementation.

## R · Approved naming-only changes

Execute [2.6.2 R](renames.md) first. Release its renamed, focused-tested candidate to C0;
no full gates or independent review until phase finalization at 2.6.9.

## C0 · Contract and execution admission

**2.6.3 C0; execution admission under the preapproved brief below.** Consume R’s committed development release and accepted timeline T1, including actual commit/tree, review/gates and
schema/floor; the timeline owner records accepted integration `46930920696ab214b036d5f2681b8ffb4e5620ea`;
verify its evidence and ancestry at admission. Preserve T1's
immutable migrations, source conversion evidence and original in-flight gate schedule.

1. Verify R preserved `database_state` and `database_upgrades` behavior and the other five approved
   renames; do not repeat them. Allocate approved SQL spans removal to F and single-row XLSX
   consolidation to F/G, preserving timelines, export identities and recovery.
   Inspect the operation-name deferred
   relationship finding in Git and determine how run-operation attempts shared by retries survive
   archive transfer/deletion without dangling references or invented ownership. Ask only for a real
   product tradeoff; routine storage implementation choices belong to the supervisor.
2. Complete the settings decision cases already identified in decisions.md: retries/new attempts,
   child inheritance, stale start-plan confirmation, and process-wide values that cannot safely
   vary by run. Apply the approved rule—new runs use the newly saved configuration, existing runs
   retain theirs—without guessing a conflicting lifecycle policy.
3. Ratify the approved table/lifecycle/privacy changes in their owning contracts with same-commit
   decision pointers. Authority: dashboard-surfaces, clock-config-secrets, write-safety,
   execution-and-sessions, operator-trust, data-intake-and-edit-data and storage/recovery contracts
   as actually affected. This is not authorization to rewrite unrelated Phase 0.3 requirements.
4. Compare actual import closures for T/C/F/P/D/G/S/L/A/Q/V/U/H. Record exact paths, test ownership,
   fixture needs, migration owners and proof selectors in each assignment's own file. Preserve all
   inherited proof rows. Split shared command/query/composition files into prerequisite-owned real
   modules before peers; do not assign a prose boundary across the same file to concurrent writers.
5. Verify isolation refs/capacity and emit resolved launch prompts using the registry below. Include
   actual approved plan SHA, prerequisite SHA, assigned worktree/branch and integration condition.
   A plan commit alone is not proof of accepted T1 or a future implementation release.

C0 closes with docs binding/link/freshness/whitespace checks and complete execution briefs. It does
not implement a schema or claim code gates prove new behavior. If a consequential choice is still
open, name it and keep affected tasks WAITING ON; do not hand the conflict to a peer to discover.

### C0 execution brief — preapproved 2026-09-09

The operator scheduled `/phase-plan 2.6.3`, preapproved the plan, and explicitly requested
execution immediately after planning instead of a returned supervisor prompt. This assignment
is C0 documentation and admission, not T2 or the entire downstream batch. The phase-specific
focused-development/final-review cadence above remains in force. One Astra/high supervisor,
zero implementation workers; no intermediate independent review or master integration.

| Binding | Verified value / required action |
| --- | --- |
| Inspected master | `27e073c0c69e1ff54fb699c805175589e8f016b3`, clean at admission |
| R development release | `60b356dd119140dc972a077751ad16af934acb2e`, clean `codex/database-renames`; implementation `37ed00d19a8b410c3fb542bea8328c0eef962b4c`, tree `4ed36a7091bb577373d7e3a86eaed04eeab9ab1e` |
| Accepted T1 | `46930920696ab214b036d5f2681b8ffb4e5620ea`, verified ancestor of R; consume original proof, do not rerun T1 |
| C0 checkout | After this brief is committed, create `codex/database-contracts` at `/Users/julianhein/Projects/hr-worktree-database-contracts` from R and cherry-pick the exact planning commit. Ref/path absent at planning inspection; recheck before creation. |
| Scope | This prerequisite owner, existing files in this database-modernization folder, parent Phase 2.6 task cards, roadmap source/generated site, and affected owning reference contracts plus decision pointers. No runtime/schema/test/configuration edits. |
| Release | Committed documentation development candidate containing R ancestry and complete C0 admission; T consumes it in its own registry checkout. Other tasks remain waiting on their actual prerequisite releases. No automatic T launch, master merge, push, or deletion of retained candidate worktrees. |

Ordered work and acceptance:

1. **C01 — verify admission.** Recheck R/T1 ancestry, clean checkout, exact plan content,
   migration39/floor37, retained R proof and unchanged released migration history. Reconcile the
   stale pre-rename numeric labels with the current identity map. Record source evidence, not
   a new claim that C0 ran R's 342 focused tests.
2. **C02 — settle contract cases.** Ratify the approved product directions at their existing
   reference owners with same-commit decision pointers. Apply the general new-run/current-settings
   rule to every newly created run, including explicit retries and children; existing runs keep
   their snapshot. A stale reviewed start request requires renewed review before creation.
   Preserve deployment-only sources and separate protected credentials; no new restart exemption
   for editable ordinary settings. Preserve retry-shared evidence using verified retained owner
   references and archive transfer receipts; do not introduce cascading deletion or equate operation
   generation with workflow attempt. These are C0 selections under this task's preapproval, not
   retrospective claims of earlier operator decisions.
3. **C03 — bind execution ownership.** Trace production import/call boundaries and assign exact
   existing/new module and test paths for T/C/F/P/D/G/S/L/A/Q/V/U/H in their existing owners.
   Common migrations, commands, wires, composition, fixtures and generated inputs belong to the
   relevant prerequisite. Require functional baseline modules and complete composed proof before
   peer release. Preserve every inherited proof and explicitly test each peer merge order.
4. **C04 — validate and release.** Resolve only T's executable next-step binding against the
   actual C0 candidate. Future dependency SHAs remain conditional; never fabricate them. Validate
   documentation, commit exact paths, verify committed content and record all deferred full gates,
   independent review, master integration and cleanup under 2.6.9. Complete C0 alone.

| Consequential evidence | Required admission result / proof |
| --- | --- |
| R release appends migration39, keeps floor37 and preserves old fingerprint grammars. | Bind R's actual candidate and inspect code-input equality between implementation and evidence commit. C0 adds no schema migration or operator DB conversion. |
| `run-record-service.ts:retrySource` copies the source envelope and rejects active-config mismatch; `start-plan-service.ts` captures configuration at composition. | S owns new-run snapshot selection and stale-preview refusal through F-owned extracted entry modules, with concurrent save/create, replay, mixed-snapshot execution and UNKNOWN negative controls. No source-snapshot exception is invented. |
| `runDeletionEvidence` already retains entire shared operation groups and validates owners, unlike the older operation-name finding. | Consume existing T1 semantics; L/A extend live ownership to verified archive transfers without retaining an unvalidated fallback or erasing a live retry's key/evidence. T owns the earlier retained-history query. |
| Current P/D/G candidates still expose shared command/composition/authority edits. | F must finish those shared targets and route real application callers through frozen peer APIs. S cannot share D's command files. L and V repeat the same extraction/proof rule for their peer groups. |
| New archive and summary mechanisms do not exist on R. | Assign their construction to L and their bounded consumers to A/Q; future peers remain WAITING ON the proven baseline, not READY merely because names appear in a plan. |

Gate schedule: C0 is documentation-only under D191. After planning and after substantive admission
changes run `VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1
tests/unit/architecture/roadmap-doc-binding.test.ts`, `npm run lint`, `npm run roadmap`,
`npm run roadmap:check`, changed-link/anchor checks, existing instruction-pair equality/chain checks,
and `git diff --check`. Generation precedes freshness. Use one effective test worker and logs under
`/tmp/database-contracts-*`; no coverage/compiler contention. Record command exits and tested inputs.
For evidence-only edits repeat affected document checks; reuse unchanged lint with its exact input
identity. No typecheck/coverage/parity/live/benchmark PASS is claimed by this contract-only task.

Stop dependent work for a changed prerequisite, conflicting actual ownership, a violated admitted
product boundary, or a missing consequential decision that cannot be resolved within the user's
preapproval. Ask the explicitly authorized `Explain database tables` task for contextual evidence;
its recommendations are not operator decisions. Routine design choices and scoped documentation
repairs remain with C0. No browser, production migration, live submit or unrelated Phase 0.3 rewrite.

## T · Remaining timeline T2

Follow [timeline.md](timeline.md). Deliver a working history query and stable confirmed-operation
facts before terminal-outbox retirement and later archive transfer. Preserve the existing archive
transaction-section compatibility boundary until A converts it. T removes only ledger/outbox
mechanisms assigned by T2; C owns terminal-completion outbox retirement. Prove source completeness,
transaction counts, deletion, historical recovery and existing export behavior with focused tests.
Release T's actual candidate SHA/tree and migration/source interface to C.

## C · Run completion

**Current binding:** T is integrated at `5e446a90f018456d11ad38442c0fe3ba13e31dd1`.
The operator approved [C01–C05](run-completion.md#approved-execution-brief--2026-09-09), including
local master merge and owned cleanup after focused PASS. That C-specific instruction supersedes
this file's generic retention/no-master-merge wording. Full gates and independent review stay in 2.6.9.

Follow [run-completion.md](run-completion.md), all P1–P6. Consume T's committed development
release. Deliver direct completion/run_failures, no terminal authorization/outbox dependency,
correct fences/retries/UNKNOWN behavior, preserved history and failure/receipt consumers. Its
source facts become stable inputs to F. Do not implement run_summaries or archive transfer here.

## F · Domain foundation; unlock P, D, G and S

**Approved execution owner:** [F01–F07](foundation.md#approved-execution-brief--2026-09-09), approved
2026-09-09. C master integration `e43a8d8515486c73c276fa319bbe06d196b309e3` is verified; focused
release and closure evidence are [at C's owner](run-completion.md#c-schema-39-upgrade-repair--2026-09-09).
F is executing F01–F07; release evidence is at the [F owner](foundation.md#f-execution-record--2026-09-09). Its committed plan binds a descendant base, one supervisor, focused checks,
local master merge and owned cleanup. This overrides generic no-master/retention rules for F;
full gates and complete independent review stay in 2.6.9. C reopened during persistence for a
schema39 → 41 conversion repair; the F brief requires its verified focused release and integration
before launch. The original C release alone is insufficient. The following scope is retained.

Consume C. Retain all [foundation proof allocation](foundation.md#b-proof-allocation) and
[artifact import/extraction](artifacts.md#t1--imported-and-extracted-artifacts) requirements.
Complete shared provider/diagnostic/artifact migrations, real baseline repositories and wiring,
import/extraction behavior, renames/retirements and recovery before releasing domain peers.
Consume R’s settings_snapshots rename; add the approved app_settings consolidation and functional baseline settings modules,
then isolate S's save/activation/claim behavior from D's command/read UI files. Settings baseline
must preserve current working behavior; S supplies the approved no-restart change.

F owns shared `src/infra/sqlite/migrations.ts`, authority registration/recovery, common command
and server/worker composition, catalog generation and shared fixture changes required by these
peers. Recheck exact paths after T1; foundation.md lists inspected candidate module boundaries.
F must route the real application through P/D/G/S's baseline modules, not provide unused exports.

Release evidence: populated fresh/historical DB conversion; backup/restore; cross-domain deletion
and retained artifacts; no lost failure/receipt data; functional baseline provider/settings/export
flows; exact isolated peer paths/tests and contract versions. Remove unused gates/ocr_approvals/SQL
notes and the unused SQL spans projection; preserve timeline_events and supported historical span-file readers.
Consume R’s dryrun_results and diagnostic names with consumer/absence tests, preserving approvals/logs/live-read.
F also migrates operator_xlsx_exports evidence into generated_artifacts and retires the old table,
with a working export baseline before G adds publication behavior; no live dual-write path.
All peers use the same F SHA. P↔D↔G↔S must require no sibling API, migration, fixture or generated
source. S cannot launch until its extraction makes that four-way proof true.

## L · Lifecycle foundation; unlock A and Q

Consume the exact P/D/G/S committed development candidates on F, with all C/T/R ancestry.
Assemble them in L's own branch/worktree, reconcile shared output and fix immediate integration
issues here. Run focused combination checks for provider/diagnostic/artifact/settings interactions,
migration identity, settings continuity, evidence references and source interfaces before building
A/Q prerequisites. There is no intermediate finalization task, review or full gate run. Preserve
exact candidate identities and do not hand repairs back to completed peers. C0 binds concrete
selectors/resources; each input must have passed its focused checks.

Before A/Q launch, complete their common migrations, actual run/archive/summary interfaces,
transaction hooks for state changes and annotations, version-application progress model, deletion
ownership, notifications link routing, and backup/restore interface for two databases plus files.
Prepare real working baseline modules; authority writes cannot silently omit summary maintenance
once Q publishes its model. Until that cutover, the existing working read path remains explicit.
Archive transfer must invoke a defined live-row cleanup contract that includes derived summaries,
not require changes to Q's module. Q must rebuild correctly from live runs before or after transfer,
without requiring A's unmerged report viewer or conversion code.

L alone changes common run-record-service, global commands/wires, storage upgrade/deletion/backup,
composition and shared fixtures needed by both peers. C0 records actual paths; L verifies them and
extracts complete baseline behavior. A owns report conversion/transfer/version application; Q owns
summary derivation/query/rebuild. No archive viewer work is assigned before served APIs exist.
Release only after either peer can implement and pass its complete focused acceptance on L alone,
with both merge orders preserving counts, saved reports, deletes, settings binding and UNKNOWN rules.

## V · Served interface release; unlock U and H

Consume the exact A/Q committed candidates on L and assemble them in V’s owned worktree.
Fix immediate integration defects here and use focused checks to prove archive capture/cleanup,
summary updates/rebuild, version application and deletion agree. No intermediate finalizer, full
gates or review. Integrate real served queries and report interfaces,
root route/command registration, shared dashboard wire types, download authorization and UI shell
wiring. Finish shared archive relaunch removal without removing current-run retry/start. Separate
Queue/Activity U paths from generic Archive H paths, including fixtures, snapshot/reference files,
shared navigation and component imports. Use /ui for these contracts and affected frontend work.

Prove actual composed API responses, protected projections, archived/deleted distinctions, download
access, stable filters and pagination, stale/missing-data errors and existing screens on V alone.
U and H then change only owned consumer/rendering files and tests. They cannot depend on a promised
endpoint, shared unmerged component or another peer's screenshot reference. Record both merge orders.

## Release record required from every implementation prerequisite

- Assignment, plan SHA, actual prerequisite and candidate SHA/tree, branch and absolute worktree.
- Exact supplied contracts and real production entry points; owned paths and descendant peer paths.
- Focused command/exits and proof rows, lint, affected generation/freshness, diff check; heavy rows
  explicitly pending final validation, no claim of independent implementation review yet.
- Pairwise independence matrix, both permitted merge orders, isolated test resources and capacity.
- Exact resolved child prompts and no unexplained consumer/ownership/contract gaps.

Return that compact record in the owner file and chat. Do not create observer tasks, automatically
launch children, reserve idle worktrees or mark final product acceptance done. The next operator-started prerequisite
assembles only its explicit input candidates. Final master integration belongs to 2.6.9.

## C0 prerequisite allocation — 2.6.7 L

Consume **exact P/D/G/S candidates on one F base, with T/C/R ancestry**. One Astra/high supervisor; zero implementation workers.
Use `L`'s exact branch/absolute worktree from [the registry](PROMPTS.md#binding-registry).
No future input SHA is guessed. Resolve committed candidate identities before creating the checkout.

First assemble exact P/D/G/S candidates in this checkout. Fix immediate combination defects here
with focused tests; record changed paths and source candidate identities. No handback to finished
peers and no intermediate full review. L may reconcile only the consumed candidates and named
lifecycle scope, not reopen unrelated product decisions.

L owns shared live schema/registry/recovery and the isolation-owned archive path (archive.sqlite
beside the live database under stateRoot), archive database registration, strict generic report and
version-change types, indexed summary schema and source hooks, canonical live/archive/deleted
lookup, run-ID/attempt-number allocation, notification routing and download authorization. Its
ownership resolver validates immutable operation/attempt provenance against live rows, verified
archive transfer/report receipts or explicit tombstones; ambiguous/missing owners refuse. Preserve
whole shared evidence groups until the last retained consumer is released. No direct historical
attempt-to-live-run cascade, new run-attempt table or fake tombstone for transfer.

Define real ports before A/Q: source capture with explicit field availability and immutable bindings;
version-change identity/membership/fence/progress; write/verify/read generic archive reports; verified
file custody; live-row cleanup including summary removal; deletion receipts with resumable file/store
settlement; transactional summary source changes and consistent rebuild snapshots. A uses cleanup,
Q uses source/rebuild hooks; neither imports the other's implementation. A baseline generic report
read/write round trip and a baseline summary refresh must work on L alone. Route production through
the ports. Preserve the explicit existing read path until Q publishes a verified summary generation;
publication and every later relevant authoritative mutation must maintain summaries atomically.
A transfer cannot publish a report or remove sources without the corresponding verified progress.

Retirement of Activity pseudonym tables removes their current producer/query dependencies, including
runtime-dependency admission, without erasing saved protected credentials or changing historical
protected-store/backup grammars. Preserve unrelated secret consumers and immutable snapshot identity;
legacy protected settings remain strictly readable, never served as a new counting authority.
L must bind publication/freshness state in its schema and transaction contract without creating
a second summary authority. An empty valid generation must be distinguishable from an absent
or interrupted rebuild; Q must prove this at the served read boundary.

Summary source inventory: run identity/workflow/descriptor display identity; local day plus original
UTC timestamps; canonical lifecycle/status; start/end/known duration; queue priority, containment,
parent/dependency/member relationships and rollup; receipt warning state/count and completion class;
failure classification; validated person identity or unavailable reason; source generation/cursor.
Keep display titles/rename/filter facts required by current Queue; use bounded joins for transient
worker/action facts, never authorize from summary. One row is one live run, not duplicated result/
receipt/checkpoint payload. Resolve validated identity from the schema-owned canonical result path,
not arbitrary ID-shaped fields. Q owns selected-set calculations and snapshot/catch-up publication.

Archive capture inventory includes the existing Queue/run-detail section fields, submitted/frozen
inputs with current protected projections, settings display, steps/results, receipt/failure/resolution,
logs, diagnostic captures and file references, transaction section from T, and historical relaunch/
command lineage. Source-specific readers exist only in capture/conversion; generic viewing imports
none of those parsers. Preserve original source JSON/digests and bind report integrity separately.
The archived identity record and transfer progress protect uniqueness after live cleanup; summary
removal never makes a transferred run appear eligible for a new command.

Ordered work: combine domain candidates; construct shared types/schema and baseline ports; wire all
creation/lifecycle/receipt/annotation/rename/group/event-source updates and deletion hooks; implement
paired backup/restore/lookup/numbering and reference-aware custody; extract A/Q and prove independent
composed baselines, both mutation orders, populated recovery and protected projections; release L.
Existing broad report/summary requirements remain, including no all-time generic Activity expansion.

### Prerequisite-owned shared paths

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
- `src/domain/runtime-dependencies.ts`
- `src/domain/commands.ts`
- `src/core/command-kernel.ts`
- `src/core/run-record-service.ts`
- `src/server/dashboard/compose.ts`
- `src/server/worker/compose.ts`
- `src/server/dashboard/commands/command-service.ts`
- `src/cli.ts`
- `config/runtime-isolation.json`
- `src/config/define-runtime-isolation.ts`
- `src/config/runtime-isolation.ts`
- `src/domain/config/runtime-paths.ts`
- `src/domain/archive/model.ts`
- `src/domain/archive/sections.ts`
- `src/domain/archive/change-record.ts`
- `src/domain/archive/report.ts` (new target)
- `src/domain/run/summary.ts` (new target)
- `src/services/archive/archive-service.ts`
- `src/infra/sqlite/archive-database.ts` (new target)
- `src/infra/sqlite/run-evidence-ownership.ts` (new target)
- `src/core/run-lifecycle-storage.ts` (new target)
- `src/server/dashboard/queries/archive.ts`
- `src/server/dashboard/projectors/run-queue-projection.ts`
- `src/domain/dashboard/activity.ts`
- `src/domain/trust/activity-person-pseudonym.ts`
- `src/domain/trust/activity-person-pseudonym-backfill.ts`
- `src/server/activity-person-pseudonym-backfill/service.ts`
- `src/server/activity-person-pseudonym-backfill/compose.ts`
- `src/server/dashboard/queries/run-detail.ts`
- `src/domain/dashboard/archive.ts`
- `src/domain/dashboard/projection.ts`
- `src/domain/dashboard/run-detail.ts`
- `src/dashboard/client/queries.ts`
- `tests/unit/fixtures/activity-person-pseudonym-fixtures.ts`
- `tests/parity/helpers/fixture-archive.ts`
- `tests/parity/helpers/fixture-archive-evidence.ts`

The prerequisite additionally creates/extracts and verifies the complete production path sets of
A, Q in their C0 allocations, then freezes them before those peers start.
It owns affected `docs/rebuild/guard-inventory.json`, generated outputs via their registered generators,
and shared fixtures actually named above. Existing fixture changes outside this manifest require
a scoped prerequisite amendment before release; peers may add only their own fixtures.

### Required focused selectors

- `tests/unit/protected-settings-history.test.ts`
- `tests/unit/protected-settings-doctor.test.ts`
- `tests/unit/storage-upgrade-d331.test.ts`
- `tests/unit/archive-model.test.ts`
- `tests/unit/archive-protected-identity.test.ts`
- `tests/unit/archive-retention.test.ts`
- `tests/unit/storage-upgrade.test.ts`
- `tests/unit/storage-backup.test.ts`
- `tests/unit/storage-restore-drill.test.ts`
- `tests/unit/storage-upgrade-tombstones.test.ts`
- `tests/unit/server/activity-report.test.ts`
- `tests/unit/lifecycle-foundation/source-hooks.test.ts` (new required test)
- `tests/unit/lifecycle-foundation/two-store-recovery.test.ts` (new required test)
- `tests/unit/lifecycle-foundation/peer-contracts.test.ts` (new required test)

Run the explicit owned unit paths using `VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1`,
`npm run lint`, affected architecture selectors under `--project architecture --maxWorkers=1`,
affected supported generators and freshness checks, and `git diff --check`. Validate populated
migration/recovery inputs before release; independent-connection race tests use separate database
connections even with one file worker. All retained heavy proof remains due at 2.6.9.

Each peer must implement and pass its full assigned focused proof on this baseline alone. Verify
the production call paths and test the common contracts with each peer capability independently,
then both orders of every pair using independent fixture instances. A textual merge alone proves
nothing about counts, file custody, configuration or rollback. At peer consumption the next named
prerequisite rechecks both orders with actual candidates and owns all combination fixes.

Record baseline SHA/tree, exported type/method contracts, migration fingerprints, exact generated
inputs, fixture paths and focused test exits before release. No inherited source proof is silently
waived. A common API that remains unimplemented blocks the entire dependent peer group.

### Direct consumer closure additions

The current symbol/import inspection additionally assigns these transitive consumers to this
sequential owner. Historical-only matches retain versioned compatibility rather than blind renaming.

- `src/core/runtime-composition.ts`
- `src/domain/archive/retention.ts`
- `src/domain/config/catalog.ts`
- `src/domain/config/protected-settings-legacy.ts`
- `src/domain/config/protected-settings.ts`
- `src/domain/dashboard/storage.ts`
- `src/domain/secrets.ts`
- `src/infra/compat/upgrade-sources.ts`
- `src/infra/config/credential-store.ts`
- `src/infra/sqlite/storage-doctor.ts`
- `src/server/dashboard/compose/operator.ts`
- `src/services/start/rerun.ts`

## C0 prerequisite allocation — 2.6.8 V

Consume **exact A/Q candidates on one L base**. One Astra/high supervisor; zero implementation workers.
Use `V`'s exact branch/absolute worktree from [the registry](PROMPTS.md#binding-registry).
No future input SHA is guessed. Resolve committed candidate identities before creating the checkout.

First assemble exact A/Q candidates and fix immediate interaction defects here with focused
checks: transfer capture, cleanup, summary updates/rebuild, version application and deletion must
agree. No full-gate/review finalizer is inserted. Preserve source candidate identities.

V owns all shared server routes, client calls, command/wire unions, navigation/app shell, download
authorization and fixture registration. Remove retired archive relaunch from command registration,
app dispatch and current controls, preserving inert historical envelopes and normal live retry/start.
Serve bounded indexed Queue/Activity and generic report list/detail/attachment APIs; preserve stable
range/system filters, pagination, protected projection, explicit stale/unavailable states and canonical
archive/deleted distinction. Existing Activity exports consume the served calculation and T's separate
transaction query. Do not require a current descriptor to query a saved report.

Extract/wire U/H surface files before release so each existing screen works on V alone. Fix shared
components, styles, transport and fixtures here; peers change only their isolated surfaces and test
fixtures. New dedicated cases use separate reference prefixes. Complete source parser removal from
the ordinary archive response path; supported old conversion readers remain backend-only.

Ordered work: combine A/Q; implement served endpoints and shared command/client removal; connect
working surface baselines; verify actual composed API/Host-Origin/download and stale-command refusal
including after live source deletion; freeze disjoint U/H fixtures/wires; release one V SHA. Use /ui
for served/frontend contract changes and preserve desktop-only resizing, zoom and accessibility.

### Prerequisite-owned shared paths

- `src/server/dashboard/compose.ts`
- `src/server/dashboard/commands/command-service.ts`
- `src/core/command-kernel.ts`
- `src/domain/commands.ts`
- `src/server/dashboard/queries/archive.ts`
- `src/server/dashboard/queries/activity-export.ts`
- `src/server/dashboard/projectors/run-queue-projection.ts`
- `src/server/dashboard/projectors/queue-row-actions.ts`
- `src/domain/dashboard/archive.ts`
- `src/domain/dashboard/activity.ts`
- `src/domain/dashboard/projection.ts`
- `src/domain/dashboard/run-detail.ts`
- `src/server/dashboard/queries/run-detail-types.ts`
- `src/dashboard/client/queries.ts`
- `src/dashboard/client/commands.ts`
- `src/dashboard/client/errors.ts`
- `src/dashboard/app/dashboard-app.tsx`
- `src/dashboard/app/dashboard-app-model.ts`
- `src/dashboard/app/command-dispatch.ts`
- `src/dashboard/app/url-state.ts`
- `src/dashboard/app/nav-history.ts`
- `tests/parity/helpers/fixture-day.ts`
- `tests/parity/helpers/fixture-archive.ts`
- `tests/parity/helpers/fixture-archive-evidence.ts`
- `tests/parity/helpers/fixture-bff.ts`
- `tests/parity/helpers/seeded-bff.ts`

The prerequisite additionally creates/extracts and verifies the complete production path sets of
U, H in their C0 allocations, then freezes them before those peers start.
It owns affected `docs/rebuild/guard-inventory.json`, generated outputs via their registered generators,
and shared fixtures actually named above. Existing fixture changes outside this manifest require
a scoped prerequisite amendment before release; peers may add only their own fixtures.

### Required focused selectors

- `tests/unit/server/activity-report.test.ts`
- `tests/unit/server/activity-export.test.ts`
- `tests/unit/server/archive-capture-routes.test.ts`
- `tests/unit/server/archive-capture-resource.test.ts`
- `tests/unit/dashboard/client-transport.test.ts`
- `tests/unit/served-database-surfaces/summary-api.test.ts` (new required test)
- `tests/unit/served-database-surfaces/archive-api.test.ts` (new required test)
- `tests/unit/served-database-surfaces/retired-relaunch.test.ts` (new required test)

Run the explicit owned unit paths using `VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1`,
`npm run lint`, affected architecture selectors under `--project architecture --maxWorkers=1`,
affected supported generators and freshness checks, and `git diff --check`. Validate populated
migration/recovery inputs before release; independent-connection race tests use separate database
connections even with one file worker. All retained heavy proof remains due at 2.6.9.

Each peer must implement and pass its full assigned focused proof on this baseline alone. Verify
the production call paths and test the common contracts with each peer capability independently,
then both orders of every pair using independent fixture instances. A textual merge alone proves
nothing about counts, file custody, configuration or rollback. At peer consumption the next named
prerequisite rechecks both orders with actual candidates and owns all combination fixes.

Record baseline SHA/tree, exported type/method contracts, migration fingerprints, exact generated
inputs, fixture paths and focused test exits before release. No inherited source proof is silently
waived. A common API that remains unimplemented blocks the entire dependent peer group.

### Direct consumer closure additions

The current symbol/import inspection additionally assigns these transitive consumers to this
sequential owner. Historical-only matches retain versioned compatibility rather than blind renaming.

- `src/server/dashboard/routes/api-types.ts`
- `src/server/dashboard/routes/api.ts`
- `src/server/dashboard/routes/data.ts`
- `src/server/dashboard/routes/operator.ts`
- `src/server/dashboard/routes/trust.ts`

## C0 independence and gate-resource record — 2026-09-09

Inspection used R `60b356dd119140dc972a077751ad16af934acb2e` and its unchanged production inputs.
Current source consumers were traced by the retired repository/table symbols and actual imports:
24 T consumers, 14 C consumers, 18 F consumers, 26 L consumers and seven V consumers. Their
extra paths are recorded in the corresponding allocations. Coherent entry reads included
`retrySource`, start-plan creation, `runDeletionEvidence`, worker composition, Activity wire/export,
archive capture/query and the settings catalog. This is source evidence, not future behavioral proof.

| Boundary | Existing mechanism / required extraction | Deciding proof owner |
| --- | --- | --- |
| T history → Activity/export/archive | run-queue-projection owns report assembly; activity-export serializes it; archive query imports LedgerReadThrough. T reconnects all three to transaction-history and preserves the old archive section. | T P6–P8; T1 P1–P5 only where unchanged |
| C settlement → F storage | Terminal factories, SQLite composites and run executor share authorization/outbox contracts. C replaces those together before F touches storage. | C P1–P6 |
| F → P/D/G/S | command-kernel/global unions/authority/root compositions are shared today. F owns them and creates the exact isolated module paths; peers never divide one shared file by prose sections. | F baseline-contracts and four-way-independence; each peer's assigned proof |
| S settings → worker/provider | Boot-time captures include task/session timeouts, default browser, idle polling and OCR model-chain inputs. F extracts real resource construction and claim ports; S supplies snapshot-aware policy. P consumes fixed invocation inputs. | S mixed-execution/save-create/retry-child/stale-plan |
| L → A/Q | Archive capture currently imports live queue/detail/failure schemas; deletion validates only live/tombstone owners. L isolates source capture and verified ownership, summary mutation/cleanup hooks, generic report schemas and paired recovery before A/Q. | L source-hooks/two-store-recovery; A recovery/deletion; Q mutations/rebuild/privacy |
| V → U/H | Shared app shell, client and route imports join live/archive state. V removes live parser dependencies from served archives and freezes those shared targets before isolated surface rendering. | V summary-api/archive-api/retired-relaunch; U/H focused UI proof |

Pairwise manifest inspection finds no production/test write overlap for P-D, P-G, P-S, D-G, D-S,
G-S, A-Q or U-H. Common data/command/fixture inputs belong to F/L/V. This proves the proposed
allocation is disjoint, not that absent future interfaces work. Each prerequisite must execute its
baseline proof before releasing peers; L tests both orders of actual P/D/G/S pairs, V both A/Q
orders, and 2.6.9 both U/H orders on disposable trees. Preserve aggregate counts, settings selection,
source identities, archive custody, deletion and UNKNOWN results in either order. If a fixture or
registration change breaks independence, repair the prerequisite and revalidate before dispatch.

P/D/G author their own existing owner files. S/A/Q/U/H read shared `decisions.md` and write only
`04-settings-evidence.md`, `05-archive-evidence.md`, `06-summary-evidence.md`,
`07-activity-ui-evidence.md`, `08-archive-ui-evidence.md`, respectively, in this folder.
Shared roadmap, contract/index and registry changes belong to the consuming prerequisite/finalizer.

D owns new `tests/parity/failure-resolution.spec.ts`, its local
`tests/parity/helpers/fixture-failure-resolution.ts`, and `tests/parity/references/failure-resolution-*`.
S owns new `tests/parity/settings-activation.spec.ts`, local
`tests/parity/helpers/fixture-settings-activation.ts`, and `tests/parity/references/settings-activation-*`.
U owns new `tests/parity/summary-surfaces.spec.ts`, local
`tests/parity/helpers/fixture-summary-surfaces.ts`, and `tests/parity/references/summary-surfaces-*`.
H owns new `tests/parity/archive-report.spec.ts`, local
`tests/parity/helpers/fixture-archive-report.ts`, and `tests/parity/references/archive-report-*`.
Existing shared visual fixture/registration changes must land in F or V, not peers. Existing reference
refresh needed for changed code provenance is serialized in the owning prerequisite/final 2.6.9;
no peer refreezes another surface. New references require deliberate /ui verification.

At most four effective test file workers across this batch, normally one per active peer. The
installed runner supports `VITEST_MAX_WORKERS=1`; resolve its effective configuration on each base.
Each task owns temporary SQLite roots, processes and output logs under `/tmp/<assignment>-*`.
No live operator state is a fixture. Compile/lint/freshness can overlap independent tests only within
that capacity. Full coverage remains exclusive of this task's compiler/linter in 2.6.9. Mutable
parity reports/reference generation and shared generated outputs are serialized; owned focused
browser checks use isolated output roots/ports verified by the runner. No inherited idle lock or
elapsed wait proves resource ownership. Use the focused-sessions Parallel coordination protocol.

Every assignment has one supervisor and zero implementation workers by default. Registry refs/paths
are proposals; C0 observed only master, R and its own C0 checkout, leaving future SHAs unresolved.
Do not reserve all future worktrees. Capacity and exact refs must be rechecked by the operator-started
assignment. No automatic child dispatch, review task or master integration is authorized here.

### C01–C03 verified admission evidence

- Plan: master `db56bbc182f339d132cebf24a4666c30a8afbeb1`, available unchanged as
  `75984148bb83693a24141a1b839347cfdc33385d` on C0 after cherry-pick onto R.
  Planning gates: 24 roadmap-binding tests, full lint, roadmap generation/freshness, links,
  nine instruction pairs and whitespace passed; logs `/tmp/database-contracts-plan-*.log`.
- C01: R release `60b356dd119140dc972a077751ad16af934acb2e` is clean and descends from accepted
  T1 `46930920696ab214b036d5f2681b8ffb4e5620ea`. R's evidence commit changes no production,
  test, script or dependency inputs from its tested `37ed00d19a8b410c3fb542bea8328c0eef962b4c`.
  Schema39/floor37 are retained. R's 342 focused-test result is consumed evidence, not rerun here.
- C02: six owning target contracts plus decision pointers now bind settings, archive/summary/privacy,
  history/ownership, completion and artifact continuity. No code, schema, credentials or live data
  changed. Settings cases use this task's preapproval and literal new-run rule; no historical
  recommendation is misrepresented as an operator decision.
- C03: eight peer pairs have zero changing production/test path intersections. The actual
  `computeBuildManifest` source-set inspection includes 202 source paths and intersects none of
  the currently existing P/D/G/S/A/Q/U/H changing paths. New prerequisite extraction must preserve
  that separation or own/revalidate affected generation before peer release. This is a planning
  feasibility check; future composed baseline/merge-order behavior remains required at F/L/V/2.6.9.
  The inspection used the repository's `src/infra/build/workflow-build-manifest.ts` implementation,
  not a guessed import graph. Source/table-consumer closure additions are recorded above.
- All later task SHAs remain conditional except the C0 input to T, resolved at C04 release.
  No T or parallel peer was launched. No supporting agents, live browser or operator DB were used.

### C0 capacity correction

The operating reference's Authorized orchestration section limits auxiliary worktrees to four.
Keeping a fresh retained checkout for every sequential prerequisite would exceed that limit at F;
four simultaneous domain peers would also exceed it with R and the prerequisite checkout retained.
The [registry capacity protocol](PROMPTS.md#four-checkout-capacity-and-ownership-transfer) therefore
uses clean, explicitly released checkout reuse with a new immutable task branch each time, and two
concurrent peer lanes. This is an evidenced resource conflict, not a product dependency or a broader
capacity grant. C0 may release its checkout to T after C04; all candidate branches remain retained.
No active or uncommitted peer checkout may be repurposed. Recheck unrelated occupancy at every start.

### C04 — verified development candidate and release evidence

| Evidence | Result |
| --- | --- |
| Approved original plan | `db56bbc182f339d132cebf24a4666c30a8afbeb1`; identical brief cherry-picked as `75984148bb83693a24141a1b839347cfdc33385d` |
| C0 admission candidate | `0010c51c4189f14a8aa61dac55984c2df791045e` |
| Candidate tree | `c0ac8489f628b3c1e2c3b89f2c082bcf63259786` |
| R prerequisite | `60b356dd119140dc972a077751ad16af934acb2e`, verified ancestor |
| Committed-candidate document binding | `VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/roadmap-doc-binding.test.ts`: exit 0, 24 tests; `/tmp/database-contracts-committed-binding.log` |
| Lint | `npm run lint`: exit 0, zero warnings; `/tmp/database-contracts-candidate-lint.log`. Inputs are unchanged at the candidate and recording commits; all changes from the C0 base are documentation. |
| Generation/freshness | `npm run roadmap` and `npm run roadmap:check`: exit 0; committed candidate freshness rechecked |
| Links/instructions | 270 scoped local links/anchors resolve; all nine existing instruction pairs byte-identical; longest project chain 17,333 UTF-8 bytes |
| Allocation | Eight peer pairs have no production/test path intersection; current peer write paths are absent from the 202-source manifest closure; future extraction/baseline proof remains mandatory |
| Whitespace and tree | `git diff --check`: exit 0; candidate checkout clean before recording |
| Actual target / live work | Not applicable to this documentation-only task; no operator state migration, browser, provider call or HR write |
| Deferred acceptance | All runtime behavior, typecheck/coverage/full architecture/parity/build/recovery, independent complete review, operator-assigned master integration and final cleanup remain owned by 2.6.9; no unrun gate is claimed |

The source/contract allocations and all inherited proof rows are committed. T may consume the C0
recorded release after the final registry binding is saved and verified; its input must contain the
candidate above, R and accepted T1. No future C/F/peer base is inferred. The C0 task releases exclusive
use of `/Users/julianhein/Projects/hr-worktree-database-contracts` after its final committed record:
no owned test process remains, status must be clean, and `codex/database-contracts` must retain the
complete candidate/evidence history before T creates `codex/history-views`. This is a clean checkout
ownership transfer, not deletion of C0's branch or permission to dispatch T. The dependency symlink
uses the primary repository's installed node_modules; no dependency input changed.

#### Delivery assessment

C0 remains one documentation/admission assignment; no implementation workers or product repair
rounds were needed. Discovery found three planning omissions in the earlier future allocation:
stale pre-rename numeric labels, D/S sharing global command files, and accumulating retained
worktrees beyond the four-auxiliary limit. C0 corrected the labels, assigned shared extraction to
F, separated peer evidence writers, and bound one sequential plus two peer lanes while retaining R.
Reading the capacity rule before drafting future unique paths would have avoided the later registry
revision. Original product proof and final-review cadence remain unchanged. Settings lifecycle
choices were selected under current task preapproval after contextual consultation, not asserted as
historical operator decisions. No speed, quality-score or runtime-correctness claim follows from
these document gates. The final registry/roadmap record is documentation-only and reuses unchanged
lint inputs while repeating affected binding/link/freshness checks.

### C0 final release status

**C01–C04 complete as a scoped documentation development release.** Candidate
`0010c51c4189f14a8aa61dac55984c2df791045e` and recorded release
`c7b8b1e037bf27dd70d4df62bbfcac407e475631` bind all source contracts, task paths/proofs,
capacity and evidence. The final recording commit saves the exact [T launch binding](PROMPTS.md#resolved-next-assignment--264-t)
and marks only C0 complete. The T input is the verified recorded release; final recording changes
only readiness, status and prompt text. The branch remains retained and checkout ownership is
released under the registry protocol after clean final verification. No task-specific process remains.
The operator chooses the next task; C0 did not dispatch T. Final 2.6.9 retains product validation,
independent review, assigned integration and cleanup.

### Operator-authorized C0 integration — 2026-09-09

After scoped completion, the operator explicitly requested “merge.” This authorizes local C0
integration and cleanup now, superseding C0's earlier retained-worktree timing. It does not advance
2.6.9 product acceptance or authorize another task. Target before merge:
`a54505b19b7bd51d3ca04bf843a0ba2cedf7fa8c`; candidate:
`dc26c74fde0bb5ec9436e1409884451cd5dd698d`. R was already incorporated in the target.
The automatic merge had no conflicts and initially produced the exact candidate tree
`bcce7cdbe036d875a4039b9ac5cb4def4fc6949f`; the only integration adjustment makes the saved T prompt
recreate its exact checkout when absent and verify C0 history through master instead of requiring
a retained branch. T's plan/base and product scope are unchanged. The merge commit records final
scoped gate results. Remove only C0's integrated clean worktree/ref after passing checks; preserve
R's separate worktree and the calling task. No push. Historical retention statements above describe
the original handoff; this explicit later instruction owns current cleanup and launch routing.
