# Frontend and backend integration

The dashboard uses one typed client facade. The mounted product currently combines served shell
configuration, Settings, inbox and cross-date search with local workflow producers. A client method or backend
route can exist without being mounted by the product. The tables below describe both the present
producer and the requirements for replacing it.

Run and item Pause/Resume, exact-membership Pause all, and confirmed Pause all and quit use the
canonical typed command facade. The application lifecycle query supplies runtime generation,
current target versions and update availability. Application pause commands refresh every affected
run in the served projection before quit notification. Queue producers retain the orthogonal pause
state and available pause command. Ordinary Rerun accepts done, failed and interrupted sources and
starts fresh; native Retry retains its lifecycle semantics. A separate server-authored
Recover completed steps action composes `run/recover-run` through the same client and confirmation
flow. The server derives its checkpoint recovery plan from an exact failed or interrupted source.
Readback verifies the new item attempt while the source remains unchanged. Incompatible contracts,
uncertain writes and unavailable retained evidence show the named recovery refusal. Host updater installation has no
production dispatch; its absence remains explicit in the lifecycle query.

## Client facade and boundaries

`src/dashboard/client/index.ts` assembles `DashboardClient` from `queries.ts`, `commands.ts`, and
`subscriptions/subscription.ts`. `transport.ts` owns JSON/binary requests and event streams;
`errors.ts` owns `DashboardClientError`. Feature code uses this facade rather than a second fetch,
stream, API, or schema layer. Responses are parsed through canonical `src/models/dashboard/**`
schemas. `src/rules/commands/commands.ts` owns command envelopes and results.

`app/` owns composition, URL/history, and dispatch. `surfaces/<feature>/` owns components, models,
styles, and its producer. `state/` owns resource lifecycles, bootstrap/day hooks, and served time.
`ds/` owns the presentation primitives. Browser imports may reach browser-safe models, rules, and
workflow-kit leaves, never backend task implementations, registries, secrets, or Node modules.
`kit.html` is a separate design-system entry whose closure excludes app, surfaces, client, and state.

Components retain the approved mock presentation during wiring. Producers, model inputs, ports,
hooks, and callbacks receive actual data. A component changes only as needed to receive those
inputs. A changed or new presentation requires operator approval, a UI-only implementation with
mock data and references, then wiring. Workflow-varying counts, order, text, branches, and sources
use existing components. Served Explorer timelines come from registered backend definitions.

## Assistant setup and preference transport

`AssistantQueries` exposes the existing respond/decide routes and
`GET /api/v1/assistant/model-preference`. The strict `AssistantModelPreferenceViewSchema` carries the actual
selected `profileId`, `epoch`, `revision` and canonical preference. The response uses `no-store`;
missing, corrupt or refused authority returns a coded unavailable response rather than a browser
default. The authenticated selected-profile composition owns the view.

The assistant has no permission route or grant. Each proposal card needs the operator's Confirm;
General has no permission control.

The composer recognizes the canonical setup command constants from `models/dashboard/assistant.ts`.
A model read uses that served view. A model set goes through the existing `CommandExecutor` and
`executeCommand` protocol, with `requestedBy` bound to `LOCAL_OPERATOR_ACTOR_ID`,
`source: dashboard-assistant-model-preference` and the view's exact profile, epoch and expected
revision. It is never an inference tool or a model-produced action. Normal command locks, receipt
validation, matching readback, refusal and UNKNOWN handling apply; a lost response does not cause an
automatic retry or invented success.

The model-preference setup command uses the normal assistant respond route without `subjectRef`. Surrounding pasted whitespace is normalized.
The backend recognizes the exact command before inference policy, private input projection, context,
subjects or tools. Recognized setup commands reject attachments before local file I/O or registration.
The composer is usable as soon as ChatGPT sign-in works; an unreadable plan-usage meter does not block it, while
Confirm keeps the real `accountAvailable` requirement. An explicit verification settlement refreshes
the current served account binding once, without a polling or activation loop.

