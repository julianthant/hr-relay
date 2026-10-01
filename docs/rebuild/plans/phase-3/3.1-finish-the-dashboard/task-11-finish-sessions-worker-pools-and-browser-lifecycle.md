# Task 3.1.11 · Finish sessions, worker pools, and browser lifecycle
<!-- roadmap: dash-sessions -->

**Current assignment: 3.1.11.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [x] Make plan/spawn/pause/resume/stop/refresh/reopen each execute a real supervisor effect and prove durable membership,
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
   The [2026-09-19 admission amendment](#preflight-admission-ownership-amendment--2026-09-19)
   explicitly adds shared preflight admission and freshness wiring to this step before child release.
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
admission beyond the bounded preflight hooks in the 2026-09-19 amendment, auto-restart/adoption,
more than three pool workers, credential clearing, new recovery
policy, mobile variants, production cutover or real HR transactions. Do not touch legacy live state.
Stop dependent work for changed contract intent, required edits outside this ownership, unavailable
required proof or unresolved effect identity/uncertainty. Preserve completed independent work and
surface the specific issue. Routine extraction, naming and tactical fixes stay with the supervisor;
do not re-ask choices 1 A / 2 A.

| State | Record |
| --- | --- |
| Approval | Complete S1–S6 plan approved 2026-09-18; 1 A / 2 A already settled. |
| Implementation | S1–S6 complete under the focused cadence. Frozen `c0f8c45d8e426dd5c99529c91982d0eb425c740f` integrated at `c90da4ffc45ddfe6486192b8df68816dc6fe34a3`; owned cleanup verified. No standing operator state changed. |
| Prerequisites | Accepted 3.1.9.8 and its required inputs present at the inspected baseline. |
| Planning persistence | This owner plus normative amendments, decision pointer, A22 clarification and roadmap record; scoped documentation validation and local documentation integration authorized. |
| Product merge / cleanup | Operator “do it” authorized integration and owned cleanup on 2026-09-19. Accepted merge `c90da4ffc45ddfe6486192b8df68816dc6fe34a3`; see the integration record below. |
| Child/group release | Sessions prerequisite released at accepted integration `c90da4ffc45ddfe6486192b8df68816dc6fe34a3`, with cleanup verified. Each child still requires its approved brief and operator launch; none dispatched. |

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

### Preflight admission ownership amendment — 2026-09-19

During `/phase-plan 3.1.11.1`, the operator selected **1 A**: extend parent **3.1.11** with shared
preflight admission hooks, while **3.1.11.1** owns detectors, the executed fault corpus and Setup UI.
The operator then approved that child's complete S1–S5 plan and documentation persistence.
This is an explicit amendment to the parent S5 allocation and the earlier workflow-admission
exclusion. It does not alter session control choices 1 A / 2 A, create a new task, or dispatch work.
The [approved child brief](task-11-1-finish-setup-and-preflight.md#approved-execution-brief--2026-09-19)
owns child delivery. Existing A07 outcomes and preflight contracts are unchanged.

**Reason.** At inspected master `517f7319fdcd771aee8356e664f1e8a885032ba0`, the sole composed
preflight authority selects `dashboard.serve`; no preflight authority call exists at enqueue/worker
composition. Readiness cannot be inferred from the six dashboard checks. The child cannot achieve
A07's no-launch-on-required-failure boundary while shared registrations/admission are excluded.
The parent was already in progress on its existing branch/worktree; this amendment is committed
separately and must be incorporated there without overwriting its active changes before release.

**S5 admission obligations.** Complete actual shared callable operations and their registrations:

1. Derive the workflow/system/feature subset from admitted descriptor/start scope and selected
   instance, using the existing registry. Bind readiness to the applicable active or retained
   configuration and descriptor identity; historical runs must not silently use current settings.
2. Supply the registered runner-factory boundary and shared report/read/rerun/freshness operations
   needed by Settings Setup, the doctor and start/worker consumers. Preserve strict report semantics,
   safe absence/unavailable/refusal handling, fingerprint checks and existing read-only replay/timeout
   bounds. Expose only permitted protected-name/presence facts and served runtime/session observations.
3. Invoke readiness at the real start/enqueue and worker/browser launch boundaries before effects.
   A required failed, missing or unavailable check cannot authorize enqueue/spawn/browser work.
   Optional/unselected capability failure does not block unrelated valid work. Preserve existing
   authentication, settings-current, source/run identity and transaction admission checks.
4. Complete shared UI/action hooks and invalidation so Setup and doctor consume one served report
   and can invoke existing explicit Settings/Storage/Sessions remedies followed by re-check. The
   child must not edit a shared app/client/BFF switch to connect its detectors or presentation.
5. Publish exact operations, exported names, inputs/refusals, owner paths and independently executable
   child fixtures. The Setup child extends isolated detector implementations through that fixed
   boundary; Run/Rerun consumes it without an unmerged Setup dependency. Missing detector support
   remains an explicit refusal, never a fabricated successful readiness result. Parent release
   proves the working admission mechanism; full non-dashboard detector acceptance remains child work.

**Bounded parent files.** In addition to the original S5 allocation, parent ownership includes
`src/domain/preflight.ts`, `preflight-contract.ts`, `preflight-semantics.ts`,
`runtime-dependencies.ts`, affected shared dashboard/bootstrap contracts;
`src/server/dashboard/compose.ts`, `queries/bootstrap.ts`, `routes/api.ts`, `routes/api-types.ts`;
`src/server/dashboard/commands/start-plan-service.ts`, `src/services/start/plan.ts`,
`src/services/runs/enqueue.ts`, `src/core/command-kernel.ts`, `worker-loop.ts`,
`src/server/dashboard/worker-supervisor.ts`, `src/server/worker/compose.ts`, `run-resources.ts`, and
shared app/client/state composition only for these admission, report and registration operations.
Extract shared readiness policy into a dedicated module rather than duplicating it at each caller.
The parent may establish the stable factory/registration skeleton in `src/server/preflight/` before
handoff; the child owns subsequent detector implementations there. Publish the exact final map.
No new CLI doctor/test-login, provider adapter, workflow behavior, recovery policy or automatic repair
is admitted by this amendment. No migration is prescribed for read-only preflight replay.

**P5 admission extension and focused gates.** Add
`tests/unit/server/preflight-admission-boundary.test.ts` and
`tests/unit/dashboard/preflight-readiness-boundary.test.ts` to the parent's owned proof. Exercise the
real admission/report services: valid configured positive control, selected required fault, missing
runner/support, optional unrelated fault, wrong/stale config or descriptor/scope, changed settings,
and late obsolete UI response. Assert detector/effect counts and zero enqueue/worker/browser effects
where refused, not merely an error string. Preserve exact/failed/in-flight/divergent replay and
actual timeout settlement. A supplied type, no-op callback or mocked successful gate cannot release
the children. Use controlled detector inputs without claiming the child's full corpus passed.

```sh
npm run test -- tests/unit/server/preflight-admission-boundary.test.ts tests/unit/dashboard/preflight-readiness-boundary.test.ts tests/unit/preflight-runtime-dependencies.test.ts tests/unit/dashboard/preflight-client.test.ts tests/unit/worker-composition.test.ts tests/unit/start-plan.test.ts
```

Run scoped ESLint for every affected source/test path under existing G3. Retain existing G1–G3
checks affected by these changes, the four-worker ceiling and source-bound generated/build checks.
The original Phase 3.1 no-independent-review/focused cadence and 3.1.19 full-gate boundary remain.
Record the amendment's committed identity, implementation proof and accepted integration in the
parent release; **neither child launches before those obligations are met**. Product integration
still requires operator direction. This planning commit does not certify implementation or gates.

Exact command logs, exits, file hashes, check script and final commit/integration/cleanup receipt are
retained in the [planning evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11-plan-2026-09-18/).
The launch prompt is issued only after reading the committed brief, verifying local integration and
accepted prerequisite ancestry, and rechecking the proposed implementation branch/path and capacity.


### Candidate evidence — 2026-09-19

**Passing candidate; awaiting explicit operator instruction for local `master` integration.**
The task checkbox and child release remain open. No workers, independent reviewers, child dispatch,
push, live HR transaction or product integration occurred. Broad acceptance remains 3.1.19.

| Identity | Verified record |
| --- | --- |
| Approved base / prerequisite | `f02eb7f837677eef210d305635f6a2d84f0516b4`; committed plan blob `1ff87f9321807262d8f0b8fd0ace691065513fc6`; accepted `801da4f3d1bfdf0a9ecc81c993289f70699aa140` is an ancestor. Ref/path availability, clean integration checkout and auxiliary capacity verified before edits in `preflight.json`. |
| Backend commit | `ca1c10866184db68b80f4bc1f2d8cc8961ee299e` — durable controls, retained browser effects, additive schema and process/storage proofs. |
| Implementation commit | `e726d102f15fc9a1d45e5693f01951188dc67e56` — dashboard controls, shared launch boundaries and browser/consumer proofs. The two category commits form one tested candidate. |
| Actual integration target | Clean local `master` at `f93994501f69ff04a8114311fee7630c34b529e4`. Date integration and later planning/status records are present. Schema remains 52, so additive 53 does not collide; floor remains 46. |
| Actual overlap | `dashboard-app.tsx` and `authority-database.ts`. Read-only `git merge-tree --write-tree` finds one conflict at the app's leading imports; retain Date's `resolveDateSelection`/`routeForDay` and all three Sessions launch/dispatch imports. All Date body changes combine automatically. The database's calendar method combines cleanly with control storage. This simulation is not an integration or combined gate pass. |
| Runtime cleanup | Real-child process fixtures verify exit/group disappearance, zero browser contexts and released worker locks even on assertion failure. Final parity and manual CLI roots were removed by the registered runner. Owned CLI session closed; specimen port 41871 has no listener. Branch/worktree remain intentionally available for operator integration. |

Logs, exact input hashes, screenshots, authority correlation, cleanup receipts and commit identities
are retained in the [implementation evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11-sessions-2026-09-18/).
`candidate-code-inputs.json` freezes source/test/script/config/dependency bytes;
`scoped-lint-paths.json` freezes the exact 61 changed TypeScript paths and hashes;
`actual-target.json` and `merge-simulation.txt` record the target comparison.
`freeze.json` records the final evidence-only commit after it exists.

| Proof | Completed candidate evidence |
| --- | --- |
| P1 / S1 | Kernel/composition/supervisor tests exercise all seven verbs, strict pool CAS, distinct lifetime/control revision, harmless heartbeat, stale/replaced/unavailable/unowned targets and competing SQLite admission. Historical missing control basis remains unavailable. |
| P2 / S2 | `worker-browser-control-process.test.ts` crosses real HTTP, SQLite, child runtime and Chromium. The seven-operation uncertainty/replay table retains effect-start uncertainty; duplicate/lost-response replay is singular, divergent reuse refuses, and another command cannot conceal an unresolved outcome. Tests distinguish never-started expiry, executing/crash uncertainty, retained outcome and failed audit. BFF restart refuses PID adoption; generation 2 rejects generation 1 requests. |
| P3 / S3 | Manager/control tests prove whole-run exclusion, exact-session admission/effect recheck, held transaction and poison handling, mixed retained settings, failed reset/auth/close and no replacement without proven closure. Real Chromium Refresh preserves identity; Reopen closes the old session and authenticates a new ID under the same profile/configuration/mode without credential clearing. |
| P4 / S4 | Mounted controls exercise all UI verbs, heartbeat/tick stability, unavailable/busy/unowned bases, refused/uncertain state and exact lost-response retry. Built-browser journeys cover both themes at 1440×900, 1280×720 and 1024×720, reload/readback, keyboard/focus and terminal Stop focus. New screenshots/a11y/authority pairs are in `parity-final/`; no unrelated references were refrozen. Prescribed CLI specimen inspection and manual Pause/Refresh/Reopen proof are retained as `specimen-actions.png`, `manual-*.png`, `manual-cli/`, `manual-authority.json` and `manual-proof.json`. Only the fixture favicon request returned 404. |
| P5 / S5 | Independent `setup-boundary.test.ts` and `launch-boundary.test.ts` consumers use production bootstrap/preflight and rerun-values/planner/kernel routes respectively. Setup proves readiness, failed checks, replay and stale configuration refusal. Run proves exact source/version, malformed/substituted/deleted/archived/unknown-write refusal, explicit prefill, warning acknowledgment without enqueue, and singular final-submit replay after response loss. All 10 existing Intake/launch focus cases pass. These are shared-interface proofs, not the children's full interaction acceptance. |
| P6 / S1–S3 | Fresh and populated versions 46–52 upgrade through additive 53; interrupted reopen, retained audit bytes, missing historical basis and backup/restore uncertainty pass. Released migration hashes and floor are unchanged. Two real workers execute two isolated synthetic `dryRun=true` runs, with durable membership, claims, browser resources, resize, restart/replacement and teardown assertions. `run_operations` and `run_operation_attempts` stay empty; retired `operation_outbox` remains absent. This is not live HR acceptance. |

#### Released interfaces and disjoint consumer ownership

Paths below are repository-relative. All shared registrations are completed in this candidate;
neither consumer needs a sibling implementation or a shared root switch edit.

| Operation / actual owner | Callable contract and refusal boundary | Independent consumer / future owner |
| --- | --- | --- |
| Pool read/plan/spawn | Existing day/worker projections; `app/worker-command-dispatch.ts` exports `composePlanWorkerCountCommand`, `composeSpawnWorkerCommand`, `createWorkerCommandDispatch().plan/spawn`. Pool version and three-worker capacity remain authoritative. | Existing pool tests plus process proof. Shared runtime remains parent/finalizer owned. |
| Pause/resume/stop/refresh/reopen | `composeWorkerControlCommand` and dispatch `prepare/send` retain an exact envelope. Served lifetime/revision and owned target required; browser actions include exact session ID. Missing basis/ownership refuses locally; durable command authority owns final refusal/pending/uncertain/result. `session-control-model.ts` waits for changed authority basis before another action. | `session-controls.test.ts`, process and parity proofs. Children consume without editing session protocol/storage. |
| Readiness / preflight rerun | `client/preflight-queries.ts`: `readiness()` returns present checks or explicit unavailable; `rerunPreflight()` calls the registered route with expected configuration. Existing detector/authority owns admission and replay. | Setup: `setup-boundary.test.ts`; `server/preflight/`, `domain/trust/preflight-scenarios.ts`, preflight-only client/route/state and `settings-preflight*`/`preflight-popover*`. Private Setup fixtures/evidence/roots/ports. |
| Launch host / exact source prefill | `app/run-launch-model.ts`: `useRunLaunch`, `launchWorkflows`, `prefillRerun`; `app/run-launch.tsx`: `RunLaunchHost`. `client/rerun-queries.ts`: `rerunValues`, bound to exact run/version and strict status/identity. Prefill copies explicitly selected available values only and refuses unsafe/conflicting paths or unknown steps. | Run/Rerun: `launch-boundary.test.ts`, existing `run-start-focus.test.ts`; extracted launch files, `run-start*`, separated prior-value transport and launch-only service/contracts. Private Run fixtures/evidence/roots/ports. |
| Preview / acknowledgment / final / replay | `createRunLaunchService`: `openRerun`, `prefill`, `preview`, `acknowledge`, `prepareFinal`, `submit`, `replay`. Acknowledgment checks source and re-previews through the server. Final/replay reuse one command identity; `StartPlanRefusalError` preserves the production named refusal. No warning action enqueues. | Run/Rerun owns its leaves and `commands/start-plan-service.ts`. Shared `client/index.ts`, `queries.ts`, domain unions, root app/BFF composition, common fixtures and generated outputs remain parent/finalizer owned. |

The two consumer suites import no sibling test fixture and pass in the same parent gate with private
state. Separate invocations also pass from the exact implementation: Setup **1/1**, Run **4/4**,
both exit 0 with scratch removed (`setup-independent.log`, `run-independent.log`). Setup writes only its preflight leaves; Run writes only its launch leaves. Their production
and proof write sets are disjoint, so either consumer can be developed and merged first without an
unmerged sibling API or generated-output dependency. The finalizer owns shared registration and
combined generated outputs after both children. Their approved launch bindings and accepted base
must still be verified after this task's integration/cleanup; no child is released here.

Adjacent files needed by the assigned contracts are explicit: `infra/compat/backup-inspection.ts`
and SQLite `recovery-contracts.ts`, `run-store-contracts.ts` keep schema 53 and directive command
identity compatible with historical backups and retained control state; `domain/run/rerun.ts` owns
the existing refusal-code schema and `services/start/rerun.ts` consumes that same type. Snapshot
invalidation is in `server/dashboard/compose/queue.ts`. These changes do not add new workflow,
recovery or login semantics. `commit-paths.json` records the complete actual file map by category.

| Gate | Final result / exact receipt |
| --- | --- |
| G1 effects | Prescribed 12 suites, **330 passed**, exit 0 — `g1-effects-final.log`. |
| G1 storage | Prescribed 4 suites, **211 passed**, exit 0 — `g1-storage-final.log`. |
| G1 architecture | Prescribed 5 suites, **23 passed**, exit 0 — `g1-architecture-final.log`. |
| G2 unit/consumer | Prescribed 9 suites plus independent Setup consumer, **77 passed in 10 files**, exit 0 — `g2-unit.log`. |
| G2 build/browser | `npm run web:build`, exit 0; prescribed four parity specs, **13 passed**, exit 0 — `g2-build-final.log`, `g2-parity-final.log`. |
| G3 lint | Exact changed 61 `.ts`/`.tsx` paths passed `npx eslint` with argument array and `--max-warnings 0`, exit 0 — `scoped-lint-paths.json`, `g3-lint-final.log`. |
| G3 generated | Manifest and store catalog generation/check passed, exit 0; `npm run roadmap`, `npm run roadmap:check` and `git diff --check` passed, exit 0 (`roadmap-generate.log`, `roadmap-check.log`, `recording-checks.json`). Manifest regenerated from changed import closure; store catalog and generated roadmap content unchanged. |
| Additional scoped diagnostic | TypeScript semantic diagnostics on changed files: **0 across 61 files** — `scoped-types-final.log`. This is not the deferred full repository typecheck. |
| G4 unchanged-input reuse | `g1-tested-inputs.json` retains the earlier snapshot. Subsequent differences are dashboard readback/focus presentation, one dispatch trailing blank and the parity Stop-focus assertion; G2 build/unit/parity and lint ran after those changes. G1 source/test/config/dependency inputs are unchanged. Evidence-only recording does not invalidate code gates. Effective Vitest configuration retains four workers, forks and isolation; no test membership, assertion strength, coverage floor or timeout reduction. |
| Deferred | Full repository typecheck/lint/coverage/architecture, broad parity/performance, full production/recovery/live matrix: 3.1.19. Combined Date/Sessions integration checks await operator instruction. No independent review by the approved exception. |

#### Delivery assessment and integration obligations

The approved plan covered the observed repairs. **Implementation defects:** a pause arriving between
loop read and claim could crash the worker; the claim now returns none-eligible and the next loop
consumes the directive. Browser proof exposed a stale control basis before SSE readback and native
focus loss while controls disabled/replaced; authority-basis gating and explicit focus restoration
now pass real browser checks, including terminal Stop. **Existing fixture/guard drift:** the old
start-plan contract assertion still read the aggregator after transport extraction; its identical
assertion now reads the actual client owner. Historical upgrade receipt fixtures now match the
pre-51 absence of explorer import metadata. No guard was added or retired and inventory is unchanged.
The initial standalone manual fixture failed private-root admission; using the existing registered
test runner satisfied the same checks without changing production admission.

**External/prerequisite change:** Date was integrated while this candidate was built. Actual-target
inspection confines conflict resolution to preserving both app import groups; the Date clock,
history and dirty-Settings behavior must remain intact. No plan amendment or new operator scope
was needed. Zero implementation/review assignments were created. Retained iteration logs prove
multiple local repair rounds (at least three); complete round/elapsed-cost telemetry is unavailable,
so no exact total or efficiency claim is made. Running the built-browser proof earlier in S4 would
have exposed readback/focus defects before final gate preparation. Automatic compactions did not
change allocation, ownership or the approved gate schedule.

After explicit integration instruction: recheck both refs, target cleanliness, prerequisite ancestry
and schema availability; preserve both import groups and Date's calendar method, then run the
invalidated combined focused checks, scoped lint/build and generated checks. Record the accepted
integration, verify ancestry, remove only this task's registered and physical worktree/branch and
owned runtime residue, and only then mark 3.1.11 complete and release child planning/launch.


### Accepted local integration and completion — 2026-09-19

**3.1.11 complete under its focused cadence; owned cleanup verified.**

The operator's **“do it”**, replying to the frozen-candidate report, authorized local `master`
integration and owned cleanup. Accepted merge **`c90da4ffc45ddfe6486192b8df68816dc6fe34a3`** has
parents `f93994501f69ff04a8114311fee7630c34b529e4` and frozen candidate
`c0f8c45d8e426dd5c99529c91982d0eb425c740f`. Both prerequisites and candidate ancestry were rechecked;
target and candidate were clean. Zero workers, independent reviewers, push or child dispatch.

The one conflict at `src/dashboard/app/dashboard-app.tsx:1` combined Date's
`resolveDateSelection`/`routeForDay` import with all Sessions launch/dispatch imports. Neither intent
was dropped; Date body changes and `AuthorityDatabase.queryRunCalendar` were retained automatically.
Integration added one inspected disposable-write registration to the existing parity guard:
`session-runtime.ts` may write exactly `join(root, "release-drivers")`. Existing redirected-reference
and extra-write negative controls now execute for that writer. No guard addition/retirement,
assertion reduction, exemption, reference refresh or inventory membership change occurred.

| Integration check | Result / retained evidence |
| --- | --- |
| Sessions G1 effects/storage/architecture | **330 + 211 + 23 passed**, exits 0; `integration-g1-*.log`, `integration-g1-exits.json`. |
| Sessions G2 plus Date units | **151 passed in 22 files**, exit 0; `integration-g2-date-units.log`. |
| Date architecture, including exact writer controls | **31 passed in 5 files**, exit 0; `integration-date-architecture-final.log`. The first run failed on the missing Sessions fixture registration; the targeted registration repair is in the merge. |
| Assigned Sessions browser selector plus Date/history interaction specs | **27 passed**, exit 0; `integration-focused-parity.log`, `integration-focused-parity/`. All four approved Sessions specs retained; Date navigation and shell navigation added. Both themes, focus, controls, readback, date/history and desktop geometry pass. |
| Lint / scoped semantics | 90 combined changed TS/TSX paths plus two recording inputs passed scoped ESLint; the added guard path separately passed after repair. **91 changed files, zero TypeScript diagnostics**. `integration-lint.json`, `integration-registration-lint.log`, `integration-scoped-types.log`. This is not a full repository typecheck. |
| Build / generated | Web build, manifest generation/check and store catalog generation/check passed. `integration-build-final.log`, `integration-generated.json`. Closure documentation binding, roadmap generation/check and whitespace results are recorded separately. |
| Final inputs / reuse | `integration-final-inputs.json` binds 2,401 input hashes and the tested merge tree. Only the writer-registration test changed after the initial integration snapshot; its architecture/lint checks and final browser gate reran. Runtime implementation was unchanged after passing G1/G2. |

**Additional broad reference sample failed; retained for 3.1.19, not passed or waived.** Expanding the
browser selection to include `dashboard-reference.spec.ts` and `cross-date-search.spec.ts` ran 47
cases: 29 passed and 18 reference cases failed. The regenerated descriptor manifest changes
`71b1674f…` to `a14b8216…`: all 18 provenance headers differ and two run-detail scenes display the
new short hash. Their semantic comparisons stop before pixel comparison, so no pixel pass is
claimed. Exact names, hashes, command/exit and outputs are in `deferred-reference-findings.json`,
`integration-combined-parity-final.log` and `integration-expanded-parity/`. These queue/search/detail
references are outside this task's explicit Sessions-only reference-update allowance; their deliberate
refresh and broad acceptance stay with 3.1.19. The assigned Sessions selector was not narrowed or
weakened. Complete live HR, broad coverage/lint/architecture/parity and Phase 3.1 acceptance remain open.

**Integration delivery assessment:** one additional implementation/proof defect, not a plan omission,
was found: the Sessions disposable writer had not been registered despite the explicit preflight
lesson. It was repaired in one local integration round with existing negative controls intact.
Selecting this focused guard before candidate freeze would have prevented that rework. The broader
reference sample exposed manifest-coupled reference work outside the assigned update allowance;
its failure is retained separately from the passing integration gates. No new product scope or
contract decision was introduced. Original iteration totals remain unknown; this adds one observed
integration repair round, not an estimated overall count.

**Cleanup verified:** the exact `hr-worktree-sessions` registration and physical folder plus
`codex/3.1.11-sessions` ref are absent. All 105 generated files were archived and hash-verified;
the task-local dependency install was removed. Sixteen inactive, task-owned failed-test roots were
matched to retained command logs, checked against owner identity and live process groups, archived
with 6,108 regular-file hashes, verified, and removed. `cleanup.json`, `owned-residue.json`,
`owned-scratch-audit.json`, `owned-scratch-hashes.json` and both retained archives record custody.
The shared worktree parent and all three peer planning checkouts remain. This calling task stays
visible; no other task was archived. The accepted Sessions prerequisite is released; children still
need their approved briefs and explicit operator launch. No push or child dispatch occurred.


### Accepted preflight admission amendment — 2026-09-19

The operator's **“do that and launch 3.1.11.1”** authorized this previously approved parent
follow-up, local integration, owned cleanup and the Setup task launch. Choice 1 A and the child's
S1–S5 scope are unchanged. The original Sessions completion remains accepted.

Implementation **`549a701863720adb40ed2263a454cbeb44b0cf6c`** was built on clean
`191ce8b1cb79d0930d89d60cb5501914c3fa4b09`, in `codex/3.1.11-preflight` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-preflight-hooks`.
Approved plan `ac060faaf2a9f7cf9bc04f14335121cad0392e67` was incorporated at
`96d9df6f51a0913b97a1548daca92a70cdae3d29`. Local integration
**`ef050d0a8cb99aa39b54f726b2bdd5269f125dfa`** is tree-identical to the tested implementation;
no product conflict or new migration occurred. Schema 53/floor 46 remain unchanged. No push,
independent review, external HR transaction, provider adapter or new CLI command occurred.

#### Exact preflight interface release

All paths below are repository-relative. Setup implements detectors and presentation through these
registered operations; Run/Rerun can consume the same parent independently.

| Owner / operation | Inputs, semantics and actual registration |
| --- | --- |
| `src/domain/preflight-admission.ts`: `PreflightAdmissionScopeSchema`, `createPreflightAdmission`, `PreflightAdmissionRefusal` | Exact retained snapshot/config/descriptor/capability identity; asynchronous `prepare(scope, signal)`, synchronous `read` and `assertReady`. Required failures block; unavailable, stale and scope mismatch refuse by name. Evidence expires after 60 seconds of monotonic time and protected revision changes invalidate it. Detector settlement never runs inside a SQLite transaction. |
| `src/services/start/preflight-scope.ts`: `workflowPreflightScope` | Derives systems, selected prod/test instances and declared provider/workflow dependencies from the admitted descriptor graph. It conservatively covers the declared graph, not runtime branch prediction. Wrong descriptor identity refuses; unrelated capabilities and unselected instances are absent. |
| `src/server/preflight/runtime-admission.ts`: `composeRuntimePreflight` | `currentScope` checks current settings; `runScope` selects the run's retained settings and descriptor. Supplies authority, isolated roots, worker observations, protected source and executable-provider facts. No current-settings fallback for historical runs. |
| **Setup detector owner:** `src/server/preflight/runtime-runners.ts`: `RuntimePreflightRunnerInput`, `RuntimePreflightRunnerFactory`, `createRuntimePreflightRunners` | Factory receives exact scope/config, existing dashboard detector inputs, the canonical protected source and provider availability. It reuses the six implemented detectors. Remaining registered detectors explicitly report unavailable; required ones refuse admission. Setup replaces these isolated missing implementations and may extract private detector modules here, without editing shared composition roots. Key-only providers do not acquire executable readiness. |
| `src/server/preflight/report-service.ts`: `createPreflightReportService` | Strict read/read-only rerun operations, one bounded 256-command replay namespace, exact/divergent/in-flight/failed replay and identity checks before probes. `GET /api/v1/preflight` supports optional workflow/instance selection; the existing guarded rerun route supports the same selection. Expired replay results retain history, while current readback remains unavailable. |
| `createStartPlanService.prepare/plan`, command kernel and `RunRecordService` | Real BFF and scenario producers prepare before planning; kernel asserts before consuming a plan; lifecycle asserts before both initial and retry enqueue. Replay remains before admission and creates no additional effects. This extends the bounded file map to `src/core/run-record-service.ts` and the actual scenario producer `src/server/dry-run-scenario/runtime.ts`; the unused enqueue helper alone cannot prove admission. |
| `claimWithPreflight`, `preflightSessionFactory` in `src/server/preflight/worker-admission.ts` | SQLite's existing selector calls the synchronous assertion before its claim write. Preparation unwinds the transaction, probes, then reselects atomically. This necessarily extends `src/infra/sqlite/authority-database.ts` with that callback. Worker boot/spawn check infrastructure before effects; selected-run claim and per-run browser opening check retained scope. No SQL duplication or schema change. |
| `src/dashboard/client/preflight-state.ts`, `src/dashboard/state/preflight-readiness.ts` | `preflightReadinessResource`, `invalidatePreflightReadiness`, `usePreflightReadiness`: one client resource per exact settings/config/descriptor/selection identity. Epoch invalidation rejects late responses, including uncertain mutations. Rerun reads current served evidence after historical command replay. Setup and doctor subscribe through the same port. |
| `src/dashboard/state/preflight-actions.tsx`: `PreflightActionsProvider`, `usePreflightActions` | Shell-registered actor/descriptor identity, `showSettings(section?: "storage")` and `showSessions()` connect existing remedies. TopBar mounts the isolated doctor component; absent checks do not render a false pass. Setup may extend its isolated popover/model, Settings preflight model/view and released preflight client/route leaf modules. Shared shell/client registrations are complete. |
| `src/domain/secrets.ts`: `protectedSecretRevision` | Value-free revision read through the existing sole credential reader. Secret values do not enter public reports. |
| `tests/fixtures/preflight-seams.ts`: `healthyRuntimePreflightRunners` | Controlled detector observations for independently executable composition fixtures; real production selection, report authority, admission and effect boundaries remain in place. This fixture is not detector acceptance or a production bypass. |

#### Focused proof and retained limits

Evidence: [amendment receipts](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11-preflight-2026-09-19/).
`validate.py`, `checks.json`, `implementation-paths.json` and `tested-inputs.json` bind exact commands,
44 implementation paths and 2,410 source/test/config/script inputs to the candidate. Recording and
integration reuse only unchanged inputs; the integration tree equals the tested candidate tree.

| Check | Actual result |
| --- | --- |
| Assigned admission plus CLI composition | **147 tests / 8 files passed.** Includes required/missing detector refusal, healthy enqueue/spawn/browser controls, optional/unselected scope, retained config, protected revision, expiry, replay/effect counts and obsolete UI responses. Full 14-fault detector corpus is not claimed. |
| Expanded effect checks | **456 passed, 4 pre-existing failures** across the final results of 14 files. The real worker/Chromium process test passed separately after repairing its restart fixture's write-lock race; all other implementation inputs were unchanged. Four run-record deletion tests fail `no such table: notification_publications` identically on untouched baseline `191ce8b1…`; both logs are retained. The assigned Sessions effect tests pass. |
| Expanded architecture checks | **78 passed, 46 pre-existing failures** across 13 files. All 46 wire-connectivity failures reproduce with identical test names on unchanged baseline; calendar fixture/native saved-file sink assertions prevent that broad guard from completing. No pass is claimed for it. The new preflight client/route pair additionally passes the same mechanical connectivity checker in isolation. |
| UI units | **75 tests / 9 files passed.** Existing Setup/report and Sessions/launch boundaries retained. |
| Assigned browser gate | **13 tests passed**, all four assigned specs, both themes, real controls/readback and cleanup; `assigned-parity-final.log`. Existing visuals/primitives unchanged; no reference refreshed. |
| Additional Settings browser sample | Two real-authority interaction cases passed; ten reference cases fail the pre-existing `71b1674f…` versus `a14b8216…` descriptor provenance drift. No pixel pass or reference waiver is claimed. Deliberate broad reference acceptance remains 3.1.19. |
| Lint, build and generated checks | Exact changed TS/TSX ESLint, web build, manifest generation/check and store catalog generation/check passed. No generated manifest/catalog content changed. Diagnostic `tsc --noEmit --pretty false` passed. Full coverage and repository-wide lint were not run. |
| Release and cleanup | Integration `ef050d0a8…` verified; planning worktree/ref removed. Final recording and implementation-worktree removal are bound in external `cleanup.json` and `launch.json`; launch verifies both before dispatch. Peer Run/Rerun and active UI planning worktrees are preserved. |

The supplemental baseline failures remain explicit 3.1.19 obligations. They do not replace, narrow
or waive the amendment's passing admission proof or the assigned Sessions selectors. Setup still
owns real missing detectors, every fault-manifest/dependency expansion, final doctor/Setup rendering,
remedies and fresh served readback. Missing production detectors continue to refuse until implemented.

**Delivery assessment.** The planning amendment was omitted from the original parent handoff; this
follow-up completes that approved ownership rather than transferring shared-root work to Setup.
Actual production tracing found that enqueue bypassed the nominal helper and that claim selection
was private to SQLite. The final map records the necessary lifecycle/selector/CLI seams. Earlier
process fixtures needed controlled detector inputs after admission became real. One restart fixture
could stop a child inside a write transaction; it now holds the write lock while confirming children
are stopped, preserving the real restart/replay assertions. Shared rerun state now uses fresh readback
so old replay cannot look current. No expectation, guard membership or timeout was weakened. Full
iteration totals are unavailable; exact observed commands and failures remain in the receipts.

### Run/Rerun child ownership release — 2026-09-19

The operator approved transferring two still-missing launch operations to 3.1.11.2: the narrow
served Rerun action/app-dispatch registration and source-bound warning preview before Values are
complete. The [child's approved amendment](task-11-2-make-run-and-rerun-enqueue-real-work.md#approved-launch-ownership-amendment--2026-09-19)
owns the exact files, source/consent fences and proof. These exceptions supersede earlier blanket
parent ownership of shared launch registration; accepted Sessions/preflight completion stands.
Setup's allocation and preflight admission remain unchanged. No implementation is claimed here.

### Frontend-only Sessions presentation amendment — 2026-10-01

This amendment records the approved frontend replacement in deployment `activity-ui-20261001`; it
does not revise the historical backend authority contracts or mark this phase task complete. The
current `SessionPanel` supplies local fictional data through `SessionsViewState` to `SessionsView`.
Its `SessionWorker.timeline` is an explicit `SessionNode[]` (`id`, `label`, `state`), rendered by
`SessionTimeline` with one segment per node. The displayed completed/total count comes from that
array and appears beside the worker's current action; the UI no longer guesses progress from
completed/total stages.

The Separations fixture uses the approved 22-node Explorer preview, with 11 complete at “Read the
timecard”; the independent Person lookup preview has four nodes, with three complete. Pause/resume
updates the active node state, retry resets the first node to active and the remainder to pending, and
stop clears the timeline. All controls change fixtures only. The fixture imports the Explorer's local
producer; Sessions makes no backend import or request.

The card order is workflow/subject header, systems grid, divider with current action and node count,
node segments, then elapsed-time/control footer. The grid has at most two columns of 32px tiles: one
system or an odd final item fills its row, and two systems share a row. Active cards remain below 250px.
App no longer passes worker cards, pools, clock, connection/version or worker command dispatch into
this surface. The old connected SessionPanel and timeline renderer are retired; legacy/domain models
and old connected-UI tests remain for deliberate future wiring and migration. The exact checks and
retained limits are recorded in the [deployment evidence checkpoint](/Users/julianhein/Projects/hr-automation-rebuild-evidence/activity-ui-2026-10-01/current-state.md).
