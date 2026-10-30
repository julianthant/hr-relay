# Dashboard surfaces

The dashboard is a browser app for one local operator. `src/dashboard/app/main.tsx` mounts
`DashboardApp`; `app/dashboard-app.tsx` composes the workspace, Queue, Logs, launcher, Settings,
and Sessions. `app/dashboard-takeovers.tsx` mounts Settings, Analytics, Explorer, and intake.
The workflow policy serves Person Lookup and uses local mocks for the other configured workflows. Bootstrap, Settings,
Preflight, storage, and the served intake workspace use the typed client. Retained backend
capabilities do not imply that the corresponding product producer is mounted.

## Surface map

All source paths in this table are relative to `src/dashboard/`.

| Surface | Mounted owner | Producer |
| --- | --- | --- |
| Startup | `app/dashboard-app.tsx` `BootGate` | `state/use-bootstrap.ts` |
| Workspace and workflow rail | `surfaces/shell/workspace-rail.tsx`, `workflow-rail.tsx` | Shared workflow catalog and current run counts |
| Search | `surfaces/shell/search/navbar-view.tsx` | Loaded current queue/mock records composed by the app |
| Action panel and date | `surfaces/queue/queue-focus.tsx`, app composition | Selected workflow/day, filters, and shared served clock |
| Queue | `surfaces/queue/queue.tsx`, `workflows/mocks/workflow-mock-queue.tsx` | Day/preview model or workflow mock runs |
| Logs | `surfaces/run-detail/log-panel.tsx`, `logs/log-sample.tsx`, `workflows/mocks/workflow-mock-queue.tsx` | Local ordered log and workflow producers |
| OCR Records | `surfaces/workflows/mocks/workflow-review.tsx` | Run-bound local records and source-page manifest |
| Run and Rerun | `surfaces/run-start/run-launch.tsx`, `workflows/mocks/workflow-mock-run.tsx` | Catalog, planner/client for served launches, mock drafts for previews |
| Notifications | `surfaces/notifications/notifications-view.tsx`, workspace rail | App preview destinations with rail-local read state |
| Sessions | `surfaces/sessions/session-panel.tsx`, `sessions-view.tsx` | `sessionsSample` and `createSessionPreviewPort` |
| Settings | `surfaces/settings/settings.tsx` | Typed editor, protected authority, readiness, storage, and local preferences |
| ChatGPT account | `surfaces/settings/general/chatgpt-account.tsx` | `ChatGptAccountContext` default memory preview port |
| Spreadsheets | `surfaces/spreadsheets/spreadsheets.tsx` | Served library and versioned Save through `state/spreadsheet-wiring-adapter.ts`; explicit fixture composition retains the mock library |
| Intake | `surfaces/intake/intake.tsx` | Typed intake session and command client |
| Analytics | `surfaces/activity/activity.tsx`, `activity-view.tsx` | AP1 population and selected browse through `state/activity-wiring-adapter.ts`; explicit fixture composition uses `activitySample` |
| Explorer | `surfaces/explorer/explorer.tsx`, `explorer-flow.tsx` | Local workflow definitions, choices, and source models |
| Design-system specimen | `kit/main.tsx`, `kit/kit-page.tsx` | Real `ds/` primitives, no service data |

## Startup and persistent shell

The outer app root applies theme and the 1024×720 CSS-pixel minimum canvas above Tooltip and Toast
providers. Before bootstrap, `DashboardSkeleton` preserves the requested page's geometry. A failed
bootstrap shows The dashboard could not start and the client's error. Invalid view parameters
show Invalid navigation link with Open dashboard. Missing destinations show Destination unavailable.

The workspace rail contains the product heading, notification bell, search entry, and workflow
rail. Opening notifications replaces the workflow list within that rail. The main region has
`id="dashboard-main-region"` and programmatic focus; Skip to content bypasses navigation.
The shell includes `StorageBanner` above the main content on dashboard and takeover views. It
appears for unavailable authority and links to Settings rather than performing repair.

Sessions stays at the bottom across views. Its Settings gear opens the guarded Settings page.
Toasts clear the Sessions bar through `--ds-toast-inset-bottom`. Command recovery, bulk feedback,
and the result feed sit above the Queue/Logs region and retain results when a target changes.

The desktop canvas never changes into a phone layout. Queue stays beside Logs; below the minimum,
the document scrolls. Theme/keyboard preferences are browser-owned, while served actor, clock,
identity, status, and command results remain service facts.

## Workflow rail and catalog

`workflow-catalog-model.ts` builds one catalog for rail, launcher, workers, and other consumers.
It keeps stable ID, label, category, start capability, availability, and source selection separate.
Preview capability does not establish executable registration. An unknown workflow source throws
rather than picking a default.

