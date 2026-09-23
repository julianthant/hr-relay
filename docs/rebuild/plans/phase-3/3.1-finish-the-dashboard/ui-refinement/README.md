# Phase 3.1.23: dashboard UI refinement

Status: **approved planning amendment; baseline release pending**, 2026-09-23.
The operator approved option A ("approve. A"): apply and commit the planning amendments,
regenerate/check the roadmap, and return conditional launch prompts.
The earlier conditional UI-A/UI-B requests and the Sessions/Logs/Data/Calendar amendment retain
their product scope. The current authorization covers planning amendments and their commit only:
no UI implementation, worker launch, merge or push. Neither worker is launch-ready.

| Parallel plan | Owns |
| --- | --- |
| [UI-A: Settings and records](settings-and-records.md) | Settings and every subsection, storage/setup presentation, expanded Sessions, Calendar picker, Archive, Activity, UI catalog/help, shared preflight presentation, and dialogs embedded in those surfaces |
| [UI-B: Workflow interactions](workflow-interactions.md) | Run/Rerun, Intake, Workflow Explorer, Notifications, Logs, Data, run decisions and supporting dialogs/popovers |

### Operator scope amendment: Sessions, Logs, Data and Calendar (2026-09-19)

The operator explicitly adds improvement of the Session panel, Log panel, Data panel and Calendar. The
queue panel and default dashboard design are accepted and must be preserved. This supersedes
the earlier consistency-check-only treatment of Sessions and the run-detail body.

- UI-A owns the expanded Session panel, its worker/browser rows, pool controls and related
  dialogs. Keep the collapsed session bar's rendering, dimensions and public interface unchanged.
- UI-A also owns the Calendar picker interior: month header, day grid, selected/today states,
  counts, loading/error/empty states and controls. Preserve the closed toolbar control, navigation
  semantics, server-derived availability, date boundaries and keyboard behavior.
- UI-B owns the Log panel and Context/Data presentation: readable event hierarchy, aligned values,
  concise metadata, filtering/follow behavior, current selection and provenance. Preserve status,
  event order, redaction, read/write distinctions and read-only data semantics.
- Preserve queue layout, rows, toolbar and actions; default shell, navigation, panel arrangement,
  typography, palette, tokens and shared primitives. Improve the named panel interiors within
  that existing design. Do not convert this amendment into a dashboard redesign.
- Timeline/Attempts, receipts/failures and screenshot viewers are related views to include in the
  completeness inventory. Existing owned decision/viewer work remains required; this inventory
  does not silently transfer currently frozen receipt/trust components to a worker.

The product scope is retained. Current ownership is inspected against accepted master
`beb2a79b6bd699afb3701ee8aeb3ec3bfe011a1a`; the shared baseline release remains outstanding.
For independence, capture expanded Sessions and Log/Data regions in each worker's own evidence;
combined dashboard reference updates remain owned by finalization except the exact UI-B run-detail triples listed in ownership.json. Neither worker may restyle
the other's background, shared shell or collapsed session strip to satisfy a screenshot.
The dependency check found that catalog views consume `log-panel-model.ts` and command dispatch
consumes `session-panel-model.ts`. Those two existing models remain frozen for both workers;
assign `log-panel.tsx`, `run-detail/logs.tsx` and `run-detail/gate-park.tsx` to UI-B and `session-panel.tsx` to UI-A. The Calendar owns only
`date-navigation.tsx` presentation; its model and state remain frozen. Put any necessary new
presentation-only helper under its worker's unique prefix, with no public API change.
Current Run launch code also reaches `settings-model.ts` through the app model; freeze that
existing navigation model for both workers. The closed manifest excludes all discovered
cross-worker model paths instead of relying on a promise to coordinate their edits later.
The same Run-launch import chain reaches existing Settings attempt, capabilities, draft, editor,
facts, hosts, preflight and protected models, plus `storage-settings-model.ts`; those models also
remain frozen. Their state/command behavior is outside this visual assignment.
Also freeze `archive-model.ts`, `row-catalog-model.ts` and `preflight-popover-model.ts`, which
now have consumers across these boundaries. UI-A owns both `settings-preflight.tsx` and
`preflight-popover.tsx`; UI-B does not edit preflight presentation. Freeze `command-recovery.tsx`,
shared `run-captures.tsx`, receipt/timeline rendering and their models. Their inspection does
not transfer ownership or authorize queue/recovery changes.

