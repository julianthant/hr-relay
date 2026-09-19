# Task 3.1.11.3 · Finalization — run operations
<!-- roadmap: dash-operations-finalizer -->

**Current assignment: 3.1.11.3.** Intake: candidates with passing focused checks from 3.1.11.1–3.1.11.2.

- [ ] combine every assigned worker candidate and verify the integrated group with focused checks
- [ ] fix group defects; pass typecheck, focused integration tests, scoped lint and affected build/generated checks
- [ ] record broad gates as deferred to 3.1.19; integrate the focused release, close worker/group records and clean up owned resources

Accepted output releases 3.1.13 Queue, 3.1.14 Detail foundation and 3.1.15 Runtime. Full repository gates and final repairs remain at 3.1.19; this is a focused development release.

Read [the group map](README.md#parallel-execution-and-worktree-contract),
[D344](../../../../roadmap/roadmap.md#parallel-finalizer-cadence) and
[D191](../../../reference/guards-and-tests.md#d191--the-recommendation-is-adopted-testcoverage-becomes-the-per-commit-gate-operator-decision-2026-08-12).
These are separate sequential repair/integration assignments, not independent parallel siblings.
The operator launches each finalizer after every listed worker has a committed candidate and green
focused checks. Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13). No independent review
step is required; worker development completion is distinct from the group release.

Before worker launch, the focused plan binds the finalizer's exact branch/worktree/base, target,
merge permission, quick worker commands, deferred acceptance checks and resource ownership.
In an isolated integration worktree, combine the exact committed candidates and reconcile generated
output. Run `npm run typecheck`, focused integration/regression tests over the changed interfaces,
scoped lint and affected build/generated checks. The focused brief names exact test/lint paths and
commands. Fix group defects, add regression proof and rerun invalidated checks on the corrected tree.
Pass this scoped verification before releasing downstream consumers; do not claim full acceptance.

Defer full coverage, whole-repository lint/architecture, broad desktop parity, production smoke,
performance, recovery and the complete acceptance matrix to 3.1.19. Retain fixtures, proof commands,
missing broad evidence and exact candidate/integration SHAs for that task. Group-specific targeted
proof remains required where it establishes a changed interface. No full suite is required just
for a group release or documentation-only recording. Preserve coverage floors, assertions, test
membership, timeouts and live-write boundaries. No independent reviewer is required.
Shared contract/scope changes require a revised plan. Other groups' files remain outside ownership.

Current baseline and acceptance: [inventory](task-8-dashboard-inventory.md) and
[frozen matrix](task-8-acceptance-matrix.md). Historical subfeature credit does not close this finalization.

## Approved execution brief — 2026-09-19

The operator approved the complete F1–F6 proposal and its documentation persistence with
“approve” on 2026-09-19. This is the single execution plan for **3.1.11.3**. Approval permits
planning-document validation, commit, local integration and owned documentation-worktree cleanup;
it does not launch product implementation or authorize product integration.

### Assignment, inputs and checkout binding

| Binding | Approved value |
| --- | --- |
| Supervisor | One operator-opened Codex supervisor, **GPT-6 Astra / medium**. Cross-layer composition, source-bound replay and integration repairs are consequential and coupled; one owner handles the sequence. |
| Allocation / review | **Zero implementation workers; zero independent reviewers.** The Phase 3.1 exception applies. No coordinator, sibling or downstream dispatch. |
| Implementation mode | Create a dedicated integration worktree after all start prerequisites are verified. Never implement in the shared integration checkout. |
| Implementation branch | `codex/3.1.11.3-operations` |
| Absolute implementation checkout | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-operations` |
| Inspected proposal baseline | Clean local `master` at `517f7319fdcd771aee8356e664f1e8a885032ba0`, including the accepted Date navigation implementation. |
| Documentation persistence base | `824521fac8795aa37f1bf66a34bfaa011bae4713`; the intervening commit records Date integration/cleanup and changes documentation only. |
| Required prerequisite | Accepted and integrated **3.1.11 Sessions**, with completed S5 shared operations, actual file/interface map, focused proof and owned cleanup. Its approved plan alone is not implementation acceptance. |
| Required worker inputs | Exact committed **3.1.11.1 Setup** and **3.1.11.2 Run/Rerun** candidates, approved briefs/ownership maps, passing focused checks, tested-input identities and retained proof/resource records. Both consume the accepted parent without an unmerged sibling API. |
| Implementation base | Resolve the actual local `master` SHA containing this committed plan and the accepted Sessions prerequisite before launch. Record and verify the full SHA and prerequisite ancestry; no future SHA is fabricated here. Combine the exact admitted child candidates in F2. |
| Integration target / owner | Local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`. This finalizer owns its combined candidate; the operator chooses product integration. After explicit instruction, the assigned supervisor/integrator preserves target changes, runs invalidated focused checks and owns cleanup. |
| Merge condition | F1–F5 pass on the final corrected inputs; operator instruction then permits product integration. Group completion and downstream release additionally require accepted integration and owned cleanup. |
| Evidence | `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.3-operations-<execution-date>/`; resolve the date at launch and retain commands, exits, tested inputs, browser evidence and cleanup identities there. |

The proposed implementation branch and path were absent during discovery and approval persistence.
At persistence start, the Sessions worktree was active; Date had completed integration and cleanup.
Names are proposals, not reservations. Recheck ownership, refs, paths and the four-auxiliary-worktree
ceiling before creation. Preserve concurrent work; uncommitted Sessions changes are not accepted APIs.

**Start status: WAITING ON.** Sessions has no accepted implementation release at the persistence
baseline, and neither child has a committed candidate. Before READY, resolve exact releases from
their owning records, verify committed content/evidence, and recheck this plan's availability on the
implementation base. Missing implementation or proof blocks intake; finalization does not substitute
for unfinished children. An absent planned finalizer branch is expected and is not itself a blocker.

### Feasibility and change ownership

Discovery inspected source, contracts, tests and Git; no runtime proof was executed by planning.
The frozen boundaries are [A05](task-8-acceptance-matrix.md#a05),
[A07](task-8-acceptance-matrix.md#a07), [A22](task-8-acceptance-matrix.md#a22),
[A23](task-8-acceptance-matrix.md#a23), [A24](task-8-acceptance-matrix.md#a24) and
[A25](task-8-acceptance-matrix.md#a25). Their linked contracts retain requirement authority.

| Question / inspected evidence | Required change and permitted owner | Proof / remaining prerequisite |
| --- | --- | --- |
| Typed preflight and `routes/settings-preflight.ts` use the retained report protocol; existing dashboard runners cover a subset of the declared fault corpus. | Setup, doctor and launch must consume the same authoritative readiness facts. F3 owns composition repairs; complete child corpus execution remains Setup's prerequisite deliverable. | P1; completed parent interface plus Setup candidate/corpus evidence. Registration alone is not executed fault coverage. |
| `start-plan-service.ts` selects settings in its authority transaction. `command-kernel.ts` checks reviewed settings; existing tests distinguish a stale unsubmitted plan from accepted replay after a save. | Preserve current snapshot selection, refusal without stale-plan consumption, and the original run/snapshot on accepted replay. | P2 through the combined client, settings service, planner and command path. |
| Planner/kernel retain source/version and warning facts. Source-eligibility tests cover planning and historical persisted-plan consumption. The write sequencer binds intentional repetition to the confirmation command and excludes another run's checkpoint from replay. | Preserve source immutability, protected-value handling, renewed acknowledgment, singular final replay and accepted source-bound repeat semantics. | P3/P4; consume the Run/Rerun child and accepted backend protocol, with no second launch/recovery route. |
| Current Run-modal reference tests explicitly use fixture plans. Existing tests cover pieces, not combined browser/service composition. | F4 supplies production-service and built-browser correlation for Setup, ordinary Run and Rerun. Fixture pictures alone cannot prove enqueue/refusal/replay effects. | P1–P6; reuse equivalent child proof only with verified unchanged inputs. |
| Parent S5 owns common registration and callable APIs; children own disjoint consumers. Accepted Date navigation changed shared app/date/authority composition. | F2/F3 preserve Date navigation, dirty Settings and Intake upload/focus while repairing shared group registration/schema/fixture/generated interfaces. | Either-order compatibility and P6; require the parent's actual exported-operation/file map before intake. |

The prior [3.1.9.8 delivery assessment](task-9-8-finalization-dashboard-surfaces.md#delivery-assessment-and-deferred-acceptance)
found fixture narrowing and unregistered disposable writers. Run combined checks early and
register/await every owned test process, including failure paths. Its retained 13 broad-ratchet
findings remain assigned to 3.1.19; this focused release does not claim they passed.

### Ordered execution and repair ownership

1. **F1 — Admit inputs.** Verify Sessions acceptance/shared API completion, both exact child
   candidates, approved ownership, focused receipts and tested-input/resource identities. Record
   parent integration SHA, child SHAs, plan SHA and implementation base. Resolve retained evidence.
   Missing implementation or proof blocks intake; do not consume uncommitted work or failed checks.
2. **F2 — Combine candidates.** Combine exact child commits in the isolated finalizer worktree.
   Verify either-order compatibility and retain the comparison/conflict disposition. Reconcile
   generated output from source. Preserve accepted target work, especially Date navigation, Settings
   and Intake. An incompatible shared ownership contract returns for amendment; do not silently
   add a worker dependency or discard either intent.
3. **F3 — Repair group defects.** Own corrections across the consumed Setup/Run/Rerun files and
   their shared app/client/BFF registration, schemas, fixtures and narrowly required command/session
   interfaces. Add meaningful regressions and recheck neighboring cases. Routine repairs remain
   local; new product semantics, unrelated work or required changes outside this group need amendment.
4. **F4 — Prove combined behavior.** Execute P1–P6 through production services and the built
   browser. Reuse child evidence only where relevant inputs and covered behavior remain unchanged.
   Retain authority/effect correlation, positive controls and refusal/uncertainty results.
5. **F5 — Gate and freeze.** Pass combined typecheck, focused tests, scoped lint and affected
   browser/build/generated checks. Repair failures and rerun invalidated checks. Commit logical
   categories using exact paths; record candidate SHA, tested inputs, commands, exits and deferred
   proofs. No independent review applies.
6. **F6 — Integrate and close.** After operator instruction, integrate into current local `master`,
   preserve intervening work and rerun invalidated focused checks. Retain evidence, then remove only
   accepted owned branches, registered worktrees, physical folders and processes. Close integrated
   worker/group records after cleanup. Release existing downstream dependencies without launching them.

All paths below are repository-relative. Repair ownership follows the verified consumed candidate
maps; it does not authorize replacing missing child implementation.

| Area | Permitted responsibility |
| --- | --- |
| Setup | Consumed `src/server/preflight/`, `src/domain/trust/preflight-scenarios.ts`, `settings-preflight*`/`preflight-popover*` presentation and preflight-only client/state/route modules. |
| Run/Rerun | Consumed `src/dashboard/surfaces/run-start*.ts*`, extracted `app/run-launch*`, prior-value transport and launch services, including `src/server/dashboard/commands/start-plan-service.ts`. |
| Shared integration | Group-related app/client/BFF registration and composition, including `dashboard-app.tsx`, command/client composition, `src/server/dashboard/compose*` and routes; common wire schemas/fixtures and narrowly required command/session interfaces. Preserve unrelated sections and parent control semantics. |
| Proof / generated outputs | Affected child tests/scenes and the combined tests/helpers below; affected source-generated manifest/catalog/roadmap and parity registration/reference pairs. Guard additions/retirements require inventory updates and deciding evidence. |
| Records | This owner and accepted worker/group completion records, roadmap and retained evidence. No competing plan. |

### Combined proof matrix

| ID | Boundary / positive control | Required negative or interleaving evidence |
| --- | --- | --- |
| **P1** | Setup → authoritative readiness → launch. Valid setup reaches the actual admitted path; explicit repair/recheck reflects retained results. | Unavailable/stale/failed checks remain explicit. Blocked admission creates no browser/transaction effects. Verify the complete Setup fault corpus. No inferred health or automatic repair. |
| **P2** | Settings save → preview → final submit selects current committed settings; existing runs retain their snapshots. | Saving after preview requires fresh review without consuming the stale plan. Already accepted replay returns the original run/snapshot. Prove both branches at the actual command boundary. |
| **P3** | Rerun → Steps → optional warning → Values preserves defaults, editable prefill, source identity and submitted omissions. | Cancel returns to Steps; warning Confirm advances only to Values. Navigation and edits create no run/trace identity, queued publication or transaction. Keep acknowledgment only while warning facts are unchanged; renew after selection/business-key/source/evidence changes. |
| **P4** | Final submit → retained result → recovery/replay yields one committed identity per accepted command, including response loss and restart. | Reject divergent reuse; preserve source bytes, protected values and stale/deleted/archived-source and UNKNOWN-write refusals. Preserve accepted source-bound fresh execution/repeat-occurrence semantics and no new proof for omitted transactions. |
| **P5** | Launch → accepted session/runtime → worker claim correlates committed identity and eventual execution. | No-worker/delayed-worker states remain truthful; pause/control outcomes survive composition. `supersede-active` final submit applies the reviewed policy atomically; intervening conflicts require new review. No invented identity, duplicate enqueue or pre-admission browser/transaction effect. |
| **P6** | Built Setup and ordinary/Rerun journeys in both themes preserve keyboard/focus, Intake handoff and Date navigation. | Exercise loading/refusal/uncertainty, reload and stale results. Retain child desktop resize and actual browser-zoom proof or rerun invalidated cases. CSS zoom, device scale and resizing do not prove actual browser zoom. |

Use the [desktop evidence allocation](task-8-acceptance-matrix.md#desktop-evidence-allocation):
1280×720 and 1440×900 at 100%, minimum-canvas resizing, and affected Setup/Steps/warning/Values/
final-submit cases at actual 125%/200% browser zoom with browser version/effective CSS viewport.
This is focused group proof, not full D01–D05 acceptance. Use `/ui`, Verification lead, locally,
and the prescribed `playwright-cli` playbook for manual inspection. Inspect the specimen before
choosing primitives for visible corrections. Preserve both themes, accessibility and reference
identities; any changed pixel/a11y/provenance pairs require deliberate attribution.

Use isolated production services and real browser/process boundaries where the proof claims them.
Fakes can inject deterministic faults but cannot alone prove actual process/browser effects.
No standing operator database or deployed target changes; actual-target migration/deployment preflight
is therefore outside this assignment. Transaction-bearing runtime checks use `dryRun=true` and zero
external HR writes. Synthetic sequencer tests retain isolated fake adapters and are not live HR
acceptance. Current live correlation remains with 3.1.18/3.1.19.

### Focused gate and resource schedule

Run from the absolute finalizer checkout. Execute combined typecheck early after F2 to expose
cross-child composition/fixture failures. During F3 use affected selectors; before F5 establish
required results on the final corrected inputs. Existing baseline selectors:

```sh
npm run typecheck

npm run test -- \
  tests/unit/preflight-dashboard-runners.test.ts \
  tests/unit/server/preflight-runners.test.ts \
  tests/unit/dashboard/preflight-client.test.ts \
  tests/unit/dashboard/start-plan-contract.test.ts \
  tests/unit/server/start-plan-omissions.test.ts \
  tests/unit/server/rerun-values.test.ts \
  tests/unit/rerun-source-eligibility.test.ts \
  tests/unit/source-bound-repeat.test.ts \
  tests/unit/command-kernel.test.ts \
  tests/unit/dashboard/run-start-dialog.test.ts \
  tests/unit/dashboard/run-start-focus.test.ts \
  tests/unit/server/worker-pool-composition.test.ts

npm run test:parity -- \
  tests/parity/reference-start.spec.ts \
  tests/parity/settings-activation.spec.ts \
  tests/parity/pool-control-desktop-target.spec.ts \
  tests/parity/date-navigation.spec.ts \
  --workers=4
```

Assign missing combined proof to `tests/unit/server/run-operations-integration.test.ts` and
`tests/parity/run-operations-integration.spec.ts`, with task-owned helpers under existing fixture/helper
directories. These are assigned future files, not existing passing tests. Run:

```sh
npm run test -- tests/unit/server/run-operations-integration.test.ts
npm run test:parity -- tests/parity/run-operations-integration.spec.ts --workers=4
```

Reuse equivalent child tests when they cover these boundaries; record exact replacement selectors
and coverage before execution. Include affected child selectors and rerun those invalidated by
repairs. Missing/renamed selectors require verified equivalents, not silently reduced coverage.

Run `npx eslint <exact changed code/test paths> --max-warnings 0` using an argument array covering
both children and finalizer repairs. Resolve the real base, collect changed `.ts`/`.tsx` paths with
`git diff --name-only --diff-filter=ACMR <verified-base> -- '*.ts' '*.tsx'`, include new proof files,
and retain the exact invocation. Do not use shell word splitting or omit consumed child changes.

Parity builds and verifies the source-bound candidate bundle; use a separate `npm run web:build`
only when that lane does not establish affected build proof. Run `npm run build:manifest` then
`npm run build:manifest:check` for affected descriptor import closures, and `npm run stores:catalog`
then `npm run stores:catalog:check` for affected catalog inputs. Task records require
`npm run roadmap`, `npm run roadmap:check`, relevant link/instruction checks and `git diff --check`.
Never hand-edit generated output or bulk-refreeze unrelated references.

Vitest's configuration caps file workers at four; verify effective configuration. Parity overrides
its default with `--workers=4`; verify that count. Preserve suite membership, isolation, assertions,
floors and timeouts. Each proof owns fresh state/artifact/auth/lock roots, ephemeral ports and
registered child handles. Do not use standing rebuild ports 3938/5174 or another task's runtime.
Await cleanup even on failure. Serialize build/parity/generation writes sharing this checkout;
independent worktrees may continue. Resolve actual contention, not a speculative global gate queue.
Never close another task's processes or browser sessions.

Reuse passing evidence only with command/result, tested commit/tree and an inspected diff proving
relevant code/test/config/dependency inputs unchanged. Corrections, failures, missing evidence,
uncertainty or target drift require affected reruns. At operator-directed integration, recheck exact
candidate/target identity and run invalidated checks. Recording-only commits use scoped documentation
checks; a new documentation SHA alone does not require duplicate implementation gates.

### Deferred proof, exclusions and stop conditions

Full coverage, whole-repository lint/architecture, broad desktop parity, production/performance/
recovery/live acceptance and complete A01–A42/D01–D05 remain **3.1.19**. Preserve fixtures, commands
and known missing/failed broad evidence for that task. P1–P6 targeted group proof is not deferred.
A focused release is not full Phase 3.1 acceptance; no unrun check is reported as passed.

Do not add product semantics, unfinished child implementation, unrelated Queue/Detail/Runtime work,
new workflow admission, mobile variants, new recovery policy, standing-database changes, real HR
transactions, legacy live-state access, cutover, push or automatic downstream dispatch. Preserve
UNKNOWN-submit refusal and write-safety boundaries. Stop dependent work for missing/changed
prerequisites, incompatible shared ownership, unavailable required proof, material contract choices
or required changes outside this group. Routine within-scope repairs remain local; do not re-ask
settled behavior or transfer known conflicts to unspecified future discovery.

### Current state and planning persistence

| State | Record |
| --- | --- |
| Approval | Complete F1–F6 proposal and documentation persistence approved 2026-09-19. |
| Implementation | Unstarted; no implementation checks or runtime acceptance executed by planning. |
| Prerequisites | WAITING ON accepted/integrated Sessions and both committed, focused-green child candidates with approved ownership/proof records. |
| Planning checkout | `codex/plan-3.1.11.3` at `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-operations-plan`, based on `824521fac8795aa37f1bf66a34bfaa011bae4713`. |
| Planning integration | This planner is authorized to validate, commit and integrate the approved planning documents into local `master`, then clean up its documentation worktree/ref. Product merge permission remains separate. |
| Release | Group/downstream release stays open until F1–F6 acceptance, operator-directed integration and cleanup. |

Planning validation and final commit/integration/cleanup receipts are retained in the
[planning evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.3-plan-2026-09-19/).
Maintain this compact state during execution. Send Done / Now / Remaining once at start or genuine
resume; later updates report newly verified completions with concise evidence and new blockers or
decisions. Routine transfer uses this phase record; interrupted unique state uses `/handoff`.
Issue a supervisor launch prompt only after committed-content, gates and prerequisite checks establish
READY; do not supply a future implementation base or claim missing candidates exist.

### Planning validation — 2026-09-19

| Check | Result / evidence |
| --- | --- |
| Roadmap binding | `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts`: 1 file, 24 tests passed. |
| Scoped lint | `npx eslint scripts/generate-roadmap.ts tests/unit/architecture/roadmap-doc-binding.test.ts --max-warnings 0`: passed. |
| Generated output | `npm run roadmap` and `npm run roadmap:check`: passed; roadmap HTML was generated, never hand-edited. |
| Links / instructions / diff | All 15 owner links resolve; 9 existing instruction pairs match; 18 project instruction chains remain below 32,768 bytes (maximum 19,308); `git diff --check` passes. |
| Scope / gate preflight | Exactly 3 planning/roadmap paths changed. All 16 existing implementation test selectors resolve; 2 additional selectors are explicitly assigned future proof files. No product code, tests, configuration or dependencies changed. |
| Runtime acceptance | Not run or reused. Documentation checks do not certify implementation. Prerequisite intake remains WAITING ON, and broad acceptance remains 3.1.19. |

The evidence directory retains the reproducible documentation check script, full gate logs and
tested file hashes. The final receipt records the exact plan/target SHAs, committed-content audit,
authorized documentation integration, branch/worktree cleanup and post-integration prerequisite check.

### Run/Rerun ownership amendment — 2026-09-19

The operator approved 3.1.11.2 ownership of the narrow served Rerun action/root-dispatch hookup
and source-bound warning-preview service/transport. The [child amendment](task-11-2-make-run-and-rerun-enqueue-real-work.md#approved-launch-ownership-amendment--2026-09-19)
controls exact portions and proof and supersedes this brief's blanket parent/shared registration
allocation for those two operations. Admit them with the Run/Rerun candidate, preserve Setup's
accepted preflight hooks, and verify either-order composition. All other shared integration,
fixtures, generated output, focused finalizer gates and operator-directed release remain here.
