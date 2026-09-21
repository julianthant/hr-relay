# Task 3.1.11.1 · Finish Setup and preflight
<!-- roadmap: dash-setup -->

**Focused release accepted 2026-09-21.** Local integration and owned cleanup are complete; see
[accepted integration and cleanup](#accepted-integration-and-cleanup--2026-09-21). Earlier pending
intake/integration statements below describe the frozen candidate. Full acceptance remains 3.1.19.

**Current assignment: 3.1.11.1.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [x] Derive setup from authoritative settings/storage/workers/browsers/prerequisites and execute the
  complete preflight fault corpus with real idempotent repair/re-check actions.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref clock-config-secrets` §D331.10 (Setup renders the same
> served catalog projection, with the `provider-env` families read-only) and §D331.11 P16 — doctor and
> preflight name a protected leaf by NAME and presence only. The first post-upgrade boot's
> `migrated-refused { key }` refusal is a SETUP fault, not an outage: it is presented with the same
> `.env` remove-list the upgrade plan printed (`ref clock-config-secrets` §D332.S5). No redesign.

Consume the accepted parent release's current schema, retaining floor 46, and the current catalog/preflight contract. The earlier schema-50 and migrated-refused/environment-import wording is historical: it does not authorize retired imports or below-floor upgrade. Display the current named admission/refusal and explicit compatible-release remedy. The execution record below supplies the completed local fault corpus; finalizer integration and live acceptance remain open.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-19

The operator selected **1 A** (parent 3.1.11 owns shared preflight admission hooks; Setup owns
detectors and its UI), then approved the complete S1–S5 proposal and documentation persistence
in this planning session on 2026-09-19. This is the single implementation plan for **3.1.11.1**.
Approval does not complete implementation, authorize product integration, or release this child
before its parent. The [parent admission amendment](task-11-finish-sessions-worker-pools-and-browser-lifecycle.md#preflight-admission-ownership-amendment--2026-09-19)
preserves independent Setup and Run/Rerun children; neither requires the other's unmerged work.

Requirements remain at [A07](task-8-acceptance-matrix.md#a07),
[the one preflight authority](../../../reference/clock-config-secrets.md#62-one-environment-doctor-replaces-scattered-startup-surprises),
[D331.10 and D331.11](../../../reference/clock-config-secrets.md#d33110--the-settingssetup-interface-edit-contract-31-consumes),
[scenario corpus](../../../reference/operator-trust.md#31-example-is-not-a-scenario), and
[the coverage guard](../../../reference/guards-and-tests.md#311-old-capability-closure-and-advisory-ai).
The linked contracts govern; this brief assigns delivery and proof rather than copying them.

### Assignment and checkout binding

| Binding | Approved value |
| --- | --- |
| Supervisor | One operator-opened Codex supervisor; **model and effort are selected by the operator**. This supersedes the earlier model assignment. Detector composition, admission evidence, report freshness and UI readback remain one coupled assignment. |
| Allocation / review | **Zero implementation workers and zero independent reviewers.** Phase 3.1's focused cadence applies. No sibling or next-task dispatch. |
| Mode | New dedicated implementation worktree; never implement in the integration checkout or the planning worktree. |
| Branch | `codex/3.1.11.1-setup` |
| Absolute checkout | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-setup` |
| Inspected baseline | Local `master` at `517f7319fdcd771aee8356e664f1e8a885032ba0`; 3.1.9.8 integration `801da4f3d1bfdf0a9ecc81c993289f70699aa140` and closure `cda383062` are ancestors. This baseline does not contain accepted 3.1.11 implementation. |
| Start prerequisites | Accepted and integrated 3.1.11 including the admission amendment, actual exported interface/file map, focused proof and owned cleanup; accepted Settings, Storage, dashboard boundaries and 3.1.9.8 remain required. The complete approved child plan must be committed and available from the execution base. |
| Implementation base | Resolve the parent's actual accepted integration SHA from its release record, verify it in local `master` ancestry, and choose the verified descendant containing this approved plan. Record the full base SHA before checkout creation. No future SHA is assumed. |
| Integration target / owner | 3.1.11.3 consumes the exact passing Setup and Run/Rerun candidates in either order. The operator chooses integration into local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`; this child does not merge itself. |
| Development completion | S1–S5 focused proof and committed candidate/evidence ready for finalizer intake. Roadmap completion additionally requires accepted integration and owned cleanup. |
| Evidence | `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.1-setup-2026-09-19/`; retain logs, command receipts, tested inputs, browser proof and cleanup identities outside the disposable worktree. |

The implementation ref/path were absent at planning; names are proposals, not reservations.
Parent `codex/3.1.11-sessions` occupies
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-sessions` and was actively
modified. Planning uses `codex/plan-3.1.11.1` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-setup-plan`, from the
inspected baseline. Recheck ownership, refs, clean/owned changes and worktree capacity before launch.
Follow [parallel coordination](/Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md#parallel-coordination):
independent work by default, no shared-index queue or unsolicited peer polling/messages.

### Feasibility and proof bindings

These are historical planning observations. The accepted parent amendment below supplies the shared mechanisms; the execution record records child detector/UI proof separately from finalizer acceptance.

| Question / current evidence | Necessary change and owner | Required proof / exclusion effect |
| --- | --- | --- |
| `createDashboardPreflightRunners` supplies six checks; `createPreflightAuthority` is composed only for `dashboard.serve`. Enqueue/worker composition has no caller of that authority. | Parent owns real shared admission and registration; S2 owns remaining detector implementations under the released port. | P1 proves refusal before enqueue/spawn/browser effects and a valid positive control. Parent hook readiness is not completion of this child's full detector corpus. No shared-entrypoint edits by the child. |
| `PREFLIGHT_SCENARIO_MANIFESTS` declares 14 faults; its fixture contains only healthy/unhealthy labels, and no executor runs the manifests. The prose's fifteenth mode is the separate healthy control. | S4 owns an executed, manifest-bound corpus and `preflight-coverage` activation. | P2 exercises each declared fault and its actual dependencies, plus healthy restoration. A label, fabricated observation or declared-but-unexecuted scenario cannot establish detector coverage. |
| The retained authority already rejects missing/extra runners, validates fingerprints, retains successful/failed replay identities, serializes actual settlement and bounds identities at 256. | Consume those semantics; parent owns any necessary shared contract/authority changes before release. | P3 preserves exact/divergent/in-flight/failed replay, timeouts, cancellation, capacity and ingress bounds; do not add durable mutation journaling to read-only reruns. |
| Settings currently shows retained count; its rerun hook stores a local result. The doctor renders a separate supplied list and folds an empty list to pass. | S3 consumes the released shared report/freshness state and updates only isolated presentation/state modules. | P4 proves consistent Setup/doctor facts, no green absent report, explicit failed/stale/unavailable states and rejection of obsolete late results. |
| Protected settings inspection has present/missing/unknown arms; provider declarations include key-only providers without production adapters. Run resources are selected from retained configuration. | S2 consumes authoritative presence, provider availability, selected instance and configuration facts. Parent supplies the shared input/readback ports. | P5 proves name/presence-only public output, no secret/path leakage and no executable-readiness claim from keys alone. Do not implement new adapters or replace a retained run's settings with current settings. |
| Accepted Settings, Storage and Sessions own writes and recovery controls. Ordinary settings can require restart; protected updates take effect at their defined next use. | S3 links existing explicit actions and authoritative re-check; no independent repair engine. | P6 proves repeated explicit actions/re-checks are truthful, attributable and idempotent through the owning services, including restart and supported recovery on disposable roots. |

The 3.1.9.8 [delivery assessment](task-9-8-finalization-dashboard-surfaces.md#delivery-assessment-and-deferred-acceptance)
found unregistered disposable writers and a fixture narrowing defect. Register any new proof
writers under the existing parity guard and run that focused check before freezing the candidate;
do not repeat a broad ratchet invocation merely to validate guard membership.

### Ordered implementation

1. **S1 — Verify parent release.** Read the accepted parent map and admission proof. Verify actual
   readiness/report operations, descriptor-derived selection, freshness/refusal semantics and hooks
   before enqueue, worker and browser effects. Verify that both children independently consume this
   base, and record actual exported names and paths here. Reconcile changed inputs before edits.
   An unfinished shared hook returns to the parent; do not take over its files or silently use a
   sibling API. Use the parent's accepted schema, retaining floor 46.
2. **S2 — Complete detectors.** Extend the registry-selected production runner factory for browser
   assets, fiscal dates, protected-secret presence, selected prod/test endpoints and provider/feature
   availability. Reuse the existing six detectors and authoritative Settings, Storage, worker/session
   and runtime inputs. Registry selection owns membership and capability blocking. Read-only probes
   do not authenticate, launch an HR browser, call a provider to infer health or mutate authorities.
   Unreadable/missing evidence remains a named refusal or unavailable state. Selected mandatory
   failures block; optional failures do not block unrelated capabilities.
3. **S3 — Finish Setup and doctor UI.** Use the existing Settings preflight slot and doctor popover,
   with `/ui` Components as the local lead. Render the shared served report, affected capabilities,
   timestamps and freshness; distinguish running, failed, unavailable and stale results. Preserve
   served restart-required behavior and reject late results for obsolete inputs. Offer existing
   explicit Settings, Storage and Sessions operations followed by authoritative re-check; otherwise
   show the exact supported remedy. No unsupported repair button, new Setup route, client health
   inference or independent settings editor. Inspect the specimen before choosing primitives.
4. **S4 — Execute the fault corpus.** Replace the placeholder fixture evidence with a runner that
   parses every declared manifest, injects controlled boundary inputs and executes the production
   detector/authority. Cover all 14 declared faults plus a healthy control; expand families over
   every mapped dependency rather than proving one endpoint/secret/provider and claiming all.
   Add negative controls for absent/unexecuted/unknown scenarios, mismatched evidence and a detector
   that incorrectly reports healthy. Activate `preflight-coverage` and its inventory row only with
   this executed evidence. Exercise restart/recovery on fresh private roots and preserve zero
   unauthorized write/launch effects. Do not mutate the operator's existing installation.
5. **S5 — Verify and freeze.** Run P1–P6 and G1–G4, repair within-scope failures, record exact
   candidate/tested inputs and commit logical categories with exact paths. Freeze the passing
   candidate for 3.1.11.3; record development completion separately from finalizer acceptance.
   Retain evidence, close owned browsers/processes and remove disposable proof roots. The operator
   controls later integration; the finalizer owns combined checks and task-worktree cleanup after
   accepted integration. No push or next-task dispatch.

### File and interface allocation

Paths below are repository-relative. New filenames are assigned outputs, not claims they exist.
Adjacent helpers must retain the listed owner and purpose and be recorded in the final map.

| Owner | Exclusive paths and responsibility |
| --- | --- |
| Setup supervisor, S2 | `src/server/preflight/` runner implementations and isolated composition helpers, including new `workflow-runners.ts`; consume the parent's fixed factory/import boundary. No second registry. |
| Setup supervisor, S3 | `src/dashboard/surfaces/settings-preflight.tsx`, `settings-preflight-model.ts`, `preflight-popover.tsx`, `preflight-popover-model.ts`; `src/dashboard/client/preflight-queries.ts`, `src/dashboard/state/preflight-client.ts`; `src/server/dashboard/routes/settings-preflight.ts`, `settings-preflight-types.ts`, subject to the parent's released map. |
| Setup supervisor, S4 proof | `src/domain/trust/preflight-scenarios.ts`; `tests/fixtures/preflight/`; existing preflight/protected-settings tests selected below; new `tests/unit/server/preflight-corpus.test.ts`, `preflight-workflow-runners.test.ts`, `preflight-recovery.test.ts`, `preflight-admission-consumer.test.ts`; `tests/unit/dashboard/setup-preflight.test.ts`; `tests/unit/architecture/preflight-coverage.test.ts`. |
| Setup supervisor, browser proof | New `tests/parity/setup-preflight.spec.ts`, `tests/parity/helpers/fixture-setup-preflight.ts`, `tests/parity/helpers/reference-setup-preflight-scenes.ts`, `tests/parity/references/setup-preflight--*`; only affected existing Settings reference pairs with deliberate attribution. Use accepted shared harnesses unchanged. |
| Setup supervisor, evidence/docs | This task owner; `docs/rebuild/guard-inventory.json` solely for `preflight-coverage` activation/deciding proof and exact owned disposable-writer registration if required; scoped guard-owner as-built text in `operator-trust.md` and `guards-and-tests.md`. The finalizer reconciles shared documentation/generated output. |
| Parent 3.1.11 before release | Shared preflight schemas/semantics/authority, descriptor-to-capability mapping, app/client/BFF/bootstrap registrations, settings/session readback and action hooks, start/enqueue/worker/browser admission, shared fixture registration and writer-inventory ports. Full ownership is in the linked admission amendment. |
| Run/Rerun 3.1.11.2 | Run modal, launch state, start-plan service behavior and prior-value transport after parent acceptance. Setup may not edit these or require an unmerged sibling change. |
| Finalizer 3.1.11.3 | Combine both child commits in either order; reconcile shared generated artifacts/contracts and repair cross-child integration. Required shared operations must already work at parent release. |

The preflight guard activation is the child's bounded manifest responsibility; no sibling writes
that row or the Setup proof names. If a necessary new writer registration reaches an unallocated
shared test helper, resolve that exact owner before editing rather than widening the allowlist.
No SQL migration, settings catalog redesign, provider adapter, root test configuration or broad
fixture rewrite is assigned to Setup.

### Proof matrix

| Proof | Required result and meaningful negative controls |
| --- | --- |
| P1 — real admission consumers | Against the accepted parent services, a selected mandatory fault prevents enqueue and worker/browser launch. An optional/unselected failure leaves an unrelated valid capability usable. Include a healthy positive control so tests cannot pass through unrelated setup failure. Stale scope/config/descriptor input refuses before detector/effect work where the parent contract requires it; no new universal refusal order is invented. |
| P2 — executed corpus | Execute runtime mismatch, missing browser, invalid config, low disk, corrupt DB, busy port, stale fiscal dates, missing workflow secret, orphan process, OCR exhaustion, AI exhaustion, bad prod endpoint, bad test endpoint and optional provider unavailable. Match manifest terminal/evidence/failure expectations and zero external commits; registry-derived dependency expansion closes all members. Missing runner/scenario, extra scenario, incorrect evidence or false healthy observation must fail. |
| P3 — bounded re-check | Exact successful, failed and in-flight replay does not execute another detector pass; divergent reuse refuses. Preserve 256-identity capacity without eviction, config/descriptor binding, loopback/body/rate/single-flight ingress, registered deadlines and cancellation through actual settlement. A timed-out late healthy return never becomes a pass; restart does not pretend process-local replay survived. |
| P4 — presentation/freshness | Setup and doctor agree on served scope/checks/blocks/time. Absent or empty report, request failure, stale retained result and unavailable check never look current/healthy. Settings restart requirement and changed protected presence cause the correct re-check/readback. Late old responses cannot overwrite current state; reload reads authoritative current status. Keyboard reaches re-check/remedies and focus returns correctly at desktop sizes and real zoom. |
| P5 — privacy and capability truth | Inject synthetic secret/person/private-path markers into source failures and assert none escapes through UI, HTTP, safe logs or corpus output. Only protected names/presence and permitted root basenames appear. Unknown secret source, missing required endpoint, selected test/prod mismatch and key-only unavailable provider are truthful. No raw exception echo, hash/value comparator or new external probe. |
| P6 — remedies/restart/recovery | Explicit existing actions retain owning-service identity and refusal semantics; report repaired only after authoritative re-check. Repeat requests preserve idempotency. Fresh-root, restart-required/current, supported recovered root, corrupt root, wrong/newer schema and below-floor cases retain named outcomes; no automatic backup/restore/upgrade, substitute database, process kill or change to the standing runtime. |

This is synthetic/local production-service proof. Current HR/browser/provider state correlation is
not inferred from it: 3.1.18 supplies the harness and 3.1.19 executes required A07 live dry-run
acceptance with zero external writes. No actual-target migration or deployment is assigned here.

### Gate and resource schedule

Run from the absolute implementation checkout. New selectors below must be authored before their
gate runs. Inspect the parent's final map for an explicitly moved selector; preserve the same proof
and record any path correction. Changed scope or missing shared mechanism returns for amendment.

**G1 — detectors, corpus, admission and recovery**, after S2/S4 and invalidating fixes:

```sh
npm run test -- tests/unit/preflight-dashboard-runners.test.ts tests/unit/server/preflight-runners.test.ts tests/unit/preflight-runtime-dependencies.test.ts tests/unit/protected-settings-doctor.test.ts tests/unit/storage-diagnostic-redaction.test.ts tests/unit/server/preflight-workflow-runners.test.ts tests/unit/server/preflight-corpus.test.ts tests/unit/server/preflight-recovery.test.ts tests/unit/server/preflight-admission-consumer.test.ts
npm run test -- tests/unit/architecture/preflight-coverage.test.ts tests/unit/architecture/runtime-dependency-coverage.test.ts tests/unit/architecture/runtime-environment-coverage.test.ts tests/unit/architecture/redaction-surface-scan.test.ts tests/unit/architecture/parity-reference-authority.test.ts
npm run test -- tests/unit/architecture/guard-manifest.test.ts -t 'recursively registers every guard file exactly once and every active entry exists'
```

**G2 — client, UI and desktop proof**, after S3/S4 and invalidating fixes:

```sh
npm run test -- tests/unit/dashboard/preflight-client.test.ts tests/unit/dashboard/setup-preflight.test.ts tests/unit/dashboard/settings-editor-surface.test.ts tests/unit/dashboard/settings-storage-doctor.test.ts
npm run web:build
npm run test:parity -- tests/parity/setup-preflight.spec.ts tests/parity/reference-settings.spec.ts --workers=4
```

The Setup spec owns both-theme screenshots/a11y/provenance for relevant states at 1280×720 and
1440×900, plus 1024×720 minimum-canvas resizing. Use the prescribed `playwright-cli` playbook for
specimen inspection and targeted keyboard/focus proof. D04 additionally requires actual 125% browser
zoom at 1280×720 and actual 200% at 1440×900, recording effective CSS viewport, browser/version and
zoom mechanism. CSS zoom/device scale factor/resizing do not substitute. Attribute new/changed
reference pairs, deliberately update only owned affected scenes with `test:parity:update`, then run
the same assert gate. Do not weaken thresholds or broadly refreeze.

**G3 — scoped lint and affected quick checks.** Freeze the exact changed `.ts`/`.tsx` paths from
`git diff --name-only --diff-filter=ACMR <verified-base> -- '*.ts' '*.tsx'`, record the actual base
and path list, and pass that list as an argument array to `npx eslint` with `--max-warnings 0`.
Include new fixtures/helpers, not only production files. All selected tests require this lint gate.
If an owned edit changes a descriptor import closure, run `npm run build:manifest` followed by
`npm run build:manifest:check` locally; retain the source-bound result as evidence for finalizer
combined regeneration rather than making one child depend on another's generated artifact.
Do not claim untouched catalog/build outputs were regenerated. Documentation changes use G4.

**G4 — record/candidate boundary.** Run applicable roadmap binding, changed-link, instruction-pair/
chain-size and `git diff --check` validation. The finalizer owns combined generated roadmap output.
Record commands, exit status, actual tested tree, evidence paths, candidate SHA and deferred proof
here. Reuse only evidence with unchanged relevant source/test/config/dependency inputs; rerun after
invalidating changes, failures or uncertain results. Do not rerun all focused gates solely to add a
recording-only commit. At candidate freeze, all assigned focused checks must pass.

Use at most four file workers. Tests and browser servers use task-private temporary state, artifact,
auth/profile and process-lock roots with ephemeral loopback ports; never operator ports 3938/5174 or
the standing authority. Serialize writers to the same build/reference output within this checkout;
separate checkouts with isolated outputs do not require a blanket queue. Retain exact process/session
identities and close only owned resources. No coverage run is assigned to this child.

3.1.11.3 runs combined typecheck, focused integration/regression tests, scoped lint and affected
build/generated checks. Full repository coverage/lint/architecture, broad parity, production,
performance, recovery and live acceptance remain **3.1.19**; none is credited here as passed.

### Exclusions, stops and current state

Do not add a broad CLI doctor or `test-login`, new provider adapters, a parallel preflight registry,
automatic repair, workflow/Run/Rerun redesign, new Setup navigation, protected-value readback,
mobile variants, live HR writes, production cutover or legacy runtime access. Do not change schema
floor, retired imports, supported recovery policy, gate membership/assertions/floors/timeouts, or
the parent/sibling's owned implementation. Existing current contracts remain normative.

Stop dependent work for missing parent integration/exports/proof, required edits outside ownership,
changed capability/report intent, unavailable required proof or an unresolved secret/effect boundary.
Routine detector helpers, layout within the existing design system, fixture construction and tactical
fixes remain the supervisor's choices. Do not re-ask settled choice 1 A or the approved S1–S5 scope.

| State | Record |
| --- | --- |
| Approval | Choice 1 A and complete S1–S5 plan approved 2026-09-19. |
| Implementation | S1–S5 development complete. Implementation candidate `3d5c7d7beacfabd47c5b77274954936656d17596`; focused P1–P6/G1–G4 evidence recorded below. The recording-only tip is bound in the external freeze receipt. |
| Parent release | Sessions plus the preflight amendment accepted in local `master` at `ef050d0a8cb99aa39b54f726b2bdd5269f125dfa`; exact interface/proof map in the parent release. Verify external cleanup receipt before launch. |
| Plan availability | Complete approved S1–S5 plan `ac060faaf2a9f7cf9bc04f14335121cad0392e67` is integrated. This release record accompanies it; planning worktree and branch removed. |
| Child/group release | FROZEN for 3.1.11.3 intake. Combined acceptance, operator-selected integration and task-worktree cleanup remain open. The roadmap checkbox remains open until those conditions are met. |
| Broad proof | Deferred to 3.1.19. Local synthetic production-service proof is complete; full repository and live/production acceptance are not claimed. |

Maintain this compact state in place during execution, linking dated evidence. Send Done / Now /
Remaining once at start or genuine resume; later updates report only new verified completions and
material blockers. Routine transfers use this owner; interrupted unique state uses `/handoff`.

### Planning validation — 2026-09-19

The approved documentation candidate is isolated on `codex/plan-3.1.11.1` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-setup-plan`, based on
`517f7319fdcd771aee8356e664f1e8a885032ba0`. Only this child owner, the parent admission amendment,
the acceptance ownership pointer, the roadmap journal and generated roadmap are changed.
Active shared-checkout date-navigation edits and parent implementation edits are not part of this
candidate. Documentation integration has not been assigned; preserve the candidate for that step.

Evidence is retained under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.1-setup-2026-09-19/planning/`.

| Check | Result / evidence |
| --- | --- |
| Roadmap binding | `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts`: exit 0, 1 file / 24 tests; `roadmap-binding.log`. |
| Scoped lint | `npx eslint scripts/generate-roadmap.ts tests/unit/architecture/roadmap-doc-binding.test.ts --max-warnings 0`: exit 0; `scoped-lint.log`. |
| Generated roadmap | `npm run roadmap` and `npm run roadmap:check`: exit 0; `roadmap-generate.log`, `roadmap-check.log`. Generation/freshness is repeated after this recording-only addition. |
| Links / instructions / diff | All 12 added links and fragments resolve; all 9 existing instruction pairs match; all 18 complete instruction chains are below 32,768 bytes (maximum 23,221); `git diff --check` passes. Reproducible checks and source digests: `verify-plan.py`, `plan-validation.json`, `instruction-chains.json`. |
| Selector availability | 16 existing focused gate selectors resolve. Nine additional selectors are explicitly assigned future proof files (seven child, two parent); no absent file is claimed as an executed test. |
| Scope / acceptance | Exactly five documentation/generated-document paths. No code, test, dependency, configuration or runtime-state changes. No runtime gates run or reused, no independent review or agent dispatch. Implementation acceptance remains open. |

The tested source/test/config/dependency inputs are unchanged by this validation record; its plain
text introduces no roadmap binding or status. The 24-test binding result and scoped lint are reused
for that recording-only addition; generated freshness, added links, scope and diff checks are
re-established on the final candidate. Commit verification must read this complete owner and the
parent amendment from the actual commit, verify the branch reaches it, and recompute start
prerequisites. A committed planning candidate does not satisfy missing parent integration.

### Historical parent release verification — 2026-09-19

After the operator reported 3.1.11 done, inspection of clean local `master` at
`191ce8b1cb79d0930d89d60cb5501914c3fa4b09` confirmed accepted Sessions merge
`c90da4ffc45ddfe6486192b8df68816dc6fe34a3` and its completion record. The Sessions implementation
branch, worktree registration and physical folder are absent. Schema 53/floor 46 and the accepted
session/control work are available. Those accomplishments are not reopened by this record.

The separate approved planning commit `15ccbbadeb91bc3faa02f6516faa6985c1529cec` is not in
`master` ancestry. Its preflight admission amendment was not part of the completed parent scope.
The actual released `src/dashboard/client/preflight-queries.ts` exports `readiness()` and
`rerunPreflight()`: the first reads bootstrap checks; the second invokes the existing rerun route.
`src/server/dashboard/compose.ts:617` still composes only `dashboard.serve`. The new
`tests/unit/dashboard/setup-boundary.test.ts` exercises that dashboard-only report/replay path;
it does not assert pre-enqueue or worker/browser admission effects.

The core authority, dashboard runners, start-plan service and enqueue service are byte-identical
to the inspected planning baseline. No production preflight caller exists in worker/start/enqueue
composition beyond the dashboard authority. The amendment's two assigned proof files,
`tests/unit/server/preflight-admission-boundary.test.ts` and
`tests/unit/dashboard/preflight-readiness-boundary.test.ts`, are absent from the accepted tree.
These are inspected code/test facts, not failed executed tests or a claim that the accepted Sessions
proof failed.

**Resolution remains the approved choice 1 A:** incorporate the committed documentation amendment
and complete its bounded shared admission/freshness hooks and focused proof as a parent follow-up,
then verify that accepted integration before launching Setup. Do not silently transfer those shared
files to this child, make it depend on Run/Rerun, or waive the no-launch-on-required-failure proof.
This is outstanding previously approved work, not a new product choice. No implementation or
supervisor launch is authorized by this verification-only continuation.

This recording-only update changes no code, test, dependency, configuration, binding or roadmap
status. The earlier 24-test documentation binding and scoped lint evidence remains applicable;
roadmap freshness, instruction/link/scope checks and whitespace are rechecked. The plan remains
**WAITING ON documentation integration and the approved parent admission amendment** at that inspection. The following accepted release supersedes that status.


### Accepted parent release and launch — 2026-09-19

The operator then directed **“do that and launch 3.1.11.1”**. Parent implementation
`549a701863720adb40ed2263a454cbeb44b0cf6c` and the approved plan are integrated at
**`ef050d0a8cb99aa39b54f726b2bdd5269f125dfa`**, a verified descendant of the accepted Sessions
and Settings/Storage prerequisites. The [parent's exact release map](task-11-finish-sessions-worker-pools-and-browser-lifecycle.md#exact-preflight-interface-release)
is the S1 input: production plan/enqueue/worker/claim/browser assertions, retained identity, protected
revision and 60-second freshness, registered detector factory, scoped served read/rerun operations,
shared UI state and explicit remedy navigation all exist and have focused positive/refusal proof.

Setup owns subsequent implementation of `createRuntimePreflightRunners` and private detector modules,
its assigned views/models, released preflight query/route leaves and the manifest-bound fault corpus.
The parent shared composition roots, lifecycle/SQLite admission, domain authority and shell provider
are released inputs, not child edit assignments. The six existing detectors remain; unavailable
non-dashboard detectors honestly refuse required scopes until S2 implements them. Controlled healthy
fixtures prove the parent gate, not the child's real detector or complete fault-corpus acceptance.

Use the exact approved branch `codex/3.1.11.1-setup` and checkout
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-setup`. Launch creates it from
the verified local `master` descendant containing this release record, records the full base in
[the launch receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11-preflight-2026-09-19/),
and requires reuse of that owned checkout. The same directory retains `cleanup.json`, `integration.json`
and `tested-inputs.json`; verify release ancestry and cleanup before the first edit. The operator
selects the session model; no override is assigned by this handoff. Zero implementation workers and
zero independent reviewers remain approved. Follow S1–S5 and P1–P6/G1–G4 in this complete brief;
freeze a passing candidate for 3.1.11.3, with no push, self-integration or sibling dispatch.

Parent supplemental checks identified baseline run-record deletion and wire-connectivity fixture
failures and existing Settings descriptor-reference drift. Their exact comparisons are retained in
the parent receipt. Full repository repair/acceptance remains 3.1.19; none is silently marked passed.
Reproduce any relevant child failure before assigning it to that baseline. The child's own selected
checks, detector corpus, presentation and remedy proof remain mandatory.

### Execution state — 2026-09-19

**Development complete; frozen for 3.1.11.3 intake.** Implementation commit
`3d5c7d7beacfabd47c5b77274954936656d17596` is on `codex/3.1.11.1-setup`, based on
`dac7528a12be884542d36355492fafcdffb63a30`, in the assigned Setup checkout. The recording-only
commit does not change tested runtime, tests, references, dependencies or configuration. Its exact
tip and tree are bound in `implementation/freeze.json`. Finalizer acceptance, integration and
removal of the task worktree remain open; this task does not mark the roadmap checkbox complete.

All evidence below is retained under
[the implementation evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.1-setup-2026-09-19/implementation/).
`final-gates.json` records exact command arrays, working directory, exit codes and log names;
`final-tested-inputs.json` binds 2,570 relevant files. `implementation-paths.json` lists the exact
202 feature paths; this task owner is the only additional recording path. Earlier failed iteration
logs remain evidence, and are superseded only by the explicitly named passing receipts below.

| Stage / proof | Completed result |
| --- | --- |
| S1 | Verified dedicated checkout, approved plan and parent integrations in ancestry, parent cleanup receipts and all 2,410 parent tested-input hashes unchanged; `s1-release.json`. Consumes the parent's exact interface release, including real admission consumers and scoped report/rerun operations. |
| S2 / P1 / P3 / P5 | Registry-selected browser/Duo assets, fiscal dates, every protected-secret name, complete selected production/test endpoint sets, executable provider availability and selected feature exhaustion. No browser/authentication/provider probe or authority write is used to infer readiness. Actual plan, enqueue, worker, claim and browser consumers exercise healthy and refusal paths, optional-provider scope, replay and stale-input behavior. |
| S3 / P4 | Setup and doctor share the served scope/report and selection. Absent, empty, future, expired and failed reports never appear current/healthy; restart-required refuses re-check, obsolete results cannot replace current state, and diagnostics remain safe. Remedies use existing Settings, Storage and Sessions navigation. |
| S4 / P2 | All 14 declared manifests execute through 72 dependency-expanded fault cases, with healthy controls and restored checks. Missing/extra/unexecuted scenarios, mismatched evidence and a deliberately false-healthy detector are rejected. Browser launch, child spawn and fetch counters remain zero; authority bytes are unchanged by detector execution. `executed-corpus.json`; `preflight-coverage` is active. |
| P6 | Fresh authority is healthy without automatic backup. Supported single-authority restore re-checks healthy. Corrupt, wrong/newer/below-floor authorities refuse without automatic mutation. Interrupted paired restore clears its marker through the existing command, but retained custody keeps the existing storage doctor unhealthy, as detailed below. |
| S5 | Assigned focused checks pass; exact source/test/config/reference hashes remain unchanged. No implementation workers, independent reviewers, peer dispatch, external transactions, standing-runtime writes, push or self-integration occurred. |

The adjacent helper map is now concrete: `provider-runners.ts` accompanies `workflow-runners.ts`;
`tests/fixtures/preflight/runtime-fixture.ts`, `corpus.ts` and `served-runtime.ts` provide private
production-service proof; the two assigned parity helpers compose that served runtime and its six
scenes. `tests/unit/dashboard/preflight-client.test.ts` preserves direct schema assertions while
checking safe public diagnostics; `settings-storage-doctor.test.ts` supplies the released shared
provider wrapper. No registry, migration, provider adapter or shared composition root was added.

### Authorized bounded repairs

The operator explicitly authorized all three ownership exceptions in this session:

| Repair / authorization | Exact bounded change and evidence |
| --- | --- |
| “Authorize bounded repair here” | The parent could not represent OCR ready and AI unavailable in one selected scope. `src/domain/preflight.ts`, `preflight-contract.ts` and `preflight-semantics.ts` now permit a passing provider's nonempty, unique `availableFor` feature subset, validated against its registered support. An unqualified existing pass retains availability for all declared features. The owning `clock-config-secrets.md` contract and focused report tests agree. No capability IDs, registry membership or severity changed. Reproducer: `mixed-provider-repro.mts` / `.jsonl`; passing proof in G1. |
| “Authorize fixture repair here” | Exactly three lines in `tests/parity/helpers/fixture-bff.ts` add GET `/api/v1/preflight` with explicit unavailable readiness because this shell fixture does not compose runtime readiness. This removes the eight required Settings cases' missing-route errors. Production routes and assertions remain unchanged; `proposed-fixture-route.patch`, `settings-parity-before.log` and final G2 proof. |
| “Authorize guard repair here” | Ten repository-authored origin declarations in `tests/unit/architecture/helpers/redaction-surface-audit.ts` cover five existing Sessions fields on both dashboard and stream reports: browser observation instance/reason and control basis reason, operation message and ownership reason. The four guard failures were reproduced on unchanged base `dac7528a12be884542d36355492fafcdffb63a30`. No runtime behavior, schemas or assertions changed; `base-redaction.log`, `session-origin-findings.json`, `proposed-session-origins.patch` and passing architecture proof. |

### Focused verification and reference attribution

| Assigned check | Actual result / retained evidence |
| --- | --- |
| G1 detector/corpus/admission/recovery | Exit 0, 10 files / 194 tests, including the nine assigned selectors and parent admission boundary; `g1-detectors-final.log`. |
| G1 architecture | Exit 0, all five assigned files / 63 tests; `g1-architecture-final.log`. This includes executed corpus closure, runtime dependency/environment coverage, redaction surfaces and parity reference authority. |
| G1 ingress / guard registration | Exit 0, seven selected preflight ingress tests (145 unselected); named guard membership test passes (five unselected); `g1-ingress.log`, `g1-guard-manifest.log`. |
| G2 unit | Exit 0, six files / 20 tests, including four assigned files and parent readiness/setup boundary checks; `g2-ui-unit-final.log`. |
| G2 browser build / references | `npm run web:build`: exit 0. Deliberate owned reference update: 33 pass. Assert run: 33 pass (25 Setup, eight Settings), including body-backed a11y report verification; `web-build.log`, `parity-owned-update-2.log`, `g2-parity-assert.log`. |
| G2 keyboard / real zoom | Chromium 153.0.8010.12, actual `chrome.tabs.setZoom`/`getZoom` through a task-owned extension controlled by `playwright-cli`. At 125%, requested 1280×720 gives 1024×576 CSS pixels; at 200%, requested 1440×900 gives 720×450 CSS pixels. CSS zoom and visual scale both remain 1. Re-check returns HTTP 200, remedy access and Escape focus return pass; the doctor fits and scrolls within the effective viewport. The standing 1024-pixel minimum canvas requires horizontal scrolling at 200%. `zoom125-recapture-proof.log`, `zoom200-recapture-proof.log`, `zoom-fixture-clock.log` and `zoom125-capture.json` / `zoom200-capture.json`. The inspected `zoom125-viewport.png`, `zoom200-viewport.png` and `zoom200-bottom-viewport.png` use an unclipped Chromium capture through `playwright-cli`; these supersede the earlier miscropped zoom screenshots. |
| G3 lint / quick checks | All 29 changed TypeScript paths exactly match the base-relative freeze list; `npx eslint --max-warnings 0` and `npx tsc --noEmit` exit 0. `lint-paths.txt`, `g3-lint.log`, `g3-typecheck.log`. |
| G3 affected generated output | `npm run build:manifest` and `npm run build:manifest:check`: exit 0; no tracked generated diff. `build-manifest-generate.log`, `build-manifest-check.log`. No store catalog or roadmap regeneration is credited. |
| G4 | Roadmap binding: 24 pass, `g4-roadmap-binding.log`. Added links, all existing instruction pairs, complete chains below 32,768 bytes and base-relative diff check pass; `verify-implementation.py`, `implementation-validation.json`, `instruction-chains.json`. |

The 48 new Setup/doctor screenshot, a11y and metadata triplets cover six served states, both themes
and both assigned desktop sizes. Eight existing Settings triplets were deliberately updated only
for the accepted parent descriptor fingerprint and the neutral `Preflight: unavailable` doctor
trigger. These are the existing graphite-warm 1280×720, 1440×900, capabilities, system-hosts and
narrow-1024×768 scenes, plus paper-ink 1280×720, 1440×900 and narrow-1024×768. No other references,
thresholds, membership, assertions, coverage floors or timeouts changed.

### Finalizer intake, limits and cleanup

3.1.11.3 consumes this candidate together with Run/Rerun, reconciles the three approved shared-file
repairs and generated output, runs its assigned combined checks, and owns later accepted integration
and task-worktree cleanup. The operator chooses integration. The dependency symlink remains intact;
owned browser sessions, proof servers and disposable roots are closed/removed as recorded in
`cleanup.json`. The temporary detached baseline worktree was removed both physically and from Git.
No peer worktree was changed or removed by this task.

The paired-recovery test records an inherited storage limitation rather than a successful healthy
repair: the existing restore command returns success, SQL authority becomes healthy and the
interruption marker clears, but the doctor reports `preserved authority directory contains an
unexpected entry` and preflight remains unhealthy. Custody evidence is preserved. No storage policy
or diagnostic bypass is introduced. The finalizer must retain this limitation in its combined
record; comprehensive recovery acceptance and any storage repair remain with 3.1.19.

Proof uses synthetic inputs and private roots with production services/detectors. It establishes no
current HR system, real browser login or provider availability. Full repository coverage/lint/
architecture, broad parity, production, performance, comprehensive recovery and A07 live dry-run
acceptance remain 3.1.19 (using the 3.1.18 harness); none is claimed passed here.

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
