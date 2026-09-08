# Task 1-3 · Revalidate operator read models

## Admission and current state

The operator requested `/phase-plan` for exactly **2.6.1-3**, followed by implementation in the same task, on 2026-09-08. The delayed continuation ran; its original automation is no longer present, and no replacement was created. The operator subsequently approved the shared-reader prerequisite before the three parallel tasks. This overrides the routine fresh-session/prompt boundary, not contracts, independent review, gates or isolation.

**Awaiting renewed independent review R2; repaired P3/P4 candidate gates pass.** Task 2.6.1-1's session owned that prerequisite and the shared overview/roadmap ledger; its window is now released. Its inspected starting master is `2dd3048f8d5d223f3eb1347353c83c3d07297cfe`, which contains accepted Phase-1.6 closure. P candidate `249d96edf1cf0007e93f6313fc85d37a1dee4878` passed complete independent P-R1; integration `826cae74414e84fcd8559bbb34a43f2d68e4678e` and completion base `64db38e017f585014173bae3c428e6c2a1f63099` were verified before worktree creation. This file is the task's detailed plan; the phase overview retains shared wave governance. Independent review, integration and completion remain open.

| Assignment | Binding |
| --- | --- |
| Supervisor | Current task `01a08043-6490-7181-a040-736db353cb68`, GPT-6 Astra/high; local implementation, no supporting workers |
| Shared prerequisite owner | Existing task `01a08042-bb76-7131-844a-872dd909a835`; extraction and shared wiring only, with independent review and gates before wave admission |
| Implementation mode | Dedicated worktree and branch; created `/Users/julianhein/Projects/hr-worktree-operator-reads`, `codex/operator-reads`, exclusively owned by this task |
| Implementation base | `64db38e017f585014173bae3c428e6c2a1f63099`; accepted P integration and plan `8af59c63e5d06d1b746d50c214b6f2bf4eb6059d` verified ancestors |
| Plan availability | Commit and inspect this entire file after prerequisite interface verification; verify its reachability and availability from the task checkout |
| Integration | Local `master` in `/Users/julianhein/Projects/hr-automation-rebuild`; T (Task 1-1) and Task 1-2 must now be accepted before Task 1-3; their mutual order remains independent; serialize shared-target mutation/gates and combined generated output with the recorded integration owner |
| Merge condition | Candidate gates, complete independent PASS, clean owned checkout, verified target/plan/base, mergeability and unchanged peer ownership; `--no-ff`, required integration gates, renewed review for behavioral conflict fixes |
| Review | One fresh complete `sup_review`, no implementation history; full candidate and all proof rows below, including migration/historical admission, operator reads, status UI and protected readback |

The primary directory is shared/integration-only for this assignment. Do not change its branch or stash/reset another session's work. Two unrelated auxiliary worktrees were observed before prerequisite creation; preserve them. Recheck the four-auxiliary-worktree capacity, refs and physical path before creation. Waiting on capacity never permits implementation on master. No push, sibling dispatch, production transaction or operator-root conversion is authorized.

## Outcome and owned scope

Archive, Activity, Explorer, current/queue/detail, doctor, preflight and settings-status consumers answer lifecycle questions from canonical `RunRecordService.read/list`. Spans and frozen archive records remain evidence, not a second lifecycle authority. The task removes A2's lifecycle fold inputs and A3's write-only `runs_view` table/repository/persistence. It preserves strict historical backup admission and immutable evidence. It adds the already-required `cancelling` status for a claimed run carrying `cancelRequested` and proves protected settings never read back as values.

Requirements remain at [dashboard surfaces](../../../reference/dashboard-surfaces.md) D330.2/.5/.8/.9/.12 and D332, [clock/config/secrets](../../../reference/clock-config-secrets.md) D331.6/.11 P16, [operator trust](../../../reference/operator-trust.md), [frontend integration](../../../reference/frontend-backend-integration.md), and [guards and tests](../../../reference/guards-and-tests.md) §5.2 A2/A3 and §3.14 D191. This plan does not redesign those contracts.

Ownership confirmed with the prerequisite owner:

- Operator remainder of `src/server/dashboard/queries/run-detail.ts`; `src/server/dashboard/compose/operator.ts` and the operator route module produced by the prerequisite. Recheck exact exports/paths from its committed handoff.
- `src/server/dashboard/run-status.ts`, `projectors/run-queue-projection.ts`, required operator projector helpers, `queries/archive.ts`, and bounded Explorer read dependencies if the trace finds an actual lifecycle/settings dependency. Explorer's current descriptor-only paths need proof, not an invented migration.
- `src/domain/dashboard/projection.ts`, `status-vocabulary.ts`, required generic operator wire/status consumers, minimal `src/dashboard/ds/primitives-status.tsx` and status model/UI consumers needed for the existing `cancelling` requirement. Preserve all existing visual states and design rules.
- A3 retirement in `src/domain/authority.ts`, `src/infra/sqlite/migrations.ts`, `authority-database.ts`, historical backup admission in `src/infra/compat/backup-inspection.ts`, and mechanically affected current/historical schema readers and fixtures. No canonical lifecycle mutation redesign or A0/A1 retirement.
- `src/infra/sqlite/storage-doctor.ts`, `authority-health-runner.ts`, `recovery-contracts.ts`, safe upgrade-phase inspection, necessary settings-status read consumers and their tests. Existing credential authority and private test inputs remain untouched.
- `tests/unit/server/helpers/dashboard-harness.ts` after prerequisite; generic status/queue/Activity/archive/BFF, storage/schema/recovery, settings/doctor/preflight and applicable dashboard/parity tests. Trust tests use separate fixtures and do not edit this harness after the shared base.
- This task file and its evidence. The prerequisite owner retains shared README/roadmap edits until serialized integration. Guard inventory and shared redaction-audit additions are serialized with the integration owner; each changed guard must retain its deciding negative-control evidence. A2 is a unit test, not a new inventory entry; A3 remains an arm of the existing lifecycle-SQL guard.

Excluded: trust/log/gate/capture/parked-write implementations and `compose/trust.ts`; intake/context-data/Rerun-values and descriptor mapping implementation; shared root composition/API glue after prerequisite; new notification producers; Run modal/Settings editor redesign; rewriting archive or append-only evidence; changing run/settings authority contracts; deleting migration-only A0/A1 modules; live HR writes and cutover. A required shared-file change returns to its recorded owner; routine local fixes remain here.

## Feasibility and acceptance proof

| ID | Current evidence and necessary change | Required proof and forbidden result |
| --- | --- | --- |
| P1 Canonical existence | Current generic detail checks `runFold` before `getRun`; day/Activity enumerate folded rows. The prerequisite separates ownership and supplies canonical backing. Enumerate canonical live/archived rows and join optional evidence; use generation-bound paging consistently. | Real SQLite/service fixtures: absent, present-live, present-archived and deleted remain distinct. A present run without queued/claim/end spans still exists and is countable; orphan/deleted spans cannot resurrect it. Stale list cursor refuses distinctly, never mixes generations or falls back to current/latest data. |
| P2 Authority-only lifecycle | `deriveRunStatus` currently trusts `row.ended`, `row.claimedBy` and open gate spans. `#endedAt`, member terminal/failed rollups and related active counts also consult folded outcomes. D330 additionally requires `cancelling`, currently missing from `QueueStatusSchema`. | Table-driven lifecycle × contradictory/missing fold tests. Required named `run-status-fold-contributes-no-lifecycle-arm` lands in the same implementation commit as A2 removal. Claimed+fold-done remains running; queued+fold-claim remains queued; queued+open-gate remains queued; parked-gate remains awaiting approval without a gate span. Claimed/validating/running with cancelRequested is cancelling until canonical terminal/cancelled; both real detail and queue callers, member rollups and Activity agree. No synthetic terminal end time. |
| P3 Identity, membership and counts | Folded queued data currently supplies envelope fields and member links; queue/Activity omit an authority run without a fold. Use immutable run envelope for run/parent/retry/shape/date/dryRun/config identity and canonical membership. Preserve evidence-only titles/details when present. | Create/update/claim/requeue/cancel/archive/relaunch/delete/restore convergence across queue rows, workflow/status/month counts, batches, operation members and Activity. Mutation without a new span reaches polling/SSE change detection. Missing evidence has explicit absence or a clearly sourced existing identity label; never fabricate a queued span, actor, execution or successful step. Zero/one/multiple member and archived/deleted-child cases. No per-row whole-database enumeration. |
| P4 Archive and recovery | Archive index currently lists frozen rows and freezes through live run/detail/section functions. Canonical membership decides current/archive/delete; stored snapshots decide historical evidence content. | Archived readback remains immutable and descriptor-independent, including after descriptor removal; no current configuration substitutes for captured input. Relaunch creates a new canonical run while preserving source provenance. Source delete removes owned resources exactly as already admitted and retains required historical/shared evidence. Restore proves direct-authority reconciliation without another HR write. |
| P5 A3 schema/history | Current schema 33 registers `runs_view`; projector only clears/upserts it. Current registry removal alone breaks v30-v33 read-only expected-table validation. Historical backup admission currently ends at v32; v33 becomes historical after the next schema. | Append the next migration from the rechecked schema base; preserve released DDL. Fresh database and migrated v33 database lack runs_view; existing run/settings/evidence bytes and authority generation semantics remain correct. Repeated open is stable. Authenticate/read/restore supported historical v29 and v30-v33 fixtures with their actual table sets and backup fingerprint order; never reinterpret historical tables using the current registry. Preserve v1/v2/v3 manifest semantics and strict malformed/future-schema refusal. Keep the existing injected no-reader violation red-capable. |
| P6 Settings and doctor | Settings runtime already reads SQLite and protected presence; doctor/preflight already share credential presence inspection. The doctor currently exposes no explicit authority-upgrade phases. | Populated synthetic settings/credential fixtures through settings wire, doctor and preflight: permitted presence/revision/closed status only, never values, value fragments, secret-derived hashes or full private paths. Missing versus corrupt/unavailable remains distinct; no read creates files, changes permissions, revisions, commands or evidence. Add safe baseline/planned/committed/settled upgrade reporting with closed failure/unknown states and no private journal payload. Preserve normal startup refusal and restore/UNKNOWN safety. |
| P7 UI and public contracts | Status schema feeds the shared DS/status vocabulary, row/detail/Activity/archive models and strict redaction scanner. Existing eight-status references do not cover cancelling. | Add Cancelling through the existing design system and canonical nonterminal semantics, accessible text and relevant filter/action/count behavior; do not label it terminal or enable success/retry on that basis. Full existing desktop parity remains unchanged. Add isolated visual/behavior proof for the new state; deliberate new references only, reviewed with their source fixtures. Validate served safe-literal disposition and injected redaction violations. |