`app/workflow-sources.ts` parses `config/dashboard-workflow-sources.json`; Person Lookup and Separations are `served` and the other configured values
are `mock`. `WorkflowComposition.sourceForRoute` selects the producer for a route. Workflow
selection determines Queue heading, visible rows, launcher target, and Logs context. Exact run
selection may identify its own workflow. Counts come from the producer corresponding to the
rows rather than a second browser status authority.

The preview catalog contains Separations, Onboarding, Person Lookup, I-9 Lookup, Work-Study,
Kronos Pay Rule, OCR, Oath Signature, Oath Upload, Emergency Contact, OnBase, I-9 Check,
CRM Doc Download, SharePoint Download, and Old Kronos Reports. I-9 Lookup and SharePoint Download
are parent-only. The other entries have their declared preview launch methods and options.
A catalog label is presentation; backend admission still requires registered capability.

## Search, dates, and navigation

Search uses loaded run records and exact destination objects. Results carry workflow, subject,
status, and run identity. Missing destinations refuse with a message. A result opens its exact
run/day rather than a generic workflow page. A complete cross-day backend index is a separate
wiring requirement; searching the loaded day is not proof of historical completeness.

The action panel provides sort, status filters, Start Run, and Dashboard date. The date picker
shows `MM/DD/YYYY`, includes Today, and is capped at the served local Today. A future or invalid
date produces Choose a valid date. Date changes clear the served run selection. Live elapsed
values use `state/served-clock.ts`, calibrated from the bootstrap server instant with monotonic
browser time. A completed duration uses its terminal bound rather than advancing with now.

`app/navigation/url-state.ts` is the single public route owner. Top-level coordinates include
`day`, `run`, `section`, `start`, `intake`, `explore`, `activity`, and `settings`. `view` serializes
bounded `ViewRouteSchema` coordinates for filters, chosen workflow, mock run/Records, launcher
stages, notification filters, Settings search, Explorer choices, and spreadsheet pages/disclosures.
Search typing replaces history; selection, pages, and stages push history. Native Back/Forward
and breadcrumbs use the same owner.

Private input values, document bytes, OCR edits, credentials, read state, pending commands, and
workbook history remain outside URLs. They survive navigation within the mounted session, not
reload. A reloaded URL cannot recreate a private draft or locally created run. Unknown run,
source, and sheet targets show explicit unavailable states.

## Queue

The Queue displays selected workflow/day rows with title, status, outcome/warnings, timing,
identity disclosure, and available actions. The focus toolbar sorts and filters the same row
population. Focus mode and expanded wells are view coordinates; bulk selection is transient state.
Escape exits selection. A row's `#N` footer is its attempt, followed by plain trace text and duration.
The footer is one line. Delete confirms with the title, selected run, buttons, and the footer’s short run ID plus revision, without a description. Creation provenance belongs in the information disclosure.

`QueuePanel` accepts `QueueSurfaceWire[]`, `QueueViewState`, `QueueHandlers`, action descriptors,
workflow labels, parent identity, and filter scope. Its model distinguishes standalone,
operation-group, operation-member, and linked shapes. Group counts and explanatory summaries
share one population. A member and a parent-bound child are different facts; a linked child still
has parent authority. Do not infer deletion eligibility from visual member shape.

The product's workflow preview mounts `WorkflowMockQueue` and local `MockRun` state. Retry opens
Rerun with the exact source. Local deletion removes the selected runs and clears their Logs/Records
selection, then reports acknowledgment. `useQueuePreview` also supplies session-local row actions
for the day-backed presentation. These fictional transitions must become exact command settlement
and authoritative readback when wired. No end-user Archive action or row context menu is mounted.

The served branch uses `useDashboardDay` only when the composition has served data sources.
Loading has a Queue skeleton; invalid date, failed read, empty workflow catalog, and unavailable
workflow retain distinct messages. A loaded row does not authorize a command by itself. Served
`ActionDescriptorWire` controls and exact run revision bind mutations. Bulk outcomes retain
per-child results; partial refusal or uncertainty cannot be summarized as universal success.

Queue keeps loaded rows in the DOM. Offscreen layout deferral reduces layout work but does not
bound memory. Search, copy, jump, keyboard selection, and authoritative totals remain complete
when a later producer introduces paging.

## Logs and timeline

When a live timeline is supplied and the workflow version or contract fingerprint differs from the retained run, older runs use its current step names. Every node recorded by that run's spans, checkpoints, gates, actions and same-run action lineage must map to exactly one keyed live category; missing or ambiguous mappings refuse as `LOGS_IDENTITY_REFUSED`. Notification display applies the same rule and retains its unavailable state on incompatibility. Matching version and fingerprint skip this structural evidence check; notification subject projection still reads its declared checkpoint. Run detail skips timeline reads when the fold has no task spans or gates, except that an older run with a live timeline reads it once for structural compatibility. Missing live category keys still refuse for every run. Frozen action evidence and every write, gate-resolution, resume, rerun and checkpoint-replay fingerprint check remain exact.

