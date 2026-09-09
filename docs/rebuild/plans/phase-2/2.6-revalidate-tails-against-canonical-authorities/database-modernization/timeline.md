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

**Execution plan approved 2026-09-09; implementation unstarted.** The operator approved the
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

## T execution checkpoint — 2026-09-09

**Blocked during T01; no development candidate and no release to C.** The implementation
checkout is `/Users/julianhein/Projects/hr-worktree-database-contracts` on `codex/history-views`,
created from the approved C0 base `c7b8b1e037bf27dd70d4df62bbfcac407e475631`.
C0 admission `0010c51c4189f14a8aa61dac55984c2df791045e`, R
`60b356dd119140dc972a077751ad16af934acb2e` and T1
`46930920696ab214b036d5f2681b8ffb4e5620ea` were verified as ancestors.
The approved planning commit `52558d04eafca64fe0771b3d8dc995d769f93550` was applied as
`36a20db324c0890ecf277d02b0791fd307996534` (tree
`540b5e9e707f0daafb90d4569cf9289dbbbfc9aa`). Its two documentation conflicts were resolved
from the verified C0 release and approved readiness text; both resulting planning files were
byte-identical to the approved commit before this execution checkpoint was added. No product,
test, migration or configuration source has changed. Schema39/floor37 remains unchanged.

### Allocation issue requiring operator disposition

T02/P6/P8 require exact historical outbox and file provenance to survive retirement, and T05
replaces the current atomic outbox input. The following directly coupled files are absent from
T's exclusive allocation. The proposed amendment is limited to these existing paths:

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
proposal above is **not approved by this checkpoint**. No subordinate agents or reviewer were
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

T01's checkout/schema checks are complete; its conversion inventory/admission remains open.
T02 conversion, T03 history queries/export, T04 archive transaction freeze, T05 ledger retirement,
T06 focused-gated commit/release and all new P1–P9 changed-seam evidence remain unperformed.
The two new required test files do not exist yet. Full gates, independent review, remaining
repairs, operator-assigned master integration and final cleanup remain 2.6.9. No operator database
upgrade, live submit, master merge, push or successor dispatch occurred.

Checkpoint documentation validation: full `npm run lint` exited 0
(`/tmp/history-views-baseline-lint.log`); its source/test/configuration inputs are unchanged
from `36a20db324c0890ecf277d02b0791fd307996534`. The documentation-only delta is this
execution checkpoint. The scoped `roadmap-doc-binding.test.ts` architecture selector passed
24 tests with exit 0 (`/tmp/history-views-checkpoint-binding.log`). Roadmap generation and
freshness exited 0 with no generated change (`/tmp/history-views-checkpoint-roadmap.log`,
`/tmp/history-views-checkpoint-freshness.log`). All five owner links/anchors resolved, nine
existing instruction pairs matched, the maximum project instruction chain was 17,333 bytes,
and `git diff --check` passed. No full product gate or independent review is claimed.
