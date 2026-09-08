# Worker and workflow request table names

## Assignment, approval, and status

**Task ID: `side/worker-names`.** This is the single owner of this side-work assignment;
it is not a roadmap phase or a replacement for an admitted phase task.

On 2026-09-08 the operator chose: keep `worker_pools`, rename `leases` to
`workflow_workers`, and rename `duo_ceremony_leases` to `worker_auth`. After the complete
proposal identified the active migration-owner overlap, the operator replied **“approve”**
to this plan, including execution after independently reviewed integration of Task 2.6.1-3.
The operator requested planning only in this session, with implementation in a new session.

**Approved amendment, 2026-09-08:** the operator subsequently chose `start_plans` →
`workflow_run_requests`, kept `config_snapshots` unchanged, and explicitly requested adding
that rename to this existing plan. This amendment extends the same migration, compatibility,
and review scope; it preserves the task ID, checkout binding, prerequisite, and integration
conditions. Use the amended plan commit rather than the original `f4487557` launch reference.

**S1–S5 complete; R1 PASS. S6 complete: combined review, gates, master integration and owned candidate cleanup verified.** The
implementation and candidate gates passed, with complete independent acceptance of all
23 changed paths and P1–P7. The reviewed candidate is ready for operator-assigned integration.
The operator database has not been converted. The original planning session created no
checkout or app task and dispatched no agents.

| Current table | Approved current-table name |
| --- | --- |
| `worker_pools` | `worker_pools` (unchanged) |
| `leases` | `workflow_workers` |
| `duo_ceremony_leases` | `worker_auth` |
| `start_plans` | `workflow_run_requests` |
| `config_snapshots` | `config_snapshots` (unchanged) |

`worker_auth` still represents one expiring Duo authentication lock per credential
identity, shared across workers and systems. It is not a password store, a browser-session
table, or one authentication record per worker. `workflow_workers` retains worker
lifecycle, operator directives, heartbeats, active-run association, and lease generations.
The concepts of a worker lease and a Duo ceremony remain valid internal terminology.

`workflow_run_requests` stores the saved proposal before confirmed execution. One request
may produce several runs; an unconfirmed or expired request may produce none. Confirmation
still uses the existing Start command and audit; successful consumption retains the request
with its consuming command identity. No confirmation table is added, and the row is not moved
into `workflow_runs`. Internal start-plan terminology and its existing interfaces remain valid.

## Authorities and prerequisites

- [Document routing](../../README.md) and [root instructions](../../../AGENTS.md).
- [Task 2.6.1-3](../../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/task-1-3-revalidate-operator-read-models.md)
  and its [part ledger](../../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/README.md)
  own the prerequisite, A2/A3 retirement, accepted integration evidence, and current phase status.
- [Execution and sessions](../../rebuild/reference/execution-and-sessions.md), particularly
  sections 3, 10 (D267), and 11 (D269/D271), own worker ownership, Duo serialization, and pools.
- [Dashboard surfaces](../../rebuild/reference/dashboard-surfaces.md), D330/D332, and
  [clock/config/secrets](../../rebuild/reference/clock-config-secrets.md), D331/D332,
  own boot/upgrade, settings preservation, and operator surfaces.
- [Guards and tests](../../rebuild/reference/guards-and-tests.md), section 3.14 D191 and
  section 5.2, own validation and compatibility boundaries.
- [Operating reference](../../../.agents/skill-library/repository-work/REFERENCE.md),
  especially isolation, environment, and authorized orchestration, and
  [roadmap governance](../../roadmap/roadmap.md), especially D344, govern execution controls.
- [Server instructions](../../../src/server/AGENTS.md),
  [frontend/backend integration](../../rebuild/reference/frontend-backend-integration.md),
  and [operator trust](../../rebuild/reference/operator-trust.md) apply to affected consumers.
  Frontend/backend integration section 5.1 also owns start planning and confirmation;
  the approved request-table name does not change that protocol.

Task 2.6.1-3 owns an active change to `migrations.ts`, `authority-database.ts`, table
registries, historical backup inspection, and storage/upgrade tests. Its inspected working
tree was adding schema 34 and retiring `runs_view`. This is overlapping implementation
ownership, not merely a shared reference. Do not consume its dirty files, take its scope,
reserve its migration number, or change its admitted acceptance. This task follows its
reviewed integration. Other unrelated tasks and their resources must be preserved.

Task 2.6.1-2's Rerun-values work excludes SQL migrations and canonical store mutations.
The added rename stays in the storage adapter; do not take its planning/input-mapping
implementation or change Rerun consent. Existing Start/Rerun callers are read-only trace
and regression targets unless they contain a direct SQL table reference requiring mechanical
replacement. Recheck newly changed ownership before execution; a new actual overlap needs
resolution, not silent reassignment.

## Inspection evidence and highest risks

Planning inspected code, contracts, migration history, Git, active ownership, and a supported
read-only storage report. It did not execute product tests, migration, backup, restore, or login.