Served Logs combines action notes, declared operator observations, fences and decisions in native ingestion order. Contiguous actions nest under their registered timeline group and system; helper completions do not create their own headings. Unknown field paths remain in Run data instead of becoming operator labels. Browser action labels come from exact frozen declarations or the UI registry. Values appear only through declared fields and existing frozen classification; legacy unbound gesture values remain explicitly unavailable. Captures join exact bundle, artifact, node, attempt and physical session metadata while their labels stay operator text. Within each displayed step, identical declared field labels and values render once at their first observation time; different values stay separate. Run data retains all source observations, and repeated-field captures remain visible.

Selecting a run opens Logs beside Queue. No selection shows No run open; a run missing from the
loaded day shows Run unavailable. Explicit workflow previews mount `WorkflowMockLog`. The
served branch mounts `LogSample`, which reads exact run detail, immutable log pages and capture
sections through the dashboard client. Failed served reads retain their unavailable or refused state.

`LogPanel` receives a compact `RunHeaderContext`, ordered `LogStep[]`, timeline stages, status,
and decision callbacks. The header repeats the selected row's status treatment and supplies the
appropriate Review, Resolve, View failure, or Rerun shortcut. A shortcut clears obstructing search,
opens the relevant body, and focuses the exact entry. Opening the decision is not approval.
OCR Review opens Records through the route owner. The panel has no separate Data rail or Receipt tab.

`LogFeed` displays steps and chronological `fields`, `click`, `note`, and `decision` entries.
A field has `id`, `time`, `kind` (`read`, `fill`, or `compute`), `label`, and `value`.
`visualLogSteps` removes compute fields and entries/steps left without visible content. Field and
click entries may carry screenshots; captures are not a separate entry kind. Step headings carry
system context; read/fill rows retain their labels and complete values. Search, copy, disclosures,
and jump targets retain full identities and text even when paint is clipped. Local log decisions
append a result note and may continue a preview timeline; those transitions are not external receipts.

`LogTimelineStage` has stable ID, label, state, optional time/duration/step target, and substeps.
States are `completed`, `active`, `waiting`, `failed`, `pending`, `skipped`, and `cancelled`.
The timeline's segments are categorical and equal width. Completed and active states use their
semantic treatment; waits use stripes, and skipped/upcoming/cancelled states stay distinct.
Duration labels do not change segment width. Steps that do not apply remain visible as Skipped.
A wait with no ordinary step entry still needs a visible representation.

The screenshot workspace retains selected image, dimensions, availability, zoom, and navigation.
Loading, unavailable bytes, and a verified image are different states. Controls stay clear of
reading content; refresh does not reset the operator's selected page or viewport. Diagnostic
capture bytes are evidence, separate from uploaded OCR documents and the removed phone capture UI.

Served wiring requires stable ordered step/action IDs, exact run/attempt joins, timestamps,
observations, decisions, and verified captures. Run refresh follows `rowRevision`; stale detail
cannot be paired with a new row merely because a timestamp looks current.

## Decisions, failures, and unknown writes

Decision entries show their packet, choices, refusal/recovery state, and explicit result.
Machine-verified identity is not an approval ceremony. Operator approval binds the exact gate,
record/source set, corrected values, and revision. A completed command requires a matching result;
an optimistic click or navigation cannot certify it.

A served parked decision displays Write parked and offers Check again through the served
`recheck-write` confirmation. The server's `acceptsTransactionId` field comes from the same
completion-contract predicate used by the runtime probe. When true, Check result collects Yes
and a transaction number, or No. Yes requests a read-only recheck of that number; No composes
`resolve-write-absent`. Otherwise the second choice is It didn't land. Every choice uses its
served command confirmation and binds the run version, intent, generation, write attempt,
binding proof digest and occurrence key digest. Superseded choices refuse before dispatch.
Pending, refused, uncertain with exact replay, and settled feedback use the existing command
executor. Local result copy describes the request, without claiming verification or continuation.

Never retry an unknown submit automatically. Served failure wiring keeps write state, remediation,
and both permanence meanings visible while diagnosis can be disclosed. Missing evidence stays
unavailable rather than looking like a successful receipt.

The product currently uses local decision and workflow result producers. Backend run sections,
command authority, diagnostics, and failure stores remain separate typed seams. Wiring preserves
the existing components while supplying actual evidence and command results.

## Run and Rerun

`RunLaunchHost` mounts the common launcher. Its picker uses the catalog's capability/availability
and current workflow. Served launches use canonical plan/client models. Workflow previews use
`WorkflowMockRun` and `MockDraft`, then create local mock runs. Pending locks prevent duplicate
activation, and refusal/recovery stays visible inside the launcher.

