# Dashboard surfaces

The dashboard is a browser app for one local operator. `src/dashboard/app/main.tsx` mounts
`DashboardApp`; `app/dashboard-app.tsx` composes the workspace, Queue, Logs, launcher, Settings,
and Sessions. `app/dashboard-takeovers.tsx` mounts Settings, Analytics, Explorer, and intake.
The workflow policy serves Person Lookup, Separations and the public I-9 Check PDF parent. OCR and I-9 Lookup are hidden children; the other configured workflows use mocks. Bootstrap, Settings,
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
| OCR Records | `surfaces/run-detail/review/review.tsx` | Authenticated review revisions, edit/gate authority and source-page manifest; explicit previews supply local records |
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

Page render failures show Page unavailable with Open dashboard recovery. The page boundary keeps
workflow navigation and Sessions mounted; an outer boundary also catches shell construction failures.
Navigation clears the failed page state, and recovery replaces the failing URL.

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

`app/workflow-sources.ts` parses `config/dashboard-workflow-sources.json`; Person Lookup, Separations and I-9 Check are `served`. OCR and I-9 Lookup are `hidden`; the other configured values are `mock`. The I-9 Check person child has no source entry. `WorkflowComposition.sourceForRoute` selects the producer for a route. Workflow
selection determines Queue heading, visible rows, launcher target, and Logs context. Exact run
selection may identify its own workflow. Counts come from the producer corresponding to the
rows rather than a second browser status authority.

The public catalog contains Separations, Onboarding, Person Lookup, Work-Study,
Kronos Pay Rule, Oath Signature, Oath Upload, Emergency Contact, OnBase, I-9 Check,
CRM Doc Download, SharePoint Download, and Old Kronos Reports. SharePoint Download is parent-only.
Hidden children have no public catalog choice. Explicit fixtures retain their mock definitions.
I-9 Check launches through its served PDF input and awaits operator acceptance. Its read-only graph
does not support transaction dry runs; ordinary execution publishes local results and a tracker.
The remaining preview entries have their declared launch methods and options.
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
Confirmed person titles read `Last, First · EID #`, including operation members. The title resolver
joins only a declared same-checkpoint identity or verified same-run result fields; unresolved searches
keep their known input title. Operator names remain separate from the system subject.
Escape exits selection. A row's `#N` footer is its attempt, followed by plain trace text and duration.
The footer is one line. Delete confirms with the title, selected run, buttons, and the footer’s short run ID plus revision, without a description. Creation provenance belongs in the information disclosure.

A run released into delegation keeps the same row, attempt, position and elapsed-time origin. It
reads Running at its current step while children execute, including when a child owns an approval
gate. Only that child reads Review. A `block-parent` hold reads Blocked on every waiting ancestor.
Waiting parents are excluded from queued-work filters and counts. Manual child retry uses the
parent's existing Paused/Resume control after the current retry has settled.

`QueuePanel` accepts `QueueSurfaceWire[]`, `QueueViewState`, `QueueHandlers`, action descriptors,
workflow labels and filter scope. Wire surfaces are single, preview or operation. Each carries one
nullable `parent`: null for a physical root, otherwise its authenticated run, visibility and complete
back-chip route, title and status. Inline children appear under the immediate operation presentation;
linked children have their own rows and linked-run chips; hidden-unless-failed children appear only
as failed member lines. Native operation/member scheduling shapes do not change. A delegating
single or member can present an operation without changing its stored shape.

A nondelegated Person Lookup start with served `groupInQueue` appears as one presentation batch.
The native Queue projection serves session `itemScope` and presentation `layout` facts from queue
capabilities declared by the owning workflow registration. The browser consumes these facts without
choosing workflow eligibility.
Its session ID, revision, origin and enqueue time identify the group; it has no native parent run,
trace, run number or representative command. The existing Name/Status well shows one logical person
per start, attention first with source order retained within tiers. Each person uses its latest attempt
and served outcome, including successful Inactive and Not found results. Its attempt selector keeps
prior attempts reachable at their exact Logs and timeline. Different starts stay separate even when
they contain the same person. Single starts and other workflows keep their ordinary item rows.

A failed Person Lookup batch member may serve one Retry icon in its own Logs header. It targets
that native root run and revision through the existing command executor. Admission requires the
current descriptor and runtime authority, open run admission, no reserved reset and no active attempt
for that person. A source may retain older saved configuration when native root Retry can select the
current saved configuration. A confirmed replacement keeps the same item and start session; siblings
stay unchanged. Fresh Retry disappears while a replacement is active. Pending and uncertain commands
stay disabled; exact replay retains the original command identity and never creates a fresh request.
Readback authenticates the immutable failed source and one native replacement independently of the
action still being served.