| Question | Evidence and required response |
| --- | --- |
| Are the names only labels? | `src/domain/authority.ts`, `src/infra/sqlite/storage-records.ts`, and `authority-database.ts` use them as registered authorities and real SQL targets. Update all current consumers together; a string replacement in one registry is insufficient. |
| Can old migrations be edited? | `tests/unit/architecture/migration-history-immutability.test.ts` pins every released ordered statement through schema 33 at the inspected base. Preserve those bytes and the prerequisite's accepted additions; append the next migration and its new digest. |
| Will old backups still validate? | `src/infra/compat/backup-inspection.ts` reconstructs released schema shapes and fingerprint table order, validates historical records through their table names, and counts worker rows with explicit SQL. Historical names must stay admitted with their original ordering and record grammar while current names change. |
| Does ordinary startup perform conversion? | Schema admission is controlled by `UPGRADE_FLOOR_SCHEMA_VERSION`; the inspected current schema is 33 with floor 32. Raise the floor appropriately for the new rename so existing sources require the stopped, verified-backup upgrade route. Recheck after the prerequisite rather than freezing its implementation prematurely. |
| Can settings and credentials be preserved? | `src/infra/compat/upgrade-sources.ts` and `settings-database-upgrade.ts` use SQLite sources for schema 32+ and preserve ordinary settings revisions. `src/server/storage/upgrade.ts` verifies backup/source identity, rehearses conversion, rechecks stopped admission, and supports interrupted settlement. Preserve these mechanisms and test the newly historical schema versions. |
| Will the UI or runtime meaning change? | `src/domain/run/worker.ts`, `src/domain/run/worker-pool.ts`, and `src/core/duo-ceremony-gate.ts` define unchanged lifecycle, requested-count, and lock semantics. Existing worker repository interfaces and wire fields remain compatible. Full parity and composed worker tests detect transitive regression even without frontend edits. |
| Does the request rename change confirmation? | `src/domain/run/start-plan.ts` defines accepted/refused entries, expiry, configuration/input identities, and `consumedBy`. `src/server/dashboard/commands/start-plan-service.ts` persists the proposal through `startPlans.create`; `src/core/command-kernel.ts` validates and consumes it before fan-out. `authority-database.ts` implements create/get/consume against `start_plans`. Rename the registered SQL target and historical aliases, preserving repository interfaces, records, command/audit references, refusal behavior, and transactional consumption/fan-out. No new confirmation state or table is needed. |

Actual target observed with `npm run cli -- storage doctor --json` at
`2026-09-08T15:51:16.007Z`: rebuild `/Users/julianhein/Projects/hr-automation-rebuild/.tracker/state.db`,
schema 33, authority healthy, protected settings available, backup stale. Source database
identity was `35ae66fbb575adebdc61b4018fb4d9153d53bbb8d0f38e0b45cba410c459f54a`.
This is compatibility evidence, not current admission to conversion. Recheck identity, schema,
permissions, locks, backup freshness, and settings/database coupling before any later
explicitly assigned operation. No credential values or operator data were exported.

## Execution binding and ownership

| Field | Binding |
| --- | --- |
| Implementer | One supervisor, GPT-6 Astra/high, implementing locally; zero implementation workers. Use the temporary Astra role policy. |
| Review R1 | One fresh read-only `sup_review` on Astra/high, with no implementation history; covers the complete candidate, all proof rows, documentation, compatibility, and transitive consumers. Maximum two active agents including the supervisor. |
| Implementation mode | Create a new worktree and branch, not a checkout switch in the shared primary directory. |
| Branch | `codex/worker-names` |
| Absolute checkout | `/Users/julianhein/Projects/hr-worktree-worker-names` |
| Verified planning baseline | `a3c73c8039508ea307db70f9c2f01228c689435c` on local `master`; this contains the inspected code and newer documentation, but is NOT the implementation prerequisite. |
| Execution base | At start, resolve Task 2.6.1-3's actual reviewed integration SHA from its owner/part ledger; verify candidate review, gates, and ancestry in local `master`. Select and record a verified `master` commit containing that integration AND the approved side-plan commit. Do not invent the future SHA or use the planning baseline to bypass the prerequisite. |
| Plan availability | Verify this complete committed file with `git show`, its approval, named-ref reachability, and presence in the selected execution base before edits. Record the actual plan SHA in the execution ledger. |
| Capacity | Recheck the repository's four-worktree ceiling including unrelated work, branch/ref/path availability, and active ownership. Missing capacity means wait; never delete another task's checkout or implement on `master`. Names are proposals until checked. |
| Integration target | Local `master` in `/Users/julianhein/Projects/hr-automation-rebuild`. The operator assigns integration; there is no automatic merge authorization. |
| Merge/cleanup condition | Complete R1 PASS, required candidate gates, stable committed candidate, verified target and ownership, then operator-assigned serialized integration with `--no-ff`, required integration gates, and renewed review of behavioral conflict fixes. Remove only this task's integrated branch/worktree from a safe checkout after the ownership and active-checkout checks. No push. |

The coupled schema, historical compatibility, runtime consumers, and proof fit one supervisor
and one complete reviewer. Splitting implementation would duplicate ownership of the same
migration and database adapter. Tactical fixes remain with the supervisor; no nested fix
agents, sibling dispatch, or extra implementation worktrees. Amend material scope or review
allocation before executing it; a partial or exhausted review is not PASS.

Owned implementation seams:

- Current authority and storage-record registries; the new SQL migration and current-table
  coverage mapping; worker/auth/request SQL reads, writes, accounting, and integrity checks.
- Historical schema/table/record admission and fingerprint ordering in
  `src/infra/compat/backup-inspection.ts`; narrowly required stopped-upgrade, recovery,
  backup, and doctor compatibility changes under `src/infra/compat/`,
  `src/infra/sqlite/`, and `src/server/storage/`.
