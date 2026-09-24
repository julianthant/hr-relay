# UI-A: Settings and records

Status: **approved plan; baseline release pending**. Task **3.1.23.1**
(UI-A); not launch-ready or started. The prior `/supervise UI-A` request authorized this scope
subject to the shared prerequisite. The operator approved this planning amendment on 2026-09-23; baseline release remains required. One independent implementation assignment; Sol root acceptance, one Luna xhigh implementer.
Read the [shared brief](README.md), particularly the frozen base, design rules, file allowlists,
gate cadence and finalization conditions. This plan never waits for UI-B's implementation.

## Outcome and scope
<!-- roadmap: dash-ui-settings-records -->

Settings feels like an organized control panel, with clear labels and consistent value editors.
Archive and Activity read as professional records views. Help remains available when requested.
Dialog layouts, buttons and feedback within these surfaces follow the same quiet visual language.

**Operator amendment, 2026-09-19:** also improve the expanded Session panel and its worker/browser
rows, grouping, pool controls and dialogs, plus the Calendar picker. Preserve the collapsed session
bar, date toolbar control, queue panel and default dashboard design. These panels are implementation
scope, not finalizer-only inspections.

Own all Settings subsections: General, Display, Performance, Paths, Test routes, Annual dates,
Provider budgets/models, Credentials, Provider availability, Observed host, Deployment, Storage
health, System hosts, Workflow capabilities, Keyboard and UI catalog. Include any applicable
served section added by accepted Setup work. Preserve server-driven membership and unavailable
states. Include Archive saved reports, filters, version changes, deletion, attachments/lightboxes,
and Activity search/export presentation. The shortcut legend and its presentation model belong
here because Settings imports them; shortcut bindings and keyboard behavior remain unchanged.

Own `preflight-popover.tsx` with Settings preflight presentation; keep its closed trigger frozen.
The shared `preflight-popover-model.ts`, `archive-model.ts` and `row-catalog-model.ts` stay frozen.
No notification, Explorer, Run/Rerun or Intake edits. Their workers' dialogs do not belong here.
No shared tokens/primitives, transport, authority, route or validation-schema changes. Do not add
settings, convert stored units, restore retired Archive behavior or expose protected values.

## Start and ownership

- Accepted common base: **WAITING ON** the shared prerequisite described in the overview.
- Proposed branch: `codex/3.1-ui-settings-records` from that same base used by UI-B.
- Proposed checkout: `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-settings`.
- Exact source/test/reference ownership: the closed UI-A paths in [ownership.json](ownership.json). New helpers/tests use
  `ui-settings-records-` prefixes. This file alone receives UI-A progress and candidate evidence.
- Target: operator-controlled finalization branch, then `master`; either worker merge order works.
- Lead: `/ui` Design, refinement within the existing system; Content support; one implementer.
- Execution: `/sol-orchestrator` with `/luna-worker`; one native `luna_worker_xhigh`, standard speed,
  no nested dispatch. The root accepts the complete candidate. Phase 3.1 requires no independent reviewer.

## Implementation sequence