## Intended result

A clean, cohesive operational dashboard. The operator sees the current object, relevant facts,
available controls and the next action without reading an explanation of how the product works.
Improve layout, hierarchy and control placement as well as copy. This is substantial surface
refinement within Graphite Warm/Paper Ink, not a new brand or an additional tutorial.

Use `/ui`: **Design, refinement within the existing system; Operate mode; Content support**. Existing tokens, Radix-backed
overlays and the `ds/ui.tsx` barrel supply the common visual language. No new UI dependency,
framework, global theme or navigation system is proposed.

## Evidence and authority

Planning originally inspected `master` at `f93994501`; the 2026-09-23 audit rechecked
`beb2a79b6bd699afb3701ee8aeb3ec3bfe011a1a`, the current task map, application mounts, surface
source, tokens, overlay primitives, relevant tests and checked-in screenshots. These screenshots
are historical reference evidence, not a fresh browser run or proof of current behavior.

| Observed issue | Concrete evidence | Owner |
| --- | --- | --- |
| Settings repeats classifications, paths and Saved/Active/Default values under each field; object controls use raw property names | `src/dashboard/surfaces/settings-editor.tsx`, `settings-controls.tsx`; `settings-catalog-structured--graphite-warm--1024x720.png` | UI-A |
| The current Archive presents filters and report metadata with little hierarchy | `app/dashboard-takeovers.tsx` mounts `SavedArchiveWorkspace` from `surfaces/archive-report.tsx`; `archive-report-saved--graphite-warm--1440x900.png` | UI-A |
| Run spends prominent space on a workflow-description paragraph before the inputs | `surfaces/run-start.tsx`; `start-run--graphite-warm--1280x720.png` | UI-B |
| Explorer editing exposes implementation language and repeats validation bases | `surfaces/explorer.tsx`, `ExplorerEditDialog`; graph reference at 1440×900 | UI-B |
| Notifications combines delivery setup, filters, repeated action rows and standing instructional text | `surfaces/notification-bell.tsx`; `tests/parity/notifications.spec.ts` | UI-B |

Paths in that table are below `src/dashboard/` unless fully qualified; images are in
`tests/parity/references/`. The checked-in `ds-kit--graphite-warm--1440x900.png` was also inspected.
No runtime tests or new screenshot captures were performed during planning.

Read the [parent phase](../README.md), [acceptance matrix](../task-8-acceptance-matrix.md),
[dashboard instructions](../../../../../../src/dashboard/AGENTS.md),
[DESIGN.md](../../../../../../src/dashboard/DESIGN.md) and
[PARITY.md](../../../../../../src/dashboard/PARITY.md). `DESIGN.md` already requires that a
professional dashboard does not explain itself. Preserve the owning
[surface contract](../../../../reference/dashboard-surfaces.md),
[frontend integration contract](../../../../reference/frontend-backend-integration.md),
[operator trust contract](../../../../reference/operator-trust.md) and current settings/write
semantics. This admitted group adds visual acceptance; it does not replace A01–A42 or D01–D05.

## Placement and common prerequisite

Place the side phase after accepted feature-producing work through **3.1.15**, including
3.1.9.8, 3.1.11.3, 3.1.12, 3.1.13 and 3.1.14.6, before integrated proofs 3.1.16–3.1.19.
This lets both workers consume finished surfaces and lets later realtime/performance/final
acceptance exercise the polished implementation. Those feature tasks are now accepted and merged. Their existing acceptance records remain
authoritative; this group starts only after its own baseline is released.

Admission must bind this order in the roadmap without renumbering existing tasks. Apply D344's
shape: an actual common prerequisite, the two independent workers, then **Finalization** as the
last child requiring both. The finalization instructions below live here; they are not a third
parallel implementation plan. The admitted numbering and bindings are below.

