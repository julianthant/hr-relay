# Database changes: shared prerequisites and parallel execution

## Archive-report amendment — 2026-09-08

The operator approved an independent archive database and directed changes to existing owning
plans rather than overlapping assignments. The linked run-completion, provider, diagnostic and
artifact plans now carry their specific archive boundaries. In particular, the previous D assignment
for editable current resolution on archived retained runs is superseded by read-only saved resolution.
The remaining-database archive section owns report storage, conversion, transfer and the viewer;
this batch retains ownership of its existing completion/accounting/diagnostic/artifact mechanisms.
Before new launches, reconcile the common migration, cleanup/retention interfaces, command/query
surfaces and backup proof into one prerequisite owner and revalidate peer disjointness. Do not make
B and a remaining-batch peer independently implement the same archive migration or cleanup hook.
The old dependency graph and frozen-file release proof below describe the pre-amendment assignment;
they cannot establish readiness for the combined revised scope until this allocation is resolved.

Archive design owner: [independent archive reports](../database-remaining/README.md#approved-group-3-independent-archive-reports-and-no-relaunch).
This is a planning amendment. Preserve existing in-flight gate schedules, candidate evidence and
accepted work; it does not launch implementation or reschedule reviews. New launch readiness awaits
the complete revised allocation and verified prompts.

## Approval, owners and status

**Shared-read-model amendment — 2026-09-08.** The operator approved one derived `run_summaries`
table for Queue/Activity. The [existing summary owner](../database-remaining/README.md#approved-group-5-dryrun-results-and-shared-run-summaries)
owns its schema, derivation, query and rebuild behavior; do not add another Activity/queue table in B
or a peer. Before revised launch, allocate one shared prerequisite for source mutation/summary hooks,
grouping, completion/receipt/failure annotations, archive cleanup and recovery. Completion and
diagnostics retain their source-field ownership and must coordinate meaningful updates with that
seam; provider and artifact owners supply only summary inputs actually required by the field map.
Resolve overlaps before declaring peers independently implementable. This amendment adds no new
supervisor task or migration owner and preserves in-flight gate schedules/evidence.

On 2026-09-08 the operator asked to revise the remaining database plans for independent parallel
implementation, testing and integration, explicitly including the plans themselves. This is the
approved execution amendment. It changes allocation and dependencies, not the approved product
requirements. Product requirements and their proof rows remain in the four linked owners below.
This file owns unit B (`side/database-foundation`) and cross-plan execution controls.
[00-prerequisites.md](00-prerequisites.md) is the single prerequisite task entry point. It runs A
and B sequentially in the same supervisor task; their separate scopes, branches, gates, reviews and
accepted integration boundaries remain intact. On 2026-09-08 the operator asked to collect all plans
in one folder and finish the prerequisite before launching every parallel peer.

**Planning only. No implementation, product gates, independent implementation review or integration
has occurred for these revised assignments. All launch prompts are WAITING ON their recorded inputs.**

Leave the complete [worker](../worker-names/README.md), [command](../command-groups/README.md),
[operation](../operation-names/README.md) and [timeline](../timeline-history/README.md) plans unchanged,
including timeline T2. Do not interrupt, adopt, rebase, reschedule or message those running assignments
as part of this amendment. Accepted timeline T2 and its existing prerequisites are the initial barrier.

Read [root instructions](../../../AGENTS.md), [routing](../../README.md),
[D344 governance](../../roadmap/roadmap.md), [D191 gates](../../rebuild/reference/guards-and-tests.md)
and the operating reference's Authorized orchestration section before execution. Use Astra/high for
every supervisor and agent, `sup_astra` for execution workers and a fresh read-only `sup_review` for
independent review. The operator opens one prerequisite supervisor and later three peer supervisors; no automatic task
dispatch or push is authorized. The prerequisite launch explicitly assigns its own A/B integration.

## Start here and concurrency

Everything for this batch lives in this folder. Launch **one prerequisite task**, then **three peer
supervisor tasks together** after its verified release. Do not separately launch its internal A/B units.

| File | Role |
| --- | --- |
| [00-prerequisites.md](00-prerequisites.md) | Start once: complete, review, integrate and clean up A, then B; publish the shared release base. |
| [00a-run-completion.md](00a-run-completion.md) | Full unit A specification consumed by the prerequisite task, not an extra launch. |
| [01-provider-usage.md](01-provider-usage.md) | Parallel task P; also the designated implementing integration owner. |
| [02-diagnostics.md](02-diagnostics.md) | Parallel task D. |
| [03-artifacts.md](03-artifacts.md) | Parallel task G; its import/storage prerequisites are completed by B. |
| [PROMPTS.md](PROMPTS.md) | Exact prerequisite, three peer and later integration prompts. |

During prerequisite work: one supervisor plus at most one bounded worker or independent reviewer
at a time. After release: three implementation supervisors, each with one fresh independent reviewer
when needed, so up to six active agents across the three tasks if capacity permits. There is no
fourth coordinator task and no additional implementation workers in the peers. This count excludes
the four unrelated in-flight tasks, which keep their current arrangements. Heavy test windows remain
scheduled under the existing resource section; three tasks running does not mean three coverage runs.

## Dependency and responsibility map

```text
Existing timeline T2 accepted, integrated and released under its unchanged plan
  -> side/run-completion                 prerequisite A: complete its existing three changes
  -> side/database-foundation            prerequisite B: shared schema, adapters and module seams
       -> side/provider-usage            peer P: generic accounting policy and transactional behavior
       -> side/diagnostics               peer D: operator failure resolution end to end
       -> side/artifacts-2               peer G: generated-file publication and export behavior
```

P, D and G each depend only on accepted B, not on each other. They can be implemented, tested and
integrated in any order once B's release evidence exists. A and B are deliberately sequential because
they change the same migration authority and terminal/retention/composition code. They are not peers.

| Product owner | Work completed before peers launch | Work owned by its parallel supervisor |
| --- | --- | --- |
| [Run completion](00a-run-completion.md) | A completes all three changes and P1–P6, including terminal atomicity, migration and Storage Doctor removal. | None. Do not create an artificial second completion task. |
| [Provider usage](01-provider-usage.md) | B owns final physical schema, old-table conversion, IDs, shared repository contracts, real legacy-capability adapters, recovery and deletion hooks. | P implements the generic synthetic-provider accounting path, multi-scope reserve/settle/expiry, uncertainty, window and retention behavior within the frozen storage contract. No real key/provider wiring. |
| [Diagnostics](02-diagnostics.md) | B owns all three evidence renames, knowledge/fix retirement and backup protection, separate resolution columns/version, low-level annotation repository and preserved existing capture/readback behavior. | D owns the admitted resolution command, atomic command/audit/timeline transaction, read model and Mark resolved/Reopen UI with archive protection. |
| [Artifacts](03-artifacts.md) | B completes former T1 import/extraction work; also owns final generated-file schema, migration/source preservation, legacy storage adapters, pending counts, low-level ordered queue/CAS/receipt methods and shared checkpoint/export seams. | G owns immutable file publication, exclusive destination writer behavior, exact checkpoint replay consumption and registration of existing explicit XLSX exports. No new output format or workflow activation. |

The old standalone launch `side/artifacts-1` is retired before execution: its full product scope and
proof transfer to B, recorded in the artifacts plan. A/B unit IDs remain stable under the single
`side/database-prerequisites` entry task; P/D/G task IDs also remain stable. This does not retire or weaken any acceptance criterion.

## Evidence behind the split

Inspected planning base: `ad159128b44926408babf02126941ba782052192` on local master. This is
source evidence, not a future execution base. The schema currently uses a single ordered migration
sequence (`src/infra/sqlite/migrations.ts`, current schema 34), literal historical fingerprints,
strict current-version opening, and shared upgrade/recovery registries. Four peer migrations cannot
independently reserve the same next version; renumbering at merge time would not prove the tested candidate.

`src/infra/sqlite/authority-database.ts`, `storage-records.ts`, `src/domain/authority.ts`, `ids.ts`,
`src/core/command-kernel.ts`, `run-executor.ts`, server composition, deletion/integrity, shared storage
diagnostics, fixtures and generated catalogs currently cross several product scopes. Separate worktrees
alone do not resolve those shared writes. B must finish their shared changes and expose real adapters
before peer dispatch. This is a bounded extraction, not a new database, migration framework or plugin system.

The planned dependency graph has no peer edge. Actual source-level disjointness and both-order
integration remain **release conditions for B**, because the extracted modules do not exist yet.
Do not call the peers READY merely because this plan has been committed.

## A — run completion prerequisite

Execute unit `side/run-completion` locally within the prerequisite task, using
[00a-run-completion.md](00a-run-completion.md), with timeline T2 as its direct prerequisite.
Its full implementation, P1–P6, independent review, required gates, accepted local-master integration
and owned cleanup must finish before B. Provider usage is no longer a prerequisite for completion.
A owns its own migration sequence and shared consumer changes while no revised peer is running.

## B — shared database foundation

Unit ID: `side/database-foundation`, executed locally after A in the same prerequisite task.
This section is its implementation owner; do not open a separate supervisor. Read the complete
provider, diagnostics and artifacts contracts and proof tables; the allocation below does not replace them.

1. **Bind the base and current names.** Verify accepted A and timeline T2, source/target isolation,
   instruction owners, supported upgrade floor and free worktree capacity. Record actual full base SHA,
   schema identity and an exact old/new caller map. No operator database conversion is assigned.
2. **Settle interfaces before consumers.** Extract narrowly scoped provider storage, failure annotation,
   generated-file storage and checkpoint/export composition behind strict typed transaction ports.
   Keep the actual SQLite transaction shared across composite writes; an adapter must not accidentally
   commit part of an outer command/checkpoint/deletion transaction. Move current implementations with
   behavior-preserving proofs, then bind the final schemas from the product contracts. No raw-SQL escape
   hatch, broad repository redesign, alternate storage authority, placeholder success or mock-only wiring.
3. **Implement the shared conversion completely.** Own all migrations/fingerprints, SQL/JSON schemas,
   IDs, repository interfaces, integrity/deletion/recovery/backup registration and common composition.
   Supply the provider generic fields and honest legacy accounting representation; the diagnostic
   renames, protected retirement and resolution annotation; complete one-row imports and extraction
   rename; supply generated-file ordering, queue/receipts/version state and historical conversion.
   Choose migration version numbers only here from the accepted base. Never modify released fingerprints.
4. **Keep the intermediate application usable and safe.** Real legacy provider calls, diagnostic
   capture/download, intake submission and existing output consumers must work through the new storage.
   Strict compatibility adapters may retain old API names internally, but no second live table or
   dual-write authority. Unimplemented new attributed-provider/resolution/export-registration behavior
   must not be exposed as available. Preserve the existing output safety guarantees; do not activate a
   new unsafe writer pending G. Any required stronger safety at the adapter boundary is B's work.
5. **Finish shared presentation and generated inputs.** Update Storage Doctor shapes/counts and shared
   fixtures; complete all necessary root composition, registration, shared domain/import-closure changes,
   owner contract amendments, generated catalog/manifest inputs and guard-retirement inventory. The
   peer candidates must independently pass freshness checks without a later central regeneration fix.
6. **Prove and release.** Complete the foundation proof map below, full gates and fresh independent
   review. Record exact module/API/test ownership and release evidence. Use the prerequisite task's explicitly assigned local integration after review PASS.
   Only after accepted integration, required combined gates and cleanup record base `B` in
   [the prerequisite release record](00-prerequisites.md#release-record) and
   release P/D/G. Do not launch them automatically.

### B proof allocation

| Product proof | B's required evidence | Remaining peer evidence |
| --- | --- | --- |
| Provider P1/P5/P6 | Final strict schemas round-trip synthetic attribution; populated historical conversions, complete backup/restore, unchanged real composed legacy admission and diagnostics. | P proves all generic transactional policy, including P1–P4/P6; reuses only valid unchanged migration evidence and runs full required gates. |
| Diagnostics P1/P2/P6 | Evidence-preserving renames, protected retirement, historical unresolved defaults, deletion and restore; real existing consumers. | D proves P3–P5 and annotation-specific P6, including real composed command/UI and multi-connection races. |
| Artifacts P1–P3/P7/P8 | Complete import/extraction functionality and proof; generated historical source-copy migration, retirement, pending counts, shared retention/recovery. Prove low-level P4 ordering/CAS/rollback on actual SQLite. | G proves P4–P6 and generated-output portions of P8, including filesystem fault injection and existing export service. |

Record each subclaim's test and exact tested tree. No row is marked wholly complete from partial proof.
B must cover supported fresh/historical databases, populated mixed-domain upgrade, old identifier and
fingerprint stability, transaction rollback, pre/postcommit interruption, source-bound backups and
restore, tombstones and shared file references. Empty local tables are not migration evidence.

### B execution sizing

One Astra/high supervisor owns migrations, shared contracts, composition and consequential integration.
Default zero implementation workers while those contracts are changing. After an actual committed,
gated extraction fixes the relevant input, it may dispatch one bounded `sup_astra` worker for a populated
historical-fixture/test contribution with an exclusive new test file under `tests/unit/database-foundation/`.
The supervisor continues the separate production seam. Bind the exact file, fixture dependencies,
negative controls and focused test command before dispatch; do not assign a whole product plan to it.
The worker uses its own branch/worktree, no shared helper edits, and returns within one context.
Tell it others share the filesystem and it must preserve their changes. If stable independent work or
capacity is absent, keep that work local. A fresh complete `sup_review` reviews the final B candidate;
the supporting test worker is never the reviewer. Finish the worker's assignment before independent
review, keeping at most two active agents in this prerequisite task. No nested supervisors or idle observers.

## Frozen peer ownership and release proof

B creates or extracts the following owned modules. Names below are intended new locations, not a
claim they currently exist. B records every actual file, exported contract and test selector before
release. A necessary change to this allocation requires a plan amendment before peer launch.

| Owner | Exclusive changing production scope after B | Exclusive tests and authored records |
| --- | --- | --- |
| P `side/provider-usage` | `src/infra/sqlite/provider-accounting.ts`; `src/core/provider-admission.ts`. B supplies immutable repository types and a real legacy implementation of this module before release. | Existing provider admission/pool/exhaustion tests, new `tests/unit/provider-accounting/`; provider plan and its new `01-provider-usage-evidence.md` file in this folder. |
| D `side/diagnostics` | `src/core/failure-resolution.ts`, `src/infra/sqlite/failure-resolution.ts`, `src/server/dashboard/queries/failure-resolution.ts`; resolution command admission/dispatch in `src/domain/commands.ts` and `src/core/command-kernel.ts`; `src/server/dashboard/queries/run-trust.ts`, `src/server/dashboard/queries/run-detail-types.ts`, `src/domain/dashboard/run-detail.ts`, `src/dashboard/surfaces/trust.tsx` and `trust-model.ts`; a new `src/server/dashboard/compose/failure-resolution.ts` factory. D alone may change these command/read/UI files. | New `tests/unit/failure-resolution/`, `tests/unit/dashboard/failure-record-render.test.ts`, `failure-record-model.test.ts`, and new resolution parity cases/references; diagnostics plan and its `02-diagnostics-evidence.md` in this folder. D alone owns any necessary post-B guard-inventory membership edit. |
| G `side/artifacts-2` | `src/core/generated-artifact-projection.ts`, `src/infra/sqlite/generated-artifacts.ts`, existing `src/infra/artifacts/artifact-sink-projector.ts` and `xlsx-retention-sink.ts`; `src/server/dashboard/exports/operator-xlsx-export-service.ts` and a new `src/server/dashboard/compose/generated-exports.ts` factory. | Artifact projection/verified-reader/operator-XLSX tests and new `tests/unit/generated-artifacts/`; artifacts plan and its `03-artifacts-evidence.md` in this folder. No failure-detail UI or command registration changes. |

All other changing shared files must be completed by B: migration and storage records, IDs/global
repository types, authority database, recovery/upgrade/integrity/deletion registries, common server
composition, the run-executor's checkpoint transaction seam, Storage Doctor, fixture builders and
generated descriptor/catalog sources. P/D/G may call these frozen interfaces, not edit them. B must
route the real executor through G's module and expose the existing export service through its owned
factory; G must not need to reopen root composition. Shared contract/index status updates after peers
belong to the integration owner, with each peer documenting precise proposed changes in its own evidence.

Before releasing peers, B records:

- Each peer's exact write set, stable APIs, real production entry points and independent focused/full
  gate commands. No unresolved consumer paths, sibling fixtures, unmerged APIs or shared outputs. New resolution
  parity cases use their own helper/reference names; D alone may update affected existing trust/failure
  reference triples. G cannot update those references or shared parity fixtures.
- Pairwise write-set intersections are empty, including tests, generated inputs, fixtures, plan records,
  parity references and snapshot manifests. Confirm the listed D failure UI and G export files cover their actual import closures;
  an additional shared dependency must be completed in B before release.
- For P↔D, P↔G and D↔G, explain why either can be present alone on B: identical schema version and
  migration history; unchanged shared repository contracts; no dependency on the other's new command,
  provider behavior or publication path. Real baseline flows and migration/retention tests pass on B.
- Actual B commit/tree, gates and independent review; accepted local-master commit containing B and
  the plan revision. All peers pin this same accepted base even if another peer later merges first.
- Available worktree slots and test-resource allocation below. If this proof fails, affected peers stay
  WAITING ON a corrected prerequisite. Do not move a shared edit into a peer or excuse a red gate.

Each peer then proves its full vertical behavior on B alone, commits and independently reviews its
complete candidate. At integration, the owner verifies clean composition in both orders for each pair
(non-mutating Git merge-tree checks where supported, otherwise an owned scratch checkout), equality
of resulting trees apart from deliberately ordered evidence records, and no schema/fingerprint drift.
If order changes behavior or requires a new shared implementation, stop and amend the prerequisite.
Run the required gates on each materially changed actual integration tree; do not claim a syntactic
merge proves runtime correctness or repeat unchanged full suites just for an order label.

## Branches, bases and capacity

| Task | Create branch | Absolute worktree | Required base |
| --- | --- | --- | --- |
| A `side/run-completion` | `codex/run-completion` | `/Users/julianhein/Projects/hr-worktree-run-completion` | Accepted timeline T2 with existing predecessor acceptance and this plan available. |
| B `side/database-foundation` | `codex/database-foundation` | `/Users/julianhein/Projects/hr-worktree-database-foundation` | Accepted A integration containing this amendment. |
| P `side/provider-usage` | `codex/provider-usage` | `/Users/julianhein/Projects/hr-worktree-provider-usage` | The exact accepted B release commit. |
| D `side/diagnostics` | `codex/diagnostics` | `/Users/julianhein/Projects/hr-worktree-diagnostics` | The same B release commit. |
| G `side/artifacts-2` | `codex/artifact-outputs` | `/Users/julianhein/Projects/hr-worktree-artifact-outputs` | The same B release commit. |

No branches or paths are reserved by this document. Verify ref/path ownership and record full base,
branch, path and actual task ID at launch. Reuse only the exact task's verified interrupted checkout.
Planning HEAD is never a substitute for a missing prerequisite. Preserve the four-auxiliary-worktree
ceiling including unrelated tasks. Five in-flight auxiliary checkouts existed during inspection under
their unchanged arrangements; that is not permission for new over-capacity work. Wait for their owners'
verified cleanup. Three peers use three slots; the fourth may serve the integration owner. A reviewer
is read-only and needs no writer checkout. Do not reserve a coordinator worktree while it has no work.

## Test resources and required gates

Observed: Vitest already caps each invocation at four file workers because higher concurrency starved
fixture/guard checks. Three concurrent default invocations would create twelve. The inspected host has
11 logical CPUs and 18 GiB RAM; that is capacity evidence, not proof twelve workers are safe. Parity
uses ephemeral per-worker ports and private state, plus worktree-local `dist/dashboard`,
`tests/parity/.output` and `.tracker/locks/parity-json-report.lock`. The test runner's shared temporary
parent contains unique invocation roots/process groups. Those paths do not require a global file lock.

For this new batch, the **operator allocates host test slots**; the implementing task holding a slot
owns the processes and evidence. Record holder, task ID, command, worker count and release in its
evidence. At most four Vitest file workers across this batch: focused runs can share two slots each
(`npm run test -- <owned selectors> --maxWorkers=2`), or one run can use four. Full coverage reserves
all four, using unchanged `npm run test:coverage`; other batch test/build/compiler/linter processes
must be finished before its window. Editing and independent read-only review may continue. Parity
uses `npm run test:parity -- --workers=2` in a scheduled host-heavy window, without simultaneous
coverage or another parity/build run. The inspected wrapper forwards this worker argument and retains
its mandatory JSON/assertion checks. No timeout, membership, floor, reporter or retry changes.

No default whole-implementation serial queue: only those evidenced host conflicts and same-worktree
mutable build/parity outputs are serialized. Typecheck/lint in different worktrees may overlap outside
coverage windows within measured capacity. Do not claim existing per-checkout locks allocate host CPU.
If a slot is unavailable, report the named wait and continue unaffected work; if none remains, return
a resumable handoff. Do not sleep/poll for a gate slot or stop another owner's process. Scheduling for
in-flight assignments stays unchanged; this policy starts after their prerequisite release.

A, B, D and G require typecheck, lint, full coverage, web build, full parity, affected generated checks
and `git diff --check` per implementation candidate/commit and material integration, under D191 cadence.
P requires typecheck/lint/full coverage and freshness; web/parity become required if served shapes
change, as its product plan specifies. B runs the union of its product-owner focused proofs plus new
real transaction/extraction/mixed-migration tests. Integration of D or G requires the UI gate family.
Use `/ui` and module rules for UI work. Keep all product proof rows, negative controls, guard inventory,
independent review and valid evidence reuse. Logs identify exact SHA/tree, command, exit, worker count
and owned output path. Product gates cannot be substituted with documentation checks.

## Integration owner and compact handoffs

**One peer-batch integration owner: the implementing `side/provider-usage` supervisor.** Its actual
task ID is recorded when the operator launches it; do not infer a recipient from a title. A and B
are units in the one prerequisite supervisor, whose launch assigns their sequential local integration
and cleanup. That task ends after publishing the complete release; it is not a peer-batch coordinator.
P implements its accounting work first and may end its turn between actionable integration assignments.

Ready candidates return for **operator-chosen integration**, as D344 requires. Naming P does not
automatically authorize a merge. The operator resumes P with the integration prompt and exact accepted
candidate identities. P alone then mutates local master at `/Users/julianhein/Projects/hr-automation-rebuild`
in its assigned window, checks target ownership, merges reviewed candidates serially in either order,
updates shared contract/index status and gates each material combined tree. A dirty/shared target
requires its own `codex/database-integration` branch at
`/Users/julianhein/Projects/hr-worktree-database-integration`, with verified capacity and later serialized
target integration. No push, destructive reset, silent conflict preference or authority migration.

The complete candidate review is fresh `sup_review`, Astra/high, read-only, with pinned base/head/tree,
full assigned diff, product proof map and logs; it cannot implement/delegate or inherit the author's
working conversation. P's own candidate gets the same independent review. Review behavioral conflict
fixes independently and rerun affected gates. Missing review or evidence keeps the candidate unaccepted.

A handoff contains only task/actual task ID, approved plan revision, base/head/tree, branch/absolute path,
owned scope and changed files, proof/gate/review verdict links, dirty state, concrete blockers and the
remaining integration/cleanup owner. The receiver explicitly accepts exact scope/identity; sending a
message is not acceptance. Before acceptance the sender retains responsibility and leaves a durable
return if ending its turn. After acceptance, if no local work remains, the sender ends; no observer loop.
Use an authorized actionable message to resume an idle task for a specific repair or accepted transfer,
not repeated status reads or automatic sibling launch. No task is marked complete until accepted
integration, gates and owned cleanup are verified. Remove only integrated exact branches/worktrees
from a safe checkout; preserve dirty evidence and unrelated work. Archive tasks only when explicitly
authorized, never merely because their worktree was removed.

## Future database batches

Apply this admission pattern to future plans in this database discussion: identify shared schema,
transaction/composition/fixture/derived-output ownership first, complete prerequisites, then prove each
peer standalone and both merge orders. Use separate supervisors for independent end-to-end scopes;
use a bounded worker only against completed inputs while its supervisor has useful independent work.
Do not attach a future task to this running batch or change its boundaries without an approved amendment.
No new global instruction or automatic future-work authorization is created here.

## Earlier planning validation

On 2026-09-08, documentation checks passed: `npm run roadmap:check`, 131 local document links,
four in-flight plan byte comparisons, all 26 unchanged product proof rows and four unchanged product
contract sections, nine equal instruction pairs (largest chain 16,648 bytes), and `git diff --check`.
The diff changes authored planning/contract text only; no runtime gates were run or reused as proof.
Runtime independence remains subject to B's release proof; no migration, provider call or live database
write is claimed by this plan.

## Folder consolidation validation

On 2026-09-08, the operator-approved consolidation passed `npm run roadmap:check`, 156 local
links, all 26 preserved product proof rows, four unchanged in-flight plan byte comparisons,
and nine equal instruction pairs (maximum chain 16,648 bytes), plus `git diff --check`.
The four old plan folders were removed after moving their sole plan files here and updating current
contract/index links. Detailed evidence filenames are distinct for each peer. No product code,
implementation gates, operator database or running task was changed. Exact prompt bindings are
verified against the committed consolidation separately before delivery.
