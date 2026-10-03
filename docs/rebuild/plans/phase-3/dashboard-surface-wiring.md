# Existing dashboard components: backend lifecycle and wiring plan

Status: W0 and W1 accepted locally on 2026-10-02. W2–W7 remain proposed and unlaunched. Remove, Snooze and superseded Settings save meanings below are operator-approved.

This is supporting, unnumbered work for the [backend and unit-test initiative](backend-and-unit-tests.md). That plan continues to own confirmed Logs and its Phases 3–5. This document owns the proposed Settings, Notifications, Activity, Archive, Sessions, Explorer, and Queue wiring packages. It does not assign roadmap task numbers or grant release, freeze, cutover, or Electron admission.

## Outcome and constraints

Connect the approved components to authoritative backend data and commands while making each backend feature's saved-state and recovery lifecycle straightforward to follow.

- Preserve the existing components, layout, typography, colors, navigation, disclosures, charts, tables, and keyboard behavior.
- Change producers, typed models, resource hooks, adapters, and callbacks. Existing elements may receive real values and command availability; their presentation is not redesigned.
- Do not introduce new visual components during wiring. A missing visible state, control, or component becomes separate operator design work before that dependent part proceeds. Do not use misleading existing states to conceal a gap.
- Backend owners classify business state, availability, identity, results, and confirmation. The renderer formats and presents served facts and manages local interaction state.
- Preserve ordinary settings, private credentials, provider keys, run snapshots, archive custody, worker leases, and process ownership as distinct authorities where their lifecycles differ.
- Use the existing TypeScript/Hono/SQLite/client/HTTP/SSE architecture. Do not add a distributed service, second queue authority, per-panel whole-day polling, or generic service framework.
- Use focused unit tests, scoped lint, and affected static/generated/bundle checks. Complex test design and execution remain for later operator discussion. Preserve retained assertions and test membership; do not restore retired parity/scenario suites.
- Exclude Logs, Run/Rerun design, spreadsheet import redesign, broad workflow migration, live HR actions, Electron packaging, and unrelated repository cleanup.

## Verified planning inputs

Backend checkout: `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend`, branch `codex/logs-backend`, planning entry `0089166dc38c2fb7f2df15b067a65ce3d1e2809f`. Its existing `backend-and-unit-tests.md` modification belongs to the concurrent Logs session and is outside this document's edit scope.

Final planning recheck: `43b03b6945e7505a67844071f618691e16c84365`. The intervening Logs commit changes operation action binding, workflow task classification, its generated manifest, and confirmed-action units; it does not integrate the presentation candidate or complete any package below. This plan's local Markdown targets and explicitly named source paths resolve.

Approved presentation: `/Users/julianhein/.codex/worktrees/b6c7/hr-automation-rebuild`, branch `codex/activity-ui-polish`, `c3998ec263dc7e6bcb20470ab6a32d60a04eff23`. It is not integrated into the backend checkout. Its untracked frontend-structure draft is not implementation authority.