- Direct current-table references, their focused tests and synthetic fixtures, migration
  digest extension, and narrowly affected architecture guards. Update guard inventory only
  for an actual guard addition/retirement and retain deciding negative-control evidence.
- Current naming amendments in the linked owning contracts and decision index, plus this
  plan and necessary generated sources/outputs. Clearly distinguish current names from
  historical schema names; do not sweep historical ledgers or change roadmap completion.

Repository interfaces, public JSON fields (including existing count fields), command names,
stored worker/auth/request record fields, error identities, worker generations, Duo timing,
and authentication scope are not renamed just because they contain “lease” or “start plan.”
In particular retain `startPlans`, `startPlanId`, `StartPlanRecordSchema`, Start command
targets/fingerprints, expiry, and `consumedBy`; this assignment renames SQL tables rather
than the planning/confirmation API. Preserve
released SQL history, including historical trigger/index identifiers; current SQL targets
and diagnostics that actually identify a table must resolve accurately. No compatibility
alias tables or views are introduced.

## Ordered steps and acceptance

1. **S1 — admit and bind execution.** Verify the prerequisite and approved plan, resolve the
   actual base, recheck capacity and ownership, create the dedicated checkout, and record
   branch/base/plan/head before edits. Read changed module instructions and prerequisite
   compatibility contracts. A new schema-owner conflict or unsupported prerequisite change
   returns for amendment, rather than quietly broadening this assignment.
2. **S2 — append the three renames and wire current storage.** Use the next schema version after
   the accepted prerequisite. Preserve historical statement bytes/digests; update registries,
   current queries, integrity/accounting checks, and the stopped-upgrade floor together.
   Keep `worker_pools`, `config_snapshots`, run/batch names, data, and runtime behavior unchanged.
3. **S3 — complete historical and recovery compatibility.** Preserve old backup fingerprints,
   historical record validation, older admitted source families, source-change refusal,
   interrupted settlement, and settings/credential preservation. Add meaningful regression
   tests at the real storage/upgrade/repository boundaries. Carry the prerequisite's deliberate
   projection retirement through direct older-source upgrades without asserting that retired
   projections must remain.
4. **S4 — prove behavior and update current naming references.** Execute the acceptance rows
   below, update the owning current documentation/decision pointer, and regenerate only
   affected outputs. Preserve internal lease concepts and historical citations. Investigate
   transitive UI failures; no redesign or parity refreeze is authorized to obtain a pass.
5. **S5 — gate, commit, review, and repair.** Run the candidate gates, commit exact paths by
   logical category, freeze the candidate, and dispatch R1 with base/commit/tree, approved
   plan, full diff, proof map, and gate evidence. Resolve findings and obtain renewed acceptance
   under the review policy. Keep all required findings visible until resolved.
6. **S6 — deliver the reviewed candidate.** Record review/gates and return the candidate for
   operator-assigned integration. Completion remains open while integration/cleanup is
   outstanding. Once assigned, verify and integrate to the named target, run required
   integration checks, record the actual SHA and cleanup, and stop. Actual database application
   is a separate explicitly assigned operation described below.

| Proof | Required result and negative control |
| --- | --- |
| P1 Fresh and upgraded schema | A fresh database has `workflow_workers`, `worker_auth`, `workflow_run_requests`, and unchanged `worker_pools`/`config_snapshots`; the three former SQL table names are absent from the current schema. Upgrade schema 33 and the accepted prerequisite schema using regenerable synthetic fixtures and the real stopped-upgrade route. Earlier admitted source families remain covered. Existing schemas are not converted by ordinary runtime startup. |
| P2 Data and identity preservation | Compare complete worker/auth/request rows before and after rename, including record bytes, keys, generations, versions, timestamps, holder/state, planned/refused entries, expiry, fingerprints, and consuming command identity. Preserve pool declarations, config snapshot rows/references, run identity, settings/journals, independent credential bytes, and batch grouping/revisions. Verify both grouped and separate batches; do not reset all batches to false by replaying migration 33 incorrectly. |
| P3 Worker and auth behavior | Real SQLite repository/service tests prove registration, heartbeat, claim, pause/stop, restart generation fencing, and pool controls. Duo tests prove acquire/release, exclusivity across workers, expiry/takeover, and rejection of superseded holders. Two workers sharing one credential must not acquire overlapping valid authentication turns. |
| P4 Backup and restore | Validate pre-rename historical backups with their original table names and fingerprint ordering; validate current backups with the new names. Exercise the existing restore drill and upgraded readback. Corrupt schema/records, unexpected tables, and identity mismatches refuse rather than becoming empty/default records or weakening historical admission. |
| P5 Upgrade refusals and interruption | At the real upgrade boundary, active processes, absent/stale backup, changed source, unsupported schema, and unresolved earlier conversion refuse with no unauthorized database effects. Prove a valid setup converts. Inject failure before SQLite commit and after commit/before settlement; verify rollback or exact resume as applicable, no duplicate conversion, preserved credentials/settings, and no-write rerun after settlement. Preserve earlier pending-conversion restrictions. |
| P6 Consumer consistency | Current integrity/doctor/count checks read the renamed tables; worker controls and queue/session rendering retain their existing wire semantics. Full parity passes without baseline changes. Source checks allow old names in released history, explicit historical adapters/fixtures, and historical documentation only; do not blindly replace legitimate lease terminology. |
| P7 Request creation and consumption | Through real SQLite and Start command/service boundaries, prove request creation alone creates no workflow runs; confirming a valid multi-entry request creates the accepted runs/batch and records consumption once. Verify unused, expired, and consumed historical request rows survive migration byte-for-byte. Expired requests, stale revisions, mismatched fingerprints, and consumption by another command refuse without new runs. Replaying an already journaled successful command returns its existing outcome without duplicate runs; failure during fan-out rolls back consumption and run creation together. Preserve accepted/refused entry handling, omission/Rerun metadata, configuration snapshot references, and existing command/audit linkage. |

