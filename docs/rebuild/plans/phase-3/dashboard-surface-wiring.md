# Existing dashboard components: backend lifecycle and wiring plan

Status: W0, W1 and W2 accepted locally on 2026-10-02. W3–W7 remain proposed and unlaunched. Remove, Snooze and superseded Settings save meanings below are operator-approved.

This is supporting, unnumbered work for the [backend and unit-test initiative](backend-and-unit-tests.md). That plan continues to own the confirmed Logs contract and its Phases 3–5. This document owns the Settings, Notifications, Activity, Archive, Sessions, Explorer, and Queue wiring packages, and schedules the existing Phase 5 deliverable once as W8. It does not create a second Logs implementation or assign roadmap task numbers or grant release, freeze, cutover, or Electron admission.

Scheduling amendment — 2026-10-02: the operator deferred standalone Logs Phase 5 and included its delivery as the final W8 package. W8 has not been launched. Existing W0–W7 source/check receipts retain their original scope.

Toast follow-up — 2026-10-03: the operator launched W2a after accepted W2 and confirmed the compact-chip design and the event policies recorded below. Its execution receipt owns source/check acceptance and unresolved choices. The operator's ask-before-assuming rule applies to W2a and every later W package.

## Outcome and constraints

Connect the approved components to authoritative backend data and commands while making each backend feature's saved-state and recovery lifecycle straightforward to follow.

- Preserve the existing components, layout, typography, colors, navigation, disclosures, charts, tables, and keyboard behavior.
- Change producers, typed models, resource hooks, adapters, and callbacks. Existing elements may receive real values and command availability; their presentation is not redesigned.
- Do not introduce new visual components during wiring. A missing visible state, control, or component becomes separate operator design work before that dependent part proceeds. Do not use misleading existing states to conceal a gap.
- Backend owners classify business state, availability, identity, results, and confirmation. The renderer formats and presents served facts and manages local interaction state.
- Preserve ordinary settings, private credentials, provider keys, run snapshots, archive custody, worker leases, and process ownership as distinct authorities where their lifecycles differ.
- Use the existing TypeScript/Hono/SQLite/client/HTTP/SSE architecture. Do not add a distributed service, second queue authority, per-panel whole-day polling, or generic service framework.
- Use focused unit tests, scoped lint, and affected static/generated/bundle checks. Complex test design and execution remain for later operator discussion. Preserve retained assertions and test membership; do not restore retired parity/scenario suites.
- W0–W7 exclude Logs producer changes; W8 alone consumes the existing Logs Phase 5 scope. Run/Rerun design, spreadsheet import redesign, broad workflow migration, live HR actions, Electron packaging, and unrelated repository cleanup remain excluded.

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

For every feature when its callback wiring is admitted, inspect the approved mock's actual interaction handlers and record pending, accepted, refused and uncertain outcomes, modal dismissal, feedback text and navigation. Temporary action toasts use the existing toast system and authenticated command results. Durable inbox alerts use declared backend triggers and the shared inbox. A button click does not itself prove success or require a persistent alert. For the operator's Start Run example, the desired accepted outcome is dismissal plus a truthful queued/accepted toast; its concrete Run/Rerun callback wiring remains with that later design and implementation assignment. Do not infer this behavior from button labels or notification event types alone.

**Operator rule — applies to all later W packages:** a mocked toast does not specify notification-panel membership. Before wiring or changing any event whose toast/panel behavior the operator has not explicitly settled, ask the operator and wait for the answer for that event. Inspect the actual mock; do not infer permission from its icon, text, severity, component presence, a suggested default or another event's rule. Group related questions where useful. Record each approved event's toast, durable-panel and target behavior at the existing owner; ratify material contract changes at the owning reference and decision index together. Preserve current accepted behavior while a change is unresolved, and continue independent approved work. Do not silently implement a proposed policy or treat elapsed time as an answer.

Future workflow/system modules reuse the existing declared notification triggers and observation seams for canonical run failure, gate, parked-write and verified-completion facts. A genuinely new alert requires an explicitly owned trigger, display/target policy and deduplication tests. Preserve the separation between temporary action feedback, durable inbox history and desktop delivery. Do not add an arbitrary text publisher or make feature completion depend on successful notification delivery. These future extension rules do not broaden earlier acceptance receipts.

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

Labels W0–W8 are local package labels only. Default order follows the operator's requested surface order, with the deferred Logs connection last in W8. After W0, backend-only prerequisites in separate modules may run alongside Logs infrastructure only with disjoint ownership; final consumer integration remains coordinated.

W2a is a bounded follow-up to W2, not a renumbering of W3–W8. Its shared feedback policy precedes later callback wiring. Later packages bind their own feature callbacks to that policy; excluded Run/Rerun and spreadsheet features retain their separate design/implementation admission.

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

### W2a — Wire approved toast feedback and decide notification-panel membership

**Dependency:** accepted W2; exact approved mock/component provenance; explicit per-event routing decisions before dependent implementation. This follow-up preserves W2's accepted source/check receipt and does not broaden it retroactively.

Inventory actual mock handlers and current production call sites. For each event record its source, confirmation condition, toast component/copy/tone/action, dismissal timing, panel membership, canonical target, duplicate identity and owning feature. Distinguish a request accepted/queued from an actually running or completed workflow. Do not scan a toast's text to decide whether to create a notification row.

