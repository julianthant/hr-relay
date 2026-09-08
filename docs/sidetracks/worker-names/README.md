# Worker table names

## Assignment, approval, and status

**Task ID: `side/worker-names`.** This is the single owner of this side-work assignment;
it is not a roadmap phase or a replacement for an admitted phase task.

On 2026-09-08 the operator chose: keep `worker_pools`, rename `leases` to
`workflow_workers`, and rename `duo_ceremony_leases` to `worker_auth`. After the complete
proposal identified the active migration-owner overlap, the operator replied **“approve”**
to this plan, including execution after independently reviewed integration of Task 2.6.1-3.
The operator requested planning only in this session, with implementation in a new session.

**Approved; WAITING ON Task 2.6.1-3's accepted integration and execution-time checkout
capacity verification.** No product implementation, candidate review, integration, or
operator database conversion is complete under this assignment. Planning may save,
validate, and commit this file; it creates no implementation checkout or app task and
dispatches no agents. A launch instruction is conditional until the prerequisite is proven.

| Current table | Approved current-table name |
| --- | --- |
| `worker_pools` | `worker_pools` (unchanged) |
| `leases` | `workflow_workers` |
| `duo_ceremony_leases` | `worker_auth` |

`worker_auth` still represents one expiring Duo authentication lock per credential
identity, shared across workers and systems. It is not a password store, a browser-session
table, or one authentication record per worker. `workflow_workers` retains worker
lifecycle, operator directives, heartbeats, active-run association, and lease generations.
The concepts of a worker lease and a Duo ceremony remain valid internal terminology.

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

Task 2.6.1-3 owns an active change to `migrations.ts`, `authority-database.ts`, table
registries, historical backup inspection, and storage/upgrade tests. Its inspected working
tree was adding schema 34 and retiring `runs_view`. This is overlapping implementation
ownership, not merely a shared reference. Do not consume its dirty files, take its scope,
reserve its migration number, or change its admitted acceptance. This task follows its
reviewed integration. Other unrelated tasks and their resources must be preserved.

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
  coverage mapping; worker/auth SQL reads, writes, accounting, and integrity checks.
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
stored worker/auth record fields, error identities, worker generations, Duo timing, and
authentication scope are not renamed just because they contain the word “lease.” Preserve
released SQL history, including historical trigger/index identifiers; current SQL targets
and diagnostics that actually identify a table must resolve accurately. No compatibility
alias tables or views are introduced.

## Ordered steps and acceptance

1. **S1 — admit and bind execution.** Verify the prerequisite and approved plan, resolve the
   actual base, recheck capacity and ownership, create the dedicated checkout, and record
   branch/base/plan/head before edits. Read changed module instructions and prerequisite
   compatibility contracts. A new schema-owner conflict or unsupported prerequisite change
   returns for amendment, rather than quietly broadening this assignment.
2. **S2 — append the two renames and wire current storage.** Use the next schema version after
   the accepted prerequisite. Preserve historical statement bytes/digests; update registries,
   current queries, integrity/accounting checks, and the stopped-upgrade floor together.
   Keep `worker_pools`, run/batch names, data, and runtime behavior unchanged.
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
| P1 Fresh and upgraded schema | A fresh database has `workflow_workers`, `worker_auth`, and unchanged `worker_pools`; old worker/auth table names are absent from the current schema. Upgrade schema 33 and the accepted prerequisite schema using regenerable synthetic fixtures and the real stopped-upgrade route. Earlier admitted source families remain covered. Existing schemas are not converted by ordinary runtime startup. |
| P2 Data and identity preservation | Compare complete worker/auth rows before and after rename, including record bytes, keys, generations, versions, timestamps, holder, and state. Preserve pool declarations, run identity, settings/journals, independent credential bytes, and batch grouping/revisions. Verify both grouped and separate batches; do not reset all batches to false by replaying migration 33 incorrectly. |
| P3 Worker and auth behavior | Real SQLite repository/service tests prove registration, heartbeat, claim, pause/stop, restart generation fencing, and pool controls. Duo tests prove acquire/release, exclusivity across workers, expiry/takeover, and rejection of superseded holders. Two workers sharing one credential must not acquire overlapping valid authentication turns. |
| P4 Backup and restore | Validate pre-rename historical backups with their original table names and fingerprint ordering; validate current backups with the new names. Exercise the existing restore drill and upgraded readback. Corrupt schema/records, unexpected tables, and identity mismatches refuse rather than becoming empty/default records or weakening historical admission. |
| P5 Upgrade refusals and interruption | At the real upgrade boundary, active processes, absent/stale backup, changed source, unsupported schema, and unresolved earlier conversion refuse with no unauthorized database effects. Prove a valid setup converts. Inject failure before SQLite commit and after commit/before settlement; verify rollback or exact resume as applicable, no duplicate conversion, preserved credentials/settings, and no-write rerun after settlement. Preserve earlier pending-conversion restrictions. |
| P6 Consumer consistency | Current integrity/doctor/count checks read the renamed tables; worker controls and queue/session rendering retain their existing wire semantics. Full parity passes without baseline changes. Source checks allow old names in released history, explicit historical adapters/fixtures, and historical documentation only; do not blindly replace legitimate lease terminology. |

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
- Planning validation (2026-09-08): all 13 local Markdown links resolve; named test
  selectors exist; all six steps and six proof rows are retained. Documentation audit
  passes for nine identical instruction pairs, with every discovered project chain
  below 32,768 bytes. The sole planned change is this side-plan file, outside the
  roadmap scanner's `docs/rebuild` input; no generated/runtime input changes and no
  code-gate rerun or reuse is claimed. Exact staged scope and whitespace are checked
  before commit; the handoff verifies committed contents and named-ref reachability.
- Task 2.6.1-3: not yet verified as reviewed/integrated; this is the implementation blocker.
- Proposed branch/path: absent at planning inspection; primary checkout remains on `master`.
- Capacity observation: three auxiliary worktrees at persistence inspection; recheck the
  repository ceiling and ownership before creating a fourth. Capacity is not reserved.
- S1–S6 and P1–P6: open. No implementation gates, review PASS, integration, or live conversion
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