## Gate schedule and evidence

Use installed scripts and real configuration from the resolved execution base. The inspected
runner uses isolated forks, `maxWorkers: Math.min(4, availableParallelism())`, and per-project
configuration; verify effective settings before a heavy run after any configuration change.
Do not raise workers, floors, timeouts, or alter suite membership to pass. Keep coverage free
of this task's compiler/linter contention. Independent typecheck, lint, and freshness checks
may overlap only within verified host/output limits; generation precedes its check. Serialize
shared generated output, integration writes, and evidenced resource conflicts; never stop
another task's processes or take its locks.

| Boundary | Commands and required evidence |
| --- | --- |
| Iteration: storage and runtime | `npm run test -- tests/unit/sqlite-authority-database.test.ts tests/unit/duo-ceremony-lease-store.test.ts tests/unit/duo-ceremony-gate.test.ts tests/unit/worker-loop.test.ts tests/unit/run-record-service/service.test.ts tests/unit/server/worker-pool-parallel-proof.test.ts`. Add/select the task's migration-preservation and refusal tests at their real boundaries. Run lint when tests run. |
| Iteration: compatibility | `npm run test -- tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-admission.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-backup-command.test.ts tests/unit/storage-restore-drill.test.ts`; targeted immutable-history guard via `npm run test:architecture -- tests/unit/architecture/migration-history-immutability.test.ts`. Full coverage later includes these; do not add redundant standalone full suites. |
| Iteration: requests and confirmation | `npm run test -- tests/unit/start-plan.test.ts tests/unit/server/start-plan-omissions.test.ts tests/unit/dashboard/start-plan-contract.test.ts tests/unit/run-fan-out-step-omission.test.ts`, plus focused real command-kernel/storage regression cases implementing P7. Preserve Start/Rerun API behavior; use the existing command tests rather than tests that only compare renamed strings. Run lint when tests run. |
| Implementation commit/candidate | `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run test:parity`, and `git diff --check`. Record command, exit, tested SHA/tree, effective worker configuration, proof selectors, and retained log locations. Group related fixes; focused green micro-cycles do not each require a separate commit/full run. |
| Generated artifacts | For affected inputs, run the appropriate generator (`npm run build:manifest`, `npm run stores:catalog`, `npm run roadmap`) before `npm run build:manifest:check`, `npm run stores:catalog:check`, or `npm run roadmap:check`. Inspect descriptor import closure even for comments. Do not hand-edit generated output or bypass a newly exposed freshness failure. |
| Material integration | Typecheck, lint, full coverage, full parity, affected freshness checks, and diff check on actual integrated inputs. Behavioral conflict fixes require renewed review. Do not merge before candidate PASS/gates. |
| Planning/recording only | Applicable Markdown link checks, existing instruction-pair equality and instruction-chain size checks, affected documentation/generated-input checks, and `git diff --check`. Classify by inputs, not extension. Do not claim unrun code tests or automatically reopen unchanged implementation review. |

D191 permits gate reuse only with the exact original command/result and tested SHA/tree,
current candidate, and inspected unchanged relevant code/tests/configuration/dependencies/
generator inputs recorded here. Missing evidence, changed inputs, failure, or material uncertainty
requires the applicable run. A recording-only SHA change is not itself a new runtime test.
Do not reuse old live-state observations as fresh operational verification.

## Separate operator database application

This implementation launch does not authorize converting the real database, stopping other
sessions, starting workers, or running HR workflows. After accepted integration, the operator
may assign application of this side plan to the rebuild root. That operation must:

1. Verify the accepted executable commit, exact rebuild root/config, current supported source
   schema, settings/database coupling, permissions, and current process/lock ownership using
   supported tools. Unexpected target/version or unfinished conversion blocks effects.
2. Stop/drain only the authorized rebuild dashboard/workers and verify stopped admission.
   Preserve unrelated sessions and legacy runtime. Do not discard locks or authority halves.
3. Create a fresh verified backup with `npm run cli -- storage backup --json`; require a
   matching current source generation/fingerprint. Inspect `npm run cli -- storage upgrade
   --plan --json` before conversion; the new plan check requires finished code and belongs here.
4. Apply `npm run cli -- storage upgrade --json`, then `npm run cli -- storage doctor --json`.
   Verify actual names, row preservation, settings/credential preservation, integrity, and
   repeat-call safety without printing private data. Compare expected prerequisite changes
   separately from this rename. Record backup manifest and upgrade outcome.
5. Preserve the intended runtime stopped/running state; do not start workflow execution merely
   to prove the migration. Report the actual state and any remaining operation separately.

No live HR transactions, UNKNOWN-submit retries, `.env` rewrite, credential export, legacy
reads/writes, cutover, UI redesign, new authority design, additional renames, compatibility
alias tables/views, or roadmap completion changes are authorized. Routine fixes within the
approved seams remain local; material contract/ownership/prerequisite changes require amendment.

## Progress and handoff ledger