| Event | In-app toast | Notification panel | Decision status |
| --- | --- | --- | --- |
| Run request accepted / run started | Yes; wording must match the confirmed backend state | No | Operator-specified; the Start Run example closes its modal after acceptance. Its feature callback remains deferred to Run/Rerun admission. |
| Run failed | Approved compact-chip popup | Yes | Operator confirmed panel + compact-chip popup on 2026-10-03. Reuse the approved danger state; do not recolor the fixed green completion Ping. |
| Subject mismatch | Separate approved compact-chip popup | Yes | Operator confirmed panel + a separate popup on 2026-10-03; the related failed-run popup remains a distinct intended event. |
| Repeating failure | Approved compact-chip popup | Yes | Operator confirmed panel + popup on 2026-10-03. |
| Verified run completion | Approved compact-chip popup | Yes | Operator confirmed panel + popup on 2026-10-03; replace the green Ping producer with the approved compact chip. |
| Operator gate opened / write parked / storage health | Approved compact-chip popup | Yes | Operator confirmed panel + popup for each declared event kind on 2026-10-03, including all listed storage concerns. This does not revive absent publishers. |
| Notification-history gap | Approved compact-chip popup | Pinned | Operator confirmed pinned panel + popup on 2026-10-03; permanent retention and immutable pin remain. |
| Settings save confirmed by matching command result and authoritative readback: ordinary settings, protected credentials, provider keys | Approved compact chip plus existing inline Saved / Already saved | No new alert | Operator confirmed all three save paths on 2026-10-03. This confirms persistence, not activation readiness. |
| Notification Read, Unread, Snooze and Unsnooze confirmed | Approved compact-chip acknowledgement | No new alert | Operator confirmed all four controls on 2026-10-03; the existing row state changes remain authoritative. |
| Notification-control server refusal / revision conflict | Approved compact chip plus current notice | No new alert | Operator confirmed on 2026-10-03. |
| Notification-control result unknown after dispatch | Truthful approved compact chip plus current notice | No new alert | Operator confirmed on 2026-10-03; do not claim no effect or automatically retry. |
| Settings server refusal / revision conflict | Approved compact-chip-only feedback; no inline command-refusal message | No new alert | Operator confirmed chip-only Settings refusals on 2026-10-03; existing draft, authority and recovery controls remain. Binding verification is recorded in the continuation below. |
| Unconfirmed / unknown Settings result | Truthful approved compact chip plus existing recovery warning | No new alert | Operator confirmed on 2026-10-03; preserve recovery controls and do not claim saved, failed or no effect. Binding verification is recorded in the continuation below. |
| Other mocked feedback: general commands, identity / Park resolution, export, worker controls, archive actions, intake/import or later features | Ask before changing each actual unsettled event | Ask before changing membership | No blanket policy. Existing accepted behavior is preserved; later-feature callbacks remain with their owners. |

Use one explicit, tested feedback policy for declared event kinds and confirmed command/publication results. Temporary action feedback stays transient and does not automatically create an inbox record. Persistent alerts are derived/published by the existing backend notification owner, committed before delivery and served through the existing day resource. Keep command-attempt and notification-publication identities distinct so a local response and later stream event do not produce two copies of the same intended feedback.

Reuse the exact approved toast presentation and existing provider infrastructure. Verify which mock renderer owns the approved appearance: the existing DS Toast supports four tones, whereas `NotificationPing` is fixed to a positive completion state. Do not substitute an older renderer, recolor the green Ping, extract a new visible component or invent error/loading/action states without the operator's design decision. Preserve existing dismissal, focus, keyboard and overlay behavior.

Bind approved, already-admitted operation callbacks, keeping authoritative acceptance/refusal/uncertainty results. Leave unstarted feature callbacks to their W package; leave Start/Rerun and spreadsheet actions to their separately admitted work. Backend failure/gate/storage/completion events use the shared inbox and explicit delivery policy. Document how a new system/workflow supplies canonical state or a declared typed trigger; it does not need a separate toast store or an arbitrary text publisher.

**Units:** confirmed versus refused/unknown action feedback; exactly-once callback/dismissal for a bound accepted command; toast-only events produce no inbox publication; durable events retain their row if popup delivery fails; duplicate result/publication/reconnect isolation; stale actor/run/attempt responses; pure policy rejection for unregistered event kinds; existing supported toast dismiss/action behavior. Use fixed IDs/clocks, controlled promises and in-memory ports. Run focused units, lint and affected static/generated/bundle checks; complex/live/visual checks remain deferred.

**Outcome:** the approved toast renderer is driven by real results for the admitted bindings, and every implemented event has an operator-approved toast/panel policy. The receipt lists unresolved decisions, deferred design states and later feature bindings explicitly. A policy inventory alone is not proof that every mock callback is connected.

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

**Operator scope addition — 2026-10-03:** improve the shared workflow-kit authoring/compiler seam so future registered definitions can feed the Explorer through the same validated projection. Keep ordered declarations and typed dependency references authoritative; avoid per-workflow renderer branches or a second hand-maintained workflow graph. This addition does not authorize authoring new workflows, changing execution policy, a live overlay, or new visible components/states.

**Operator presentation clarification — 2026-10-03:** input-prop wiring is allowed. The operator subsequently allowed adding/removing component instances and editing layout while reusing the same existing component set and design. Existing label slots distinguish registered definition/hypothetical previews from fictional examples; no new component design is authorized. For definitions without decision choices, omit the existing Preview paths control rather than inventing a jump target. Definitions with choices retain that control and their declared branch target. This supersedes the initial fixed-layout constraint only where W6 wiring requires it; it does not authorize an unrelated redesign.

Current registered execution workflows and fictional Onboarding/Emergency Contact previews are distinct. Keep unimplemented examples explicitly preview-only until their workflow authoring is separately completed; do not manufacture executable registration. Retired scenario files remain unavailable metadata, not test evidence. No live-run overlay or expanded workflow authoring is included.

**Units:** descriptor-to-timeline literal mapping; systems-first order; stable step/field IDs; branch/rejoin/parallel paths; source refusal; descriptor-bound overrides; preview choice cannot claim an actual run outcome or command availability.

**Outcome:** existing ExplorerTimeline displays real registered definitions and truthful preview/source states using the approved component design and interactions, with the operator-authorized instance/layout adjustments.

