# T · Remaining timeline T2

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

## Assignment and boundary

The operator explicitly included remaining timeline T2 on 2026-09-09. This is its current
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

**T scoped development release complete — 2026-09-09.** The exact candidate, proof and C transfer are recorded in the final release section below. Final acceptance remains 2.6.9. The operator approved the
[T01–T06 execution brief](#approved-execution-brief--2026-09-09) below. It supplements C0's allocation
and supersedes the earlier saved launch instructions. Launch readiness requires the committed
approved brief and its documentation gates, plus verified C0/R/T1 ancestry. No implementation
completion or runtime-gate result is claimed by planning.

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

## Approved execution brief — 2026-09-09

The operator approved this proposal in `/phase-plan 2.6.4`. Preserve all Required outcomes,
P1–P9 and C0 production/test allocations above. The additions here bind execution order,
source-preservation helpers, focused proof and the exact checkout. They do not redesign the
ratified [transaction-history contract](../../../../reference/write-safety.md#c0-transaction-history-and-shared-ownership--2026-09-09).

### Assignment, prerequisites and checkout

One GPT-6 Astra/high supervisor implements T; zero implementation workers. This is one sequential
assignment because conversion, write settlement, archive compatibility and their composition share
authority files. No separate reviewer runs here: the Phase 2.6-only D191 trial assigns complete
fresh read-only sup_review on Astra/high, full gates and remaining repairs to final 2.6.9.

| Binding | Approved value and verification |
| --- | --- |
| Planning checkout | `/Users/julianhein/Projects/hr-automation-rebuild`, `master`; documentation persistence only. Inspected clean at `8cf605a426553b6eeb169fffb0ec3ccc5b2f94d0`. |
| Implementation base | `c7b8b1e037bf27dd70d4df62bbfcac407e475631`, the C0 recorded release. Verify C0 admission `0010c51c4189f14a8aa61dac55984c2df791045e`, R `60b356dd119140dc972a077751ad16af934acb2e` and T1 `46930920696ab214b036d5f2681b8ffb4e5620ea` are ancestors. Consume their recorded proof; do not claim to have rerun it. |
| Integration availability | C0 final record `dc26c74fde0bb5ec9436e1409884451cd5dd698d` is incorporated in master at `8cf605a426553b6eeb169fffb0ec3ccc5b2f94d0`. C0's removed branch/worktree is not a prerequisite. |
| Implementation branch/path | Create `codex/history-views` at `/Users/julianhein/Projects/hr-worktree-database-contracts` from the exact C0 base, then cherry-pick the approved planning commit containing this brief. Both ref and path were absent at inspection; names are proposals until the supervisor rechecks. Verify the applied brief is identical before edits. |
| Capacity/ownership | Recheck all worktrees and the four-auxiliary limit. At approval persistence, one unrelated worktree occupies a slot. Preserve it. If the assigned lane exists, require clean explicit ownership release before reuse; never reset a colliding branch or borrow an active checkout. |
| Development release | Commit T's working candidate and proof in this owner for 2.6.5 C. Record base/head/tree, supplied schema/source interfaces, exact commands/exits and unverified heavy proof. Stop owned processes and release clean exclusive checkout ownership; retain candidate history. |
| Integration/cleanup | No master merge, push or automatic successor launch. Final 2.6.9 owns remaining repairs, full gates, independent review and final cleanup; master integration requires operator assignment after PASS and required gates. |

### Ordered work and acceptance

| Step | Outcome, necessary proof and forbidden effects |
| --- | --- |
| T01 — Verify inputs | Verify base/plan/ownership and schema39/floor37; inspect before selecting a new migration. Inventory retained events, operations, attempts, ledger assignments/files and outboxes against immutable evidence. Conflicting required facts or unexplained orphan history block retirement. No reconstruction from current settings. |
| T02 — Convert history safely | Preserve original actor, instance/configuration, timestamps, proof, subject binding and operation/attempt/checkpoint identities. Build explicit stopped, backed-up conversion with populated multi-file/multi-day fixtures, source-change refusal, rollback, interrupted settlement, exact resume and no-write repeat. Preserve released migration fingerprints; equal timestamps alone never deduplicate. |
| T03 — Replace transaction readers | Supply one database history query to existing Activity CSV/XLSX and explicit CLI transaction export. Count once per confirmed operation/generation; exclude dry runs, observed-present results, replay, archive duplication and deleted owners. Preserve existing generic Activity totals and protected shapes. Export pins source content, accepts explicit range/system/output and refuses overwrite. |
| T04 — Freeze archive transactions | Capture validated transaction presentation in the existing archive row. Give historical enrichment its own integrity binding while preserving original JSON/digest, issued references and command replay. Prove explicit unknown/absent values, protected projections and unchanged presentation after workflow/source removal. Keep canonical archive membership admission before resources. |
| T05 — Retire ledger machinery | Only after completeness proof, remove current ledger_partitions, ledger_projections, operation_outbox, file writer and read-through consumers. Preserve atomic checkpoint/confirmation settlement, original-owner and retry-shared evidence, final-owner deletion, honest tallies and UNKNOWN refusal. Retained historical readers cannot become fallback current authority. |
| T06 — Release to C | Commit the focused-tested development candidate and exact handoff described above. Mark only T's scoped development release complete; leave phase acceptance, full gates, independent review, master integration and final cleanup visibly pending 2.6.9. |

### Consequential feasibility and failure combinations

| Inspected mechanism | Required change and proof at the earliest stable boundary |
| --- | --- |
| `authority-database.ts:commitWriteAttempt` constructs confirmed history from the ledger outbox payload and commits both outboxes. | T owns the replacement typed facts and atomic composite. Inject failures across checkpoint/operation/attempt/event settlement and verify full rollback; restart after possible external success must not authorize another click. Include a valid successful commit control. P1/P6/P9. |
| `archive-service.ts` freezes `(system,date,sequence)` pointers; `queries/archive.ts` resolves files during reads. | T owns source-complete frozen transactions and same-row historical enrichment. Authenticate enrichment separately; original archive and command identity stay valid. Verify exact replay, divergent enrichment refusal, protected input, and rendering after source/workflow removal. P7/P8. |
| `authority-database.ts:runDeletionEvidence` retains the entire reusable operation group while another run can consume it and validates every owner. | Preserve that policy through the new history query. Cover original-owner deletion with surviving retry, intermediate retry deletion, final-owner deletion, and corrupt/missing ownership refusal before mutation. Deleted owners must not reappear in Activity/export. P4/P6. |
| T1's delivery assessment records a lost restore warning after real startup recovery advanced run state. | Use real sequenced commit, backup/restore, then worker recovery; immutable missing confirmation still reports possible external write despite mutable lifecycle progress. Include an already-accounted control. P3/P9. |
| Upgrade composition already uses verified timeline source manifests/copies. | Extend the existing conversion boundary to ledger facts, without changing released source grammars. Missing ledger file plus retained outbox preserves evidence; disagreement refuses. Precommit changed bytes refuse without conversion; postcommit interruption resumes only the exact bound source. P3/P6/P8. |

These cases supplement rather than replace P1–P9. They close the known consumer and recovery
risks before retirement. Actual-target preflight is inapplicable here: conversion/recovery tests
use isolated synthetic populated roots only. No operator database application, credentials, browser
session or live submit is assigned. A later actual-target application requires its own authorization
and current supported preflight; historical target observations are not current verification.

### Additional exclusive ownership

Keep all C0 paths above. T also owns these source-preservation helpers and directly affected
regression fixtures/guards, limited to T01–T06 and the proof rows above:

- `src/infra/events/timeline-import.ts`
- `src/infra/sqlite/timeline-conversion.ts`
- `tests/unit/events/timeline-history.test.ts`
- `tests/unit/write-sequencer.test.ts`
- `tests/unit/archive-model.test.ts`
- `tests/unit/ledger-activity-fold.test.ts`
- `tests/unit/ledger-projector.test.ts`
- `tests/unit/fixtures/ledger-projection-fixtures.ts`
- `tests/unit/fixtures/write-sequencer-fixtures.ts`
- `tests/unit/architecture/atomic-write-outbox.test.ts`
- `tests/unit/architecture/ledger-projector.test.ts`
- `tests/unit/architecture/archive-invariants.test.ts`
- `tests/unit/architecture/migration-history-immutability.test.ts`
- `docs/rebuild/guard-inventory.json`

New history/export fixtures stay local to their assigned tests. Guard retirement must replace the
old guarantee with meaningful absence/refusal and atomic-history assertions, including violating
fixtures and deciding inventory evidence. Generated outputs are regenerated only from owned
changed inputs. Evidence stays in this owner; planning may update the existing PROMPTS routing
to prevent the superseded launch text from bypassing this approved brief.

### Gate schedule and release record

At implementation iterations run the affected explicit selectors; before each development candidate
commit run the complete focused unit and architecture sets below, lint and affected freshness.
Keep logs under `/tmp/history-views-*` and record exits and tested commit/tree. Verify effective
worker configuration, including project inheritance; the environment variable alone is not proof.
Preserve membership, assertions, isolation, coverage floors and timeouts. No compiler/coverage lane
is introduced here. Serialize only evidenced shared-resource conflicts; do not stop other tasks.

```sh
VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/write-sequencer-restart-no-repeat.test.ts tests/unit/write-sequencer.test.ts tests/unit/archive-ledger-read-through.test.ts tests/unit/archive-protected-identity.test.ts tests/unit/archive-model.test.ts tests/unit/ledger-activity-fold.test.ts tests/unit/ledger-projector.test.ts tests/unit/events/timeline-history.test.ts tests/unit/server/activity-report.test.ts tests/unit/server/activity-export.test.ts tests/unit/storage-upgrade.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/transaction-history.test.ts tests/unit/transaction-export.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/atomic-write-outbox.test.ts tests/unit/architecture/ledger-projector.test.ts tests/unit/architecture/archive-invariants.test.ts tests/unit/architecture/migration-history-immutability.test.ts
npm run lint
git diff --check
```

The two new required unit paths must exist and collect meaningful cases before release. If retiring
the projector requires renaming its tests, record exact replacement selectors and prove the old
guarantees plus negative controls remain covered; never silently skip a missing selector. Recheck
neighboring failure combinations after a repair. Use `/ui` for affected desktop consumers and
focused rendering/accessibility proof; broad parity/build remain with final 2.6.9. Preserve existing
Activity/archive shapes unless the approved frozen transaction contract requires their change.

For affected inputs, run `npm run build:manifest` then `npm run build:manifest:check`,
`npm run stores:catalog` then `npm run stores:catalog:check`, and `npm run roadmap` then
`npm run roadmap:check`. Planning/evidence-only commits use D191 document binding, lint (fresh
or verified unchanged-input reuse), links/anchors, existing instruction-pair equality/chain checks,
affected generation/freshness and whitespace checks. Reuse only unchanged tested inputs with exact
evidence identity; changed inputs, failures or unresolved uncertainty require their affected checks.

Full coverage, broad architecture, complete parity/build and recovery/scenario/concurrency/redaction
acceptance remain due at 2.6.9 with fresh independent complete review. No unrun gate is PASS. Release
must identify which P1–P9 rows have focused new evidence, which unchanged T1 evidence is reused and
which full acceptance remains pending. This is development readiness for C, not final acceptance.

### Exclusions and stop conditions

Do not repeat T1, activate the unwired ledger projector, implement archive.sqlite or run_summaries,
retire terminal-completion/artifact outboxes, change generic Activity scope, redesign the dashboard,
rewrite released migrations, reconstruct historical identity from current settings, upgrade the
operator database, perform a live submit, push, dispatch successors or merge into master.

Routine implementation choices and in-scope fixes belong to this supervisor. Stop dependent work
for changed prerequisites, an occupied/unreleased checkout, conflicting required source facts,
unexplained orphan history, or a necessary material contract/ownership change outside this brief.
Resolve the exact conflict rather than transferring it to C or claiming retirement succeeded.
Send Done / Now / Remaining at start/resume and after every verified step, keeping all unfinished
acceptance, final review, integration and cleanup visible.

## Historical T execution checkpoint — 2026-09-09

**T01 verified; T02–T05 implemented in the working tree with scoped proof in progress. No committed development candidate or release to C.** The implementation
checkout is `/Users/julianhein/Projects/hr-worktree-database-contracts` on `codex/history-views`,
created from the approved C0 base `c7b8b1e037bf27dd70d4df62bbfcac407e475631`.
C0 admission `0010c51c4189f14a8aa61dac55984c2df791045e`, R
`60b356dd119140dc972a077751ad16af934acb2e` and T1
`46930920696ab214b036d5f2681b8ffb4e5620ea` were verified as ancestors.
The approved planning commit `52558d04eafca64fe0771b3d8dc995d769f93550` was applied as
`36a20db324c0890ecf277d02b0791fd307996534` (tree
`540b5e9e707f0daafb90d4569cf9289dbbbfc9aa`). Its two documentation conflicts were resolved
from the verified C0 release and approved readiness text; both resulting planning files were
byte-identical to the approved commit before implementation edits. The input was schema39/floor37.
The working implementation appends schema40, requiring stopped conversion through floor39.

### Approved allocation amendment

T02/P6/P8 require exact historical outbox and file provenance to survive retirement, and T05
replaces the current atomic outbox input. The following directly coupled files are absent from
T's exclusive allocation. The operator approved this amendment in the task on 2026-09-09. Additional ownership is limited to these existing paths:

| Proposed additional path | Required bounded work |
| --- | --- |
| `src/events/timeline.ts` | Admit strict versioned historical operation source evidence, including exact outbox/file identities. Keep existing event bytes, event identity, payload facts and old source grammar readable; no rewriting of released events. |
| `src/events/confirmed-operation.ts` | Bind the confirmation constructor/resolver to the admitted evidence representation, preserving exact attempt/checkpoint authentication and native confirmation identity. |
| `tests/unit/helpers/timeline-write-fixture.ts` | Adapt the shared atomic-write fixture helper to the replacement typed commit facts while preserving explicitly historical outbox fixtures and their negative controls. |

The current `TimelineAppendSchema` accepts only native or span-import sources. Its strict
operation-confirmed payload contains facts, attempt/checkpoint references, proof digest and
span time, but no original outbox identity, ledger assignment or file-source identity. A bounded
synthetic probe on the tree above accepted the native confirmation control and refused both a
ledger-import source and an added ledger outbox identity. The shared fixture helper parses the
current atomic input and directly reads `commit.ledgerOutbox.payload.entry`; the probe also
confirmed that a replacement transaction/span-facts input is refused. This is an allocation
question, not permission to retain a current outbox alias, invent another history authority,
weaken the schema, change shared paths unilaterally or drop the required provenance proof.

The approved brief's stop condition for a necessary material ownership change applies. The
proposal above was approved by the operator’s “approve” response; dependent work may resume. No subordinate agents or reviewer were
started. The unrelated separation-accounting worktree was preserved. The task lane is retained
for resumption and has not been released to C.

### Verified baseline and remaining proof

- Node `v26.1.0`; dependency access is an ignored `node_modules` symlink to the primary
  repository's existing installation. No dependency installation or shared dependency mutation.
- Vitest's resolved unit and architecture projects both report `maxWorkers: 1`, `pool: forks`,
  `isolate: true` under `VITEST_MAX_WORKERS=1` and the explicit `maxWorkers: 1` option.
- `VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/events/timeline-history.test.ts`:
  exit 0, 23 tests, log `/tmp/history-views-baseline-timeline.log`, tested commit/tree above.
  This is baseline T1 regression evidence only, not T02–T05 implementation proof.
- T1's recorded restore-warning repair is present: immutable confirmation digests are compared
  independently of mutable run progress. Its historical accepted proof is consumed, not rerun
  as a new T recovery claim.

T01's checkout, prerequisites and source inventory are complete. The working implementation adds
version-2 source manifests while retaining version-1 span grammar, exact historical operation-source
records, atomic native confirmation settlement, one database history query, explicit exclusive-output
JSON export and separately authenticated same-row archive transactions. Native ledger/outbox writers
and tables are retired in schema40. Both required new test files exist and collect meaningful cases.

T02–T04 scoped proofs now include populated multi-day conversion, missing files, disagreement and
orphan refusal, precommit changed-source rollback, postcommit settlement resume, exact no-write
repeat, deterministic pinned export and collision refusal, historical archive byte preservation,
separate enrichment replay/integrity, protected presentation and empty-registry archive rendering.
T05 shared-owner deletion, no-repeat/UNKNOWN and real restore-loss after worker recovery remain in
the focused set; current counter consumers and transitive fixture/lint repairs require the pending
allocation below. T06 is held until required scoped gates pass. No failed gate is waived. Full gates, independent review, remaining
repairs, operator-assigned master integration and final cleanup remain 2.6.9. No operator database
upgrade, live submit, master merge, push or successor dispatch occurred.

Historical pre-implementation checkpoint validation: full `npm run lint` exited 0
(`/tmp/history-views-baseline-lint.log`); its source/test/configuration inputs at that checkpoint were unchanged
from `36a20db324c0890ecf277d02b0791fd307996534`. The documentation-only delta is this
execution checkpoint. The scoped `roadmap-doc-binding.test.ts` architecture selector passed
24 tests with exit 0 (`/tmp/history-views-checkpoint-binding.log`). Roadmap generation and
freshness exited 0 with no generated change (`/tmp/history-views-checkpoint-roadmap.log`,
`/tmp/history-views-checkpoint-freshness.log`). All five owner links/anchors resolved, nine
existing instruction pairs matched, the maximum project instruction chain was 17,333 bytes,
and `git diff --check` passed. No full product gate or independent review is claimed.

### Approved transitive repair allocation — 2026-09-09

The required full lint command exposed shared tests/fixtures importing the retired projector or
repository aliases. The approved exclusive allocation does not include them. Current storage and
dry-run counter consumers also require four additional source edits. These are required for T's
retirement and lint gate, not a request to run the final full acceptance suite. The proposed amendment
is limited to adapting the following paths to confirmed database history while preserving test
assertions, historical fixture bytes and safety guarantees. No lint suppression or guard weakening
is authorized by this amendment. The operator approved all 31 paths with “approve” on 2026-09-09. Repair work may proceed.

- `tests/fixtures/archive-seams.ts`
- `tests/helpers/kuali-finalization-fixtures.ts`
- `tests/helpers/separations-composition-fixtures.ts`
- `tests/helpers/ucpath-termination-fixtures.ts`
- `tests/parity/helpers/seeded-bff.ts`
- `tests/perf/dashboard-fixture.ts`
- `tests/scenario/dashboard/separations/world.ts`
- `tests/scenario/operator-lifecycle.walk.test.ts`
- `tests/unit/architecture/one-projection-counts.test.ts`
- `tests/unit/architecture/permanent-key-dedupe.test.ts`
- `tests/unit/architecture/redaction-surface-scan.test.ts`
- `tests/unit/architecture/worker-teardown-soak.test.ts`
- `tests/unit/operation-names.test.ts`
- `tests/unit/server/bff-flow.test.ts`
- `tests/unit/server/helpers/dashboard-harness.ts`
- `tests/unit/server/intake-surface.test.ts`
- `tests/unit/server/run-queue-projection.test.ts`
- `tests/unit/sqlite-authority-database.test.ts`
- `tests/unit/write-recovery.test.ts`
- `src/domain/dashboard/storage.ts`
- `src/dashboard/surfaces/settings.tsx`
- `src/domain/trust/dry-run-scenario.ts`
- `src/core/dry-run-scenario-runner.ts`

Associated counter/rendering regressions are included in the proposed amendment so the four
consumer edits can be verified without another allocation change. Historical manifest and backup
fixtures must retain their old grammar where they deliberately represent released bytes.

- `tests/parity/helpers/fixture-day.ts`
- `tests/unit/dashboard/settings-storage-doctor.test.ts`
- `tests/unit/dry-run-scenario-composition.test.ts`
- `tests/unit/dry-run-scenario-live-read.test.ts`
- `tests/unit/dry-run-scenario-runner.test.ts`
- `tests/unit/dry-run-write-safety-counts.test.ts`
- `tests/unit/architecture/storage-recovery.test.ts`
- `tests/unit/architecture/strict-boundary-schemas.test.ts`

The final full lint run exited 1 with 95 errors in the 19 unchanged shared files listed above
(`/tmp/history-views-lint-2.log`); none is in a T-modified file. The four current-counter source
consumers and eight associated fixture/test files are also unchanged. No lint suppression,
worker/reviewer dispatch, master integration, push or successor launch occurred.

### Superseded scoped verification checkpoint — release held at that time

The complete 16-file unit command in the approved brief passed 337 tests, exit 0
(`/tmp/history-views-focused-6.log`). The four assigned architecture files plus document binding
passed 52 tests, exit 0 (`/tmp/history-views-architecture-5.log`); the final owner-only binding check
passed 24 tests (`/tmp/history-views-binding-final.log`). Lint over every changed/new source and
test file passed, exit 0 (`/tmp/history-views-owned-lint-3.log`). These checks are development
evidence; required full lint remains failed as recorded above.

| Proof | Focused evidence and acceptance boundary |
| --- | --- |
| P1 | Native atomic commit and sequenced worker settlement have successful controls and rollback injection at every remaining storage step. Exact replay preserves confirmation; divergent evidence refuses. Unchanged lifecycle composites retain accepted T1 evidence. |
| P2 | Timeline identity, cursor/restart and retention cases plus two independent real database transaction readers pass. Unchanged T1 lifecycle/SSE evidence is consumed at its recorded commit; broad BFF/concurrency acceptance remains 2.6.9. |
| P3 | Populated schema39 two-day conversion with/without ledger files; raw outbox provenance; torn/divergent/orphan refusal; changed-source precommit rollback; interrupted postcommit settlement, source-copy resume and no-write repeat. Historical backup schemas 1–18 and 27–39 are admitted; current backup/restore and real recovery-accounting controls pass. |
| P4 | Confirmations survive ordinary retention. Original/intermediate/final retry deletion preserves shared checkpoints and operations, removes owned history and reports honest source-row tallies. Converted source metadata remains until final ownership ends; Activity/query excludes the deleted owner. Corrupt operation/attempt ownership refuses mutation. |
| P5 | Activity reports, existing exports, archive detail and current storage restore composition pass their focused cases. Generic Activity scope and protected shapes remain unchanged. Browser/rendering fixture repair is pending the allocation; full parity/build/recovery/scenario acceptance remains 2.6.9. |
| P6 | One row per confirmed operation/generation; identical timestamps retain distinct identities. System/instance/local-date folds, dry-run/no-repeat/UNKNOWN controls, reconstructed old facts, exact assignments and missing-file evidence pass. |
| P7 | New and historical same-row transaction sections preserve original archive bytes/digest/replay. Separate enrichment rejects divergent or corrupt content. Protected presentation, explicit unknown values, empty workflow registry and source-file removal controls pass. |
| P8 | Explicit JSON range/system/output export pins content, refuses existing files and symlinks, and uses private output permissions. Current retired tables and writer/read-through repositories are absent. Historical invariant/retirement guards have violating controls. Current legacy-named counter consumers await allocation; full lint is not waived. |
| P9 | Released migration1–39 fingerprints, settings/credential independence, tombstones, checkpoint replay, non-terminal archive/delete admission and UNKNOWN no-repeat behavior pass focused checks. Unrelated notes/artifact/run-terminal behavior remains with its existing owners; broad acceptance remains 2.6.9. |

Affected generation and freshness passed: `npm run build:manifest`, `npm run build:manifest:check`,
`npm run stores:catalog`, `npm run stores:catalog:check`, `npm run roadmap`, `npm run roadmap:check`.
Generation produced no final tracked change to the generated outputs. Logs use
`/tmp/history-views-{manifest,stores,roadmap}-{generate,check}.log` (latest manifest generation
uses `manifest-generate-2.log`). `npm run cli -- storage transactions --help` passed, exit 0
(`/tmp/history-views-cli-help.log`), without opening operator authority. Nine instruction twins
remain byte-identical; whitespace checks pass.

The implementation remained uncommitted on `codex/history-views` at checkpoint HEAD
`36de85ed7e5388f4ee1de450fc4a958461626866` (HEAD tree
`5bac8fd11f83d71a7a4edbd51e4d5deabd0aa95d`). No development candidate had been released at that checkpoint.
The exact uncommitted tree and resume state were recorded in the temporary handoff
`docs/handoffs/2026-09-09-history-views-transitive-repairs.md`. The worktree remains reserved for
this task until the approved repairs and T are completed. Master remains
`52558d04eafca64fe0771b3d8dc995d769f93550`; the unrelated separation-accounting worktree
remains at `c20afe60a6450ac0d569fc317e81715cd645659d`.

Resume verified the exact uncommitted snapshot tree `c5a95a72532be993d933c79520a92f14a7bbb990`
with an isolated temporary index; the real index remained untouched. The operator approved the
31-path transitive amendment. Its temporary handoff was consumed and removed; the repair and
release obligations above remain active in this owner.


## Final T development release to 2.6.5 C — 2026-09-09

**T01–T06 are complete within the Phase 2.6 development scope.** This release supplies a working
candidate to C, not phase acceptance. One supervisor performed the work, with zero implementation
workers and no intermediate reviewer. The operator approved both bounded allocation amendments;
the 31-path transitive repair amendment is implemented. The temporary dashboard-harness duplicate
was consolidated into the allocated shared harness and removed. The consumed recovery handoff was
verified against its exact tree and removed.

| Identity | Exact value |
| --- | --- |
| C0 implementation base | `c7b8b1e037bf27dd70d4df62bbfcac407e475631` |
| Approved planning commit | `52558d04eafca64fe0771b3d8dc995d769f93550` |
| Applied planning commit | `36a20db324c0890ecf277d02b0791fd307996534` |
| Development candidate head | `ede8ccd4a2398288ac91a6186ee77e4d3050746f` |
| Development candidate tree | `792dcfaeea54f664ceaf3f93a017114070ba565a` |
| Branch | `codex/history-views` |
| Released checkout | `/Users/julianhein/Projects/hr-worktree-database-contracts` |
| Next consumer | `2.6.5 C`, `codex/run-completion`, using this same physical lane only after its own availability check |

The approved brief and PROMPTS bytes at the applied planning commit were compared again with the
approved planning commit: no difference. C0/R/T1 prerequisite ancestry remains valid. The candidate
contains 80 explicitly staged implementation/test/guard paths. This recording commit changes only
this owner; candidate runtime, tests, configuration and dependency inputs remain unchanged.

### Delivered interfaces and preservation

- Schema40/floor39 requires stopped, explicitly backed-up conversion for the prior layout.
  Migrations1–39 retain their pinned statement bytes. Current tables and repositories no longer
  include `ledger_partitions`, `ledger_projections`, `operation_outbox`, `durableOutbox` or
  `ledgerProjection`; current file writer/read-through modules are deleted.
- `timeline_operation_sources` retains strict version1 historical source rows: exact old ledger/span
  outboxes, assignment/partition, source manifest/backup binding and file identity when present.
  Version2 source manifests admit ledger bytes; released version1 span-only manifests remain strict.
  Both backup inspection and historical read-only admission validate retired rows and invariants.
- `createTransactionHistory` takes narrow read repositories and supplies the one pinned query,
  Activity fold and archive capture. Immutable attempts/checkpoints authenticate each confirmation.
  No current file, setting or workflow registry reconstructs historical transaction identity.
- Current atomic settlement takes `transaction` and `committedSpan` facts, atomically commits the
  checkpoint and confirmation, and creates no operation outbox IDs. Dry-run runtime counts now use
  `confirmedOperations`; released zero-outbox scenario manifests explicitly map to zero confirmations.
  Current storage pending-count wire/Settings/CLI omit the retired counter. Shared test footprint
  field `outboxes` is retained only as a fixture interface and now contains real confirmations.
- `archived_runs.transactions_json` and `transactions_digest` freeze the separately authenticated
  section in the same row. Original archive JSON, content digest, issued references and command
  replay remain unchanged. A must transfer this section into its later generic saved report; T adds
  no archive.sqlite model. L/A must extend saved-history queries without double counting or
  resurrecting explicitly deleted owners.
- `storage transactions --from YYYY-MM-DD --to YYYY-MM-DD [--system SYSTEM] --output PATH`
  emits deterministic public presentation from one pinned snapshot, uses exclusive private output,
  and refuses existing paths and symlinks. Existing Activity CSV/XLSX shapes remain unchanged.

### Final focused proof

The 27-file unit run and 11-file architecture run tested working tree
`71d3b50d766c05f2647c45d57123237e0edf2772`. Guard-manifest verification subsequently found a
**type-import cycle** between the database and query. The query now declares a narrow read interface
from leaf domain/event types. TypeScript transpilation proved before/after emitted JavaScript
byte-identical (`/tmp/history-type-only-equivalence.log`). The final query, archive and Activity
selectors, guard manifest and full lint were rerun on tree
`ab3dea93a906b093af426ab732f996405b11b5ee`. That tree differs from the committed development
candidate only in this owner document. The earlier tree differs in the type-only query seam and
owner/guard evidence text. Unchanged executable evidence is reused explicitly, not claimed as a
second complete run.

| Command/evidence | Result | Log |
| --- | --- | --- |
| Unit command below: original required16 plus11 transitive files | PASS, 27 files / 754 tests, exit0 | `/tmp/history-final-unit.log` |
| Architecture command below: required guards plus transitive guards | PASS, 11 files / 193 tests, exit0 | `/tmp/history-final-architecture.log` |
| `VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/guard-manifest.test.ts` | PASS, 6 tests, exit0; every active ratchet and its violating control executed | `/tmp/history-final-guard-manifest-2.log` |
| `VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/transaction-history.test.ts tests/unit/transaction-export.test.ts tests/unit/archive-model.test.ts tests/unit/server/activity-report.test.ts` | PASS, 68 tests, exit0 after the type-only repair | `/tmp/history-final-query-interface.log` |
| Scenario command below | PASS, 7 files / 68 tests, exit0 | `/tmp/history-transitive-scenario.log` |
| `npm run lint` | PASS, exit0, no suppression | `/tmp/history-final-lint-2.log` |
| `VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/roadmap-doc-binding.test.ts` | PASS, 24 tests, exit0 for this release record | `/tmp/history-release-doc-binding.log` |
| `npm run build:manifest` and `npm run build:manifest:check` | PASS, exit0, no generated delta | `/tmp/history-final-manifest-generate-2.log`, `/tmp/history-final-manifest-check-2.log` |
| `npm run stores:catalog` and `npm run stores:catalog:check` | PASS, exit0, no generated delta | `/tmp/history-final-stores-generate.log`, `/tmp/history-final-stores-check-2.log` |
| `npm run roadmap` and `npm run roadmap:check` | PASS, exit0, no generated delta; repeated for this owner record | `/tmp/history-final-roadmap-generate.log`, `/tmp/history-final-roadmap-check.log` |
| `npm run cli -- storage transactions --help` | PASS, exit0 through secure bootstrap, no operator database opened | `/tmp/history-final-cli-help.log` |

Exact suite invocations (all from the released checkout):

```sh
VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/write-sequencer-restart-no-repeat.test.ts tests/unit/write-sequencer.test.ts tests/unit/archive-ledger-read-through.test.ts tests/unit/archive-protected-identity.test.ts tests/unit/archive-model.test.ts tests/unit/ledger-activity-fold.test.ts tests/unit/ledger-projector.test.ts tests/unit/events/timeline-history.test.ts tests/unit/server/activity-report.test.ts tests/unit/server/activity-export.test.ts tests/unit/storage-upgrade.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/transaction-history.test.ts tests/unit/transaction-export.test.ts tests/unit/operation-names.test.ts tests/unit/sqlite-authority-database.test.ts tests/unit/write-recovery.test.ts tests/unit/dry-run-write-safety-counts.test.ts tests/unit/dry-run-scenario-runner.test.ts tests/unit/dry-run-scenario-composition.test.ts tests/unit/dry-run-scenario-live-read.test.ts tests/unit/dashboard/settings-storage-doctor.test.ts tests/unit/server/run-queue-projection.test.ts tests/unit/server/intake-surface.test.ts tests/unit/server/bff-flow.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/atomic-write-outbox.test.ts tests/unit/architecture/ledger-projector.test.ts tests/unit/architecture/archive-invariants.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/roadmap-doc-binding.test.ts tests/unit/architecture/one-projection-counts.test.ts tests/unit/architecture/permanent-key-dedupe.test.ts tests/unit/architecture/redaction-surface-scan.test.ts tests/unit/architecture/worker-teardown-soak.test.ts tests/unit/architecture/storage-recovery.test.ts tests/unit/architecture/strict-boundary-schemas.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --project scenario --maxWorkers=1 tests/scenario/dashboard/separations tests/scenario/operator-lifecycle.walk.test.ts tests/scenario/workflows/separations/structural.scenario.test.ts tests/scenario/workflows/separations-ucpath-termination/structural.scenario.test.ts tests/scenario/workflows/separations-kuali-finalization/structural.scenario.test.ts
```

| P row | Final development evidence and remaining acceptance |
| --- | --- |
| P1 | Real atomic and sequenced settlement success/rollback controls, exact/divergent replay, recovery continuation and UNKNOWN refusal pass. Unchanged lifecycle composites consume accepted T1 evidence. |
| P2 | Timeline cursor/restart/retention, independent database readers, BFF flow, queue/run projection and scenario composition pass. Full cross-task event scope remains final 2.6.9. |
| P3 | Populated multi-day schema39 and completed historical rename fixtures, missing files, exact source copies, torn/divergent/orphan refusal, precommit rollback, postcommit resume and no-write repeat pass. Real restore loss remains visible after worker recovery. |
| P4 | Original/intermediate/final retry deletion preserves reusable evidence, removes owner history, reports honest source tallies and refuses corrupt ownership. Deleted transactions do not reappear. |
| P5 | Shared SQLite-backed dashboard, archive, recovery, scenario and performance fixtures are adapted and pass lint; BFF/scenario regressions and focused rendering below pass. Complete performance/build/parity acceptance remains final 2.6.9. |
| P6 | One count per operation/generation, timestamp collisions, prod/test/system/local-date folds, protected identities, dry-run/observed-present/replay exclusion and missing-file preservation pass. |
| P7 | New/historical frozen transactions retain original archive bytes/digests, exact enrichment replay and canonical membership. Divergent/corrupt sections refuse; protected/unknown presentation and empty registry/source removal pass. |
| P8 | Explicit pinned JSON and existing Activity exports pass; exclusive output and symlink controls pass. Current writer/read-through/table/repository retirement has violating guards. Runtime pending/dry-run consumers are adapted. |
| P9 | Released migration fingerprints, historical strict admission, settings/credentials, tombstones, operation identity/proof, checkpoint replay, archive/delete admission, terminal outbox and UNKNOWN behavior pass the focused set. Full combined compatibility remains final 2.6.9. |

### Rendering evidence and explicit finalizer repair

The `/ui` lead remained local Components. The only visible T change removes the retired doctor
counter from the existing count grid. The specimen and loaded Storage health surface were opened
with the owned `history-views-ui` playwright-cli session against an isolated fixture server and the
built working-tree dashboard. Role/text checks found all six remaining counters and no retired
counter. Inspected captures at 1440×900 Graphite Warm and 1024×768 Paper Ink show readable labels,
values and degraded-state content. Captures: `/tmp/history-storage-doctor-1440.png`,
`/tmp/history-storage-doctor-1024.png`; assertion transcript `/tmp/history-storage-rendering.log`,
accessibility snapshots `/tmp/history-storage-doctor.a11y.log` and
`/tmp/history-storage-doctor-1024.a11y.log`. The owned browser and server were stopped.

`npm run test:parity -- tests/parity/panel-heading-accessibility.spec.ts tests/parity/archive-accessibility.spec.ts --workers=1`
ran seven browser tests successfully, but its wrapper exited1 because this filter emits no required
body-backed reference attachment. A second existing-reference run used:

```sh
npm run test:parity -- tests/parity/dashboard-reference.spec.ts tests/parity/panel-heading-accessibility.spec.ts tests/parity/archive-accessibility.spec.ts --grep '1440x900.*(activity-report|archive-run|settings$)|PanelHeader|archive warning count' --workers=1
```

It exited1: eight reference cases stopped at descriptor metadata and three interaction cases passed.
Stored reference hash `3e459f4b09a28d4992efe712a98310053030f263ac11d9c0610234142f2c8df9`
differs from actual `6bf54d3207b1e5558b3e6a41fd5a6c2bb838622f8f287790587edb6e615fe05e`.
A read-only import of `FIXTURE_DESCRIPTOR_HASH` from the clean approved primary checkout at
`52558d04eafca64fe0771b3d8dc995d769f93550` returned the same actual hash. This is evidenced
baseline drift, not a passing parity gate; pixel comparison was not reached. No reference was
refreshed, suppressed or weakened. Final2.6.9 owns deliberate reference reconciliation (including
the now-removed doctor counter) and the complete parity/build gate. Logs:
`/tmp/history-parity-focused.log`, `/tmp/history-parity-focused-2.log`.

### Release conditions and remaining work

This record releases T's exclusive checkout ownership once committed with a clean index/worktree.
Retain `codex/history-views` and its candidate history. C may consume the recorded candidate and
release record only in an operator-started task after verifying its own approved brief and the
clean physical lane. No successor was created or dispatched; shared readiness indices were not
rewritten. Master remains `52558d04eafca64fe0771b3d8dc995d769f93550`; the unrelated
separation-accounting worktree remains at `c20afe60a6450ac0d569fc317e81715cd645659d`.
Nine instruction pairs remain byte-identical, maximum project chain 17,333 bytes, all five owner
links resolve, and whitespace checks pass. No instruction, dependency or operator state changed.

Full typecheck, complete coverage/architecture/scenario/performance/recovery/parity/build gates,
remaining combined repairs, fresh independent read-only review, operator-assigned master
integration and final cleanup are **still required in 2.6.9**. T performed no master merge, push,
operator database upgrade, live submit or independent review. No heavy gate is waived by this
scoped release.

Proof log SHA-256 values (transcripts are local supporting evidence; commands/results above are
the durable record):

```text
b31cfb7eb7cfb146055ccfa769227d06254fd8387f23a3c3ee0588c65b60e229  /tmp/history-final-unit.log
a504e400156859838932b6413211fc05eb89163ce12ded668dcb701ff8052eec  /tmp/history-final-architecture.log
271960db19dc37edc7c1a201efed4ef9acc9502d2cb0b14ee78bf7572fa5c7ce  /tmp/history-final-guard-manifest-2.log
942c4fac1b0cb78c236c0057f7a809ebdb0837b5b5f7b685fd785d343e935d5b  /tmp/history-final-query-interface.log
9f2f830346c57a1969995764f267188f39b480ea5a0d5db0c4648410b4d5ed0d  /tmp/history-transitive-scenario.log
7ddb1ed4692d7f46ded772bee29d287ee65a7f38e09708bb0ca19a4c7f9c695f  /tmp/history-final-lint-2.log
a21e077416a415b41d44b9465f108a28f67d141317913a0e76a3493a45d08bdb  /tmp/history-parity-focused-2.log
8ae61d2c2e133bed4eeff1fa9eeef8945798bbaa7b6f3725fab080e6ff65d8d0  /tmp/history-storage-rendering.log
```