The prerequisite has one observable deliverable: a **frozen UI baseline and ownership record**.
It records the accepted common base SHA, the reachable surface inventory, shared component/API
availability, any new paths from the intervening feature tasks, exact file ownership and scoped
proof commands. Open the specimen at `http://localhost:5174/kit.html` through the prescribed
playwright-cli lane. Verify the existing primitives can express the rules below. This is a real prerequisite proof, including the test-only scene relocation below; it does not authorize product redesign in the prerequisite.

If a shared primitive, global shell or transport change is actually required, complete and accept
that bounded prerequisite before either worker starts, or amend scope with the operator. Do not
give one worker a prerequisite that the other must wait for. No implementation sibling depends
on the other; both branch from the same accepted SHA and can be integrated in either order.

## Shared visual and copy rules

1. Use concise object/action titles. A subtitle appears only when it adds a current fact needed
   for the decision. Remove standing product explanations and repeated descriptions of controls.
2. Use one clear primary action per task region; secondary actions stay quiet. Keep destructive
   actions distinct. Consistent button variants, icon sizes, alignment and labels across both plans.
3. Dialogs share the existing header/body/footer anatomy. Use a content-appropriate existing size,
   one body scroller, reachable actions, and the footer order `Back?`, `Cancel`, primary. Read-only
   viewers use `Close`. Do not enlarge a small confirmation into a mostly empty workspace.
4. Forms use persistent labels, aligned controls, meaningful groups and short unit/format hints.
   Keep validation beside its field. Show editable and read-only values distinctly. Do not achieve
   density by shrinking typography, hiding labels or introducing arbitrary token values.
5. Keep action-relevant facts visible: unsaved state, conflicts, activation differences, blocked
   operations, write uncertainty, destructive consequences and recovery actions. Simplification
   never hides what was written, what remains uncertain or what a destructive action removes.
6. Put optional explanation and raw diagnostic identity behind keyboard-accessible help/details.
   Inside a dialog, disclose inline; the existing menu-layer Popover cannot safely sit over it.
   Help cannot be hover-only. Copy, visible labels and accessible names agree.
7. Preserve all served facts and capabilities. Replace duplicated values with compact structured
   presentation; keep differing Saved/Active/Default values explicit. Diagnostic details remain
   reachable. Do not remove facts that the owning contract requires on screen.
8. Keep existing routes, navigation labels, workflow semantics, command envelopes, revision checks,
   secret handling, defaults, units, data sources and write boundaries. No feature deletion,
   hidden safety notices, new workflow behavior, fabricated state or automatic retry.

Examples: omit `Ordinary settings · SQLite` from the prominent header; replace repeated
`Valid · Ordinary · Editable` with control affordances and actual exception state; move a generic
workflow-description paragraph to help; replace Explorer's command-envelope explanation with the
field label and necessary requirement. These are directions, not permission to drop required
provenance, action consequences or catalog facts.

## Collision-free ownership

[ownership.json](ownership.json) is the closed existing-file allowlist at inspection SHA
`beb2a79b6bd699afb3701ee8aeb3ec3bfe011a1a`; its exact paths override the descriptive families below.
Unlisted existing files stay frozen. Prefixes authorize only named new helper/test paths. The
prerequisite refreshes this manifest for accepted feature changes; new files are not acquired
silently by matching a prefix.