The supervisor must send **Done / Now / Remaining** at start/resume and after each verified
step completion, before the next tool call. Keep implementation, review, integration, cleanup,
and any separately assigned operation visible. Record current base/head/plan SHA, accepted
proof with tested inputs, next step/blocker, and unfinished work here; use `/handoff` only for
interrupted unique recovery state, not as a second plan.

- Planning baseline: `a3c73c8039508ea307db70f9c2f01228c689435c`.
- Planning approval: operator “approve”, 2026-09-08, following the complete proposal.
- Amendment approval: operator selected `workflow_run_requests`, kept `config_snapshots`,
  and asked “can you add this in the earlier plan?” on 2026-09-08. The revised single
  assignment owns three SQL renames, with P7 and request-focused checks added to R1's
  complete review scope; supervisor/reviewer counts and all integration controls are unchanged.
- Planning validation (2026-09-08): all 13 local Markdown links resolve; named test
  selectors exist; all six steps and seven proof rows are retained in the amendment. Documentation audit
  passes for nine identical instruction pairs, with every discovered project chain
  below 32,768 bytes. The sole planned change is this side-plan file, outside the
  roadmap scanner's `docs/rebuild` input; no generated/runtime input changes and no
  code-gate rerun or reuse is claimed. Exact staged scope and whitespace are checked
  before commit; the handoff verifies committed contents and named-ref reachability.
- Task 2.6.1-3: not yet verified as reviewed/integrated; this is the implementation blocker.
- Proposed branch/path: absent at planning inspection; primary checkout remains on `master`.
- Capacity observation: three auxiliary worktrees at persistence inspection; recheck the
  repository ceiling and ownership before creating a fourth. Capacity is not reserved.
- S1–S6 and P1–P7: open. No implementation gates, review PASS, integration, or live conversion
  claimed by this planning record.

For the new session, use `/supervise side/worker-names` with this absolute plan path, its
verified full commit SHA, and the branch/checkout binding above. Label it WAITING ON until
the prerequisite and capacity are proven; select the actual execution base by the procedure
above rather than supplying a fabricated future hash. The handoff must include:

> This is an approved side-work assignment. The side plan is the task owner wherever
> /supervise refers to a task/phase section. Record progress, review, gate evidence and
> completion there. Do not create a phase number or mark roadmap tasks complete. Preserve
> repository contracts, independent review, required gates and authorized integration/cleanup
> conditions.

The operator opens the supervisor session. Planning does not open it, implement, dispatch
siblings, merge a product candidate, or push.

### Execution admission — 2026-09-08

- S1 complete. Approved plan `44460e2b65051a23d1a9584ac350c665d2da9985` is reachable
  from local master; its committed file SHA-256 is
  `4264464b9662f5a23eb528877271bf3e35e942c055606923a9db4ffc4941cdee`.
- Base/head at creation: `35635a04e16e9c3cf1e99b16d4963752a18c616a`; branch
  `codex/worker-names`, checkout `/Users/julianhein/Projects/hr-worktree-worker-names`.
- Prerequisite integration `8135811243470e9ca87972401fd244a7c6092d0b` is an ancestor.
  Its owner records complete R2 PASS at candidate `9b7365d7679b21abaf9c61dea24d5381bc7320fb`,
  evidence `cb14065ce74eb3720e96a34d3d8ce3cf618a1d30`, and integration typecheck/lint,
  5,639 coverage tests and 262 parity cases passing. Schema 34 removes `runs_view`;
  released migrations and the stopped conversion adapters are present as anticipated.
- Capacity: one pre-existing auxiliary checkout (`hr-worktree-phase-four`); this task
  created the second. Primary untracked handoffs and all peer resources are preserved.
  Active command-groups and operation-names assignments explicitly depend on this task's
  accepted integration, so no shared schema ownership is taken from them.
- No implementation gate reuse is claimed. S2–S5 proceed locally; S6 integration and
  cleanup remain operator-assigned. Real database conversion is not assigned.

- Parallel successor coordination: the command-groups supervisor reported the operator's
  explicit “no do in parallel” amendment in its task. It is independently implementing from
  the same schema-34 base. This task preserves its own complete candidate and owns no peer
  changes. Both candidates may use schema 35 before release; operator-assigned integration
  must choose ordering and reconcile the later unreleased migration, historical adapters,
  combined gates and review. No automatic integration is authorized here.


### Implementation and proof checkpoint — 2026-09-08

S2 storage wiring is implemented: schema 35 appends exactly three ALTER TABLE statements,
with floor 34, current repositories/registries/counts, historical layouts/record aliases,
released fingerprint order, and schema-35 journal/backup admission. Released v1–v34 SQL
and digests are preserved. No interface or wire field was renamed.

S3's focused storage run passed 151 tests (`/tmp/hr-worker-names-focused-3.log`, exit 0).
The stronger populated tests then passed in focused run 4, including the independent
schema-34 fingerprint order, generation-2 busy worker with heartbeat/pause, unused/expired/
consumed requests, and grouped/separate batches. That run had one stale literal assertion
in the composed downgrade test (34 rather than 35); the source is corrected, with rerun
pending. These are iteration results, not candidate acceptance.

Earlier failed iterations are retained at `/tmp/hr-worker-names-focused-{1,2,4}.log`:
missing schema-35 journal grammar, overly broad historical pending-journal inspection,
missing schema-34 manifest admission, and old floor/schema test pins. Typecheck iterations
1/2 exposed the historical DDL type needing exclusions for the three renamed current
names and the exact-fixture version union; both corrected. No assertions or thresholds
were removed. Candidate typecheck, lint, full coverage and parity remain required.