**Execution state — 2026-10-03:** the root accepts the focused W6 source candidate `2bf4ccaa7628679c3670cc848dd4d672c3f9124e` under deployment ID `w6-explorer-20261003` in the assigned `codex/logs-backend` worktree. Entry was `32c608c542741d7acecc8c43512a4756318821cd`; accepted W0 `6ab7f06d2cf8792c330dbf1bcc212a38af4b8fdd` is an ancestor. Peer source advances through `1db0e1b363dacd82ee56386d427e77814868660b` precede the isolated W6 range. The existing documentation/evidence exception for absent `agent_docs/` remains accepted. The receipt below owns source provenance, checks, operator answers and remaining obligations. Contract/authoring documentation and the isolated documentation commit complete this package's local handoff; branch integration, push, cleanup and subsequent packages remain operator-owned and were not authorized here.

### W7 — Finish Queue integration and cross-surface selection

**Dependency:** W0; after other accepted packages for the final cross-surface check.

Retain `QueuePanel`, cards, external selection marks, attempt dropdowns, pipelines and operation member tables. Use the current day projection/stream, shared counts/status and served action descriptors. Preserve exact logical-item/attempt selection, row versions, bounded resume/snapshot recovery and visible connection refusal.

Verify navigation from Notifications and selection consumed by Sessions/Archive without a second status authority or duplicate subscription. Logs receives only its existing selection boundary; its producer remains with the Logs owner. Run/Rerun modal design and wiring are excluded.

**Units:** served row/status/count mapping; attempt/operation member selection; A → B → A day isolation; duplicate replay/reset model; stale row command refusal and exact replay; bulk selection retains refused members; cross-surface navigation selects the exact target.

**Outcome:** the existing Queue remains authoritative and the seven surfaces share correct identities and navigation without redesign.

### W8 — Connect the approved Logs surface after the other wiring packages