| Area | UI-A | UI-B | Frozen/shared |
| --- | --- | --- | --- |
| Surface source | `src/dashboard/surfaces/{settings*,storage-settings*,archive*,activity*,ui-catalog*,row-catalog*,shortcuts*}.{ts,tsx}`, excluding frozen `archive.tsx` and the shared models listed above; plus `session-panel.tsx`, `date-navigation.tsx` and `preflight-popover.tsx` | `src/dashboard/surfaces/{run-start*,run-identity*,intake*,explorer*,notification-bell*,context-rail*,identity-approve*,park-resolve*,diagnostic-screenshot*,day-search*,actions*}.{ts,tsx}` plus `log-panel.tsx`, `run-detail/logs.tsx` and `run-detail/gate-park.tsx` | All remaining files, specifically existing session/log/date/settings navigation models, unless assigned explicitly during the common prerequisite |
| New presentation helpers | `src/dashboard/surfaces/ui-settings-records-*` | `src/dashboard/surfaces/ui-workflow-interactions-*` | No new generic/shared helper during parallel work |
| Existing unit tests | Exact manifest tests, including Session/pool tests; `tests/unit/dashboard/helpers/settings-harness.tsx` | Exact manifest tests, including notification, Log/Data and run-detail behavior tests | Shared unit helpers and architecture tests |
| New unit/browser proof | `tests/unit/dashboard/ui-settings-records-*`, `tests/parity/ui-settings-records.spec.ts` and uniquely prefixed helpers | `tests/unit/dashboard/ui-workflow-interactions-*`, `tests/parity/ui-workflow-interactions.spec.ts` and uniquely prefixed helpers | Global test configuration, reference registry and fixture server |
| Existing browser proof | `reference-settings`, `settings-catalog`, `settings-activation`, `reference-storage`, `storage-recovery`, `reference-archive`, `archive-*`, `reference-activity` specs and only manifest-listed scene helpers | `reference-start`, `reference-intake`, `intake-*`, `reference-explorer`, `explorer-authority`, `notifications`, `diagnostic-bundle-dialog`, `cross-date-search` specs and only manifest-listed scene helpers | `dashboard-reference`, shell, shared detail, backfill, kit and other combined specs |
| Existing reference triples | Scene IDs `settings`, `settings-*`, `storage-*`, `archive-*`, `activity-*`, `catalog-search`, `setup-preflight` | Scene IDs `start-run`, `start-run-*`, `separations-start-*`, `intake-*`, `explorer-*`, `cross-date-search`, `diagnostic-bundle-*`, plus exact manifest-listed Logs/Data/gate triples | Every unlisted reference, including other run-detail/shell/kit scenes |
| New visual evidence | UI-A-prefixed screenshots/a11y attachments in owned outputs | UI-B-prefixed screenshots/a11y attachments in owned outputs | New registered scene IDs require prerequisite/finalizer membership work; workers update only manifest-listed triples |
| Plan evidence | `settings-and-records.md` only | `workflow-interactions.md` only | This overview, parent phase, roadmap and generated index: admission/finalizer only |

All `src/dashboard/ds/**`, `kit/**`, `app/**`, `state/**`, `client/**`, `lib/**`, global CSS,
shared format/status/trust/geometry helpers, domain/server code, package/config files and instruction
files are frozen for both workers. Reuse their current exported interfaces without changing public
props or cross-surface rendering. A surface-local copy/format helper is allowed; changing stored
values or units is not. `archive.tsx` is frozen: it is not the mounted Archive and imports
UI-B's diagnostic viewer transitively through `trust.tsx`. The mounted workspace is in
`archive-report.tsx`. All unlisted fixture, route, harness, registry and config helpers remain frozen.

Queue, default shell, top bar and collapsed Sessions receive preservation checks in finalization.
Expanded Sessions and shared preflight presentation belong to UI-A; Log/Data interiors belong to UI-B. Default dashboard geometry
stays intact. Assign any newly introduced feature files and screenshot consequences before launch;
do not leave required panel work as an unowned finalizer surprise. A file with imports from both
workers is shared and frozen unless the prerequisite proves separate ownership is safe.

## Isolation and independent release

Proposed, not created or reserved:

| Plan | Branch | Worktree |
| --- | --- | --- |
| Shared prerequisite | `codex/3.1-ui-baseline` | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-baseline` |
| UI-A | `codex/3.1-ui-settings-records` | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-settings` |
| UI-B | `codex/3.1-ui-workflows` | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-workflows` |
| Finalization | `codex/3.1-ui-final` | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-final` |

Use one implementer per plan. Recheck path/ref availability, ownership and the four-worktree ceiling
at launch. Both use the same accepted base, not each other's branch. Separate evidence folders:
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-<date>/` and
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-workflow-interactions-<date>/`. No shared evidence filenames, browser sessions, output
directories or real runtime authority. Retain receipts outside disposable worktrees.

Each worker can implement, run its focused proof and commit its candidate without the sibling.
Changes outside its allowlist require reassignment before editing. Preserve component interfaces;
never cherry-pick the other worker just to pass a gate. Use existing dependencies without installing
new ones. Stage exact files, commit by logical category, never push or merge without the operator.