The shared layouts provide Input or Values, Options, optional Steps, and Confirm. The stage rail
contains only reachable stages. Rerun shows source outcomes and retains lineage while creating a
new attempt. Input methods follow declared workflow capability: typed identifiers, PDF documents,
or parent-only delegation. Served spreadsheet intake uploads in the launcher before opening a
real `intake` session route.

Rerun prefills safe source identity fields in Values, using the declared input parser. Protected
values and identities that no longer satisfy the current input stay uncopied.

Options show Priority as Interactive or Bulk, Browser mode as Headed or Headless, Dry run where
declared, Capture screenshots and workflow-specific fields. New/reset dashboard
launches start with Dry run off, Headed browser mode, and captures on. The operator explicitly
chooses other values. Interactive work has priority over Bulk background batches; this is not a
promise of immediate execution or preemption. Fixed facts use the shared field/grid treatment with
visible reasons. A workflow with no flags has no empty flag group.

Steps keep required form-fill/save/submit actions and required sign-in included. Reading steps can
accept typed manual values. PDF plans show Read document with OCR as system label; its checkbox
controls `ocrMode` (`extract` or `manual`), not removal of delegation or approval. Parent document
type fixes the predefined fields. Standalone OCR is directly runnable with a form-type choice.

Manual values bind workflow, step, field, operator provenance, and accepted schema/revision.
Missing required values and invalid page/identity bindings refuse. Manual assertions do not supply
permission or a submit receipt. Existing served declarations remain their own authority; preview
keys are not automatically backend DTOs.

Confirm shows the exact accepted input/options/step plan and number of runs. Start requires the
matching token and fingerprints. Raw-draft changes clear a settled plan; late settlements are
ignored when their request identity moved. Omissions use the declaration's schema and parsed
output, not copied validators. A server omission set mismatch disables Start and names both sets.
Cancellation creates no new run. Uncertain dispatch checks the original attempt before resubmission.

Served Run and Rerun offer no worker choice. They use the workflow's live workers and start one when none
is live. Only Sessions Add workers adds more.

## OCR Records

Records opens within the workflow's Logs body. Each record card pairs its source PDF page with
included/excluded state and grouped fields. Source page selection, zoom out/in, and Fit page keep
actual page identity. Missing or failed source images say so. Aspect ratio comes from loaded image
dimensions. The record heading receives arrival focus; Add record focuses its Employee ID.

The parent form type controls the fields. Manual mode begins with blank predefined records.
Every current OCR shape omits Notes. Employee IDs must match `^10\d{6}$`; invalid IDs, unknown
records, and missing required fields block approval. A valid manually entered ID has no provenance
warning, but manual provenance remains distinct from verified lookup evidence. I-9 page selections
bind their section pages. Relationship and boolean controls retain their closed choices.

Selected valid records contribute to the approval count. Delegated OCR requires explicit approval
before downstream outcomes. Approved inputs become read-only and immutable. Standalone OCR has no
downstream approval; its Records remain editable after completion, with durable revision-bound
persistence still requiring backend wiring. Discarded review can restore with Ctrl+Z/Cmd+Z while
focus remains in Records; typing fields keep native undo. Approval cannot be undone this way.

Roster and document-type choices share one row. Direct document choices exclude Verify. Field
matching must use canonical spreadsheet bindings; no match or multiple matches remains explicit.
Backend Person Lookup/matching, immutable approval persistence, and roster updates are separate
wiring requirements. Current Records edits and transitions are local mock state.

## Notifications

The bell names loading, unavailable, or unread count. Opening the inbox replaces the workflow list.
The inbox has All/Unread tabs, a category filter (All updates, Needs you, Failed), Read all,
individual read/unread controls, and exact destination actions. Rows show subject, outcome/detail,
workflow, and age. Empty inbox, no failures, nothing needing attention, and all caught up are
separate filtered states.

`notificationPreviewState` derives events from current queue/mock runs. Workspace rail read flags
live in memory. Read is separate from urgency resolution. Opening a valid target marks read and
closes the inbox; a missing target reports refusal without navigating to an approximate workflow.
Escape returns focus to the bell unless an inner dialog/menu owns it. A removed read control
restores focus to a reachable filter. A ping uses the shared toast and Open notifications action.

Durable delivery, read state, and full cross-day search still need producer replacement. The typed
notification snapshot/status/target queries and command families exist, but the mounted inbox does
not use them as its default producer.

## Sessions and workers

`SessionPanel` mounts `SessionsView` with `sessionsSample` and a memory `createSessionPreviewPort`.
Catalog IDs resolve worker labels. Unknown worker workflows throw. Loading, unavailable, ready
with no workers, and ready workers are distinct states. The expandable strip contains horizontally
scrolling worker cards and an Add workers dialog.

Cards show workflow/state, browser systems and availability, current action or idle message,
timeline, and footer controls. Running offers Pause, paused offers Resume, failed offers Retry,
non-idle offers Stop, and idle offers Remove worker. Pending/uncertain operations lock duplicate
commands and offer a check of the original attempt. Removing a card returns focus to the strip toggle.

