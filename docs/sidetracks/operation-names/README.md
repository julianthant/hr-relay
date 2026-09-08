# Operation table names

## Approved assignment and status

**Task `side/operation-names`: approved planning; implementation WAITING ON accepted
integration of `side/command-groups`.** This file owns the assignment, not a roadmap phase.

On 2026-09-08 the operator proposed `run_operations` and `operation_outbox`, discussed
`run_attempts`, and accepted the recommendation `run_operation_attempts` with “okay do that”
after an explanation of its relationship to workflow-run attempts. The ongoing session is
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
- [Command/delegation plan](../command-groups/README.md) must be independently accepted
  and integrated first. It follows [worker/request names](../worker-names/README.md),
  which follows Task 2.6.1-3. These assignments share migrations, registries, historical
  inspection and deletion machinery; consume their integrated results without taking scope.

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

## Execution binding

| Control | Requirement |
| --- | --- |
| Implementer | One supervisor, GPT-6 Astra/high, zero implementation workers. Coupled migration, historical adapters and deletion consumers stay with one author. |
| Review R1 | One fresh read-only `sup_review`, Astra/high, complete pinned candidate and every proof below; no implementation history or delegation. Maximum two active agents including supervisor. |
| Checkout | Create branch `codex/operation-names` and `/Users/julianhein/Projects/hr-worktree-operation-names`. Both absent at planning inspection; recheck availability, ownership and the four-worktree ceiling before creation. Planning creates neither. |
| Planning baseline | `46892ab3704526feb2c8af80e2317e39e97bde36`, local master. This is inspected evidence, not an implementation base satisfying the prerequisite. |
| Execution base | Resolve the actual accepted integration SHA from `side/command-groups`; verify predecessor review/gates/integration and its prerequisite chain. Select and record a local master SHA containing that integration and this entire approved plan commit. Do not invent a future SHA or substitute uncommitted files. |
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
- Prerequisite: `side/command-groups` has no verified accepted implementation/integration;
  this successor is **WAITING ON** that result, not ready to launch.
- S1–S5, P1–P6, implementation, independent review, integration and cleanup remain open.
- Relationship investigation: initial source finding recorded above; no FK design selected,
  no relationship implementation authorized, and no populated case reproduced.
- Planning validation (2026-09-08): roadmap document-binding guard passes 23 tests;
  `npm run lint` exits 0 with zero warnings; `npm run roadmap:check` reports fresh output.
  Ten plan links/anchors and both contract backlinks resolve; all named test selectors
  exist. Nine instruction pairs are identical and project chains stay below 32,768 bytes.
  All S1–S5/P1–P6 controls are retained; both earlier rename plans remain byte-identical
  to planning baseline `46892ab3704526feb2c8af80e2317e39e97bde36`. Whitespace checks pass.
  Only this plan and its write-safety/decision amendments change. Typecheck, full coverage,
  parity and implementation review are unrun; no product-gate evidence is claimed or reused.

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
