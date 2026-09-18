# Task 3.1.11 · Finish sessions, worker pools, and browser lifecycle
<!-- roadmap: dash-sessions -->

**Current assignment: 3.1.11.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Make plan/spawn/pause/resume/stop/refresh/reopen each execute a real supervisor effect and prove durable membership,
  claims, browser instances, crash/restart, CAS, resize, parallel runs, and orphan cleanup.

Before closing this prerequisite, bind disjoint Setup and Run/Rerun paths, fixtures, generated
outputs and gate resources. Complete shared session-interface changes and demonstrate that both
children can pass independently and merge in either order from this accepted base.

I22/A22 records the precise remaining gaps: pause/resume lack dashboard controls; refresh/reopen
lack both controls and a cross-process browser channel. Existing named refusals are honest baseline
behavior, but cannot close the required operation. This prerequisite owns the channel, selected-target
identity/ownership checks, command adapters and per-operation effect/refusal/uncertainty proof.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-18

The operator approved choices **1 A / 2 A**, then approved the complete S1–S6 proposal in
`Plan Phase 3.1.11` on 2026-09-18. This is the single implementation plan for **3.1.11**;
planning approval does not complete the task or authorize product integration. The ratified
[control protocol](../../../reference/execution-and-sessions.md#session-controls-amendment-2026-09-18)
and [presentation amendment](../../../reference/dashboard-surfaces.md#session-controls-presentation-2026-09-18)
own the requirements. [A22](task-8-acceptance-matrix.md#a22) remains the acceptance boundary.

### Assignment and checkout binding

| Binding | Approved value |
| --- | --- |
| Supervisor | One operator-opened Codex supervisor, **GPT-6 Astra / medium**. Database admission, asynchronous effects, retained browser resources and UI readback are consequential, coupled work; one owner implements the sequence. |
| Allocation / review | **Zero implementation workers, zero reviewer assignments.** No independent review under the Phase 3.1 exception. Do not create siblings or a coordinator. |
| Mode | New dedicated worktree; never implement in the integration checkout. |
| Branch | `codex/3.1.11-sessions` |
| Absolute checkout | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-sessions` |
| Inspected baseline | `faa8b2165fcd2232028f6436471393d6b9d87747` on local `master`, clean at planning. |
| Accepted prerequisite | 3.1.9.8 integration `801da4f3d1bfdf0a9ecc81c993289f70699aa140`, with closure `cda383062`, is in baseline ancestry. It releases accepted Settings, Storage and shared dashboard boundaries. |
| Implementation base | The verified plan commit delivered by this planning task, including the inspected baseline and accepted prerequisite. The launch prompt supplies its full SHA after persistence. Recheck plan content and ancestry before creating the implementation checkout. |
| Integration target / owner | Local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`. The supervisor freezes the passing candidate; the operator chooses integration. No product merge is authorized by this brief. After explicit integration instruction, the assigned supervisor/integrator preserves target changes, runs invalidated focused checks and owns cleanup. |
| Completion | S1–S6 focused proof, committed candidate, operator-directed accepted integration and owned cleanup. Only then mark 3.1.11 complete and release child planning/launch. |
| Evidence | `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11-sessions-2026-09-18/`; private runtime roots remain disposable and isolated. Retain command receipts, tested inputs, logs, browser proof and cleanup identities outside the worktree. |

The proposed ref/path were absent. One auxiliary worktree was occupied by
`codex/3.1.10-date-navigation` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-date-navigation`.
Names are not reservations; recheck ownership and the four-auxiliary-worktree ceiling at launch.
That task modifies date-state portions of `src/dashboard/app/dashboard-app.tsx`; this task may
extract only session/launch portions. Preserve its date, clock, history and dirty-Settings work.
A later target commit is not a new prerequisite; inspect the changed inputs and reconcile only
actual overlap. Follow the existing
[parallel coordination rules](/Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md#parallel-coordination):
no peer polling, checkout queue, ownership transfer or unauthorized messages.

### Feasibility and change ownership

These observations were inspected at the baseline; no runtime proof was executed during planning.

| Question / evidence | Required change and permitted owner | Proof / remaining limit |
| --- | --- | --- |
| `command-kernel.ts` validates live worker authority but ignores the caller's worker row version; `command-kernel.test.ts` deliberately accepts version 999 for directives. Heartbeats also advance that row version. | S1 owns a distinct lifetime/control basis from `leaseGeneration` and a durable control revision, through domain, repository, kernel, supervisor request and wire. Pool versions remain strict. | P1 distinguishes heartbeat-only change, intervening control, replacement process and simultaneous writers. Historical commands remain readable without becoming newly executable requests. |
| `worker-supervisor.ts` attests pause/resume ownership but refuses refresh/reopen: the child has no browser channel. `executeWorkerPoolCommand` awaits effects outside the final journal transaction. | S2 owns a SQLite-backed request/outcome channel and the narrow repository/composition/command changes needed to retain identity before effects and observed outcome afterward. No worker-to-worker messaging. | P2 covers distinct connections/processes, duplicate delivery, lost acknowledgement and BFF/worker restart. A pending/uncertain operation cannot authorize another effect. |
| `WorkerSessionManager` owns exclusive driver turns, transaction retention, reset, poison handling and close proof. `createRunResourcesFactory` can compose resources from retained run settings, while its current factory may change between runs. | S3 owns exact-session control through the manager and worker loop; preserve the selected resource's configuration, instance, browser mode, profile and launch properties. Do not replace them with current settings. | P3 proves busy refusal and idle positive controls, mixed snapshots, close/authentication failure and new session identity after reopen. Driver APIs do not gain raw browser access. |
| The worker projector serves lease state/current claim plus open-browser observations, but not all control ownership/outcome facts. The app only composes stop, plan and spawn. | S4 owns producer-backed control/observation fields, snapshot invalidation, command adapters and the existing session panel. | P4 checks exact readback and pending/refused/uncertain display, including reload and historical missing evidence. Never infer health from a live process or old open span. |
| Accepted source-value read, start-plan and final-command services exist; frontend source-value transport and shared launch composition are incomplete. Settings already has a preflight slot. | S5 completes the shared callable interfaces and isolates their consumers, preserving Intake upload/focus. Child-specific full Setup and Run/Rerun behavior remains with 3.1.11.1/.2. | P5 proves each shared operation against its real service and independent consumer fixtures. A declared type or placeholder implementation does not release a child. |
| Authority schema is 52; floor is 46. Released migrations and historical audits are retained. | S1/S2 own the next additive migration, strict table/record registration and supported stopped-conversion, boot, backup/restore and health handling for control records. Recheck the next version at implementation. | P6 uses populated historical fixtures and fresh roots; no change to released migrations or floor, and no mutation of the operator's standing database. |

The 3.1.9.8 delivery assessment found unregistered disposable writers and a proof narrowing defect;
this task must register every owned child and await cleanup even on failure. Its 13 retained broad
ratchet findings stay with 3.1.19 unless a changed, owned seam invalidates their deferral.

### Ordered implementation

1. **S1 — Durable control identity.** Add worker lifetime/control-revision admission through storage,
   command adapters and the served worker basis. Heartbeats do not invalidate that basis; an
   intervening instruction or replacement worker does. Compare the submitted basis before effects
   and revalidate at the effect-taking boundary. Keep pool CAS and between-item directives. Define
   explicit historical read/upgrade behavior; missing old fields cannot be fabricated into authority
   for a new mutation. Preserve exact replay of already journaled commands and reject divergent reuse.
2. **S2 — Browser command channel.** Persist the authenticated command identity, exact target,
   admission and bounded delivery state in SQLite before contacting the effect owner. The worker
   consumes only its own lifetime's request and records observed settlement. Duplicate delivery and
   a lost response must resolve through retained evidence, not a second browser effect. Distinguish
   refusal before effects, pending work, partial/uncertain effect and observed completion. An expired
   request that never began cannot execute later. Preserve uncertainty after a crash during an effect;
   new commands cannot erase it or silently substitute another session. Complete composition, readback
   and recovery compatibility without adding a second mutation route or bypassing actor/loopback admission.
3. **S3 — Real effects.** Complete plan/spawn/pause/resume/stop/refresh/reopen separately. Refresh and
   Reopen refuse while the worker executes a run, including gaps between steps; no wait-for-idle queue
   survives that refusal. Recheck idleness and exact target before starting, and exclude a new claim
   during the browser operation. Refresh resets the same session and verifies authentication. Reopen
   proves closure before creating and authenticating its replacement under the same retained resource
   configuration/profile, without credential clearing. Do not interrupt a held transaction or weaken
   the manager's poison/closure contract. Preserve three-worker capacity, explicit replacement,
   durable membership, observed birth/exit, existing stop escalation and refusal of external workers.
4. **S4 — Controls and truthful status.** Add Pause/Resume and exact-session Refresh/Reopen within
   the existing D305 strip/card layout. Serve worker ownership/lifetime, control basis, current claim,
   browser identity/profile instance, observed health and operation state only from their producers.
   Keep requested directives separate from observed lifecycle. Refusals and uncertain transport/effect
   outcomes cannot receive success styling. Preserve focus, keyboard use, live elapsed behavior,
   accessibility, both themes and desktop resizing; do not restore retired pool bands or mobile UI.
5. **S5 — Shared child interfaces.** Extract session command composition and launch host/state from
   the shared app. Complete callable readiness/preflight-rerun, source-bound open/prefill, preview,
   warning-acknowledgement, final-submit and replay adapters over accepted services. Source-value reads
   remain exact-run/version-bound; warning navigation has no enqueue effect. Preserve existing Intake
   upload extraction and takeover/dismissal focus. Publish the disjoint child ownership below and
   independent consumer fixtures. Leave full fault-corpus repair UI, ordinary/Rerun interaction,
   `supersede-active` journey completion and source-customization acceptance to their existing child.
6. **S6 — Proof, freeze and release.** Execute P1–P6 and the focused gate schedule, repair failures
   within scope, commit by logical category using exact paths and record tested inputs/results.
   Freeze a reviewable candidate. Await operator-directed product integration; after authorization,
   reconcile target changes, rerun invalidated focused checks, preserve evidence and remove only owned
   registered and physical resources. No independent review, push or child dispatch. Downstream
   release follows accepted integration and cleanup, not a locally green candidate alone.

### File and interface allocation

All paths in this section are repository-relative. Adjacent extraction helpers must keep the same
owner and purpose and be recorded in the final file map; they do not authorize an unrelated refactor.

| Owner / step | Permitted files and bounded responsibility |
| --- | --- |
| S1–S3, supervisor | `src/domain/run/worker.ts`, `src/domain/commands.ts`, new `src/domain/worker-control.ts`; `src/core/command-kernel.ts`, `worker-loop.ts`, `worker-sessions.ts`; `src/base/session.ts`; `src/infra/browser/browser-session-factory.ts`; `src/server/dashboard/worker-supervisor.ts`, `compose.ts`, new `worker-browser-channel.ts`; `src/server/worker/compose.ts`, `run-resources.ts`, new `worker-browser-control.ts`. Browser/login recipes outside these files are consumed unchanged; a required semantic change returns for amendment. |
| S1/S2 storage, supervisor | New `src/infra/sqlite/worker-control.ts`; `authority-database.ts`, `migrations.ts`, `storage-records.ts`, `authority-boot.ts`, `stopped-database-conversion.ts`, `backup-service.ts`, `offline-restore.ts`, `storage-doctor.ts`, and `src/domain/authority.ts`, limited to control identity/records and their required compatibility. Existing run/write/settings semantics and migration floor remain unchanged. |
| S4, supervisor | `src/domain/dashboard/projection.ts`; `src/server/dashboard/projectors/worker-cards.ts`, `run-queue-projection.ts`, affected snapshot comparison/composition; `src/dashboard/surfaces/session-panel.tsx`, `session-panel-model.ts`, shell's session registration; new `src/dashboard/app/worker-command-dispatch.ts`, `session-control-model.ts`; existing `command-dispatch.ts`, `command-result.ts`, `dashboard-app.tsx` only for this wiring. Readback/client/route changes are limited to these controls through the existing admitted command/typed query facade. |
| S5, supervisor | New `src/dashboard/app/run-launch.tsx`, `run-launch-model.ts`, `src/dashboard/client/rerun-queries.ts`; existing `app/command-dispatch.ts`, `bulk-dispatch.ts`, `dashboard-app.tsx`; `client/index.ts`, `queries.ts`, `commands.ts`, `start-commands.ts`; `surfaces/run-start.tsx` only for extraction/adapters and preservation of accepted behavior. Existing BFF start/data/preflight ports and shared registration may be completed here where necessary for independent child consumption. |
| S1–S6 proof/docs | Directly affected existing tests below; task-specific new unit/process/browser tests and fixtures; affected parity references with deliberate attribution; this task owner, scoped contracts/decision pointers, generated roadmap and any changed guard's inventory. Do not edit root test configuration, assertions, floors, timeouts or broad membership to obtain PASS. |

Before release, S5 records the actual exported operations, inputs/refusals, owning paths and tests.
Complete common registrations before children; do not leave either child a shared app/client/BFF
switch to edit. Required operations are: pool read/plan/spawn, worker pause/resume/stop, exact-session
refresh/reopen, readiness/preflight rerun, source-bound launch/prefill, preview, acknowledgement,
final submit and exact replay. Test positive and refused outcomes, not just shape compatibility.

| Future owner | Exclusive consumer scope after S5 | Private proof/resource namespace |
| --- | --- | --- |
| 3.1.11.1 Setup | `src/server/preflight/`; `src/domain/trust/preflight-scenarios.ts`; isolated `settings-preflight*` and `preflight-popover*` presentation/models; preflight-only client/state/route modules. Consume the released session/runtime and Settings/Storage APIs. | Dedicated Setup fixtures/specs and `3.1.11.1/` evidence; isolated state/auth/lock roots and ephemeral test ports. |
| 3.1.11.2 Run/Rerun | `src/dashboard/surfaces/run-start*.ts*`; extracted launch modules; `src/server/dashboard/commands/start-plan-service.ts`; separated prior-value transport and launch-specific service/contract modules. Consume accepted settings, source-values, Intake and session APIs. | Dedicated Run/Rerun fixtures/specs and `3.1.11.2/` evidence; separate roots/ports and reference names from Setup. |
| 3.1.11.3 Finalization | Shared registration, common schemas/fixtures and generated outputs after both children; combine exact candidates in either order, repair cross-child integration and execute the focused group cadence. | `3.1.11.3/`; combine source-bound builds/references only after local child gates. Broad acceptance stays at 3.1.19. |

The parent/finalizer retains shared domain unions, root composition, shared fixture builders,
generated manifest/catalog/roadmap and combined parity registration; child-specific leaves may not
require an unmerged sibling API. Demonstrate Setup's and Run/Rerun's contract consumers separately
against the same parent base, with disjoint production/proof writes and no order-dependent generated
input. This establishes interface readiness, not completion of future child behavior.
If either consumer needs an unfinished shared operation, finish it here before release.

The children still require their own approved briefs. Proposed future bindings (not launch prompts
or reservations) are `codex/3.1.11.1-setup` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-setup`,
`codex/3.1.11.2-run-rerun` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-run-rerun`, and
`codex/3.1.11.3-operations` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-operations`.
Children base on this task's actual accepted integration; the finalizer consumes both exact
approved child candidates. Resolve those future SHAs from the release records, never invent them.

### Proof matrix

| ID | Boundary and positive control | Required negative/interleaving proof |
| --- | --- | --- |
| P1 | Real command/repository admission for all seven verbs; current owned targets reach their actual effect. | For each operation, test its applicable stale identity/version, unavailable/dead/unowned target and uncertain acknowledgement. Explicitly distinguish stale pool CAS, changed worker generation/control revision, harmless heartbeat and a browser session replaced under the same system. Competing commands from separate connections cannot both consume one control basis. |
| P2 | Dashboard → SQLite → real child → manager → retained result → command audit/readback. | Exact replay after response loss does not repeat effects; divergent same-ID input refuses before effects. Crash before start, during effect, after outcome persistence and before audit must remain distinguishable. BFF restart does not adopt an existing worker by PID; old generation requests never execute in a replacement. Failed audit followed by another command cannot conceal an unresolved effect. |
| P3 | Idle refresh retains session identity and proves neutral authenticated state; reopen proves old closure and a new authenticated session using the same configuration/profile. | Busy at admission or before effect refuses without a deferred action; a new run cannot start during control. Failed reset/authentication/closure stays failed or uncertain with retained evidence; no replacement after unproven closure. Mixed snapshots, poison state, held transaction and missing session cannot use a different factory/target as fallback. |
| P4 | Real mounted controls and built-browser journeys correlate exact command, authority and card facts. | No success for refusal/unknown; no paused/stopped claim from a request alone; no fabricated browser health. Confirm selected identities survive UI ticks, reload and reconnect, with keyboard/focus and resize proof in both themes. |
| P5 | Each Setup and Run/Rerun consumer independently calls the completed shared operations against accepted production services. | Source/version mismatch, malformed prefill, unknown write and archived/deleted source retain named refusal. Warning acknowledgement/navigation performs zero enqueue/transaction effects. Final-submit exact replay is singular. Extraction preserves Intake focus/upload and Date changes. Full child interaction acceptance is not claimed. |
| P6 | Fresh and populated supported historical roots preserve control identity and outcomes through stopped upgrade, reopen and backup/restore. Real-child two-run dry-run proof correlates membership/claims/browser resources. | Released migration hashes/floor unchanged; historical audits retain bytes; missing old control basis is explicit. Exercise crash/restart, duplicate ownership, pool resize, stop escalation and owned-orphan cleanup. Prove child exit and lock/browser cleanup even when the test fails; an old stub that runs no workflow or browser cannot alone satisfy this row. |

Use real processes for process claims and real Chromium contexts for browser-effect claims; manual
clocks/fakes are suitable for deterministic race/failure controls but cannot replace those positive
controls. Task-local two-run execution uses safe isolated fixtures with `dryRun=true` and proves no
external HR writes. Full current production/live correlation across the frozen acceptance matrix is
provided by 3.1.18's harness and executed at 3.1.19, as A22 specifies. Do not call fixture evidence live
HR acceptance. If targeted live checks become necessary, current subject admission, credential
presence, retained settings and resource ownership must be rechecked through the supported tools;
never reuse a dated availability claim, invent a second canary, retry UNKNOWN submit or change the
standing operator database to make a proof pass.

### Gate and resource schedule

Run commands from the absolute implementation checkout. The following are concrete focused
selectors; new files are assigned proof outputs, to be authored before their gate is run.

**G1 — storage/admission/effects**, at the end of S1–S3 and after changes that invalidate them:

```sh
npm run test -- tests/unit/command-kernel.test.ts tests/unit/command-kernel-restart.test.ts tests/unit/server/worker-supervisor.test.ts tests/unit/server/worker-pool-composition.test.ts tests/unit/server/worker-pool-parallel-proof.test.ts tests/unit/worker-loop.test.ts tests/unit/worker-sessions.test.ts tests/unit/worker-composition.test.ts tests/unit/browser-session-factory.test.ts tests/unit/parallel-runs-authority-store.test.ts tests/unit/worker-browser-control.test.ts tests/unit/server/worker-browser-control-process.test.ts
npm run test -- tests/unit/worker-control-upgrade.test.ts tests/unit/sqlite-authority-database.test.ts tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-admission.test.ts
npm run test -- tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/fresh-session-boundary.test.ts tests/unit/architecture/multi-worker-overlap.test.ts tests/unit/architecture/worker-teardown-soak.test.ts tests/unit/architecture/operational-isolation.test.ts
```

**G2 — controls/extraction**, at the end of S4–S5 and after invalidating changes:

```sh
npm run test -- tests/unit/dashboard/worker-card.test.ts tests/unit/dashboard/worker-pool-controls.test.ts tests/unit/dashboard/session-panel-pool-press.test.ts tests/unit/dashboard/session-view.test.ts tests/unit/dashboard/run-start-focus.test.ts tests/unit/dashboard/start-plan-contract.test.ts tests/unit/dashboard/preflight-client.test.ts tests/unit/dashboard/session-controls.test.ts tests/unit/dashboard/launch-boundary.test.ts
npm run web:build
npm run test:parity -- tests/parity/pool-control-desktop-target.spec.ts tests/parity/shell-toast-floor.spec.ts tests/parity/shell-accessibility.spec.ts tests/parity/session-controls.spec.ts --workers=4
```

The new `session-controls.spec.ts` owns both-theme reference/interaction coverage at the current
desktop baseline and 1280×720/1440×900 plus minimum-canvas resize. Keep pixel/a11y/provenance pairs
together. An intentional reference update is limited to changed session scenes, attributed in the
task record and followed by the same assert gate; never bulk-refreeze to suppress unrelated drift.
The prescribed `playwright-cli` lane inspects the specimen before primitive choices and manually
verifies affected states against the same built candidate. Save actual screenshots and authority
correlation; no browser MCP substitution without the required explanation and permission.

**G3 — scoped lint and generated checks.** Every code/test change requires scoped ESLint, including
new helpers and proof fixtures. Freeze the exact changed `.ts`/`.tsx` paths from
`git diff --name-only --diff-filter=ACMR <verified-base> -- '*.ts' '*.tsx'` into the evidence receipt,
then invoke `npx eslint` with that argument list and `--max-warnings 0`; use an argument array, not
shell word splitting. The supervisor resolves and records the real base before this command.
Run `npm run build:manifest` then `npm run build:manifest:check` if descriptor import-closure inputs
changed; run `npm run stores:catalog` then `npm run stores:catalog:check` if store-catalog inputs
changed. Run `npm run roadmap`, `npm run roadmap:check` and `git diff --check` for task records.
Update guard inventory only for an actual guard addition/retirement, with deciding evidence and
its metadata check; do not accidentally select the deferred whole-repository ratchet.

**G4 — candidate/integration/recording.** Before candidate freeze, all affected G1–G3 results and
P1–P6 rows must be satisfied on the final inputs. Reuse unchanged passing results by recording
tested commit/tree, current diff and unchanged code/test/config/dependency inputs; rerun after a
relevant correction, failure or uncertainty. Do not repeat all gates for a recording-only commit.
At operator-directed integration, recheck target/candidate identity, preserve Date work, reconcile
actual overlap and rerun invalidated focused tests/lint/build/generated checks. Record commands,
exit codes and every deferred proof before cleanup.

Vitest's imported configuration already caps file workers at four; verify effective workers and
preserve suite membership, isolation, assertions, floors and timeouts. Parity explicitly uses four.
Each process/browser proof owns fresh state/artifact/auth/lock roots, registered child handles and
ephemeral ports; it does not use another task's runtime or the shared rebuild 3938/5174 ports.
Build/parity/generation writes are serialized within this checkout. Other isolated worktrees may
continue; no speculative global gate queue. Inspect and resolve actual resource contention only.
Close and verify only owned processes/sessions; never use a global close-all against active peers.

Full repository typecheck/coverage/lint/architecture, broad parity, performance, production/recovery
and complete live acceptance remain **3.1.19**. This prerequisite's focused migration, recovery,
real-process and browser proofs are not deferred. The later 3.1.11.3 finalizer runs its assigned
combined typecheck and focused integration gates. No independent review applies to either stage.

### Exclusions, stops and current state

Do not implement the children's full Setup/Run/Rerun surfaces, Queue or Detail work, workflow
admission, auto-restart/adoption, more than three pool workers, credential clearing, new recovery
policy, mobile variants, production cutover or real HR transactions. Do not touch legacy live state.
Stop dependent work for changed contract intent, required edits outside this ownership, unavailable
required proof or unresolved effect identity/uncertainty. Preserve completed independent work and
surface the specific issue. Routine extraction, naming and tactical fixes stay with the supervisor;
do not re-ask choices 1 A / 2 A.

| State | Record |
| --- | --- |
| Approval | Complete S1–S6 plan approved 2026-09-18; 1 A / 2 A already settled. |
| Implementation | Unstarted. No product code or operator state changed by planning. |
| Prerequisites | Accepted 3.1.9.8 and its required inputs present at the inspected baseline. |
| Planning persistence | This owner plus normative amendments, decision pointer, A22 clarification and roadmap record; scoped documentation validation and local documentation integration authorized. |
| Product merge / cleanup | Await future operator instruction after a passing frozen implementation candidate. |
| Child/group release | Waiting on this task's accepted implementation and cleanup; no child is launched by planning. |

Maintain this compact state table during execution and retain linked dated evidence. Send
Done / Now / Remaining once at supervisor start or genuine resume; later updates report only
new verified completions and material blockers. Use this phase record for routine stage transfer;
use `/handoff` only if interrupted unique execution state needs recovery.

### Planning validation — 2026-09-18

The operator authorized persistence, scoped validation, commit and local integration of these
planning documents. The documentation candidate is isolated on `codex/plan-3.1.11` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-sessions-plan`, based on
`faa8b2165fcd2232028f6436471393d6b9d87747`. Product implementation remains unstarted.

| Check | Result / evidence |
| --- | --- |
| Roadmap binding | `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts`: 1 file, 24 tests passed. |
| Scoped lint | `npx eslint scripts/generate-roadmap.ts tests/unit/architecture/roadmap-doc-binding.test.ts --max-warnings 0`: passed. |
| Generated roadmap | `npm run roadmap` and `npm run roadmap:check`: passed; generated output only, no manual HTML editing. |
| Links / instructions / diff | Changed-link and complete brief-link targets/fragments resolve; all 9 existing instruction pairs match; all 18 project chains remain below 32,768 bytes (maximum 19,308); `git diff --check` passes. |
| Scope / gate preflight | Exactly 7 planning/contract/roadmap paths changed. All 28 existing focused test selectors resolve; 6 additional selectors name explicitly assigned future proof files. No code, test, dependency, configuration or runtime artifact changes. |
| Runtime acceptance | Not run or reused. New behavior remains unimplemented; the planning checks do not certify it. Full repository gates and complete live acceptance remain 3.1.19. |

Exact command logs, exits, file hashes, check script and final commit/integration/cleanup receipt are
retained in the [planning evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11-plan-2026-09-18/).
The launch prompt is issued only after reading the committed brief, verifying local integration and
accepted prerequisite ancestry, and rechecking the proposed implementation branch/path and capacity.
