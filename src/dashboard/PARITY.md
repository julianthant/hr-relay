# Dashboard parity rulings

Read before changing a listed deviation or judging reference parity. These are operator-ratified
exceptions, moved from the instruction pair on 2026-09-04; relocation does not revoke them.
The current owning contracts supersede dated claims. `DESIGN.md` remains the visual authority.

## Approved mixed queue presentation (2026-10-01)

The operator-approved queue and navbar presentation is owned by the
[dashboard presentation amendment](../../docs/rebuild/reference/dashboard-surfaces.md#frontend-only-dashboard-presentation-amendment--2026-10-01).
It supersedes the demo's leading row/info icons, inline attempt chip, grouped workflow-batch UI and
tiny header progress marks. Preserve the gray provenance footer, current fonts and status bands;
place bulk selection outside the card, attempts in the footer dropdown, pipeline labels below the
segmented bar, and operation members in Name/Status columns with a boxed finished/total count.
Review messages are blue; Write parked remains yellow. Existing reference screenshots have not been
refrozen. Focused presentation and interaction specs verify this approved change in both themes.

## Approved log blocks and image workspace (2026-10-02)

The [dashboard presentation amendment](../../docs/rebuild/reference/dashboard-surfaces.md#frontend-only-dashboard-presentation-amendment--2026-10-01)
owns the 33 local examples, neutral frames, required-only continuation forms, ordinary follow-up logs,
fitted indented notices and timestamps in the surrounding log. Keep the established typography and
shared DateInput calendar. The viewer has bounded previews, a thumbnail sidebar, fit/zoom/rotate,
comparison, outside dismissal, explicit load/mismatch errors and Retry. Preserve the complete pipeline:
earlier completed stages retain their state and durations, future stages are gray without visible
“Upcoming” text, and only the affected
stage/substep changes color. Focused dark/light 1024/1440 interaction and accessibility checks cover
these approved changes. Reference screenshots have not been refrozen; backend wiring remains deferred.
Logs defaults to a labelled fictional history matched to the selected subject and status; the separate
Selected run · queue facts view contains only served facts. Person Lookup mocks use UCPath/CRM
captures and four stages with named substeps and sample durations. Inline attention blocks open in
view while preserving earlier history. Local continuation changes the sample timeline. A blocked-write
row uses a labelled Separations sample. Queue selection resets sample choice and local decisions.
Single previews have a 128px image area and at most 360px width; browser
previews use 96px image areas. Dimension validation measures the detached decoded source, retaining
real mismatches and decode failures instead of rejecting a scaled preview.

## Archive polish and Explorer workflow mocks (2026-10-02)

Archive's mounted presentation is superseded by the 2026-10-03 original-layout mock below.
Explorer adds fictional Onboarding and Emergency Contact paths to the existing
Separations preview, including source returns, identity/review stops, duplicate handling and dry-run
branches. All three begin with declared browser systems; contact authentication remains after packet
review. Onboarding puts Hire type in step 2, with eleven ordered steps and corresponding source links
and stops. Single dates render the shared HeroUI DatePicker with its default Calendar; every range
uses the documented two-month RangeCalendar. Calendar interiors retain HeroUI geometry; date fields
retain editable segments and suffix icons with DS button borders, radius, heights and neutral colors.
The date field above Logs keeps its own exterior; Navbar history controls are separate. Focus and invalid states remain visible. Both calendars
share the product palette. Activity endpoints stay visible for every period; presets synchronize both
dates, and manual endpoint edits select Custom. Incomplete drafts retain the applied report range.
Either endpoint opens the centered shared range picker, and the second date commits without footer controls.
Archive and Search retain open-ended field entry.
The 2026-10-04 operator revision makes Spreadsheet Settings use the shared Settings heading, ordinary
buttons with 14px icons and underline tabs, retaining the existing theme and blue spreadsheet accent.
Time saved uses Activity's table typography, spacing and alternating rows, with compact minute inputs
and coverage, manual/assisted totals and estimated savings in its footer.
Workflow readiness separates returned requirements from compact workflow disclosures. Each disclosure
shows available/unbuilt counts, six served operations in two columns and its exact dry-run boundary.
The first workflow opens by default. The empty table header, nested frame and inline source footer are
removed; source and capability meanings remain available through info controls. Theme, scope filtering,
readiness authority, credential remedies and distinct loading/empty/refusal states remain unchanged.
The Focus Archive replacement was rejected on 2026-10-03. Focused desktop dark/light interaction checks
cover the changes; frozen reference screenshots remain unchanged. Mock workflows are presentation only and cannot start runs.

## Archive original-layout mock (2026-10-03)

The operator rejected the Focus Archive redesign. The app now mounts a visibly fictional local mock
of the original layout: dashboard-version groups, workflow folders, full filter strip, compact run
table and full-page reports with section navigation. Search and downloads use the exact local
selection. Workflow details owns dashboard/workflow versions, archived date, outcome and file count
once; the separate report metadata strip is removed. Workflow fields join details without repeating
Subject fields. The separate Fields navigation entry is removed; its old section links open details.
Steps becomes Logs using the shared LogPanel, timeline, field/action rows, saved failure blocks,
capture workspace and search/copy/latest controls. Historical logs expose no continuation actions.
The 2026-10-03 operator revision moves Explorer, Archive and Activity into Settings → Data and
removes the Navbar view switcher and those pages' operations toolbars. The data pages use ordinary
Settings `PageHeading`, `DsBodyScope`, spacing and scrolling rather than full-width nested takeovers.
Their controls and mock behaviors remain available within the content. Legacy data links, archive
report sections and Activity ranges survive reload and browser history. Settings drafts survive
section changes; returning to Dashboard retains the exit guard. Global sizing is unchanged.
Spreadsheets remains in Personal with its original available-width layout and no expand control.
Activity's report sections stack in one column at every desktop width. Explorer uses a workflow
dropdown on the right of its heading, without the workflow sidebar/search, Expand all, Collapse all,
Version registry or action legend control. The selected-workflow intro strip and Preview paths button are removed. Per-form disclosures,
branch selectors and source returns remain available; switching workflows resets transient timeline state while preserving dropdown
focus. Storage checks and Preflight put their actions and scope selector beside the heading, with
freshness, failures and unavailable states below.
Archive overview and folders use shared searches; the overview also has workflow/outcome filters. The 2026-10-04 revision uses HeroUI
SearchField for shared searches. The centered Navbar field opens a centered search modal on click,
Enter/Space or `/`, with keyboard Command results, clear control and focus restoration. Status/export/
choice menus use shadcn Base UI DropdownMenu; value controls use Base UI Select. RRSS HR and the date count are removed. The editable date and calendar sit above Logs, separate from Navbar history controls. The active Settings
gear returns to Dashboard through the draft guard. Settings navigation has tighter 32px rows, 10px
highlights and primary-foreground labels/icons; muted group labels are 14px. Section headings and field
labels use smaller regular type. Activity's rounded opaque table expands workflow rows to show supplied
versions. Log decision headers/bodies are opaque, and comparison tables have a border, muted header
and opaque difference highlights.
The original bump modal retains selected/all
workflow scopes and inline review, with no runtime write. Archive transport and commands are
unmounted. Other app surfaces keep their existing wiring. Shared single-date and range controls pass
their selected values, bounds and change callbacks to the calendars; invalid text drafts remain visible.

Focused mock behavior, component-boundary, lint/build and desktop browser checks apply. Existing
served-Archive browser/reference assertions remain unchanged as future reconnection acceptance;
this mock is not evidence that those authority journeys pass. Full repository gates and deliberate
reference replacement remain with 3.1.19.

## Focus queue integration (2026-10-03)

The approved Focus toolbar and queue-header filters replace the mounted legacy QueueToolbar.
Launcher and Start a run stay left; All statuses/sort stay right. Double/right-click and Shift+F10
open row actions; Select includes the row and replaces filters with checkbox/count/Delete/Archive/
Retry/X controls. Escape restores focus. New menu/bulk actions are labelled local mocks. Retry keeps
the exact authored settings object and original attempt history; it adds a pending queued attempt
without a command or Rerun dialog. Archive/Delete are local and reload restores the original queue.
Local queue counts differ deliberately from served day/rail counts after a mock action. Existing
served footer commands and recovery outcomes retain their wiring. Run input adopts the approved
Parsed input layout without the Examples strip, preserving descriptor validation, parsing and launch contracts.

Focused model, launch regression, dark/light 1024/1440 interaction, accessibility, lint and build
checks cover this integration. Existing frozen visual references and backend command acceptance
remain unchanged; their broad acceptance and deliberate refreeze stay with 3.1.19.

## Ruled deviations from the rebuild-demo

One shell affordance has no demo counterpart and STAYS, ruled by **D272 item 3**
(`ref dashboard-surfaces` §10; operator context is `docs/decisions/dashboard.md` §D272
item 3, answered A on 2026-08-26). It is recorded here so a later fidelity pass reads it as a
decision rather than as drift, and the site carries the same citation in code.

| Deviation | Where | Why it stays | Rejected |
|---|---|---|---|
| **Escape-clear in day search** — a first `Escape` clears a non-empty query; a second closes the dialog (ledger 1 A16) | `surfaces/day-search.tsx` | Clearing is the cheaper correction and the second press still reaches the dialog, so nothing the demo's Escape does is unavailable here | B — remove both for exactness |
| ~~**`Import spreadsheet` in the toolbar's left group** (ledger 1 A174 / B141)~~ | ~~`app/dashboard-app.tsx`~~ | **DISCHARGED by D296 (2026-09-01).** The 2026-10-02 operator amendment replaces D296/D298's Run-modal entry with Settings → Spreadsheets, organized by type. The new registry/import flow is explicitly mocked; backend intake contracts remain. See ref dashboard-surfaces §9.7.1. | B — remove both for exactness · **C — build the Run-Modal handoff first (LANDED)** |

Three more are ruled by **D273 items 5–6** (`ref dashboard-surfaces` §"D273 — run detail"; the
sheet is ledger 2, `docs/plans/2026-08-21-03a-fidelity-2-run-detail.md` §R-C). Same rule: each site
carries the citation in code.

| Deviation | Where | Why it stays | Rejected |
|---|---|---|---|
| **The Data section's `aria-label` is its VISIBLE label** (ledger 2 C16) | `surfaces/context-rail.tsx` | The demo's region says `Data` under a visible `Extracted fields` — a mismatch it inherited when its own visible label changed and its region name did not. Porting it would put two names on one region and undo the one-expression rule this bundle ratified for WCAG 2.5.3 (`intake.tsx`'s review checkbox). `DATA_SECTION_LABEL` feeds both halves so they cannot drift | A — port `aria-label="Data"` verbatim |
| **The unattributed ledger group takes no `Well` and no band** (ledger 2 C51/C54) | `surfaces/context-rail.tsx` | The demo has no counterpart because it always knows the step. The chrome ENCODES the step, so a group that has none has nothing to encode and an empty band would be D252's made-up heading in a quieter form. Its rows keep the dividers, which separate values rather than name a producer | B — give it a band with an invented or blank heading |

Seven more are ruled by **D275 items 2 and 8** and **D276 items 1–3** (unit V1, the Track F
vocabulary sweep; ledger 3 rows IN7, EX26, EX55, EX172, VB34/VB36, VB50). Same rule: each site
carries the citation in code.

| Deviation | Where | Why it stays | Rejected |
|---|---|---|---|
| **The intake workspace dismisses from its HEADER, and the word is `Close`** (ledger 3 IN7) | `surfaces/intake.tsx` | The demo's `Cancel` is a DIALOG footer button and D173 reshaped this surface into a workspace, which has no dialog footer. `Cancel` would also misname it: by the time the header is on screen the upload has created a durable session with an artifact behind it, so the control closes the workspace and cancels nothing. D298 removed the `Another file` reset beside it: it reset to the upload page, and there is no upload page | A — port `Cancel` into a footer this surface does not have |
| **The workflow list `Panel` takes an `aria-label`** (ledger 3 EX26) | `surfaces/explorer.tsx` | Two `Panel` landmarks sit side by side here, and a landmark with no name is one an assistive reader cannot tell from the other. The demo's list is a bare `div`, so it never had two landmarks to distinguish | B — drop the name for exactness |
| **The connector prints `no edge between them`** (ledger 3 EX55) | `surfaces/explorer.tsx` | `dependsOn` is a real declaration a descriptor may omit, so the demo's unconditional `always` would tell the operator that the next node WAITS for this one when nothing says it does — on the surface whose whole subject is what waits for what | B — print `always` on both arms |
| **The unknown-workflow empty state offers a door** (ledger 3 EX172) | `surfaces/explorer.tsx` | The arm is reached by a deep link naming a workflow the registry no longer serves; without it the operator's only exit from a stale bookmark is the URL bar. It names the workflow it opens, and is suppressed when the registry is empty | B — remove it; C — offer a generic "open a workflow" |
| **The bump record's fields are capped and counted** (ledger 3 VB34/VB36) | `surfaces/archive.tsx` | The caps ARE `VersionBumpChangeRecordSchema`'s own (`.max(200)` / `.max(1000)`), so the durable store will refuse a longer record. Meeting a limit as a refusal after the press is what this dialog's "there is no force arm" argument is against | B — uncap for exactness and refuse after the press |
| **The bump refusal enters through the shared transition** (ledger 3 VB50) | `surfaces/archive.tsx` | D275 item 2's own convention. The demo's refusal is fixture-authored and never arrives from a dispatch, so it has no counterpart; this one is the answer to a click and reads as a page change without it | B — render it with no transition |

The import button is gone (D296), which is what "neither is permanent" meant. The Escape-clear
is deliberately NOT a `shortcuts-model.ts` entry — the legend's own *When they fire* rules say an
open dialog owns the keyboard including Escape, and listing a per-dialog refinement as a global
binding would contradict them.


D334 / 1.6.4 retires the checkpoint-save action and its in-flight `Saving…` deviation.
The Context rail retains read-only data; source-bound Rerun values belong to 3.1.11-2.

## Desktop canvas (D340, 2026-09-06)

The operator replaced the 1180px shell stacking switch with a 1024×720 CSS-pixel minimum
canvas. Queue and detail remain side by side; smaller browser windows scroll. The affected
1024×768 references deliberately change, while larger desktop references retain their geometry.
Ref frontend-backend-integration §10 and ref dashboard-surfaces §9.9 own this amendment.

The 2026-10-04 permanent-shell revision makes Workflow and Settings navigation 264px wide and full-height above Sessions. The 48px Navbar occupies the remaining width. The full-height rounded bordered queue uses a 30% track with a 244px minimum. Its controls move to the rounded bordered 48px Action panel above Logs alongside the date picker. Logs retains a separate rounded bordered container with 12px canvas gutters; the workflow launcher and panel-mode shortcuts are removed. Legacy workflow labels are marked layout previews with fictional queues/logs. Notifications group actionable updates by workflow with no snooze or desktop-delivery controls. Base UI toast cards replace compact chips while preserving persistent errors, recovery actions, overlay inertness and the Session floor. Archive/Activity headers, searchable capabilities and shortcut rows follow Settings geometry. Focused desktop interaction checks cover both themes at 1024 and 1440 pixels; frozen references and full repository gates remain owned by 3.1.19.

Settings entry keeps its full-height rail and Navbar opaque and stationary while only content fades. The workflow scrollbar and visible search shortcut hint are hidden, retaining scrolling and the `/` binding. Shared Select items use padded SelectGroup composition; menu surfaces and items retain measured insets. Escape closes an inner Base UI popup before its enclosing dialog or drawer. Queue filters use Base UI ToggleGroup. Log title bars and comparison headers have distinct opaque fills; selected-run status badges match their queue rows. Focused checks cover control placement, keyboard navigation, narrow filter fit, dropdown padding, status treatments and Settings entry frames.