The original runner configuration retains isolated forks and four file workers. Host
inspection during focused iteration found three compilers, three linters and multiple test
runs across tasks, with 18.5 GiB swap used; peer resource coordination requested no duplicate
compiler/linter starts. This task's final coverage will start only after its own compiler,
linter and focused runs have exited. No other task's process or lock is stopped.


### Candidate gate binding

- Frozen staged tree before candidate gates: `738914e5cc384f9afdc0d0caa56c4791402d8be4`.
  `/tmp/hr-worker-names-candidate-inputs.json` binds all 2,193 tracked files except this
  evidence owner by SHA-256. Later evidence-only recording must verify every hash unchanged.
- Focused run 4: 140 passed, one outdated v34 downgrade literal failed; corrected in final
  inputs. Focused run 5: 11 files / 234 tests, exit 0, including the corrected downgrade
  proof and v33/v34 restore followed by real stopped upgrade with preserved credentials.
  Logs: `/tmp/hr-worker-names-focused-{4,5}.log`.
- Iteration typecheck 3 and lint 1 were explicitly terminated (exit 143) after source changes
  made their input snapshots stale and host memory contention was verified. Neither is a pass.
  Final typecheck/lint run sequentially against the frozen inputs; coverage follows both.
- Manifest, store catalog and roadmap generation completed, exit 0; all three outputs remain
  byte-identical to the base. No descriptor identity or parity reference changes occurred.
- S2–S4 implementation/proofs are complete subject to the mandatory candidate gates and
  complete independent review. S5 and S6 remain open.


### Proof map for complete R1

| Proof | Deciding boundaries and negative controls |
| --- | --- |
| P1 | `sqlite-authority-database.test.ts` fresh registry/baseline and immutable chain; `storage-upgrade.test.ts` populated v33/v34 conversion, ordinary-open refusal, old-table/view absence and current inspection; admission matrix preserves every earlier admitted version. |
| P2 | `populatedWorkerRenameFixture` compares every SQL column and record byte in all renamed tables, pools, snapshots, batches and runs. Generation-2 busy worker has heartbeat, active run and pause directive; requests include unused, expired, consumed and refused entries. Grouped batch version 2 and separate batch version 1 remain exact. Parameterized schema-32/33/34 settings tests compare settings/journals and independent credential bytes. |
| P3 | Real repositories in `run-authority`, `worker-loop`, `duo-ceremony-lease-store`, `duo-ceremony-gate`, and composed `server/worker-pool-parallel-proof`: claim/heartbeat, pause/stop, restart fencing, pool count, credential exclusivity, TTL takeover and superseded-holder refusal. |
| P4 | Populated v33/v34 backups match an independently frozen schema-34 fingerprint order; current backups match current inspection. Historical corrupt JSON and mirrored worker/auth columns refuse. `storage-restore-drill` restores v33/v34 and then upgrades through the real stopped boundary with unchanged credentials. Existing backup suites cover unexpected tables, malformed metadata and manifest/source identity refusal. |
| P5 | Admission matrix covers active locks, absent/stale backup, unsupported/ahead schemas, schema drift and transactional interruption. Populated v33/v34 cases compare exact pre-commit rollback, post-commit resume, one committed/settled pair and no-write settled replay. Existing source-binding/credential interruption tests remain; schema-32/33/34 unfinished conversions now all refuse before supersession. |
| P6 | Current SQL references were traced in `src`: old exact table names remain only in immutable DDL, historical adapters/layouts and historical fixtures. `leases` wire/count fields and generic lease terminology remain. Full current integrity/accounting mutation matrix, composed dashboard/worker tests and unchanged parity are required candidate gates. |
| P7 | `command-kernel.test.ts` proves saved multi-entry request creates no runs/batch, confirmation creates accepted runs with exact consuming command/audit, expiry/binding/version refusals, exact replay and cross-command consumption refusal, and atomic rollback during fan-out. `start-plan`, omissions, step-omission carry and Rerun tests preserve accepted/refused entry handling, omission/provenance and snapshot identities. |

No guard was added or retired; the existing migration-history digest and schema pin were
extended. All injected controls, suite membership, isolation, timeouts and coverage floors
remain. No full-gate or review acceptance is inferred from these selectors alone.


### Coverage resource correction

The first full four-worker run (`/tmp/hr-worker-names-candidate-coverage.log`) hit two
30-second `no-lifecycle-sql-outside-the-adapter` timeouts (35.630s and 44.920s observed).
It was stopped with exit 143; its owned child group was verified absent before rerun.
This is failed evidence, not a partial pass. No source/test/assertion change followed it.

The rerun uses the prerequisite's demonstrated resource-only adapter, retained at
`/tmp/hr-worker-names-vitest-adapter.mts` and temporarily loaded from
`.worker-names-vitest.mts`. It imports this checkout's actual `vitest.config.ts`, sets
root and every project to two workers, and asserts deep equality after stripping only
those worker counts. `/tmp/hr-worker-names-candidate-worker-processes-2.json` proves two
live isolated forks; the earlier four-worker observation is retained separately. No own
compiler/linter overlaps coverage. Suite membership, timeouts, isolation and floors match
installed configuration exactly. The adapter is removed from the review checkout after use.

Exact coverage constituents: `npm exec -- tsx scripts/test-runner.ts run --coverage --config
.worker-names-vitest.mts`, then `npm exec -- tsx scripts/suite-size.ts`. These are the installed
`test:coverage` constituents with only the approved resource setting changed; both must pass.