Logs can serve Retry for an eligible failed Emergency Contact member while the parent is waiting,
paused or settled. A settled mixed-outcome EC parent still admits Retry of each eligible failed
member. Confirming it requeues the parent, clears completion and mints a replacement while the old
settlement and receipt stay. UNKNOWN and a committed or unresolved Save still refuse. OCR page and
lookup child Retry remain separate.

Lookup status filters admit a batch when one of its attempts matches and retain its canonical
selected-day cohort. The well labels its population as people on this day: the wire does not claim
complete cross-day session membership. Group status and end time derive from current member facts;
a missing terminal end stays duration unknown. Selection and well expansion use stable session keys.
Selection-mode inputs expand locally to current member run IDs for typed bulk planning; the mounted
Focus toolbar adds no selection toggle. The batch footer keeps stable session identity and timing.
Its single footer also uses `FooterActions` for the explicitly selected person's exact attempt and
served revision. An accessible person/attempt name and tooltip identify the action scope. With no
person selected it exposes no run action; it never chooses a representative or claims a batch mutation. Cancel,
Pause/Resume, Rerun/Recover and Delete retain their existing confirmation and command paths when
served. There is no grouping toggle. Queue bands and the finished digest count drawn
rows; status-filter controls, calendar and Analytics retain their run-based populations.

An operation can carry record-member presentation separately from native member counts. Each record
is identified by its review-owner run and stable record ID; child histories can serve several records.
Covered native children do not draw duplicate lines. OCR uses the existing Name/Status well for
Reading, Looking up, Verified, Needs lookup and failed-page lines. A parent waiting for OCR approval
keeps its page-count Reading line while OCR owns the person records and review gate. After OCR
releases its approved result, the parent exposes its record lines in source order within the existing
status tiers. The native approved snapshot and member binding determine Saving, Saved, Not approved and failure states; dry-run members
show Previewing or Previewed, and read-only completions remain Verified. Line clicks and the name button select the exact
record; keyboard traversal follows the rendered order. Person Lookup members use their served outcome
words. A line has no Retry control: the failed child's own Logs header uses its served action and
revision, preserving pending and uncertain command recovery. The canonical OCR Review opens at
the selected stable record through a lazy read; its source and fields use the existing read-only cards.

Retained approved trees authenticate their recorded review, snapshot, member inputs and checkpoints
without requiring today's execution fingerprint or a previously omitted optional record-ID association.
A member whose current descriptor does not match its retained version and fingerprint shows Done
for an ordinary completion, Running while active, or Previewed when its native terminal result proves
a preview. These labels do not infer historical read or write effects from today's graph. Current
execution, retry and snapshot freshness checks remain unchanged.

Top-level Queue, calendar, notifications and Activity populations include roots and linked children.
Visibility filtering precedes bounded pagination. An unloaded inline or hidden child never becomes a
standalone row. Cross-workflow members stay under their parent; parent and linked chips retain exact
workflow and day coordinates. Native parent authority still governs actions and deletion eligibility.
Linked Queue navigation rechecks the destination day, run detail and workflow identity. Native child
rows can open Logs and existing gate review without public catalog selection or a source-policy switch.
Served OCR Records uses the authenticated review section and revision-bound command paths.

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

Served Logs combines action notes, declared operator observations, fences and decisions in native ingestion order. Contiguous actions nest under their registered timeline group and system; helper completions do not create their own headings. Unknown field paths remain in Run data instead of becoming operator labels. Browser action labels come from exact frozen declarations; gestures labelled only by the UI registry stay in Run data and are not shown. Values appear only through declared fields and existing frozen classification; legacy unbound gesture values remain explicitly unavailable. Captures join exact bundle, artifact, node, attempt and physical session metadata while their labels stay operator text. Within each displayed step, identical declared field labels and values render once at their first observation time; different values stay separate. Run data retains all source observations, and repeated-field captures remain visible.

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

A served parked decision asks "Did the <record> save in <system>?" with the record, system and
next step declared per write task in the decision catalog. Check again appears only when the held
`check-parked-write` read is served. Saved sends `recheck-write`: Relay reads the record and settles
only on valid proof, otherwise the write stays parked. When the server's `acceptsTransactionId`
(the completion-contract predicate the runtime probe uses) is true, Saved requires the transaction
number and sends it with the recheck. Not saved composes `resolve-write-absent`. No answer settles a
write from the operator's statement alone. Every choice uses its served command confirmation and
binds the run version, intent, generation, write attempt, binding proof digest and occurrence key
digest. Superseded choices refuse before dispatch.
A failure after a write the run settled offers Mark as failed or Add note; both send
`annotate-failure` with the served resolution version and never run, retry or file anything.
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
new attempt. Input methods follow declared workflow capability: typed identifiers, saved workbook rows,
PDF documents or parent-only delegation. Served spreadsheet intake uploads in the launcher before opening a
real `intake` session route.