Add workers selects workflow and count with increment/decrement controls. The count is bounded
from 1 to 20 in this preview. The dialog and strip are presentation, not evidence of backend pool
admission. Backend pool, worker lease, patch cursor, browser session, and ownership/generation are
different identities and must remain distinct when wired.

Idle workers with at least one browser and every browser ready have a white five-minute countdown
ring. Due refresh targets the owned physical browser sessions. Activity, unavailability, removal,
or unmount cancels eligibility. Only a matching acknowledgment rearms the timer; refused or
uncertain requests do not automatically resubmit. The current refresh port is a mock.

Browser requirements describe stable declared slots independently of observed open sessions.
An unopened requirement has no session ID, age, or health. Do not derive an empty requirement set
from an empty open-session list. Actual worker-service wiring replaces both producer and port.

## Assistant

The HUB shell is the single mounted assistant. Product chats retain C1 controller state per chat and
send through the typed assistant client. Account, selected-profile and authority changes invalidate
pending replies and proposals; switching chats cancels a pending reply while preserving each draft and
transcript. Answers retain source quotations and revisions. Proposals show their subject, fingerprints,
expiry, effects and stop point.

Send `/assistant-model` to read the selected profile's served model and effort. Send
`/assistant-model SLUG EFFORT` to choose them through the normal operator command. The command uses
that read's profile, epoch and expected revision; confirmed readback must match the next revision and
choice. Unknown settlement stays visible without automatic retry. A saved choice invalidates earlier
verification and in-flight inference; it does not establish account eligibility or permission.

Send `/verify-assistant` explicitly to verify the current choice. The account owner performs its fixed
public two-turn namespaced probe and a fresh public model-catalog read. It sends no HR subject,
operator prose, artifact or private context. Sign-in, model selection, catalog reads, OCR and startup
never run that probe automatically. The account's private proof lasts at most 15 minutes and remains
bound to current account, selected profile, epoch and saved preference authority.

Both setup commands are text-only. Recognized setup forms refuse attachments before file reading,
registration or sending. A served `CHATGPT_USAGE_UNAVAILABLE` account resource permits composing a
setup command while showing verification guidance; it does not make `accountAvailable` true. Confirm
still requires the real signed-in account with available plan use and the existing issued-action,
permission and currentness checks. After explicit verification settles, the current binding refreshes
the served account once. Superseded requests cannot publish into another conversation.

Chat files retains its composer and uses version-bound workbook registration and reads. The model,
effort, approval and voice controls remain unavailable; setup uses the existing composer, with no new
component. The explicit parity composition supplies approved mock conversations and sample workflow
scenes; product failures never select those producers. Chat titles and drafts are local to the mounted
shell.

## Settings

Settings is a full-height takeover with its own navigation rail, search, guarded Back to dashboard,
and body content. The rail remains available while served fields load/fail. Search targets the exact
field/disclosure, supports keyboard traversal, and announces missing targets. Section scroll positions
are retained within the mounted page. Unsaved drafts and uncertain relocation attempts participate
in exit and unload guards.

| Group | Section IDs and displayed pages |
| --- | --- |
| Personal | `general` General, `credentials` Credentials |
| Advanced | `performance` Performance, `paths` Paths, `routes` Routes, plus any additional served editor section |
| Data | `spreadsheets` Spreadsheets, `explorer` Explorer, `activity` Analytics |
| Status | `preflight` Preflight and served status sections such as `storage` |
| Help | `keyboard` Keyboard |

`settings-model.ts` resolves aliases: `display`, `annual-dates`, `providers`, and `provider-env`
resolve to General; `runtime-isolation` resolves to Paths; `protected-store` resolves to Credentials.
The workflow-capabilities route resolves to Preflight. An empty section opens the first entry.
An unknown section shows No such settings section. An unrendered served section names its missing
renderer. Archive and UI catalog requests show removal notices, with a guarded return to dashboard.

### General and ChatGPT account

Assistant permission uses the canonical Settings/grant authority; a grant alone does not verify
account capability. Browser dimensions use the canonical `display.screenWidth` and `display.screenHeight` editor leaves, including
draft validation, autosave, uncertainty and readback. Explicit parity previews keep their local controls.

General composes appearance, ordinary General fields, annual dates, and ChatGPT account.
Shared date controls display `MM/DD/YYYY` and preserve partial input during unrelated renders.
Provider budget/model and API-key controls are absent. Browser viewport is developer configuration,
not an end-user field.

