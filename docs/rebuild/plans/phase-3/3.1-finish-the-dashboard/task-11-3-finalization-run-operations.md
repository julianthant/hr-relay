# Task 3.1.11.3 · Finalization — run operations
<!-- roadmap: dash-operations-finalizer -->

**Focused release accepted 2026-09-21.** Local integration and owned cleanup are complete; see
[accepted integration and cleanup](#accepted-integration-and-cleanup--2026-09-21). Earlier pending
intake/integration statements below describe the frozen candidate. Full acceptance remains 3.1.19.

**Current assignment: 3.1.11.3.** Intake: candidates with passing focused checks from 3.1.11.1–3.1.11.2.

- [x] combine every assigned worker candidate and verify the integrated group with focused checks
- [x] fix group defects; pass typecheck, focused integration tests, scoped lint and affected build/generated checks
- [x] record broad gates as deferred to 3.1.19; integrate the focused release, close worker/group records and clean up owned resources

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
| Supervisor | One operator-opened Codex supervisor; the operator selects the model and effort under the current personal instructions. Cross-layer composition, source-bound replay and integration repairs remain one coupled assignment. |
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

**Start status at launch: READY for finalizer intake**, reverified on 2026-09-21 in the
[release reconciliation](#verified-finalizer-intake--2026-09-21) below. The initial 2026-09-19
persistence waited for Sessions and both children; those required releases now exist. Recheck the
exact candidate identities, retained evidence and this plan's availability before implementation.
Missing or changed proof blocks dependent intake; finalization does not substitute for unfinished
children. An absent planned finalizer branch is expected and is not itself a blocker.

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
| Implementation | Operator launched 2026-09-21. F1–F6 complete; focused candidate accepted into local master and owned cleanup verified below. |
| Prerequisites | Consumed both complete child candidates and approved ownership exceptions after repeated identity/evidence checks. Combined focused gates pass; product integration and owned worktree cleanup are complete. |
| Planning checkout | `codex/plan-3.1.11.3` at `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-operations-plan`, based on `824521fac8795aa37f1bf66a34bfaa011bae4713`. |
| Planning integration | This planner is authorized to validate, commit and integrate the approved planning documents into local `master`, then clean up its documentation worktree/ref. Product merge permission remains separate. |
| Release | Focused group release accepted after F1–F6, operator-directed integration and cleanup; no downstream task launched. |

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

### Verified finalizer intake — 2026-09-21

After the operator reported the children done, this planning continuation verified their committed
execution records, raw gate logs, exact candidate trees, retained input hashes and clean checkouts.
This resolves the earlier WAITING ON state within the existing approved F1–F6 scope; it does not
claim combined runtime acceptance, launch implementation or authorize product integration.

| Input / release | Verified identity and evidence |
| --- | --- |
| Integrated prerequisite | Sessions `c90da4ffc45ddfe6486192b8df68816dc6fe34a3`, followed by the accepted shared preflight admission release `ef050d0a8cb99aa39b54f726b2bdd5269f125dfa`. Both are ancestors of the current integration base and both child candidates. The parent record owns the actual shared interface map and its retained limits. |
| Setup candidate | `9ac176dd77198c29c33134de3d43f45f00f18ebb`, tree `933a8da32e1d2bda118959e28506db4577293969`, on `codex/3.1.11.1-setup` at `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-setup`; base `dac7528a12be884542d36355492fafcdffb63a30`. Consume the full candidate, including its implementation and recording commits. |
| Setup evidence | [Frozen receipt and focused logs](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.1-setup-2026-09-19/implementation/): `freeze.json`, `final-gates.json` and `final-tested-inputs.json`. All **2,570** recorded hashes match committed candidate blobs. Detector/corpus/admission/recovery 194, architecture 63, UI 20, selected ingress 7 and guard membership 1 pass; 33 browser cases pass, with actual 125%/200% browser zoom proof. Scoped lint, typecheck, build and affected generated checks pass. |
| Run/Rerun candidate | `9e3060d3ef73fba127fc945dd80398e1bc3bd0a0`, tree `ba9852e5d45d80fefc1fb7d0cdf8c5f9cec0caf7`, on `codex/3.1.11.2-run-rerun` at `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-run-rerun`; base `94766a1cc54227969462e9ce3b108144c7277723`. Consume all three commits: implementation, reference attribution and recording. |
| Run/Rerun evidence | [Frozen receipt and focused logs](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.2-run-rerun-2026-09-19/): `final-receipt.json` and `tested-inputs.json`. All **148** recorded changed-input hashes match committed candidate blobs. The five focused groups pass 104/147/69/13/17 tests; 25 browser cases pass, with actual 125%/200% zoom proof. Scoped lint, build and affected generated checks pass. Its supplemental typecheck covers only changed-file imports, not the finalizer's combined full typecheck. |
| Integration base | Clean local `master` at `94766a1cc54227969462e9ce3b108144c7277723` before this recording update. The finalizer creates its worktree from the verified descendant containing this committed readiness update; the delivered launch prompt names its full SHA. Preserve any later target changes and recheck ancestry. |
| Composition preflight | Child implementation path sets are disjoint. Object-only `git merge-tree --write-tree --name-only` succeeds in both child orders with the same tree `3da80daca92996d2b5fb771caa856c0504674dd1`. No product branch, checkout, index or integration target was changed by this calculation. F2 still combines the candidates on the actual finalizer base and F3–F5 establish combined behavior. |

The [Setup task owner](task-11-1-finish-setup-and-preflight.md) contains its execution record in
candidate `9ac176dd77198c29c33134de3d43f45f00f18ebb`, including the “Authorized bounded repairs”
section. It records three operator-approved exceptions: feature-scoped provider
availability in the existing preflight domain contract; the explicit unavailable preflight route in
the shared fixture BFF; and the ten missing Sessions origin declarations in the redaction audit.
Admit those bounded repairs together with the previously approved Run/Rerun ownership amendment;
they do not transfer further shared-root ownership or introduce a child dependency.

Carry the exact affected child selectors into F4/F5 as already required by this brief. Setup's
receipt names the actual corpus/admission/readiness tests and `tests/parity/setup-preflight.spec.ts`;
Run/Rerun's receipt names the source/warning/supersede/replay tests plus
`tests/parity/run-rerun.spec.ts` and `tests/parity/run-rerun-authority.spec.ts`. Reuse them instead of
the two proposed new combined files only where they prove the same P1–P6 boundary on the combined
inputs; add missing crossover regression proof under the approved ownership. Run the combined full
`npm run typecheck`, focused integration tests, scoped lint and affected build/generated/browser
checks. Passing separate candidates and a clean textual merge do not satisfy those gates.

Setup retains one inherited paired-recovery limitation: restore repairs SQL authority and clears
the interruption marker, but preserved custody makes the storage doctor report `preserved authority
directory contains an unexpected entry`, so preflight stays unhealthy. Preserve that evidence;
comprehensive storage recovery/repair remains 3.1.19. Parent supplemental failures and all broad/live
acceptance deferrals remain explicit. No failed or unrun check becomes a pass at this handoff.

Both child tracked/untracked working trees are clean and their receipts close owned proof processes;
their branches/worktrees intentionally remain for finalizer integration and cleanup. Three auxiliary
worktrees were present before readiness persistence: Setup, Run/Rerun and an unrelated UI planning
checkout. This continuation temporarily uses the fourth slot at `hr-worktree-operations-plan`, then
removes it. The assigned finalizer branch/path remain absent and available for creation; recheck
capacity at launch. Preserve the UI checkout and every peer resource.

Retained [readiness evidence](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.3-ready-2026-09-21/)
contains the reproducible intake verifier, candidate/log hashes, either-order object comparison and
the final documentation gate/integration/cleanup receipt. Planning reused the prior scope approval;
the current instruction that the operator selects model/effort supersedes this plan's earlier model
assignment. Zero implementation workers and no independent review remain unchanged. Product merge
into local `master` still requires operator instruction after the passing finalizer candidate.

### Execution state — 2026-09-21

**Frozen F1–F5 record; F6 is now closed by the accepted integration below.** The operator launched this assignment from
approved plan/implementation base `db8433c83830a0c23b980be13abaa190761ff975` on
`codex/3.1.11.3-operations` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-operations`.
The exact recording tip and tree are bound in `final-receipt.json` in the
[execution evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.3-operations-2026-09-21/).
No worker, independent reviewer, push or sibling/downstream dispatch was used.

| Stage | Verified result |
| --- | --- |
| F1 · intake | Repeated the committed plan, prerequisite ancestry, child identity, ownership and evidence checks. All **2,718** recorded child hashes match committed blobs; child checkouts were clean. Local master was unchanged at launch. Three auxiliary worktrees existed before creating the fourth, assigned finalizer checkout. `launch-preflight.json` and `intake-verification.json` retain exact identities. |
| F2 · composition | Consumed both full child histories, including Setup's three bounded exceptions and Run/Rerun's dispatch/warning-preview amendment. Both orders on the actual base produce tree `82fa9c98a7cad0b660552d40df66ae4bc33eedeb`; merge commit `2e161faab9ce3ca073e9bea454f30f2383a1ba20` contains both full candidates. `composition.json` records the object comparison. |
| F3 · repairs | Commit `176c6e0fc` preserves `previewWarnings` in two real-service test adapters, registers the new warning wire in the existing redaction audit, and adds the assigned shared-authority crossover fixtures/tests. No further product source change was needed. Commit `46f4d355fd8c4454332a7aaf993c62b51b4dc142` deliberately attributes the composed preflight header references. |
| F4 · proof | The P1–P6 mapping below ran against the combined inputs. Both new crossover tests have a retained failure demonstration: removing admission from the owned fixture makes the unit assertion and both themed browser cases fail; the exact fixture hash was restored before final green gates. |
| F5 · gates/freeze | Full typecheck, 52 focused test files, all 69 affected browser cases, scoped lint, descriptor generation/check and guard membership pass. Exact commands, exits, logs and input hashes are retained. Documentation generation/binding/link/instruction checks bind this recording; `final-receipt.json` identifies the immutable candidate. |
| F6 · integration/closure | Operator invoked `/worktree-sweep` on 2026-09-21. Exact candidate integrated; unchanged-input gates verified; all three incorporated worktrees and branches removed after preserving ignored contents. Focused group and child records closed below. |

The added crossover fixture uses the same real SQLite authority, preflight detectors/admission,
planner, command kernel and lifecycle. Its HTTP unit test proves a healthy preview, a late fault
refusal without plan consumption, explicit repair/recheck, one committed queued run, and read-only
accepted replay after health fails again. Both themed built-browser cases correlate Setup refusal
and explicit repair with ordinary Run admission and exactly one final-submit publication.
Person Lookup has no transaction nodes and rejects a dry-run request; this synthetic queued-only
proof therefore uses its supported ordinary mode, with worker/write effects wired to throw.
No external HR transaction or workflow execution occurs in that fixture.

| Proof | Executed coverage on combined inputs |
| --- | --- |
| P1 | All Setup detector/corpus/admission/readiness selectors in `focused-selectors.json`, including the 14 fault manifests and healthy/dependency controls; built `setup-preflight` plus the new shared-authority unit/browser crossover. Missing, stale and unavailable facts remain explicit; repair requires recheck. |
| P2 | `settings-activation/{save-create,stale-plan,mixed-execution,retry-child}.test.ts`, planner/kernel tests and built `settings-activation.spec.ts`: committed settings selection, stale unconsumed review and original accepted replay/snapshot. |
| P3 | Launch, Rerun, Values, warning, omission, focus and source eligibility selectors; built `run-rerun.spec.ts` and `run-rerun-authority.spec.ts`. Steps/Cancel/Confirm-to-Values and editable prefill preserve zero pre-submit effects. Native zoom repetitions verify keyboard access and focus return. |
| P4 | Command kernel, source-bound repeat, protected identity, source eligibility, recovery and replay selectors plus built authority cases: singular accepted identity, divergent/refused inputs, source preservation, UNKNOWN refusal and source-bound execution semantics. |
| P5 | `start-plan-supersede.test.ts`, `worker-pool-composition.test.ts`, source-bound execution and built `pool-control-desktop-target.spec.ts`/Run authority cases: reviewed supersede interleavings, claim/correlation and truthful no-worker/delayed-worker states. New crossover remains queued with no worker. |
| P6 | Nine built specs cover Setup, ordinary/Rerun, Settings, pool controls and Date; Run reference cases retain Intake handoff. Both themes, desktop/minimum-canvas sizes, accessibility and keyboard assertions pass. Fresh native 125%/200% zoom proves affected Setup/doctor and Steps/warning/Values/final-submit journeys. |

| Final gate | Passing evidence |
| --- | --- |
| Full typecheck | `typecheck-final-serial.json`: `npm run typecheck`, exit 0. |
| Focused tests | `focused-final-serial.json`: **52 files / 819 tests**, exit 0. `focused-selectors.json` contains every baseline selector and affected child selectors, plus the new crossover. |
| Scoped lint | `lint-final.json`: all **69** changed TypeScript/TSX paths from the real base, exit 0. The later type-only fixture annotation is covered by `lint-type-annotation.json`; all other lint inputs are unchanged. |
| Built browser | `parity-final-assert.json`: **69 cases**, nine specs, four workers, exit 0; source-bound bundle built and verified by the parity lane. `parity-final-output/` retains assertion output, screenshots and accessibility/effect attachments. |
| Generated/guards | `manifest-generate.json`, `manifest-check.json` and `guard-membership.json`: exit 0. No generated manifest diff. Catalog declarations/generator inputs are unchanged, recorded in `generated-scope.json`; no catalog regeneration required. No guard file added/retired, and the consumed guard inventory is preserved. |
| Reference attribution | `reference-attribution.json`: **54 PNGs and four accessibility snapshots**, exact before/after hashes. Only the three affected Start/Rerun/Settings specs were refreshed after inspecting the shared preflight header/date-width changes. Metadata and unaffected accessibility output remain unchanged; assertions/tolerances were preserved. The final browser run asserts these references. |
| Native browser zoom | `manual-zoom-index.json`: Chromium **153.0.8010.12**, native `chrome.tabs.setZoom/getZoom` through a task-owned extension, controlled by `playwright-cli`. 125% at 1280×720 yields **1024×576 CSS**; 200% at 1440×900 yields **720×450 CSS**. CSS zoom and visual scale remain 1. Keyboard recheck/remedy/warning/final-submit and focus return pass. The 200% Rerun accepts exactly one synthetic dry-run command and retains its queued identity. |
| Documentation | `roadmap-generate.json`, `roadmap-check.json`, `roadmap-binding.json`, `docs-lint.json` and `docs-check.json` retain generation/check, binding tests, lint, local links, identical instruction twins, chain limits and clean diff checks. |

Gate input snapshots establish unchanged implementation/test/config/dependency inputs through the
recording-only commit; `final-receipt.json` records that comparison. Vitest resolves to four file
workers with isolation; parity explicitly ran four. Assertions, suite membership, coverage floors
and timeouts remain unchanged. No separate web build is claimed beyond the source-bound parity build.

Initial failed iterations remain evidence, not passes: full typecheck exposed the two incomplete
adapters; the combined redaction audit exposed its missing warning schema registration; scoped
browser assertion exposed the composed header references. New fixture/test typing and browser
locator/contract mistakes were corrected within the same repair group. A concurrent full typecheck
and focused run experienced severe host slowdown and three test timeouts; unchanged inputs passed
when those gates were serialized. The exact external cause is unproven; no timeout was relaxed and
no peer was stopped. Manual capture-script mistakes are recorded in `manual-zoom-index.json`;
settled screenshots preserve native focus scroll on the minimum desktop canvas. Accepted synthetic
submission identities were read back before any fresh isolated proof; no UNKNOWN submit was retried.

Owned manual servers, ephemeral ports and browser session are closed, with readbacks and exact
resource checks in `owned-proof-cleanup.json`. Failed-start synthetic state was retained before
removing its identified temporary roots. Other isolated synthetic state remains inside the evidence
directory. No peer resource was closed or removed. Worktree cleanup is part of pending F6, not this
proof-process shutdown.

### Retained limits and delivery assessment

Setup's inherited paired-recovery limitation remains: restore repairs SQL authority and clears the
interruption marker, but preserved custody yields `preserved authority directory contains an
unexpected entry`; preflight remains unhealthy. The parent supplemental run-deletion, wire-connectivity
and Settings-reference failures retain their original evidence. The specifically assigned combined
Settings cases pass here; that does not clear all supplemental parent failures. Full coverage,
whole-repository lint/architecture, broad parity, production/performance/recovery/live acceptance and
complete A01–A42/D01–D05 remain **3.1.19**. Synthetic adapters and isolated browser services are not
live HR acceptance or cutover evidence.

Delivery assessment: one coupled finalizer repair group, no implementation workers or review rounds.
The missing adapter method and audit registration were implementation/proof integration defects
within the approved plan. Reference reconciliation and crossover proof were assigned work, not new
scope. No new planning amendment or assignment resizing was required. Fixture/capture-script mistakes
caused local reruns; earlier service-contract/type verification and preserving browser focus scroll
would have avoided those iterations. Host slowdown was observed, but its cause is unknown. Compaction
alone is not counted as a defect; no lost-state obligation was identified. Logs retain actual gate
durations, without an inferred savings estimate or quality score.

F6 must recheck candidate/target ancestry and ownership after operator instruction, preserve target
drift, run invalidated focused checks, integrate locally, retain receipts, then remove only accepted
owned branches/worktree registrations/folders and close child/group records. Existing downstream
dependencies may release only after that completion; this task never launches them. No product
integration, push, child worktree deletion or downstream release has occurred at this freeze.

### Accepted integration and cleanup — 2026-09-21

The operator invoked `/worktree-sweep` after the finalizer froze its candidate. The integrator
verified local `master` remained at `db8433c83830a0c23b980be13abaa190761ff975`, then merged the full
Operations candidate `2c81ebd84bc4ee911a56f65cafdcd3784d721686`, which contains both complete child
histories. The initial merge tree exactly equals candidate tree
`08619e7f076072e714b1285434a6fb2fcf51198b`; no conflict or product repair occurred.

All 2,890 recorded candidate file hashes, 15 retained evidence hashes and gate receipt/log/input
hashes were independently checked. The passing combined typecheck, 819 focused tests, 69 browser
cases, scoped lint and affected generated checks remain valid on unchanged implementation inputs.
The integration commit additionally records closure and regenerates the roadmap; scoped
documentation checks cover those changes. The final merge SHA and exact check outcomes are in the
[sweep receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/worktree-sweep-2026-09-21/final-receipt.json).

Before ordinary worktree removal, every ignored entry in Setup, Run/Rerun and Operations was
archived and hash-verified outside the checkouts, including local browser/build/test evidence and
dependencies. Fresh process cwd, argv and open-file inspection found no candidate activity. All
three worktree registrations, physical folders and incorporated branches are absent. The dirty UI
planning worktree and primary dependency/runtime roots were preserved.

This closes the focused development release and its group/child integration obligations. It does
not clear the inherited paired-recovery refusal, parent supplemental failures or deferred full
coverage, whole-repository lint/architecture, broad parity, production/performance/recovery/live
acceptance and A01–A42/D01–D05 at 3.1.19. No push, independent review or successor dispatch occurred.