`inputRun.workbookRows: {typeId, inputField}` declares saved-row selection in Input. The field must be
emitted by the surface's parser. The launcher loads the chosen immutable named version and retains each
selected physical sheet/row in workbook order. `typedInput.initialMode: null` leaves the mode unchosen
until the operator selects one. Fresh Onboarding uses saved rows and one common **New hire** or **Rehire**
choice, with no fresh text-entry alternative. [Run reference planning](frontend-backend-integration.md#run-reference-and-output-plans)
owns entry admission, partial refusals and independent run creation.

Rerun prefills safe source identity fields in Values, using the declared input parser. Protected
values and identities that no longer satisfy the current input stay uncopied. Onboarding Rerun remains
one source input with a fresh visible library/version lookup, without a selected-row picker or retained
source selector. Its [trusted input projection](workflow-model.md#56-recovery-and-rerun) removes server-owned roster data.

Parsed identifier entries trim and collapse whitespace, follow the declared separators, and deduplicate identities. The two-column preview retains the total count; each remove button updates the textbox and planned population. Normalization on blur preserves typing, while protected Match tuples retain their raw editor values and masked preview.

Options show Priority as Interactive or Bulk, Browser mode as Headed or Headless, Dry run where
declared, a required-screenshots notice, and workflow-specific fields. New/reset dashboard
launches start with Dry run off and Headed browser mode. Workflow captures cannot be turned off. The operator explicitly
chooses other values. Interactive work has priority over Bulk background batches; this is not a
promise of immediate execution or preemption. Options omit the policy/version footer; Confirm retains the workflow version. A workflow with no flags has no empty flag group.

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
Catalog, named-version, client or profile identity changes invalidate unissued row plans. Stale rows stay
visible and disabled. Cancellation creates no new run. An UNKNOWN dispatch retains its issued command
envelope and checks that original attempt before any exact replay.

Served Run and Rerun offer no worker choice. They use the workflow's live workers and start one when none
is live. Only Sessions Add workers adds more.

## OCR Records

Records opens within the workflow's Logs body. Each record card pairs its source PDF page with
included/excluded state and grouped fields. Source page selection, zoom out/in, and Fit page keep
actual page identity. Missing or failed source images say so. Aspect ratio comes from loaded image
dimensions. The record heading receives arrival focus. Served Add record creates a blank, unselected
operator-added record through a revision-bound command and focuses its Employee ID. Approval freezes
the exact selected records; uncertain creation checks the original command without redispatch.
[Data intake](data-intake-and-edit-data.md#44-durable-extracted-records) owns provenance, source bindings
and authority details.

The parent form type controls the fields. In the start preview, manual mode begins with blank predefined records.
Every current OCR shape omits Notes. Employee IDs must match `^10\d{6}$`; invalid IDs, unknown
records, and missing required fields block approval. A valid manually entered ID has no provenance
warning, but manual provenance remains distinct from verified lookup evidence. I-9 page selections
bind their section pages. Relationship and boolean controls retain their closed choices.

Selected valid records contribute to the approval count. Delegated OCR requires explicit approval
before downstream outcomes. Approved inputs become read-only and immutable. Standalone OCR has no
downstream approval; its existing Records remain editable after completion when current authority
permits corrections. Discarded review can restore with Ctrl+Z/Cmd+Z while
focus remains in Records; typing fields keep native undo. Approval cannot be undone this way.

Roster and document-type choices share one row. Direct document choices exclude Verify. Field
matching must use canonical spreadsheet bindings; no match or multiple matches remains explicit.
Backend Person Lookup/matching and roster updates are separate wiring requirements. The served
Records toggle uses the native record count. Fields and selection save through revision-bound OCR
commands; approval resolves the native gate with an immutable selected-record snapshot. Pending
edits block approval. Stale, busy, retained-contract and approved authority cannot edit. An uncertain
save retains its exact command and offers read-only Check result without sending it again. Local
drafts and uncertainty survive panel remounts within the same person/client epoch. Conflicting drafts
remain visible until the operator discards them. Footer Discard and Ctrl+Z restore the exact prior
selected set; deselecting every record alone leaves the editor open.

Served OCR Logs expose failed-child Retry in the header. When changed record evidence invalidates
earlier corrections or review choices, the existing warning banner names the source page and revision.
The Records toggle opens the shared editor in the existing Logs body.

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
restores focus to a reachable filter. A ping uses the shared toast; the bell opens the inbox.

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

Add workers progress and confirmed success appear only as toast notifications. Refusals, uncertain
outcomes and the original attempt’s Check outcome action remain in the panel. Pending progress
toasts stay until settlement or panel unmount.

Add workers selects workflow and count with increment/decrement controls. The count is bounded
from 1 to 20 in this preview. The dialog and strip are presentation, not evidence of backend pool
admission. Backend pool, worker lease, patch cursor, browser session, and ownership/generation are
different identities and must remain distinct when wired.

Idle workers with at least one browser and every browser ready have a white five-minute countdown
ring. Due refresh targets the owned physical browser sessions. Activity, unavailability, removal,
or unmount cancels eligibility. Only a matching acknowledgment rearms the timer; refused or
uncertain requests do not automatically resubmit. The current refresh port is a mock.

Browser requirements describe stable declared slots independently of observed open sessions.
An unopened requirement has no session ID, age, or health. Cards label it “Not opened” (“Opening”
while the worker starts), reserving “Unavailable” for observed sessions without verified health.
An observed login in progress also shows “Opening”; a leased callback shows “In use”. A proved
closed session shows “Closed” in its required slot without becoming an open browser or refresh target.
An operator or shutdown stop shows “Stopped” after restart; a recorded crash remains “Failed”.
Do not derive an empty requirement set from an empty open-session list. Actual worker-service wiring replaces both producer and port.

## Assistant

The served assistant starts closed and opens through its launcher. Explicit mock specimens retain
their open panel for presentation checks.

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

The panel has no Files view. Attached spreadsheets (`.xlsx`, `.csv`) never reach the model as content;
the model sees only worksheet positions and counts, and they enter the Spreadsheets library through the
Spreadsheets page or a confirmed assistant card (import, new version, type, SharePoint link or download,
rename, named versions). An attached PDF can start a served workflow whose input is one OCR document
(Emergency Contact), through a confirmed card only. Sent attachments show as name-only pills on the
operator message. The model,
effort, approval and voice controls remain unavailable. The served model and effort labels come from
the selected person’s preference; setup changes use the existing composer command. Test assistant
in Settings › Preflight explicitly runs the same public capability verification; its result is bound to
the current account and clears on account change, disposal or after 15 minutes. Named verification failures remain in the conversation and never enable inference. The explicit mock composition supplies approved mock conversations and sample workflow
scenes; product failures never select those producers. Chat titles, selected chat, text drafts and displayed replies survive refresh in the current browser
tab’s session storage, scoped only after the server verifies the selected person. Another person’s
key is never adopted. Saved text confers no command or model authority: restored pending requests
remain unknown, review proposals expire, and verification proof is never restored. File bodies and
executable action identities are not saved. Storage failures remain visible without erasing data.
Deleting a chat retires its controller before removing history. Pending decisions become unknown;
their late success or failure cannot write history, revive the chat or replay the action.

The operator writes free text. When a served Queue run is selected, the assistant receives it as an opaque run reference and can read it with the read tools. Answers show real names and IDs in place of references; the model never receives them.

## Settings

Settings is a full-height takeover with its own navigation rail, search, guarded Back to dashboard,
and body content. The rail remains available while served fields load/fail. Search targets the exact
field/disclosure, supports keyboard traversal, and announces missing targets. Section scroll positions
are retained within the mounted page. Unsaved and uncertain settings drafts participate in exit and unload guards.

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

Storage includes one confirmed Clear run history action. Its served status counts terminal and
active runs across all workflows and dates; any active run refuses the whole command. The command
removes the terminal run forest, Logs, diagnostic attachments and ordinary run-owned task artifacts
through journaled tombstones and resumable exact-file cleanup. Retained authority, shared and library
consumers keep their artifact files. Spreadsheets, settings, credentials, account data and write-safety
records remain. An uncertain response retains its command ID; Check clear result authenticates only
an existing command and resumes its committed cleanup. An absent journal returns Not recorded and
requires a new destructive confirmation; checking cannot initiate deletion of later runs. The run picker omits delegated-only previews while Explorer retains their definitions.
Ordinary writable authority opening resumes authenticated pending deletion manifests before exposing
the runtime, so restarting or signing in again does not require the browser's old command ID.
Storage status also resumes pending manifests in an open backend and rebuilds the projection after
settlement, so a browser reload can recover without starting another deletion.
Read-only inspection stays passive; pending-file inventory includes only files still present, while
live consumers continue to require their evidence.
`createRunHistoryService` requires composition wiring before the Storage action is available.

Every assistant mutation requires an explicit Confirm. Settings grants enable proposals and never authorize automatic changes. Retired permission modes cannot be selected or granted; their terminal history stays inert. A grant alone does not verify
account capability. Browser dimensions use the canonical `display.screenWidth` and `display.screenHeight` editor leaves, including
draft validation, autosave, uncertainty and readback. Explicit mock previews keep their local controls.

General composes ChatGPT account, appearance, ordinary General fields and annual dates, with Delete account last. The assistant permission row and its search destination are absent; Relay always requires explicit confirmation for its actions. Appearance has a Light/Dark toggle and an Animations switch with no row descriptions or person names. Preference feedback retains loading, saving, failure and uncertain states below the rows.
Delete account uses the active ready profile's session owner and the typed delete client. Its confirmation
is keyed to the profile and session epoch, and the request carries both as expected authority. The server
atomically compares them with the authenticated selection before logout, detach or erasure, including
pending deletion's original epoch. Rendering, navigation and Cancel dispatch nothing; confirmation
dispatches once and disables deletion. Only the delete endpoint's final signed-out acknowledgment exits
the profile. Refused, nonfinal and lost replies stay visible and locked across Settings navigation,
without automatic retry or an erasure claim. A missing served profile keeps the control unavailable.

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
Returning focus or visibility to Relay re-reads the original pending sign-in attempt, replacing its
previous completion read. Only that attempt's typed result settles sign-in; cancellation, expiry and
profile disposal abort its read and remove its listeners.
Lost completion delivery retains those listeners and the original deadline even if account readback
already shows connected. Successful completion replay reads the current account, and the browser
revalidates it after delivery before publishing account state. Sign-out in progress is unavailable;
an original typed closure refusal remains refused regardless of the current account.
Account GET reads return `{account, connection, usage}`. On demand, the account service reads the
bounded authenticated models catalog and retains its explicit success or failure for five minutes;
account authority changes invalidate that observation. It shares concurrent reads, checks admission
and resource closure even on a cache hit, and cancels the shared check after its last reader leaves.
No startup, timer, sign-in or inference operation performs this status check. Usage reflects local
plan authority; its reset time remains unknown. Eligible access tokens renew during the check,
including after restart. A renewable access-token expiry therefore keeps the connection; temporary renewal failures
remain unavailable, and terminal refresh denial requires sign-in again.

### Editable fields, Credentials, and Paths

The typed editor carries effective/default/override values, field metadata, validation, and
persisted/active revisions. Names follow field paths. Credentials uses protected presence authority
and UCPath-scoped autocomplete; tokens and secrets never enter logs or URL state.
Workflow configuration shows read-only Timekeeper name and Timekeeper initials from bootstrap
`actor.label`, with one initial per word and no removal action. Credentials has no historical
pseudonym field. Storage credential checks list only the three current protected settings.

Ordinary typing saves after 700 ms and credential typing after 1200 ms, or when focus leaves the
whole field. Moving between segments of a composite does not flush. Invalid drafts keep inline
validation. Pending saves lock controls. Matching acknowledgment and readback produce the shared
value-free toast; refusal uses danger and conflict/uncertainty uses warning. Save recovery remains
after toast expiry. Blur never retries a failed/uncertain attempt. Text fields keep native undo,
while unsaved date/folder choices revert within their field.

Paths retains native pickers for ordinary document, download, and report folders. Runtime state
and evidence roots are read-only; no location-changing action is offered. Performance and Routes retain their existing metadata/authority, and missing
served values remain unavailable.

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

Storage displays health, doctor reports and run-history counts through its typed client. Clear run
history removes finished runs, logs, screenshots and disposable evidence through the existing
deletion service; active runs and unresolved writes refuse the operation. The confirmation captures
the displayed profile ID and session epoch; Clear and result lookup retain that target. Production
admits both fields against the current selected authority before lifecycle or cleanup effects. Settings, credentials,
spreadsheets and retained write evidence stay protected. Authority availability differs
from backup age. Storage updates show their status without an update-history disclosure. Recovery actions require their exact
served admission. Startup completes automatic repair before ordinary runtime admission; Settings rendering performs no repair or backup. Automatic backup and repair records remain on disk without dashboard notices.

### Keyboard

The existing keyboard controls edit the current person’s ordinary settings through the typed client
and settings command executor. The strict shared model rejects reserved keys and duplicate chords.
Theme, animations, workflow panel mode, selected workflow and shortcuts share one renderer owner
per person/session epoch. Switching people clears that owner and its settings read cache; superseded
reads and command settlements cannot publish into the next person. Signed-out presentation uses
neutral defaults and cannot save. Preview compositions supply explicit in-memory preferences.
Origin-wide browser preferences are never read or adopted.

## Spreadsheets

Spreadsheets shows the served workbook library, workflow outputs and spreadsheet types. Create type
and Edit provide named columns, required-field choices and imported header suggestions. Names must
be nonempty and unique, with at least one column. Renaming retains each field's stable ID. Types
already used in workbook history retain their field membership and key so journal replay stays valid;
column labels and required-field choices remain editable.
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
Excel table filter metadata is removed only from a private parsing copy; original
bytes stay unchanged. Imports admit up to 250,000 populated cells across the workbook; null and empty
string cells do not count, while zero, false and formulas do. The editable grid is separately bounded
to 500,000 cell positions. Standard worksheet dimensions retain selected trailing blank rows and columns
when the grid fits. Otherwise imports trim only empty trailing padding, preserve all values and their
coordinates, and flag the trimmed metadata to refuse master mutation. A populated extent beyond the
grid bound refuses without dropping values. Malformed ranges or worksheet references still refuse.
Import errors show the populated count, limit and recovery advice without internal codes.
Column styles that extend to Excel's last column do not enlarge the imported data grid.
Values, supported fills, number formats, hyperlink URLs/text and rich-text runs survive library
save, reopen and XLSX export, while malformed table XML refuses import. The shared browser-safe
`rules/spreadsheets/workbook-io.ts` boundary uses `@shbernal/ts-xlsx` and retains hyperlink tooltips.
Editing a cell clears its old rich text and hyperlink metadata. Formulas import their stored results
and retain a presence flag. Master edits, keyed writes and Sync refuse formula-bearing workbooks
or metadata the editable model cannot preserve, including table structures and non-cell styles.
Save as new version (values only) confirms the loss of merged cells, formulas, formatting, colors,
rich text and links before retaining the edited cell values as a named library snapshot. Formula
cells retain imported results. The original snapshot stays selected and downloadable, and the open
draft stays available. This action uses catalog/workbook revision checks, immutable action receipts
and exact snapshot readback; an uncertain result is checked without repeating the write.
`spreadsheet-fields-model.ts` reuses canonical intake field IDs and namespaces roster-only IDs.
Canonical value checks use the intake field coercers and schemas without rewriting stored values.
Roster-only fields remain tracker text; workflow-specific transaction rules belong to execution admission.

The editor provides sheet/column selection, row/cell search, sorting, insertion, typed editing,
Undo/Redo, mapping edits, and Excel workbook or current-sheet CSV export. Rendering is bounded to
50 rows and 20 columns, but search covers the full sheet. History keeps 50 versions. Stable-field
read/write helpers preserve headers, formatting, and row identity; invalid patches refuse atomically.
Busy states disable conflicting controls, cancellation is explicit, and file errors remain visible.
Row and column insertion availability uses workbook-wide populated and grid limits, including each
new column's nonempty header. Blank rows consume grid positions without consuming populated cells.

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

Every registered workflow's Explorer timeline is generated from its definition. A timeline group with operator fields is one step: its description and the fields' fictional examples. Other groups show one step per node with its label, purpose (or the group description) and structure. The renderer validates the graph before projecting. No run values are inferred.

Explorer mounts in Settings and describes itself as fictional preview data. Its workflow picker
uses stable fixture IDs and the shared catalog. Local scenario/choice controls alter the preview's
branches, stopped-after boundary, fields, and source disclosures. Unknown selections show Workflow unavailable.

`ExplorerTimeline` shows the ordered step list with node/operation identity, system, required/optional
choices, inputs/outputs, notes, and source views. Stable node, operation, field, and source IDs survive
disclosure and navigation. Conditions compare string, boolean, and null values exactly. Missing or
withheld values are named rather than guessed. Long source IDs/paths remain readable without relying
on clipped chips.

Current fixtures are not compiler authority or executable registration. Served wiring generates the
timeline from each registered backend definition and preserves existing components. Explorer exposes only its generated read-only query; no edit, override, validation or source-authoring command exists. Explorer editor records and their command/audit history are removed by the forward storage migration.

## Removed routes and specimen

Archive has no mounted page, Queue action, search entry, notification shortcut, or version-bump UI.
The dashboard has no row context menus or mobile capture.
A legacy Archive URL shows Archive page removed and a guarded Return to dashboard. Existing stored
run data is not deleted by that notice. `surfaces/archive/archive-model.ts` remains a model; backend
archival, historical evidence, and upgrade/migration authority remain separate from product navigation.
UI catalog requests show UI catalog removed. Phone/mobile Capture Mode has no route or bundle.
Diagnostic screenshots, OCR source PDFs, and spreadsheet intake remain distinct supported surfaces.

`kit.html` is the design-system specimen, built alongside the dashboard and reachable at
`http://localhost:5174/kit.html` during `npm run web`. It renders actual primitives without app/client/
feature imports or registered workflow IDs as specimen values. It is not an operator service surface.

## Verification and wiring

The mounted component set and the approved mock define presentation. Wiring changes producers,
view-model inputs, ports, hooks, and callbacks while keeping the rendered mock case identical.
[The wiring contract](frontend-backend-integration.md#current-frontend-mock-wiring-checklist) names each
surface's required identity, persistence, transitions, and acceptance checks. Shared
[design rules](../../src/dashboard/DESIGN.md) and [mock scene runner](../../src/dashboard/MOCKS.md)
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

The selected dashboard composition owns the assistant service, the same profile account and the
canonical command authorization. `src/backend/assistant/service.ts` runs one tool-calling turn:

- The operator's message goes to ChatGPT after `references.ts` masks it: Employee IDs become `[[E<n>.g<generation>]]`
  references; SSNs, email addresses, phone numbers and runs of 10 or more digits become fixed `[redacted …]` markers
  that no tool resolves; typed `[[`/`]]` brackets are neutralized. Names and dates pass as typed (operator decision D1).
- The developer prompt states the untrusted-data, reference and confirm-only rules and lists the served workflows.
- Every model call offers every plugin tool from `src/backend/assistant/plugins/` in one strict `relay` namespace.
  A response carries at most one call; an unknown tool or malformed arguments end the turn as a typed refusal.
- A tool refusal (stale reference, unavailable read, oversized output) returns its catalog code and text to the model.
  If no later call of that tool succeeds, the turn ends `refused` with that code; model prose never replaces it.
- At most eight model calls run per turn, each tool output is at most 16 KB, and the history stays under 80,000 bytes.
- The answer's references of the current generation are replaced by the served values before it leaves the backend.

Read tools wrap the dashboard's own query owners (`app/composition/dashboard/assistant.ts`): cross-date search
(`find_runs`, `find_people`), run detail (`read_run`, `read_run_logs`), notifications, the workbook library catalog,
ordinary settings and the generated workflow facts (`describe_workflow`). Each tool declares the origin of every
free-text output leaf; the redaction audit registers each output as a `process-egress` surface, where only
repository-authored and declared-redacted leaves pass. Names, EIDs, run titles, notification text, workbook names
and types, and cell values reach the model only as references or not at all.

References live in memory per conversation and profile epoch. A table created after a restart or owner change has a
strictly later generation, so an old token returns "reference expired" instead of naming a different record.

Every inference passes the service's currentness check to `inferAssistant`; the account runs it after each credential
await, immediately before the Responses POST and on every streamed chunk, and closes the operation on every exit.
Verification expiry, model policy, profile runtime and account authority changes therefore stop the next POST.
Confirm applies only to runs. Proposal tools (`src/backend/assistant/proposals.ts`) only prepare a card; their result goes to the operator and ends the turn:
- `propose_workflow_start`: 1–20 entries in the workflow's Input Run grammar, or a run reference to reuse that run's input. One canonical plan, all or none; a dry run when supported, a live read when the workflow has no transaction node.
- `propose_rerun`: the run's own input with all of its steps.
- `propose_run_action`: pause, resume or cancel one run through the existing run command.

The change tool `change_notifications` marks all current notifications or one read or unread, or snoozes or unsnoozes them, at once with no card: the assistant authorization record is approved by policy and consumed in the same authority transaction as the target check, and the model receives `{ state, count }` and answers in words.

Each card is an existing authorization record (`createChat`, `prepare`) with the earlier of the 60-second action expiry and the plan expiry. Card rows show the planned canonical input's typed identity (Person, EID or Name; document number) from the server's plan, never model text. Confirm sends the SHA-256 of the canonical JSON of the card it rendered; the server refuses a missing or different digest, a foreign chat, an old revision, an expired card and any changed plan, settings, source run, grant, manifest or model authority before approval. A card is claimed once. A failure after dispatch may have begun is `unknown`, shown as one line "Couldn't finish this.", and is never retried.

`scripts/build/generate-assistant-knowledge.ts` writes, and with `--check` verifies, the hash-pinned
`src/backend/assistant/plugins/workflows/facts.json` from the served workflow definitions. Boot compares it byte
for byte with facts rebuilt from the running definitions and refuses with `ASSISTANT_CONTEXT_UNAVAILABLE` on a
mismatch. The facts digest, registered route handoffs, command schema and static served workflow policy feed the
command manifest identity.

Model entitlement is separate from command permission and the OCR model. Trusted composition may
supply the existing model policy with synchronous currentness; without it the service returns
`ASSISTANT_MODEL_UNVERIFIED` without inference. Real per-profile preferences and a completed
transaction-free capability canary remain required before the assistant is usable. Subject actions,
freeform or protected changes, unsupported owners and remaining served actions require their current
operator interface until their canonical assistant binding is implemented.

### Run pause presentation

While a claimed run has a pending pause or stop, its queue row and its worker card serve
`interrupt: { action: "pause" | "stop", step: "cancel" | "finish-write" }`. `finish-write` means the
run holds an `attempting` write intent, so the save finishes before the run pauses or stops; the row
live message then reads "Finishing the save first", and a pending pause otherwise reads "Restarts
this step on Resume".

Queue footers expose Pause and Resume from served `pauseControl`, preserving their timing, attempt,
trace and other actions. A recorded pause uses the outline Queued style with a Paused label; requests
remain Pausing until recorded. Logs marks the corresponding timeline boundary. The queue toolbar
pauses every run in the application lifecycle snapshot, including runs outside the selected day.
When every target is paused it offers Resume all, retaining each command outcome. A single Resume,
Retry or Recover shows Start's worker warning instead of the confirmed toast when that result
carries worker startup. Resume all keeps the confirmed toast and adds one warning naming how many
runs have no worker, including when another run keeps the batch from confirming. While a workflow
has unpaused queued runs and every one of its workers has stopped, a sticky warning names how the
worker stopped and points to Retry in Sessions. Queue rows serve `cancelledBy` for a cancelled run:
the Cancelled pill credits the operator only for their own cancel and otherwise shows Relay's reason
(the profile logged out, or a never-claimed run from a previous day was cancelled at startup). Command-Q opens
“Pause all and quit?” with Keep working and confirmation, without a run list. A pending quit shows a
banner until the runtime settles; no submit is interrupted. Unavailable authority disables controls,
and unknown closure never becomes a completed pause or clean shutdown. Exact command recovery keeps
the original targets and request identity. Crash-failed rows offer one checkpoint Rerun and Delete.

### UCPath found transactions presentation

The in-app found table displays transaction, person/EID, type, effective date, submission time,
match quality, verified detail, list completeness, and authority. Submitted requires a selected
exact row with verified detail and authoritative acquisition. Not submitted requires a complete authoritative list containing
no exact or ambiguous match. Check again requests confirmation readback only; a typed transaction
number supplies no proof. Pending decisions keep the original outcome unknown. The isolated
`ucpath-found` fixture is synthetic; backend acquisition and resolution wiring are separate.

The served parked-termination section supplies the held check's retained registered-task findings
through the canonical run-detail client. Logs attaches the existing table to that exact parked
step. Missing reads remain unavailable, capped scans remain partial, and pending selector
provenance keeps resolution authority false. Check again uses the confirmed idle-worker held
check with its exact worker and write target; unavailable workers disable table commands. A typed
transaction number uses the existing exact-ID recheck and supplies only a read request. Retained
evidence must match the original occurrence, descriptor, task implementation and closed recovery
activity. Neither table resolution can grant authority while selectors remain unverified.

### Full dry-run preview presentation

Full-preview accounting counts exercised applicable steps, including submit rehearsals where no click occurs.
The result card shows verified-person, checked-field, and sample-transaction facts; only Not clicked, Unavailable,
and Skipped exceptions carry chips. Preview values carry a Sample tag with a Dry-run sample accessible name; they confer no real-run authority. Executor and served projection wiring are separate.

### Required capture presentation

Run and Rerun have no capture-off choice. Options show a locked “Always on” Screenshots row; browser
summary facts say “screenshots required.” The shared capture notice distinguishes a pre-submit
capture failure (no click) from post-submit missing evidence with either independently proved or
unknown write outcome. Submit captures use equal cards with captions below the image. Served task
captures retain their verified node, attempt, browser session and boundary, and each shows as its own
screenshot row. Capture log identities remain on the rendered figures. Structured capture-failure
notes distinguish no click before submit, an unknown outcome after submit, and an independently
proved outcome. The served dry-run result supplies exercise counts, Not clicked stages and tagged
sample facts at the end of Logs. Missing preview authority remains explicitly unavailable. The
`required-captures` fixture remains synthetic; static UI checks do not establish live acceptance.

### Fixed app-data and maintenance presentation

Paths shows runtime state and evidence roots read-only. Copy buttons copy the displayed paths.
Folders groups the document, download, and report pickers. Backup and Restore controls and the
backup picker are absent. The `fixed-backup` fixture demonstrates fixed paths, folder read failures,
clipboard failures, and ordinary folder controls without file effects.

### Two-method Duo sign-up presentation

Sign-up presents Touch ID and Security key as distinct required verified enrollments at
`duo.ucsd.edu`. Hardware-unavailable presentation identifies Chromium’s virtual platform
authenticator for Touch ID; it never substitutes for Security key. Finish stays unavailable until
both enrollments are verified. Finishing and cancellation stay pending until their owners settle.
The Duo footer shows live setup-window status immediately above its actions. Show window
focuses the existing owned normal Chromium window. Closed or failed status offers Reopen, including after both
methods are confirmed. Reopen stops only the browser Relay started, proves exit and native
profile release, then opens one fresh normal window without retrying enrollment or changing Unknown
readiness. Stop or file-proof failure stays specific and leaves Reopen offered. No whole-sign-up
hold or Relay-restart instruction is used. The compact normal Chromium window keeps native
tab/address chrome visible and contains exactly the owned setup and portal tabs, with no extra window;
its method cards keep icon, title, one-line subtitle and status chip, without progress tracks.
Unknown enrollment is labelled Unknown, not failed or completed. Method chips stay on one line.
The Duo footer confirms Cancel sign-up before calling the existing cancellation owner; returning to
Details uses the same confirmation. Lost cancellation responses prevent another attempt for that
draft. The virtual-platform subtitle names the built-in passkey while preserving the Touch ID chip.
The `duo-signup` fixture remains synthetic; live enrollment, closure and account publication need
their runtime acceptance checks.