Order-sensitive checks: (a) tombstoned/absent run plus retained fold/evidence refuses canonical admission before serving a live resource; (b) present run plus missing fold preserves lifecycle and reports missing evidence, rather than refusing existence; (c) cancelRequested plus stale terminal/claim/gate spans stays cancelling until canonical settlement; (d) archive/delete plus stale projection excludes it from every active count; (e) historical schema with valid old manifest validates its released layout, while malformed/future schema refuses without mutation; (f) corrupt credentials plus otherwise healthy database remains unavailable/unhealthy without value-bearing diagnostics. Include positive controls so refusals cannot pass through unrelated fixture failure.

These are synthetic-only acceptance targets. No operator database migration, restore or credential mutation is required. If later acceptance needs an actual target, first bind its identity, read-only preflight, access/locks, execution checkout and restoration order under the existing contract; do not silently convert the primary root by starting new code against it.

## Ordered execution

1. **S1 — admit the shared base and commit this plan.** Verify prerequisite review/integration/gates, exact extracted ownership and interfaces, current branch/worktree capacity and main checkout state. Record actual base and plan SHA. Resolve any changed interface mechanically within ownership; a new shared contract conflict remains a prerequisite issue. Create/recheck the dedicated task worktree only after this binding.
2. **S2 — canonical lifecycle and projection.** Implement P1–P3 and A2 as one cohesive boundary: canonical service read/list and optional evidence, authority-owned members/rollups/end times, cross-process change detection, cancelling semantics. Add the named regression in the same eventual commit as fold-arm removal. Keep evidence task outcomes and historical snapshots unchanged. Run focused operator tests through real query callers before expanding.
3. **S3 — retire the dead table with historical admission.** Remove projector persistence/repository interface/current registry, append migration and preserve old-layout readers (P5). Update real database and dashboard fixtures with focused storage/history checks; do not delete A0/A1. This follows the stable S2 mechanism and lands with its necessary code/fixture consequences after full candidate gates.
4. **S4 — finish archive, settings/doctor and visible status coverage.** Complete P4/P6/P7 at their actual entry boundaries. Validate descriptor-independent frozen archive, exact counts, safe upgrade phase reporting and unchanged protected-value behavior. Use `/ui` Operate mode for the bounded new state, preserve tokens and existing rendered states; inspect the specimen before choosing any primitive and use project parity for rendering verification.
5. **S5 — candidate gates and independent review.** Run the schedule below, commit exact paths, record candidate base/head, evidence/log paths and `awaiting independent review` here. Freeze writers. Dispatch one fresh complete `sup_review` under the current Astra/high role policy, with the plan, contracts, full proof matrix and exact candidate. Wait here; fix/gate/re-review required findings. Do not mark complete from self-review or partial coverage.
6. **S6 — local integration and closure.** Acquire the existing shared integration ownership mechanism, verify target/peers and merge only this reviewed candidate with `--no-ff`. Regenerate combined output under the shared owner, run material integration gates, and re-review behavioral conflict fixes. Record delivery assessment, accepted review/gates, integration SHA and cleanup. Update task/roadmap completion through the serialized owner. Remove only the owned auxiliary worktree/merged branch and this task's consumed handoff; preserve all peer resources.

One supervisor retains the coupled lifecycle, schema/recovery and integration judgment. No worker allocation is justified before the shared base. The fresh reviewer is a separate complete assignment. If the eventual candidate exceeds complete-review context capacity, amend review allocation before dispatch; no exhausted partial verdict closes any proof row.

## Gate schedule and resources

Run commands from the verified task checkout, with logs in an owned temporary evidence directory recorded here. `vitest.config.ts` has disjoint unit/architecture/scenario projects, isolated forks and root maxWorkers capped at four. Use two effective workers for this task on the shared host, using Task-1.6.7's resource-only adapter recipe: import this checkout's real config; copy only root and each project's `test.maxWorkers = 2`; assert deep equality after stripping only those properties and assert every effective value is 2. Create the temporary adapter beneath the owned checkout so its package imports resolve; preserve suite membership, assertions, floors, timeouts and isolation. Inspect resolved configuration/child workers before the first heavy run. This is a scheduling change only, never a forked config.