Parity uses an isolated built fixture server per worktree and its own `.output`/bundle. Use at most
four file workers in total: each plan runs one test process at a time, with at most two workers.
Parity uses `--workers=2`; Vitest requires the verified adapter described below. Lower contention or serialize only a demonstrated resource conflict, not the whole plans.
Manual browser inspection uses named playwright-cli sessions; never share 3938/5174 or authority
roots between live sessions. The common specimen inspection can use the existing read-only runtime.

## Proof and finalization
<!-- roadmap: dash-ui-finalizer -->

Each worker captures before/after at the same viewport, theme, fixture and interaction state, with
the exact code SHA. Check both themes; 1440×900, 1280×720, narrow 1024×768 and the 1024×720 floor;
keyboard, Escape/focus return, long labels, empty/loading/error/refused/dirty/disabled/busy states.
Use actual browser zoom for D04: 125% at 1280×720 and 200% at 1440×900; record effective CSS size
and mechanism. CSS zoom/device scale factor is not substitute proof. Preserve reduced motion.

Snapshots are deliberate design changes, never automatic acceptance. Before an owned refreeze,
record the scene, changed rule, before/after and retained safety/a11y assertions. Update only owned
triples, inspect them, then run assert mode. Unowned shared scenes remain finalizer work; required
focused tests must pass and failures cannot be relabeled as deferred. Reference membership guards
remain unchanged; prefer existing scenes or independent non-reference browser assertions if new
shared registry work would create a collision.

