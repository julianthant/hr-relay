# UI-B: Workflow interactions

Status: **approved plan; baseline release pending**. Task **3.1.23.2**
(UI-B); not launch-ready or started. The prior `/supervise UI-B` request authorized this scope
subject to the shared prerequisite. The operator approved this planning amendment on 2026-09-23; baseline release remains required. One independent implementation assignment; Sol root acceptance, one Luna xhigh implementer.
Read the [shared brief](README.md), particularly the frozen base, design rules, file allowlists,
gate cadence and finalization conditions. This plan never waits for UI-A's implementation.

## Outcome and scope
<!-- roadmap: dash-ui-workflow-interactions -->

Run/Rerun, Workflow Explorer, Intake and Notifications feel like parts of the same professional
dashboard. Dialogs lead with the object and action; controls and steps make the flow apparent.
Remove tutorial-like copy without obscuring validation, uncertainty or consequences.

**Operator amendment, 2026-09-19:** also improve the Log panel and Context/Data panel interiors.
Keep the queue panel and default dashboard design unchanged. These are implementation outcomes,
not finalizer-only consistency checks. Expanded Sessions belongs to UI-A.
The existing `log-panel-model.ts`, `archive-model.ts`, `row-catalog-model.ts` and
`preflight-popover-model.ts` are shared and remain frozen. Own the new `run-detail/logs.tsx`
and `run-detail/gate-park.tsx` presentation; freeze shared capture/receipt/timeline renderers. Keep its
interface and semantics unchanged; use a uniquely owned helper for presentation-only additions.

Own the workflow interaction family: Run/Rerun stages, source-value review, intake/upload/mapping/
review, Explorer graph/detail/editing, notification drawer and row actions, identity approvals,
parked-write decisions, generic command confirmations, rename, diagnostic viewers, search,
while shared preflight presentation belongs to UI-A. Include existing nested dialogs and help within those files. The
shortcut legend belongs to UI-A with Settings; its files are not owned by this worker.

Settings and its subsections, Archive, Activity and their embedded dialogs belong to UI-A.
Shared shell/queue and outer detail geometry, design-system primitives, tokens, status vocabulary, trust
records and transport remain frozen. Do not change workflow policy, command identity, enqueue,
notification delivery semantics, automatic retry, permissions or mutation authority.

## Start and ownership

- Accepted common base: **WAITING ON** the shared prerequisite described in the overview.
- Proposed branch: `codex/3.1-ui-workflows` from that same base used by UI-A.
- Proposed checkout: `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-workflows`.
- Exact source/test/reference ownership: the closed UI-B paths in [ownership.json](ownership.json). New helpers/tests use
  `ui-workflow-interactions-` prefixes. This file alone receives UI-B progress and candidate evidence.
- Target: operator-controlled finalization branch, then `master`; either worker merge order works.
- Lead: `/ui` Design, refinement within the existing system; Content support; one implementer.
- Execution: `/sol-orchestrator` with `/luna-worker`; one native `luna_worker_xhigh`, standard speed,
  no nested dispatch. The root accepts the complete candidate. Phase 3.1 requires no independent reviewer.

## Implementation sequence

| Unit | Necessary change | Observable result and proof |
| --- | --- | --- |
| B1: Inventory and overlay map | Capture every reachable owned modal, drawer, popover and embedded step on the accepted base. Include ready, validation, dirty, busy, refused and uncertain states. Trace imports before changing a reusable exported component. | Source-to-state checklist, before captures and explicit existing component/size/scroll choices. A shared-rendering change is identified before editing, not discovered in UI-A's gate. |
| B2: Run/Rerun and Intake | Make inputs and choices lead. Move general workflow descriptions and optional examples into accessible help. Normalize stage header, labels, grouped controls, review rows, validation and footer. Preserve explicit source/plan differences and all required enqueue confirmations. Apply the same treatment to intake mappings, rejection review and comparison. | A user can enter, review and start from the controls. Invalid/rejected/zero-member input remains blocked. The final action, accepted source and any changed plan remain unambiguous at narrow desktop and zoom. |
| B3: Explorer | Give workflow selection, graph, selected-node detail and presentation editing a consistent hierarchy. Reduce repeated chips and implementation prose. Put optional diagnostic identifiers and contract descriptions into reachable details; keep real dependencies and allowed edits accurate. Simplify the edit/review/apply layout. | Label/icon/category edits still use the served allowlist, required reason, exact review and readback. Conflict/refusal/code-change-required/uncertain outcomes remain distinct; no invented dependency edge or editable graph capability. |
| B4: Notifications | Use a compact header/count/filter arrangement and consistent row rhythm. Give each row a clear title, time, state and primary destination, with quiet read/snooze controls. Reorganize delivery setup and static guidance without burying actual permission/failure state. | A long inbox scrolls without losing usable filters/close. Unread and snoozed remain separate. Pinned safety rows stay visible under every filter and cannot be dismissed, marked read or snoozed. Navigation and delivery state remain truthful. |
| B5: Remaining dialogs | Apply the common header/body/footer, width, button hierarchy and concise copy to confirmation, rename, identity, parked-write, search, diagnostic and preflight surfaces. Use inline details inside modal layers. | Every owned overlay has a clear purpose and next action; no clipped footer, duplicate explanatory band, tooltip-only requirement or hidden destructive consequence. |
| B5b: Logs and Data | Improve event-row hierarchy, timestamps, filtering/follow controls, value alignment, grouping and provenance display. Remove repeated explanatory bands. Keep run status, decisions and failure context accessible within the existing panel geometry. | Long/empty/loading/failed/live-updating logs remain readable; follow and selection do not jump unexpectedly. Data values, redacted/missing/unknown states and read/write direction remain distinct; read-only values do not become editable. |
| B6: Complete the family | Inspect every owned control in both themes and the required state/viewport matrix; repair inconsistent spacing, labels and action placement. | Completed checklist with before/after evidence and no unnamed leftovers. Shared shell/detail observations go to finalization without editing their frozen files. |

