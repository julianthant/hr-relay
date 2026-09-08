# Command groups and delegation table names

## Approved assignment and status

**Task: `side/command-groups`. R1 repair gated; awaiting independent repair review.** This file is the single
task owner; it does not create a roadmap phase or change phase completion.

The operator approved consolidating bulk requests into parent/child rows in `commands`,
asked for two more changes in the same plan, agreed to keep delegation and dependency
tables separate, changed the proposed dependency name to `delegation_dependencies`, then
said **“okay do it”** on 2026-09-08 after the final three-change list. That is approval to
write this plan in the planning-only session. The original planning session performed no implementation, independent review, integration, or
database application. The execution amendment and progress below record this supervisor session.

| Change | Approved outcome |
| --- | --- |
| 1 | Move bulk acceptance authority into non-executable parent rows in `commands`; link direct child commands using nullable `parent_command_id`; retire current `bulk_command_acceptances`. |
| 2 | Rename `dependencies` to `delegation_dependencies`. |
| 3 | Rename `delegation_manifests` to `run_delegations`. Keep these two tables separate. |

The existing three-rename [worker/request plan](../worker-names/README.md) is unchanged.
The original serial binding followed its reviewed integration because both affect the same
migration chain, registries, adapter and backup machinery. The explicit parallel execution
amendment below replaces that ordering: each candidate validates independently against schema 34,
with combined migration reconciliation deferred to assigned integration. Task 2.6.1-3 is integrated.
Do not take either peer's scope or dirty files.

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


## Execution amendment — parallel implementation (2026-09-08)

The operator explicitly instructed “no do in parallel”, replacing the worker-names integration
prerequisite for implementation. This task uses an independent schema-34 base and implements no
worker/request or operation renames. The earlier serial-base instructions above are superseded
only for execution admission and migration sequencing by this amendment.

- S1 admitted: base `35635a04e16e9c3cf1e99b16d4963752a18c616a`; approved plan commit
  `46892ab3704526feb2c8af80e2317e39e97bde36` is an ancestor. Task 2.6.1-3 integration
  `813581124` is an ancestor; its owner records accepted review and integration gates.
- Branch `codex/command-groups`, checkout `/Users/julianhein/Projects/hr-worktree-command-groups`.
  Created after verifying name/path absence and capacity: fourth auxiliary worktree, preserving
  worker-names, operation-names, phase-four and primary checkout changes.
- One local implementer; no supporting implementation agents. R1 remains a fresh complete
  read-only reviewer. Current schema 34; this isolated candidate appends schema 35.
- Each peer owns its own isolated candidate, fixtures, generated output and evidence. No shared
  working-tree writes, unmerged API dependency or automatic integration. Worker-names confirmed
  its independent schema-34 base and three-rename schema-35 candidate.
- Either candidate can be integrated first. Later operator-assigned integration must append the
  subsequent still-unreleased migrations with new version/digest bindings, preserve all released
  history, reconcile the combined historical table/record/fingerprint families and floor, and run
  required combined gates plus independent review of those behavioral conflict resolutions.
  The same applies to the separately active operation-names assignment. A standalone candidate
  PASS does not establish combined migration correctness or authorize real database application.
- S2–S5 remain open; S6 integration and cleanup remain operator-assigned. No product gates yet run.


## Candidate progress and evidence

S1 is admitted under the parallel amendment. S2 storage/conversion and S3 command integration
are implemented; S4 regression/reference work and S5 candidate gates are complete.
S5 independent review remains open. S6 integration and cleanup are not assigned.
No real operator database was read or converted in this implementation session.

The candidate uses a strict `bulk-parent` stored variant while preserving the public command
union and lifecycle/settings readers. Parent acceptance is owned by `commands.acceptBulk` /
`commands.getBulk`; the old database repository and current bulk table are retired. The ingress
composition adapts those methods to its existing interface. Internal parent context reaches
identity admission and insertion under the child authority transaction. Parents reserve their
own and derived child identities, including independent credential command IDs.

The stopped adapter validates the complete historical mapping in its read-only rehearsal and
again inside conversion. It preserves individual command/audit bytes, links only exact existing
children, and refuses parent, child or credential-identity collisions. Current fingerprints
include relational linkage; historical fingerprints and record grammars remain version-scoped.
Delegation names change without changing public manifest/dependency fields or activating workflows.

