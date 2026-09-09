# T · Remaining timeline T2

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

## Assignment and boundary

The operator explicitly included remaining timeline T2 on 2026-09-09. This is its current pending
execution owner inside [Phase 2.6](README.md). The original
[timeline plan](history/timeline-t1.md) retains completed T1
proof/evidence and its original review/gate schedule. T1 is integrated at `46930920696ab214b036d5f2681b8ffb4e5620ea`; consume its
recorded reviewed integration and verify ancestry. Do not start a second T1.

T owns lossless transaction history, existing Activity transaction queries/exports, explicit CLI
transaction export, old archive transaction-section compatibility, ledger/outbox retirement and
its write-settlement/recovery consumers. T does not implement the new archive database, summary
table, terminal-completion retirement or a new dashboard design. Those have explicit later owners.

## Required outcomes

1. Query retained operations/attempts/confirmed timeline events by exact identity. Count a confirmed
   automation operation once per generation, preserving system, prod/test instance, local date and
   original UTC facts. Dry-run, observed-present, previews and replayed success add no submissions.
   Do not equate transaction counts with generic run_summaries counts.
2. Inventory old/new operation outboxes, ledger assignments and actual files against verified
   immutable sources. Preserve actor, original instance/configuration, confirmation/fence and
   external timestamps, completion kind, proof source, subject binding and exact operation/attempt/
   checkpoint identities. Coalesce matching representations only when fields agree. Missing files
   do not erase outbox evidence; conflicting required facts or unexplained orphan history block
   retirement. Never reconstruct old identity/configuration from current settings.
3. Provide one database history query for Activity and its existing CSV/XLSX exports, preserving
   their supported shapes and protected projections. Add explicit CLI export with selected range/
   system, caller-selected output, deterministic pinned-source content and no silent overwrite.
4. Preserve current archive behavior until A transfers it: capture a validated transaction section
   with explicit unknown/absent facts and evidence references. Historical same-row enrichment has
   its own integrity binding; preserve original archive JSON/digest and command replay identities.
   A later converts this section once into a generic saved report and verifies the transfer. T must
   not introduce a second permanent archive model or preimplement archive.sqlite.
5. After proving source completeness, retire ledger_partitions, ledger_projections, operation_outbox
   and current file writer/read-through aliases. Keep only admitted historical recovery readers;
   displaced sources cannot affect current responses. Preserve released migration fingerprints,
   explicit stopped/backed-up conversion and recoverable replay. T1 already owns span-file retirement;
   consume its completed boundary, do not redo it.
6. Preserve confirmed-operation history until authorized owner deletion, ordinary event retention,
   honest deletion tallies, retry-shared evidence, tombstones and UNKNOWN refusal. Archive transfer
   later saves required transaction history before live cleanup; L/A must extend the query to saved
   archive facts without double-counting or resurrecting explicitly deleted history. Existing generic
   Activity scope remains as approved; this does not silently create all-time generic run totals.

## Inherited proof map

All original P1–P9 remain required. P1–P5 consume T1 evidence only where inputs are unchanged and
add focused regression proof at T's changed seams. P6–P8 are T's principal implementation proof.
P7's same-row archive behavior applies to T's intermediate working release; A then owns the
approved conversion to independently rendered archive reports. P9's preservation of terminal
outboxes/unrelated notes applies within T; C/F own their separately approved retirement.
Final validation reviews T1/T2 interactions and the later transfer, not just isolated functions.

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


## Focused checks and release

Use the existing named test selectors from the original timeline plan after verifying their paths
on accepted T1. Required focused seams include write-sequencer restart/no-repeat, Activity/report
export, archive-ledger/protected identity, storage upgrade/backup/restore/tombstones and ledger/
archive architecture guards. Add populated historical conversion, rollback and conflicting-evidence
negative controls; replace retired guards with meaningful absence/refusal coverage and update the
inventory with deciding evidence. Tests always accompany lint. Record exact commands and tested tree.

The combined workflow replaces T2's former per-candidate heavy/review cadence: focused proof,
lint and affected freshness now; every full coverage, architecture, parity, build and recovery proof
remains due in 2.6.9 with fresh independent review. No operator DB upgrade or live submit is included.

**READY after C0 release:** use the saved resolved 2.6.4 T prompt in [PROMPTS.md](PROMPTS.md#resolved-next-assignment--264-t). Base `c7b8b1e037bf27dd70d4df62bbfcac407e475631` contains verified R/T1 and C0 admission. T implementation has not started; select a new migration only after inspecting that base.

## C0 execution allocation — 2.6.4 T

Prerequisite: **C0 release containing R and accepted T1**. One Astra/high supervisor, zero implementation workers.
Use the exact `T` branch and absolute worktree in [PROMPTS.md](PROMPTS.md#binding-registry).
This allocation supersedes older shared-file/side-task ownership in this owner; product proof is retained.
Current inspected baseline is R `60b356dd119140dc972a077751ad16af934acb2e`, schema39/floor37.
Future prerequisites build the explicitly named new modules before peers launch; names do not assert readiness.

Ordered outcomes: Inventory and validate retained source facts; implement one history query and safe explicit export; capture the compatible archive transaction section; retire current ledger/outbox machinery only after populated conversion proof; release to C.

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
- `src/core/write-sequencer.ts`
- `src/infra/sqlite/write-commit-contracts.ts`
- `src/infra/sqlite/ledger-projection-contracts.ts`
- `src/infra/ledger/ledger-projector.ts`
- `src/infra/ledger/ledger-read-through.ts`
- `src/infra/ledger/index.ts`
- `src/domain/archive/ledger-resolution.ts`
- `src/domain/archive/model.ts`
- `src/services/archive/archive-service.ts`
- `src/server/dashboard/queries/archive.ts`
- `src/server/dashboard/queries/activity-export.ts`
- `src/server/dashboard/projectors/run-queue-projection.ts`
- `src/domain/dashboard/activity.ts`
- `src/infra/sqlite/transaction-history.ts` (new target)
- `src/server/storage/transaction-export.ts` (new target)

### Proof and test ownership

All P1–P9 above remain assigned. Add populated source disagreement/missing-file controls and export collision/pinned snapshot tests. Reuse unchanged T1 rows only with exact tested identities. New archive-database behavior remains L/A; current archive P7 must work on T alone.

- `tests/unit/write-sequencer-restart-no-repeat.test.ts`
- `tests/unit/archive-ledger-read-through.test.ts`
- `tests/unit/archive-protected-identity.test.ts`
- `tests/unit/server/activity-report.test.ts`
- `tests/unit/server/activity-export.test.ts`
- `tests/unit/storage-upgrade.test.ts`
- `tests/unit/storage-backup.test.ts`
- `tests/unit/storage-restore-drill.test.ts`
- `tests/unit/storage-upgrade-tombstones.test.ts`
- `tests/unit/transaction-history.test.ts` (new required test)
- `tests/unit/transaction-export.test.ts` (new required test)

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

Authored evidence stays in this task's existing `timeline.md` owner; shared indices remain read-only.

### Direct consumer closure additions

The current symbol/import inspection additionally assigns these transitive consumers to this
sequential owner. Historical-only matches retain versioned compatibility rather than blind renaming.

- `src/core/dry-run-scenario-runner.ts`
- `src/dashboard/surfaces/settings.tsx`
- `src/domain/dashboard/storage.ts`
- `src/domain/ids.ts`
- `src/domain/ledger-projection.ts`
- `src/domain/trust/dry-run-scenario.ts`