The [Phase 3.1 cadence](../README.md#execution-cadence--operator-amendment-2026-09-13) controls:
focused tests/scoped lint/affected quick checks for workers, no independent review, full repository
and broad parity only at 3.1.19. Each worker plan names current commands; the prerequisite binds
newly introduced feature paths without removing relevant assertions or weakening gates.

Finalization consumes both exact candidates, verifies disjoint diffs, and demonstrates both
`base + A + B` and `base + B + A` merge cleanly and produce identical product/test trees. Use
temporary Git indexes/refs for that comparison; do not overwrite either worker or master.
Combine on the owned finalizer branch, run typecheck, scoped lint, focused cross-surface regression
and affected build/generated checks; repair integration defects. Check representative Settings,
Archive, Explorer, Run and Notifications together plus the shared surfaces named above. Audit every
reachable button/dialog family; record any no-change verdict with its inspected state.

The operator selects integration into `master` after focused acceptance. Record candidate/base/
integration SHAs, exact tests, screenshot attribution and owned cleanup. Update this owner and the
admitted roadmap records once, regenerate the roadmap once, and preserve both worker records.
3.1.19 still runs full typecheck, lint, coverage, broad desktop parity and A01–A42/D01–D05, including
affected performance/realtime proof. This UI group cannot declare Phase 3.1 complete itself.

## Roadmap admission

Admit the required side group as **3.1.23**, the next unused current ordinal, with children
**3.1.23.1 UI-A**, **3.1.23.2 UI-B** and **3.1.23.3 Finalization**. Append the roadmap node after
22 to preserve the consecutive-number guard and all current task identities. Explicit dependencies
place execution after accepted feature work through 3.1.15 and before 3.1.16–3.1.19. Amend the
numeric-order guidance for this one side group; 3.1.19 remains the final acceptance session.
Historical “former 3.1.23” remains the surfaces finalizer, now 3.1.9.8 / `dash-surfaces-finalizer`.
The new IDs below are distinct; no existing stable ID or historical evidence is renamed.

| Admitted task / stable ID | Exact required inputs | Owning `doc:` binding |
| --- | --- | --- |
| 3.1.23 / `dash-ui-baseline` | `dash-surfaces-finalizer`, `dash-date-navigation`, `dash-operations-finalizer`, `dash-activity`, `dash-queue`, `dash-detail-finalizer`, `dash-production-runtime` | `3.1 §UI refinement side group` |
| 3.1.23.1 / `dash-ui-settings-records` | `dash-ui-baseline` only | `3.1 §UI refinement side group` |
| 3.1.23.2 / `dash-ui-workflow-interactions` | `dash-ui-baseline` only | `3.1 §UI refinement side group` |
| 3.1.23.3 / `dash-ui-finalizer` | parent and both worker candidates | `3.1 §UI refinement side group` |

The roadmap parser accepts one task-file stem, not nested subdirectories. Bind all four nodes
to the parent phase's `UI refinement side group` routing section; it links the exact owners here
and in the two worker files. Roadmap tags remain on those actual owners. No parser change or
duplicate plan is needed.

Add `dash-ui-finalizer` to existing needs for `dash-realtime`, `dash-performance`,
`dash-proof-infrastructure` and `dash-acceptance`; remove no edge. Add the group to the phase map
and focused cadence, and note the new input in those four downstream task owners. Keep optional
3.1.20–3.1.22 optional. Record the execution-order exception in roadmap Governance. All new nodes
start `planned`, with unchecked implementation/proof; planning completion cannot tick them.

The approved planning commit changes only this directory, the parent phase README, those
four downstream task documents, roadmap source and generated `docs/roadmap/index.html`. Reconcile the six stale 3.1.14.1–3.1.14.6 roadmap statuses from their accepted integration
and retained proof; do not claim new test execution. Existing instruction pairs and acceptance
matrix remain unchanged. No UI code, product contract or new
package is introduced. Roadmap admission does not authorize launch, master integration or push.

## Shared prerequisite release
<!-- roadmap: dash-ui-baseline -->

**Not released. No accepted UI launch base exists yet.** The exact accepted feature input is
`beb2a79b6bd699afb3701ee8aeb3ec3bfe011a1a` on local master. A later accepted baseline integration SHA, followed
by its release-record commit, must be recorded before either worker branches. Never substitute
the old planning SHA or this feature input for that release.

| Verified state | Evidence / remaining work |
| --- | --- |
| Feature prerequisites through 3.1.15 complete | Accepted surface/date/operations/Activity/Queue/detail/runtime integrations are master ancestors. Current worktree inventory confirms their removed worktrees. |
| 3.1.14.1–3.1.14.6 tracking correction | Accepted combined merge `095be697774621a673e08759f775236cfa06ae00`, closure `7c524542aa3b4051b7847f264fb571fb43ebaa6d`; retained finalizer proof: 550 focused tests and 60 parity cases, lint/typecheck/build checks. Correct stale roadmap `planned` labels. |
| 3.1.15 complete | Accepted merge `87016e631d6bcb5bbb323df539598e5af473e73b`, closure at inspected master; 164 focused unit tests and two affected parity guard cases. |
| 3.1.23 incomplete | Test separation/guard repair, clean inherited references, reachable-state inventory, actual specimen/zoom/resource proof and accepted baseline release remain required. |

Retained detail proof is at
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.14-detail-children-2026-09-22/3.1.14.6/verification.md`.
These are verified prior receipts, not reruns during planning. Full repository acceptance stays at 3.1.19.

The operator opens the prerequisite separately. It must perform these steps before either UI worker:

1. Verify every named predecessor's accepted integration/cleanup and approved plan availability.
   Bind the exact product base; refresh the ownership manifest for all new feature paths and tests.
   Material ownership, scope or shared API changes return to the operator before affected edits.
2. Move **only the unchanged `catalog-search` scene** and its fixture import from
   `tests/parity/helpers/reference-explorer-scenes.ts` to
   `tests/parity/helpers/reference-settings-scenes.ts`. It renders Settings → UI catalog. Preserve
   scene ID, route, themes/viewports, geometry/page-error assertions and reference bytes. Run both
   specs in assert mode plus `surface-fixture-boundaries.test.ts` and the reference-corpus guard.
   Repair `parity-reference-authority.test.ts`'s obsolete `reference-detail.spec.ts` registration
   expectation: explicitly cover all five split specs and their guarded `run-detail/shared.ts`
   capture path, preserving exact membership, geometry-before-capture and page-error assertions.
   Do not restore duplicate captures or remove coverage. Update the guard inventory for changed scope.
   Establish clean `diagnostic-bundle-dialog.spec.ts` and `failure-resolution.spec.ts` assertion
   baselines: the retained 3.1.14.4 receipt reports two stale descriptor-metadata references among
   20 cases. Prove input drift and attribute any refresh; do not treat an inherited focused failure
   as a passing prerequisite. This test-only correction
   belongs to the common prerequisite, never to either parallel worker.
3. Inventory every reachable owned section/dialog/state and external consumer. Existing shared
   primitives support the requested composition: Button/IconButton, Field/Input/Select/Textarea,
   Panel/TakeoverFrame, DialogContent/Body/Footer, DrawerContent, Popover, Refusal/Banner and Table.
   Optional dialog descriptions, existing widths, body scrolling and token spacing need no sibling
   API changes. Confirm that judgment in the actual `/kit.html` specimen through playwright-cli.
   Modal help uses inline disclosure because Popover uses the lower menu layer.
4. Freeze shared resting rendering inside otherwise owned files: `SettingsGear`, `StorageBanner`,
   `RunStartButton`, NotificationBell's closed trigger/count and PreflightPopover's closed trigger.
   Preserve geometry, labels, badges, public props and behavior: both workers' full-page references
   include them. Keep inline queue/detail action rendering in `actions.tsx` unchanged; open owned
   dialogs/menus may be refined. Preserve Settings' served scalar labels, `Keep editing` and
   `Discard changes` used by Notifications' dirty-exit regression. Friendly object-property labels
   can change within UI-A's controls/tests. No shared consumer needs the sibling's unmerged code.
5. Bind current focused commands and isolated browser resources. UI-A adds Setup/preflight and
   Session controls tests. UI-B adds the Logs, Context/Data and Gates split specs plus their exact
   listed reference triples. Those routes expose only frozen closed/collapsed UI-A controls;
   verify unchanged backgrounds so each candidate can pass independently. Shared fixtures and
   capture wiring stay frozen. No worker may defer a failing assigned snapshot to finalization.
   Preserve the complete finalizer reference corpus, including other run-detail variants. Record a working actual browser
   zoom mechanism and effective CSS viewport for D04. The accepted `queue-authority.spec.ts` already demonstrates Chromium extension-based
   `chrome.tabs.setZoom` with effective CSS-size checks. Reuse that supported mechanism in the
   repository parity lane; manual browser inspection still uses playwright-cli. Existing CSS-zoom
   tests in Notifications and Archive do not establish real browser zoom. If the prescribed
   lane cannot produce it, leave that prerequisite proof open rather than substitute device scale.
6. Pass focused tests, scoped lint and affected quick checks; retain receipts. After separately
   authorized integration/cleanup, publish the accepted common integration SHA and plan commit
   here and in `ownership.json`. Both workers branch from that exact SHA after the release record
   is available. Distinguish product base, candidate, integration and recording commit; invent none.

## Gate resources and finalizer commands

A configuration probe found that `--maxWorkers=2` changes Vitest's root setting but leaves all
three configured projects at four workers. Use a temporary adapter in each worker's evidence
folder, importing **that worker's** real config:

```ts
import base from "/absolute/owned-worktree/vitest.config.ts";
export default {
  ...base,
  test: {
    ...base.test,
    maxWorkers: 2,
    projects: base.test.projects.map(project => ({
      ...project, test: { ...project.test, maxWorkers: 2 },
    })),
  },
};
```

Run the listed unit commands with `--config <absolute-owned-adapter>` after `--`. Before use,
resolve base and adapter configurations: only root/project worker counts and Vitest's automatic
exclusion of its active config path may differ. Both config paths lie outside `src/**`; coverage
membership is unchanged; compare automatic coverage exclusions as a sorted multiset because
project initialization can reorder them. Preserve includes/excludes, isolated forks, execArgv, deadlines, coverage
floors and passWithNoTests. Retain resolved outputs. Configuration feasibility is not a test pass.
Each worker runs one unit/parity process at a time with two workers, for four combined. Parity
uses `--workers=2`, not its five-worker default. Recheck other active runners and host capacity.

Parity bundle/output and `.tracker/locks/parity-json-report.lock` resolve under each real worktree;
fixture servers use ephemeral ports and private temporary state. Do not share mutable symlinked
outputs, `.tracker`, authority or auth roots. `/tmp/hrt-<uid>` contains uniquely owned run folders;
never reap peer processes. Manual browser sessions and evidence paths stay uniquely named.

At the 2026-09-23 check, only `hr-worktree-ui-plan` occupies an auxiliary worktree slot;
master is the integration checkout. All four proposed branch/path pairs are absent and available,
not reserved. The plan, baseline and two workers would use four slots; finalizer creation waits
for authorized baseline cleanup. Recheck capacity and ownership at each launch. No other task's
resources may be removed by this assignment.

The finalizer verifies exact candidate/base/allowlist identity and both merge orders, then runs
both workers' focused tests and parity specs on the combined tree, `npm run typecheck`, scoped
ESLint and `npm run web:build`. Add focused shared specs `shell-navigation.spec.ts`,
`reference-queue.spec.ts`, all five `tests/parity/run-detail/*.spec.ts`,
`dashboard-reference.spec.ts`, `failure-resolution.spec.ts`,
`backfill-gap.spec.ts`, `panel-heading-accessibility.spec.ts` and `pool-control-desktop-target.spec.ts`.
Use up to four effective workers after rechecking resources. Preserve all assertions and repair
failures; shared reference changes need attribution and assert-mode reruns. Only the finalizer
owns combined shared-scene updates, overview/manifest, parent/roadmap and generated records.
A newly required shell/primitive redesign needs an amendment, not an unowned finalizer surprise.
Operator-controlled master integration/cleanup and 3.1.19's full proof remain separate obligations.

## Approval and readiness

The operator's conditional UI-A/UI-B implementation scopes and panel/calendar amendment are
retained; draft status never establishes admission. The operator approved persistence and commit of these planning documents on 2026-09-23. It does not implement UI, launch implementation workers,
merge or push. Future launches use `/sol-orchestrator`, `/luna-worker` and `/ui`; one Luna xhigh
implementer per worker assignment, no nested dispatch, root acceptance and no independent review
under the Phase 3.1 cadence.

**Prepared, not launch-ready.** The remaining release tasks are exactly those in the shared
prerequisite above. Feature prerequisites are complete; the baseline's focused acceptance,
authorized integration and cleanup remain open. Admission is approved and recorded in this planning commit; the baseline release must consume that committed plan.

The planning branch is `codex/plan-ui-refinement` in
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-plan`.
The owned drafts were preserved with SHA-256 verification under the evidence directory, and the
planning branch was advanced from `f93994501` onto the accepted feature base before applying the
approved amendments. Master is unchanged. The planning commit contains only the exact approved
document paths and generated roadmap. No runtime gates are claimed by this planning commit.

### Planning validation

The approved manifest contains 23/30 source files, 31/31 unit-test paths, 15/13 parity
specs, 5/3 helpers and 387/336 reference files for UI-A/UI-B. Every listed existing source/test/
reference path exists; write intersections and transitive source crossings are empty. Exact
reference IDs and variants, not broad prefixes, control refreezing. Each worker owns only its
plan record. Unlisted existing files are frozen; shared records belong to admission/finalization.

The approved roadmap candidate parses, schema-validates and has an acyclic dependency graph.
Applied-document validation and generated freshness pass. Receipts are under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-plan-2026-09-23/`.
No new runtime tests, screenshots or visual acceptance are claimed by this planning audit.

Approved planning commit checks:

- `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts tests/unit/roadmap/roadmap-ui.test.ts`: 31 tests passed in two files (`roadmap-tests.log`).
- Scoped ESLint for the roadmap generator, parser, scanner, schema and those two tests: passed with `--max-warnings 0` (`scoped-lint.log`).
- `check-plan.py`: 163 local links/anchors and 38 command test paths resolve; zero ownership intersections or transitive worker-source crossings; all nine instruction twins match (`document-checks.json`).
- `npm run roadmap`, `npm run roadmap:check` and `git diff --check`: passed. The final evidence-only prose update preserves the tested node graph, bindings, headings, status blocks, source and test configuration.

This commit is a planning release, not completion of 3.1.23 or either UI worker. The final commit
identity is available from `git log -1 --format=%H --` on this file and from this task's closing report.