| Proof | Candidate evidence |
| --- | --- |
| P1 | `command-groups.test.ts`: stored variants, valid/replayed links, forged/missing/self/nested parents, immutable parents/links, no parent audit, standalone findings, removed/reassigned link corruption. |
| P2 | Populated schema-34 fixtures with zero/some/all journaled children; exact command/audit byte comparisons, original parent facts, explicit zero/one/many delegation manifests and active/satisfied/failed/cancelled dependency rows. Real stopped conversion and refusal paths. |
| P3 | Extended real `bff-flow` bulk case retains applied/conflict/refused ordering and public admission. Audit-failure injection produces applied/errored with an unattempted remainder, then safe exact replay. |
| P4 | Real simultaneous identical/divergent BFF acceptance, changed target selection/order/version/type/mode/reason, restart replay, standalone/parent identities and independent credential conflicts. Existing actor/media/origin tests remain selected by full coverage. |
| P5 | Child transaction failure preserves prior siblings and parent, rolls back failing command/audit/lifecycle effects; no parent execution audit; backup counts retain genuine unaudited individual commands. |
| P6 | Historical backup admission, read-only rehearsal, precommit rollback, postcommit interruption/exact settlement and no-write settled rerun; incompatible pending conversions from 32/33/34 refuse. Existing backup/restore/admission suites remain full-gate requirements. |
| P7 | Real renamed repositories preserve populated historical manifests/dependencies and exact replay; existing planner/join/cancellation/tree tests remain full-gate requirements. No live delegation capability claimed. |
| P8 | Composed BFF and health read the consolidated authority; generated manifest/catalog/roadmap freshness passes. Full coverage and parity remain required. |

Iteration evidence (all logs under `/tmp/hr-command-groups-*`):

- Initial implementation checks exposed a missed schema-version allowlist and historical fixture
  assumptions; fixes retain the old journal bytes and released migration digests. Initial failures
  are retained, not reused as passing gates.
- `typecheck-2.log` and `lint.log`: exit 0 on the intermediate implementation.
- `focused-2.log`: 255 passing, three failures: the v32 fixture copied a new nullable column into
  old DDL; the never-delete fixture lacked a bulk parent; the generation-accounting test exceeded
  its unchanged 30-second deadline under measured concurrent host gates.
- `targeted.log`: scheduling-only root/per-project one-worker adapter, one fork observed; 16 tests
  passed, 244 deliberately unselected, four files, 23.94 seconds. It verifies those fixes, composed
  bulk failure/replay and the populated migration/refusal/recovery tests. Subsequent proof additions
  remain subject to the complete candidate gate.
- `doc-audit.log`: nine equal instruction pairs, project chains below 32,768 bytes, all 13 owner
  links/anchors resolve. `manifest-check.log`, `catalog-check.log`, `roadmap-check.log`: current.
- Final compiler found one missing `PreFloorCommandSchema` import in the historical-reader override;
  corrected. No claim of a final compiler pass yet.
- Gate-resource coordination: worker-names and operation-names both reported coverage architecture
  timeouts while overlapping heavy gates. This task finishes existing checks and waits for their
  coverage release before starting another compiler/linter/coverage/parity cycle. No peer process
  is stopped. Assertions, membership, isolation, floors and timeouts remain unchanged.


Candidate gate/repair record:

- Initial frozen gate tree: `0105478f754c62985132dc0603ddd68acdd5688d`. Final typecheck
  (`typecheck-gate.log`), lint (`lint-gate.log`), manifest/catalog/roadmap freshness
  (`*-check-final.log`) and documentation audit (`doc-audit-final.log`) passed on this tree.
  The latest focused proofs (`targeted-final.log`) passed 16 tests across three files.
- Full coverage (`coverage.log`) used the unchanged repository configuration with only effective
  root/per-project `maxWorkers: 2`; two actual child workers were recorded in
  `worker-processes.log`. It finished with 5,648 passed and six failed across 448 files, exit 1.
  This failed gate is retained and never reused as a pass. No floor, assertion, membership,
  isolation or timeout was changed.
