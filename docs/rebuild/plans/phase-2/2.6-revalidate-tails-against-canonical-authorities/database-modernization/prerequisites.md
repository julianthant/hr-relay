# Prerequisite release plans

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

Use the [workflow](README.md) for scope, identities, integration ownership and gate timing.
All prerequisites have one Astra/high supervisor, zero implementation workers by default, their
own branch/worktree at execution, and no master integration. This file describes outputs and
acceptance; the exact path manifest and verified bases must be recorded before implementation.

## R · Approved naming-only changes

Execute [2.6.2 R](renames.md) first. Release its renamed, focused-tested candidate to C0;
no full gates or independent review until phase finalization at 2.6.9.

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
