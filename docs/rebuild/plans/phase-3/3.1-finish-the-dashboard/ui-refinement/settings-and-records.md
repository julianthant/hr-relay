# UI-A: Settings and records

Status: **execution authorized; candidate not accepted**. Task **3.1.23.1** (UI-A).
The operator waived the 3.1.23 release prerequisite for this execution on 2026-09-23 and approved
[bounded execution assignments](#execution-allocation). Astra high owns design decisions and
acceptance; Luna xhigh assignments own implementation and focused repairs.
Read the [shared brief](README.md), particularly the frozen base, design rules, file allowlists,
gate cadence and finalization conditions. This plan never waits for UI-B's implementation.

## Approved Settings design-system implementation — 2026-09-26

The operator approved the revision-3 Settings designs in this session and explicitly authorized
implementation, with one final correction: the Add key button needs normal horizontal padding.
This amendment supersedes the earlier Settings-only freezes on shared primitives, settings section
membership, provider editing, and runtime-path editing for this assigned change. It does not reopen
Archive, Activity, Sessions, Calendar, or unrelated workflow behavior. Settings begins the common UI
update; future pages will reuse the same primitives.

- Candidate checkout: `/Users/julianhein/.codex/worktrees/9d88/hr-automation-rebuild`.
- Dedicated branch: `codex/settings-design-system`; accepted input: `8cdf38b2a` (master including
  System hosts retirement). This chat owns the checkout; sequential category workers reuse it.
- Visual authority and implementation brief:
  `/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/prototypes/tabs/`.
  Read `ui-kit-replacement-brief.md`, `revision-2-brief.md`, current HTML, and current screenshots.
  The latest user direction and this amendment override superseded prototype caveats.
- Body density is 90% of revision 2: 828px maximum width, 27px title, 13.5px labels, approximately
  32.4px controls and 62.5px two-line rows. Sidebar stays 288px and keeps its approved typography.
  No CSS zoom/transform. Both themes and 1024px desktop/zoom access remain required.
- Consolidate to 11 tabs: General (Display and single Job end date included), Performance, Paths
  (editable runtime locations included), Routes, Provider budgets & models, Credentials (provider
  keys included), Storage checks, Preflight, Workflow capabilities, Keyboard, UI catalog. Remove
  Observed host; preserve retired System hosts. Remove annual-year management and Kronos-period UI,
  not historical stored data. Navigation durations use fixed seconds with correct stored-unit mapping.
- Replace old DS primitives/specimens through the existing `ds/ui.tsx` barrel and real `kit-page.tsx`;
  do not fork a Settings-only kit. Shared forms, rows, grouped surfaces, search, disclosures, secret
  fields, ranked lists and confirmations use existing HeroUI/shadcn foundations. Retire superseded
  local styles after their consumers migrate. Keep unrelated page layouts stable during this phase.
- Credentials/provider keys are masked by default with individual eye and trash controls. Provider
  groups follow selected concept B from referenced chat `01a0db65-9bcc-7f13-98fb-0fef9bb34de3`:
  editable keys, autosave, Add key, and centered icon-free removal confirmation. Preserve false/unknown
  save states and saved-versus-active restart semantics. Use supported authenticated BFF contracts;
  never edit real credentials or move live state during verification.
- Paths editing must preserve runtime isolation and coupled settings/database authority. Resolve
  persistence/activation against current boot authority before implementation; an unsafe direct path
  rewrite is not an acceptable shortcut. Record consequential contract changes at their owner and
  decision index in the same logical commit.

### Category 2 Settings shell and ordinary forms — 2026-09-26

The operator approved Category 2 implementation in the existing candidate checkout after the shared
design-system commits `cf90206a9` and `ac6bb8ec7`. These commits own the accepted DS APIs, the 90%-scale
body tokens and contrast corrections; Category 2 consumes them through `ds/ui.tsx`. All eleven tabs
use the same 828px maximum body scope. General folds in Display and shows only the server Clock's
current-fiscal-year `jobEndDate`; Performance shows fixed seconds while preserving millisecond values;
Paths groups ordinary editable paths with runtime-path facts in their existing truthful
read-only state; Routes keeps its explicit Save; Credentials temporarily combines the existing
credential authority with read-only provider-key facts. Provider-key persistence, budget/model
internals and diagnostics remain with later categories. Existing 700ms ordinary autosave, separate
protected editing, revision/conflict/refusal/readback behavior and dirty-exit protection remain.

D350 records the authorized date/schema compatibility boundary: optional live Kronos dates, required
job end date, no authority-version bump or historical record rewrite, and strict pinned v2 backup
compatibility for the pre-change hash. It does not authorize editing or relocating state/artifact
roots in Category 2; their separately approved offline relocation remains with later runtime-path
work. Category 2 owns the D350 amendment here and in `clock-config-secrets.md` plus
`reference/decisions.md` in the same logical change.

The Category 2 execution worker owns its shell/general/display/job-date/performance/routes proof,
focused tests, scoped lint and affected static checks. It does not run full parity or full-repository
gates under the Phase 3.1 cadence. Root owns candidate acceptance and combined verification.

### Category 2 execution record — 2026-09-26

The candidate is based on `ac6bb8ec7` on `codex/settings-design-system` in
`/Users/julianhein/.codex/worktrees/9d88/hr-automation-rebuild`. The shell now has the eleven
canonical tabs and legacy aliases, with all page bodies using the shared 828px scope. The retained
render captures are `settings/general-dark-1440x900.png`, `settings/general-light-1024x768.png`,
`settings/performance-dark-1440x900.png`, `settings/paths-light-1024x768.png`, and
`settings/routes-dark-1440x900.png` under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/`.
Observed geometry: body scope is 828px at 1440px and fills 688px at 1024px after the 288px sidebar
and page gutters; horizontal form rows are 62.5px. The fixture build and visual check showed one
required Job End Date control and no other-fiscal-year or Kronos-date controls. Routes labels remain
connected to their generated input IDs. Dirty-exit keyboard/focus behavior is covered by the 17-test
takeover-focus run. The headless playwright-cli session did not provide browser-level zoom, so actual
desktop zoom remains unverified; the 1024px desktop viewport and keyboard behavior were checked.

Focused tests used the approved two-worker Vitest adapter and `npm run test -- --config <adapter>`.
`vitest-unit-11-final.log` passed 11 files / 201 tests; `settings-file-service-final.log` passed
50 tests; `bff-flow-final.log` passed 152. Additional regression runs passed 3 files / 44 tests
(`settings-existing-consumers-final.log`), 3 files / 47 tests
(`settings-nav-editor-backup-final.log`), 4 architecture files / 68 tests
(`architecture-focused-final.log`), and 17 focus tests (`takeover-focus-final.log`). These later
runs overlap earlier membership and are not additive counts. The earlier combined run with timeouts
is retained as failed diagnostic evidence; the 17-test focus file reproduced a worker exit at 10/17
before the focus restoration fix and passed after it. Scoped ESLint and `git diff --check` passed.
`web-build-final-2.log` passed with the existing >500 kB chunk warning. Typecheck still reports only
the shared-kit Category 1 errors in `src/dashboard/kit/kit-page.tsx` and
`tests/unit/dashboard/ds-body-primitives.test.ts`; those files are outside this category and remain
assigned to root. Exact logs and renders are retained in the evidence directory above. Full parity,
repository-wide gates and real desktop browser zoom were not run.

### Category assignments and gates

Root owns design, behavior decisions, acceptance, and combined verification. Native Luna xhigh
workers own all implementation and repairs. No nested dispatch or independent review in Phase 3.1.
Writers run sequentially in this owned checkout; read-only investigation may overlap a disjoint writer.

1. Shared DS primitives and real UI kit, including the Add key padding correction.
2. Settings shell, General/Paths/Routes/Performance and section consolidation.
3. Credential/provider persistence and UI, including activation and deletion behavior.
4. Provider budgets/model ranking.
5. Diagnostics/reference tabs, cohesive cleanup and final focused render/interaction proof.

Each category stops with focused tests, scoped ESLint, diff checks, a logical commit, and retained
before/after evidence. Root inspects actual diffs and results before releasing dependent work.
Match tests to behavior, preserve assertions/membership/timeouts, and deliberately attribute changed
visual references. Run affected architecture/static checks and combined typecheck as appropriate.
Full repository coverage/lint/broad parity remain at 3.1.19 under the phase cadence; no claim they
passed is permitted here. Shared-primitives changes require representative consumer inspection and
focused kit proof now, with broad obligations recorded. Use playwright-cli for browser operation.

Integration owner is the user. Completion here produces an accepted local candidate; no merge,
push, new worktree, automatic next-task launch, or cleanup of peers is authorized.

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

- Accepted feature input: `beb2a79b6bd699afb3701ee8aeb3ec3bfe011a1a`; initial branch/plan
  commit: `fac236fbc2c27192c31fdfbca3e2a5512d870800`, with unchanged product code between them.
  The 3.1.23 release is waived for UI-A, not completed. Retain its unperformed shared repairs and
  proof as explicit obligations; this exception does not release UI-B or change finalizer gates.
- Existing branch: `codex/3.1-ui-settings-records`.
- Owned checkout: `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-settings`.
- Exact source/test/reference ownership: the closed UI-A paths in [ownership.json](ownership.json). New helpers/tests use
  `ui-settings-records-` prefixes. This file alone receives UI-A progress and candidate evidence.
- Target: operator-controlled finalization branch, then `master`; either worker merge order works.
- Lead: `/ui` Design, refinement within the existing system; Content support.
- Execution: `/sol-orchestrator` with `/luna-worker`; Astra high is the explicit root-model override
  for this task. New native workers use `luna_worker_xhigh`, standard speed, with no nested dispatch.
  The root accepts completed outcomes and the combined candidate. Phase 3.1 requires no independent reviewer.

## Execution allocation

UI-A permits multiple bounded assignments; the whole manifest is not one automatic worker brief.
Preserve current edits, receipts and settled decisions. Verify the existing writer before resuming it;
checkpoint and stop it before transferring its paths. Reuse a session while its context remains useful.

| Outcome | Included work | Acceptance emphasis |
| --- | --- | --- |
| Settings | A2–A3, all subsections and their help/catalog/dialogs | Control hierarchy; draft/save/clear/conflict behavior and rendered comparison. |
| Records | A4 Archive and Activity, including confirmations/viewers | Scannable records; selection/export/delete consequences and rendered comparison. |
| Sessions and Calendar | A4b–A4c | Expanded/open hierarchy; keyboard/focus, unavailable states, real zoom and unchanged collapsed controls. |

Apply A1 inventory and A5 consistency checks to each outcome; retain all manifest entries and proof.
Adapt order to verified progress. Reuse attributable baseline evidence when inputs are unchanged;
capture missing required states before editing that surface, then implement. Do not restart the whole
inventory or expand baseline work beyond assigned proof.

Before dispatch, the root settles consequential layout, grouping and copy direction using existing
tokens and inspected examples. Give the worker that concise direction, owned paths and deciding checks.
The worker handles discovery, implementation, focused tests/lint and routine repairs for its outcome.
The root inspects completed patches, critical behavior and before/after renders, then batches corrections.
Intervene earlier for material scope, contract or verification violations; report only new evidence,
accepted outcomes, blockers and decisions. Do not direct every small edit or repeat unchanged status.

Sequence coupled writes. Parallel assignments require stable inputs, disjoint source/test/evidence
ownership, independent acceptance, isolated worktrees/resources and available capacity. Record exact
bindings and an authorized integration/cleanup owner before dispatch; this allocation grants no new
merge permission. Read-only parallel work must answer a concrete independent question. Complete the
combined focused acceptance before finalizer intake; additional agents and independent review are not gates.

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

### UI-A Settings checkpoint — 2026-09-23

Status: **Settings implementation and focused proof complete; checkpoint committed for root
acceptance.** UI-A Records and Sessions/Calendar work remains assigned separately. The exact
checkpoint revision is reported in the returning task message.

- Plan / input: approved planning commit `fac236fbc2c27192c31fdfbca3e2a5512d870800`; accepted
  product input `beb2a79b6bd699afb3701ee8aeb3ec3bfe011a1a`.
- Base / worktree: `4eb263c16909d7d866792cdde8ffd02361d6bcf3`; branch
  `codex/3.1-ui-settings-records`; `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-settings`.
- Scope: Settings authority, field, editor, host, keyboard, capability and storage presentation;
  `ui-settings-records-labels.ts`; the Settings unit/parity proof and Settings-owned references.
  The UI-A-only approval to skip 3.1.23 remains in force; its skipped shared repairs and proof are
  **not passed** and are not represented by this checkpoint.
- Explicit fixture authorization: the user authorized the narrow helper repairs in
  `tests/parity/helpers/fixture-settings-activation.ts` and `tests/parity/helpers/session-runtime.ts`.
  This checkpoint includes only the Settings-owned activation helper; `session-runtime.ts` stays
  with the Sessions/Calendar assignment. The changed Archive report file also stays with Records.
- Render checklist: both themes, at 1440×900, inspected for General, Display, Performance, Paths,
  Test routes, Annual dates, Provider budgets & models, Credentials, Provider availability,
  Observed host, Deployment, Storage health, System hosts, Workflow capabilities, Keyboard and UI
  catalog. Paths, Annual dates, Provider budgets & models, Credentials, Deployment and Storage
  health also have both-theme captures at 1280×720, 1024×768 and 1024×720. Actual browser zoom was
  verified at 125% from 1280×720 (CSS 1024×576) and 200% from 1440×900 (CSS 720×450), in both
  themes.
- Interaction checklist: grouped fields and accessible identity details; saved/active/default and
  absent-source facts; coupled Display width→height Tab order; dirty, reset, clear, discard, save,
  refusal, conflict and unknown outcomes; dirty-exit confirmation; masked credentials and presence
  details; storage doctor/recovery; preflight states. Settings preflight trigger and
  `Keep editing` / `Discard changes` remain unchanged. The desktop and real-zoom proof confirms
  the expanded identity disclosure and final input each scroll fully above the fixed Save/Discard
  footer.
- Focused gates: 13 unit files / 133 tests pass via the verified two-worker adapter; the assigned
  73-case parity assertion passes with `--workers=2`; scoped ESLint passes with `--max-warnings=0`;
  `git diff --check` passes. The parity gate includes both-theme inventory, source-value and
  activation interactions, Setup/preflight, storage doctor/recovery and the exact `catalog-search`
  scene. No broad repository gate or independent review was required here.
- Reference attribution: deliberate refreshes are limited to owned `settings`, `settings-activation`,
  `settings-catalog`, `storage-settings`, `storage-doctor-degraded`, `setup-preflight`, and exact
  `catalog-search` triples. The last one changes only because the existing catalog-search scene now
  captures the served preflight toolbar trigger; other Explorer scenes remain frozen. Final
  assertion evidence is in
  `/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-2026-09-23/receipts/settings-parity-focused-final-2workers.log`.
- Before images: `.../screenshots/before/settings-inventory/`. Final images, attached accessibility
  trees and real-zoom proof (218 files) are in
  `/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-2026-09-23/screenshots/after/settings-probe-output-checkpoint/`.
  Changed copy with stable review IDs is recorded in
  `/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-2026-09-23/settings-copy-changes.md`.
- Retained check receipts: `settings-focused-unit-final.log`, `settings-eslint-final.log`, and
  `settings-parity-focused-final-2workers.log` under the evidence `receipts/` directory above.

### UI-A Records checkpoint — 2026-09-23

Status: **Records implementation and focused proof complete; candidate ready for root acceptance.**

- Plan / input: approved planning commit `fac236fbc2c27192c31fdfbca3e2a5512d870800`; accepted product input `beb2a79b6bd699afb3701ee8aeb3ec3bfe011a1a`.
- Base / source candidate: `e08007ebbddef47550c95c20a10493c4113d6e71` → `d745f6066356b091e1e3a2c4e00641403141b9b7`; branch `codex/3.1-ui-settings-records`; worktree `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-settings`. The candidate commit contains only Records source, tests and owned references. The task checkpoint is a separate docs-only commit.
- Scope: Activity report range and existing CSV/XLSX exports; Archive saved-report list/detail, filters, attachments, saved version form/history, and delete dialog. Frozen `archive.tsx`, `archive-model.ts`, APIs, authority rules, shell, toolbar and tokens remain unchanged. Activity search was not added.
- Behavior checklist: visible selected-report state and clear filters; active date-range summary; structured saved facts, neutral exact saved outcome labels and collapsed report identity; exact attachment selection with missing/unavailable/corrupt/read failures retained as distinct states; cancel/Escape/focus return and visible refusal/unknown deletion response inside the named dialog; no automatic retry or premature success; late deletion response does not replace the current selection; major/minor consequence copy, version state, target/scope, reviewed membership, blockers, archived runs and progress remain visible.
- Render checklist: both themes at 1440×900, 1280×720, 1024×768 and 1024×720 for Archive/Activity; delete dialog at 1024×720; Versions form and planned-change view at 1440×900. Real browser zoom used `chrome.tabs.setZoom`: 125% from 1280×720 (CSS 1024×576) and 200% from 1440×900 (CSS 720×450), both themes. At 200%, the 1024 CSS px desktop floor remains and tested content/actions are reachable by horizontal/vertical scroll.
- Focused gates: four assigned unit files pass, 40 tests; owned Archive/Activity parity passes, 57 tests with two workers; exact owned reference refresh assertion passes, 49 tests; final UI-A Records matrix and real-zoom capture pass, four tests across two themes; scoped ESLint with `--max-warnings 0` and `git diff --check` pass. Receipt files are under `/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-2026-09-23/records/logs/`: `records-unit-final-pass-2.log`, `records-owned-parity-final-pass-2.log`, `records-parity-refresh-with-proof.log`, `records-final-capture-with-actions.log`, `records-eslint-final-after-actions.log`, and `records-final-diff-check.log`.
- Reference attribution: changed only owned triples in `activity-report`, `activity-report-unavailable`, `archive-evidence`, `archive-ledger`, `archive-report-saved`, `archive-report-zoom`, `archive-run`, and `archive-version-bump`. The exact Records refresh reflects current descriptor (`71b1674` → `67c72b`) and served preflight-trigger metadata drift in those owned triples; no frozen source was changed and no global refresh ran.
- Final screenshot/a11y captures: `/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-2026-09-23/records/final/records-matrix-final/` and `records-zoom-final/`; capture attribution and source/artifact SHA-256 manifests are alongside them. Exact old/new copy with stable review IDs: `records/records-copy-changes.md`. Limits: `records/scope-limits.md`.
- The approved UI-A-only exception skips release UI-A 3.1.23. Its skipped repairs and proof are **not passed**; broader repository gates remain for the phase finalizer. Sessions/Calendar remains outside this checkpoint.

## Resume prompt

Resume the existing execution under its UI-A-only prerequisite exception. Verify actual current HEAD
and dirty state; do not reset the branch to its initial planning commit.

```text
Continue UI-A with Astra high as orchestrator and /luna-worker plus /ui.
Read this amended task owner and verify the existing branch, worker, edits and evidence.
Preserve my approval to skip the 3.1.23 release for UI-A; do not claim skipped checks passed.
Do not restart discovery or create a new root session.

Own consequential design choices and acceptance. Delegate bounded outcomes with tests and repairs:
Settings, records, then Sessions/Calendar, adapting order to verified progress. Multiple Luna xhigh
assignments are permitted. Reuse useful context; stop the previous writer before transferring paths.
Parallelize only proven independent ownership and proof within existing capacity and integration rules.

Inspect completed renders and critical behavior, batch corrections and report meaningful changes.
Preserve the closed manifest, frozen surfaces/APIs, tests and required focused unit/parity, lint,
both-theme and real-zoom proof. Reuse valid baseline evidence. No independent review under Phase 3.1.
Do not silently absorb shared prerequisite repairs or weaken checks.

Commit exact owned paths and this worker record. Return candidate/base/plan SHAs, checks, screenshot
attribution and deferred proof to finalizer 3.1.23.3. No merge, push, shared roadmap/manifest edits,
new roadmap task or nested worker dispatch.
```