| Boundary | Commands and evidence |
| --- | --- |
| Plan/evidence recording | `python3 ~/.agents/skills/docs/scripts/audit.py <checkout> --check`; link/heading verification for this owner; `npm run roadmap:check` after the shared owner's generation; `git diff --check`. If relevant documentation inputs change, `npm run test:architecture -- --config <adapter> tests/unit/architecture/roadmap-doc-binding.test.ts`, plus lint because tests ran. Reuse code gates only after inspected input identity proves them unaffected. |
| S2 iteration | `npm test -- --config <adapter> --project unit tests/unit/server/run-status-derivation.test.ts tests/unit/server/run-queue-projection.test.ts tests/unit/server/activity-report.test.ts tests/unit/server/bff-flow.test.ts` plus the new canonical-reader regression file and extracted detail caller tests. Run relevant lint before accepting tested steps. |
| S3 iteration | `npm test -- --config <adapter> --project unit tests/unit/sqlite-authority-database.test.ts tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-admission.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-restore-drill.test.ts` plus new A3/historical-schema proofs. `npm run test:architecture -- --config <adapter> tests/unit/architecture/no-lifecycle-sql-outside-the-adapter.test.ts tests/unit/architecture/archive-invariants.test.ts`. |
| S4 iteration | `npm test -- --config <adapter> --project unit tests/unit/protected-settings-doctor.test.ts tests/unit/preflight-dashboard-runners.test.ts tests/unit/server/preflight-runners.test.ts tests/unit/server/settings-runtime-reader.test.ts tests/unit/server/settings-facts.test.ts tests/unit/dashboard/settings-storage-doctor.test.ts` plus affected archive/status/new upgrade-report suites. Focused redaction scanner/secret guards where changed. |
| Implementation commit/candidate | `npm run typecheck` and `npm run lint`; independent within verified host budget. After both finish, `npm exec -- tsx scripts/test-runner.ts run --coverage --config <adapter>` alone for this task, followed by `npm exec -- tsx scripts/suite-size.ts`, retaining all three projects and the suite-size check. These are the two exact constituents of `test:coverage`; the explicit invocation ensures npm does not append the config argument to the second command instead of Vitest. Then full `npm run test:parity` and `npm run web:build`, sequential because parity/build share bundle output. `npm run build:manifest:check`, `npm run stores:catalog:check`, `npm run roadmap:check`, scoped docs audit and `git diff --check`. Generate changed artifacts before checking them, through their recorded owner. Full coverage already includes architecture; do not append an unchanged duplicate whole architecture run. |
| Material integration | Re-run typecheck/lint/full coverage, full desktop parity, production build and affected freshness/docs checks on actual integrated inputs. Conflicts or drift that change behavior need renewed review. A recording-only SHA does not invalidate unaffected code gates/review; record old/new input identity and inspected diff for any reuse. |

Worktree-local test scratch is owned by `scripts/test-runner.ts`; coverage and parity/build output must not overlap within the checkout. Parity's existing ephemeral server ports and isolated roots permit independent worktree runs, but observe actual host/process pressure before overlap and do not claim a CLI worker flag proves effective configuration. Serialize only evidenced shared-target/output/resource conflicts, release after the operation, and never kill another task's processes or steal its lock. The shared integration owner establishes its exact acquisition/release protocol in the prerequisite ledger; this task consumes it.

## Evidence and completion ledger

### Current checkpoint — 2026-09-08

**Awaiting complete independent review R2.** Implementation candidate
`9b7365d7679b21abaf9c61dea24d5381bc7320fb` is committed on `codex/operator-reads` at
`/Users/julianhein/Projects/hr-worktree-operator-reads`; base remains
`46892ab3704526feb2c8af80e2317e39e97bde36`. R1 findings F1/F2 are repaired and all required candidate
gates pass on these exact implementation inputs. S5 renewed independent review and S6 local
integration, integration gates and cleanup remain open. The following evidence commit changes
only this owner; it does not alter acceptance or tested implementation inputs.

The base contains accepted T candidate `98305e1bccf3f4c1db80735496060bbcbfc68855`, integration
`5a07b329ec8a935535ee34935fc05717bbc4f0c1` and completion `393d5da75e96ae431ac0fa9d73d07176d924a3d7`;
and accepted Task 1-2 candidate `75e3fb655b438bcf2c97f2d1d9df3582ccdf7f15`, evidence
`00a80682b48b0b72898798722cff023170d47047`, integration `b2302c057836254067845c95b75ec9edaca78ef5`
and completion `4fd479d8ad3599879cac342a6900549e6532cd05`. T-R1 and 2.6.1-2-R1 passed complete
independent review. Their optional-evidence readers are consumed. Exact owned-path preservation
was verified for the BFF, redaction audit and intake test overlaps; all exact temporary stashes
were removed. The base also preserves the separate approved future command-group/delegation
naming plan; it changes no current implementation or this assignment's scope.

