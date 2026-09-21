# Task 3.1.11.2 · Make Run and Rerun enqueue real work
<!-- roadmap: dash-run-modal -->

**Current assignment: 3.1.11.2.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**2026-09-14 Intake allocation:** consume 3.1.9.6's extracted spreadsheet upload component after
3.1.9.8 releases it. The [approved Intake amendment](task-9-establish-independent-dashboard-boundaries.md#intake-child-ownership-amendment--2026-09-14)
permits only that extraction/repair and replacement of its existing Run-modal call site, plus
Intake-specific comparison/confirmation handling. Ordinary Run/Rerun and prior-run values remain
this task's ownership. Do not duplicate or reverse the upload extraction; existing dependency edges
already order this task after the surface-group release.

**2026-09-16 focus allocation:** consume the [approved 3.1.9.8 F3 correction](task-9-8-finalization-dashboard-surfaces.md#approved-execution-brief--2026-09-16)
to shell/dialog focus and the narrow Run-modal hookup. Dismissal returns focus to the launch control;
successful Intake handoff retains takeover focus. Preserve that correction and the extracted uploader.
Ordinary Run/Rerun, warning, prior-value and enqueue semantics remain owned by this task.

- [ ] Make ordinary Run plus D334 Rerun use one modal and one server plan/confirm/enqueue path.
  Use one Rerun action for failed/interrupted and successful sources; do not offer a separate Retry
  action. Failed/interrupted sources default to failed/unfinished steps plus descriptor-required
  completed steps, with a visible explanation for the latter; successful sources default
  to ALL steps, including previously omitted steps. Begin at Steps; defaults never restrict selection.
- [ ] Offer descriptor-allowed completed-step values from 2.6 Task 1-2 as optional prefill. Let the
  operator copy, change or clear values and select or omit any eligible step; submitted modal values
  and omission facts are authoritative, and unselected steps do not replay.
- [ ] D335: proceeding from Steps with a selected previously submitted transaction shows a warning
  with Cancel / Confirm. Cancel returns to Steps; Confirm acknowledges the exact server warning set
  and advances to Values only. With no warning, proceed directly to Values. Neither navigation action
  consumes a plan, mints run/trace ids, creates/publishes a run or submits a transaction. Let the user
  edit Values normally; retain acknowledgment when the warning facts are unchanged, and renew it when
  warned selection/business keys/source/evidence change. Prior completion never disables a step or
  silently reuses its receipt. Consume 1.6.4's backend protocol; this task owns the full interaction.
- [ ] Create a new queued run only on the modal's final submission, show the committed run identity returned by the server,
  keep the source run byte-identical, and never represent an omitted transaction as a new write/proof.
- [ ] Prove ordinary/single/batch/dry-run plus Rerun defaults and full customization across
  stale/deleted/archived sources, malformed/partial prefill, changed item identity, unknown-write
  refusal, conflict, no-worker, delayed-worker, reload and exactly-once paths. Include one Rerun label
  for both outcomes, failed-source remaining versus successful-source all-step defaults, selecting a
  previously completed transaction, warning Cancel and Confirm navigation, zero effects before final
  submission, Values edits with unchanged versus changed warning facts, acknowledgment renewal,
  exact final-submission replay and no unintended second submission. The narrow pre-Confirm trace and
  retired-editor compatibility/reference changes were assigned to 1.6.4; do not restore them here.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref dashboard-surfaces` §D330.5's `create` — the row is
> inserted at `version 1`, state `queued`, and the write-once `run.queued` root is published through the
> shared builder AFTER commit — and §D330.6's first-eligible claim, which is ONE SQLite write
> transaction that proves the worker's runtime generation tuple or refuses `runtime-stale`. The served
> `version` is the one CAS token (§D330.4, the wire's `rowRevision`). A bulk start is D235's N children
> and one vector. No redesign.
>
> 2026-09-05 | D334 operator correction | this task also consumes `ref data-intake-and-edit-data` §6
> and 2.6 Task 1-2. The source supplies prefill/provenance only; Confirm submits new authoritative
> values and creates a new run. The former Context-rail `edit-checkpoint` writer and D314's direct
> Resume/Restart controls do not return. Task 10-4 retains intake only, so the two assignments have
> no shared implementation owner.

The current app still exposes Resume from checkpoints and Restart through generic command dispatch; the source-bound modal remains real implementation work. Preserve accepted backend prior-run read, settings selection and warning/replay protocol. New-run settings and stale-preview cases are part of final-submit proof. Archive reports provide no execution source.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-19

The operator replied **approve** to the proposed six-step assignment and recommendation **1 A**:
failed/interrupted Rerun selects failed/unfinished steps plus completed steps that the descriptor
still requires, explaining the required selection visibly. This is approved planning scope, not
implemented behavior. The [mandatory-step amendment](../../../reference/dashboard-surfaces.md#rerun-required-step-defaults--2026-09-19)
owns that clarification. [A05](task-8-acceptance-matrix.md#a05), [A23](task-8-acceptance-matrix.md#a23),
[A24](task-8-acceptance-matrix.md#a24) and [A25](task-8-acceptance-matrix.md#a25) own acceptance;
the [Phase 3.1 cadence](README.md#execution-cadence--operator-amendment-2026-09-13) owns gates.

### Assignment and checkout binding

| Binding | Approved value |
| --- | --- |
| Supervisor | One operator-opened supervisor, using the operator-selected model and effort. Modal state, immutable source values, transactional preview validation and replay/reload form one consequential coupled assignment. |
| Allocation / review | **Zero implementation workers; zero reviewer assignments.** No independent review under Phase 3.1's exception; no new sibling, coordinator or automatic dispatch. |
| Mode / branch | Dedicated implementation worktree on `codex/3.1.11.2-run-rerun`. |
| Absolute checkout | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-run-rerun` |
| Inspected integration baseline | `c2d44e187a4fe56994a6ca2b1c4d63471bd058f2` on local `master`, including accepted Sessions integration `c90da4ffc45ddfe6486192b8df68816dc6fe34a3` and accepted preflight follow-up `ef050d0a8cb99aa39b54f726b2bdd5269f125dfa`; preserve Date, Intake and current instruction/governance changes. |
| Required implementation base | The integrated approved-plan commit or a verified local `master` descendant containing it and both accepted parent releases. The planner supplies its full SHA in the launch prompt after validation/integration. The two missing launch operations are now explicit R2/R3 child work under the approved ownership amendment below; no unmerged sibling is required. |
| Finalizer / integration | 3.1.11.3 consumes this exact passing candidate and 3.1.11.1's candidate in either order. Its existing proposed binding is `codex/3.1.11.3-operations` at `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-operations`; its operator-opened session rechecks availability and resolves the combined base. Target: local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`. The operator chooses integration; this brief does not authorize a product merge. |
| Completion | This supervisor freezes a committed candidate with focused proof for finalizer intake. Worker roadmap completion follows 3.1.11.3's accepted integration and owned cleanup; downstream release and full Phase 3.1 acceptance remain separate. |
| Evidence | `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.2-run-rerun-2026-09-19/`; retain tested identities, command receipts, screenshots, authority comparisons and cleanup receipts outside disposable worktrees. |

The implementation branch/path remain proposed and must be checked before creation. Documentation
persistence uses `codex/plan-3.1.11.2` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-run-plan`. This planner owns
its authorized local integration and cleanup; removing that incorporated documentation checkout
releases capacity for the implementation checkout. Preserve active Setup/UI checkouts. Recheck the
four-auxiliary-worktree ceiling at launch and before finalizer creation; do not allocate extra capacity
or delete peer resources. The implementation supervisor creates the proposed branch/worktree from
the prompt's verified base; this planning session does not launch it.

### Release check owned by planning

Accepted Sessions integration `c90da4ffc45ddfe6486192b8df68816dc6fe34a3` and its cleanup record
`191ce8b1cb79d0930d89d60cb5501914c3fa4b09` are verified. The later accepted preflight follow-up
`ef050d0a8cb99aa39b54f726b2bdd5269f125dfa`, recorded in `dac7528a12be884542d36355492fafcdffb63a30`,
is also part of the implementation base. Consume its real start-plan prepare/assert admission and
preserve source-bound execution, Settings currentness, Date navigation and Intake/focus behavior.

The actual launch exports exist: `RunLaunchHost`, `useRunLaunch`, `launchWorkflows`, `prefillRerun`,
`createRunLaunchService`, `rerunValues` and `StartPlanRefusalError`. Parent consumer proof covers
valid complete-input planning, acknowledgment and replay. It does not cover a served row opening
the modal or warning navigation with incomplete Values. The historical reconciliation below
records those gaps; the approved ownership amendment makes them bounded child implementation,
not missing start prerequisites. R1 verifies this accepted base and allocation rather than reopening
settled ownership. Other missing or materially changed shared mechanisms still require amendment.

### Approved launch ownership amendment — 2026-09-19

The operator's **“do it”** approved assigning these two launch gaps to 3.1.11.2 and integrating the
validated planning documents locally. The six outcomes, mandatory-step defaults, source/write
safety, focused cadence and finalizer remain unchanged. This is planning authorization only.

- **Row Rerun entry, R2:** own the narrow action-schema and app-dispatch registration that opens
  the existing modal with the served source identity/revision. Remove direct dashboard Retry/Restart,
  including stale single/bulk dispatch routes. Keep non-dashboard kernel command semantics and
  unrelated actions unchanged. Use a typed served Rerun action; do not infer it from display text.
- **Warning before Values, R3:** own a read-only source-bound warning-preview operation and its
  client/BFF registration. It admits source identity/revision, descriptor and selected steps, reads
  retained source canonical input and the relevant source completion/write evidence on the server,
  and returns only redacted warning facts plus their binding. It must not require new Values or
  omission facts, fabricate missing values, allocate run/trace IDs, consume a start plan, enqueue
  work or invoke an external transaction. Reuse the authoritative source/selection/warning validation in
  `services/start/rerun.ts`; do not build an independent consent authority. Missing evidence or an
  invalid source is explicit. Final planning still validates all edited input/omission facts and
  recomputes the warning binding; changed facts require renewal, and execution retains its existing
  fresh-key/UNKNOWN fences. Any new browser POST receives the existing ingress guard and guard proof.
- **Boundaries:** own only the exact registration portions listed below. Setup keeps its accepted
  preflight contracts, detectors, query/state/presentation and routes. Preserve the parent's current
  start-plan preflight hook when extending launch services. Neither child depends on the other's
  unmerged changes; either candidate can be integrated first. Shared fixture builders and combined
  generated output remain finalizer-owned. Use private launch fixtures and existing composition
  ports; mechanical launch-contract test doubles may change only where required by this API.

The [parent release](task-11-finish-sessions-worker-pools-and-browser-lifecycle.md#runrerun-child-ownership-release--2026-09-19)
and [finalizer allocation](task-11-3-finalization-run-operations.md#runrerun-ownership-amendment--2026-09-19)
point here. These two exceptions supersede earlier blanket parent ownership of shared launch
registration. No broader ownership transfer or new product requirement is approved.

### Feasibility and change ownership

These are inspected mechanisms, not test results from this planning session. Recheck changed inputs
after the parent's accepted release, rather than treating its promised interfaces as built.

| Question / current evidence | Necessary change and permitted owner | Required proof / limit |
| --- | --- | --- |
| `run-start.tsx` opens at Input, uses ordinary submissions, and has no source-bound Rerun interaction. `readRerunValues` already validates source/version/descriptor and reports completion plus declared value coordinates. | R2 owns the modal, released launch leaves and prior-value transport. Consume the read service; never infer mappings or fetch another attempt as fallback. | P1 tests failed/interrupted/successful defaults, mandatory completed steps, editable copies and named invalid/unavailable cases. |
| `applyStartStepSelection` rejects omitted required steps; the earlier failed-source wording selected only unfinished steps. | The approved 1 A amendment selects descriptor-required steps too and visibly explains completed mandatory selections. R2 consumes the existing requirement/cascade projection unchanged. | Required steps remain selected; eligible optional steps remain customizable. No implicit omission capability, automatic checkpoint replay or completion-based disable. |
| `buildRerunPlan` binds source/version, selection, business keys and completion evidence; final `executeStartRun` revalidates consent. The prior-value query grants no consent. | R3 owns warning preview and the complete interaction under the approved launch ownership amendment. Preserve server authority and optional `copiedFrom` attribution; clear attribution when a copied field is edited or cleared. | P2 separates warning navigation from final consumption and distinguishes edits that preserve warning facts from changes requiring renewed consent. |
| `services/start/plan.ts` checks `reject-active`; `run-fan-out.ts` implements `supersede-active` against the then-current active set. The preview contains no affected-generation basis. | R4 owns a strict start-specific persisted/wire preview basis and its fingerprint, plus the narrow start-command check inside the existing authority transaction. Keep Intake's separate fan-out contract unchanged. | P3 binds exact affected run identities/generations and revisions, including an empty set, and rejects added/removed/changed active targets before any replacement or creation. |
| Plans are strict JSON in `workflow_run_requests`; `startPlans.consume` binds immutable fingerprints and the original confirmation revision. Kernel replay revalidates the consumed plan and returns the stored result. | R4 may extend launch-specific JSON and hashing without SQL DDL. Historical unconsumed supersede plans lacking the new review basis require replanning; already consumed historical commands retain exact replay. | P3/P4 exercise historical readable plans, restart, divergent reuse and successful replay after later settings/source changes. No released migration or write-safety occurrence changes. |
| `confirmStart` currently creates a new UUID and timestamp on each click. In-flight result checks cover form changes but do not provide reload-safe exact submission identity. | R5 retains one exact final envelope before dispatch through the released launch/replay boundary and restores it across reload. Retain only the identity/binding needed for replay, not raw input, private values or source outputs. | P4 covers rapid duplicate clicks, response loss, remount/reload, delayed replies after close/edit/reopen, and exact result identity. Unknown transport is not a rejected enqueue. |
| Settings selection/currentness and source-bound fresh execution are already implemented. Existing `source-bound-repeat.test.ts` covers occurrence-specific fresh execution and immutable source proof. | R5/P5 consume those mechanisms and prove browser-to-authority crossover; preserve the shared result fold and source-bound execution/recovery fences. | Current settings for new work; stale unconsumed preview refuses; successful replay remains the same identity after save. New source-bound work never replays another run's checkpoint or old receipt as fresh proof. |

### Ordered implementation

1. **R1 — Verify the released base.** Use the concrete planner-verified parent release and plan
   commit. Verify branch/path/base ancestry, released leaf ownership, existing start/prefill/replay
   consumer proof and the approved R2/R3 registration/warning work before edits. Preserve accepted Date navigation,
   Intake upload and dialog focus. If the recorded release is absent or changed materially, stop
   dependent work and report the exact changed prerequisite; the two approved launch gaps are owned work.
2. **R2 — One source-bound Run/Rerun modal.** Ordinary Run and eligible Rerun share the existing
   plan/confirm/enqueue path. Rerun begins at Steps. Failed/interrupted defaults select failed and
   unfinished steps plus descriptor-required completed steps with a visible reason; successful
   defaults select all eligible steps, including formerly omitted steps. Descriptor requirements
   and omission cascades remain authoritative. Offer only declared available completed-value
   mappings as optional copy actions; each copied value can be edited or cleared independently.
   Missing/protected/invalid values remain explicit, and provenance never becomes replay authority.
   Changing an identity-bearing value uses ordinary schema admission and new item derivation.
   Keep one Rerun label for both outcomes and remove direct retry/restart entry paths through the
   amended launch allocation, including stale bulk-command paths; do not introduce batch source
   merging or rewrite unrelated Queue/Detail behavior.
3. **R3 — Warning, Values and final review.** Implement the source-bound warning preview above,
   with production client/BFF wiring and incomplete-Values/omission proof. Proceed from Steps through a server-authored
   Cancel/Confirm warning when selected transactions have prior submission evidence. Cancel
   returns to Steps; Confirm acknowledges the exact set and advances only to Values. Without a
   warning, advance directly. Neither action consumes the plan, mints run/trace identities,
   publishes queued work or invokes a transaction. Values remain editable. Keep acknowledgment
   only while source/version, warned selection, business keys and relevant evidence still match.
   Renew changed consent and discard deselected repeat authority. Final review binds the actual
   raw input, canonical values and omission facts. Expired/stale/confirmation-required results
   give a usable review path without silently substituting a new source or submitting again.
4. **R4 — Exact supersede preview.** Preview and retain the exact active generations affected by
   each accepted logical item, expose that set in final review and bind it to the final plan.
   Compare it with current authority inside the same transaction that consumes the plan and
   enqueues the batch. Any changed membership or reviewed revision requires a fresh review;
   a later-item conflict rolls back the entire batch, including earlier supersedes, plan
   consumption and queued publication. Preserve `reject-active`, duplicate-item refusal and
   `allow-parallel` policy. Plans written before this basis existed remain readable; unsafe
   unconsumed supersede plans require replanning, while accepted historical replay stays stable.
5. **R5 — Singular final submission and truthful readback.** Mint/retain one final command
   envelope per intentional submission and use that same envelope for transport retries and
   reload recovery. Bind asynchronous replies to both the launch instance and reviewed request.
   Show committed run identities and the server's batch/result vector through the shared result
   vocabulary; queue state comes from served authority. An ambiguous send offers exact replay or
   reconciliation, never a fresh-ID automatic resubmission. A new deliberate modal completion is
   distinct from replay. No-worker/delayed-worker states remain queued facts. Prove new runs select
   current committed settings, existing runs keep snapshots and accepted replay survives a save.
6. **R6 — Prove and freeze the child candidate.** Complete P1–P5, the focused gates and UI proof,
   repair owned failures, then commit logical categories using exact paths. Record tested source,
   candidate SHA, commands, results and deferred broad proof for 3.1.11.3. No independent review,
   push, sibling dispatch or product merge is authorized. Finalizer intake does not itself mark
   worker/group completion; accepted integration and owned cleanup remain visible obligations.

### File, interface and resource allocation

All paths below are repository-relative and were resolved against the accepted parent. The approved
amendment grants only the named launch portions. New adjacent leaves serve only these outcomes.

| Owner | Permitted scope |
| --- | --- |
| R2/R3/R5 modal and launch | `src/dashboard/surfaces/run-start*.ts*`; parent's extracted `src/dashboard/app/run-launch.tsx`, `run-launch-model.ts`; `src/dashboard/client/start-commands.ts`, `rerun-queries.ts`, and adjacent launch-only recovery/value helpers. Use `/ui`, Components lead, local implementation; use existing primitives/tokens and the prescribed playwright-cli route. |
| R3/R4 launch authority | `src/services/start/plan.ts`, `rerun.ts`, `step-selection.ts` only for launch admission/projection; `src/domain/run/start-plan.ts`, `src/domain/run/rerun.ts`, `src/domain/dashboard/start-plan.ts` and browser-safe launch-only warning contracts; `src/server/dashboard/commands/start-plan-service.ts`; the `executeStartRun`/start replay arm of `src/core/command-kernel.ts` and a start-specific helper in `run-fan-out.ts` if necessary. No worker-control or other command-family redesign. |
| R2 launcher eligibility | `src/server/dashboard/projectors/queue-row-actions.ts` and a released launch-specific eligibility leaf, only the Rerun action/eligibility portion and matching tests. Own the Rerun action-schema portion of `src/domain/dashboard/actions.ts`, the Run/Rerun registration portion of `src/dashboard/app/dashboard-app.tsx`, and the direct Retry/Restart retirement portions of `command-dispatch.ts` and `bulk-dispatch.ts`. Read-only source projection remains the accepted input; a defect needing broader changes requires an ownership amendment. |
| R3 warning transport | `src/dashboard/client/start-commands.ts` (inherited through the existing client composition), `src/server/dashboard/routes/queue.ts` and its start-plan service port, plus only the new warning endpoint ingress-guard registration in `routes/api.ts`. A launch-only schema/helper may be added beside the existing owners; no general BFF/client composition redesign. |
| R6 tests/references/docs | Existing focused tests below; new launch-only unit/server/browser tests and private fixtures. Own `tests/parity/helpers/fixture-start.ts`, `fixture-start-routes.ts`, `reference-start-scenes.ts`, `tests/parity/reference-start.spec.ts`, and Run/Rerun reference names. Preserve unrelated reference identities. Update this task's evidence record and the approved normative amendment only as required by verified facts. |
| Parent / peer / finalizer exclusions | 3.1.11 supplies accepted session/preflight/launch foundations; 3.1.11.1 owns Setup/preflight leaves. Other shared schema/root composition, common fixture builders and combined generated outputs remain parent/finalizer-owned; only the R2/R3 portions above transfer. Settings, Storage and Intake are accepted APIs. 3.1.11.3 reconciles exact candidates and combined output. |

Either child can pass against the common accepted parent and integrate first. This child does not
depend on Setup's new fault-corpus behavior. Test reads of accepted Setup/Settings APIs do not grant
write ownership. Local generation needed to validate changed inputs is serialized in this checkout;
the finalizer owns reconciliation of shared generated output. No speculative global gate queue or
peer check-in round is required; follow the
[parallel coordination rules](/Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md#parallel-coordination).

### Proof matrix

| ID | Positive control and required result | Negative/interleaving proof and forbidden effect |
| --- | --- | --- |
| P1 — source/defaults/values | Real mounted launchers open the same modal at Steps for failed, interrupted and successful sources; 1 A explains mandatory completed selections. Copy/edit/clear and eligible omission produce exactly the submitted input/facts and correct same-item versus changed-item lineage. | Stale/deleted/archived/ineligible/unknown-write sources refuse; malformed/cross-attempt evidence never falls back. Partial/protected/unavailable candidates are explicit. Defaults do not restrict eligible choices; source run/checkpoint/intent bytes remain unchanged. No direct retry/restart escape or unselected-step replay. |
| P2 — navigation/consent | Selected completed transactions show the exact server warning; Cancel returns to Steps, Confirm to Values, no-warning goes directly to Values. Final plan uses edited values, with unchanged consent retained only for unchanged warning facts. | Snapshot run/trace ID allocations, plan consumption, run/session rows, queued roots and operation/attempt/outbox effects before and after each navigation action. Changed selection/key/source/evidence requires renewed consent. Incomplete Values do not prevent reaching Values. An old receipt is never new proof; omitted transactions create no new transaction work/proof. |
| P3 — preview/atomicity | Single and batch supersede previews name and bind the exact affected generations; the final commit supersedes that set and returns new queued identities atomically. Ordinary reject-active/allow-parallel behavior remains correct. | Empty-to-active, added/removed/revised generation, concurrent start, and a conflict late in a batch refuse with zero partial supersedes/enqueues/publication/consumption. Invalid entries remain explicit. Historical unconsumed missing-basis plans replan; consumed historical replay remains exact after reopen. |
| P4 — final replay/reload | Exactly one final envelope survives double-click, lost response and reload; replay returns the same committed identity/vector. Separately completed intentional Rerun is a new submission. | Same-ID divergent input refuses. Changed form or closed/reopened launch ignores stale responses without losing durable acceptance. Settings/source changes after an accepted command do not turn its replay into a new run. Corrupt/missing recovery metadata is explicit, never fabricated success or fresh automatic send. |
| P5 — settings/workers/browser | Isolated real BFF/SQLite and a controlled worker prove ordinary single/batch/dry-run, new settings selection, no-worker then delayed claim, result/queue/reload convergence. Real Chromium proves warning/Values/final review, both themes, keyboard/focus and resize. | Save between preview and submit requires review with zero premature creation; existing queued/running runs retain snapshots. Transaction-bearing proof is dryRun=true with zero external writes. Preserve Intake takeover/dismissal focus. Actual 125%/200% browser zoom keeps all decisions reachable; no CSS zoom/device-scale substitution. |

Use deterministic fixtures for adversarial ordering and the existing source-bound interpreter/
sequencer regressions for occurrence-specific execution, fresh evidence and unknown recovery.
The integrated browser proof must call production services and compare direct isolated authority;
a mocked response alone cannot prove enqueue or replay. Register and await all owned processes and
disposable writers, including failure cleanup, applying 3.1.9.8's delivery assessment. No standing
operator database, protected configuration or legacy state is used. This is not a deployment or
data conversion, so unrelated production-target inspection is not a planning prerequisite.

Current production/live HR correlation remains the 3.1.18 harness and 3.1.19 acceptance lane.
Retain this task's fixtures/commands for that lane; do not label synthetic proof live acceptance.
Any later live dry-run attempt must recheck supported subject/configuration/resource admission and
record what executes versus replays after a failure. Never retry UNKNOWN submit or change a subject,
checkpoint, expectation or identity merely to obtain passing evidence.

### Gate and resource schedule

Run commands from the absolute implementation checkout. Existing selectors were located during
planning; the five explicitly new files below are assigned proof outputs, not pre-existing tests.
The accepted parent launch/preflight and ingress-guard regressions below also protect the amended registration.

**G1 — focused logic, authority and mounted interaction.** Run affected groups while implementing;
before candidate freeze all rows below must pass on the final relevant inputs. Do not repeat
unchanged groups for documentation-only recording.

```sh
npm run test -- tests/unit/dashboard/run-start-model.test.ts tests/unit/dashboard/run-start-dialog.test.ts tests/unit/dashboard/run-start-focus.test.ts tests/unit/dashboard/run-start-timeline.test.ts tests/unit/dashboard/run-start-kit-render.test.ts tests/unit/dashboard/start-plan-contract.test.ts tests/unit/dashboard/run-rerun.test.ts tests/unit/dashboard/run-launch-recovery.test.ts tests/unit/dashboard/launch-boundary.test.ts
npm run test -- tests/unit/start-plan.test.ts tests/unit/server/start-plan-omissions.test.ts tests/unit/server/start-plan-supersede.test.ts tests/unit/server/queue-row-actions.test.ts tests/unit/dashboard/bulk-dispatch.test.ts tests/unit/command-kernel.test.ts tests/unit/command-kernel-step-omission-carry.test.ts
npm run test -- tests/unit/rerun-values.test.ts tests/unit/server/rerun-values.test.ts tests/unit/rerun-source-eligibility.test.ts tests/unit/rerun-protected-identity.test.ts tests/unit/source-bound-repeat.test.ts tests/unit/architecture/rerun-prefill-boundary.test.ts
npm run test -- tests/unit/settings-activation/save-create.test.ts tests/unit/settings-activation/stale-plan.test.ts tests/unit/settings-activation/mixed-execution.test.ts tests/unit/settings-activation/retry-child.test.ts
npm run test -- tests/unit/architecture/operator-mutation-admission.test.ts tests/unit/server/preflight-admission-boundary.test.ts tests/unit/dashboard/preflight-readiness-boundary.test.ts
```

The new unit files are `tests/unit/dashboard/run-rerun.test.ts`,
`tests/unit/dashboard/run-launch-recovery.test.ts` and
`tests/unit/server/start-plan-supersede.test.ts`. They implement P1–P4, with production-service
positive controls; existing tests remain intact and are extended where they own the behavior.

**G2 — built browser and affected references.** After interaction/authority work and after any
invalidating repair:

```sh
npm run web:build
npm run test:parity -- tests/parity/reference-start.spec.ts tests/parity/run-rerun.spec.ts tests/parity/run-rerun-authority.spec.ts --workers=4
```

The two new specs supply P5 and the affected warning/Values/review scenes. Preserve the existing
pixel/a11y/provenance pairing, desktop minimum canvas, 1280×720 and 1440×900 views and both themes.
Use playwright-cli to inspect the specimen before primitive choices and capture actual browser
zoom at 125% for 1280×720 and 200% for 1440×900, recording browser version, zoom mechanism and
effective CSS viewport. Tab/scroll must reach warning choices, editable Values, final submit and
dismissal, with focus returned to the correct launcher. A deliberate reference change is limited
to affected Run/Rerun scenes, attributed, then followed by the same assertion gate; never blanket
refreeze or weaken a tolerance. Browser MCP substitution requires the repository's permission rule.

**G3 — scoped lint and affected generated checks.** After each affected test group and before
candidate freeze, freeze the changed TypeScript/TSX path list from
`git diff --name-only --diff-filter=ACMR <verified-base> -- '*.ts' '*.tsx'` in the evidence receipt.
Invoke `npx eslint` with that exact argument array and `--max-warnings 0`, including new fixtures
and tests. Resolve the actual base before running; avoid shell word splitting. New guards or
retirements require deciding proof plus `docs/rebuild/guard-inventory.json` metadata validation.
Run `npm run build:manifest` then `npm run build:manifest:check` only if descriptor import-closure
inputs changed; store-catalog generation/check only if its inputs changed. Record shared generated
changes for finalizer reconciliation. Task/contract/roadmap recording runs `npm run roadmap`,
`npm run roadmap:check`, applicable link/instruction checks and `git diff --check`.

**G4 — freeze, finalizer and recording.** Record actual commands/exits and tested tree or commit,
plus the final candidate and unchanged-input comparison for reused proof. Relevant source/test/
config/dependency/reference change, failure or uncertain exit invalidates the affected result.
3.1.11.3 combines exact child commits in either order, fixes shared-interface defects, runs its
combined `npm run typecheck`, focused integration/regression tests, scoped lint and affected
build/generated checks, then seeks operator-directed integration. It owns accepted cleanup and
closing integrated worker records. This child supplies the complete passing proof and unresolved
broad obligations, not a false claim that finalizer checks already passed.

Vitest already caps file workers at four; parity explicitly uses four. Every browser/process proof
owns fresh state/artifact/auth/lock roots, tracked handles and ephemeral ports, never shared
3938/5174 or another task's runtime. Worktree-local build/reference/report writers are serialized;
isolated peer work may continue. Release owned resources after the check, including failed checks,
and prove shutdown without a global close-all. No root test-config, membership, assertion, floor
or timeout change is authorized to obtain PASS.

Full repository typecheck/coverage/lint/architecture, broad desktop parity, production smoke,
performance, recovery and complete A01–A42/D01–D05/live acceptance remain **3.1.19**. The finalizer's
combined typecheck and this task's focused authority/browser proof are not deferred. No independent
review is required at either boundary.

### Exclusions, stops and current state

No SQL DDL or released migration edits, workflow admission/rewrites, new omission capability,
write-sequencer/occurrence/recovery redesign, mutable source editor, archived relaunch, generic
Retry/Restart UI, raw-value browser persistence, Setup fault-corpus work, unrelated Queue/Detail
changes, session-control redesign, mobile variants, production cutover or external HR writes.
Preserve accepted protected-value handling and repeat fences. Tactical owned fixes are local to
the supervisor. Stop dependent work for a missing parent release/shared API, required excluded
owner change, new contract choice, unprovable acceptance or uncertain effect; surface exact evidence.

| State | Record |
| --- | --- |
| Approval | Six-step scope and recommended 1 A approved on 2026-09-19; subsequent “do it” approved the two bounded launch ownership transfers and local planning-document integration. |
| Implementation | R1–R6 and P1–P5 implemented and focused proof passed; candidate frozen for 3.1.11.3 intake. Product integration, combined gates and worktree cleanup remain with the finalizer under operator direction. |
| Parent prerequisite | Accepted Sessions integration/cleanup and later preflight release `ef050d0a8cb99aa39b54f726b2bdd5269f125dfa` verified. The two discovered launch gaps are approved R2/R3 work, with no dependency on Setup’s unmerged candidate. |
| Planning persistence | This planner is authorized to validate/commit the full amended documentation, integrate it locally, verify the committed plan and remove only its incorporated planning branch/worktree. Product implementation/integration and task dispatch are not authorized here. |
| Child/group release | Issue the READY prompt only after this amended plan passes documentation checks, is integrated and its planning checkout is cleaned up. Implementation then starts in an operator-opened session; later finalizer intake, product integration and cleanup remain distinct. |

Maintain this compact record in place during execution, with linked dated evidence. Send Done /
Now / Remaining once at supervisor start or genuine resume; later updates report only newly
verified completions and material blockers. Routine transfer uses this owner. Use `/handoff` only
for interrupted unique execution state; no sibling launch or push is implied.

### Historical initial planning validation — 2026-09-19

The approved scope, recommendation 1 A, ownership, R1–R6 sequence, P1–P5 proof and G1–G4 schedule
are persisted here. Normative default-selection wording and the decision pointer are updated in
the same documentation candidate; the task remains planned. No implementation or runtime gate
result is reused to claim acceptance of this changed default.

| Check | Verified result |
| --- | --- |
| Roadmap binding | `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts`: exit 0, 1 file / 24 tests passed. |
| Scoped lint | `npx eslint scripts/generate-roadmap.ts tests/unit/architecture/roadmap-doc-binding.test.ts --max-warnings 0`: exit 0. |
| Generated roadmap | `npm run roadmap` and `npm run roadmap:check`: exit 0; generated output only. |
| Documentation checks | Eight approved documentation/generated paths; complete brief and changed links resolve; 9 existing instruction pairs match; 18 project chains remain below 32,768 bytes (maximum 19,308); `git diff --check` passes. |
| Gate selector preflight | 28 selectors resolve to 23 existing tests/specs plus 5 explicitly assigned future proof files. No product, test, dependency or configuration input changes in this planning candidate. |
| Readiness | Initial persistence waited for accepted 3.1.11. The subsequent release reconciliation below verifies integration and cleanup but identifies an ownership decision still required before launch; planning-document integration also remains unassigned. No READY supervisor prompt issued. |

Logs, exits, changed-file hashes, the reproducible documentation checker and commit verification
are retained in the [planning evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.2-plan-2026-09-19/).
The documentation-only recording change reruns generation/freshness and document-binding checks;
unchanged code/test/configuration/dependency inputs preserve the scoped lint result.

### Historical accepted-parent release reconciliation — 2026-09-19

The operator reported 3.1.11 complete. Read-only verification confirms accepted merge
`c90da4ffc45ddfe6486192b8df68816dc6fe34a3` and its completion/cleanup record at
`191ce8b1cb79d0930d89d60cb5501914c3fa4b09` on clean local `master`. The Sessions
implementation branch, worktree registration and physical task folder were removed. This records
the accepted parent; it does not reopen its completed status or claim the child is ready.

The released `RunLaunchHost`, `useRunLaunch`, `launchWorkflows`, `prefillRerun`,
`createRunLaunchService`, `rerunValues` and `StartPlanRefusalError` exist at the allocated paths.
The parent's independent Setup and Run/Rerun consumer proof is recorded in its release. Reading
the actual consumer and production paths establishes two narrower gaps that those tests do not
cover:

| Required child behavior | Verified released behavior | Ownership consequence |
| --- | --- | --- |
| A served row action opens the source-bound Rerun modal without sending Retry/Restart. | `domain/dashboard/actions.ts` permits command actions and navigation to self/panel/drill. `dashboard-app.tsx` handles navigation by selecting a run; `queue-row-actions.ts` still serves Retry/Restart and the command dispatcher sends them directly. `useRunLaunch` holds ordinary open/focus state, with no source-action dispatch hook. | The approved child excludes shared action-union/root-dispatch registration. A narrow ownership amendment or prerequisite correction is required. |
| Steps obtains server-authored warnings before the operator completes Values or omission facts. | `createRunLaunchService.preview` and `acknowledge` call full `submitStartPlan`. `start-plan-service.ts` resolves required omission facts before planning; `buildRerunPlan` requires exactly one accepted submission. The parent's warning consumer test supplies valid complete inputs, so it does not prove incomplete-Values navigation. | A source-bound warning-preview operation needs a feasible service/transport owner. The current plan assigns that shared operation to the parent and cannot silently move it to the child. |

The released `prefillRerun` also currently writes every selected value to ordinary submission
fields even when its coordinate names `targetStepKey`. Correct omission-fact routing remains
within this child's already approved launch-leaf ownership and P1 proof; it requires no scope
decision. Protected values, unavailable evidence, exact source revisions and final warning renewal
remain governed by the linked contracts.

At this reconciliation, no ownership transfer, product implementation, integration or supervisor
launch has occurred. The original six-step approval and mandatory-step default decision remain
valid. The operator has been asked whether to assign the two bounded launch gaps to this child
and authorize local planning-document integration, or retain the existing prerequisite ownership.
That historical pending choice is now resolved by the approved launch ownership amendment above.

This reconciliation passed the roadmap binding suite (1 file / 24 tests), scoped generator/binding
lint, roadmap freshness and the documentation checker (23 links; 9 identical instruction pairs;
18 instruction chains, maximum 19,308 bytes; 28 gate selectors). No runtime gates were rerun or
claimed. Receipts remain in the linked planning evidence directory.

### Amended planning validation and integration — 2026-09-19

The operator approved the narrow ownership transfer and local documentation integration. This
candidate contains the complete six-step plan, mandatory-step contract clarification, corrected
parent/finalizer ownership pointers and launch-specific regression additions. It incorporates
`c2d44e187a4fe56994a6ca2b1c4d63471bd058f2`; changes relative to that accepted base are documentation
and generated roadmap only. The roadmap continues to mark product implementation planned.

The only merge conflict was `docs/roadmap/index.html`: both sides had generated output from
independent accepted source updates. Regeneration from the combined Markdown preserves the
Sessions/preflight releases, current governance, Setup plan and this Run/Rerun plan. No authored
source intent was dropped. The operator chooses the supervisor model and effort; the earlier
model prescription is removed under current instructions.

After documentation checks pass, this planner integrates the exact candidate locally and verifies
ancestry/content, then removes only the incorporated planning worktree/ref. The final evidence
receipt records the actual candidate/integration SHAs, checks and cleanup. The prompt uses that
verified integrated base and the committed full-plan SHA. Product implementation, group acceptance,
full 3.1.19 gates, product integration and push remain outside this completed planning stage.

| Documentation check | Result on the amended candidate |
| --- | --- |
| Roadmap binding | 1 file / 24 tests passed; final command output retained in the amendment evidence. |
| Scoped lint | Generator and binding-test ESLint passed with zero warnings; runtime/test/config/dependency inputs are unchanged relative to the accepted base. |
| Generation / integrity | Combined roadmap generated and freshness passed; ten documentation/generated paths, 29 links, 9 identical instruction pairs, 18 chains (maximum 14,346 bytes), clean whitespace. |
| Implementation selectors | 32 selectors: 27 existing checks and 5 explicitly assigned new proof files. Runtime gates are assigned, not claimed as passed. |

Detailed amendment receipts are in
[the amendment evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.2-plan-2026-09-19/amendment/).

### Frozen child candidate — 2026-09-21

The prior task created the assigned branch/worktree, installed dependencies, and stopped at a usage limit before product edits. This supervisor verified its failed status, clean checkout, exact base and committed plan, accepted Sessions/preflight ancestors, ownership, and three occupied auxiliary worktrees before continuing. No workers or independent reviewer were used.

| Candidate coordinate | Record |
| --- | --- |
| Branch / retained checkout | `codex/3.1.11.2-run-rerun` at `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-run-rerun` |
| Approved base / plan | `94766a1cc54227969462e9ce3b108144c7277723` |
| Implementation and focused tests | `44f842a555e795e72e99fcb605cbda254634084c` |
| Affected visual/a11y references | `51d09f89c278e194eb687ed17a23900f106fac28` |
| Final candidate | The documentation commit containing this record is the candidate tip. Its exact SHA/tree, commit order, clean status and unchanged-input comparison are recorded in the final evidence receipt after commit. Consume the full base-to-tip range, not just the reference commit. |
| Evidence | [Execution evidence and final receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.2-run-rerun-2026-09-19/) |

R1–R6 implement the approved allocation. Served, revision-bound Rerun navigation opens the shared modal at Steps; dashboard single/bulk Retry/Restart escape paths refuse. Failed/interrupted defaults include required completed work and the completed prerequisites necessary to retain selected unfinished work under the existing omission cascade. Those selections explain their reason; optional choices remain editable. Successful defaults include every eligible step. Declared prior values can be copied, edited and cleared; omission coordinates populate omission facts, and edits remove copy attribution.

The guarded `POST /api/v1/rerun-warnings` reuses the authoritative source/warning validation and reads retained canonical input, source-owned checkpoints, gate results and write evidence before new Values are complete. It allocates no run/trace identity and performs no durable mutation. Warning Cancel returns to Steps; Confirm advances to Values. Final planning recomputes the binding, renews changed consent and retains fresh-execution/UNKNOWN fences. Source records, checkpoints and intents remain immutable.

Supersede review persists the exact active run/trace, revision, attempt and claim-generation set, including an empty set. The start command compares every item before consuming the plan or mutating authority; late batch drift has no partial effect. Historical unconsumed plans without the basis replan; consumed historical commands replay after database reopen. Intake fan-out semantics and SQL schemas are unchanged.

One minimal final command envelope is retained in actor-scoped session storage before dispatch, with no raw input or prior values. Duplicate clicks, lost responses and reload use the same command; stale replies cannot overwrite a later launch. Settings currentness, accepted preflight, Date state, Intake handoff/focus, server result vectors and queue authority remain in their accepted owners.

| Gate / proof | Actual result on frozen relevant inputs |
| --- | --- |
| G1 group 1: mounted launch, model, timeline, focus, recovery and contracts | Exit 0; 9 files / 104 tests. `g1-final-group1.log`. |
| G1 group 2: planning, supersede, row/bulk actions and command atomicity | Exit 0; 7 files / 147 tests. `g1-final-group2.log`. |
| G1 group 3: retained values, source eligibility/protection and fresh source-bound execution | Exit 0; 6 files / 69 tests. `g1-final-group3.log`. |
| G1 group 4: settings activation/currentness and preserved snapshots | Exit 0; 4 files / 13 tests. `g1-final-group4.log`. |
| G1 group 5: mutation ingress and accepted preflight admission/readiness | Exit 0; 3 files / 17 tests. `g1-final-group5.log`. |
| G2 built application | `npm run web:build`: exit 0. `g2-final-build.log`. |
| G2 affected browser assertion | The exact three-spec command above, four workers: exit 0, 25 cases. `iteration-4-parity.log`. |
| P5 real authority crossover | The private launch fixture uses the real Hono launch routes, SQLite, planner, command kernel, queue projection and controlled executor. Browser proof covers lost response/reload, exact committed identities, ordinary batch dry-run, current settings, stale review refusal, queued-without-worker and later execution/readback. Synthetic transaction seeding and all fresh transaction-bearing execution stay inside isolated test authority; no external HR write or live acceptance claim. |
| G2 native browser zoom | playwright-cli with an owned persistent Chromium profile, Chrome 153.0.0.0. Browser Settings → Appearance → Page zoom selected 125% and 200%; no CSS zoom or device-scale substitution. 1280×720 at 125% yields 1024×576 CSS pixels; 1440×900 at 200% yields 720×450. Tab/scroll reaches warning Cancel/Confirm, editable Values, final dry-run submit and Close; Escape restores the Rerun launcher. Final captures: `zoom125-{warning,values,review}.png` and `zoom200-{warning,values,review}-scroll0.png`; keyboard/viewport receipts accompany them. |
| G3 exact scoped lint | Exit 0, zero warnings; the exact 36 changed TS/TSX paths versus the approved base are in `g3-final-lint-paths.json`. No file-membership, assertion, floor, timeout or root configuration weakening. |
| Supplemental affected types | `tsc --noEmit -p /tmp/hr-run-rerun-types.json`: exit 0, changed-file import closure only. A copy of the configuration is retained as `scoped-typecheck-config.json`; this is not the finalizer's full typecheck. |
| G3 generated inputs | No descriptor import-closure or task-store catalog input changed. `npm run build:manifest:check`: exit 0; no manifest/store output regeneration required. No architecture guard was added or retired; the existing ingress guard gains the warning route. |
| G3 documentation | Roadmap generation/freshness, document binding, links, instruction twins/chains and whitespace checked in the final recording receipt. Roadmap task completion remains pending finalizer integration. |
| G4 unchanged-input reuse | `tested-inputs.json` hashes all 148 changed implementation/test/reference files. The final receipt compares those hashes with committed candidate bytes; documentation-only recording does not invalidate the passing runtime gates. |

The 12 new warning/Values/review reference scenes retain PNG/a11y/provenance triples for both themes at both required desktop sizes. Thirty-eight existing affected Run scenes required stale descriptor-attribution refresh: only their a11y header and metadata hash changed; their pixels and accessibility bodies remain byte-identical to the approved base. `reference-attribution.json` records every path and hash transition. No unrelated reference or tolerance changed.

Earlier failures remain in the evidence directory and are not accepted proof. Repairs included session-storage isolation between mounted tests, asynchronous source/reply ordering, canonical copied-input versus omission-fact routing, strict source/evidence checks, and private real-authority fixture composition. The existing settings scheduler test also failed on the clean base: it now waits one event-loop turn before inspecting the asynchronously populated pending timer; assertions and timeouts remain unchanged. Its final four-file settings group passed. During zoom proof, an accidental nine-digit keyboard edit correctly refused and was corrected; no resulting run was created. Initial captures after horizontally scrolling the minimum desktop canvas had a Chromium screenshot offset; final captures use the canvas's left edge, with native zoom and visible-control bounds independently recorded.

Owned playwright-cli sessions `hrauto-run-rerun` and `hrauto-run-rerun-zoom`, the specimen Vite process (port 54098), and the isolated proof BFF (port 55315) were closed. The receipt verifies those owned handles/listeners are gone; peer sessions and checkouts remain untouched. The branch and worktree intentionally remain for finalizer intake.

3.1.11.3 owns exact-candidate combination in either child order, shared-interface repairs, combined full `npm run typecheck`, focused integration tests/lint/generated checks, operator-directed local integration and accepted cleanup. This child has no unresolved implementation blocker. Full repository gates and broad/live acceptance remain with 3.1.19. No product merge, push, sibling dispatch or worktree cleanup occurred; candidate freeze does not mark the integrated group complete.
