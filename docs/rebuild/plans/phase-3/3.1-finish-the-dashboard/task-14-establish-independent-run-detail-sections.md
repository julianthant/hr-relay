# Task 3.1.14 · Establish independent run-detail sections
<!-- roadmap: dash-detail-foundation -->

**Current assignment: 3.1.14.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.

Read [the shared phase plan](README.md#parallel-execution-and-worktree-contract) and
[current task identities](README.md#current-task-identities) before a focused assignment.

Extract the section-boundary obligation from former Task 12-2. Finish this prerequisite before the timeline and evidence-section tasks; those tasks need this accepted boundary, not each other.

- [x] separate production projector/component/test entry points for Context/Data, Logs, Receipts/Failures and Gates with one completed registration owner
- [x] preserve the existing live detail path and section behavior, pass focused checks, then integrate the common base
- [x] freeze exclusive section and timeline paths plus fixtures; refuse admission while a shared mutable switch/query remains

This is roadmap scope, not a launch-ready execution brief. Before implementation, the operator
approves exact paths, base, branch/worktree, proof commands and resource ownership through
`/phase-plan`. Use the Phase 3.1 D191 exception above; preserve vertical-slice acceptance and all source safety
contracts. Work independently by default; coordinate with relevant peers when necessary under D344. No
automatic sibling dispatch or merge.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-22

**Approval.** The operator approved the complete S1–S5/P1–P5 plan on 2026-09-22,
including Luna xhigh execution and local `master` integration after focused acceptance.
This is the sole plan for 3.1.14. It releases only the shared detail foundation; it
does not launch 3.1.14.1–3.1.14.5 or claim their A29–A36/D01–D05 outcomes.

| Control | Binding |
| --- | --- |
| Prerequisites | Accepted 3.1.9 boundary foundation, 3.1.11.2 Run/Rerun, 3.1.11.3 Operations release and 3.1.13 Queue. Operations candidate `2c81ebd84bc4ee911a56f65cafdcd3784d721686` and Queue integration `2f97dae45e62ee6d046cbe90ef1673e993ea85e6` are ancestors of inspected clean local `master` `e49ec3f2a26728b3f8ecb1d1b23e15a5625799d4`. Recheck ancestry and target drift at launch. |
| Planning checkout | `codex/plan-3.1.14` at `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-detail-plan`; documentation integration and cleanup only. |
| Implementation checkout | `codex/3.1.14-detail-foundation` at `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-detail-foundation`, created from the committed, integrated plan and verified prerequisite base. One Luna xhigh worker owns the coherent shared boundary; the Sol root accepts and integrates. The existing UI planning worktree is unrelated and untouched. |
| Integration | Local `master` in `/Users/julianhein/Projects/hr-automation-rebuild`. Operator approval includes integration of the passing documentation and product candidates and cleanup of their owned branches/worktrees. The root rechecks exact candidate, target drift, changed gate inputs, evidence and merge conditions first. No push. |
| Evidence | `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.14-detail-foundation-2026-09-22/`; retain focused commands/results, tested SHAs, section and child ownership map, parity output, gate-source proof, integration and cleanup receipts. |
| UI route | `/ui` Components, narrow unchanged-rendering wiring route; Luna xhigh performs implementation and affected parity. Any observed visual or interaction change leaves that narrow route and receives the applicable UI verification before release. |

### Scope and ownership

**S1 — complete one client registration owner.** `src/dashboard/surfaces/log-panel.tsx`,
`log-panel-model.ts`, `src/dashboard/app/use-panel-sections.ts` and the shared
`PanelSections` type currently mix timeline, Context, logs, receipts/failures and
gate/park state. Extract the current bodies and state into exclusive section
modules under `src/dashboard/surfaces/run-detail/`: `timeline*` for 3.1.14.1,
`logs*` for 3.1.14.3, `receipt-failure*` for 3.1.14.4 and `gate-park*` for
3.1.14.5. Existing `context-rail*.ts*` remains 3.1.14.2's body. Keep
`log-panel.tsx` as the completed composition/registration owner and
`use-panel-sections.ts` as stable orchestration; section-specific selectors,
loads, controls and refresh operations live behind the owning modules. Preserve
the same DOM, copy, focus, tab routing, loading/error states, memo behavior,
live follow, sticky scroll and dialog lifetime. The accepted release records
every final concrete file and export before any child is admitted.

**S2 — complete one server registration owner.** Split the current
`src/server/dashboard/queries/run-detail.ts`, `run-trust.ts`, `run-sections.ts`,
`run-detail-types.ts` and `data.ts` overlap into a closed section dispatcher
and dedicated Context/Data, logs/captures, receipts/failures and gate/park
projectors. Use existing `run-logs.ts`, `run-captures.ts` and `data.ts` as the
starting owners. The parent alone changes shared section schemas in
`src/domain/dashboard/run-detail.ts`, descriptor projection/composition in
`src/server/dashboard/compose/run-detail.ts`, and route/transport registration
when required. Keep a single authority-bound detail and section read path:
exact run/attempt identity, advertised availability, lazy bounded reads,
explicit absent/error arms and capture byte binding. Preserve the accepted
Rerun-values producer; Context is readback, never an `edit-checkpoint` writer.

**S3 — make non-operator gates consumable before children.** The graph currently
declares `children-terminal` and `external` `subscribes`, but
`src/core/run-executor.ts` parks every gate and only the operator
`resolve-gate` path in `src/core/command-kernel.ts` settles results.
Complete the shared source registration/dispatch and settlement in
`src/base/flow.ts`, `src/domain/workflow/graph.ts`, `src/core/run-executor.ts`,
the command/lifecycle boundary and worker runtime composition as needed.
Admit bounded supporting changes to `src/domain/gates.ts` and existing authority
repositories for durable source identity/replay; use their existing JSON record
storage, never edit a released migration or use a parallel authority. A new
table/DDL is outside this approval and requires an amendment if proven necessary.
Require an actual registered source before a non-operator gate can
park, validate declared source ID, correlation, run/attempt, event and result
schema, and bind the durable result to the exact gate/version. A matching
source event settles once, records the source rather than a fabricated human
answer, publishes resolution and requeues by the established lifecycle.
Duplicates/restart replay return the same result; wrong/stale events refuse
without a row, timeline resolution or lifecycle transition. Operator
`resolve-gate` refuses non-operator gates, and source dispatch refuses operator
gates. There is no registered non-operator workflow today; a synthetic
descriptor with an actual runtime source port proves production composition.
Workflow-specific source providers and activation remain with their admitted
workflow task, and an unavailable provider fails loudly instead of leaving a
silently permanent park.

**S4 — freeze disjoint child and fixture ownership.** Complete current section
registration and extract shared tests/fixtures so children can work against
this accepted base without editing a common switch or query. The parent owns
`tests/parity/helpers/fixture-detail*.ts`, `fixture-gate.ts`,
`fixture-failure-resolution.ts`, `reference-detail-scenes.ts`, common run-detail
unit fixtures, shared strict wires, root config and combined generated output.
The resulting exclusive map grants .1 timeline/identity and follow-state;
.2 `context-rail*.ts*` and Data/Attempts readback; .3 logs/captures; .4
receipts/failures/diagnostics; .5 gate/park presentation and resolver proof.
Each child gets its own test and parity fixture/spec entry point and evidence
namespace `3.1.14.N/`; .6 integrates all five. The release must name actual
paths, imports and test selectors, show both orders of child intake remain
possible, and refuse child admission while a shared mutable registration,
schema, fixture or generated input remains. No sibling consumes an unmerged
API, and no child inherits shared executor/command/registration ownership.

**S5 — focused release.** Commit the implemented source, meaningful focused
proof and current task record by logical category. The root inspects the
patch and production-path evidence, integrates the exact accepted candidate
under the approved local merge condition, reruns invalidated focused checks,
records the released base and exact child map in this owner and the roadmap,
then removes only its owned worktree/branch. This task does not dispatch a
child, change a workflow-specific policy, execute an HR write, refreeze a
reference merely to pass, or claim 3.1.19's full gates.

### Production-path proof and gates

| Proof | Required result and forbidden effect |
| --- | --- |
| P1 · section dispatch | The real BFF route and client fetch every advertised current section from the same run/attempt; exact absence/error, cursor, capture and context-source behavior survives extraction. A wrong-run response or late response cannot render beside another run. No eager entire-stream read or invented fallback. |
| P2 · visible behavior | Existing detail, receipt, open gate, parked write and failure states keep their DOM/copy/focus and reference identities. A tab switch and same-run revision refresh preserve the relevant dialog/scroll behavior; a run switch clears old sections. Filtered browser parity and a11y establish the affected states. No unreviewed refreeze. |
| P3 · valid settlement | Valid operator gate retains its existing command path. Synthetic child-terminal and external descriptors each receive a matching durable source event through the production composition, store one typed source-attributed result, publish one resolution and requeue the exact parked run. Restart/replay and duplicate delivery cannot add a second result or effect. |
| P4 · negative controls | Wrong resolver family, source ID, correlation, run, attempt or gate; stale version; missing provider; malformed event/result; and conflicting duplicate each refuse before any gate-result insert, resolution event, requeue or external write. A valid positive control in the same fixture prevents an unrelated setup refusal from satisfying these tests. |
| P5 · isolation | Stable section and fixture exports compile without child-owned shared writes. Verify test selectors exist, accepted prerequisite ancestry and worktree capacity, exact branch ownership, generated freshness and unchanged-input evidence before candidate release and integration. |

During implementation run `npm run test -- <affected exact test paths>`, including
`tests/unit/run-executor-control-nodes.test.ts`,
`tests/unit/command-kernel.test.ts`, the affected run-detail server/dashboard
tests, `tests/unit/architecture/wire-connectivity.test.ts`,
`dashboard-wire-boundary.test.ts` and `dashboard-refresh-boundary.test.ts`,
plus new focused source-settlement and section-boundary tests. Run
`npx eslint <affected source/test paths> --max-warnings 0` whenever tests run;
`npm run typecheck`, `npm run build:manifest:check`, `npm run web:build`, and
filtered `npm run test:parity -- tests/parity/run-detail/*.spec.ts tests/parity/failure-resolution.spec.ts`
on the final candidate. Use `playwright-cli` and its playbook if a manual browser
investigation is required. For documentation/generated changes run
`npm run roadmap`, `npm run roadmap:check`, link/check selectors and
`git diff --check`. The parent owns these focused gates and their repairs;
3.1.14.6 owns group typecheck/integration, and 3.1.19 owns full repository
lint, coverage, broad parity/production/performance/recovery and frozen
A01–A42/D01–D05 acceptance. Record unrun obligations explicitly.

### Released proof and child ownership — 2026-09-22

Product candidate `625c359fc` on `codex/3.1.14-detail-foundation` contains
the source-gate runtime, section extraction, fixture split and focused gate
repairs. It starts at approved `4cd6a7c95` and was integrated into local
`master` by merge `92e88701c`. The merge tree differs from the tested candidate
only by the independently integrated instruction change `4edaa7389` in
`.agents/skill-library/repository-work/REFERENCE.md`; no tested product,
fixture or reference input changed during integration. No push or sibling
dispatch occurred.

| Child | Exclusive client and server implementation | Exclusive parity entry and scenes |
| --- | --- | --- |
| 3.1.14.1 Timeline | `src/dashboard/surfaces/run-detail/timeline.tsx`, `timeline-model.ts`; `src/server/dashboard/queries/run-detail.ts` | `tests/parity/run-detail/timeline.spec.ts`, `helpers/run-detail/timeline*.ts`; `run-done`, `run-group`, `run-member` |
| 3.1.14.2 Context/Data | `src/dashboard/surfaces/context-rail*.ts*`; `src/server/dashboard/queries/data.ts` | `tests/parity/run-detail/context-data.spec.ts`, `helpers/run-detail/context-data*.ts`; `run-queued` |
| 3.1.14.3 Logs/Captures | `src/dashboard/surfaces/run-detail/logs*.ts*`, `src/dashboard/surfaces/run-captures*.ts*`; `src/server/dashboard/queries/run-detail/logs.ts`, `run-logs.ts`, `run-captures.ts` | `tests/parity/run-detail/logs-captures.spec.ts`, `helpers/run-detail/logs-captures*.ts`; `run-running` |
| 3.1.14.4 Receipts/Failures | `src/dashboard/surfaces/run-detail/receipt-failure.tsx`, existing receipt/trust/advisory leaves; `src/server/dashboard/queries/run-detail/receipts-failures.ts`, existing failure-resolution/diagnostic leaves | `tests/parity/run-detail/receipts-failures.spec.ts`, `helpers/run-detail/receipts-failures*.ts`; `run-failed`, `run-receipt-populated` |
| 3.1.14.5 Gates/Park | `src/dashboard/surfaces/run-detail/gate-park.tsx`, existing identity-approve/park-resolve leaves; `src/server/dashboard/queries/run-detail/gate-park.ts` | `tests/parity/run-detail/gates-park.spec.ts`, `helpers/run-detail/gates-park*.ts`; open-gate, parked-write, decision and resolution variants |

The parent owns `log-panel.tsx`, `log-panel-model.ts`,
`app/use-panel-sections.ts`, `run-detail/section-registration.ts` and
`sections.ts`; the closed server dispatcher `queries/run-sections.ts`,
`run-trust.ts`, `run-detail-types.ts`, `run-detail/availability.ts`, shared
schemas and route/composition registration; and parity
`helpers/fixture-detail.ts`, `fixture-detail-routes.ts`,
`reference-detail-scenes.ts`, `helpers/run-detail/section-wire.ts` and
`run-detail/shared.ts`. `log-panel.tsx` retains cross-section navigation,
outcome routing and notices as frozen composition. The Logs renderer imports
gate/failure renderers, and Gates/Park imports `decisionAge` from the timeline
model; those accepted exports are stable inputs. Child specs import shared
runner/anchors, not sibling scenes. Either child intake order can use the
released base without modifying another child's paths. A child needing a
shared registration, schema, composition or generated-input change must return
that change to the parent/finalizer owner before parallel admission.

Focused release checks: 332 tests passed across 18 exact unit, architecture
and scenario files; the real BFF flow passed 152/152; canonical trust linkage
passed 6/6. Scoped ESLint, `typecheck`, `build:manifest:check`, `web:build`,
`roadmap:check` and staged `git diff --check` passed. The
new synthetic external and children-terminal gate cases exercise the actual
source runtime, retained authority, worker loop and composition; refusals and
duplicate/restart replay are asserted against result rows, timeline and
lifecycle. The generated manifest changed only because the shared gates source
hash changed, and its check passed. `web:build` emitted the existing large
chunk advisory.

The operator approved repairing inherited final-gate failures in this task.
The four Queue test typing errors were corrected against the current stream
and rerun contracts, keeping the expired-cursor snapshot and exact-head
no-snapshot assertions. The affected trust-linkage test now expects durable
`existing` for replay of an already published notification after archive,
while retaining archived receipt and deleted-run refusals. These failures
were reproduced on untouched `4cd6a7c95` before their repairs.

Filtered browser parity passed 58/58 in refresh mode and again in normal
assertion mode. The 60 refreshed a11y/metadata/screenshot pairs were reviewed:
all metadata differences are the derived descriptor hash; a11y changes have
eight distinct forms from that hash, the existing preflight control, Queue's
Rerun labels, and previously integrated archive export/status presentation.
Screenshot deltas were quantified for all 60 pairs and the largest archive,
gate and parked-write changes were inspected side by side. No reference was
refreshed merely to suppress an unexplained difference. The first refresh run
also exposed a cached shared fixture-server hook after Playwright worker reuse;
each child spec now registers its own server, and both final parity runs pass.

Full repository lint, coverage, broad parity, production, performance,
recovery and frozen A01–A42/D01–D05 acceptance remain assigned to 3.1.19.
Evidence and command logs are retained at
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.14-detail-foundation-2026-09-22/acceptance/`.

### Approved child-release amendment — 2026-09-22

The operator approved the plan for 3.1.14.1–3.1.14.6 after the accepted
foundation at `92e88701c` and documentation close at `3170fc47e`. This
amendment owns one bounded shared follow-up before the five leaf candidates.
It does not reopen the accepted foundation or add a roadmap node. Its product
branch is `codex/3.1.14-shared-followup` in
`hr-worktree-detail-shared`, cut from the committed, integrated child plan.
The Sol root accepts and locally integrates it before admitting leaves.

The parent reserves the versioned, bounded, authority-backed item-attempt
read and its shared wire/route/composition, the Queue/detail action placement
and callback needed to surface the already accepted source-bound Rerun modal,
and shared fixtures. The read must return a deterministic page or bounded
history for the exact item with separate run/attempt identities; archive and
deleted-run absence must remain explicit. No new table, migration, edit command,
client-derived status or broad shared registration redesign is authorized.
The follow-up may touch its reserved `log-panel*`, app action plumbing,
shared domain schemas, server dispatcher/composition, and common tests/fixtures.
It must publish stable exports and prove version binding, stale/refused action,
archive/deletion behavior and bounded pagination with focused tests, scoped
ESLint, typecheck and affected generated/build checks. Evidence goes under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.14-detail-children-2026-09-22/shared/`.

After that release, 3.1.14.1 additionally owns the smallest Queue row/model
and focused Queue test/parity change required to show one selected-day item row
with separately selectable attempts. Its narrow exception also owns the
`dashboard-app.tsx` Queue input/filter handoff: apply status filtering after
item grouping so a matching attempt never hides its sibling attempts, while
preserving the existing workflow scope, session-batch grouping and keyboard
order. No other app composition behavior transfers. The accepted Queue
projector identity and row actions remain shared inputs; any necessary change
to them returns to the parent before parallel launch. The shared follow-up may
add only the optional action/target prop contract in `context-rail.tsx` needed
to connect its parent-owned detail callback; 3.1.14.2 retains the renderer.
That child also receives a narrow exception in `src/domain/dashboard/run-detail.ts`
for the Context/Data editing and entry schemas only, so it can make the source
rail read-only atomically with its exclusive query and UI changes. The shared
follow-up must not narrow the active Context/Data schema ahead of that leaf.
3.1.14.2 consumes the attempt read and Rerun callback in its exclusive
Context/Data section. 3.1.14.3 owns any genuine
ordinary worker-note producer seam after tracing current callers. 3.1.14.4
and 3.1.14.5 retain their exclusive receipt/failure and gate/park paths.
For 3.1.14.5 only, the approved gate-command outcome also grants a narrow
exception in `src/core/command-kernel.ts` at `executeResolveGate` and focused
command tests: validate current condition, bound dependency evidence and
freshness before any durable gate decision. The existing run-version and gate
identity checks remain. If that cannot be expressed without changing the
shared executor, descriptor contract or another leaf's path, return the
change to the parent/finalizer owner before writing it.
Children cannot edit another leaf's paths or the parent reservation. Any
unplanned shared change returns to this owner or to 3.1.14.6 after candidates
are complete; the Sol root decides that boundary before work proceeds.

Each leaf begins from the same accepted shared-follow-up commit, uses an owned
`codex/3.1.14.N-*` branch and `hr-worktree-detail-*` worktree, and records
its exact candidate SHA, commands, results and changed paths under the matching
`3.1.14.N/` evidence directory. At most three auxiliary task worktrees may
coexist with the unrelated UI planning worktree. The five leaves run in waves
as capacity permits, with no sibling prerequisite or overlapping writes.
3.1.14.6 combines their exact committed candidates in
`codex/3.1.14.6-finalize` / `hr-worktree-detail-finalize`, repairs integration
defects, proves the focused group gate, then the Sol root integrates locally
and cleans owned resources. No push, external HR write or next-task dispatch
is authorized. Broad repository gates and frozen A01–A42/D01–D05 acceptance
remain with 3.1.19. No independent review applies under the approved 3.1
cadence.