[Dashboard surfaces](dashboard-surfaces.md#assistant) owns operator setup behavior;
[Clock, configuration, and secrets](clock-config-secrets.md#assistant-model-choice)
owns durable preference and private account authority. Neither a mounted control nor source wiring
establishes live model or operator acceptance.

Structured reply source contracts live in `models/dashboard/assistant.ts`; `backend/assistant/replies.ts` resolves the existing literal model text and context-owned handles into server-authored parts. These source helpers are not the served response or history wire. Targets contain stable run/input, Queue query, workbook revision/location or attachment digest identities, never ephemeral reference tokens, URLs or commands. A value with no link semantics is explicitly value-only; failed membership, canonical input or currentness refuses instead of becoming text. Person targets require an admitted single/member Lookup row, strict schema-bound EID matching and protected-subject refusal. Generic protected run links retain the safe existing title.

The unregistered `createAssistantM1Service` prepares read and session turns against the M1 history owner. Every tool declares a tier (`read`, `session`, `write-local`, `leaves-machine`) the registry checks against its kind. Its private tools port supplies read and session plugins, the session owner and current server reply bindings; change and proposal tools refuse before model access. A session start goes through `createAssistantSessionAuthorization` with the turn's accepted identity: only a transaction-free registered graph starts in real mode, or a supported dry run when the send carries the composer's `approvalMode: "full-access"` and Settings still allows Full access; saving workflows otherwise stay proposals. The accepted turn's check and the Full access setting are rechecked after planning and at the command effect hook. Each start claims once per accepted message and request, submits one canonical start command with session attribution, and appends a server-authored session part; a turn that attempted a start offers no retry. Durable claims arrive with the proposal store; the post-POST turn fence reports uncertain delivery. Duplicate sends authenticate the original literal text, subject and ordered attachment IDs before remasking or model work and only return stored delivery/accounting. New attempts retain the exact committed acceptance object, settle structured parts and actual per-call usage atomically, and read the stored reply back. Failed history observation returns explicit unavailable delivery metadata with the last observed revision. A definite read refusal may offer an explicit new-message retry; repeats, stale turns and uncertain delivery grant none.

`models/dashboard/assistant-usage.ts` owns token schemas and aggregation. Each newly accepted attempt emits one numeric/closed-literal accounting event through the existing debug writer, including refused and uncertain exits; duplicates emit none. Missing call measurements remain unavailable rather than measured zero. A logger failure adds a closed diagnostic while preserving a known stored result, including the distinct resource-closure failure code. This preparation installs no service, route, client or migration; native activation and the C0/A2 wire replacement remain separate.

The unregistered M1 message-payload contract distinguishes unrecorded display, actual accepted-turn metadata with pending or recorded usage, and reply links. Its pure historical payload converter preserves exact literal text, including empty text, without installing a reader or manufacturing accepted metadata. A shared semantic UTF-16 display counter retains the existing visible-text quota; JSON framing and replay are not display charges. Native row ownership/correlation admission, profile budget refusal and migration activation remain integration obligations.

Assistant command attribution and action bindings live in `rules/commands/commands.ts`. Unregistered M1 command contracts require a sidecar outside canonical request JSON/digest and matching top-level audit attribution. Known-predecessor conversion authenticates command identity, native audit columns and the canonical outcome mirror before recording explicit unrecorded provenance; old assistant source labels confer no provenance. The search owner rebinds only a complete, matching canonical set of queued events and contributing command/audit pairs while preserving retained order and frozen declaration data. These pure contracts do not perform native/profile admission or grant permissions; immutable SQL admission, real accepted-claim ownership and coordinated reader/writer activation remain separate.


Failure parts style only the fixed server word `Failed`; the catalog reason follows unchanged as plain text. Ordinary lists above eight require a complete server count and a resolved Queue target; proposal lists retain all 1–20 rows within the existing display/context budgets. Stored session parts have run identity and display data only. A fresh session projection rereads admitted run authority and the Queue surface, checks matching IDs/revisions and reuses only the existing eligible Cancel descriptor. This projection does not authorize Stop: integration must first prove membership in an owned accepted read-session start and its transaction-free graph; operator dispatch remains the dashboard command client. Imported wording never creates session or approval authority. Accepted-turn `acceptedAt` is the message acceptance instant, distinct from the conversation creation instant used by history currentness. Answered attribution retains the real command `requestedBy` and accepted action binding; authentic audit persistence and the coordinated caller/wire cutover remain integration work.

The assistant's selected subject reference is the visible served run. The service checks its current revision and issues an opaque, version-pinned run reference with a server-only label. Read tools resolve it through the admitted run owners.

Exact Employee ID queries read schema-bound canonical Person Lookup inputs on single and delegated member runs, including queued rows without name checkpoints. They exclude protected subjects, operation parents and previews. The read scans every canonical page within the existing 10,000-row corpus bound, refuses incomplete or stale scans, and orders matching candidates newest first. Multiple candidates stay explicit; the five-row tool limit reports more results. Labels use workflow, retained run number when present, Employee ID, enqueue time and attempt only on the server; the model receives reference tokens. Protected selected rows keep the existing protected-subject label.

Bootstrap projects the admitted person registry name as the actor label. Appearance uses that label with the existing person/epoch preference owner and claims saved state only after confirmed settings readback. Preference commands use `source: person-preferences`; the ordinary editor recovers only its own `settings-surface` attempts, so simultaneous preference saves cannot become ordinary editor retries.

## Static workflow source policy

`app/workflow-sources.ts` parses `config/dashboard-workflow-sources.json` into `WORKFLOW_SOURCES`.
Every declared value is `mock` or `served`. `workflowSource` throws `WORKFLOW_SOURCE_UNDECLARED`
for an absent ID. `PRODUCT_WORKFLOW_COMPOSITION` supplies the static product policy;
`DashboardApp` receives `productWorkflowComposition` by default. Person Lookup, Separations and OCR use `served`; the other configured workflows use `mock`.
Product mock queues start empty. `WorkflowComposition.initialMockRuns` supplies initial rows; the product supplies none, while the mock composition supplies `seedMockRuns`. The mock composition starts from an explicit mock policy and opts fixture workflows into served capability tests. There is no runtime served-to-mock fallback.

`WorkflowComposition.sources` controls workflow presentation; `explorerSources`, `logsSources`,
`dataSources`, `catalogIncludesMocks`, and `servedDay` allow explicit fixture composition.
The independent `inbox` and `search` sources are served in the product and mock in the mock composition.
`sessions` selects its existing served or fixture producer. `sourceForRoute` chooses the
route's producer. `buildWorkflowCatalog` combines served registration with the preview catalog,
keeping availability, executable registration, and preview capability separate. Only a workflow's
own wiring task changes its source policy after its accepted behavior is implemented across
Run, Rerun, Queue, Logs, Explorer, Records, notifications, and Analytics where applicable.

## Current frontend mock wiring checklist

The mounted owners live under `src/dashboard/`. The following table preserves each producer's
required data, transitions, and refusal boundaries. Bootstrap, served day support, Settings,
Preflight, storage, and intake already have typed clients; local previews are explicit producers.

| Surface | Mounted producer and seam | Required data and transition contract |
| --- | --- | --- |
| Shell and workflow catalog | Typed bootstrap/day client; `workflow-catalog-model.ts` merges served registration with the approved preview catalog | Stable workflow IDs, labels, start capability and availability remain distinct. Bootstrap carries actor, clock, descriptor/config identity and storage/readiness. Missing or invalid bootstrap fails visibly. |
| Queue and row commands | `useDashboardDay` consumes strict day SSE; `useQueuePreview` adds session-local fictional changes | Exact day, generation and cursor, run and item identity, attempt, containment, status, revision, rollup, and action descriptors. Reconnect resumes the last cursor; stale events cannot replace newer rows. Runtime commands retain CAS and command identity. Replace local retry and delete overlays with explicit command settlement and readback. Archive actions and row context menus are absent. Footer and outcome controls retain descriptor authority; keyboard preferences omit the absent menu binding. |
| Logs and OCR Records | `LogSample` uses served run wiring and `useOcrReviewEditor`; `WorkflowMockLog` supplies explicit preview data to the same Records renderer | Ordered stable step/action IDs, timestamps, field observations, decisions, screenshot dimensions/availability and exact record/page identity. OCR correction and selection must survive navigation; approval needs one explicit matching result. An unknown write offers reconciliation, not a blind retry. |
| Start and Rerun | Shared launch/rerun models use typed planner/client for served starts; registered previews create local mock runs | Accepted inputs, required/omittable steps, resolved options, plan/source identity and matching command result. PDF plans display one selectable Read document step with OCR as its system label. Its checkbox maps to `ocrMode`, not removal of delegation or approval. The parent/document type fixes fields. The preview offers direct OCR with a form-type choice and no downstream approval; served OCR remains child-only. I-9 Lookup and SharePoint Download are parent-only. Keep downstream outcomes pending until approval. Interactive work has queue priority over Bulk background batches; labels do not imply immediate execution or preemption. Preserve pending locks, refusal and exact-attempt recovery. Every launch starts with Dry run off; it is an explicit operator choice. Sign-in steps stay included while a required form action on that system remains. A selectable catalog entry does not establish executable registration. |
| Settings, protected values and paths | Existing typed editor clients and revision/readback models | Personal contains General and Credentials; Advanced contains Performance, Paths and Routes. Their existing route IDs and editor authority are unchanged. Effective/default/override values, field metadata, persisted/active revisions and protected authority state. Names follow field paths; credential autocomplete is scoped to UCPath. Browser viewport remains developer configuration with no end-user editor. Pending save locks controls; uncertain save checks the original attempt. Native path picking remains behind its existing client. |
| ChatGPT account in General | `ChatGptAccountContext` supplies `ChatGptAccountPort`; production mounts the served account adapter, the mock composition mounts synthetic account routes and an inert authorization opener | Continue with ChatGPT calls sign-in directly with plan use requested; no intermediate dashboard dialog. The adapter owns verified identity, real consent/eligibility, loading/expired/unavailable/usage-limit state and acknowledged sign-in/sign-out. Use the existing typed client and canonical model schemas when replacing the port. OAuth and secure token persistence belong to the backend. The typed account client reads state, starts sign-in, reads its original bounded completion, cancels, signs out, and explicitly tests OCR through the existing fixed synthetic-page diagnostic; tokens never enter the browser. Known expired sessions retain Disconnect; unknown account state does not imply credentials. OCR test loading, completion, refusal and uncertainty stay separate from account identity; a lost response is not retried. Unknown completion reads current state once without retry. Confirmed local sign-out remains distinct from a remote-revocation warning. Identity alone does not enable plan use. Provider budget/model and API-key controls are absent; Connected snapshots retain expiry and read state again at expiry. |
| Preflight and storage | Typed Preflight/doctor query and rerun clients | Served checks, scope/fingerprints, checked time and explicit unavailable/history state. Rerun retains the completed report's nodes and geometry. Shared remedy mapping navigates to Credentials, Routes, Storage, Sessions or Settings; rendering performs no repair. Storage excludes run history. |
| Sessions and workers | `sessionsFromDay` and `createSessionPreviewPort` consume the shared Day/client; explicit mock composition uses `sessionsSample` and `createFixtureSessionPort` | Six actual phases, exact member/lifetime and physical sessions come from `workerAuthority`/`workerCards`. Native `workerOperations` supplies immutable command, application and audit readback. Check reads the original operation without dispatch. Authority failure shows unavailable. Workflow source switches remain independent of Sessions. |
| Notifications and shell search | `inbox-wiring-adapter.ts` reads the canonical inbox/status and consumes committed publications; `search-wiring-adapter.ts` materializes signed cross-date search pages. Explicit mock composition retains local previews. | Canonical target resolution precedes shared navigation. Historical run/failure targets validate fresh exact identity and open generic served Logs, independently of the workflow preview source; storage opens Settings, while missing, archive and refused targets show catalog notices. Commands confirm exact actor/notification/version readback. Search preserves query, facets and snapshot identity and displays only authority `totalMatches`. Workflow-specific wiring remains separate. |
| Historical reports (unmounted) | Archive page, navigation, queue snapshot composition and notification shortcut are absent; historical readers and archive model and backend archival authority are retained | Stored reports remain unchanged. A unified run-history query/read model needs exact identity, date/status/workflow filtering, cross-version data migration and historical evidence access before backend wiring. Current day filters are not a complete historical index. Legacy Archive URLs show a removal notice and return to the dashboard without queries or version commands. Backend archival and upgrade authority remain independent of this UI. |
| Analytics | `activity-wiring-adapter.ts` feeds `ActivityView` from the AP1 population and authoritative browse; explicit fixture composition retains `activitySample` | The complete ordered population supplies generic counts. Successful root runs alone enter workflow timing averages; duration tiles cover all terminal runs. Zero and unavailable timing remain distinct. Browse revalidates the exact snapshot and injects server paging once; pending filter reads retain controls and mark stale authority. Mock workflow detail never joins fictional logs to served IDs. The Export CSV control awaits the snapshot-bound AP1 download and reports refusal. AS1 retains distinct summary/XLSX export. |
| Explorer | `WorkflowExplorer` uses local workflow fixtures and choice/source models | Stable workflow/node/operation/field IDs, source metadata and ordered timeline. Public display conditions compare string, boolean and null values exactly; withheld/missing values are not guessed. Definition/runtime compiler wiring remains separate. |
| Spreadsheets | Served workbook library through `spreadsheet-wiring-adapter.ts`, with real CSV/XLSX workers and explicit mock fixtures | Workbook/sheet/row/column identities, values/types/fills, number formats, hyperlinks, rich-text runs and optional canonical bindings. Editable XLSX copies import all records, including hidden/filtered rows; worksheet/table filter rules are not imported. Unsupported Excel table color-filter metadata is removed from a private parsing copy only; original bytes remain unchanged, values and supported cell fills survive, and malformed table XML still refuses import. `spreadsheet-fields-model.ts` reuses canonical intake field IDs and namespaces roster-only IDs. Bindings retain source headers, source column coordinates (null for inserted columns), header-row provenance, original worksheet row numbers and suggestion/manual basis. Import detects/selects a header row, retains unbound columns and tracker text, rejects duplicate fields per sheet, and physically removes preamble and excluded columns/sheets. Canonical coercion/schema issues show original worksheet rows and columns without blocking library import; workflow Intake still refuses invalid execution rows. Stable-field read/write helpers preserve headers, formatting and row identity and refuse invalid patches atomically. OCR matching, person-lookup fallback and workflow roster updates remain backend wiring work; no frontend automatic match or durable write is implied. Preserve validation, cancellation, draft exit guards and the 50-version Undo bound. Save uses the opened library version and matching readback; conflicts and uncertain writes retain the draft. The workbook-to-Intake bridge binds the exact saved version. Spreadsheet types use the served library catalog; explicit mock compositions own their separate types. Roster-only fields keep original tracker values; workflow-specific transaction semantics belong to execution admission. |

`QueueSurfaceWire.outcome` is an optional `{ label, tone }` value with tone `success`, `warning`, or `neutral`. The backend projects it only for a `done` run with a verified `completion.terminal-result` receipt. The receipt must match the Queue row's run, trace, attempt, workflow, descriptor, and config identities. A declared workflow outcome must match a satisfied, unredacted fact at the declared field path. A missing receipt, unverified result, or absent or unvalidated fact leaves the outcome unset. A mismatched identity or undeclared raw value throws a projection error. Served Queue wiring maps canonical outcomes by run ID to UI2's existing badge. Rows without an outcome keep the lifecycle badge.

## Component intent and wiring acceptance

Each replacement keeps the mounted view model and exact action semantics below. These are required
wiring checks, not declarations that a producer is connected. A missing backend authority must be
resolved at its owning contract before workflow execution.

| Feature intent | Read data and action | Persistence / completion rule | Frontend acceptance evidence |
| --- | --- | --- | --- |
| Choose and follow a workflow | Catalog capability → day/run snapshot → ordered events. Select exact run/attempt; issue only served action descriptors. | Authoritative run identity, status and revision come from the service. Local overlays must settle against the original command; refused/unknown results cannot invent success. | `workflow-catalog.test.ts`, `queue-command-lifecycle.test.ts`, `frontend-fault-pages.test.ts` in `tests/unit/dashboard/`. |
| Start or rerun work | Canonical inputs/options/steps → matching plan → reviewed start command. Rerun retains original lineage while creating a new attempt. | Persist accepted inputs and plan identity under the task contract. Cancellation creates no run; duplicate activation stays locked; uncertain recovery reads the original operation. | `run-start-model.test.ts`, `start-plan-contract.test.ts`, `run-launch-recovery.test.ts`, `workflow-mock-model.test.ts`. |
| Inspect a log or act on a decision | Ordered steps, observations and evidence → Review/Resolve/View failure shortcut. Target the exact decision entry and visibly focus it inside Logs after clearing search. Mock and served OCR Review open the shared Records body through the route owner; served Logs retain native review status and invalidated changes. The decision control is the command. | Preserve exact step/entry/record/run identity and revision. Shortcuts never approve or resolve. Review approval requires explicit consent and matching acknowledgment; uncertain external writes remain Write parked with reconciliation. | `run-header.test.ts`, `log-panel-model.test.ts`, `log-decision.test.ts`, `workflow-mock-model.test.ts`; `frontend-controls.test.ts` and `ocr-card-layout.test.ts` cover visible focus and OCR Review with native Back/Forward. |
| Correct OCR and match a person | Immutable source/page identity + editable extracted fields + included records → approve the reviewed input. Spreadsheet bindings supply canonical fields for matching; unresolved identity needs Person Lookup or operator resolution. | Bind approval to exact source, corrected record set and revision. Multiple/no matches remain explicit; never select a plausible identity silently. Approved inputs are immutable; parent/child joins and independent outcomes remain visible. Match policy belongs to the intake owner. | `workflow-mock-model.test.ts`, `spreadsheet-fields.test.ts`; OCR record/toolbar browser specs. Backend matching is not implemented by these fixtures. |
| Replace extraction or a reading step with manual input | In the start preview, PDF `ocrMode` selects extraction or manual review without disabling delegation. Typed manual reading values belong to a specific workflow/step/field; form-fill/save/submit actions stay included. | Persist the mode, typed values, operator provenance and schema/revision with the accepted plan. The manual start preview begins with blank predefined records; delegated OCR still needs explicit immutable approval, while standalone OCR has no downstream approval and its Records stay editable after completion; existing-record edits persist through the revision-bound OCR commands. Served Add record creates a durable, unselected operator-added record through the revision-bound review client. Approval freezes exact selected membership; uncertain creation checks the original command without redispatch. [Data intake](data-intake-and-edit-data.md#44-durable-extracted-records) owns the provenance and authority details. The normal Read document checkbox controls extraction and its included count. Validate identity, required fields, page bindings and downstream data; manually entered assertions never substitute for a submit receipt or permission. These start-mode controls and typed step overrides remain preview-only until their owning intake/start contracts admit them. Existing served Person Lookup/Separations descriptors are unchanged by the preview. | `workflow-manual-input.test.ts`, `workflow-mock-model.test.ts`; `workflow-manual-input.test.ts`, `ocr-launch-plan.test.ts`, `ocr-direct.test.ts`, `ocr-card-layout.test.ts` and `workflow-mocks.test.ts`. Preview field keys and aliases are presentation contracts, not admitted backend DTOs. |
| Import, read and update a roster | Worker import → choose header/columns → optional canonical field bindings → register copy. Workflow readers use field IDs, not display labels or column positions. | Preserve source/header/column provenance, mapping revision and stable row identity. Persist only selected data. Refuse duplicate bindings; show canonical value issues while retaining original library cells. Workflow execution validates rows through canonical coercers and the workflow schema; invalid typed patches refuse atomically. A workflow roster update needs the owning workflow's confirmed outcome and required approval; reconcile unknown outcomes before retry. Durable library storage and workflow write authority remain backend work. | `hr-gpt-polish.test.ts`, `spreadsheet-column-import.test.ts`, `spreadsheet-fields.test.ts`, `spreadsheet-history.test.ts`. |
| Confirm a completed action | Guarded local approval, discard/restore, launch/rerun and deletion → existing shared success toast. Refused actions return no success notification; messages contain no entered field values. | Replace local completion with exact matching command acknowledgment/readback. Preserve pending, refused and uncertain arms; an optimistic click cannot certify success. | `workflow-review-actions.test.ts`; `ocr-launch-plan.test.ts` and `ocr-direct.test.ts`. |
| Save a setting | Effective/default/override metadata → typed edit → revision-bound save after typing settles (700 ms ordinary, 1200 ms credentials) or focus leaves the field → matching readback. Moving within a composite field does not flush; invalid drafts keep inline validation. Ordinary folders retain native pickers; app-data paths are read-only. | No Unsaved changes text. Only matching acknowledgment plus readback emits the shared value-free saved toast. Refusal emits a danger toast; conflict or uncertainty emits a warning toast. Retain drafts and exact retry identity; blur never automatically retries a failed attempt. Persisted and active revisions stay distinct; save feedback survives toast expiry. Protected values follow existing backend authority. | `settings-save-feedback.test.ts`, `settings-editor-surface.test.ts`, `settings-protected-surface.test.ts`, `settings.paths-surface.test.ts`. |
| Connect ChatGPT | Continue invokes the account port directly; show verified account state and acknowledged sign-out. | OAuth, consent, eligibility and secure token persistence are backend responsibilities. A logged-in identity alone does not establish subscription-based OCR eligibility. Keep expired, unavailable and usage-limit states distinct. | `chatgpt-account.test.ts` and the ChatGPT account browser specs. Check official eligibility before replacing the preview adapter. |
| Manage a worker and keep an idle browser alive | Resource state → add/pause/resume/stop/remove command. A white five-minute ring requests refresh only while idle and every resource is ready. | Refresh the owned physical browser session, not the dashboard page. Backend checks session identity, ownership/generation and busy/replaced refusal. Rearm only after matching acknowledgment; use/unavailability/unmount cancels the timer. No uncertain/refused automatic resubmission. | `session-preview-command-model.served.test.ts`, `session-idle-model.test.ts`. Pending controls hydrate from native operations after remount; use, another control, replacement, unavailable authority or unmount cancels the ring. Only all exact physical acknowledgments rearm it. |
| Inspect readiness | Served Preflight/storage checks with scope/fingerprint/time → rerun → remedy navigation. | Retain completed geometry during rerun; acknowledge the checked identity/time. A remedy navigates, never repairs merely by rendering. Missing checks remain explicit. | `settings-status-sections.test.ts`, `settings-storage-doctor.test.ts`; Preflight browser spec. |
| Find a run or open a notice | Complete authoritative search / canonical inbox event → validated exact destination. Mark read separately from resolution. | Signed `sc1` pages retain one query, facet set and snapshot through completion. Refused or expired cursors fail visibly. Read/unread/read-all and canonical snooze use the shared command executor and matching readback; uncertainty retains the original attempt without automatic retry. | `search-wiring-adapter.test.ts`, `inbox-wiring-adapter.test.ts`, `run-navigation.test.ts`, `dashboard-app.notifications.test.ts`; mocks retain the existing local fixtures and controls. |
| Undo an edit or discarded review | Settings text fields retain native typing undo without inline Undo buttons; unsaved date/folder selections revert within their field. A discarded OCR review restores with Ctrl+Z/Cmd+Z while focus remains in Records; approval cannot be reversed this way. | Preserve exact run identity and draft records through discard/restore. Do not turn text undo into a global run action or retry an uncertain write. | `settings-save-toasts.test.ts`; `ocr-direct.test.ts`; `workflow-components.test.ts`. |
| Review OCR document fields | Roster and document-type choices share one row. Supported direct choices exclude Verify. Every current OCR shape omits Notes; valid manually entered Employee IDs show no provenance warning. | Preserve manual identity provenance separately from verified lookup evidence. Employee IDs must match `^10\d{6}$`; invalid IDs, unknown records and other required approval fields still refuse release. Parent document type controls predefined fields. | `workflow-components.test.ts`, `workflow-catalog.test.ts`, `workflow-manual-input.test.ts`; `ocr-direct.test.ts` and `ocr-card-layout.test.ts`. |
| Enter a date | Shared segmented date controls display MM/DD/YYYY, preserve month/day during year entry and retain partial segments during unrelated rerenders. | Keep ISO transport values separate from display formatting; the US-format parser and emitted four-digit year must round-trip. Invalid/incomplete edits remain editor state. | `date-format.test.ts`; `date-typing.test.ts` reproduces the General Job end date bug and checks every year digit, calendar selection and Escape. |
| Explain dashboard outcomes | Complete selected run population → period/status/workflow selection → matching population and exact Logs. Successful measured root runs alone supply workflow duration averages; all terminal runs supply duration tiles. | Count, export and drilldown must agree on one population. Missing duration differs from measured zero. Sorting/filtering precede paging; no labor-saving metric is implied. | `activity-duration.test.ts`, `activity-drilldown.test.ts`, `activity-volume.test.ts`; Analytics filter browser spec. |
| Explain a workflow | Stable definition/node/operation/field IDs, display conditions and sources → Explorer disclosure or source destination. | Use compiler/catalog authority; do not turn a preview definition into executable availability. Missing/withheld source values remain explicit. | `explorer-mock-workflows.test.ts` and Explorer browser specs. |

Served Sessions availability uses `SESSIONS_UNAVAILABLE`; actual crashed and expired lifetimes use `WORKER_CRASHED` and `WORKER_LEASE_EXPIRED`. The shared catalog owns fixed text with empty parameters. Command/context failures reuse `COMMAND_*` and `DASHBOARD_AUTHORITY_REPLACED`; original diagnostics remain nonrendered and never become message parameters. Operator stop and shutdown labels are informational.

Sessions Add retains one native plan and once-assigned spawn requests for exactly the newly admitted members. It confirms only after the exact plan and every selected spawn application are audited. Partial or lost replies stay uncertain; Check never starts unsent spawns. The mounted adapter retains the compound across Day/catalog reconnects. Full-page/process loss does not retain this private compound envelope: native operations and exclusions remain durable, but Check cannot reconstruct or finish unsent child requests. No automatic completion or retry is implied.

## Canonical reads and routes

The route implementations live under `src/backend/transports/http/routes/`. Model schemas own
field membership and discriminated states. The client checks identity as well as parsing shape.

| Read or command | Client owner | Route owner and path |
| --- | --- | --- |
| Bootstrap | `queries/shell-queries.ts` | `shell.ts`: `GET /api/v1/bootstrap` |
| Calendar | `queries/shell-queries.ts` | `shell.ts`: `GET /api/v1/calendar` |
| Cross-date search and exports | `queries/shell-queries.ts`, `commands/export-commands.ts` | `shell.ts`: `GET /api/v1/search`, `POST /api/v1/exports/search`, `POST /api/v1/exports/xlsx` |
| Day snapshot | `queries/queue-queries.ts` | `queue.ts`: `GET /api/v1/dashboard?day=` |
| Start and rerun planning | `commands/start-commands.ts` | `queue.ts`: `POST /api/v1/start-plans`, `POST /api/v1/rerun-warnings` |
| Run detail, attempts | `queries/detail-queries.ts` | `run-detail.ts`: `GET /api/v1/runs/:runId`, `/attempt-history` |
| Lazy run sections and rerun values | `queries/detail-queries.ts`, `queries/rerun-queries.ts` | `data.ts`, `trust.ts`: `GET /api/v1/runs/:runId/:section`; `data.ts`: `/rerun-values` |
| Verified diagnostic bytes | `queries/detail-queries.ts` | `trust.ts`: `GET /api/v1/diagnostic-bundles/:bundleId`, `/manifest`, `/attachments/:artifactId`; verified artifact URL `/artifacts/v1/:artifactId` |
| ChatGPT account | `queries/chatgpt-account-queries.ts` | `chatgpt-account.ts`: `GET /api/v1/settings/chatgpt-account`, `/sign-in/:attemptId`; `POST /sign-in`, `/sign-in/:attemptId/cancel` under the account path |
| Settings | `queries/settings-queries.ts`, `commands/settings-commands.ts` | `settings.ts`: `GET /api/v1/settings/facts`, `/editable`; `POST /api/v1/settings/path-picker`; commands through `/api/v1/commands` |
| Preflight | `queries/preflight-queries.ts`, `queries/chatgpt-account-queries.ts` | `settings-preflight.ts`: `GET /api/v1/preflight`, `POST /api/v1/preflight/rerun`; explicit diagnostic through the existing `chatgpt-account.ts`: `POST /api/v1/settings/chatgpt-account/test-ocr` |
| Storage doctor | `queries/storage-queries.ts` | `storage.ts`: `GET /api/v1/storage/doctor/latest`, `/api/v1/storage/doctor` |
| Clear run history | `queries/storage-queries.ts`, `commands/settings-commands.ts` | `storage.ts`: `GET /api/v1/storage/run-history`, confirmed `POST /api/v1/storage/run-history/clear`, result-only `POST /api/v1/storage/run-history/result` (never starts an unrecorded command); requires the selected-person `runHistory` service in composition; Clear/result carry the confirmed profile ID and session epoch, admitted before effects and stripped from the internal journal request |
| Notifications | `queries/notification-queries.ts` | `notifications.ts`: `GET /api/v1/notifications`, `/status`, `/:notificationId/target` |
| Analytics | `queries/activity-queries.ts` | `activity.ts`: `GET /api/v1/reports/activity`, `/api/v1/reports/activity.csv`, `/api/v1/reports/activity/population`, `/api/v1/reports/activity/population/selected`, `/api/v1/reports/activity/population.csv` |
| Explorer | `queries/explorer-queries.ts` | `explorer.ts`: read-only `GET /api/v1/explorer` |
| Intake | `queries/intake-queries.ts` | `intake.ts`: `POST /api/v1/intake/files`, `GET /api/v1/intake/:sessionId` |
| Workbook revisions | `queries/workbook-library-queries.ts` | `workbooks.ts`: read-only `GET /api/v1/workbooks/:libraryId/revisions/:version`; exact CAS revision for attachment open/download, independent of named-version history |
| Commands | `commands/shared-commands.ts`, `index.ts` (`workerCommandResult`) | `commands.ts`: `POST /api/v1/commands`, `/api/v1/commands/bulk`; read-only `GET /api/v1/worker-commands/:commandId` |
| Day events | `subscriptions/subscription.ts` | `shell.ts`: `GET /events/v1?topics=dashboard-day:<day>` |

`FrontendBootstrapWire` carries actor, server clock, descriptor/config identity, workflows,
Settings sections, storage, and readiness. `DashboardDayWire` carries the selected day's queue,
counts, workers and pools, notifications, and projection identity. Its optional `attemptHistory`
contains each queue run's `runId`, `startedAt`, and `endedAt` for that day, including runs in
progress. When present, `DashboardDayWireSchema` requires exact run membership and matching
timestamps with `queueSurfaces`. The Queue view model numbers each item's runs from 1 in ascending
`startedAt` order, then ascending `runId` for ties. The latest run has the highest number. The
attempts menu lists only runs on the selected day. Choosing a run changes the selected `runId`, not
the day. The day number is a display label. Queue selection and commands keep each run's canonical
`runId` and backend `attempt` identity. `RunDetailWire` and section models
bind the exact run and section revision. `StartPlanWire` binds descriptor/config/input identity,
accepted options, selected steps, and a plan token. A displayed preview does not certify these
backend paths are connected to that preview.

## Command outcomes and recovery

OCR correction, discard and restore use the `ocr-review` command family with an exact run and
expected review revision. Their immutable revision, command/audit history and canonical run-version
advance commit together, preserving the existing Queue and selected-detail replacement flow.
The `review` section includes full source-bound OCR data and approval snapshots. PDF uploads use
the guarded `/api/v1/ocr/files` byte route; source pages require run, revision and original page
coordinates. Read-only `/api/v1/runs/:runId/ocr/commands/:commandId` settlement returns the original
authenticated result for uncertainty checks without dispatching the command again.
If a later review revision supersedes an uncertain correction, that result still authenticates the
original historical effect. The executor settles that command; the editor retains its draft as a
conflict until explicit local discard reveals the current review. Missing or mismatched original
command evidence remains uncertain and cannot enable discard or another dispatch.

Read-only `/api/v1/worker-commands/:commandId` returns a local-operator worker command's journaled
request and audited result, or `unavailable` when no audit exists, without dispatching it again.
The Sessions panel reads it right after a worker control's reply is lost, on each later served day
and on Check outcome. A recorded rejection settles the attempt as refused, releases its lock and
toasts once. A recorded success still needs exact served readback. A command with no audit, or one
whose recorded request differs, stays uncertain.

The review projection supplies edit availability and the current approval-gate target. The shared
Records renderer receives canonical form fields, raw local drafts, native inclusion state and source
artifact identities; an image URL refresh does not reset its zoom. Corrections re-admit changed
fields through the OCR model while preserving untouched answers and source evidence. Autosave sends
one revision-bound record change at a time. Controls remain locked until the displayed revision
reaches confirmed native readback. Approval binds the current gate version, review digest and exact
selected membership, then verifies the persisted snapshot. Readable child workflows appear in the
catalog for review without gaining public start authority. Served Add record uses the same revision-bound
client and uncertainty checks; [data intake](data-intake-and-edit-data.md#44-durable-extracted-records)
owns durable creation, operator provenance and source binding.

Run detail may serve a `childRetry` action for the current failed OCR child while its unapproved
parent can join it or qualifies for an authenticated read-only refresh from review or completion.
Queue rows, linked-run chips and detail select the same panel kind from authenticated review availability.
Logs renders it in the header and dispatches the existing `run/retry` command through the shared
executor. The action binds the exact child revision;
readback verifies the immutable source and one replacement's native `retryOf` and parent identities,
including the exact parent target when the retry advances its version.
After a lost reply, the retained exact command may be replayed after the action disappears if the
original failed child and revision still match. A root run or changed revision cannot use that path.
Successful, replaced, paused, approved and uncertain-write children have no retry action. The native
refresh holds the parent until all accepted replacements settle, then resumes the same run to
rebuild its review.

The command envelope carries `commandId`, `requestedAt`, `requestedBy`, `source`, and optional
`reason`. The request adds its exact `family`, `type`, target, and payload. Run targets use
`runId` and `expectedVersion`; pool targets use `workflowId` and a nonnegative `expectedVersion`
where zero means verified absence of a pool row. Live Stop requires exact `membershipRevision` and
`controlBasis`; its optional lease version is observed request evidence. Remove and Retry also bind
the pool version and workflow. Pause, Resume and browser controls retain their served basis; browser
commands bind the physical `browserSessionId`. Settings uses `expectedRevision`.
Do not substitute patch revisions, another attempt's identity, or current form values at settlement.

`app/commands/command-result.ts` is the shared settlement owner. `CommandExecutor.check` reconciles
a retained uncertain single command with read-only native application evidence, preserving the
original actor/client and the current authority/request scope. Missing or mismatched evidence keeps
the original reservation; it never dispatches or replays the command.

| Wire `state` | Settlement | UI obligation |
| --- | --- | --- |
| `applied` | `kind: applied`, `replayed: false` | Show acknowledgment, then authoritative readback/projection |
| `already-applied` | `kind: applied`, `replayed: true` | Show the original operation's result without duplicate execution |
| `confirmation-required` | `kind: refused` | Present the exact `message` and `warningDigest` for explicit confirmation |
| `conflict` | `kind: refused` | Show `currentVersion`; reload authority before a new decision |
| `rejected` | `kind: refused` | Show the closed `code` and mapped message; retain the relevant draft |

Applied results require nonempty `affectedTargets`, except a canonical notification collection with
`matchingCount: 0`: it returns `affectedTargets: []` and `noChange: 'no-matching-notifications'`.
The audit and client readback bind this marker to that exact collection request. Its audit records no
version changes, affected dependencies, or write resolution, and its result carries no settings fields.
Replay preserves the marker in `already-applied`. Unmarked empty results, tagged nonempty results,
and marker claims for other requests refuse validation.

A committed Start retains its applied result and run targets when worker startup fails. Its
`workerStartup` field distinguishes refused startup from unknown startup without changing enqueue
authority. Confirmed readback closes the Start dialog, clears the retained submission and shows the
existing warning toast with the queued-run message. Startup failure remains a terminal diagnostic.

A pre-dispatch validation failure can say Nothing was sent. A failure after dispatch is unknown:
the backend may have recorded the command. Retain the original request/command identity and check
that attempt before another submission. Unknown external writes remain parked and offer
`recheck-write` or `resolve-write-absent` with exact intent identity. Recheck reads the real system;
the operator does not supply completion proof. They
never auto-retry. Navigation shortcuts to Review, Resolve, or failure evidence do not execute a
command. Machine verification is not operator approval.

Start uses `start-run` with `workflowId`, `startPlanId`, `expectedVersion`, and matching descriptor,
config, ingress/canonical schema, and input fingerprints. Omission forms use the declaration's
schema and send parsed output. The raw-draft fingerprint invalidates plans even for incomplete
edits; each async settlement retains its dispatch fingerprint. Confirmed cancellation creates no
new run. Rerun creates a new attempt with explicit lineage, never overwrites the original.

The workbook catalogue uses the existing client facade for named version create/use/rename/delete,
source/type changes and removal. Its catalogue revision and editable workbook revision both bind a
mutation. The immutable action record supports a read-only result check after a lost response;
a refresh never resubmits a change. Removing catalogue membership keeps retained snapshot evidence.
`workbookLibraryVersion` reads exact named bytes independently of the numeric editable revision.
Reference requests may choose `versionId`; the retained snapshot carries its matching `versionId`
and `versionName`, while `version` remains the current library CAS revision. Row-choice producers
read named bytes through `WorkbookLibraryRepository.libraryVersion`, preserving selected worksheet
and row identities even when a run chooses a version other than the one in use.

Runs with captured workbook references advertise the lazy `workbook-writes` section. Native receipt
events order its existing Logs decision rows. Row choices carry the original receipt digest and live
workbook revision; confirmations send only worksheet/row identity through `resolve-workbook-row`.
Readback requires both the resolved original receipt and the applied command-derived operation.
Refused live revalidation refreshes the served choices without changing the retained write values.
The same section's optional `referenceChoices` carries Onboarding read choices separately from write
operations. `resolve-workbook-reference-row` binds `referenceTarget` to the run, gate, exact reference
digest, type, key and live revision. Its payload contains only sheet and row identity. The server
rebuilds typed chosen values, records the canonical gate result and resumes once; it creates no write
receipt. An unavailable choice has zero candidates. Successful readback uses the resolved chosen
evidence and native run version. Dashboard dispatch remains unavailable until its Logs wiring lands.

Served Run and Rerun have no worker choice in the form, request, response or retained start plan. Starting
uses the workflow's live workers and starts exactly one when none is live. Only Sessions Add workers
adds more. The start command consumes the accepted plan without a worker field.
Pool admission and replay follow [execution and sessions](execution-and-sessions.md#113-capacity-for-a-submitted-start).

Bulk commands preserve a parent request and per-run child outcomes rather than claiming all-or-none
success. A refused or unknown child cannot become an applied count. Deletion uses the actual
parent boundary and exact target revision; confirmed deletion clears selection before readback.

Settings distinguishes persisted and active revisions. Ordinary saves debounce 700 ms, credentials
1200 ms, or flush when focus leaves the whole field. Pending attempts lock controls. Only matching
acknowledgment and readback create a saved toast. Conflict, refusal, and uncertainty preserve the
draft and original attempt, with explicit recovery rather than a blur-triggered retry.

Readiness reads during an active Run preflight await that check's settlement. The previous report
remains visible as checking, or the surface shows its checking state when there is no report.
Actual read failures and invalidated authority remain explicit. A 200 expired-readiness response
carries `PREFLIGHT_EVIDENCE_EXPIRED` with its last report; only that validated expected expiry is
excluded from generic failed-read diagnostics.

## Paging, events, and reload

`app/navigation/url-state.ts` and `ViewRouteSchema` own public page coordinates. Search typing
replaces history; selection, page, wizard, and breadcrumb navigation push it. Native Back/Forward
uses the same owner. Private values, uploaded bytes, pending commands, OCR edits, read receipts,
and workbook history never enter URLs. Drafts survive navigation within the mounted session, not
reload. Reloading a URL cannot recreate a locally created run or private draft. Unknown targets
remain unavailable. Workflow selection, appearance, and keyboard preferences have separate browser
preference owners.

Queue and Logs retain all loaded records in the DOM. Offscreen layout deferral and row reuse
reduce layout work without bounding memory. Backend cursor pages must preserve complete
search/copy/jump behavior and distinguish loaded rows from authoritative total counts. Analytics
serves snapshot-bound filtering and sorting before slicing 20-row pages; the browser consumes that page without slicing it again. Spreadsheet rendering is bounded to
50 rows and 20 columns, with full-sheet search and physical import projection. Archive is unmounted.
Served shell search reads the backend cross-date index through every signed `sc1` page before
publishing results. Pages must share query, facets, snapshot and authority total; the footer uses
`totalMatches`. Stale responses cannot replace a newer query. Historical evidence and stored
reports keep their identity and migration authority.

`useDashboardDay` opens one day subscription only when its composition needs served data. The
subscription states are `connecting`, `live`, `reconnecting`, `degraded`, and `stopped`.
`DashboardStreamEnvelopeSchema` names `hello`, `snapshot`, `patch`, `reset-required`, `health`,
and `notification-publication`.
The client holds projection generation and `pc:<number>` cursor. A generation change resets both
snapshot and cursor. A snapshot behind the held cursor is stale; a same-cursor snapshot replaces
the day. A patch at or below the cursor is ignored. Missing baseline, cursor gaps, and invalid
patch application trigger a resnapshot. Malformed envelopes or non-network stream failures stop
with visible error. Network loss resumes using `lastEventId` and `lastProjectionGeneration`.
Superseded stream completions cannot reconnect the new stream.

Notification subjects use the registered title projection and the matching retained evidence receipt when a workflow declares one, through the same canonical title resolver as Queue. Unavailable or refused title authority stays unavailable; it does not fall back to a checkpoint or guessed name. Other declared subject projections retain their checkpoint identity checks. This display context belongs only to the served inbox; durable notification summaries and OS delivery are unchanged.

Notification publications originate after the authority transaction commits. They are live-only,
nonretained events with explicit source identity; baseline reads, replay, reconnect and resnapshot
never synthesize publications. The stream/client validate actor, day, descriptor and generation,
and the mounted subscriber retains its request/client scope. Only eligible committed source events
can toast, once per source; snoozed rows and control revisions do not toast. The adapter applies the
eight source-event policies and shows catalog notices for missing source evidence or backfill gaps.
Snapshot/status reads remain the inbox authority. Read state does not resolve urgency.

Keep loaded rows during reconnect and show connection authority separately. A new day/request
cannot paint the previous request's result. Detail refresh follows the selected run's revision,
not a remembered timestamp. `state/served-clock.ts` derives elapsed time from the server instant
and monotonic browser time. Terminal durations stop at `endedAt`; missing timing remains explicit.

## Acceptance

The checklist's acceptance files live under `tests/unit/dashboard/`, and `tests/integration/dashboard/`
by feature. `frontend-fault-pages.test.ts` mounts the app through the typed
client with HTTP fixtures and controlled SSE: delayed bootstrap/snapshot, startup failure, stale
cursor refusal, disconnect with retained rows, and exact-cursor resume. Port replacements exercise
confirmed, refused, failed, and uncertain outcomes through the mounted component. Keep the successful
mock case for behavioral comparison. These checks do not establish live service admission.

Boundary checks in `tests/architecture/dashboard/` cover wire connectivity, browser import closure,
Fast Refresh exports, Settings vocabulary, and the absence of phone capture. Performance fixtures under
`tests/perf/frontend/` prove complete search/copy/selection, interaction, and heap cleanup against
Queue and Logs without HR services. Visual wiring is checked against the approved mock with `/verify`. No source schema, assertion, membership, timeout,
or coverage floor changes merely to make wiring pass.

[Dashboard surfaces](dashboard-surfaces.md) describes mounted behavior.
[Data intake and Edit Data](data-intake-and-edit-data.md), [write safety](write-safety.md),
[execution and sessions](execution-and-sessions.md), and [clock, configuration, and secrets](clock-config-secrets.md)
own their backend policies.

## Launch-time person storage upgrade

On Windows, `relay.cmd` runs the production bootstrap with portable Node and opens a dedicated
Edge app profile. Its parent owns the backend child and a random IPv4-loopback stop broker.
`relay.cmd stop` reads a private capability under `%LOCALAPPDATA%\Relay\launcher`; nonce-bound
HMACs authenticate both the stop request and its receipt. The capability is never transmitted.
The broker forwards only the exact IPC stop message, keeps repeated requests waiting through the
same drain, and reports success after a post-bootstrap receipt and the child's actual `close`.
It never escalates to process termination. A bare, uncaused Windows backup-custody refusal after
resource closure is a normal stop with an explicit backups-unavailable notice. Other failures
remain failures. The Windows backend is detached and hidden with no inherited console IO;
launcher death disconnects IPC and requests the same drain. A second launch authenticates with
the existing parent to reopen the app window. Failed commands print public reasons and keep the
command window open. The operator closes the Edge window separately.

The broker record is written and flushed to a unique private stage before publication. Windows
uses same-directory `MoveFileExW` without replacement; POSIX uses exclusive link publication and
removes the stage, admitting its two-link transition only for this ephemeral control record.
An interrupted stage cannot become a partial `broker.json`, and a second publisher cannot replace
an existing owner. This control record grants no storage-maintenance durability or custody.

Dashboard bootstrap upgrades supported registered READY person databases before shared runtime
admission, HTTP listeners, notification producers or account providers. The same lifetime listener
retains stopped exclusive custody through source inspection, verified backup, migration and current
readback. A failed upgrade prevents the public shell from starting and reports
`STORAGE_PROFILE_UPGRADE_REFUSED`; uncertain native closure retains its actual resource owners.

Sign-in authenticates a current profile through the ordinary endpoint and session cookie. It does
not dispatch storage maintenance or restart the app. Pending onboarding and logout continue through
their existing recovery boundaries.

The Relay login is the work email and password saved as the profile's UCPath sign-in.
`POST /api/v1/profile/account/password` `{currentPassword, newPassword}` and
`POST /api/v1/profile/account/username` `{currentPassword, newUsername}` change it for the current
session cookie only. They return `{state: "changed"}`, `{state: "unknown", code}` or
`{state: "refused", code}`. A wrong current password counts toward the sign-in lockout. A new
username must be a plain `@ucsd.edu` address the sign-in form accepts, must change the verifier key
and must not be taken; a new username or password longer than the form's 160 characters, or a
password with a line break the form's single-line input would remove, is refused. Refusals leave the saved login unchanged.

The change saves both UCPath entries in one marked write, then swaps that profile's verifier row as
its commit point, and only once the entries are proved durable. If it stops between them, it
answers `PROFILE_LOGIN_CHANGE_UNSETTLED` and the session stays signed in: its next change writes the
proved old login back first, and after a restart resume is refused until a sign-in with the old
login writes it back. Recovery reads the credential store's own history (`lastEntryWriters`) and
writes back only while a marked login write was the last to set both entries, so it survives
unrelated protected saves and never overwrites a later Settings set, clear or erase. Neither path
needs a logout, so parked writes stay held. A swap that landed is never undone: if only its flush
or directory close failed, the result is `{state: "changed", durability: "unconfirmed"}`, the
failure is logged and an unclosed descriptor stays held by its owner. If the verifier cannot be read
back after a failed swap, the result is `PROFILE_LOGIN_CHANGE_UNKNOWN`, nothing is undone and
neither login is promised. A change that settled keeps its result when only the profile lock's
release fails; that failure is logged and any unclosed descriptor stays held. A changed or unknown
result whose fault cannot be written still answers its outcome, marked `diagnostics: "unrecorded"`. An old-login restore
that cannot prove its write durable fails the sign-in or change that ran it, which may then be
retried. The epoch, Duo material and other profiles are unchanged.

`POST /api/v1/profile/account/details` `{name?: {firstName, lastName}, initials?, timekeeperName?}`
changes the current session's Name, Initials or Timekeeper name in its registry row. It needs at
least one value and returns `{state: "changed", account}` or `{state: "refused", code}`. Every value
is checked before anything is written, so one refused value changes nothing:
`PROFILE_DISPLAY_NAME_REFUSED` for a name the sign-up rules refuse, `PROFILE_INITIALS_REFUSED`
unless the initials are 1 to 8 letters A to Z, and `PROFILE_NAME_REFUSED` for a timekeeper name
that is padded, has a control character, is longer than 129 characters or has a word that does not
start with a letter. Timekeeper initials are not stored; they are `profileInitials(timekeeper)`.
`/profile/state`, bootstrap's actor label and the next run's timekeeper read the new values. A run
already planned or started keeps the timekeeper name it captured.

### Profile onboarding boundary

Details returns canonical `onboarding` state and a limited HttpOnly cookie scoped to profile routes.
`readProfileSession` carries current server method states. The onboarding Duo start, confirm and
exact-attempt cancel routes operate only on the issued operation and attempt; closing a setup popup
preserves the draft. Whole-draft cancellation returns signed-out only after canonical custody and
erasure proof. Neither Details, Duo completion nor entering Ready publishes a saved account.

The Ready Finish callback invokes `completeProfileOnboarding({operationId})`. Backend receipts for
both software FastDuo and native Mac Touch ID, proved provider closure and explicit Finish precede
registry/verifier/active-session publication. Only the ordinary returned session cookie mounts
bootstrap, Queue, Run and HR data authority. Failed or unknown publication remains a defined HOLD;
public error codes never expose private causes or credential values.

Sign-up creates a fresh private profile; there is no existing-data claim route or form state.
Before composing profile runtime, dashboard startup migrates a pre-profile flat store into an empty
profile installation. The backup and deletion contract lives in `clock-config-secrets.md`.

Returning to Details or login cancels the whole draft through canonical credential erasure after
provider closure. Startup removes leftover unfinished drafts through the same path, after proving
onboarding browser roots unused. A recorded Finish completes publication at startup instead.
Local profile credentials and Duo material are removed; devices already enrolled at Duo remain there.
A stale or signed-out public session returns to login and does not reopen a retained draft.

The typed profile client parses defined wire errors into public refusal codes. Login and sign-up
render the refusal's catalog sentence; network reachability failures use the connection-failed catalog sentence. Other client exceptions retain the authority-unavailable sentence.
Show setup browser may refresh unavailable public authority with the current cookie, then shows only
that same operation and profile. Unknown method outcomes stay unknown while that draft is active.
Show focuses the owned extension tab or recreates that tab once in the same live context. A closed
window is replaced only after the exact context close event, all tracked pages, the observed process,
and startup, tab, portal and pump callbacks prove closure. A lost worker-stop acknowledgment during
window shutdown is superseded only by that complete proof and validated owned-profile deletion;
otherwise its cause and the closure failure remain uncertain and replacement is refused. Show never
starts enrollment or submits SSO. Each successful Show or Open also focuses the owned browser
window, including its initial opening and a replacement after proved closure. A rejected attempt
initialization is awaited to settlement during cleanup; its Unknown result and refusal fences remain.
Explicit Open Duo reuses a successful opening within its context and retries a failed opening in
the same tab. A direct HTTPS `duosecurity.com` landing acquires no credentials and establishes no
enrollment proof. The starting `duo.ucsd.edu` URL does not settle the bounded sign-in wait.

Settings Preflight owns the OCR diagnostic presentation and request lifecycle in
`surfaces/settings/preflight/preflight-ocr-model.ts`. The profile-scoped shell composes it with the
existing account port for freshness and plan eligibility and the existing `testChatGptOcr` typed
client method for inference. The endpoint and canonical `ChatGptOcrTestResultSchema` remain under
the account transport; there is no second API or preflight-admission result type. A diagnostic is
never dispatched by readiness reads, reruns or scope refreshes. The shell disposes the diagnostic
before the account owner when the active profile changes or the page closes.

### Run reference and output plans

`WorkflowStartWire.requiredWorkbookFields` and `workbookReference` declare the required fields,
logical capture ID, key, mode and writable outputs. The dashboard sends one explicit
`workbookReferences: [{entry, libraryId, versionId, sheetId, expectedVersion, selectedRow?}]` selection
per entry. The browser cannot supply lookup keys, fields or write authority. Keyed workflows
declare `referenceKeys(input)`; planning derives the captured request from that callback and the
frozen static declaration. Each selected worksheet must map every required field exactly once.

`selectedRow` requires an explicit library, an immutable named version and exactly one derived key.
The descriptor's `inputRun.workbookRows` must declare that logical capture ID, and its input field must equal
the derived key. The selected sheet/row pair must occur exactly once among that key's retained matches.
Expected unavailable selections produce entry refusals. Captured references bind canonical input before
identity, display and output planning. [Onboarding binding](workflow-model.md#11-shape) owns its typed values and execution authentication.

Each selected physical row remains an ordered ordinary submission with its entry-scoped reference.
Duplicate normalized emails and active identities remain explicit per-entry refusals. Accepted entries
become independent runs with `shape: single` through the existing fanout under one reviewed command. Selection never silently
deduplicates entries. Public `planned[].workbookReferences[].selectedRow` comes from the retained request.
The client verifies unique, in-range refusal indices, complete entry coverage and matching references for
each accepted entry before confirmation.

A workflow declares `plannedOutputs(input, references)` to project output facts from parsed input and captured references. These become `planned[].outputs` in the retained plan and public response and are bound into its input fingerprint. `src/models/dashboard/run-outputs.ts` owns the closed vocabulary: `workbook` with a known row count or `after-review`, a concrete `worksheet-archive` with its worksheet/row membership, or `worksheet-archives` with `after-row-choice` when packaging membership is unresolved. Confirm renders those served facts; absence never creates an output placeholder. A plan describes intended output, not a produced artifact.

## Local debug events

`src/models/failures/error-origins.ts` owns the closed cause vocabulary. Each trusted error class binds
its exact constructor to one row of static name, catalog or transport code and reason; runtime
`name`, `code` or message text never selects a row, and subclasses are not inherited. Unbound errors
keep their constructor name and a well-formed own `code` (else `INTERNAL_FAILURE`) with reason
`cause-unavailable`, non-errors become `UnknownCause`, chains stop at 16 rows with a fixed truncation row,
and frames keep only build-relative `src/`, `scripts/`, `node_modules/` or `assets/` positions.
Unexpected inner API failures emit one event per cause row with one correlation id for that failure,
after the request's outcome event.
Screenshot verification exceptions share `sessionId`. Worker supervisor and transfer faults emit one
event per cause row with one correlation id, and their stderr lines carry the same name, code and
reason. Profile-request rows go through `appendEmergencyFault` and do not carry a correlation id.
Exception messages,
request values and private file paths are omitted. HTTP responses retain the catalogued public code.
A request whose client disconnected records `request-disconnected` and its cause rows without an
HTTP status, so a cancelled transfer is never logged as a delivered 500.

`logs/debug-events.ts` is the debug timeline writer. Severity is derived from the persisted phase, reason and HTTP status for terminal output and diagnostics reads; no level is stored. Events retain redacted text, per-category size caps and the existing timeline retention. Development backend and worker launches mirror inserted events to stderr with time, level, category, phase, code, area, reason and structural IDs. HTTP events also retain method, registered route template and status in that mirror. Client routes, messages, stacks and request values stay out of the mirror. Production builds do not mirror.

The shared HTTP response observer records returned refusals, failures and uncertain outcomes, including HTTP 200 envelopes, and failures mapped by the thrown-error handler. It records the registered route template and approved codes, never body values. Asynchronous ChatGPT authorization, worker process/transfer faults and provider failures use the same writer at their terminal owner. A logging failure remains a named unavailable response or retained runtime failure. Asynchronous authorization retains its original completion separately from a diagnostic fault; completion readback shows the catalogued `LOGGING_UNAVAILABLE` error without an unobserved rejection or authorization retry.

The product client reports handled HTTP, network, binary, stream, schema and protocol failures through `/api/v1/debug/errors`, using the current surface, a value-free route, approved code and static reason. An unhandled `DashboardClientError` sends its first closed cause row; any other unhandled browser error sends `DASHBOARD_UNHANDLED_ERROR` with its message and stack. The server accepts a report only with `DASHBOARD_UNHANDLED_ERROR`, the fixed request-failure message and no stack, or a browser cause row whose name, code, reason and normalized frames match the closed vocabulary. The development mirror revalidates each payload before writing. Reports require an observed active profile session; signed-out, logout and stale-session paths send none. Reporting never retries an operation or changes its result. Report delivery failures use the existing browser error channel with the catalogued `DASHBOARD_ERROR_REPORT_UNAVAILABLE` error; the app excludes that error from recursive reporting. The terminal-failures architecture guard protects request catches and the production terminal sinks; the secret-values guard also covers debug emissions and client reports.

`npm run backend` starts only the development BFF; `npm run web` starts only Vite. `npm run dashboard` owns both and waits for BFF readiness without a time limit before starting Vite. Development launches set `RELAY_DEV_DEBUG_MIRROR=1` for backend descendants, including pool workers, so mirroring survives a fresh Node argument list. Production worker environments omit that flag; production entrypoints and Electron suppress mirroring.

The inactive M1 history repository in `backend/storage/sqlite/assistant-history.ts` stores structured payloads directly, assigns accepted ordinals/revisions/time from the transaction and server clock input, and captures the database-bound profile plus private live account epoch. Sending and settlement compare the captured accepted-turn identity and separate conversation creation fence, plus the exact new-acceptance object retained privately for this owner lifetime. Repeats and restored metadata carry no live identity; Clear, settlement, interruption and expiry invalidate it through the required private `afterCommit` port. All private identity transitions register inside the mutation and publish only after the real outer commit; nested/outer rollback cancels them. Activation must bind this port to the existing authority owner’s commit hook; supplied-port fixture coverage does not replace native-composition proof. Settlement records actual usage only on the accepted operator row and links its ordered reply atomically; interruption keeps pending usage and records delivery unknown. Imports and local captions remain literal/unrecorded. It shares semantic display accounting and the existing attachment store. Its replacement SQL is unregistered and construction changes no schema. The current text repository, migration, registry and served wire remain active; native admission must prove the single-profile database before maintenance, and backup/upgrade/caller cutover remain separate.

The inactive M2 proposal repository in `backend/storage/sqlite/assistant-proposals.ts` keeps the exact reviewed proposal snapshot (ordered rows, rendered message and digest, no own timeout), its once-only answer claim, one claim and result per row, and the durable session claims. A new proposal or any change request supersedes the chat's open one; the open count is the served needs-you count. SQL triggers keep snapshots immutable, answer once, and settle each row and session claim once; UNKNOWN stays terminal. Its candidate statements are unregistered; activation installs them after the M1 statements at the next free numbers after schema 29.
