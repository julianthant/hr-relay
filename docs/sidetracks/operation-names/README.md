# Operation table names

## Approved assignment and status

**Task `side/operation-names`: candidate implemented, gated and independently reviewed on an isolated parallel branch; combined integration assigned; integration review and cleanup remain open.** This file owns the assignment, not a roadmap phase.

On 2026-09-08 the operator proposed `run_operations` and `operation_outbox`, discussed
`run_attempts`, and accepted the recommendation `run_operation_attempts` with “okay do that”
after an explanation of its relationship to workflow-run attempts. That session was
planning only, with three changes per plan. This records those three renames and the separately
requested investigation of stronger run linkage. It does not authorize implementing that
relationship, applying a migration to the operator database, or launching another task.

| Change | Current table | Approved name |
| --- | --- | --- |
| 1 | `write_intents` | `run_operations` |
| 2 | `write_attempts` | `run_operation_attempts` |
| 3 | `durable_outbox` | `operation_outbox` |

An operation is one specific external write, not the entire workflow. Its attempts record
individual fenced submission efforts. The outbox delivers local ledger/timeline records
after confirmed writes; it does not submit another external transaction. Operations may
span workflow retries. A workflow attempt remains its own `workflow_runs` row, with the
existing envelope attempt and retry lineage; do not create a `run_attempts` table.

## Authorities, prerequisites and scope