| Unit | Necessary change | Observable result and proof |
| --- | --- | --- |
| A1: Inventory and layout | Capture each reachable section's resting, edited and exceptional states. Trace current mounts, especially `SavedArchiveWorkspace` in `archive-report.tsx`. List every embedded confirmation/viewer. | Before captures tied to the common base, source paths and an exhaustive section/dialog checklist. Do not spend the pass polishing unused legacy Archive markup. |
| A2: Settings controls | Compose existing fields into consistent groups with aligned label/control/unit placement. Give structured provider/route fields readable presentation labels in an owned pure helper while preserving served key identity and units. Keep model chains, coupled display dimensions and fiscal-year groups intact. | Boolean/scalar/object/list/date/credential cases work. Default/saved/dirty/invalid/read-only states are distinguishable without repetitive classification prose. |
| A3: Settings detail and feedback | Remove implementation subtitles and generic teaching. Consolidate identical value readbacks; expose full provenance through accessible details. Keep active-versus-saved differences and activation consequences visible. Align Save/Discard and per-field Reset/Clear; give dirty-exit confirmation the common dialog anatomy. Apply the same hierarchy to storage, preflight and read-only sections. | Controls remain reachable at 1024×720 and real zoom. Errors, conflicts, retained drafts, failed/unconfirmed saves and required recovery remain visible. No false “saved” state or blanket restart instruction. |
| A4: Records views | Recompose Archive filters, list/detail selection, report header, facts, logs, evidence and version-change review using existing panels, table and typography primitives. Give Activity the same toolbar/filter/result hierarchy. Separate destructive actions from reading/exporting. | Reports are scannable without raw metadata dominating. Long IDs and missing/corrupt attachments remain usable. Delete consequences remain explicit before confirmation; export and exact report selection are preserved. |
| A4b: Expanded Sessions | Improve worker/browser row hierarchy, grouping, concise state/reason presentation, control alignment and pool dialogs using existing primitives. Keep current command admission, errors and lifecycle semantics. | Busy/idle/unavailable/failed workers and unmet pool members remain distinguishable. Controls and confirmations are reachable by keyboard and at zoom. The collapsed bar and queue render unchanged. |
| A4c: Calendar | Refine the open picker header, month controls, day grid, date/count hierarchy and selected/today/disabled states. Keep the existing trigger and shared date model/state unchanged. | Month/year boundaries, keyboard movement, today/selected distinction, server availability, loading/refusal and Escape/focus return remain correct. The picker fits narrow desktop and zoom without covering its own controls. |
| A5: Complete the family | Apply consistent button variants, gaps, footer placement and short labels across every owned subsection/dialog, including help/catalog. Compare both themes and fix remaining defects. | Completed checklist with before/after proof; each item implemented, explicitly inspected with no change, or blocked with a named owner. No unexplained deferrals. |

Keep domain meaning intact. An unchanged backend does not by itself prove unchanged interaction:
exercise dirty exit, exact retry, conflict and destructive cancellation after any layout change.
Settings diagnostics must never display a credential value or its digest. A details disclosure must
not become a way to conceal an unavailable/unsafe authority state.

## Focused acceptance

Expanded Sessions has its own before/after evidence in both themes. Exercise expand/collapse,
pool selection, the existing add/stop/restart/close controls actually served by the accepted base,
busy/refused/unknown results and focus return. No lifecycle behavior or command availability is
invented. Capture the owned panel region; combined screenshots belong to finalization.
Calendar also needs both-theme before/after evidence, unchanged closed-toolbar geometry, long
month labels, counts, unavailable dates and keyboard navigation. Existing `session-panel-model.ts`
and `date-navigation-model.ts` remain frozen; `settings-model.ts` is also shared with Run launch
and stays frozen, together with the shared Settings state models listed in the overview.
Use only owned presentation helpers as needed.

1. Every applicable Settings section and value type is accounted for. No blanket generic JSON
   editor replaces structured controls. Friendly labels agree with accessible names.
2. Persisted Clear, draft Reset and Discard stay distinct. Clearing coupled values, entering an
   invalid/empty number, saving a value equal to its default and rejecting a partial record retain
   current behavior. Conflicts retain draft and identify current state.
3. Current state leads; generic explanations are removed or available on demand. Critical source,
   activation and saved/active differences are readable without a hidden dependency on help.
4. Archive uses its frozen report and exact attachment authority. Missing, corrupt, unavailable,
   empty and deleted records are different states. No regeneration from a current descriptor.
5. Delete confirmation names the object, retained-file/evidence loss and any applicable duplicate-
   write consequence. Cancel changes nothing. Success appears only after verified settlement.
6. Filters, tables, actions and overlays have consistent hierarchy. The active selection is clear;
   overflow does not cover Save, Discard, Close or destructive confirmation controls.
7. Existing keyboard/dirty-navigation, protected-store privacy and focus behavior pass. All owned
   states work in both themes and the desktop/zoom matrix in the overview.

## Focused checks

These commands exist at the current inspection base; they are **planned**, not executed by planning.
The manifest also assigns `tests/unit/dashboard/setup-preflight.test.ts`, `preflight-client.test.ts`,
`session-controls.test.ts` and browser `setup-preflight.spec.ts`, `session-controls.spec.ts`.
Add these to the focused commands below. Run `setup-boundary.test.ts` read-only as the authority
regression. Session/runtime and preflight server fixtures stay frozen. Setup/doctor reference
triples belong to UI-A; the closed preflight trigger is preserved in both workers' scenes.

