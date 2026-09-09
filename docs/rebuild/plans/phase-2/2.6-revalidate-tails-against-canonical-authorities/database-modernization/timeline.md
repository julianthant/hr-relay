# T · Remaining timeline T2

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
remains due in 2.6.7.3 with fresh independent review. No operator DB upgrade or live submit is included.

**WAITING ON:** accepted T1 and C0 execution admission; T1 integration is recorded, but no future task base or schema number is guessed.
