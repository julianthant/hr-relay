# Command groups and delegation table names

## Approved assignment and status

**Task: `side/command-groups`. Approved; implementation WAITING ON the accepted integration
of `side/worker-names` and execution-time capacity/ownership checks.** This file is the single
task owner; it does not create a roadmap phase or change phase completion.

The operator approved consolidating bulk requests into parent/child rows in `commands`,
asked for two more changes in the same plan, agreed to keep delegation and dependency
tables separate, changed the proposed dependency name to `delegation_dependencies`, then
said **“okay do it”** on 2026-09-08 after the final three-change list. That is approval to
write this plan in the planning-only session. Implementation belongs to a new supervisor
session; no implementation, independent review, integration, or database application has
occurred under this assignment.

| Change | Approved outcome |
| --- | --- |
| 1 | Move bulk acceptance authority into non-executable parent rows in `commands`; link direct child commands using nullable `parent_command_id`; retire current `bulk_command_acceptances`. |
| 2 | Rename `dependencies` to `delegation_dependencies`. |
| 3 | Rename `delegation_manifests` to `run_delegations`. Keep these two tables separate. |

The existing three-rename [worker/request plan](../worker-names/README.md) is unchanged.
This assignment follows its reviewed integration because both own the same migration chain,
table registries, database adapter, and historical backup machinery. That prerequisite itself
requires Task 2.6.1-3. Do not take either task's scope or dirty files to accelerate this one.

## Authorities and inspection evidence

- [Root instructions](../../../AGENTS.md), [document routing](../../README.md), and
  [operating reference](../../../.agents/skill-library/repository-work/REFERENCE.md).