Additional Session proof: `npm run test -- tests/unit/dashboard/session-panel-pool-press.test.ts tests/unit/dashboard/worker-pool-controls.test.ts`
and `npm run test:parity -- pool-control-desktop-target.spec.ts --workers=2`. These paths are
assigned to UI-A in the manifest. Extend the owned interaction proof for the new layout and
preserve all existing assertions; scoped lint also covers the added Session source/test paths.
Calendar proof adds `npm run test -- tests/unit/dashboard/date-navigation-control.test.ts` and
`npm run test:parity -- date-navigation.spec.ts --workers=2`; retain model/state tests as read-only
regressions when useful. `date-navigation-server.ts` stays shared and frozen.
Use the shared brief’s verified two-worker Vitest adapter: add `--config <absolute-owned-adapter>`
after `--` in unit commands below. At launch, verify the current manifest and retain all assigned Setup and Session checks.

```sh
npm run test -- tests/unit/dashboard/settings-editor-surface.test.ts tests/unit/dashboard/settings-catalog-surface.test.ts tests/unit/dashboard/settings-protected-surface.test.ts tests/unit/dashboard/settings-takeover.test.ts tests/unit/dashboard/settings-status-sections.test.ts tests/unit/dashboard/settings-storage-doctor.test.ts tests/unit/dashboard/activity-render.test.ts tests/unit/dashboard/archive-delete-door.test.ts
npm run test:parity -- reference-settings.spec.ts settings-catalog.spec.ts settings-activation.spec.ts reference-storage.spec.ts storage-recovery.spec.ts archive-report.spec.ts archive-authority.spec.ts archive-accessibility.spec.ts archive-evidence.spec.ts reference-archive.spec.ts reference-activity.spec.ts --workers=2
```

`archive-render.test.ts` and `archive-detail-render.test.ts` exercise the frozen older Archive;
they are not acceptance for the mounted saved-report workspace. Add an owned
`tests/unit/dashboard/ui-settings-records-archive.test.ts` for changed saved-report layout,
attachment failures and delete/cancel reachability, alongside the listed current browser proof.

Add meaningful interaction assertions for the changed grouping/disclosure/scrolling behavior in
the owned test files; do not test incidental prose verbatim. Run scoped ESLint with
`--max-warnings 0` over the exact changed source and test paths. Resolve the list from the owned
diff, not a whole-directory lint that includes the other assignment. Run `git diff --check`.

Attribute deliberate owned reference changes, update only the UI-A scene prefixes, inspect
screenshot/a11y pairs and rerun the listed assert-mode tests. No global `test:parity:update`.
Shared fixture, registry or primitive needs stop the affected unit for prerequisite reassignment;
the independent parts can continue. Browser operation follows playwright-cli and the repository
parity lane; no new dependencies or alternative browser tooling.

Full coverage, whole-repository lint/architecture and broad parity remain at 3.1.19. The group
finalizer runs typecheck and focused combined checks. No independent review is required by the
Phase 3.1 exception. This does not waive any assigned focused failure.

## Release record to fill during implementation

Record: approved plan commit; accepted base; exact branch/worktree; source and test diff; completed
surface/dialog checklist; before/after paths; candidate commits; exact gate commands/results;
deliberate reference attribution; privacy/keyboard/zoom evidence; deferred broad proof and any
blocker. End with a committed candidate ready for finalizer intake. Do not update the shared phase,
roadmap, generated index or UI-B record, integrate, push or launch another task.

## Conditional launch prompt

Prepared for after admitted 3.1.23 release; do not launch now. The future release record supplies
its real accepted base and planning commit. Copy those verified values rather than using the
inspection SHA as an implementation base. No sibling branch is an input.

```text
/sol-orchestrator 3.1.23.1 (UI-A) using /luna-worker and /ui.

Read the committed ui-refinement/settings-and-records.md, shared README.md and ownership.json under
docs/rebuild/plans/phase-3/3.1-finish-the-dashboard in the accepted checkout.
Verify numbered admission, the plan commit, completed 3.1.23 release and its exact accepted base.
If any is missing, report the exact prerequisite; do not implement against the inspection base.

Create/reuse the verified owned branch codex/3.1-ui-settings-records from that common accepted SHA in
/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-settings.
Recheck exclusive ownership and the four-worktree capacity before creation.

Implement UI-A's closed manifest scope, including expanded Sessions and the Calendar picker.
Preserve the queue, default dashboard design, collapsed session/date controls, shared APIs and frozen toolbar
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