The operator approved the shared-reader prerequisite and same-session implementation. D344
preserves this in-flight local integration authorization. The primary checkout remains
shared/integration-only; all earlier primary writers released their windows, subject to fresh
pre-integration inspection. Its exact task-owned wait handoff remains for closure cleanup.
No supporting writer, push, live HR write, operator database conversion or credential mutation
has occurred. The temporary two-worker adapter is removed from the review tree and retained at
`/tmp/hr-operator-reads-vitest-adapter.mts`; copying it back as `.operator-vitest.mts` reproduces
the approved gate command below. It imports the repository configuration and asserts only root/
project worker counts differ. Projects, assertions, isolation, timeouts and floors are unchanged.

### Independent review R1 and repair boundary

Complete reviewer `/root/sup_review_operator_reads` returned **CHANGES REQUIRED** for base
`46892ab3704526feb2c8af80e2317e39e97bde36`, implementation `8abb4cbaca50420e18b735d816ea05b93ab9c992`,
evidence `49edc838b0cdc05c3229de2127cebcbc0fb1701d`. It inspected all 79 implementation paths plus
the evidence owner and P1–P7. F1 (high/P4): child-first archive order removes membership from the
parent's frozen history. F2 (medium/P3): each candidate enumerates the full canonical corpus twice.
Actual kernel plan/apply probe failed the membership assertion and measured four list calls for
two candidates; `/tmp/hr-operator-reads-review-archive-order-probe-2.log` and corresponding observation
JSON retain the evidence. Probe lint passed. The first probe had an invalid synthetic command UUID
and is not defect evidence. No other required finding was reported.

Both findings await independent verification of the repair. The archive snapshot seam now freezes
the entire accepted candidate batch before archive mutations, using one shared canonical projection snapshot.
This requires the bounded archive call site in `src/core/command-kernel.ts`, the archive snapshot
interface and its unwired/fake implementations; it changes no command envelope, lifecycle mutation
policy, external scope or operator authority. The initial plan already required P3/P4; this is an
implementation repair, not new operator scope. Permanent real-command tests cover both UUID
orders and batch read scaling. Full gates pass; renewed complete independent review remains required.

### R2 repair candidate and gates

Fresh complete R2 is required because the repair connects the archive batch snapshot contract to
its kernel transaction caller. It covers the full original candidate plus repair and neighboring
paths; no old verdict is carried forward as acceptance. The supervisor alone authored the repair.
The reviewer will inspect primary requirements/code before reconciling this prior-finding ledger.

| Prior finding | Repair and deciding evidence; independent disposition pending |
| --- | --- |
| F1 high, P4 | The kernel obtains all snapshots before any archive mutation. Real SQLite kernel plan/apply tests cover child-first and parent-first UUID orders, frozen parent member IDs/terminal rollup and stored people rows. Reinstating per-run freezing makes both child-first tests fail with empty membership. |
| F2 medium, P3 | One captured canonical list supplies all candidate and member surfaces; freeze sections consume that same membership. Two-run and twenty-run real command batches each call list once; empty batch does not enumerate. Reinstating per-run freezing fails the parent-first bound, 2 instead of 1. |

`/tmp/hr-operator-reads-r1-negative-control.log` preserves the three intentional failures.
`/tmp/hr-operator-reads-r1-repairs-focused-final.log` passes 43/43 cases after restoring repaired
code. The initial focused run had test-only mistakes about archived disposition and fixture startup
read counts; corrected assertions use the actual canonical contract.

| Gate on implementation `9b7365d7679b21abaf9c61dea24d5381bc7320fb` | Result | Evidence |
| --- | --- | --- |
| Typecheck and lint | Both exit 0 | `/tmp/hr-operator-reads-r2-typecheck.log`, `/tmp/hr-operator-reads-r2-lint.log` |
| Full coverage, approved two-worker adapter | 447/447 files, 5,639/5,639 tests, all configured floors; 317.04 seconds; two observed fork workers and no compiler/linter contention | `/tmp/hr-operator-reads-r2-coverage.log` |
| Suite-size constituent | 350 unit, 80 architecture, 17 scenario files | `/tmp/hr-operator-reads-r2-suite-size.log` |
| Full desktop parity | 262/262 cases; wrapper 65.471 seconds | `/tmp/hr-operator-reads-r2-parity-final.log` |
| Production build, after parity exit 0 | Exit 0; existing chunk-size advisory only | `/tmp/hr-operator-reads-r2-web-build-final.log` |
| Manifest, catalog, roadmap freshness | All exit 0 | `/tmp/hr-operator-reads-r2-{manifest,catalog,roadmap}.log` |
| Documentation | Nine equal instruction pairs, all project chains below cap, owner links resolve, whitespace clean; recording checks repeated below | `/tmp/hr-operator-reads-r2-docs-audit.log` |