The first two-worker retry was stopped early (exit 143, log `candidate-coverage-2.log`)
after the concurrent operation-names supervisor reported the identical two architecture
timeouts (47.8s/41.4s). Its older coverage run owns the current heavy-gate window; this
supervisor released all observed coverage descendants and awaits that owner's explicit
release. Worker-names then owns two-worker coverage followed by parity, with command-groups
also notified. This queue is limited to the demonstrated coverage/parity resource conflict;
independent implementation and light documentation checks continue. The interrupted retry
is not an accepted gate. Typecheck/lint remain passed on unchanged tracked inputs.


Pre-integration observation while waiting for the resource window: local master advanced to
`f1e138842722b760b043d1d9f1f88f516938e8b7` with Phase-4.1 planning, roadmap-parser/schema, binding-test and documentation changes.
This candidate remains based on `35635a04e16e9c3cf1e99b16d4963752a18c616a`; no peer work is
consumed and no integration is attempted. Target state must be reverified when assigned.


### Candidate coverage accepted

After operation-names explicitly released all gate children, the exclusive two-worker run
passed: 447 files / 5,657 tests; statements 85.97%, branches 77.78%, functions 89.96%,
lines 88.18%; all configured floors passed. Runner exit 0, 350.684 seconds. The subsequent
suite-size constituent exited 0: 350 unit / 80 architecture / 17 scenario files. Exact logs:
`/tmp/hr-worker-names-candidate-coverage-3.log` and
`/tmp/hr-worker-names-candidate-suite-size.log`. Two observed forks are recorded in
`/tmp/hr-worker-names-candidate-worker-processes-3.json`; all 2,193 tracked input hashes
still match `738914e5cc384f9afdc0d0caa56c4791402d8be4`, excluding only this evidence owner.

The previously timed-out lifecycle SQL guard passes in this exclusive window without
source/assertion/deadline changes. Candidate typecheck and lint also exited 0 in the
sequential final run (`/tmp/hr-worker-names-candidate-{typecheck,lint}.log`). Full parity
uses the wrapper's supported `--workers=2` flag with unchanged authority configuration,
retries, timeouts, membership and baselines. Review and integration are not yet accepted.


### Frozen candidate awaiting independent review

- Implementation commit: `ea97d89679f12636a669d95f799a5a73deaa0ced` (22 changed paths),
  against base `35635a04e16e9c3cf1e99b16d4963752a18c616a`.
- Approved plan remains `44460e2b65051a23d1a9584ac350c665d2da9985`. This recording-only
  commit adds the 23rd reviewed path, this owner. R1 reviews the complete base-to-evidence
  range, with implementation and evidence commits distinguished. No proof row is excluded.
- Branch/checkout remain `codex/worker-names` at
  `/Users/julianhein/Projects/hr-worktree-worker-names`. All gate children exited; the
  temporary adapter is removed. The heavy window was explicitly released to command-groups,
  with operation-names' repair window following it. Independent review starts on a clean,
  frozen checkout, with no writes or test reruns by the reviewer.

| Candidate check | Result | Log under `/tmp/hr-worker-names-` |
| --- | --- | --- |
| `npm run typecheck` | Exit 0 | `candidate-typecheck.log` |
| `npm run lint` | Exit 0 | `candidate-lint.log` |
| Full coverage, resource-only two-worker adapter | Exit 0; 447 files / 5,657 tests, all floors; 350.684s | `candidate-coverage-3.log` |
| `npm exec -- tsx scripts/suite-size.ts` | Exit 0; 350 unit / 80 architecture / 17 scenario | `candidate-suite-size.log` |
| `npm run test:parity -- --workers=2` | Exit 0; 262/262, unchanged baselines; 118.381s | `candidate-parity.log` |
| Manifest / catalog / roadmap freshness | All exit 0 after generation; outputs unchanged | `candidate-manifest.log`, `candidate-catalog.log`, `candidate-roadmap.log` |
| Documentation / instruction twins / chain size | Exit 0; nine equal pairs, maximum chain 16,650 bytes | `candidate-docs.log` |
| Whitespace and input identity | Clean full/staged diff; all 2,193 frozen tracked hashes unchanged except this owner | `candidate-inputs.json` |
| Native reviewer policy | Valid Astra/high role configuration | `review-role-check.log` |

Tests and normative contracts belong to implementation commit `ea97d8967`. D191 permits
code-gate reuse for this evidence-only commit: the input hash comparison includes all source,
tests, scripts, configuration, dependencies, generated files, contract documents and parity
baselines; only this side-plan evidence owner differs from tested tree
`738914e5cc384f9afdc0d0caa56c4791402d8be4`. Scoped documentation/link/whitespace checks repeat
for the evidence commit. No runtime rerun or independent review is claimed by recording.

R1 is a single complete fresh `sup_review`, covering P1–P7, all changed paths and transitive
consumers. The supervisor must wait for its verdict, repair any required finding, rerun
applicable gates and obtain renewed acceptance. S6 delivery, operator-assigned integration
and owned branch/worktree cleanup remain open. The actual operator database has not been
converted and no push occurred.


### Independent R1 acceptance and candidate delivery — 2026-09-08

- Reviewer: fresh read-only `sup_review`, task `/root/sup_review_worker_names_r1`, Astra/high;
  no implementation history, no delegation, no edits or write-producing validation.