- [Root instructions](../../../AGENTS.md) and [document routing](../../README.md).
- [Write safety, operation naming amendment](../../rebuild/reference/write-safety.md#operation-table-names)
  owns these names and unchanged fencing, settlement, recovery and outbox semantics.
- [Dashboard surfaces](../../rebuild/reference/dashboard-surfaces.md), D308/D330/D332,
  owns deletion/tombstones, storage presentation and upgrade admission.
- [Clock/config/secrets](../../rebuild/reference/clock-config-secrets.md), D321/D322/D331/D332,
  owns settings coupling, explicit verified backup and safe upgrade.
- [Guards and tests](../../rebuild/reference/guards-and-tests.md), §3.14 D191 and §5.2,
  owns gates, historical immutability and conversion proof.
- [Operating reference](../../../.agents/skill-library/repository-work/REFERENCE.md),
  [roadmap governance](../../roadmap/roadmap.md) D344, and nearest module instructions
  govern execution and integration. Read scoped lessons before editing.
- [Command/delegation plan](../command-groups/README.md) was originally sequenced first;
  the parallel execution amendment below supersedes that launch prerequisite. Its original
  predecessor is [worker/request names](../worker-names/README.md),
  which follows Task 2.6.1-3. These assignments share migrations, registries, historical
  inspection and deletion machinery; reconcile shared integration inputs without taking peer scope.

Own the new migration and current table/record registries in `src/infra/sqlite/`; current
authority queries, integrity checks, SQL foreign keys, indexes and triggers; the schema-aware
historical/current backup reader in `src/infra/compat/backup-inspection.ts`; current table-name
consumers in `src/domain/authority.ts`, `src/domain/run/deleted-run.ts`, command deletion
accounting and narrowly affected run-detail/queue read models; corresponding tests, guards,
current references and affected generated outputs. Rename SQL identifiers and their actual
current-table labels, not every use of the words intent, attempt or durable.

Preserve repository method names, domain type names, wire fields, stored JSON property names
(including `writeIntentId`, `writeAttemptId`, `runId`, `runAttempt`), event names, idempotency
keys, binding proofs and historical fingerprints. Those are not additional rename assignments.
Current deletion receipts name the renamed tables; old receipts retain their original names
and bytes and remain readable. Update presentation readers to interpret both explicitly.
No new UI, bulk changes, delegation activation, retry behavior, relationship constraint,
public API redesign, alias tables/views, UNKNOWN-submit retry, legacy runtime access or cutover.

## Inspected feasibility and separate relationship finding

Planning inspected source, contracts, tests, Git and sanitized read-only target metadata.
No product tests, conversion, external workflow, browser action or backup creation ran.

| Question | Evidence and required treatment |
| --- | --- |
| Where is the relationship enforced? | `src/infra/sqlite/migrations.ts` gives attempts and outbox SQL foreign keys to the operation. Attempts also have a unique operation/generation pair. Preserve these constraints and all trigger protections through the rename. |
| How are run references kept consistent? | `src/core/write-sequencer.ts` copies `envelope.runId` and `envelope.attempt` into operation/attempt records. `WriteFenceInputSchema` in `src/infra/sqlite/write-commit-contracts.ts` validates matching operation/current-attempt IDs, generation, run references and binding proof. `commitWriteAttempt` updates operation, attempt and outbox in an authority transaction. Preserve these checks. |
| Are run links SQL foreign keys? | No. Attempt `runId` and `runAttempt` are in JSON. The two counters describe different scopes: workflow attempt 2 can perform an operation's first attempt. The relationship does not require equal workflow-attempt and operation-generation numbers or equal workflow/operation statuses. |
| Why is stronger linkage a separate design? | The terminal deletion path in `authority-database.ts` writes a `deleted_runs` tombstone, removes operation children based on the operation's current `runId`, then deletes `workflow_runs`. Re-fencing can move the operation's current run reference while retaining previous attempt rows. Inference from these paths: adding a direct RESTRICT foreign key from every historical attempt to `workflow_runs` could block deletion of a former run; cascading could instead discard shared history. This interleaving was not executed in planning and is not claimed as a reproduced defect. |
| What should the follow-up investigate? | Compare direct run FK with explicit deletion rules against a durable run-identity reference that survives deletion; consider whether the duplicated attempt ordinal should be derived or validated. First reproduce cross-run retry/delete cases, inspect archive and D308 requirements, and propose historical backfill and invalid-link detection. Preserve tombstones and released-key semantics. No option is selected or authorized here; no fourth implementation change. |
| Does a rename affect historical admission? | `backup-inspection.ts` has literal old-table pending counts and strict registries/schema fingerprints. Current queries must use new names while each admitted historical version retains its old tables, records, counts and fingerprint algorithm. Do not alter released migration definitions. |
| Does it affect deletion and read models? | The cascade and removed-table tally use all three names; presentation uses the operation count to explain released idempotency keys. Preserve transactional deletion, trigger admission, new receipt accuracy and historical receipt interpretation. Pure SQL replacement without consumer updates is insufficient. |

Actual target observed read-only at `2026-09-08T17:11:18.538886+00:00`:
`/Users/julianhein/Projects/hr-automation-rebuild/.tracker/state.db`, schema 33;
12 workflow runs and zero rows in each of the three affected tables; quick check `ok`,
zero foreign-key violations. The missing-run and mismatched-attempt counts were zero on
the empty attempt table, which proves nothing about populated relationship integrity.
Populated synthetic historical fixtures are mandatory. Recheck volatile target facts before
any later explicitly assigned application; this observation is not conversion admission.

## Operator execution amendment — 2026-09-08

The operator explicitly directed “no do in parallel” after the predecessor dependency was
reported. This supersedes the sequential launch prerequisite below. Implement operation names
independently from committed local master `35635a04e16e9c3cf1e99b16d4963752a18c616a`,
which contains approved plan `54cc017916f00db7e836999afdf261bd25b28b54` and accepted
Task 2.6.1-3. Do not implement worker/request or command/delegation changes here.

The owned checkout is `/Users/julianhein/Projects/hr-worktree-operation-names`, branch
`codex/operation-names`. Admission found three existing checkouts; this is the fourth.
This candidate starts with schema 34 and appends its own schema 35 migration. Parallel
candidates may append the same next version and touch the same registries: before assigned
integration, reconcile the unintegrated migration's version and digest against whichever
candidate lands first, preserve every released migration, merge explicit historical adapters
and table registries, and rerun required gates and review of material reconciliation changes.
Either candidate can be independently tested against this base; no unmerged peer code is used.
Integration remains operator-assigned; database application remains a separate assignment.
The one-author implementation and fresh R1 review requirements remain unchanged.

## Execution binding

| Control | Requirement |
| --- | --- |
| Implementer | One supervisor, GPT-6 Astra/high, zero implementation workers. Coupled migration, historical adapters and deletion consumers stay with one author. |
| Review R1 | One fresh read-only `sup_review`, Astra/high, complete pinned candidate and every proof below; no implementation history or delegation. Maximum two active agents including supervisor. |
| Checkout | Create branch `codex/operation-names` and `/Users/julianhein/Projects/hr-worktree-operation-names`. Both absent at planning inspection; recheck availability, ownership and the four-worktree ceiling before creation. Planning creates neither. |
| Planning baseline | `46892ab3704526feb2c8af80e2317e39e97bde36`, local master. This is inspected evidence, not an implementation base satisfying the prerequisite. |
| Execution base | Operator parallel amendment: `35635a04e16e9c3cf1e99b16d4963752a18c616a`, containing the approved plan and accepted Task 2.6.1-3. Worker/request and command/delegation integrations are not launch prerequisites for this isolated candidate. |
| Integration | Local master at `/Users/julianhein/Projects/hr-automation-rebuild`, only when operator-assigned under D344 after R1 PASS and required gates. Serialize shared-target changes; no automatic merge or push. |
| Finalization | Verify stable candidate and target ownership, assigned `--no-ff` merge, required integration gates, and renewed review for behavioral conflict fixes. Record actual SHAs and remove only owned integrated branch/worktree from a safe checkout. Never delete primary or peer resources. |

## Ordered steps and acceptance

1. **S1 Admission:** verify committed approval, prerequisite integration, actual base, ownership,
   current schema and module instructions; create the dedicated checkout and record bindings.
2. **S2 Conversion:** add a new migration for all three names; update current schema registries,
   constraints and SQL consumers with explicit historical adapters. Preserve stored row bytes,
   IDs, proofs, statuses, generations and outbox projection states. Test populated conversion
   and historical backup admission before accepting the migration.
3. **S3 Consumers and proof:** update deletion/current receipt names and old/new read models;
   verify fencing/recovery/projectors and doctor/backup counts. Update current documentation,
   pending markers and generated outputs. Keep frozen history and previous plans unchanged.
4. **S4 Candidate and review:** run gates, commit exact paths by logical category, freeze the
   candidate and obtain complete R1 review with plan/base/head/tree and proof evidence. Fix
   and re-review required findings; no self-approval.
5. **S5 Integration and cleanup:** hand back the accepted candidate with remaining integration;
   after operator assignment integrate, gate, record completion and clean owned resources.
   Until then report the assignment as awaiting integration, not complete.

| Proof | Required result and forbidden effects |
| --- | --- |
| P1 Fresh and migrated shape | Exactly the three new current tables; no old current alias tables/views. Existing operation/attempt/outbox foreign keys, unique key/generation rules, indexes, no-delete/tombstone triggers and JSON/SQL mirror validation remain effective. Invalid references and duplicate generations still fail. |
| P2 Populated preservation | Compare all keys and record JSON bytes before/after with fixtures covering observed-present operations without attempts, attempting/committed/retryable/parked operations, multiple generations across runs, and pending/projected outbox states. Unrelated tables/settings remain intact. Historical deletion receipts remain byte-identical; new receipts use accurate current names. |
| P3 Write and replay semantics | Existing real sequencer/repository tests retain pre-click durable fencing, matched run/binding proof, rollback on partial local commit, safe retry generation increments, committed-key reuse after restart, parked/UNKNOWN refusal and zero write rows for dry-run. Rename adds no external submission or new retry permission. |
| P4 Outbox and consumers | Local ledger/timeline projection, restart replay and projection accounting remain correct without duplicate delivery effects. Current storage doctor/backup/run-detail/queue readers find new tables and interpret old/new deletion tallies. Pending rows must not vanish into zero/default counts. |
| P5 Upgrade and historical recovery | Every admitted old/current backup version validates with its original grammar and fingerprint. Rehearsal is read-only; stale/missing backup, changed source, unknown schema/table and corrupt records refuse before application. Test transactional interruption, post-conversion settlement recovery, exact resume, no-write settled rerun and restore drill. No historical migration rewrite or settings/database divergence. |
| P6 Delete and transitive regression | Existing D308 tombstone-first cascade, ownership and deletion admission remain unchanged, including populated operation children and historical receipts. Run-link strengthening is excluded. Full parity passes without baseline changes; no API/event/JSON identity rename. Old SQL names remain only where explicitly historical or compatibility-facing. |

Material changes to retained identity, deletion/retention, historical admission, relationships,
scope or ownership return for amendment. Ordinary implementation fixes within these bounds
remain with the supervisor. The separate relationship finding is not a prerequisite or
permission to redesign deletion during this rename.

## Gates, resources and later database application

Focused iteration selectors, all existing at planning inspection:

- `npm run test -- tests/unit/sqlite-authority-database.test.ts tests/unit/write-safety-contracts.test.ts tests/unit/write-sequencer.test.ts tests/unit/write-sequencer-restart-no-repeat.test.ts tests/unit/write-recovery.test.ts tests/unit/dry-run-write-safety-counts.test.ts`
- `npm run test -- tests/unit/ledger-projector.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-upgrade.test.ts tests/unit/storage-restore-drill.test.ts`
- `npm run test:architecture -- tests/unit/architecture/atomic-write-outbox.test.ts tests/unit/architecture/write-safety-contract.test.ts tests/unit/architecture/migration-history-immutability.test.ts`

Add necessary regression cases at the actual boundaries for P1–P6. Run lint when tests run.
Focused checks inform iteration, not additional duplicate runs after unchanged full coverage.

| Boundary | Required checks |
| --- | --- |
| Implementation commit/candidate | `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run test:parity`, affected generated/document checks, `git diff --check`. Record exact tested SHA/tree, commands/exits, proof map, effective worker settings and logs. |
| Material integration | Same full gates on actual integrated inputs; re-review behavioral conflict fixes. |
| Generated inputs | Regenerate affected manifests/catalog/roadmap via `npm run build:manifest`, `npm run stores:catalog`, `npm run roadmap`, followed by corresponding `:check`. Inspect descriptor import closure even for comments. Never hand-edit generated output. Guard additions/retirements update guard inventory with deciding evidence. |
| Planning/recording | Applicable link and instruction-pair/chain checks, affected document guards/generated freshness and whitespace checks under D191. No runtime PASS claim from a rename plan; reuse requires original tested identity/result and verified unchanged relevant inputs. |

Use installed runner/configuration and at most four effective file workers. Verify resolved
project settings when inputs change; do not weaken membership, isolation, floors, assertions
or timeouts. Keep coverage free of this task's compiler/linter contention. Independent
typecheck/lint/freshness may overlap within verified resources; generation precedes checks.
Serialize mutable coverage/parity output and shared-target operations; preserve peer processes.

Actual operator database application is a separate explicit assignment after accepted
integration. Recheck exact executable SHA, rebuild target, schema, permissions, locks and
settings/database coupling. Stop only authorized rebuild processes, create and verify
`npm run cli -- storage backup --json`, rehearse with
`npm run cli -- storage upgrade --plan --json`, apply with
`npm run cli -- storage upgrade --json`, then run
`npm run cli -- storage doctor --json` and sanitized row/identity preservation checks.
The new converter's actual-target preflight must pass before effects. Do not start workers
or perform HR writes to verify a storage rename.

## Progress and handoff

- Approved naming/planning: 2026-09-08, “okay do that.”
- Launch prerequisite superseded by the operator execution amendment above. S1–S4 are accepted on the recorded isolated branch. S5 assigned integration, migration-number reconciliation and cleanup remain open.
- Relationship investigation at planning: initial source finding recorded above; no FK design selected,
  no relationship implementation authorized, and no populated case reproduced.
- Planning validation (2026-09-08): roadmap document-binding guard passes 23 tests;
  `npm run lint` exits 0 with zero warnings; `npm run roadmap:check` reports fresh output.
  Ten plan links/anchors and both contract backlinks resolve; all named test selectors
  exist. Nine instruction pairs are identical and project chains stay below 32,768 bytes.
  All S1–S5/P1–P6 controls are retained; both earlier rename plans remain byte-identical
  to planning baseline `46892ab3704526feb2c8af80e2317e39e97bde36`. Whitespace checks pass.
  Only this plan and its write-safety/decision amendments change. Typecheck, full coverage,
  parity and implementation review are unrun; no product-gate evidence is claimed or reused.

### Execution evidence — initial candidate

- Base: `35635a04e16e9c3cf1e99b16d4963752a18c616a`; original approved plan:
  `54cc017916f00db7e836999afdf261bd25b28b54`; parallel override: operator “no do in parallel”.
- Checkout/branch: `/Users/julianhein/Projects/hr-worktree-operation-names`, `codex/operation-names`.
  Schema 35 is provisional until assigned integration reconciles any earlier parallel migration.
- Append-only migration renames the three tables and their table-prefixed indexes/triggers.
  All released v1–v34 statements/digests remain unchanged. Current authority/record registries,
  SQL consumers, current backup counts and deletion tallies use the new names. Repository/type/
  JSON/event identities remain unchanged. Historical registries, grammar, invariant queries and
  fingerprint order retain old names; old deletion receipts remain readable and byte-identical.
- The new populated fixture independently replays v34 and contains five operation states,
  multiple generations across workflow runs, pending ledger and projected span outbox rows,
  terminal runs and a settled historical deletion receipt. The baseline reader at the base SHA
  produced fingerprint `2fc06e2ed8866535acad0ba9850200dbc34d2ea28e67fea2126f764f2c0ad71b`;
  the new reader is pinned to it. Counts are three unresolved operations and one pending outbox.
- Focused conversion suite: 12/12 passed (`/tmp/operation-names-regression-final.log`). Expanded admission suite: 48/48 passed,
  including every admitted historical schema and corrupt record families
  (`/tmp/operation-names-admission-final.log`).
- Manifest/catalog/roadmap generation and corresponding freshness checks passed; generated bytes
  are unchanged. The docs audit passes identical instruction pairs and chains below 32,768 bytes.
  Logs: `/tmp/operation-names-{manifest,catalog,roadmap,doc-audit}.log`.
- Full coverage passed on tree `2653398a08f500b0858db8c091a000136c347a6c`: 448 files,
  5,681 tests; statements 85.97%, branches 77.79%, functions 89.96%, lines 88.19%; all floors
  and suite-size checks passed. Exact command: `npm exec -- tsx scripts/test-runner.ts run
  --coverage --config .operation-names-vitest.mts` followed by `npm exec -- tsx scripts/suite-size.ts`.
  Logs: `/tmp/operation-names-coverage-two.log`, `/tmp/operation-names-suite-size.log`.
  This is the complete `test:coverage` gate with only the approved resource cap changed.
- The initial standard four-worker coverage attempt failed only two unchanged 30s architecture
  deadlines (47.849s and 41.383s); 5,679 other tests passed. Cross-task memory pressure was
  observed, peers yielded the heavy-gate window, and full coverage was rerun at two effective
  workers for every project. The formerly timed-out cases passed at 24.284s and 23.314s.
  No timeout, assertion, membership, isolation or floor was changed. Original failure log:
  `/tmp/operation-names-coverage.log`. The temporary adapter imports the real config and asserts
  structural equality after removing worker caps. Its retained copy is
  `/tmp/operation-names-vitest-adapter.mts` (SHA-256
  `e4636be7471b5156f3be9196da9f6f8a1f352e46ad0d09d6a8ea76ffc73405b7`), and resolved configuration
  is `/tmp/operation-names-workers-two.log`. The checkout adapter was removed after coverage.
- `npm run test:parity -- --workers=2`: exit 0, all 262 cases passed; screenshot/a11y baselines
  remain byte-identical. Log: `/tmp/operation-names-parity.log`. It tested the same product tree.
- Final `npm run typecheck` and `npm run lint`: exit 0 on unchanged product inputs;
  logs `/tmp/operation-names-typecheck-release.log` and `/tmp/operation-names-lint-release.log`.
  The evidence-only difference from tested tree `2653398a08f500b0858db8c091a000136c347a6c`
  is this task record. Final document-binding guard: 23/23 tests; roadmap freshness, ten plan
  links/anchors, instruction-pair/chain audit and whitespace checks passed. Logs:
  `/tmp/operation-names-doc-guard.log`, `/tmp/operation-names-roadmap-final.log`,
  `/tmp/operation-names-doc-audit-final.log`.
- Initial candidate status at submission: **awaiting independent R1 review**. The implementation commit containing
  this record is the pinned candidate; its parent is the recorded execution base. The reviewer
  receives the full base/head/tree and proof map. All owned gate processes have exited, the
  temporary configuration is removed, and the heavy-gate window is released to worker-names.
  Reviewed acceptance, operator-assigned integration and owned cleanup are still outstanding.
  No operator database migration, HR workflow, live write, integration or push was performed.

| Proof | Evidence boundary |
| --- | --- |
| P1 | `operation-names.test.ts`: FK, generation uniqueness, permanent-key and whole-trigger preservation; existing SQLite registry and migration-history guards. |
| P2 | Populated v33/v34 conversion compares every full SQL row and JSON byte, multi-run attempts and old tombstones; existing settings-preservation upgrade fixtures. |
| P3 | Existing sequencer, restart/no-repeat, recovery, dry-run and atomic-commit suites through renamed repository SQL; full coverage passed. |
| P4 | New current/historical pending counts and repository reads; existing ledger-projector, backup, storage doctor and read-model suites; full coverage passed. |
| P5 | Pinned baseline fingerprint; all admitted old schemas; strict historical/current corrupt-record refusal; read-only rehearsal; mid-DDL rollback; before/after-commit interruption, resume and settled rerun; existing restore drill and refusal suites. |
| P6 | Current deletion tallies with preserved historical receipts; cross-run attempt retention follows the operation's current owner; existing D308 service/cascade tests; full parity passed without baseline changes. |

Discovery: the baseline does not have a never-delete trigger on each of the three operation
tables. Its ledger-projection trigger joins outbox, operation and tombstone. The implementation
preserves every baseline trigger and FK, and tests the exact trigger set after identifier mapping;
it does not add a new deletion rule. An initial test incorrectly assumed per-table triggers and
was corrected against immutable baseline DDL. Fresh/upgrade journal destination unions also needed
schema 35 admission, discovered by focused tests and repaired without removing historical arms.

The supervisor sends **Done / Now / Remaining** at start/resume and after each verified step,
before the next tool call, keeping review/integration/cleanup visible. Record current
plan/base/head, proof/gate identities, findings and next step here. Use `/handoff` only for
interrupted unique recovery state. The operator opens the supervisor task; planning does
not launch it, dispatch siblings or push.

Any later verified launch prompt includes `/supervise side/operation-names`, the absolute
plan path, full approved plan SHA, exact branch/worktree, resolved accepted predecessor/base
and operator-assigned integration condition, plus this side-work adaptation:

> This is an approved side-work assignment. The side plan is the task owner wherever
> /supervise refers to a task/phase section. Record progress, review, gate evidence and
> completion there. Do not create a phase number or mark roadmap tasks complete. Preserve
> repository contracts, independent review, required gates and authorized integration/cleanup
> conditions.


### R1 finding and bounded repair

R1 reviewer `/root/sup_review_operation_names` returned **CHANGES REQUIRED** for complete
candidate `b7a64659ff6a22d958db9c6a476f377430f10e8b`, tree
`ce68bd1e4405c8cd004caf462c120ffaada62ae0`, against the recorded execution base.
All 41 paths and P1–P6 were inspected. One required finding remained: increasing the current
schema to 35 let an unfinished schema-34 settings conversion bypass both the historical
schema-32 refusal and current-version resume. A new conversion could settle schema 35 while
the original credential import remained unfinished. This violates P5 recovery acceptance.

The supervisor reproduced this with the released baseline converter: a synthetic v29 source
was interrupted after its v34 SQLite commit, before credential settlement. The candidate then
reported `converted` with `credentials=empty`, appended a settled v35 journal, and left credential
revision 1. Baseline source equality to the accepted base was asserted. Harness/output:
`/tmp/operation-names-pending-repro.mjs`, `/tmp/operation-names-pending-repro.log`.

The bounded repair extends the existing original-build recovery refusal to every admitted
historical schema from 32 through the version before current. Current-version exact resume is
unchanged. Regression cases for schemas 32/33/34 cover plan and apply refusal, unchanged database,
credential and source bytes, and no runtime-lock creation. Before the repair, v33/v34 failed with
`Missing expected rejection`; afterward all 39 upgrade/operation-name cases passed. Logs:
`/tmp/operation-names-r1-red.log`, `/tmp/operation-names-r1-green.log`. The released-v34 harness
also passes both refusals with byte preservation (`/tmp/operation-names-pending-fixed.mjs`,
`/tmp/operation-names-pending-fixed.log`). No operator data was used.

Repair gates passed on tree `1e3aa3d89489c7df9c825009260461748442b260`:

| Gate | Result and evidence |
| --- | --- |
| `npm run typecheck` | Exit 0; `/tmp/operation-names-r1-typecheck.log`. |
| `npm run lint` | Exit 0; `/tmp/operation-names-r1-lint.log`. |
| Full coverage with the same two-worker adapter recorded above | Exit 0; 448 files, 5,683 tests; statements 85.97%, branches 77.79%, functions 89.96%, lines 88.19%; all thresholds pass. `/tmp/operation-names-r1-coverage.log`. |
| `npm exec -- tsx scripts/suite-size.ts` | 351 unit, 17 scenario, 80 architecture files; `/tmp/operation-names-r1-suite-size.log`. |
| `npm run test:parity -- --workers=2` | Exit 0; 262/262 cases; unchanged screenshot/a11y baselines. `/tmp/operation-names-r1-parity.log`. |
| Manifest/catalog/roadmap freshness and instruction audit | Exit 0; `/tmp/operation-names-r1-{manifest,catalog,roadmap,doc-audit}.log`. |

The full coverage command remains `npm exec -- tsx scripts/test-runner.ts run --coverage
--config .operation-names-vitest.mts`; the adapter hash and unchanged effective settings are
recorded with the initial gates. The adapter was removed after coverage. All product inputs
were identical to the tested tree at gate completion; subsequent evidence recording changes only
this owner document. Final document-binding guard passed 23/23 tests
(`/tmp/operation-names-r1-doc-guard.log`); final instruction audit and whitespace checks passed.
Earlier product results above remain the initial candidate's evidence.

The reviewer remains independent, has not compacted, and confirmed capacity for the bounded
repair and neighboring recovery paths. Renewed review passed on the repair commit identified below. Both parallel peers independently report the same generalized refusal; assigned
integration must coalesce it. The shared gate window was released back to command-groups after
all owned processes exited. No operator data was used or modified.

### Delivery assessment (candidate)

The operator changed execution sequencing to parallel work; product scope and the one-author/
one-reviewer allocation stayed intact. Focused iteration corrected a missed schema-version union,
current-version test expectations and a fixture's mistaken assumption about per-table delete
triggers. These are implementation/test repairs within the approved plan, not added product scope.
One full coverage attempt failed due to two deadlines under evidenced cross-task contention; one
complete retry with two workers and a shared gate window passed. Future execution should inventory
all destination-version unions and pin the baseline trigger set before writing migration tests.
No assignment resizing or supporting implementation worker was used. Initial R1 found the pending
historical conversion boundary missing from the proof; the supervisor reproduced and repaired it.
Repair gates and renewed independent review passed; assigned integration and cleanup remain open.
The accepted correction retained original-build recovery, avoiding a new credential-resumption
protocol. Future schema bumps should include unfinished prior-version upgrade journals in their
historical fixture matrix, alongside same-version retry tests.


### Accepted candidate and next assignment

R1 reviewer `/root/sup_review_operation_names` returned **PASS** after bounded correction review:

| Identity / acceptance | Verified evidence |
| --- | --- |
| Execution base | `35635a04e16e9c3cf1e99b16d4963752a18c616a` |
| Accepted implementation HEAD | `353c579b103948475ed7d08e34e3f25b42c00057` |
| Accepted tree | `efbc0f027008f3788c6f1facfd935c00c26e123e` |
| Complete review scope | 42/42 paths: 12 production, 22 tests, 3 instructions, 4 docs/owner, 1 test configuration; P1–P6 satisfied. |
| Finding disposition | Initial R1 pending-historical conversion finding resolved; no unresolved findings. Three repair paths and neighboring recovery boundaries re-reviewed; 39 unchanged paths retain verified initial inspection. |
| Independence | Same read-only reviewer, uncompacted context, no implementation involvement. Supervisor executed gates/harnesses; reviewer inspected primary evidence. |
| Stable review state | Accepted branch, HEAD and tree verified unchanged and clean on return; temporary adapter absent, all owned gates exited. |

This acceptance record and current-reference status updates are documentation-only. They reuse
the exact repair gate tree and accepted implementation above; no source, test, configuration,
dependency or baseline changes accompany recording. Recording checks passed: document-binding guard 23/23, roadmap freshness, ten owner links/anchors,
nine identical instruction pairs and chains below 32,768 bytes, and whitespace validation.
Logs: `/tmp/operation-names-accepted-{doc-guard,doc-audit,roadmap}.log`. The original R1 rejection and repair evidence remain above.

S5 remains **awaiting operator assignment**. Retain branch `codex/operation-names` and checkout
`/Users/julianhein/Projects/hr-worktree-operation-names` until integration. The next assignment is
to reconcile schema migration numbering with accepted parallel worker/command renames, preserve
all released migration bytes and historical registries, coalesce the shared historical-pending
upgrade refusal, integrate to current local master, run required integrated-tree gates and review
material conflict repairs, then remove only the integrated owned branch/worktree. Recheck current
primary ownership and coordinate its mutation window first. Never infer permission to push or to
apply the migration to the operator database. No database application, HR write, push or primary
integration occurred in this task.


### Assigned combined integration — 2026-09-08

The operator's **“do it”** assigns S5 integration and cleanup. This task yielded shared-target
ownership to the command-groups task. The [combined integration record](../command-groups/README.md#assigned-combined-integration--2026-09-08)
binds the exact three candidates, primary base, isolated integration branch, migration order,
gates, repairs, independent review and cleanup. Original rejection/repair and accepted-candidate
evidence above is retained. Final numbering is worker 35, operation 36, command groups 37, with
stopped-upgrade floor 36. Combined integration acceptance and cleanup are still pending.
No operator database conversion, unrelated timeline implementation or push is included.