`/tmp/hr-operator-reads-r2-inputs.json` binds all 82 implementation paths by SHA-256; the candidate
inventory also includes this existing evidence owner. All hashes were rechecked after gates and
before commit. The adapter was removed before review. No reference was refrozen during the repair.

A supervisor scheduling error started production build while the first R2 parity run was still
active. That invalidated run had 258/262 passes and asset-404/readiness failures; logs remain at
`/tmp/hr-operator-reads-r2-parity.log` and `/tmp/hr-operator-reads-r2-web-build.log`. Both processes
finished before the clean full parity rerun and subsequent build above. No assertions, references,
timeouts or gate membership were weakened. This is avoidable execution rework, not an accepted gate.

R2 evidence-only recording passes the 23-case roadmap binding suite, lint, roadmap freshness,
nine instruction pairs/project-chain audit, owner links and `git diff --check`. Logs are
`/tmp/hr-operator-reads-r2-evidence-binding-final.log`, `-evidence-lint.log`,
`-evidence-roadmap.log` and `-evidence-docs.log` with the same prefix. The initial misspelled test
filter selected no tests and exited 1 (`-evidence-bindings.log`); it supplies no acceptance evidence.
Only this owner differs from implementation `9b7365d7679b21abaf9c61dea24d5381bc7320fb`; all 82
implementation hashes match, permitting reuse of the recorded implementation gates under D191.

### R1 candidate gates (superseded for changed repair inputs)

All following code/test/build gates ran on the exact source/test/config/dependency inputs committed
as `8abb4cbaca50420e18b735d816ea05b93ab9c992`. Only this evidence owner changes afterward.
`/tmp/hr-operator-reads-candidate-inputs.json` binds all 79 changed implementation paths by SHA-256.

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS | `/tmp/hr-operator-reads-typecheck-repairs.log` |
| `npm run lint` | PASS | `/tmp/hr-operator-reads-lint-repairs.log` |
| `npm exec -- tsx scripts/test-runner.ts run --coverage --config .operator-vitest.mts` | PASS: 447 files, 5,635 tests, all configured floors; 337.75 seconds | `/tmp/hr-operator-reads-coverage-final-2.log`; exactly two observed fork workers; no concurrent compiler/linter |
| `npm exec -- tsx scripts/suite-size.ts` | PASS: unit 350, architecture 80, scenario 17 files | `/tmp/hr-operator-reads-suite-size-final.log` |
| `npm run test:parity` | PASS: 262 desktop cases; runner 62.432 seconds | `/tmp/hr-operator-reads-parity-final.log`; required body/digest JSON evidence passed |
| `npm run web:build` | PASS; existing large-chunk advisory only | `/tmp/hr-operator-reads-web-build-final.log`; ran after parity |
| Manifest/catalog/roadmap freshness | PASS | `/tmp/hr-operator-reads-manifest-final.log`, `/tmp/hr-operator-reads-catalog-final.log`, `/tmp/hr-operator-reads-roadmap-final.log` |
| Instruction pairs/chains, links and whitespace | PASS; evidence recording rechecks below | `/tmp/hr-operator-reads-docs-audit-final.log`; `git diff --check` |

Evidence-only recording checks passed: 23 roadmap binding cases (`/tmp/hr-operator-reads-evidence-binding.log`), lint (`/tmp/hr-operator-reads-evidence-lint.log`), roadmap freshness, nine instruction pairs/chains, task-owner local links, and whitespace. The inspected diff changes only this owner; all 79 implementation hashes remain identical.

P1–P7 proofs are present; the complete independent reviewer must inspect them and the new Cancelling
reference. No PASS or task completion is inferred from these gates. Initial plan and prerequisite
identities remain in the binding table and accepted dependency record.

### Necessary reader dependency amendment

Accepted P still required a span fold for asynchronous capture admission and Context Data. Those
seams belong to T and Task 1-2. Both owners confirmed their optional-evidence repairs. P1/P4 final
acceptance must consume only their independently accepted commits. The initial either-order claim
for Task 1-3 is withdrawn: final acceptance/integration order is **{T, 1-2} → 1-3**; T and 1-2 remain
mutually independent. This necessary shared-reader prerequisite stays within the operator-approved
scope and adds no feature or external action. Record exact accepted SHAs and the resulting review
base before final acceptance.

The new real-SQLite archive proof is authored for both a standalone run and an operation member.
It calls asynchronous detail, freezes genuine missing evidence, archives through `RunRecordService`,
checks queue/workflow/status/month/Activity counts, reads immutable archive content, verifies a
member's direct-delete refusal, and deletes through the canonical root. Both cases pass on the accepted readers, with no synthetic span or skipped acceptance. `/tmp/hr-operator-reads-accepted-data-proof.log`: all eight canonical cases and 21 intake cases passed (29/29, 3.34 seconds).

### Verified evidence and remaining checks