The [dashboard presentation amendment](../../reference/dashboard-surfaces.md#frontend-only-dashboard-presentation-amendment--2026-10-01) in the presentation candidate and its `src/dashboard/PARITY.md` record the implemented design. Source components, rather than retired connected renderers, are the consumers to preserve. The [backend lifecycle review](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-backend-review/review.md) provides the initial findings; execution must recheck affected inputs.

| Surface | Backend readiness | Approved consumer |
| --- | --- | --- |
| Settings | Existing durable save/read/activation path; shared-reader and recovery fixes needed | `SettingsPage` |
| Notifications | Durable inbox, observations, target lookup, guarded read/snooze commands and delivery pipeline exist; display projection and unsnooze are incomplete | `NotificationsView`, `NotificationPing` |
| Activity | Report, range-bound selection, CSV and XLSX paths exist; new view adapter and callback wiring needed | `ActivityView`, its existing range/charts/tables |
| Archive | Existing saved-report connection; presentation integration and focused lifecycle/selection hardening needed | `RuntimeArchiveWorkspace` |
| Sessions | Worker/pool/lease/browser facts and control paths exist; display/availability mapping and Remove semantics needed | `SessionsView`, `SessionTimeline` |
| Explorer | Registered definition graph and safe overrides exist; adapter to the approved timeline needed | `ExplorerTimeline`, its existing source/disclosure/branch components |
| Queue | Existing authoritative day projection, commands and resumable stream; preserve the connected redesigned consumer | `QueuePanel`, `QueueRow` |

Activity XLSX was verified separately from the CSV client: `src/dashboard/client/export-commands.ts` calls `/api/v1/exports/xlsx`; `src/backend/transports/http/routes/shell.ts` serves it; `src/backend/app/composition/dashboard/shell.ts` composes the export service. The prior review's CSV-only scope was not evidence that XLSX was absent.

## Decisions before dependent execution

1. **Idle worker Remove — approved:** retire the exact owned idle worker and reduce that workflow's desired pool size. Keep the card until retirement is confirmed. Preserve run/history records and peer workers. This is not a local hide preference.
2. **Notification Snooze — approved:** snooze for one hour, with an explicit Unsnooze command. The current backend requires a future `until` instant and has no operator unsnooze command. Use the backend's clock and preserve the independent read state.
3. **Superseded Settings save — approved 2026-10-02 (D365):** distinguish an authenticated accepted-but-superseded save from unresolved submission. Clear submission uncertainty, retain the draft for review, and show current saved values through the existing conflict presentation. Never automatically resubmit. Actual uncertainty and mismatched readback retain the immutable exact-attempt retry and its conservative assertions. The [Settings contract](../../reference/clock-config-secrets.md#d365--accepted-settings-save-superseded-before-readback--2026-10-02) owns this behavior; any needed new visual state belongs to separate operator design work.

Explorer remains a workflow definition/reference and hypothetical branch preview. Selected-run execution progress belongs to its separately selected run source, including the Logs initiative. This plan does not add a live overlay or restore the retired registered-definition UI.

## Common execution and verification contract

Each package includes implementation, relevant unit updates, repairs, and an acceptance receipt. Only its own outcome is launched in a fresh chat. Planning and execution remain separate choices; no automatic next-package dispatch or sibling merge.

Before edits, verify checkout ownership, current HEAD, peer edits, accepted prerequisites, nearest instructions, and exact affected contracts. Preserve concurrent Logs work. Use the existing worktree for authorized disjoint work; overlapping shared files require an agreed owner. Do not switch/reset another checkout, merge a branch, create more worktrees, or push automatically.

Use explicit feature operations and one canonical production read path. HTTP parses/admission and app composition remain thin. The shared command path retains identity, expected-version checks, journal/audit, transaction ownership and exact replay. Repositories own durable storage; a fake repository does not prove durability.

Re-use the existing dashboard-day resource for Queue, worker/pool facts and inbox updates where applicable. Settings, Activity and Archive retain their own explicit query identities. Preserve stable reference identities where memoized consumers depend on them. Cancel or ignore late responses by full selection/request identity, including A → B → A changes.

Actual commands verified in the current package/runner:

```sh
npm run test:unit -- <actual affected unit file paths>
npx eslint <actual affected source/test/script paths> --max-warnings 0
npm run typecheck
npm run web:build
```

The angle-bracket arguments are templates, not runnable paths. Bind them to files that exist after implementation and confirm a nonempty collection. Run bundle checks for renderer/import changes; use affected static/generated checks when their inputs change. Record current baseline diagnostics and fix new attributable failures. Do not report a failed static/build check as passed because units passed. Do not use historical diagnostic counts as the current baseline.

Unit boundaries use real policy/adapter/controller code with fixed clocks, IDs, in-memory external ports and controlled promises. Verify positive behavior and named refusal cases through public results, not internal helper call choreography. DOM wiring units can check content, callbacks and attributes; they are not visual proof. SQLite atomicity, filesystem durability, process restart, real SSE convergence, browser sessions, OS delivery and macOS/Windows behavior remain unverified until the operator-approved complex checks.

## Package order and verifiable outcomes

Labels W0–W7 are local package labels only. Default order follows the operator's requested surface order. After W0, backend-only prerequisites in separate modules may run alongside Logs only with disjoint ownership; final consumer integration remains coordinated.

### W0 — Establish the approved consumers and shared data boundary

**Dependency:** verified presentation and backend candidates; explicit authorization for selected presentation integration.

Reconcile selected approved components with the current `models/`, `rules/`, `workflow-kit/` and test paths. Preserve already accepted catalog/scenario/parity retirements and peer Logs changes. Do not wholesale merge the older presentation branch or restore retired connected views. Keep source ancestry/provenance for selected presentation files.

Inventory each existing consumer's input fields, callbacks, loading/empty/error states, selection identity and command availability. Bind shared actor/day/run/clock context to served authority. Existing navbar search/date fixtures are not automatically expanded into new feature scope; shared selection callbacks required by these seven surfaces must be explicit. Missing presentation capability is recorded as a separate design dependency.

**Units:** consumer selection, actor/day/run context, late response isolation, stable memo inputs and callback ownership. Small render units pin the existing hierarchy and controls with identical supplied data.

**Outcome:** all seven approved consumers have a documented production producer seam; integrated presentation preserves the approved structure, or integration is explicitly still pending. No synthetic value becomes authority.

### W1 — Make Settings lifecycle clear, then wire confirmed readback

**Dependency:** W0 for final consumer integration. Shared-reader/backend work can precede it with disjoint ownership.

Centralize genuine-first-boot versus missing-previous-authority admission in the ordinary reader. Remove hidden transactional getters and make read snapshot ownership explicit. Split misleading `prepare` semantics into validation, independent private commit, replay reconciliation and confirmation without changing the kernel's existing ordering.

Preserve atomic ordinary save/audit/snapshot/activation, next-use credentials, provider saved/active/restart state, storage relocation admission, new-run snapshot selection and existing-run retention. Concentrate lifecycle policy before moving files; a new Settings folder is useful only if it owns behavior.

Keep `SettingsPage` and existing forms. Sequence composite reads across ordinary, credential and provider identities; prevent an older provider response replacing confirmed state. Implement the agreed superseded-save recovery using existing supported presentation states, with exact retries for actual uncertainty.

**Units:** genuine virgin positive control; absent saved state with retained history refuses; command/audit mismatch; stale revision; new-run versus retained-run snapshot; provider A/B read race; accepted/superseded versus unresolved save; independent private-store uncertainty mappings. In-memory tests do not prove a disk transaction.

**Outcome:** one traceable Settings lifecycle drives the existing forms, with truthful saved/active/restart and confirmation state. No false Saved or plausible corruption defaults.

### W2 — Connect Notifications to the durable inbox and commands

**Dependency:** W0; agreed Snooze contract for that callback.

Serve declared display facts required by `NotificationItem` from canonical linked run/workflow evidence. Preserve neutral trigger titles, pinned backfill gaps, publication identity, folded counts, independent read/snooze axes and exact actor/version basis. Unavailable target/context remains explicit; do not infer subject or detail from title text.

Make operator state changes use one guarded command path. Add agreed unsnooze semantics with replay/refusal behavior; retain low-level pinned/CAS assertions when consolidating test-only direct mutators. Preserve durable publication before external delivery and existing permission/locking/dedup behavior.

Replace `notificationsSample`/`updateNotification` in the producer. Keep `NotificationsView`, `NotificationPing`, filters, fixed bands, scrolling and focus return. Bind `onControl`, `onOpen` and `onEnable`. Existing desktop status text must receive truthful permission/delivery values; a missing visual state is separate design work.

**Units:** wire-to-view declared/missing context; pin under every filter; fold/read/snooze independence; stale command refusal; exact replay; unsnooze; duration/expiry; late target response; duplicate publication delivery; failed delivery leaves unread durable evidence in the service model.

**Outcome:** existing rows and controls consume real inbox state, target navigation and delivery results without local optimistic authority.

### W3 — Connect Activity metrics, ranges and both exports

**Dependency:** W0.

Map `ActivityReportSelection` into the existing `ActivitySummary`. Use served status/completion, durations, failures, evidence coverage, workflow labels, ledger and volume. Preserve current definitions: outcomes by run start date, measured terminal durations, confirmed transactions by receipt date, and the report timezone. Convert units/format values only; do not fabricate evidence or reinterpret totals.

Production uses `queryActivitySummaries`. Isolate the projector's alternate test/compatibility fold before retirement and preserve independent expected-metric assertions. Keep range/source generation/digest/expiry binding for CSV and existing XLSX export commands. An expired or process-invalid token requires a fresh report, not a latest-report substitution.

Replace the sample producer and callbacks; retain `ActivityView`, metric cards, range control, chart, tables and export menu. Production omits the optional sample selector. Refresh only on defined resource changes, coalescing notifications rather than refetching on every unrelated event.

**Units:** exact metric mapping; empty versus unavailable; measured zero; ms-to-seconds; terminal denominator; failure ordering; timezone/range identity; unchanged transaction boundary; selection tampering/expiry/generation; stale range responses; CSV/XLSX exact selected report/download validation; deterministic request-work bounds.

**Outcome:** the approved report displays authoritative data and both existing export choices download that same selection.

### W4 — Preserve the connected Archive and clarify its production API

**Dependency:** W0.

Keep `RuntimeArchiveWorkspace`, route-owned selection/folders, paging, retained fields and sticky section navigation. Preserve canonical membership, immutable saved reports, content-addressed resources and staged capture/verify/transfer/publish recovery.

Make production saved-report dependencies explicit. Isolate historical index/detail interpretation and old clients until generation/integrity/capture assertions transfer and endpoint retirement is approved. Do not mechanically delete historical tests or migrate data as a wiring side effect.

**Units:** page/filter/selection identity; late page/export settlements; failed read retains refusal and retry; frozen report with unavailable current workflow; exact run/digest/resource lease; corruption versus absent bytes; replayable lifecycle decisions using in-memory ports.

**Outcome:** the existing polished Archive remains connected with clear saved-report ownership and truthful loading/empty/refusal behavior.

### W5 — Connect Sessions to actual workers and guarded controls

**Dependency:** W0 and agreed Remove semantics.

Define backend display facts and availability from existing worker/pool/lease/current-run/browser projections. Join exact run/attempt and worker incarnation; retain node IDs/order. Separate declared systems, observed browsers, operational readiness, waiting reasons and OS process ownership. A persisted lease is not proof a restarted app owns a process.

Bind `SessionsView`/`SessionTimeline` through the existing producer. Bind Add workers to served workflow/pool planning and spawning; bind pause/resume/retry/stop to exact served command bases. Implement agreed Remove without changing peer workers or concealing stop uncertainty. Control availability/pending prevention may bind existing buttons; new visible affordances remain separate design work.

**Units:** exact lease/run/attempt joins; pool revision versus lease revision; absent/foreign browser evidence; waiting state; retained-plan/spawn mapping; unsupported controls; pending/uncertain command does not change confirmed worker state; confirmed idle retirement and peer isolation.

**Outcome:** real worker cards and existing controls are driven by authoritative state, with no simulated pause, stop, readiness or removal.

### W6 — Feed registered workflow definitions into ExplorerTimeline

**Dependency:** W0 and the current shared workflow structure contract.

Project registered definitions into the existing `FlowStep`/source/branch inputs. Preserve systems-first declaration order, named steps/substeps, branch/rejoin/parallel structure, field provenance and stable source identities. Use the existing source panel and disclosure/comment components. Do not restore the retired registered-definition renderer.

Current registered execution workflows and fictional Onboarding/Emergency Contact previews are distinct. Keep unimplemented examples explicitly preview-only until their workflow authoring is separately completed; do not manufacture executable registration. Retired scenario files remain unavailable metadata, not test evidence. No live-run overlay or expanded workflow authoring is included.

**Units:** descriptor-to-timeline literal mapping; systems-first order; stable step/field IDs; branch/rejoin/parallel paths; source refusal; descriptor-bound overrides; preview choice cannot claim an actual run outcome or command availability.

**Outcome:** existing ExplorerTimeline displays real registered definitions and truthful preview/source states while keeping its approved layout and interactions.

### W7 — Finish Queue integration and cross-surface selection

**Dependency:** W0; after other accepted packages for the final cross-surface check.

Retain `QueuePanel`, cards, external selection marks, attempt dropdowns, pipelines and operation member tables. Use the current day projection/stream, shared counts/status and served action descriptors. Preserve exact logical-item/attempt selection, row versions, bounded resume/snapshot recovery and visible connection refusal.

Verify navigation from Notifications and selection consumed by Sessions/Archive without a second status authority or duplicate subscription. Logs receives only its existing selection boundary; its producer remains with the Logs owner. Run/Rerun modal design and wiring are excluded.

**Units:** served row/status/count mapping; attempt/operation member selection; A → B → A day isolation; duplicate replay/reset model; stale row command refusal and exact replay; bulk selection retains refused members; cross-surface navigation selects the exact target.

**Outcome:** the existing Queue remains authoritative and the seven surfaces share correct identities and navigation without redesign.

## Launch prompts

Each prompt implements one package only after its prerequisites and decisions are accepted. Copy the common preamble plus the selected package text. These are proposed prompts, not authorization to launch.

### Common preamble

```text
Work in /Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend.
Use Heavy route only, directly following ~/.codex/codex_workflow/heavy_route.md.
Do not use Astra orchestrator, Luna-worker, or other worker-adapter skills.
Read current instructions, docs/README.md,
docs/rebuild/plans/phase-3/backend-and-unit-tests.md, and
docs/rebuild/plans/phase-3/dashboard-surface-wiring.md. Verify current HEAD,
ownership, peer changes, accepted prerequisites, and the exact package below.
The approved presentation source is /Users/julianhein/.codex/worktrees/b6c7/hr-automation-rebuild;
verify its current accepted candidate rather than assuming the planning hash remains current.
Use /ui's existing-consumer wiring route for renderer work. Preserve existing
components and layout. New visible components/states belong to separate operator
design work. Do not substitute retired connected renderers or restore the catalog.
Include backend lifecycle/prerequisite fixes, adapters, callbacks, focused units,
scoped lint and affected static/generated/bundle repairs for this package.
Complex tests remain for later operator discussion. Preserve retained assertions.
Exclude Logs, Run/Rerun, spreadsheet redesign, live HR and Electron delivery.
Preserve peer edits. No push, automatic branch merge/cleanup, or next-package launch.
Record exact source/check evidence and remaining obligations at this package's owner.
```

### W0 prompt

```text
Execute W0 only: reconcile the selected approved presentation consumers with the
current backend layout under the operator's integration authorization. Preserve
peer Logs files and accepted retirements. Define the existing consumer input,
callback, selection and state contracts; wire authoritative shared context.
Do not rebuild the UI or claim a fixture is connected. Record design dependencies.
```

### W1 prompt

```text
Execute W1 only: fix shared virgin-versus-missing Settings admission; concentrate
explicit read/commit/reconcile ownership while preserving each authority and
kernel ordering. Connect the existing SettingsPage to truthful readback. Fix
provider response ordering and implement only the agreed superseded-save behavior.
Prove the public behavior with fixed clocks/in-memory ports/deferred promises.
```

### W2 prompt

```text
Execute W2 only: serve declared notification display facts and one-hour Snooze
with explicit Unsnooze, using the backend clock. Replace sample producers/callbacks behind
NotificationsView and NotificationPing. Preserve pin/fold/actor/revision/replay
and commit-before-delivery semantics. Bind target navigation and existing delivery
permission/status. Keep the popover, controls and focus behavior unchanged.
```

### W3 prompt

```text
Execute W3 only: map the served Activity selection into ActivityView; preserve
metric/evidence/timezone/ledger semantics. Wire the existing CSV and XLSX choices
to that exact selection. Isolate duplicate aggregation without losing independent
assertions. Prove empty/unknown, expiry, range races and download identity with units.
```

### W4 prompt

```text
Execute W4 only: retain the connected RuntimeArchiveWorkspace and clarify the
production saved-report API. Preserve membership, frozen content, file custody
and recovery. Isolate historical compatibility without deleting useful assertions
or migrating data. Prove paging, selection/export races and resource refusals.
```

### W5 prompt

```text
Execute W5 only: map actual worker/pool/run/browser facts
and command availability into SessionsView/SessionTimeline. Wire Add and existing
controls to guarded commands and readback. Remove retires the exact owned idle
worker and reduces that workflow's desired pool; keep its card until confirmation.
Preserve exact leases, process ownership, pending/unknown state and peer isolation;
never simulate control success.
```

### W6 prompt

```text
Execute W6 only: adapt registered workflow definitions into the existing
ExplorerTimeline, preserving systems-first order, sources, steps and branch
previews. Keep unimplemented examples preview-only and retired sources explicit.
Do not restore the old registered UI, author more workflows, or add a live overlay.
```

### W7 prompt

```text
Execute W7 only: preserve the connected QueuePanel and finish exact selection,
day/attempt isolation, served actions and cross-surface navigation. Use one day
resource/projection authority and bounded resume/reset behavior. Exclude Logs
producer changes and Run/Rerun modal work. Finish focused unit/lint/bundle evidence.
```

## Acceptance receipts

W0 is accepted under the operator's selected-presentation integration authorization. Append each package's accepted commit, exact checks/results,
contract decisions, surviving assertion mapping, preserved presentation source and deferred
obligations when that package is actually completed. Planning or unit-only evidence does not
prove live browser, storage, process, visual, or release acceptance.

### W0 acceptance — 2026-10-02

Deployment ID: `dashboard-consumer-w0-20261002`. The assigned worktree and branch are
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend` and
`codex/logs-backend`. Initial resumed HEAD was `43b03b6945e7505a67844071f618691e16c84365`;
the Logs peer then committed `0dff920a102186b3218dbf549b79003b9f3e458e` and recorded its
Phase 3 acceptance. That newer backend candidate is the W0 implementation entry. The peer owns
`backend-and-unit-tests.md`, the confirmed-action code and its acceptance records.

The selected presentation source remains `c3998ec263dc7e6bcb20470ab6a32d60a04eff23` on
`codex/activity-ui-polish` in `/Users/julianhein/.codex/worktrees/b6c7/hr-automation-rebuild`.
Its presentation amendment and `src/dashboard/PARITY.md` identify the approved consumers;
the untracked frontend-structure draft is outside implementation authority. Integration selects
consumer files and required dependencies, preserves the current backend layout and accepted
retirements, and does not merge the presentation branch or promote its samples to authority.

Evidence owner:
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/`.
The existing docs and this external evidence owner replace the absent `agent_docs/` framework,
as authorized by the backend initiative. Source provenance, consumer contracts, current checks,
design dependencies and the continuation point are recorded below.
W1–W7, browser/visual acceptance, complex tests, live HR, Electron delivery, push, branch merge
and worktree cleanup are outside this execution.

#### Consumer boundary established by W0

`DashboardApp` consumes `useConsumerAuthority` once. Bootstrap owns actor and clock;
the route owns the selected day and exact run; the existing day subscription owns rows,
counts, workers, pools and inbox updates. The common hook preserves those served references
and supplies the matching run resource. It does not add a backend route, second subscription,
fixture authority or panel-local day scan. App navigation and guarded command dispatch retain
callback ownership. A changed day, run or client creates a new run-read selection incarnation,
including A → B → A; a late response cannot paint an earlier selection before effects run.
Confirmed detail may remain visible during a refresh of that same selection.

| Approved consumer | Input, selection and callback contract | Production integration state |
| --- | --- | --- |
| `SettingsPage` | Served `storage`, `sections`, `workflowLabels`, `actorId`, `descriptorFingerprint`, `preflight`; route `section`; app-owned `onSection` and `onExitGuardChange`. Existing draft/loading/error/save states remain. | Current page preserved without catalog wiring. W1 owns lifecycle/readback and the unresolved superseded-save decision. |
| `NotificationsView` / `NotificationPing` | Item/pinned display facts, ready/loading/unavailable state, filter/open state; `onFilter`, `onOpenChange`, `onControl`, `onOpen`, `onEnable` and notice. Notification identity and target lookup remain authoritative; Ping receives one item and close/open callbacks. | Approved views imported; W2 producer binding remains pending. Existing connected bell is not evidence that these views are connected. |
| `ActivityView` | Report state, range/timezone/metrics/evidence/transactions/volume, selected range, Today and preset; `onPreset`, `onRange`, CSV/XLSX `onExport`, optional notice/sample slot. | Approved view imported; W3 report/export binding remains pending. Production must omit the sample slot. |
| `RuntimeArchiveWorkspace` | Exact route `selection`, `view`, `folder`, `browse`, `browseInvalid`, served `actorId` and saved version/group/report resources; `onBrowse`, `onSelection`, `onView`, `onFolder`. Loading/empty/error/retry and deletion states remain distinct. | Approved presentation reconciled into the connected workspace. W4 lifecycle/selection hardening remains pending. |
| `SessionsView` / `SessionTimeline` | Ready/loading/unavailable worker state, exact worker/node/browser inputs, workflows and open state; `onOpenChange`, `onControl`, `onAdd`. | Approved views imported; W5 display/availability/guarded-control binding remains pending. No local worker retirement or simulated control success was added. |
| `ExplorerTimeline` | Selected workflow/list, declared steps/fields/sources, scenario/path/stop position, summary/completion; `sourceFor`, `onScenario`, `onWorkflow`, `onMockChoice`, `onVersionRegistry`. Stable field/step identities own disclosure and focus. | Approved consumer imported; W6 registered-definition adapter remains pending. Current connected graph renderer is not a presentation substitute. |
| `QueuePanel` / `QueueRow` | Served rows/action descriptors, exact run/attempt selection, served clock and UI filter/sort/selection/wells; app-owned selection, navigation, command, bulk and member callbacks. | Approved item/attempt/member presentation reconciled into connected Queue. Existing keyboard/context-menu command doors and batch command model remain; approved Queue no longer invokes the app's `onSetBatchGrouping` presentation action. W7 final cross-surface binding remains pending. |

Design dependencies remain explicit: `ExplorerTimeline` always labels its content as mock/fictional
preview and has no asynchronous state; `SessionsView` lacks served pending/refusal availability
bindings; `ActivityView` retains its export-connection notice. The existing approved presentation
does not authorize new visible controls or states to solve those gaps. W2 must also reconcile
truthful delivery/permission, target and command availability with its existing notification
controls. These dependencies belong to the respective package and separate operator design work.

Implementation evidence is in
[consumer-contract.md](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/implementation/consumer-contract.md)
and [checks-and-limits.md](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/implementation/checks-and-limits.md).
Accepted local source candidate: `6ab7f06d2cf8792c330dbf1bcc212a38af4b8fdd`, comprising presentation
`3d0b0d17c325d3e984f26d5c520b1a9b77b76f20` and the shared authority/selection commit.
Independent verification returned PASS after the exact consumer inventory and evidence index were
corrected. The root accepts W0's assigned reconciliation and shared-authority outcome. At acceptance,
HEAD is `ec55babbab4a0443bcadc0de67a43405b87d99c1`; the intervening peer commit contains only
Phase 3 contract/acceptance documentation and preserves the verified code/test/configuration inputs.
No W1–W7 package has started.

#### W0 verification evidence

The independent verifier reproduced the accepted-entry compiler inputs from a disposable
`git archive` of `0dff920a102186b3218dbf549b79003b9f3e458e`, using the existing dependency tree.
The temporary source copy and dependency link were removed; no registered worktree, checkout
or branch changed. Baseline, implementation-final and fresh-candidate compiler logs are byte-identical:
SHA-256 `83537f16b9fb7a96ee266d671677d302aa02cec76a1b402f61a7722b5087eeee`.
Their 72 diagnostic paths, codes, messages and positions match. The intermediate implementation
`typecheck-current.log` contains 79 diagnostics and is WIP evidence, not a baseline or final result.

| Check and exact input evidence | Result on source candidate `6ab7f06` |
| --- | --- |
| `npm run test:unit --` the 12 actual paths printed in [focused-tests.log](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/verification/focused-tests.log) | 12 files, 93 cases passed. |
| `npx eslint` the 30 changed TS/TSX paths in [changed-path-manifest.tsv](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/implementation/changed-path-manifest.tsv), `--max-warnings 0` | Passed with zero warnings; [lint receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/verification/scoped-lint.log). |
| `npm run test:architecture --` the five actual paths printed in [dashboard-architecture.log](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/verification/dashboard-architecture.log) | 5 files, 21 cases passed. |
| `npm run web:build` | Passed; existing Vite chunk-size warning remains in [web-build.log](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/verification/web-build.log). |
| `npm run typecheck` on accepted entry and final source | Both exit 2 with identical 72 diagnostics; [exact comparison](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/verification/typecheck-diagnostic-comparison.txt) and [artifact hashes](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/verification/typecheck-artifact-hashes.txt). This repository gate remains failed. |
| Direct frontend static arm, 249 files | One unchanged `log-feed.tsx` finding, “image without explicit loading”; [receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/verification/frontend-static.log). |
| Aggregate guard manifest | 8 passes, one failure on unchanged peer Logs `browser-action-drain.ts` and `confirmed-action-publisher.ts`, “catch assigns a bare default”; [implementation receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/implementation/guard-manifest.log). |
| Accepted-entry-to-candidate whitespace, selected source and preservation checks | Whitespace passed; all 14 selected pure roots match after the two Activity import rewrites. All 31 candidate path hashes and 27 extant source hashes matched; [source comparison](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/verification/source-root-comparison.txt). |

The candidate adds three focused unit files and changes no retained test file, assertion, guard
membership, coverage floor or timeout. Existing Logs files, Settings, catalog/scenario/parity
retirements and peer documentation are preserved. Workflow/store declarations and generated-product
inputs are unchanged; this package performs no workflow or catalog regeneration.

Browser/visual, SQLite durability, process restart, actual SSE convergence, integration/performance,
full coverage, live HR and Electron acceptance remain unrun. The focused DOM checks do not establish
visual acceptance. Independent source verification found no production defect; the required
documentation inventory correction passed recheck in
[verification-report.md](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-consumer-w0/verification/verification-report.md).

Continuation: W0 is complete locally. The next feature package requires its own operator launch;
W1–W7 producer work and the named design dependencies are not implicitly authorized. No push,
branch merge, worktree cleanup, live HR operation, complex-suite execution or release admission
occurred. The failed repository gates remain failed and retain their separate owners.

### W1 verification and local acceptance — 2026-10-02

Deployment ID: `w1-settings-2026-10-02`. Scope is W1 only in the assigned
`hr-worktree-logs-backend` worktree on `codex/logs-backend`. Entry was
`9bbc323632784058fd1e7def7d72e47547f4935f`; accepted W0 `6ab7f06d2cf8792c330dbf1bcc212a38af4b8fdd`
and backend Phase 3 `0dff920a102186b3218dbf549b79003b9f3e458e` are ancestors.
The final independent candidate uses peer base `5e0f69ad19ceeec509321f5ee7b448e223c6859c`.
Accepted source commit: `5db5a75793ce4b274234028ab3aada9550f491cd`, parent
`547141a03ef457d04c537438314c3b61f1c08ce5`. D365 and this package's pending verification receipt
were committed together at `6dbcfee62168772b6783b2e6eb4f04c1e720aae3`. The [peer release record](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-settings-w1/commit/hold-release.md)
confirms the exact `compose.ts` patch release before source mutation. The existing project documents
and external evidence owner continue to replace the absent `agent_docs/` framework.

The approved presentation source was reverified at
`c3998ec263dc7e6bcb20470ab6a32d60a04eff23`, branch `codex/activity-ui-polish`, in
`/Users/julianhein/.codex/worktrees/b6c7/hr-automation-rebuild`. Its untracked structure draft
remains outside authority. W1 uses `/ui`'s existing-consumer wiring route: all six retained
Settings TSX files are byte-identical to W1 entry. Prior W0 differences from that presentation
source are recorded separately; W1 changes models and lifecycle wiring behind `SettingsPage`,
without changing its forms, layout or visible components.

#### Lifecycle and recovery delivered

`readSettings` owns genuine virgin admission and refuses a missing current row when ordinary
command/audit or advanced runtime history remains. It authenticates saved command and audit
identity. `readBootSettings` first consumes that ordinary read, then refuses absent active runtime
when a saved revision above 1 or snapshot history remains; it performs no replacement write.
Composition calls it inside the existing authority transaction. The runtime reader now accepts
caller-owned repositories, and configuration reads are explicit rather than transactional getters.

The command kernel retains validation, identity admission, independent private commit,
journal/application/audit/current/snapshot/activation, SQLite commit and provider-confirmation
ordering. Its ordinary snapshot read follows identity admission and precedes insertion of its own
journal row; exact replay does not repeat that new read. Ordinary authority remains atomic;
credentials and provider keys retain independent commit/reconciliation and uncertainty rules.
New-run selection consumes the active snapshot, while retained runs keep their original snapshot
and fingerprint checks.

Latest request and client-incarnation identity govern read settlements, including A → B → A,
stale provider success/failure and old command callbacks after reconnection. Composite readback
preserves the distinct ordinary, credential and provider identities. An opaque provider source
token cannot establish order by itself.

The operator ratified [D365](../../reference/clock-config-secrets.md#d365--accepted-settings-save-superseded-before-readback--2026-10-02):
authenticated accepted-but-superseded ordinary/provider saves clear submission uncertainty,
retain the draft for review and show current saved values through the existing conflict state.
They never automatically resubmit. Unresolved or mismatched evidence retains immutable exact-attempt
retry. Protected superseded behavior was not widened. D346's local authenticated credential/provider
display authority remains in force.

#### Exact source and verification evidence

Evidence owner:
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-settings-w1/`.
The [21-path ownership list](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-settings-w1/implementation/owned-paths-final.txt)
and [final candidate binding](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-settings-w1/verification-repair/candidate-binding.txt)
identify the inputs. The final owned-path manifest SHA-256 is
`291a2a09f7a4b2d8aba6cd481b2ecaff13c7ba4d112efecdc3db7a6891e329dc`.
The sole intended composition patch is
[compose-settings-boot-read.patch](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-settings-w1/repair/compose-settings-boot-read.patch),
SHA-256 `4c97425e1c8f7326d19948fe43b79c3cb4dfcb4213c627e0fc92b27a2ea3a8a0`;
its candidate `compose.ts` is `f75cea1d8929377b788906ec20e3af4671a750ad1061849dca24214c862b7f3c`.
Earlier guard-deletion patches are superseded and are not acceptance inputs. Peer commit
`529e42d9a2c04781e13109e9a73dd2ba98f98b29` restored guards inadvertently included in an earlier
peer commit before the repaired candidate was verified.

Independent W1-V3 returned scoped PASS on the final frozen candidate; its
[report](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-settings-w1/verification-repair/report.md)
and [exact commands](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-settings-w1/verification-repair/commands.txt)
bind results and limits. The [source commit receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-settings-w1/commit/commit-receipt.md)
records exact 21-path commitment, matching committed/indexed candidate hashes and passed whitespace
checks. The intervening base changes were the D365 documentation and two peer-owned Logs stream
paths; none overlaps W1's source inputs. The [peer preservation record](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-settings-w1/commit/peer-preservation.txt)
records unchanged index/worktree hashes for all four captured peer-dirty paths. Tests were not
rerun for the identical W1 inputs; these receipts do not certify the advanced shared branch's
broader gates. The focused unit command was:

```sh
npm run test:unit -- tests/unit/dashboard/surfaces/settings-command-transaction.test.ts tests/unit/dashboard/surfaces/settings-lifecycle.test.ts tests/unit/dashboard/surfaces/settings-read-order.test.ts tests/unit/backend/app/config/resolve/settings-catalog-projection.test.ts tests/unit/backend/app/config/resolve/settings-facts.test.ts tests/unit/dashboard/client/index/settings-editor-surface.test.ts
```

| Check | Final W1 evidence and outcome |
| --- | --- |
| Focused public-behavior units above | 6 files, 55 cases passed with fixed clocks/IDs, in-memory ports and deferred promises. Real kernel tests cover first save, replay, stale/missing refusal, ordinary rollback and independent private-store uncertainty. Boot-reader tests prove refusal and zero replacement writes through in-memory repositories. |
| Scoped ESLint, `--max-warnings 0` | All owned TS/TSX paths passed before repair; the three repaired inputs passed fresh lint. Unchanged inputs are hash-bound in the final candidate. |
| `npm run build:manifest:check`; `npm run stores:catalog:check` | Both passed. No generated workflow/store input changed. |
| `npm run web:build` | Passed; Vite's existing >500 kB chunk advisory remains. |
| `npm run test:architecture -- tests/architecture/runs/control-command-single-path.test.ts tests/architecture/storage/sqlite-settings-authority.test.ts` | Failed: 10 passed, 2 failed. The existing relocation restore command-audit access and synthetic retired-module negative-control failure were reproduced from immutable W1 entry. Neither assertion nor failure is waived. |
| `npm run typecheck` | Failed, exit 2, 58 unique normalized diagnostics on the frozen independent candidate based on `5e0f69a`. No added W1-attributable diagnostic. Two additions versus the earlier repaired candidate are peer-owned Logs-test TS18048 errors for `item.event` and `secondBatch.event`. This gate was not rerun after the peer's stream repair; the advanced shared branch is not certified. |

Retained test membership, assertions, isolation, coverage floors and timeouts remain.
The six mechanically adapted retained files keep their respective test/assertion counts:
12/50, 14/68, 33/214, 3/24, 3/16 and 62/483. Their
[preservation evidence](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-settings-w1/verification-repair/retained-input-checks.txt)
also binds the six unchanged Settings TSX inputs. Integration fixtures were adapted only for the
explicit API and were not executed. No guard membership was added or retired.

#### Remaining obligations and continuation

The in-memory unit proof does not prove disk atomicity, process boot or restart. Full boot,
integration/durability, actual SSE convergence, browser/visual, performance, coverage, OS delivery,
live HR and Electron checks remain unrun for later operator discussion. Failed architecture and
typecheck gates retain their separate owners and must pass at their required broader gate.
No catalog, retired renderer or retired scenario/parity suite was restored.

W1 is complete and accepted locally for its assigned implementation, focused verification and exact
source commitment. W2–W7 remain unlaunched and require separate operator launch.
No push, branch merge, worktree cleanup, live operation or release admission is authorized here.