- Failures: one browser import-closure regression from moving child derivation into the public
  command module; four stale schema/floor expectations in architecture/real-port fixtures; one
  historical-command fixture using an implicit four-column insert against the new five-column
  table. Repairs move unchanged derivation into server-only `src/domain/command-groups.ts`,
  update current/future schema expectations and preserve historical values with explicit columns.
  No guard was added or retired; their checks and negative controls remain intact.
- Repaired runtime/test tree: `56ff4380a7966cae9a7c9f7f71bb3ba5f2601f54`.
  `repair-focused.log` passed all 22 selected tests across six files (195 deliberately unselected),
  exit 0, using one effective worker. It covers all six failures plus command-group and composed
  BFF behavior after the helper move. Full repaired gates remain pending.
- After the failed full run and all owned children exited, the heavy gate window was explicitly
  released to operation-names for its prepared recovery repair. This task performs bounded repair
  proofs only until that task releases its compiler/linter/coverage/parity window back.


## Frozen candidate — awaiting independent review

Base remains `35635a04e16e9c3cf1e99b16d4963752a18c616a`; branch remains
`codex/command-groups`. Approved plan and parallel amendment are unchanged. The complete
implementation includes 28 paths; there are no unrelated working-tree changes. Candidate commit
is the implementation commit containing this record; R1 must bind its exact SHA before inspection.
No real database application, merge, push, roadmap completion or worktree removal is included.

All final implementation gates used tree `00ead7a5b12764ea35b09991be51e8fe5c4b9785`.
Only this task-owner evidence was edited afterward; source, tests, dependency/configuration inputs,
manifest/catalog/roadmap outputs and parity references are unchanged. Verify that one-file delta
when binding the candidate. Logs below are under `/tmp/hr-command-groups-`.

| Gate | Exact command and result | Log suffix |
| --- | --- | --- |
| Typecheck | `npm run typecheck` — exit 0 | `typecheck-repaired.log` |
| Lint | `npm run lint` — exit 0, zero warnings | `lint-repaired.log` |
| Full coverage | `npm exec -- tsx scripts/test-runner.ts run --coverage --config /tmp/hr-command-groups-vitest.mts` — exit 0; 448 files, 5,654 tests passed; all configured floors met | `coverage-repaired.log` |
| Suite-size constituent | `npm exec -- tsx scripts/suite-size.ts` — exit 0; unit 351 files/127,060 lines, scenario 17/7,411, architecture 80/30,885 | `suite-size.log` |
| Parity | `npm run test:parity -- --workers=2` — exit 0; 262/262 passed, no baseline changes | `parity.log` |
| Manifest | `npm run build:manifest:check` — exit 0 | `manifest-check-repaired.log` |
| Store catalog | `npm run stores:catalog:check` — exit 0 | `catalog-check-repaired.log` |
| Roadmap | `npm run roadmap:check` — exit 0 | `roadmap-check-repaired.log` |
| Documents | `python3 /tmp/hr-command-groups-doc-audit.py` — exit 0; nine equal instruction pairs, project chains below 32,768 bytes, 13 owner links/anchors resolve | `doc-audit-final.log` |
| Whitespace | `git diff --cached --check` — exit 0 | terminal evidence |

Coverage: statements 86.01%, branches 77.88%, functions 90.01%, lines 88.23%. The external
Vitest adapter imports the repository configuration and changes only `maxWorkers` to two at
root and each project; effective unit/architecture/scenario isolation and 30-second deadlines
are unchanged. `worker-config.log` records the resolved comparison; `worker-processes-repaired.log`
records exactly two owned forks. The coverage and suite-size commands together are the repository's
`test:coverage` script with that scheduling-only override. Parity likewise changes only worker
count; the assertion wrapper, reporters, case membership, retries and all reference pairs remain
unchanged. Coverage ran without this task's compiler/linter/parity contention.

All owned gate processes exited. S2–S4 and S5 gates are complete; one fresh complete read-only R1
review is pending. S6 integration and cleanup still require operator assignment. A standalone PASS
will not resolve the parallel candidates' combined migration numbering or authorize database use.


## R1 review and bounded repair