- Verdict: **PASS**, with no material findings or unresolved acceptance gaps. Complete review
  covers all 23 paths (8 source, 9 tests, 6 documentation) and P1–P7 without exclusions.
- Exact reviewed candidate: `4cfeedd2aa4d842247d9a0c7026e8e3e8e1371cf`; implementation
  `ea97d89679f12636a669d95f799a5a73deaa0ced`; base
  `35635a04e16e9c3cf1e99b16d4963752a18c616a`. Approved plan remains
  `44460e2b65051a23d1a9584ac350c665d2da9985`.
- The reviewer inspected the complete diff, surrounding implementations, relevant callers,
  tests and owning contracts. It independently checked Git inventory, clean branch/root/HEAD,
  plan ancestry, 2,193 input hashes, local links and whitespace. Gate logs were inspected;
  no independent gate rerun is claimed.
- Parent artifact verification also found every tested input unchanged, all retained gate logs
  present, no owned gate process, and no temporary adapter in the checkout. Log SHA-256s and
  candidate identity are retained in `/tmp/hr-worker-names-r1-artifact-seal.json`.

| Acceptance | Result |
| --- | --- |
| P1–P2 | Fresh/stopped-upgraded schema and complete row/settings/credential preservation accepted |
| P3 | Worker lifecycle, generation fencing, pools and Duo lock semantics accepted |
| P4–P5 | Historical/current backup compatibility, restore, refusals and interruption settlement accepted |
| P6–P7 | Current consumers, unchanged wire identities and Start request/consumption semantics accepted |
| Required candidate gates | Accepted results in the candidate table above; unchanged tested input tree `738914e5cc384f9afdc0d0caa56c4791402d8be4` |
| S1–S5 | Complete, with zero required R1 repairs |
| S6 delivery | Reviewed candidate returned for assigned integration; whole-task completion remains open |

This final recording changes only this evidence owner. Under D191, code gates and R1 remain
bound to the exact reviewed implementation and unchanged inputs; scoped instruction/link/
whitespace checks repeat before the recording commit. The recording commit does not claim a
new runtime run or a review of a changed implementation.

Integration is unassigned. Preserve `codex/worker-names` and
`/Users/julianhein/Projects/hr-worktree-worker-names` until the operator chooses integration
ordering with the independently developed command-groups and operation-names candidates.
Reverify local master, active ownership and all candidates; reconcile later unreleased migration
numbers and historical adapters, integrate with `--no-ff`, run required integrated-input gates,
and renew review for behavioral conflict fixes. Then remove only this task's integrated branch
and worktree. No push, actual database application or workflow execution occurred.

### Delivery assessment

The approved assignment retained one local implementer and one complete reviewer. Observed
review count is one initial complete R1, with zero required review repair rounds and no reviewer
resizing or compaction. The supervisor used context continuations without splitting ownership.

- **Implementation defects during iteration:** newly historical schema admission, schema-35
  journal grammar and schema/floor test/type pins were incomplete in early attempts. The plan
  already covered these boundaries; focused failures identified them and the final proofs/gates
  passed after repair. A single pre-edit checklist of closed schema unions, historical mappings
  and pin owners could have prevented these omissions. They are not planning omissions.
- **External/prerequisite change:** explicit parallel successor work and the advancing primary
  branch changed integration/resource conditions. Independent candidate ownership was preserved;
  later integration remains operator-assigned. This task's product scope did not expand.
- **External resource contention:** the four-worker coverage attempt timed out two architecture
  checks; an initial two-worker retry was interrupted to release the shared gate window. The
  exclusive two-worker run passed unchanged assertions, membership, isolation, floors and
  deadlines. Earlier stale-input compiler/linter attempts were explicitly stopped. Recorded logs
  distinguish failed/aborted runs from accepted results; total avoidable elapsed cost is unknown.
  Earlier process/resource coordination and the demonstrated resource-only adapter could have
  avoided these repeated gate attempts without weakening acceptance.

No evidence supports a blanket quality score or estimated time saving. The observed focused
iterations, aborted gates and accepted complete gates remain the authoritative delivery record;
mandatory future integration gates are separate from this iteration rework.


### Assigned combined integration — 2026-09-08

The operator's **“do it”** assigns S6 integration and cleanup. This task yielded shared-target
ownership to the command-groups task. The [combined integration record](../command-groups/README.md#assigned-combined-integration--2026-09-08)
binds the exact three candidates, primary base, isolated integration branch, migration order,
gates, repairs, independent review and cleanup. Original rejection/repair and accepted-candidate
evidence above is retained. Final numbering is worker 35, operation 36, command groups 37, with
stopped-upgrade floor 36. The complete combined candidate passed fresh independent review at `445fe42451b85701b805ceb98f5e5b1aa8d8440d`; master integration and cleanup follow the combined owner record.
No operator database conversion, unrelated timeline implementation or push is included.


### Integrated completion — 2026-09-08

The combined owner records fresh complete review PASS at `445fe424`, full gates
(5,761 tests, 262 parity cases, typecheck/lint and freshness), and accepted local master
merge `1c8e294fe3510969c3a0f27dcf3506b922e4e42b`. This assignment's exact clean,
inactive candidate checkout and branch were removed after ancestry verification; physical
path and ref absence passed. The observer task remains visible by its explicit request.
See the [combined closeout](../command-groups/README.md#accepted-local-integration-and-cleanup--2026-09-08)
for exact candidate, review, integration and cleanup bindings. No push or database conversion.
