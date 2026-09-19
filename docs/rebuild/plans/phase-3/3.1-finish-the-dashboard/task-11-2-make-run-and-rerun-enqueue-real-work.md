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
| Supervisor | One operator-opened **GPT-6 Astra / medium** supervisor. Modal state, immutable source values, transactional preview validation and replay/reload form one consequential coupled assignment. |
| Allocation / review | **Zero implementation workers; zero reviewer assignments.** No independent review under Phase 3.1's exception; no new sibling, coordinator or automatic dispatch. |
| Mode / branch | Dedicated implementation worktree on `codex/3.1.11.2-run-rerun`. |
| Absolute checkout | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-run-rerun` |
| Inspected integration baseline | `824521fac8795aa37f1bf66a34bfaa011bae4713` on local `master`; accepted 3.1.9.8 and 3.1.10 are ancestors. The earlier code discovery used `f02eb7f837677eef210d305635f6a2d84f0516b4`; the intervening Date work is preserved. |
| Required implementation base | **WAITING ON accepted, integrated 3.1.11.** Resolve its actual release SHA from the parent record, verify ancestry and completed shared operations, then use a base containing that release and this committed approved plan. Neither the inspected baseline nor the parent's planning SHA is an implementation release. The planner verifies and supplies the concrete base before issuing a launch prompt. |
| Finalizer / integration | 3.1.11.3 consumes this exact passing candidate and 3.1.11.1's candidate in either order. Its existing proposed binding is `codex/3.1.11.3-operations` at `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-operations`; its operator-opened session rechecks availability and resolves the combined base. Target: local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`. The operator chooses integration; this brief does not authorize a product merge. |
| Completion | This supervisor freezes a committed candidate with focused proof for finalizer intake. Worker roadmap completion follows 3.1.11.3's accepted integration and owned cleanup; downstream release and full Phase 3.1 acceptance remain separate. |
| Evidence | `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.2-run-rerun-2026-09-19/`; retain tested identities, command receipts, screenshots, authority comparisons and cleanup receipts outside disposable worktrees. |