| Area | Evidence | Status / next check |
| --- | --- | --- |
| S2 canonical reads/status | `/tmp/hr-operator-reads-s2-sixth.log`: 96/96 in four files. `/tmp/hr-operator-reads-focused-archive-3.log`: canonical no-span, real cursor-stale, heartbeat/cancellation/rename and member-delete cases passed within its 124/127 result. | Accepted-T rerun `/tmp/hr-operator-reads-s2-accepted-trust.log`: 245/245 in four files (11.42 seconds); `/tmp/hr-operator-reads-async-requeue.log`: asynchronous spanless detail and requeue 2/2 passed. All canonical/archive and combined intake cases now pass, 29/29, on accepted 1-2. New recovery-requeue test initially assumed a new attempt; canonical service test #6/#7 proves recovery preserves it. Corrected focused proof passed in `/tmp/hr-operator-reads-requeue-status-fix.log` (two selected tests total, not full-suite evidence). |
| S3 migration/history | `/tmp/hr-operator-reads-focused-storage.log`: 254/257. New A3 byte/generation preservation, populated v30/v31 settings metadata, v29–v33 restore/admission and doctor/privacy cases all passed; three unrelated new fixture/expected-version faults were corrected. | CLI corruption/restore now also proves the restored canonical run renders as Running without span evidence, preserves authority generation/write intents, and causes no unchanged snapshot churn. `/tmp/hr-operator-reads-restored-reader-2.log`: one selected test passed (2.69 seconds), with scoped lint exit 0; the initial expectation of a change notification for already-present authority was corrected to require no churn. Final full suite passed. Released SQL/digest pins are unchanged; only schema 34's `DROP TABLE runs_view` and its digest are appended. |
| S4 archive boundaries | `/tmp/hr-operator-reads-focused-archive-2.log`: 114/118; remaining four fixture faults were corrected with valid canonical admission/refusal behavior. `/tmp/hr-operator-reads-focused-ui-4.log`: affected archive-route and Activity cases 52/52, 4.87 seconds. | Both standalone and operation-member spanless freeze/readback/delete proofs now pass on accepted 1-2. Foreign-record controls now use a fully valid foreign identity/digest, so refusal cannot pass through unrelated schema failure. |
| P6 safe readback | Four upgrade phases are projected without private journal identities, paths, digests, settings entries or environment names. Doctor/API/preflight privacy and no-mutation cases passed in the storage run; corrupt journal is explicitly unavailable. | Final suite also retains existing Settings runtime/presence/refusal checks. Explorer trace is descriptor/manifest/override-only; no lifecycle migration was invented there. |
| P7 behavior | Cancelling queue band/action/count/filter and rendered Activity checks passed. Its filter appears when served or selected and retains a selected empty bucket; the original eight empty-state controls remain reachable. | Launcher/rail count wording now names Cancelling when it contributes; focused wording/count proof and scoped lint passed. Final full browser recheck passed on accepted peer provenance. |
| Targeted architecture | `/tmp/hr-operator-reads-architecture-focus.log`: 47/47, five suites, 17.95 seconds; lifecycle SQL, archive invariants, immutable migration history, strict schemas and injected redaction violations. | Final full coverage includes these guards; no extra duplicate whole architecture run required. |
| Typecheck / lint | `/tmp/hr-operator-reads-typecheck-9.log` and `/tmp/hr-operator-reads-lint-5.log`: exit 0 on accepted T plus current operator changes, including valid gate fixture, async detail, archive/member proof types and active-count wording. | Final candidate typecheck/lint passed in the frozen-candidate table. Earlier iteration failures are not passing gate evidence. |
| Browser references | New Cancelling PNG/a11y/metadata trio generated deliberately; `/tmp/hr-operator-reads-parity-cancelling-2.log`: 1/1 plus JSON evidence verification, 4.7 seconds. Image inspected: static CircleStop, readable label and explicit unsettled-worker meaning. | Initial wrapper correctly refused missing statically declared body-backed evidence; test now declares and digest-binds it. Existing reference files remain untouched by this task. Accepted-peer provenance update `/tmp/hr-operator-reads-cancelling-peer-provenance.log` passed 1/1 (6.0 seconds); PNG bytes and accessibility body match the earlier new reference exactly, and metadata uses accepted descriptor hash `3e459f4b09a28d4992efe712a98310053030f263ac11d9c0610234142f2c8df9`. Independent reference review remains open. |
| Full parity iteration | `/tmp/hr-operator-reads-parity-full-1.log`: 260/262, 1.2 minutes. Both populated-receipt failures came from a fixture that emitted gate evidence while leaving authority Running. | Fixture now performs the real fenced `parked-gate` transition. `/tmp/hr-operator-reads-parity-receipt-fix.log`: both unchanged receipt references plus Cancelling passed, 3/3, 6.9 seconds, including JSON evidence verification. No reference was changed for the defect; final parity passed 262/262. |
| Documentation | `/tmp/hr-operator-reads-docs-audit.log`: nine matching instruction pairs, largest chain 16,650 bytes; whitespace check passes. | Final freshness/audit passed; integration rechecks remain. Server twins clarify canonical archive membership admission versus immutable evidence content, as approved D330 requires. |