`ChatGptAccountContext` provides `ChatGptAccountPort`; its default is a memory preview. Continue
with ChatGPT invokes `signIn` directly with plan use requested. There is no intermediate dashboard
sign-in dialog. The model distinguishes loading, signed-out, expired, unavailable, and connected,
with plan-use state separate from identity. Known expired sessions can Disconnect through the same
acknowledged sign-out action; unknown unavailable state never implies stored credentials. OCR diagnostics
live in Preflight, outside the account panel. Sign-out requires acknowledgment. Usage links to
`https://chatgpt.com/settings/usage`. OAuth, consent, eligibility, usage limits, and secure token
persistence require the backend account adapter. A displayed preview identity never proves plan access.

### Editable fields, Credentials, and Paths

The typed editor carries effective/default/override values, field metadata, validation, and
persisted/active revisions. Names follow field paths. Credentials uses protected presence authority
and UCPath-scoped autocomplete; tokens and secrets never enter logs or URL state.

Ordinary typing saves after 700 ms and credential typing after 1200 ms, or when focus leaves the
whole field. Moving between segments of a composite does not flush. Invalid drafts keep inline
validation. Pending saves lock controls. Matching acknowledgment and readback produce the shared
value-free toast; refusal uses danger and conflict/uncertainty uses warning. Save recovery remains
after toast expiry. Blur never retries a failed/uncertain attempt. Text fields keep native undo,
while unsaved date/folder choices revert within their field.

Paths retains the native picker and reviewed relocation plan. Persisted and active roots are not
interchangeable. Leaving an unconfirmed plan states that it may be recorded and that recorded intent
does not imply folders moved. Rendering Paths does not execute relocation. Performance and Routes
retain their existing metadata/authority, and missing served values remain unavailable.

### Preflight and storage

Preflight displays served checks with scope, fingerprint, checked time, and readiness/refusal.
Rerun retains the completed report's nodes/geometry rather than blanking the page. Remedy mapping
navigates to Credentials, Routes, Storage, Sessions, or Settings. A rendered remedy does not repair.
Missing checks and unavailable/history state remain explicit.

Settings Preflight's Status section places Test OCR beside Run preflight, using the existing Button
and Banner. It reads the fixed synthetic page only on an explicit click for a freshly loaded,
plan-enabled account. The preflight-owned model distinguishes idle, disabled, loading,
completion with the backend model name, local failure, refusal and uncertain outcome; failure text
comes from the error catalog. Duplicate clicks are suppressed, calls are bounded to 120 seconds,
and account refresh, account actions and profile disposal abort and invalidate pending results.
Uncertain outcomes stay locked across account refresh and Settings navigation for the current
profile lifetime. Neither page load, scope refresh, sign-in nor Run preflight dispatches OCR.
The result is a diagnostic only and never contributes to readiness reports or admission.

Storage displays health and doctor reports through its typed client. Authority availability differs
from backup age. Storage excludes run-history presentation. Recovery actions require their exact
served admission; ordinary startup/Settings rendering does not perform a repair or backup.

### Keyboard

Keyboard lists and edits the current shortcut preferences. Shortcuts remain keyboard-reachable
without visible search hints. Retired row-menu bindings do not remain in preferences. App navigation,
inner popup dismissal, and text editing keep their scope rather than turning typing undo into a run action.

## Spreadsheets

Spreadsheets has Registered spreadsheets and Spreadsheet types tabs, library search, New spreadsheet,
Import spreadsheet, and Add spreadsheet type. The library reads served saved workbooks; Spreadsheet types remain local.
Opening a saved workbook mounts `SpreadsheetEditor`. List and open reads use a loading status; read failures show Spreadsheet unavailable.
New and imported workbooks remain drafts until Save. Save sends the opened version and confirms only matching readback.
Conflicts and uncertain saves retain the draft. Unsaved workbook drafts share Settings exit guards.

CSV/XLSX parsing and export run in real workers. Import chooses the header row and kept sheets/columns,
then optionally binds retained columns to known fields. Unbound columns and roster tracker fields keep
their original values. Duplicate fields per sheet refuse. Canonical value issues show the original worksheet
row and column without blocking library import; workflow Intake still refuses invalid execution rows.
Confirmation physically removes preamble and excluded sheets/columns instead of merely hiding them.
Source headers, source column coordinates, header-row provenance, suggestion/manual basis, and stable
row identities survive. Imported rows retain their original worksheet row through sorting,
edits and library save/reopen; warnings use that location. Rows created without source provenance are
labelled with their current row. Inserted columns have a null source coordinate.

Editable XLSX imports include hidden and filtered rows. Worksheet/table filter rules are not imported.
Unsupported Excel table `colorFilter` metadata is removed only from a private parsing copy; original
bytes stay unchanged. Standard worksheet dimensions retain selected trailing blank rows and columns;
malformed ranges or worksheet references refuse, and declared extents count toward the workbook size limit.
Values, supported fills, number formats, hyperlink URLs/text and rich-text runs survive library
save, reopen and XLSX export, while malformed table XML refuses import. The ExcelJS importer drops
hyperlink tooltips; XLSX export emits tooltips already stored in a workbook. Editing a cell clears
its old rich text and hyperlink metadata. Formulas remain imported as their stored results.
`spreadsheet-fields-model.ts` reuses canonical intake field IDs and namespaces roster-only IDs.
Canonical value checks use the intake field coercers and schemas without rewriting stored values.
Roster-only fields remain tracker text; workflow-specific transaction rules belong to execution admission.