- [Dashboard surfaces, command-group amendment](../../rebuild/reference/dashboard-surfaces.md#command-group-storage)
  and D235 own bulk behavior and storage consolidation.
- [Frontend/backend integration](../../rebuild/reference/frontend-backend-integration.md),
  section 5.1 and actor/Host/Origin admission, owns unchanged command doors and envelopes.
- [Workflow model, delegation names](../../rebuild/reference/workflow-model.md#delegation-table-names)
  and section 3.2 own delegation manifests, dependency policies, and replay/join semantics.
- [Clock/config/secrets](../../rebuild/reference/clock-config-secrets.md), D331/D332,
  [dashboard surfaces](../../rebuild/reference/dashboard-surfaces.md), D330/D332,
  and [guards/tests](../../rebuild/reference/guards-and-tests.md), sections 3.14 D191 and 5.2,
  own safe upgrade, immutable history, identity, and gates.
- [Server instructions](../../../src/server/AGENTS.md),
  [operator trust](../../rebuild/reference/operator-trust.md), and
  [roadmap governance](../../roadmap/roadmap.md), D344, govern affected consumers and integration.

Planning inspected code, tests, contracts, Git, and sanitized read-only database metadata.
It did not execute product tests, migrate a database, create a backup, run workflows, or
exercise browser controls.

| Consequential question | Evidence and approved response |
| --- | --- |
| What does bulk acceptance bind? | `operator-command-ingress.ts:acceptOperatorBulkCommand` persists the exact ordered request, its fingerprint, and original server acceptance time before child execution. Keep that boundary when moving its repository into `commands`. Parent acceptance does not mean successful execution. |
| How do children replay? | `command-service.ts:deriveBulkChildCommandId` derives identity from bulk ID and run ID. `executeBulk` calls the single-command path per target, returns applied/conflict/refused/errored outcomes, and stops on an untyped error. Preserve those IDs, order, original versions, replay behavior, and unattempted remainder. |
| Are parent IDs already globally unique? | Existing parents and commands live in separate primary-key namespaces. Migration can discover collisions even though neither table is corrupt. Refuse an ambiguous collision before effects; never renumber commands, merge unrelated identities, or drop a parent. New parents use the existing global command-identity protections, including protected credential command identities. |
| Can audits remain unchanged? | `command-kernel.ts` journals an individual command, its state change, and audit transactionally; typed refusals unwind the transaction. Parent acceptance gets no fabricated execution audit. Preserve all existing audit JSON and IDs, including internal lifecycle and historical protected-settings records. |
| Will parents look stuck? | Current and historical `pendingCommands` queries count commands without audits. New current-schema counts must explicitly exclude non-executable bulk parents while retaining genuine individual-command findings. Historical schema-specific inspection keeps its old semantics. |
| How are old children linked? | Derive each candidate child ID using the existing function and validate its entire saved request against the parent's target, type, actor, time, options, and reason. Link only exact existing children. A missing child may have been refused or never attempted; do not invent a command or outcome. |
| What do the delegation tables represent? | `src/domain/dependencies.ts` stores an immutable manifest with the full child set and policy, and separate versioned dependency relationships/states. The SQL dependency references its manifest. Preserve keys, row bytes, fingerprints, policies, foreign keys, audit references, and explicit zero-child manifests while renaming. |
| Is delegation live? | Planning found no registered workflow declaring a child-run producer; executor support is an optional seam. Existing `delegation.test.ts`, the manifest guard, and command/tree fixtures prove the available mechanisms. No production delegation activation is part of these renames. |

Actual rebuild target observed read-only at `2026-09-08T16:47:21.596986+00:00`:
`/Users/julianhein/Projects/hr-automation-rebuild/.tracker/state.db`, schema 33, 424 command
rows, 424 audit rows, zero bulk acceptance rows, zero parent/command key collisions,
SQLite quick check `ok`, zero foreign-key violations. This is dated compatibility evidence,
not current conversion admission. Synthetic populated historical fixtures are mandatory;
the empty actual bulk table does not establish historical migration correctness. Recheck
target identity, schema, source content, permissions, locks, and backup before any later
explicitly assigned operation. Never export credentials or private row contents.

## Data and behavior decisions

1. **One-level command grouping.** A strict stored parent variant holds the accepted bulk
   request and fingerprint; it is not admitted as an executable single-command request.
   `parent_command_id` references `commands.record_key`, is indexed, and is NULL on parents,
   standalone commands, and existing internal lifecycle commands. Only direct bulk child
   commands receive the parent link. No nested bulk parents or arbitrary command trees.
2. **Server-owned linkage.** Keep public single/bulk request and response schemas, routes,
   actor stamping, and stable child ID derivation. Carry validated parent context internally
   to persistence; callers cannot forge membership through a new public field. Require the
   parent to exist, have the correct kind, contain that exact target/request, and match the
   derived child ID. Reject self-links, parent cycles/nesting, different-parent reuse, and
   cross-kind identity collisions before any child effect. Recheck under the write transaction.
3. **Preserve evidence.** Existing individual command/audit JSON and IDs remain byte-identical;
   relational parent metadata does not rewrite old requests or change their replay identity.
   Parents retain the complete historical acceptance content and original fingerprint/time.
   The required stored envelope/discriminator may be new; do not silently change its facts.
4. **Acceptance is not execution.** Commit the parent before children. Keep per-child command,
   lifecycle, and audit transactions. Parent absence means no accepted group; parent presence
   alone proves no child success. No fake success audit, aggregate completion state, automatic
   background resume, or new persisted failure history is introduced. The original selection
   plus child outcomes remains the source of the response. Preserve best-effort mode and
   current all-or-none refusal, including accepted but unexecuted historical parent requests.
5. **Strict migration.** Append the next schema migration after the accepted rename prerequisite;
   do not reserve a future version or edit released statements/digests. Use the stopped upgrade
   with verified backup. A data-aware conversion step may be added in the owning migration/
   compatibility adapter for deterministic child linkage; preserve atomic commit/rehearsal and
   interruption safety. Rehearse complete mapping and detect collisions before effects; drop
   the old current table only after the validated transfer. Keep historical backup admission
   and fingerprint order for old names, without a current alias table/view.
6. **Delegation names only.** Current SQL targets become `run_delegations` and
   `delegation_dependencies`. Do not collapse the records, change graph semantics, rewrite
   row JSON, rename public fields such as `manifestId`/`dependencyId`, or turn this into a new
   child-workflow implementation. Preserve dependency-state transitions and failure/cancel/
   retry/visibility policies, manifest replay equality, zero-child outcomes, and joins.

## Ownership, isolation, and prerequisite binding

| Field | Binding |
| --- | --- |
| Task owner | This file, `side/command-groups`; stable ID includes the two delegation renames. |
| Implementation | One supervisor on GPT-6 Astra/high; zero implementation workers. Coupled schema, identity, historical conversion, and commands stay with one implementer. |
| Review R1 | One fresh read-only `sup_review` on Astra/high, no implementation history, complete candidate and all proofs including both delegation renames. Maximum two active agents including supervisor. |
| Branch and checkout | Create `codex/command-groups` at `/Users/julianhein/Projects/hr-worktree-command-groups`. Recheck absent ref/path, ownership, and the repository's four-worktree ceiling including unrelated work. Do not create the implementation checkout during planning. |
| Verified planning baseline | `b2302c057836254067845c95b75ec9edaca78ef5` on local master. This is inspected evidence, not the execution prerequisite. |
| Required execution base | Resolve the accepted integration SHA of `side/worker-names` from its plan; verify full review/gates/integration evidence and Task 2.6.1-3 ancestry. Select a verified local master commit containing that integration and this entire approved plan commit. Record the actual base and plan SHA before the first edit; never invent a future SHA, cherry-pick dirty files, or bypass a missing prerequisite. |
| Integration | Target local master at `/Users/julianhein/Projects/hr-automation-rebuild`; operator assigns integration under D344. No automatic merge. |
| Acceptance/cleanup | Candidate gates and full R1 PASS, stable exact committed candidate, verified target/ownership, then assigned serialized `--no-ff` integration, required integration gates and renewed review for behavioral conflict fixes. Remove only owned integrated resources from a safe checkout; preserve peers and never delete the primary directory. No push. |

Owned source scope: `src/domain/commands.ts` and authority/record registries; command and
delegation SQL repositories/invariants in `src/infra/sqlite/authority-database.ts`; migrations,
historical backup/upgrade inspection, recovery/doctor counts, and their strict schemas;
`src/server/dashboard/commands/{operator-command-ingress,command-service}.ts`, command-kernel
parent admission, and narrowly required route/composition wiring; exact affected fixtures,
tests, architecture guards, current contracts, decision pointers, and generated outputs.
The stored parent arm must not widen the public single-command union or accidentally admit
parents through lifecycle/settings readers. Preserve frozen historical protected grammars.

Read module instructions and relevant lessons before editing. Recheck new ownership after
the prerequisite. Tactical fixes stay with the supervisor; no supporting implementers,
sibling dispatch, or recursive fix agents. If the complete candidate cannot fit R1's scope,
amend allocation before dispatch; partial review is not acceptance.

## Ordered execution and proof

1. **S1: admission.** Verify approved plan/base/prerequisites, capacity and ownership, then
   create the dedicated checkout and record actual bindings. Confirm current schema and
   upgrade adapter after prerequisite integration. A material conflict returns for amendment.
2. **S2: storage and historical conversion.** Add parent-aware command storage and the two
   delegation renames, preserving all released history. Implement strict current/historical
   schemas, parent constraints, verified transfer, and old-backup admission together. Add
   populated historical fixtures and rollback/interruption proof before retiring old storage.
3. **S3: command integration.** Rewire parent acceptance and direct-child persistence through
   the shared command authority, preserving existing single/bulk APIs and per-child executor.
   Update identity checks, replay, audits/health classification, and composed wiring. Remove
   the obsolete current bulk repository; do not leave duplicate writers.
4. **S4: regression and references.** Prove all rows below, update current table facts and
   pending implementation markers at their owners, and regenerate affected output. Keep
   historical citations and existing phase completion unchanged.
5. **S5: candidate and independent review.** Run gates, commit exact paths by logical category,
   freeze the candidate, dispatch R1 with base/head/tree, approved plan, full diff and proof/
   gate evidence. Fix and re-review all required findings under review policy.
6. **S6: hand back for integration.** Return the reviewed candidate and outstanding integration/
   cleanup. Once operator-assigned, integrate under the recorded controls, verify combined
   inputs, record actual SHA/gates and cleanup. Do not claim complete while these remain open.

| Proof | Required result and forbidden effects |
| --- | --- |
| P1 Fresh/storage constraints | New database has parent/child commands and both approved delegation names; old current tables absent. Standalone/lifecycle rows remain root commands. Invalid parent kind, missing parent, nested/self links, mismatched membership, and wrong-parent replay refuse. Integrity and current backup verification detect corrupted, removed, or reassigned child linkage; adding relational metadata must not leave it outside validation. Preserve historical record bytes and historical fingerprint algorithms. SQL/record mirrors and strict schemas agree. |
| P2 Migration/data preservation | Populate pre-change bulk parents with zero, some, and all journaled children; include unused/unexecuted parent requests, expired workflow requests, and nonempty delegation/dependency states. Preserve every existing command/audit byte and ID, parent facts/fingerprint/time, dependency/manifest keys and JSON, and unrelated settings/credentials/runs/grouping. Link only exact children. Colliding parent IDs, conflicting derived children, or ambiguous ownership refuse before conversion; never synthesize missing outcomes. |
| P3 Single/bulk behavior | Real composed command tests show standalone behavior unchanged and a valid bulk request yields one parent plus actual committed children, not duplicated accepted rows. Mixed applied/conflict/refused results remain ordered; errored child stops the pass and leaves the remainder explicitly unattempted. All-or-none remains unavailable; malformed/unauthorized requests reach no child effect. |
| P4 Replay/identity/concurrency | Exact replay after lost response or process restart reuses acceptance time, parent contents, child IDs, and completed outcomes. Added/removed/reordered targets, changed versions/type/options/actor/reason under the same ID refuse before new child effects. Exercise simultaneous identical/divergent acceptance, parent-vs-single/lifecycle/protected identity reuse, and forged child linkage. Positive controls must reach normal execution so negative tests cannot pass due to unrelated setup refusal. |
| P5 Transaction and audit truth | Inject child failure before commit and after prior siblings commit; preserve prior success, roll back the failing child's uncommitted command/audit/effects, and replay safely. Parent acceptance is not execution success and produces no fabricated audit. Current doctor excludes parents from unfinished executable-command counts without hiding a genuine unaudited individual command. Preserve historical count semantics and settings/protected journal readers. |
| P6 Recovery and backups | Rehearsal is read-only; active processes, missing/stale backup, changed source, unsupported schema, and pending incompatible conversion refuse without unauthorized effects. Test failure before conversion commit and after commit/before settlement, exact resume, and no-write settled rerun. Old/current backup fingerprint/record/schema admission and restore drill pass; corrupt rows or unknown tables do not become defaults. |
| P7 Delegation behavior | Real repository fixtures and existing planner/join tests preserve zero/one/many children, exact manifest replay, foreign-key linkage, immutable manifests, dependency states, and cancellation/tree policy reads after both renames. Do not claim a live child-run workflow or implement the currently unwired seam. |
| P8 Transitive consumers | Current command/authority/history readers, composed BFF, existing bulk vector/feed, and storage health agree. Full parity passes without baseline changes; no new UI or public command envelope. Old SQL names remain only in released history, explicit historical adapters/tests, and history documentation. |

## Gates and resources

Follow D191. Focused iteration commands include:

- `npm run test -- tests/unit/commands-authority.test.ts tests/unit/command-kernel.test.ts tests/unit/server/bff-flow.test.ts`
- `npm run test -- tests/unit/sqlite-authority-database.test.ts tests/unit/storage-upgrade.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-backup-command.test.ts tests/unit/storage-restore-drill.test.ts`
- `npm run test -- tests/unit/delegation.test.ts tests/unit/dashboard/bulk-dispatch.test.ts`
- `npm run test:architecture -- tests/unit/architecture/delegation-manifest.test.ts tests/unit/architecture/migration-history-immutability.test.ts`

Add focused regression cases for P1–P8 at real boundaries. Run lint whenever tests run.
These selectors do not replace full candidate gates or need repeating after unchanged full
coverage. Iteration may select the smallest meaningful case; group related fixes into commits.

| Boundary | Required checks |
| --- | --- |
| Implementation commit/candidate | `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run test:parity`, `git diff --check`; affected generated freshness and document/link/instruction checks. Record tested commit/tree, exact commands/exits, effective workers, proof map, and retained logs. |
| Generated inputs | When affected, run `npm run build:manifest`, `npm run stores:catalog`, or `npm run roadmap`, then its corresponding `:check` script. Inspect descriptor closure even for comment changes; never hand-edit generated artifacts. Update guard inventory with deciding negative controls for actual additions/retirements. |
| Material integration | Typecheck, lint, full coverage, parity, affected generated/document checks and diff check on actual integrated inputs. Re-review behavioral conflict fixes. |
| Planning/recording | Applicable links, instruction-pair/size audit, affected generated/document checks, and diff check. No runtime-gate claim merely because the plan is approved. Reuse only with original command/result, tested SHA/tree, current candidate and inspected unchanged inputs; otherwise rerun the applicable gate. |

Use the installed runner/configuration, isolated projects, and at most four effective file
workers. Recheck resolved per-project settings after configuration changes. Keep coverage
free of this task's compiler/linter contention. Independent typecheck/lint/freshness checks
may overlap within verified host limits; generation precedes checking and shared output is
serialized. Do not overlap coverage/parity mutable output in one checkout, change floors,
membership, isolation, assertions or deadlines, or kill another task's processes. Serialize
shared-target operations and evidenced resource conflicts, not unrelated work by default.

## Boundaries, later application, and progress

No new actions, all-or-none execution, aggregate success audit, automatic retry/resume,
bulk hierarchy beyond one level, arbitrary relationship graph, UI redesign, delegation
activation, further renames, current alias tables/views, live HR transactions, UNKNOWN-submit
retry, credential export, legacy state access, cutover, or roadmap completion changes.
New material schema/identity/ownership incompatibilities require amendment; ordinary fixes
inside the approved seams remain with the implementer.

Actual operator database application is separate and requires explicit assignment after
accepted integration. Recheck accepted executable commit, exact rebuild target/schema,
settings/database coupling, permissions and current locks. Stop only authorized rebuild
processes, create `npm run cli -- storage backup --json`, inspect
`npm run cli -- storage upgrade --plan --json`, then apply
`npm run cli -- storage upgrade --json` and verify with
`npm run cli -- storage doctor --json` plus sanitized row/identity preservation checks.
The candidate's new conversion preflight belongs before actual effects; do not demand
unfinished tooling during planning. Preserve unrelated sessions, source evidence, and
intended runtime state; never launch workers just to prove conversion.

The supervisor sends **Done / Now / Remaining** at start/resume and after each verified step,
before the next tool call. Record current base/plan/head, proof and gate input identities,
findings, blocker/next step, review, integration, and cleanup here. Use `/handoff` for interrupted
unique recovery state only, not as a competing plan.

- Approval: final three-change list accepted with “okay do it”, 2026-09-08.
- Planning baseline: `b2302c057836254067845c95b75ec9edaca78ef5`.
- Prerequisite: `side/worker-names` has no verified accepted integration yet; implementation waits.
- Names and binding: proposed branch/path absent at inspection; check capacity/ownership afresh.
- S1–S6 and P1–P8: all implementation/review/integration work remains open.
- Planning validation (2026-09-08): 13 plan links/anchors and contract backlinks resolve;
  all named test selectors exist; all eight proof rows are retained. Documentation audit
  passes for nine identical instruction pairs with project chains below 32,768 bytes.
  The roadmap binding guard passes 23 tests; lint passes with zero warnings; roadmap
  freshness and whitespace checks pass. Only this plan and its three owning contract/
  decision amendments are staged. Typecheck, full coverage, parity, and implementation
  review are unrun, not inherited as proof of this unimplemented design.
- Concurrent documentation integration advanced master to
  `4fd479d8ad3599879cac342a6900549e6532cd05`. Inspection from the planning baseline found
  only the accepted 2.6.1-2 completion record and roadmap source/output changes; no code,
  test, lint, configuration, or dependency inputs changed. Recheck affected roadmap tests
  and freshness on the final planning tree; preserve that task's records untouched.

The operator opens the new supervisor session using this committed plan SHA. Planning does
not create a task, dispatch agents, implement, merge a product candidate, or push. The outgoing
conditional prompt must carry the exact ID, absolute plan and checkout paths, full plan SHA,
prerequisite/base-resolution rule, gates/review, and operator-assigned integration conditions:

> This is an approved side-work assignment. The side plan is the task owner wherever
> /supervise refers to a task/phase section. Record progress, review, gate evidence and
> completion there. Do not create a phase number or mark roadmap tasks complete. Preserve
> repository contracts, independent review, required gates and authorized integration/cleanup
> conditions.

## Assigned combined integration — 2026-09-08

The operator's **“do it”** after reviewed candidate delivery authorizes this task to
integrate all three parallel candidates, reconcile their unreleased migration numbers,
run required integration gates and independent review, and clean up their owned worktrees.
The worker-names and operation-names tasks also received this instruction and explicitly
yielded shared-target ownership to this task. This does not authorize a push or conversion
of the operator database.

| Binding | Verified value |
| --- | --- |
| Integration owner | Command-groups task `01a08248-5b6c-7360-99a6-78a2c0da3f19`, Local |
| Integration checkout / branch | `/Users/julianhein/Projects/hr-worktree-command-merge` / `codex/command-groups-integration` |
| Primary base / target | `121df12e817c3e19708217d1b9e22d50b8787477` / local `master` |
| Worker candidate → schema | `0a0edb10b3a9f0852727d584ab1cd8164383a5ed` → 35 |
| Operation candidate → schema | `394bf4c631b5f01207cb3a3dd1aaaf06b1eb714c` → 36 |
| Command candidate → schema | `aff7f5656bdf13af509620f1ee4b1ebd0451dba7` → 37 |
| Integration condition | Serialized `--no-ff` merges; each material tree typecheck, lint and full coverage; required parity/freshness/docs checks; fresh independent combined review before primary integration; verified cleanup afterward |

Released migrations 1–34 retain their statement bytes and digests. Worker, operation and
command compatibility boundaries remain distinct at 35, 36 and 37. The final current
schema is 37 with stopped-upgrade floor 36. The read-only migration audit by
`/root/sup_scout_migration_merge` identified these boundaries; it did not edit files or
provide acceptance review. No implementation worker was dispatched.

Worker integration commit `5aef718` has tested tree
`4aeed73242c02b043d2f7e1afef5b0e68e020bf2`. Typecheck, lint, full coverage
(447 files / 5,658 tests; all floors), suite-size, 262 parity cases, manifest/catalog/roadmap
freshness and documentation checks passed. Logs are
`/tmp/hr-command-merge-worker-{typecheck-2,lint-2,coverage-2,suite-size,parity,manifest,catalog,roadmap,doc-audit}.log`.
The only initial merge conflict was additive decision-index text; both sides were preserved.
Primary drift included roadmap parser/tests, so candidate code gates were not reused.

Integration discovered a worker P6 guard escape: the lifecycle SQL matcher retained `leases`
but omitted `workflow_workers`. A new violating fixture failed before the matcher repair;
the corrected guard passed both cases. The existing guard inventory records this evidence.
This is an implementation/review escape, not a new product requirement, and remains within
the fresh combined review scope. The first two-worker full run separately failed one
unchanged 30-second architecture deadline at 30.94 seconds, with 5,657 other tests passing.
The one-worker retry passed; its formerly failing case took 24.61 seconds. No assertion,
member, isolation setting, deadline or coverage floor was relaxed.

Later gate scheduling uses the installed runner's explicit project groups: architecture
at one worker, then unit/scenario together at two. The temporary adapter asserts that only
worker counts and execution groups differ from the repository configuration. Timeline work
runs in a separate operator-authorized checkout and is excluded from this integration and
cleanup; heavy-gate windows are coordinated with its exact task
`01a082a8-92ac-7031-8eb2-31708e7b0aad`. Primary untracked `docs/handoffs/` is preserved.

Current state: worker merged into the isolated integration branch; operation reconciliation
is in verification. Command merge, remaining gates, combined review, primary integration and
owned cleanup are still open. Existing independent candidate review and repair provenance
in each owner remains authoritative for its original frozen candidate.