Keep safety and product facts in the primary interaction. A concise parked-write dialog must still
say what may have been submitted and what the operator must verify. Keep refusal outcomes and
recovery routes. Never turn an UNKNOWN submit into Retry. A confirmation remains a confirmation;
this task does not remove review steps solely to make the flow shorter.

## Focused acceptance

Logs and Data each require before/after evidence and interaction assertions. Preserve the single
log scroller, event order, live continuation/follow, active filter, selected run, data provenance
and read-only semantics. Do not hide unresolved writes, failures or recovery instructions for
visual simplicity. Verify Timeline/Attempts and existing receipt/failure/viewer navigation as
related states, without silently expanding frozen-component ownership.

1. Run/Rerun clearly distinguishes input, options, review and final enqueue. Source-bound values
   and changes retain their identity. Back/Cancel/reopen/failure preserve the accepted behavior.
2. Intake preserves header selection, mapping, rejected-row corrections/exclusions, explicit
   comparison and changed-plan confirmation. Removing prose never unlocks invalid handoff.
3. Explorer keeps selection, dependency meaning, edits and immutable review identity accurate.
   Apply success requires actual readback; timeout or lost response does not imply rollback/success.
4. Notifications keeps permission enablement explicit, accurate unread/filter counts, independent
   read/snooze state, accessible pinned warnings and exact destination navigation. No new bulk
   action or dismiss behavior is invented for visual convenience.
5. Each dialog has an appropriate existing size, one content scroller, stable heading and reachable
   footer. Every icon-only control has an accessible name; meaningful visible actions keep labels.
6. Generic explanatory paragraphs disappear from resting states. Actual risks, failures, unknown
   states, format requirements and action consequences stay visible and actionable.
7. Focus enters/restores correctly; Escape and cancel semantics survive, including search's existing
   clear-then-close behavior. Help does not open behind a modal. Both themes and real zoom pass.

## Focused checks

Run `tests/parity/run-detail/logs-captures.spec.ts`, `context-data.spec.ts` and `gates-park.spec.ts`
in addition to the existing focused commands below. UI-B owns their exact default Logs/Data/gate
triples and six gate/park ceremony variants listed in ownership.json. These full-page routes show
only frozen closed/collapsed UI-A controls. Capture proof that those background regions stay
unchanged. Do not change shared `run-detail/shared.ts`, scene fixtures or capture wiring. Existing
combined `dashboard-reference.spec.ts` and other unowned variants remain finalizer gates.


These commands exist in the inspected baseline; they are **planned**, not executed by planning.

Additional panel proof: `npm run test -- tests/unit/dashboard/context-rail-render.test.ts tests/unit/dashboard/log-panel-model.test.ts tests/unit/dashboard/run-detail-follow.test.ts tests/unit/dashboard/run-detail-decision-cue.test.ts tests/unit/dashboard/run-detail-timeline.test.ts tests/unit/dashboard/run-detail-timeline-render.test.ts`
and `npm run test:parity -- observed-log-ui.spec.ts --workers=2`. These paths are assigned to UI-B
in the manifest. Add owned regional browser proof for Log/Data layout and keyboard/zoom states.
Full shared-detail reference triples remain finalizer-owned; scoped lint covers added paths.
Use the shared brief’s verified two-worker Vitest adapter: add `--config <absolute-owned-adapter>`
after `--` in unit commands below. At launch, retain these and add exact tests introduced by the accepted Run/Rerun and detail tasks.