### Full-candidate iteration

The first complete coverage run, `/tmp/hr-operator-reads-coverage-final-1.log`, finished with
439/447 files and 5,613/5,635 tests passing in 337.13 seconds; it is failed evidence, not a
coverage PASS. Its 22 failures were stale fixture/expectation boundaries exposed by canonical
reads: old claim dates preceding the harness enqueue date, archived or gated fixtures without
matching lifecycle authority, schema 33/current+1 pins after migration 34, a counter instrumenting
the retired raw run reader, and an old assertion that orphan spans must make current counts throw.
Repairs preserve complete lifecycle sweeps, corruption/missing-state refusals, count membership,
performance bounds and all tests. The orphan case now proves canonical exclusion while retaining
its evidence; storage doctor's discrepancy proofs remain. The performance fixture parks through
its real fenced transition. Read-count proof measures one canonical admission and one list per
preview, zero raw run reads, and unchanged bounded checkpoint reads for four versus forty members.

`/tmp/hr-operator-reads-coverage-repairs-1.log`: seven corrected suites passed; only the newly
instrumented frozen reader failed. The harness now exposes an instrumentable forwarding port over
the unchanged canonical reader. `/tmp/hr-operator-reads-canonical-read-bounds.log`: all 48 cases
in read bounds and canonical operator reads pass (2.32 seconds). Full typecheck/lint and complete coverage subsequently passed; the frozen-candidate table above is the accepted gate record. The host showed exactly two Vitest fork workers, with no own
compiler/linter during coverage. The other primary writers have released their windows; committed
future plans remain out of this task's implementation scope.

### Gate and shared-file coordination

Heavy windows are serialized after observed compiler/linter contention and a shared bundle race.
Coverage uses the temporary adapter that imports the real configuration and asserts that only
root/project worker counts differ (two); projects, assertions, floors, timeouts and isolation are
unchanged. Own parity and production build are sequential. T's repaired coverage (443 files/5,566
tests) and parity (261 tests) passed; T is independently accepted and integrated. Task 1-2 passed reference assertion (261/261) and
has passed combined typecheck/lint, coverage (446 files/5,613 tests) and parity (261/261), and is
independently accepted and integrated. This task completed its released stable-gate window with all processes
exited. This task has no active test/compiler/browser
process while those windows are held. Its corrected receipt/requeue checks passed in the released
short slot; final combined gates still await accepted reader commits.

- T owns the missed failure-advisory repair: `queries/advisory.ts`, its tests, only the advisory
  binding in root `compose.ts`, and two advisory blocks in `bff-flow.test.ts`. This task's BFF
  projector/date-fixture hunks do not overlap; preserve their union when consuming accepted T.
- Task 1-2 owns only new Rerun registrations in `redaction-surface-audit.ts`; this task owns exactly
  two doctor leaf origins (`authorityUpgrades.cause.code/summary`). T has no audit edits. This task
  wires three existing archived-capture scanner calls without weakening their controls.
- Task 1-2 owns existing reference updates for its approved descriptor provenance change, including
  exact displayed short hashes where present, with text/pixel classification and independent review.
  This task owns only the new Cancelling trio and will reconcile its metadata to accepted 1-2.
  Preserving this task's existing visual behavior does not pin obsolete peer provenance.
- Shared phase overview/roadmap generation belongs to T until serialized integration. Never hand-edit
  generated output. Record final manifest/catalog/roadmap freshness and exact implementation,
  reviewer and integration identities before marking this task complete.

Initial planning verification on 2026-09-08 passed docs/link/tag/whitespace checks. Source/test/script/
config/dependency inputs were unchanged from foundation close `2dd3048f8` to planning HEAD `a57ecae8`;
that evidence applied only to planning, not this implementation.

## Original task acceptance

### Task 1-3 · Revalidate operator read models
<!-- roadmap: p2f-operator -->

- [ ] Rewire archive, Activity, Explorer, doctor, preflight, and settings-status reads.
- [ ] Prove current/queue/archive/delete counts converge and protected settings never read back.
- [ ] Own shared lifecycle status/count envelopes and the A2/A3 deletions; do not edit the trust
  evidence or intake data projections owned by Tasks 1-1 and 1-2.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D330.5: `read` and `list` are the ONLY
> lifecycle reads — never a span fold, never `runs_view`. This task lands adapter A2's deletion, so the
> `run-status-fold-contributes-no-lifecycle-arm` unit test lands in the SAME commit that deletes the two
> `run-status.ts` fold arms (§D332.9 rule 4; `ref guards-and-tests` §5.2 A2); A3's `runs_view` table is
> removed with the projector's rewire, its `runs-view-has-no-reader` arm already active from 1.6.
> Settings status reads only `ref clock-config-secrets` §D331.6's presence/revision tuple; doctor and
> preflight follow §D331.11 P16 and report the `authority_upgrades` phases (§D332.5/§D332.6). No
> redesign.