**Dependency:** accepted Logs Phase 4, W0 and the accepted W1–W7 consumer/selection boundaries. This is the operator-deferred [Phase 5 deliverable](backend-and-unit-tests.md#phase-5--serve-the-approved-logs-ui-with-step-results-and-captures), executed once through this package. Do not launch it as a separate concurrent Phase 5 task.

Connect the existing approved `LogFeed` to confirmed actions, backend-selected concise results, system labels, timestamps, step grouping, paged history and the resumable live stream. Capture while the exact step page/session lease is owned and attach guarded artifact metadata once at that step end. Preserve detailed traces, truthful legacy records, failed/absent capture, deduplication and isolation from late run/attempt responses. Preserve all approved presentation; missing visible states remain separate operator design work.

**Units:** the existing Phase 5 projection/adapter/component scope, including result selection, action timestamps, systems, step/capture identity, old records, paged/live duplication and late selection responses. Run focused units, lint and affected static/generated/bundle checks. Provide synthetic served payloads; live capture, visual behavior and complex tests remain deferred.

**Outcome:** backend data drives the existing Logs renderer through the real client adapter and shared selection, completing the scheduled surface wiring scope. This does not prove live HR, complete workflow migration or release acceptance. Record its single source/check receipt here and link it from the original Phase 5 owner.

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
For any mocked toast with unspecified toast/panel behavior, ask me before wiring
that event. Do not infer its notification-panel membership or choose a default.
Preserve settled decisions; record my answers and continue independent approved work.
For W0–W7 exclude Logs producer work. W8 alone executes the deferred Phase 5 scope.
Exclude Run/Rerun, spreadsheet redesign, live HR and Electron delivery.
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

### W2a follow-up prompt

```text
Execute W2a only after accepted W2: inventory the approved mocked toast components
and actual event callbacks, then connect approved feedback for admitted features.
Run accepted/started is toast-only. Failed runs appear in the notification panel;
ask me about their in-app popup and approved visual state. For every other event
whose toast/panel behavior I have not specified, ask me and wait before wiring
that event. Do not infer membership from a mock or silently choose a default.
Preserve current accepted behavior while a proposed change is unresolved.
Record each event's confirmed source, toast/panel policy, target, dismissal and
dedup identity. Reuse the exact approved toast design/provider. A missing tone or
visible state is separate operator design work, not permission to redesign.
Use canonical backend notification publication for persistent alerts and confirmed
command results for local feedback; do not persist all toast text or add a second
inbox. Prevent duplicate response/stream/replay feedback and preserve truthful
refusal/unknown outcomes, stale-selection isolation and commit-before-delivery.
Bind only already-admitted features; later Ws bind their own callbacks. Run/Rerun
and spreadsheet design/implementation remain deferred to their owners.
Add focused public policy/controller/adapter units, lint and affected static/
generated/bundle checks. No complex/live/visual tests. Record approved policies
and source/check evidence at the existing owners. No push, merge, peer cleanup
or next-package launch. Do not claim unbound mocks or unresolved events completed.
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

### W8 prompt

```text
Execute W8 only after accepted Logs Phase 4 and W0–W7 boundaries: consume the
existing Phase 5 scope in backend-and-unit-tests.md. Read the approved Logs
handoff and verify current UI ancestry. Connect LogFeed to served confirmed
facts/results and paged/live history; bind explicit step-end captures through
the guarded artifact path. Preserve design, detailed traces, unknowns and exact
run/attempt/session/step identity. Finish focused projection/adapter/wiring units,
lint and affected static/generated/bundle checks; provide synthetic payloads.
No complex/live/visual test execution or broad workflow migration. Record one W8
acceptance receipt here and its pointer at the original Phase 5 owner. Do not
launch another Phase 5 task, merge, push or start the next assignment.
```

## Acceptance receipts

W0 is accepted under the operator's selected-presentation integration authorization. Append each package's accepted commit, exact checks/results,
contract decisions, surviving assertion mapping, preserved presentation source and deferred
obligations when that package is actually completed. Planning or unit-only evidence does not
prove live browser, storage, process, visual, or release acceptance.

### W6 acceptance — 2026-10-03

The accepted local implementation range is `1db0e1b363dacd82ee56386d427e77814868660b..2bf4ccaa7628679c3670cc848dd4d672c3f9124e`: feature `5b1e1d4c39e89e445378004e19b6be38bb2c867c`, affected guard repair `43925f1162d1ef28d35f0a107304ab821da030fd`, and preview/proof repair `2bf4ccaa7628679c3670cc848dd4d672c3f9124e`. The complete 17-path source inventory is [candidate-sha256.txt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-03/dashboard-explorer-w6/implementation/candidate-sha256.txt), aggregate SHA-256 `53c75d85b16cbafe4b9650e801f720280c7622aad62af243f048a75bfe0dc5b2`. Exact-path commits exclude peer source and documentation edits. No branch integration, push or cleanup was performed.

The approved presentation checkout `/Users/julianhein/.codex/worktrees/b6c7/hr-automation-rebuild` was reverified at `2d2dd9c6a6ca38980da2f59be79c1b53a9a182fc`. Its five selected Explorer consumers retain the W0 selected source bytes from `3d0b0d17c325d3e984f26d5c520b1a9b77b76f20`; this is a content comparison, not an ancestry claim. Its 167-line `explorer-mock-fixtures.ts` was copied byte-identically with SHA-256 `a32410b54ad57d4d83b37f4fa873b6f6a5aff7a6f1665d8a504f7514a2003983`. Onboarding and Emergency Contact preserve their steps, sources, typed choices and preview-only identities. Fictional Separations is excluded from the workflow rail and does not substitute for the registered definition.

`workflowExplorerDeclaration` derives ordered groups, entries, node/task identities and typed dependencies from the compiled definition. The producer validates definition/descriptor identity, timeline order/content and complete graph coverage, then serves a closed compiled/unavailable `definitionPreview` and systems in first-use order. Future compiled workflows use that shared projection without an Explorer renderer map. The adapter preserves declared steps, branch/parallel/rejoin facts, stable field/source IDs and hypothetical choices. Values remain declaration-only; an operation source jump requires one exact displayed producer. Missing, ambiguous and retired sources stay explicit. Both current registered execution workflows retain legacy operation capability because they do not declare complete operation display; the adapter does not invent action detail. Generic complete-operation behavior is proven synthetically, not by live workflow acceptance.

The existing `ExplorerTimeline`, source panel, disclosure/comment and design-system components drive the surface. The operator approved input-prop wiring and subsequently allowed adding/removing component instances and editing layout using those same components. Registered slots say “Definition preview” and “Registered workflow · hypothetical preview”; fictional labels remain unchanged. Branchless definitions omit Preview paths; declared choices retain their exact jump target. Loading, failure, missing selection and unavailable definition use existing components. Workflow selection and Version registry callbacks are connected; Version registry opens Archive Versions. No new Explorer toast event or notification-panel policy was introduced. The retired registered renderer/catalog, new executable workflows, live overlays, Logs producers, Run/Rerun, spreadsheets, live HR and Electron remain excluded.

Independent W6-R1 review returned PASS for all 17 candidate paths. Independent W6-T1 verification reproduced the focused checks at the same commit and confirmed unchanged source hashes before/after. Exact commands and receipts are in [verification/receipt.md](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-03/dashboard-explorer-w6/verification/receipt.md):

| Check | Result |
| --- | --- |
| `npm run test -- --project unit` with the four named compiler/query/preview-model/preview-host files | 44/44 passed |
| `npm run test -- --project architecture` with compile-integrity, authoring-budget, wire-boundary and refresh-boundary files | 61/61 passed |
| `npx eslint` on all 16 changed TypeScript/TSX source/test files, `--max-warnings 0` | Passed |
| `npm run build:manifest:check`; `npm run stores:catalog:check` | Current |
| `npm run web:build`; source `git diff --check` | Passed; bundle chunk-size advisory only |

Retained compiler/query and guard assertions, negative controls, test membership, coverage floors and timeouts were preserved. New literal assertions cover declaration order/identities, descriptor-definition refusal, complete/legacy action facts, exact/zero/multiple source anchors, branch/parallel choices and headless/mixed systems. Host assertions cover fictional source/choice behavior, workflow and Version registry callbacks, fictional A→B→A reset and earlier-client late-response isolation. Registered selection uses the same component key `${workflowId}:${descriptorHash}`; there is no dedicated registered A→B→A host assertion. The authoring-budget repair changes only stale retired fixture exemptions/current harness and backend paths, with its inventory hash updated; no predicate or assertion was weakened.

Remaining obligations: root typecheck stays red with 72 diagnostic lines across 22 files (56 normalized unique), byte-identical baseline/final, none on W6 paths. The independent guard-manifest rerun has 7 passes and 2 failures in peer Logs/Settings catch-default/reviewed-source checks, outside this candidate. Those owners and phase exit retain repair authority; W6 does not claim a green full repository. A mistaken first verifier command broadened the unit selection; its failing receipt is retained and excluded from this verdict. Only the corrected focused command supports W6 acceptance. Browser/visual, complex tests, full coverage and phase-exit gates, live operation display, controlled writes, release acceptance, integration, push and cleanup remain unrun. Logs production stays with W8. No sibling or next package was launched.

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

### W2 execution — 2026-10-02

Deployment ID: `w2-notifications-20261002`. The operator authorized W2 only in
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend`, branch
`codex/logs-backend`, entry `257ffefac39eaaa5cd77f05aeb0e7de58ee9c502`.
The scope is canonical notification display facts, backend-clock one-hour Snooze, explicit
Unsnooze, and the existing `NotificationsView` / `NotificationPing` producer and callback wiring.
The approved components, popover, controls and focus behavior remain the presentation boundary.
Existing project documents and external evidence replace the absent `agent_docs/` framework.

Evidence owner:
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-notifications-w2/`.

Entry ownership and prerequisite verification passed. W0
`6ab7f06d2cf8792c330dbf1bcc212a38af4b8fdd` and the accepted backend Phase 3 candidate
`0dff920a102186b3218dbf549b79003b9f3e458e` are ancestors of the entry. W1
`5db5a75793ce4b274234028ab3aada9550f491cd` is also accepted locally, but is not a W2 dependency.
The four entry-dirty documents were peer-owned; no source was dirty. Concurrent Logs documentation
commit `cfed4196910c0f32ec8ac831aca1733d8ce54319` preserved the W2 documentation hunks.

The presentation checkout was reverified at
`e25275f04e71517431503d6c94955daeed183c32`, branch `codex/run-rerun-spreadsheets`.
Its accepted `notifications-view.tsx` and `notifications-view-model.ts` remained byte-identical to
`c3998ec263dc7e6bcb20470ab6a32d60a04eff23`, W0 and the backend entry. Their SHA-256 values were
`c49b6c0485a122a74436d15d1f7f23ab2bfb751c7f400d7ead4ec6f40fe1e349` and
`9e2b3ccbae11286496d6f2b1fa28d855173f0dacabda3d46de87e167938a7bf8`, respectively.
Unrelated dirty presentation work was excluded.

**Accepted source:** `230f394a63d0ae0a41b6f504c59b9b1059344b8a` and repair
`4ffd665fe7b9a3f626a6772d68d4a8a7c849ef44`, totaling 45 source/test paths. The initial 35-path
manifest is `implementation/owned-path-manifest.sha256`; the 13-path repair manifest is
`repair/repair-manifest.sha256` (file SHA-256
`285b80c11b21d65a25f45d5e3ffec896aa6de59d3542bccd117d6651c7f0f082`). Three paths overlap.
The [source commit receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-notifications-w2/commit/w2-g2-git-commit-receipt.md)
and [repair commit receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-notifications-w2/commit/W2-G3-repair-commit.md)
bind exact paths, byte hashes, parentage and preservation of the four documentation edits.

The production adapter mounts the approved consumers with served display facts, guarded controls,
current target navigation and existing desktop permission/status delivery. The day resource owns
expiry refresh. Read/unread and Snooze are independent; pin/fold, actor/revision, publication identity,
exact replay and commit-before-delivery remain authoritative. Pre-W2 deadline-bearing journal/audit
rows use frozen historical read schemas. Their authenticated exact completed replay returns the
retained `already-applied` outcome without writes or recalculating the deadline. Unknown, pending,
divergent or wrong-actor old envelopes refuse; new Snoozes reject `payload.until` and derive one hour
from the backend clock. Settings navigation cancellation and late A → B → A responses remain guarded.

**Focused acceptance:** independent [source review](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-notifications-w2/review/W2-R1-final.md)
and [repair verification](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-notifications-w2/verification-repair/W2-V1-repair-report.md)
pass at the repaired source. Initial focused units passed 9 files / 29 cases; invalidated repair
units passed 4 files / 14 cases with no React `act(...)` warnings. Scoped lint passed for both
manifests. Notification durability passed 12 cases; the affected command-path case and strict-boundary
suite passed 1 and 7 cases respectively. Manifest/store-catalog checks and the web bundle passed
again after repair; the existing Vite chunk-size advisory remains. Unchanged-input evidence is reused
only for paths outside the repair. Assertions, membership, isolation, floors and timeouts remain.

**Remaining obligations:** typecheck is failed with 72 diagnostic lines byte-identical to entry.
The broad architecture selection retained the same 47 failing test names as entry (Archive native
consumer fixtures and relocation audit reach); the repair did not rerun or waive that selection.
These failures are not accepted phase-exit evidence. Complex SQLite persistence/concurrency,
process/restart, real SSE/browser/OS delivery, visual parity, performance, full coverage and phase-exit
checks remain for their owners and later operator discussion. Focused in-memory ports do not prove
SQLite durability.

Archived, missing or incompatible linked context is explicitly unavailable. The fixed green
in-page `NotificationPing` presents real verified completion only; nonpositive in-page Ping states
need separate operator design. Existing OS Ping routing is unchanged and verified-done remains
inbox-only for OS delivery. No new component or visual state was introduced.

W2 is complete under this focused local acceptance. No release, freeze, cutover or Electron admission
is granted. Logs, Run/Rerun, spreadsheet redesign and live HR are outside this package. No push,
branch merge, worktree cleanup or subsequent package was authorized or launched; the operator owns
the next launch and later gate/design decisions.

## W2a execution receipt — 2026-10-03

Deployment ID: `w2a-feedback-20261002`. W2a's approved bindings are accepted locally after W2 at
`a2d9bc0b830106d032f0b44289dd205f8b02ff9b` in the same owned `codex/logs-backend`
worktree. The goal is approved feedback for admitted events through the existing toast provider
and canonical inbox. This receipt owns the current goal, decisions and continuation state;
the absent `agent_docs/` framework does not create a second documentation owner.

Independent inventory lanes W2A-E1 and W2A-E2 agree on the actual failed-run publisher, durable
panel row, missing in-app failed-run binding, and separate subject-mismatch publication. Their
source and callback evidence is retained at
[ui-mock.md](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-feedback-w2a/inventory/ui-mock.md)
and [callback-authority.md](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-feedback-w2a/inventory/callback-authority.md).
No checks or implementation claims come from those read-only inventories.

The approved presentation candidate was reverified at
`2d2dd9c6a6ca38980da2f59be79c1b53a9a182fc`. Its compact-chip `ToastProvider` /
`ToastViewport` / `ToastCard` lives in `src/dashboard/ds/primitives-overlay.tsx`, SHA-256
`aab66434a861abc0e923cd14d44c4a4f09155bb9196a926737b2d51679ec0bc4`.
The backend's older colored-rail variant is not the approved source. Presentation peer preview
files are preserved and excluded from approval evidence. Danger chips remain until manual
dismissal; expansion, action dismissal, focus restoration and overlay inert behavior come from
that exact approved implementation.

**Confirmed policies:** run accepted/started is toast-only, with its actual Run/Rerun callback
deferred to that owner. All eight declared backend kinds (`run-failed`, `subject-mismatch`,
`repeating-failure`, `verified-done`, `gate-opened`, `write-parked`, `storage-degraded` and
`backfill-gap`) are panel + compact-chip popup; backfill gaps retain their pinned rows.
The storage decision explicitly covers the declared disk-space, WAL-growth, integrity-check,
backup, stalled-lease and stalled-outbox concerns without admitting an absent or retired publisher.
Subject mismatch gets its own popup even when the same failure
also produces a failed-run popup. Completion replaces the green Ping producer. Canonical persistent alerts
commit before delivery. Local feedback requires a confirmed command result and does not publish
toast text to the inbox. Source occurrence, folded row, command attempt and wire publication
identities remain distinct.

**Confirmed local policies:** ordinary Settings, protected credential and provider-key saves get
a compact chip plus the existing inline Saved / Already saved status only after matching command
results and authoritative readback. Read, Unread, Snooze and Unsnooze get a compact-chip
acknowledgement after a matching applied result. Notification-control server refusal or revision
conflict and post-dispatch unknown outcomes get a truthful danger chip plus the current notice.
None of these local outcomes publishes a new panel alert.

| Implemented event | Confirmed source and policy | Target | Dismissal and feedback identity |
| --- | --- | --- | --- |
| `run-failed` | Canonical committed notification publication; panel + danger chip | Existing guarded failure lookup | Manual dismissal; actor-scoped notification publication ID. |
| `subject-mismatch` | Separate canonical publication; panel + separate danger chip | Existing guarded failure lookup | Manual dismissal; its own publication ID, even alongside a failed-run chip. |
| `repeating-failure` | Canonical threshold publication at the third distinct failure; panel + warning chip | Existing guarded failure lookup | Three seconds; its own publication ID. |
| `verified-done` | Canonical verified receipt publication; panel + success chip replacing the green in-app Ping producer | Existing guarded run lookup | Three seconds; publication ID. Existing OS delivery remains inbox-only. |
| `gate-opened` | Canonical gate publication; panel + warning chip | Existing guarded run lookup | Three seconds; publication ID. |
| `write-parked` | Canonical parked-write publication; panel + truthful danger chip | Existing guarded run lookup | Manual dismissal; publication ID. An unknown write is not a confirmed failure or no effect. |
| `storage-degraded` | Declared canonical storage publication; panel + warning chip | Existing guarded Storage lookup | Three seconds; publication ID. The policy does not admit an absent publisher. |
| `backfill-gap` | Explicit pinned-wire provenance; retained pinned panel warning + danger chip | None; no fabricated action | Manual chip dismissal; publication ID. Panel pin and retention remain immutable. |
| Ordinary Settings saved | Exact ordinary command result plus authoritative readback; success chip + inline status, no new panel alert | None | Three seconds; actor + save kind + command ID. |
| Protected credentials saved | Exact private-store command result plus authoritative readback; success chip + inline status, no new panel alert | None | Three seconds; actor + save kind + command ID; no private values in feedback. |
| Provider key saved | Exact provider command result plus authoritative readback, including bound pending recovery; success chip + inline status, no new panel alert | None | Three seconds; actor + save kind + command ID; no key values in feedback. |
| Read / Unread / Snooze / Unsnooze confirmed | Matching applied command ID and exact notification target; success acknowledgement, no new panel alert | Existing panel row; no new chip action | Three seconds; control scope + command ID + outcome. Stream state changes do not acknowledge the command again. |
| Notification-control refusal / conflict | Matching server refusal; danger chip + current notice, no new panel alert | Existing panel row; no new chip action | Manual dismissal; control scope + command ID + outcome. |
| Notification-control unknown | Post-dispatch rejection or mismatched result; truthful danger chip + current notice, no new panel alert | Existing panel row; no new chip action | Manual dismissal; control scope + command ID + outcome. No automatic retry or no-effect claim. |

The source-to-chip model accepts only declared kinds from canonical committed publication metadata.
It validates actor, row, trigger and dedupe fingerprint; legitimate older rows without metadata stay
explicitly unavailable. Initial snapshots, reconnects, replay, read-only revisions and active Snooze
do not redeliver chips. Actor, day, client, selection or unmount invalidation dismisses obsolete chips
and invalidates their actions. Existing target rechecks and the dirty-Settings navigation guard remain.
The exact provider controls expansion, focus, timers and action dismissal; its local sequential toast
ID is not a publication or command identity. Popup failure does not remove durable inbox evidence.

**Accepted source candidate:** `1db0e1b363dacd82ee56386d427e77814868660b`,
with local commits `7cf5255e0fecefff056d50a77cb84b6dd27e5525` (publication provenance and
approved toast source), `32c608c542741d7acecc8c43512a4756318821cd` (eight backend events),
`4d18b958a678570202d2f2997e2da6e716e0344b` (confirmed local feedback), and
`1db0e1b363dacd82ee56386d427e77814868660b` (test-only real-provider prerequisites).
The last repair preserves assertions, test membership, timers and timeouts. Source and scripts
trees and package/build inputs are unchanged by that repair. Concurrent W6 Explorer edits and the
two mixed peer plan files are preserved; verification uses a plain immutable Git export under the
existing evidence directory, without another worktree or repository.

The [read-only peer handoff audit](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-feedback-w2a/implementation/peer-handoff-audit.md)
observed combined HEAD `43925f1162d1ef28d35f0a107304ab821da030fd` on `codex/logs-backend`,
with a clean index. W2a candidate `1db0e1b36` is its ancestor. The subsequent Explorer and guard
commits touch 13 paths disjoint from all 31 W2a-owned source/test paths; every W2a path remains
byte-identical in the sealed candidate, combined HEAD and working tree. Further peer Explorer/test
edits and both plan modifications remain uncommitted. W2a checks bind to the sealed candidate;
this audit does not establish a passing gate for the combined peer tree.

**Policies and continuation:** unconfirmed / unknown Settings save outcomes are approved for a
truthful compact chip plus their current recovery warning. The operator has confirmed chip-only
Settings server refusal / revision-conflict feedback; its accepted binding is recorded in the
continuation below. Accepted-but-superseded saves retain their distinct existing conflict behavior.
General-command, identity / Park, export, worker, Archive, intake/import and other mock events were
inventoried in the evidence above but receive no new blanket policy or binding. Run accepted/started
is confirmed toast-only; its actual Run/Rerun callback remains deferred. Later Ws bind their own
callbacks. Unresolved events and unbound mocks are not completed.

W2A-X1's [implementation receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-feedback-w2a/implementation/W2A-X1-report.md)
and [repair provenance](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-feedback-w2a/implementation/repair-candidate-provenance.md)
record exact source/check inputs. [W2A-R1 review](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-feedback-w2a/review/W2A-R1.md)
finds no source blocker at the repaired candidate and confirms unchanged retained assertions,
membership, timers and timeouts. [W2A-V2 independent verification](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-feedback-w2a/verification-repair/W2A-V2.md)
passes on a fresh plain export of that exact commit:

- The 19-file focused unit selection passes **161/161** tests, including all seven real-provider
  Settings harnesses and the public notification policy/controller/adapters.
- The existing focused canonical notification-producer selection passes **16/16**, covering the
  five active storage concerns and confirming retired `outbox-stalled` remains unpublished. This
  is isolated producer evidence, not admission for a stalled-outbox publisher or complex/live work.
- Dashboard wire-boundary and notification-durability checks pass **20/20** across two files.
- Scoped ESLint passes over all 31 source/test paths changed from accepted W2.
- Fresh manifest and store-catalog checks pass; canonical `npm run web:build` passes. An exploratory
  build with an output-directory override failed the build-identity plugin's expected path and is
  not the accepted build command. No source/config repair or weakened check was used.
- Fresh `npm run typecheck` exits **2** with **72** diagnostics, byte-identical to the accepted W2
  baseline, SHA-256 `9db4ff998b0f734b42213d6921250f79f0c0dfc0107f1d214231b3044abb7a2c`.
  This gate remains failed and unwaived; no new compared diagnostic is present.

V2's source/config integrity comparison records 2,201 unchanged files plus the unchanged dependency
symlink and 45 expected build artifacts added in the export. No check ran in the mutable peer tree.
The earlier broad wire-connectivity selection retains 46 failing names among W2's 47 baseline
failures, and the unchanged command-result sibling selection retains 2 failures / 14 passes. Neither
is claimed passed. Source input equality permits attribution of earlier receipts, but V2 reran the
affected architecture, bundle and generated checks on the isolated candidate.

The [D366 notification policy](../../reference/dashboard-surfaces.md#w2a-feedback-policy-2026-10-03)
and decision index ratify the confirmed policies together. The
[documentation/generated check receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-02/dashboard-feedback-w2a/implementation/W2A-X1-docs-check-ready.md)
records exact W2a staging in the mixed plan and references, unique D366/anchors, passing staged
whitespace and affected roadmap checks, and 31 unchanged W2a source/test paths at combined HEAD
`2bf4ccaa7628679c3670cc848dd4d672c3f9124e`. The two dated historical notification claims required
regeneration of `docs/roadmap/index.html` from the isolated staged inputs. Its derived change is
limited to `p2-2g` wording; no node state, ownership, schedule or peer input changed. Peer plan and
decision-index hunks remain excluded from W2a staging.

The Settings continuation below records the final approved policies and accepted bindings. Later
owners' explicit feature admissions remain necessary; this acceptance does not complete deferred
events or unbound mocks. Complex persistence/restart/SSE,
live HR, browser/OS/visual/performance/full-coverage and phase-exit obligations remain deferred under
the existing cadence. No release, freeze, cutover or Electron admission is granted. Logs, Run/Rerun
and spreadsheet work remain excluded. No push, merge, peer cleanup or next-package launch was
authorized or performed.

### W2a Settings feedback continuation — 2026-10-03

Deployment ID: `w2a-settings-feedback-20261003`. The prior approved bindings and source/check receipt
above remain accepted. The operator confirmed chip-only Settings refusal feedback: definite server
refusals and revision conflicts use the existing compact danger chip, with no inline command-refusal
message or new inbox alert. Drafts, read/authority signals, recovery controls, exact-attempt semantics
and accepted-but-superseded behavior remain distinct. Pre-dispatch field validation does not gain a
blanket toast policy. No command outcome is inferred from its displayed text.

**Accepted source:** W2AS-X1's initial ten-path Settings change is
`6e7c379f6f5eff85f0234ea6461c70ea9ff337ab`, from verified entry
`72780c3699bc9de10f2d4ee081d3cdba27734e3b`. The locally accepted repaired candidate is
`3e50d101f08c083ccff5787e7cc49ee6f1fb7870`, with parent
`9880b0a76fe84ac88959c8fd1346e6d941db3e51` including intervening peer commits. The repair changes
only the existing feedback renderer and its unit: chip-backed refusal keeps an operable standalone
Retry edit control while hiding command-refusal copy. Typed matching rejected/conflict results
produce closed actor/command/save-kind/outcome receipts; drafts, private values and raw server text
do not enter chips. Ordinary, protected and provider paths retain stale-incarnation isolation,
delivery-failure isolation and deduplication. No panel publication or approved toast-renderer change
occurs. Accepted-but-superseded, unknown and local validation behavior remains distinct.

[W2AS-R1 source review](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-03/dashboard-feedback-settings-w2a/review/W2AS-R1.md)
finds no remaining blocker in the repaired candidate.
[W2AS-V1 independent verification](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-03/dashboard-feedback-settings-w2a/verification/W2AS-V1-report.md)
records fresh plain Git exports and exact source/check inputs:

- The nine-file Settings selection passes **96/96**; the independent, verification-only real-page
  adapter asset passes **1/1**, proving one danger chip, retained Retry edit, no private inline copy,
  deduplication and actor-change dismissal. That extra asset is evidence outside the committed source.
- Scoped ESLint passes on all ten changed source/test paths and the verification asset. Manifest,
  store-catalog and canonical bundle checks pass. Existing assertions, membership, timers and
  timeouts remain retained; no broad gate is inferred from these focused results.
- Fresh entry, repair-parent and candidate typechecks each exit **2** with **72** byte-identical
  diagnostics, SHA-256 `132eb6be9ddb24a1b6a15a7f0c74ea515498dde0aaf652e6a173de304cc7cb95`.
  Typecheck remains failed and unwaived. This is the current-entry comparison, not the earlier W2
  receipt's diagnostic hash.
- Each isolated export retains all **2,206** tracked blobs with zero mismatches after checks.
  The shared checkout advanced to peer `7ceb7dd6d8eff10a721a04551dcc2388a8299022`; its index was
  clean and two peer plan edits remained. Passing evidence binds to the immutable source candidate,
  not the combined moving peer tree.

**Final accepted Settings source:** the operator confirmed a truthful compact chip plus the existing
recovery warning for unconfirmed saves, with no new panel alert. Source
`f5fbfb49994e6231a04bf0acba6dc4645d89b02b` adds that binding from entry
`7ceb7dd6d8eff10a721a04551dcc2388a8299022`. The locally accepted repaired candidate is
`8cb10a13ce2d9b2bdb293e608f107d009b0e3eeb`, parent `f5fbfb499`; its two-path repair dismisses the
exact prior unknown chip before Saved, refused or conflict replacement delivery, including when the
replacement emitter throws. The matching closed receipt uses only actor, save kind and exact
command ID, with an unconfirmed phase in the deduplication identity. The persistent danger chip is
`Save unconfirmed`, manually dismissed, with closed kind-specific recovery copy and no target/action.
Ordinary/protected controllers bind current typed authority uncertainty, post-dispatch unknown and
unconfirmed readback; provider keys also bind identity-bound pending recovery. Existing inline
warning, retained draft and exact-attempt controls remain; pre-dispatch validation, stale scopes and
accepted-but-superseded behavior stay distinct. No unknown write is automatically retried or called
saved, failed or without effect.

[W2AS-R1 final source review](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-03/dashboard-feedback-settings-w2a/review/W2AS-R1-unknown.md)
finds no remaining blocker. The fresh
[W2AS-V1 final verification](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-03/dashboard-feedback-settings-w2a/verification/W2AS-V1-unknown-report.md)
passes **102/102** units in the same nine-file selection plus **1/1** evidence-only real-page unknown
adapter check. The page check retains the inline warning and Retry exact attempt, reuses the command
ID without another chip, excludes private server text and dismisses on section/actor change. Scoped
lint, manifest, store-catalog and bundle checks pass. Fresh entry, parent and final typechecks each
exit **2** with the same **72** diagnostics and SHA-256 recorded above; this remains failed and
unwaived. Each of the three exact exports retains all **2,206** tracked blobs with zero mismatches.
At verification, the owned checkout was at `8cb10a13`, index clean, with four plan/reference/index
files modified and unstaged; checks did not run in that mutable tree.

The approved compact-toast segment remains byte-identical across owner toast commit `e9332b520`,
approved presentation `2d2dd9c6`, current presentation HEAD `15f2c0b` and its working file, accepted
backend and current backend: **12,401 bytes**, SHA-256
`8f9a5f18319634a4a5595dab2de87c4dd9391b0e38d84acecd77ae2e3e05ca37`. The canonical W2a receipt
and independent W2A-V1 presentation receipt confirm the approved candidate; later whole-file
presentation additions are outside the toast segment and remain preserved. Exact proof is in
`W2AS-X1-unknown-report.md` and `unknown-presentation-source-proof.json` at the evidence owner.

**Completion and obligations:** all operator policies for the admitted W2a bindings are settled,
and the final Settings binding is locally accepted. Existing D366 owns both Settings policy
ratifications, with the matching decision-index amendment in the same documentation commit.
[The documentation/check handoff](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-03/dashboard-feedback-settings-w2a/W2AS-X1-docs-check-ready.md)
records the exact three-path partial stage: this owner's W2a policy/receipt/Settings continuation,
D366's normative surface amendment and its decision-index entry. Staged whitespace, unique
decision/anchors, links and source/receipt consistency pass. Entry and staged-candidate roadmap
checks pass with no generated change; both exports retain all 2,206 paths and differ only in those
three documents. All ten owned source/test paths remain equal to accepted `8cb10a13`, HEAD and
working bytes, so source verification is reused for unchanged inputs. Peer working hashes and
unrelated plan/index hunks remain preserved outside the stage. The receipt carries the final Git
identity and refreshed documentation checks at closure. The evidence owner is
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-03/dashboard-feedback-settings-w2a/`.
The scope exclusions, preserved assertions and deferred complex/live/visual/coverage/phase-exit
obligations above remain in force. Later-feature callbacks remain with their owners. No push,
merge, peer cleanup or next-package launch is authorized.