```sh
npm run test -- tests/unit/dashboard/run-start-dialog.test.ts tests/unit/dashboard/run-start-focus.test.ts tests/unit/dashboard/run-start-kit-render.test.ts tests/unit/dashboard/intake-workspace.test.ts tests/unit/dashboard/intake-upload.test.ts tests/unit/dashboard/explorer-edit-dialog.test.ts tests/unit/dashboard/explorer-edit-review.test.ts tests/unit/dashboard/explorer-editable-field-row.test.ts tests/unit/dashboard/notification-inbox-model.test.ts tests/unit/dashboard/notification-delivery.test.ts
npm run test:parity -- reference-start.spec.ts reference-intake.spec.ts intake-accessibility.spec.ts intake-authority.spec.ts reference-explorer.spec.ts explorer-authority.spec.ts notifications.spec.ts diagnostic-bundle-dialog.spec.ts cross-date-search.spec.ts --workers=2
```

There are no direct existing unit imports of identity-approve, park-resolve or actions components
in the inspected tests. Add meaningful owned `ui-workflow-interactions-*.test.ts` interaction
coverage when changing those dialogs. Run existing `failure-resolution.spec.ts` and
`backfill-gap.spec.ts` read-only when the associated consumers change. Preserve assertions and
fixtures; UI-B owns only the exact manifest-listed run-detail triples; all others belong to finalization. Add owned interaction tests
for layout/disclosure/reachability gaps. If a shared reference must change, capture the new state
in a uniquely owned test/evidence artifact and give the exact affected scene to the finalizer;
never overwrite shared or UI-A reference triples from this worker.

Run scoped ESLint with `--max-warnings 0` over exact changed source/test paths and
`git diff --check`. Attribute deliberate owned reference changes, update only UI-B scene prefixes,
inspect screenshot/a11y pairs, then rerun assert mode. No global `test:parity:update`. Do not weaken
timeouts, assertions, reference membership or pixel tolerance to obtain a pass.

Browser operation follows playwright-cli and the repository parity lane. The code's command and
keyboard behavior needs executable assertions as well as pictures. Full coverage, whole-repository
lint/architecture and broad parity remain at 3.1.19; the group finalizer supplies typecheck and
focused combined checks. No independent review is required under the Phase 3.1 exception.

## Release record to fill during implementation

Record: approved plan commit; accepted base; exact branch/worktree; owned diff; completed surface/
dialog checklist; before/after paths; candidate commits; exact focused commands/results; deliberate
reference attribution; keyboard/zoom and critical negative-state evidence; deferred broad proof
and named blockers. Commit a candidate ready for finalizer intake. Do not edit the shared phase,
roadmap, generated index or UI-A record, integrate, push or launch another task.

## Conditional launch prompt

Prepared for after admitted 3.1.23 release; do not launch now. The future release record supplies
its real accepted base and planning commit. Copy those verified values rather than using the
inspection SHA as an implementation base. No sibling branch is an input.

```text
/sol-orchestrator 3.1.23.2 (UI-B) using /luna-worker and /ui.

Read the committed ui-refinement/workflow-interactions.md, shared README.md and ownership.json under
docs/rebuild/plans/phase-3/3.1-finish-the-dashboard in the accepted checkout.
Verify numbered admission, the plan commit, completed 3.1.23 release and its exact accepted base.
If any is missing, report the exact prerequisite; do not implement against the inspection base.

Create/reuse the verified owned branch codex/3.1-ui-workflows from that common accepted SHA in
/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-workflows.
Recheck exclusive ownership and the four-worktree capacity before creation.

Implement UI-B's closed manifest scope, including Logs and Data. Preserve the queue and default
dashboard design, UI-A's Session panel, existing shared APIs and frozen toolbar
rendering, tokens, authority and the other worker's files. Use concise copy and cohesive layouts;
keep warnings, validation, uncertainty and action consequences visible.

Run the assigned focused unit/parity checks, scoped lint and browser proof in both themes and
the desktop/real-zoom matrix. Use the verified two-worker adapter and isolated output/evidence.
No independent review under the Phase 3.1 exception.

Commit exact owned paths and this worker record; return candidate/base/plan SHAs, checks,
screenshot attribution and deferred broad proof to finalizer 3.1.23.3. Do not merge, push,
edit shared roadmap/manifest records or launch another task. Root may assign one Luna xhigh
implementation worker with this exact scope; that worker cannot delegate.
```