The editor provides sheet/column selection, row/cell search, sorting, insertion, typed editing,
Undo/Redo, mapping edits, and Excel workbook or current-sheet CSV export. Rendering is bounded to
50 rows and 20 columns, but search covers the full sheet. History keeps 50 versions. Stable-field
read/write helpers preserve headers, formatting, and row identity; invalid patches refuse atomically.
Busy states disable conflicting controls, cancellation is explicit, and file errors remain visible.

Durable library storage, OCR roster matching, Person Lookup fallback, and workflow roster updates
remain producer/authority wiring. A locally exported copy is not proof of a workflow write. A roster
update needs the workflow's confirmed outcome and required approval, with unknown outcomes reconciled.

## Intake workspace

The served intake workspace opens only with a real `intakeSessionId`. The Run launcher uploads the
file first; there is no empty-session sentinel page. The takeover header identifies the target workflow.
`intake-client.ts` wraps the typed session queries and command operations.

The workspace distinguishes proposed source-column suggestions from explicit confirmed bindings.
It shows inspected sheets, header fingerprint, target fields, samples, validation, row rejections,
corrections/exclusions, and the manifest/enqueue outcome. Selection and mapping bind the exact session
revision. Suggested identity is not an operator decision. Validation and enqueue use canonical field
IDs rather than labels or column positions.

Commands are `inspect-intake`, `confirm-intake-mapping`, `correct-intake-row`, `exclude-intake-row`,
`validate-intake`, and `enqueue-intake-manifest`. Each binds `intakeSessionId` and `expectedVersion`.
The enqueue payload carries explicit `dryRun` and optional `reviewBinding`. Failed/refused/uncertain
commands retain their distinct state and draft. A missing session reports its service error.
Successful enqueue closes the takeover to the dashboard; navigation alone is not enqueue evidence.

## Analytics

The displayed label is Analytics; its source folder and route IDs remain `activity`.
`ActivityReport` uses the served report-calendar date and feeds `ActivityView` from the complete
AP1 population. Explicit fixture composition retains the sample date, values and local interactions.
Invalid ranges, loading, empty periods and read/refusal failures remain distinct.

The page provides period/range selection, status/workflow filtering, outcome/duration/volume/transaction/
coverage/performance sections, and snapshot-bound browse. The server filters and sorts before
20-row paging; the view consumes its authoritative rows and counts once. Pending filter reads retain
controls and settled rows, mark stale authority, and refuse row navigation/export until settlement.
Successful root runs supply workflow averages; all terminal runs supply duration tiles. Measured
zero, empty known zero and unavailable measurements remain distinct. Unknown readback evidence stays
unavailable; production and test transactions remain separate from run counts.

Workflow source switches remain unchanged. Served generic identities never receive fictional Logs:
mock workflow detail is explicitly unavailable; served detail requires exact day-row membership and
the existing run-detail/log reader. AS1 retains summary/summary CSV/XLSX exports through the same
nested report authority. Export CSV downloads the snapshot-bound AP1 full population. The control stays
pending until the download settles and reports refusal without starting another request.

## Explorer

Served Explorer uses registered timeline groups with declared operator fields as one step per group and system. It displays only their fictional example strings and safe field provenance, with explicit definition-preview copy. Groups without operator fields retain task labels, purposes and operator action text without raw contract fieldsets. Exact graph, frozen operation and source lineage validation remains internal; no run values are inferred.

Explorer mounts in Settings and describes itself as fictional preview data. Its workflow picker
uses stable fixture IDs and the shared catalog. Local scenario/choice controls alter the preview's
branches, stopped-after boundary, fields, and source disclosures. Unknown selections show Workflow unavailable.

`ExplorerTimeline` shows the ordered step list with node/operation identity, system, required/optional
choices, inputs/outputs, notes, and source views. Stable node, operation, field, and source IDs survive
disclosure and navigation. Conditions compare string, boolean, and null values exactly. Missing or
withheld values are named rather than guessed. Long source IDs/paths remain readable without relying
on clipped chips.

Current fixtures are not compiler authority or executable registration. Served wiring generates the
timeline from each registered backend definition and preserves existing components. The retained
Explorer query/validate command seam does not make local source edits or new-workflow authoring served.

## Removed routes and specimen

Archive has no mounted page, Queue action, search entry, notification shortcut, or version-bump UI.
A legacy Archive URL shows Archive page removed and a guarded Return to dashboard. Existing stored
run data is not deleted by that notice. `surfaces/archive/archive-model.ts` remains a model; backend
archival, historical evidence, and upgrade/migration authority remain separate from product navigation.
UI catalog requests show UI catalog removed. Phone/mobile Capture Mode has no route or bundle.
Diagnostic screenshots, OCR source PDFs, and spreadsheet intake remain distinct supported surfaces.

