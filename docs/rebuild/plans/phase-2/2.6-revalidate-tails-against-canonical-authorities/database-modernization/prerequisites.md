# Prerequisite release plans

Use the [workflow](README.md) for scope, identities, integration ownership and gate timing.
All prerequisites have one Astra/high supervisor, zero implementation workers by default, their
own branch/worktree at execution, and no master integration. This file describes outputs and
acceptance; the exact path manifest and verified bases must be recorded before implementation.

## R · Approved naming-only changes

Execute [2.6.2 R](renames.md) first. Release its renamed, focused-tested candidate to C0;
no full gates or independent review until phase finalization at 2.6.8.3.

## C0 · Contract and execution admission

**Planning only; now 2.6.3.** Consume R’s committed development release and accepted timeline T1, including actual commit/tree, review/gates and
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

## T · Remaining timeline T2

Follow [timeline.md](timeline.md). Deliver a working history query and stable confirmed-operation
facts before terminal-outbox retirement and later archive transfer. Preserve the existing archive
transaction-section compatibility boundary until A converts it. T removes only ledger/outbox
mechanisms assigned by T2; C owns terminal-completion outbox retirement. Prove source completeness,
transaction counts, deletion, historical recovery and existing export behavior with focused tests.
Release T's actual candidate SHA/tree and migration/source interface to C.

## C · Run completion

Follow [run-completion.md](run-completion.md), all P1–P6. Consume T's committed development
release. Deliver direct completion/run_failures, no terminal authorization/outbox dependency,
correct fences/retries/UNKNOWN behavior, preserved history and failure/receipt consumers. Its
source facts become stable inputs to F. Do not implement run_summaries or archive transfer here.

## F · Domain foundation; unlock P, D, G and S

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

Consume the exact **2.6.6.5 Finalization** development release, which includes P/D/G/S on F
and all C/T ancestry. Do not individually assemble unfinalized peers or bypass their group's last
child. Shared schema, capture adapters and provider aggregate preservation must be present in that
verified release; L does not change the finalized domain ownership without an explicit amendment.

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

Consume **2.6.7.3 Finalization**, preserving the combined A/Q focused proof. Integrate real served queries and report interfaces,
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
assembles only its explicit input candidates. Final master integration belongs to 2.6.8.3.