The implementation ref/path were absent at planning. Only the Sessions implementation worktree
was registered beside the integration checkout when documentation persistence began. This planner
uses `codex/plan-3.1.11.2` at
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-run-plan`, based on the
inspected integration baseline. Names are proposals, not reservations; execution rechecks actual
ownership and the four-auxiliary-worktree ceiling, including capacity for the finalizer.

### Release check owned by planning

R1 below is a prerequisite verification, not permission to discover unfinished shared behavior
during implementation. At approval, the parent's worktree recorded S1–S3 implementation in
progress with uncommitted changes; shared S5 launch extraction and accepted release were unavailable.
Planning may persist this approved scope now, but **no READY supervisor prompt is issued yet**.

Before that prompt, this planner reads the parent's committed release and actual export/file map,
verifies integrated focused proof and cleanup, and reconciles the concrete leaf paths in this brief.
The released operations must support exact-source opening/prefill, preview, warning acknowledgment,
final submission and exact replay, with completed app/client/BFF registrations. Steps must be able
to obtain server-authored warning facts before the operator has finished the editable Values page;
missing omission values cannot create a warning/Values navigation deadlock. The full final plan
still validates all submitted values and omissions. Parent S5 owns this shared callable boundary.

Verify separately that Setup and Run/Rerun consumers work from the same parent base and neither
needs an unmerged sibling API, shared switch edit or generated input. Shared action vocabulary and
dispatch must permit the one Rerun launcher without restoring direct dashboard retry/restart.
An unfinished shared operation stays with 3.1.11; do not transfer it silently to this child or
3.1.11.1. Material ownership changes return for amendment. Settled recommendation 1 A is not re-asked.

### Feasibility and change ownership

These are inspected mechanisms, not test results from this planning session. Recheck changed inputs
after the parent's accepted release, rather than treating its promised interfaces as built.

| Question / current evidence | Necessary change and permitted owner | Required proof / limit |
| --- | --- | --- |
| `run-start.tsx` opens at Input, uses ordinary submissions, and has no source-bound Rerun interaction. `readRerunValues` already validates source/version/descriptor and reports completion plus declared value coordinates. | R2 owns the modal, released launch leaves and prior-value transport. Consume the read service; never infer mappings or fetch another attempt as fallback. | P1 tests failed/interrupted/successful defaults, mandatory completed steps, editable copies and named invalid/unavailable cases. |
| `applyStartStepSelection` rejects omitted required steps; the earlier failed-source wording selected only unfinished steps. | The approved 1 A amendment selects descriptor-required steps too and visibly explains completed mandatory selections. R2 consumes the existing requirement/cascade projection unchanged. | Required steps remain selected; eligible optional steps remain customizable. No implicit omission capability, automatic checkpoint replay or completion-based disable. |
| `buildRerunPlan` binds source/version, selection, business keys and completion evidence; final `executeStartRun` revalidates consent. The prior-value query grants no consent. | R3 owns the complete interaction over the released adapters. Preserve server authority and optional `copiedFrom` attribution; clear attribution when a copied field is edited or cleared. | P2 separates warning navigation from final consumption and distinguishes edits that preserve warning facts from changes requiring renewed consent. |
| `services/start/plan.ts` checks `reject-active`; `run-fan-out.ts` implements `supersede-active` against the then-current active set. The preview contains no affected-generation basis. | R4 owns a strict start-specific persisted/wire preview basis and its fingerprint, plus the narrow start-command check inside the existing authority transaction. Keep Intake's separate fan-out contract unchanged. | P3 binds exact affected run identities/generations and revisions, including an empty set, and rejects added/removed/changed active targets before any replacement or creation. |
| Plans are strict JSON in `workflow_run_requests`; `startPlans.consume` binds immutable fingerprints and the original confirmation revision. Kernel replay revalidates the consumed plan and returns the stored result. | R4 may extend launch-specific JSON and hashing without SQL DDL. Historical unconsumed supersede plans lacking the new review basis require replanning; already consumed historical commands retain exact replay. | P3/P4 exercise historical readable plans, restart, divergent reuse and successful replay after later settings/source changes. No released migration or write-safety occurrence changes. |
| `confirmStart` currently creates a new UUID and timestamp on each click. In-flight result checks cover form changes but do not provide reload-safe exact submission identity. | R5 retains one exact final envelope before dispatch through the released launch/replay boundary and restores it across reload. Retain only the identity/binding needed for replay, not raw input, private values or source outputs. | P4 covers rapid duplicate clicks, response loss, remount/reload, delayed replies after close/edit/reopen, and exact result identity. Unknown transport is not a rejected enqueue. |
| Settings selection/currentness and source-bound fresh execution are already implemented. Existing `source-bound-repeat.test.ts` covers occurrence-specific fresh execution and immutable source proof. | R5/P5 consume those mechanisms and prove browser-to-authority crossover; preserve the shared result fold and source-bound execution/recovery fences. | Current settings for new work; stale unconsumed preview refuses; successful replay remains the same identity after save. New source-bound work never replays another run's checkpoint or old receipt as fresh proof. |

### Ordered implementation

1. **R1 — Verify the released base.** Use the concrete planner-verified parent release and plan
   commit. Verify branch/path/base ancestry, released leaf ownership, start/prefill/warning/replay
   consumer proof and sibling independence before edits. Preserve accepted Date navigation,
   Intake upload and dialog focus. If the recorded release is absent or changed materially, stop
   dependent work and report the exact missing prerequisite; do not build the parent's promised API.
2. **R2 — One source-bound Run/Rerun modal.** Ordinary Run and eligible Rerun share the existing
   plan/confirm/enqueue path. Rerun begins at Steps. Failed/interrupted defaults select failed and
   unfinished steps plus descriptor-required completed steps with a visible reason; successful
   defaults select all eligible steps, including formerly omitted steps. Descriptor requirements
   and omission cascades remain authoritative. Offer only declared available completed-value
   mappings as optional copy actions; each copied value can be edited or cleared independently.
   Missing/protected/invalid values remain explicit, and provenance never becomes replay authority.
   Changing an identity-bearing value uses ordinary schema admission and new item derivation.
   Keep one Rerun label for both outcomes and remove direct retry/restart entry paths through the
   released launch allocation, including stale bulk-command paths; do not introduce batch source
   merging or rewrite unrelated Queue/Detail behavior.
3. **R3 — Warning, Values and final review.** Proceed from Steps through a server-authored
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

All paths below are repository-relative. Parent release validation resolves extraction names before
launch; it does not widen ownership. New adjacent leaves may serve only these approved outcomes.

| Owner | Permitted scope |
| --- | --- |
| R2/R3/R5 modal and launch | `src/dashboard/surfaces/run-start*.ts*`; parent's extracted `src/dashboard/app/run-launch.tsx`, `run-launch-model.ts`; `src/dashboard/client/start-commands.ts`, `rerun-queries.ts`, and adjacent launch-only recovery/value helpers. Use `/ui`, Components lead, local implementation; use existing primitives/tokens and the prescribed playwright-cli route. |
| R4 launch authority | `src/services/start/plan.ts`, `rerun.ts`, `step-selection.ts` only for launch admission/projection; `src/domain/run/start-plan.ts`, `src/domain/dashboard/start-plan.ts` and browser-safe launch-only contracts; `src/server/dashboard/commands/start-plan-service.ts`; the `executeStartRun`/start replay arm of `src/core/command-kernel.ts` and a start-specific helper in `run-fan-out.ts` if necessary. No worker-control or other command-family redesign. |
| R2 launcher eligibility | `src/server/dashboard/projectors/queue-row-actions.ts` and a released launch-specific eligibility leaf, only the Rerun action/eligibility portion and matching tests. Shared app/dispatch/action-union registrations must already be complete in the parent. Read-only source projection remains the accepted input; a defect needing broader changes requires an ownership amendment. |
| R6 tests/references/docs | Existing focused tests below; new launch-only unit/server/browser tests and private fixtures. Own `tests/parity/helpers/fixture-start.ts`, `fixture-start-routes.ts`, `reference-start-scenes.ts`, `tests/parity/reference-start.spec.ts`, and Run/Rerun reference names. Preserve unrelated reference identities. Update this task's evidence record and the approved normative amendment only as required by verified facts. |
| Parent / peer / finalizer exclusions | 3.1.11 completes common session/launch registration; 3.1.11.1 owns Setup/preflight leaves. Shared schema unions, root composition, common fixture builders and combined generated outputs remain parent/finalizer-owned. Settings, Storage and Intake are accepted APIs. 3.1.11.3 reconciles exact candidates and combined output. |

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
The parent may add more launch-specific checks; its release validation records those selectors.

**G1 — focused logic, authority and mounted interaction.** Run affected groups while implementing;
before candidate freeze all rows below must pass on the final relevant inputs. Do not repeat
unchanged groups for documentation-only recording.

```sh
npm run test -- tests/unit/dashboard/run-start-model.test.ts tests/unit/dashboard/run-start-dialog.test.ts tests/unit/dashboard/run-start-focus.test.ts tests/unit/dashboard/run-start-timeline.test.ts tests/unit/dashboard/run-start-kit-render.test.ts tests/unit/dashboard/start-plan-contract.test.ts tests/unit/dashboard/run-rerun.test.ts tests/unit/dashboard/run-launch-recovery.test.ts
npm run test -- tests/unit/start-plan.test.ts tests/unit/server/start-plan-omissions.test.ts tests/unit/server/start-plan-supersede.test.ts tests/unit/server/queue-row-actions.test.ts tests/unit/dashboard/bulk-dispatch.test.ts tests/unit/command-kernel.test.ts tests/unit/command-kernel-step-omission-carry.test.ts
npm run test -- tests/unit/rerun-values.test.ts tests/unit/server/rerun-values.test.ts tests/unit/rerun-source-eligibility.test.ts tests/unit/rerun-protected-identity.test.ts tests/unit/source-bound-repeat.test.ts tests/unit/architecture/rerun-prefill-boundary.test.ts
npm run test -- tests/unit/settings-activation/save-create.test.ts tests/unit/settings-activation/stale-plan.test.ts tests/unit/settings-activation/mixed-execution.test.ts tests/unit/settings-activation/retry-child.test.ts
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
| Approval | Six-step scope and recommended 1 A approved by the operator on 2026-09-19. |
| Implementation | Unstarted; no product/runtime edits or runtime acceptance during planning. |
| Parent prerequisite | WAITING ON 3.1.11 accepted integration, cleanup, actual launch export/file map and independent consumer proof. Planner retains the release/reconciliation check before a READY prompt. |
| Planning persistence | Authorized complete plan/contract/decision-index/matrix/roadmap documentation and scoped validation/commit on `codex/plan-3.1.11.2`. Local documentation integration is not yet instructed; retain the committed candidate for operator-directed integration. |
| Child/group release | No launch prompt yet. This candidate, later 3.1.11.3 intake, operator-directed product integration and cleanup remain distinct. |

Maintain this compact record in place during execution, with linked dated evidence. Send Done /
Now / Remaining once at supervisor start or genuine resume; later updates report only newly
verified completions and material blockers. Routine transfer uses this owner. Use `/handoff` only
for interrupted unique execution state; no sibling launch or push is implied.

### Planning validation — 2026-09-19

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
| Readiness | WAITING ON accepted 3.1.11 and planner verification of its actual launch interfaces/ownership, plus operator-directed integration of the planning documentation. No READY supervisor prompt issued. |

Logs, exits, changed-file hashes, the reproducible documentation checker and commit verification
are retained in the [planning evidence directory](/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.11.2-plan-2026-09-19/).
The documentation-only recording change reruns generation/freshness and document-binding checks;
unchanged code/test/configuration/dependency inputs preserve the scoped lint result.