`kit.html` is the design-system specimen, built alongside the dashboard and reachable at
`http://localhost:5174/kit.html` during `npm run web`. It renders actual primitives without app/client/
feature imports or registered workflow IDs as specimen values. It is not an operator service surface.

## Verification and wiring

The mounted component set and current parity references define presentation. Wiring changes producers,
view-model inputs, ports, hooks, and callbacks while keeping the rendered mock case identical.
[The wiring contract](frontend-backend-integration.md#current-frontend-mock-wiring-checklist) names each
surface's required identity, persistence, transitions, and acceptance checks. Shared
[design rules](../../../src/dashboard/DESIGN.md) and [parity guidance](../../../src/dashboard/PARITY.md)
own composition and visual checks.

Command results remain `applied`, `already-applied`, `confirmation-required`, `conflict`, or `rejected`
through the shared settlement owner. Post-dispatch transport failure is unknown. Loading, empty,
unavailable, refused, and uncertain states never turn into fixture success. Served data errors never
fall back to mocks. Read-only navigation cannot approve, submit, repair, or retry an unknown write.

Backend policy owners are [workflow model](workflow-model.md), [task contract](task-contract.md),
[data intake and Edit Data](data-intake-and-edit-data.md), [write safety](write-safety.md),
[execution and sessions](execution-and-sessions.md), [operator trust](operator-trust.md), and
[clock, configuration, and secrets](clock-config-secrets.md). Their schemas and services own durable
state; the dashboard renders the admitted projection and exact command result.

### Assistant production input boundary

The selected dashboard composition owns the assistant service and the same profile account and
canonical command authorization. The local intent projection accepts only named help topics and
notification actions. It sends fixed application text and request-local opaque notification references;
operator messages, notification text, subject identifiers and source-file bodies stay local. Unknown
or ambiguous input refuses before inference. The trusted local projection also binds whether a
request permits a help answer or requires canonical action completion. A notification action with
only model text and no canonical call refuses; it cannot report an execution from model prose. Notification commands resolve the reference back to the
same actor and complete sorted current inbox membership and versions, then use the existing permission and once-consumable command door.
Plural actions use one opaque collection reference and exact matching count. Inbox Read all uses the
same canonical collection command. The kernel checks the whole membership in its transaction before
any row update; pinned history warnings remain unchanged. Counts describe current native notices,
not complete external HR history. Notification actions never resolve or retry an underlying UNKNOWN write.
A confirmation-required action returns its server-issued chat/action identity, exact revision,
expiry and local target display directly to the operator card, never back through the model.
The existing Confirm/Cancel controls submit only those opaque identities and the decision through
the authenticated assistant route. The constructor-owned issued chat is required; a client UUID
cannot reconstruct it. Confirmation revalidates the original collection membership, versions, account/profile
currentness, grant and manifest, then approves and consumes the same canonical command once.
Generated commands and their canonical audits carry `source: assistant`. Lost confirmation responses
remain unknown without automatic retry. Automatic execution retains its actual issued action identity
before entering consumption; any authority/cancellation loss after effect entry, including the service
continuation after its handler await, returns that action as unknown. An ambiguously lost respond
transport has no fabricated action identity and disables retry; the operator checks the current inbox
before a new request. A confirmation-required proposal does not execute or imply
operator approval.

`context.ts` projects the finite plain help artifact. Run
`tsx scripts/build/generate-assistant-knowledge.ts` and its `--check` mode to generate and verify
`src/backend/assistant/generated-knowledge.json`. Its revision identifies the projected content,
not a Git commit. Runtime checks exact artifact bytes and line quotations. Command manifest identity
also binds the canonical input schema, effects, summaries, argument projection, owner availability,
static served workflow policy, selected-app registered route handoffs and knowledge digest.
Route registration is accounting only; it does not establish tool capability. The outer profile
authentication interface remains operator-only.

Model entitlement is separate from command permission and the OCR model. Trusted composition may
supply the existing model policy with synchronous currentness; without it the service returns
`ASSISTANT_MODEL_UNVERIFIED` without inference. Real per-profile preferences and a completed
transaction-free capability canary remain required before the assistant is usable. Subject actions,
freeform or protected changes, unsupported owners and remaining served actions require their current
operator interface until their canonical assistant binding is implemented.

### Full dry-run preview presentation

Full-preview stage accounting distinguishes Exercised, Unavailable, and Skipped. Dependent
preview values display “dry-run sample” beside the value and warn that they are not receipts,
subject proof, or real-run authority. The `dry-run-preview` parity fixture demonstrates complete
and partial exercise without executing workflows. Executor and served projection wiring are separate.