Reviewer `/root/sup_review_command_groups` independently inspected the complete 28-path
candidate `92ba918741f138ec9bfd7698e9858775ab657db5` against the recorded base/plan and
returned **CHANGES REQUIRED**, with one high-severity finding (R1). No paths were unreviewed;
all P1–P8 boundaries were inspected. R1 affects P4 identity concurrency and P5 audit truth.
The inspected gate logs were supervisor-run evidence, not reviewer reruns. The reviewer
independently rechecked identity, inventory, whitespace and document audit.

R1: bulk ingress serialized only the parent ID. A single async worker command using a prospective
child ID could spawn, wait for birth acknowledgement, then lose its journal/audit when a bulk
parent accepted during the await reserved that ID. An all-or-none request caused the worker to
return `command-divergent` without a command/audit despite spawning; a best-effort request could
cancel a run under that same identity before the worker settled. Evidence at the reviewed SHA:
`operator-command-ingress.ts:323`, `authority-database.ts:2868`, `command-kernel.ts:2513`.

The external synthetic probe ran on unchanged reviewed HEAD with the real ingress/service/kernel,
composed worker supervisor, fake process edge and real temporary authority/birth lease:
`npm exec -- tsx scripts/test-runner.ts run --config /tmp/hr-command-groups-r1/vitest.mts`.
`/tmp/hr-command-groups-r1-probe.log` contains two passing assertions demonstrating the defect.
The initial scratch-only assertion typo (`cancelled` versus terminal/cancelled lifecycle) was
corrected; its failed log is retained separately. No real processes or operator state were used.

Repair: ingress atomically reserves the parent and every derived child identity in its existing
in-process lane map before awaiting prior owners, then holds those lanes through acceptance,
effects and journaling. Every reservation waits only on earlier promises, avoiding nested-lock
cycles. Stable IDs, envelopes, storage/replay semantics and the async worker kernel remain
unchanged. An already executing single command settles first; the colliding bulk then refuses
before parent acceptance or child execution.

Permanent regression cases in `worker-pool-composition.test.ts` cover both bulk modes through
real ingress, async kernel and supervisor. They prove the parent stays absent until the fake
worker's durable birth acknowledgement; its command and audit remain worker-owned; bulk refuses
before execution; the run stays queued. Both cases failed against the reviewed implementation
(`r1-red.log`, exit 1), then passed with neighboring composed bulk and command-group cases
(`r1-green.log`, 15 tests across three files, exit 0). Logs use `/tmp/hr-command-groups-`.

R1 disposition: repair implemented, awaiting final gates and independent verification. This is
one repair round for one finding. The bounded recheck may use the same independent reviewer
only with uncompacted capacity; no author participated as reviewer. S6 remains separately assigned.


### R1 repair candidate gates

Frozen tested tree: `b6417a7164945395efbe766f378fb08810721d90`. The repair changes only
`operator-command-ingress.ts`, `worker-pool-composition.test.ts` and this owner relative to
reviewed commit `92ba918741f138ec9bfd7698e9858775ab657db5`. The complete base-to-candidate
inventory is now 29 paths. Only this evidence record changes after the tested tree; all gate
inputs and parity references remain unchanged.

The exact commands in the frozen-candidate gate table were rerun for the repair, with the same
scheduling-only two-worker adapters and no compiler/linter overlap during coverage. All exited 0:

| Gate | Result | `/tmp/hr-command-groups-` log suffix |
| --- | --- | --- |
| Typecheck / lint | Both passed; zero lint warnings | `typecheck-r1.log`, `lint-r1.log` |
| Full coverage | 448 files, 5,656 tests passed; all floors met | `coverage-r1.log` |
| Suite-size constituent | Unit 351/127,126 lines; scenario 17/7,411; architecture 80/30,885 | `suite-size-r1.log` |
| Parity | 262/262 passed; unchanged baselines | `parity-r1.log` |
| Manifest / catalog / roadmap freshness | All current | `manifest-check-r1.log`, `catalog-check-r1.log`, `roadmap-check-r1.log` |
| Documents / whitespace | Nine instruction pairs, chain cap and 13 links passed; diff check clean | `doc-audit-r1.log`, terminal evidence |

Coverage: statements 86.01%, branches 77.88%, functions 90.01%, lines 88.23%.
`worker-processes-r1.log` verifies two owned forks. All owned gate children exited. R1 repair
is awaiting commit-bound independent recheck; S6 integration/cleanup remains separately assigned.
