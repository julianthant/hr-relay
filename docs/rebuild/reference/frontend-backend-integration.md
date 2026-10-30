# Frontend and backend integration

The dashboard uses one typed client facade. The mounted product currently combines served shell
configuration, Settings, inbox and cross-date search with local workflow producers. A client method or backend
route can exist without being mounted by the product. The tables below describe both the present
producer and the requirements for replacing it.

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

The composer recognizes the canonical setup command constants from `models/dashboard/assistant.ts`.
A model read uses that served view. A model set goes through the existing `CommandExecutor` and
`executeCommand` protocol, with `requestedBy` bound to `LOCAL_OPERATOR_ACTOR_ID`,
`source: dashboard-assistant-model-preference` and the view's exact profile, epoch and expected
revision. It is never an inference tool or a model-produced action. Normal command locks, receipt
validation, matching readback, refusal and UNKNOWN handling apply; a lost response does not cause an
automatic retry or invented success.

The explicit verification request uses the normal assistant respond route without `subjectRef`.
The backend recognizes the exact command before inference policy, private input projection, context,
subjects or tools. Recognized setup commands reject attachments before local file I/O or registration.
The separate composer `canCompose` input may admit the served unverified account resource, while
Confirm keeps the real `accountAvailable` requirement. An explicit verification settlement refreshes
the current served account binding once, without a polling or activation loop.

[Dashboard surfaces](dashboard-surfaces.md#assistant) owns operator setup behavior;
[Clock, configuration, and secrets](clock-config-secrets.md#assistant-choice-and-private-verification)
owns durable preference and private account authority. Neither a mounted control nor source wiring
establishes live model or operator acceptance.

## Static workflow source policy

`app/workflow-sources.ts` parses `config/dashboard-workflow-sources.json` into `WORKFLOW_SOURCES`.
Every declared value is `mock` or `served`. `workflowSource` throws `WORKFLOW_SOURCE_UNDECLARED`
for an absent ID. `PRODUCT_WORKFLOW_COMPOSITION` supplies the static product policy;
`DashboardApp` receives `productWorkflowComposition` by default. Person Lookup and Separations use `served`; the other configured workflows use `mock`.
Parity starts from an explicit mock policy and opts fixture workflows into served capability tests. There is no runtime served-to-mock fallback.

`WorkflowComposition.sources` controls workflow presentation; `explorerSources`, `logsSources`,
`dataSources`, `catalogIncludesMocks`, and `servedDay` allow explicit fixture composition.
The independent `inbox` and `search` sources are served in the product and mock in parity.
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
| Logs and OCR Records | `LogSample`, `WorkflowMockLog` and workflow/OCR producers in `workflows/mocks/`; retained `useRunDetail` transport is not the default mounted Logs producer | Ordered stable step/action IDs, timestamps, field observations, decisions, screenshot dimensions/availability and exact record/page identity. OCR correction and selection must survive navigation; approval needs one explicit matching result. An unknown write offers reconciliation, not a blind retry. |
| Start and Rerun | Shared launch/rerun models use typed planner/client for served starts; registered previews create local mock runs | Accepted inputs, required/omittable steps, resolved options, plan/source identity and matching command result. PDF plans display one selectable Read document step with OCR as its system label. Its checkbox maps to `ocrMode`, not removal of delegation or approval. The parent/document type fixes fields. OCR is directly runnable with a form-type choice and no downstream approval; only I-9 Lookup and SharePoint Download are parent-only. Keep downstream outcomes pending until approval. Interactive work has queue priority over Bulk background batches; labels do not imply immediate execution or preemption. Preserve pending locks, refusal and exact-attempt recovery. Every launch starts with Dry run off; it is an explicit operator choice. Sign-in steps stay included while a required form action on that system remains. A selectable catalog entry does not establish executable registration. |
| Settings, protected values and paths | Existing typed editor clients and revision/readback models | Personal contains General and Credentials; Advanced contains Performance, Paths and Routes. Their existing route IDs and editor authority are unchanged. Effective/default/override values, field metadata, persisted/active revisions and protected authority state. Names follow field paths; credential autocomplete is scoped to UCPath. Browser viewport remains developer configuration with no end-user editor. Pending save locks controls; uncertain save checks the original attempt. Native path picking remains behind its existing client. |
| ChatGPT account in General | `ChatGptAccountContext` supplies `ChatGptAccountPort`; production mounts the served account adapter, parity mounts synthetic account routes and an inert authorization opener | Continue with ChatGPT calls sign-in directly with plan use requested; no intermediate dashboard dialog. The adapter owns verified identity, real consent/eligibility, loading/expired/unavailable/usage-limit state and acknowledged sign-in/sign-out. Use the existing typed client and canonical model schemas when replacing the port. OAuth and secure token persistence belong to the backend. The typed account client reads state, starts sign-in, reads its original bounded completion, cancels, signs out, and explicitly tests OCR through the existing fixed synthetic-page diagnostic; tokens never enter the browser. Known expired sessions retain Disconnect; unknown account state does not imply credentials. OCR test loading, completion, refusal and uncertainty stay separate from account identity; a lost response is not retried. Unknown completion reads current state once without retry. Confirmed local sign-out remains distinct from a remote-revocation warning. Identity alone does not enable plan use. Provider budget/model and API-key controls are absent; Connected snapshots retain expiry and read state again at expiry. |
| Preflight and storage | Typed Preflight/doctor query and rerun clients | Served checks, scope/fingerprints, checked time and explicit unavailable/history state. Rerun retains the completed report's nodes and geometry. Shared remedy mapping navigates to Credentials, Routes, Storage, Sessions or Settings; rendering performs no repair. Storage excludes run history. |
| Sessions and workers | `sessionsFromDay` and `createSessionPreviewPort` consume the shared Day/client; explicit parity composition uses `sessionsSample` and `createFixtureSessionPort` | Six actual phases, exact member/lifetime and physical sessions come from `workerAuthority`/`workerCards`. Native `workerOperations` supplies immutable command, application and audit readback. Check reads the original operation without dispatch. Authority failure shows unavailable. Workflow source switches remain independent of Sessions. |
| Notifications and shell search | `inbox-wiring-adapter.ts` reads the canonical inbox/status and consumes committed publications; `search-wiring-adapter.ts` materializes signed cross-date search pages. Explicit parity composition retains local previews. | Canonical target resolution precedes shared navigation. Historical run/failure targets validate fresh exact identity and open generic served Logs, independently of the workflow preview source; storage opens Settings, while missing, archive and refused targets show catalog notices. Commands confirm exact actor/notification/version readback. Search preserves query, facets and snapshot identity and displays only authority `totalMatches`. Workflow-specific wiring remains separate. |
| Historical reports (unmounted) | Archive page, navigation, queue snapshot composition and notification shortcut are absent; historical readers and archive model and backend archival authority are retained | Stored reports remain unchanged. A unified run-history query/read model needs exact identity, date/status/workflow filtering, cross-version data migration and historical evidence access before backend wiring. Current day filters are not a complete historical index. Legacy Archive URLs show a removal notice and return to the dashboard without queries or version commands. Backend archival and upgrade authority remain independent of this UI. |
| Analytics | `activity-wiring-adapter.ts` feeds `ActivityView` from the AP1 population and authoritative browse; explicit fixture composition retains `activitySample` | The complete ordered population supplies generic counts. Successful root runs alone enter workflow timing averages; duration tiles cover all terminal runs. Zero and unavailable timing remain distinct. Browse revalidates the exact snapshot and injects server paging once; pending filter reads retain controls and mark stale authority. Mock workflow detail never joins fictional logs to served IDs. The Export CSV control awaits the snapshot-bound AP1 download and reports refusal. AS1 retains distinct summary/XLSX export. |
| Explorer | `WorkflowExplorer` uses local workflow fixtures and choice/source models | Stable workflow/node/operation/field IDs, source metadata and ordered timeline. Public display conditions compare string, boolean and null values exactly; withheld/missing values are not guessed. Definition/runtime compiler wiring remains separate. |
| Spreadsheets | Served workbook library through `spreadsheet-wiring-adapter.ts`, with real CSV/XLSX workers and explicit mock fixtures | Workbook/sheet/row/column identities, values/types/fills, number formats, hyperlinks, rich-text runs and optional canonical bindings. Editable XLSX copies import all records, including hidden/filtered rows; worksheet/table filter rules are not imported. Unsupported Excel table color-filter metadata is removed from a private parsing copy only; original bytes remain unchanged, values and supported cell fills survive, and malformed table XML still refuses import. `spreadsheet-fields-model.ts` reuses canonical intake field IDs and namespaces roster-only IDs. Bindings retain source headers, source column coordinates (null for inserted columns), header-row provenance, original worksheet row numbers and suggestion/manual basis. Import detects/selects a header row, retains unbound columns and tracker text, rejects duplicate fields per sheet, and physically removes preamble and excluded columns/sheets. Canonical coercion/schema issues show original worksheet rows and columns without blocking library import; workflow Intake still refuses invalid execution rows. Stable-field read/write helpers preserve headers, formatting and row identity and refuse invalid patches atomically. OCR matching, person-lookup fallback and workflow roster updates remain backend wiring work; no frontend automatic match or durable write is implied. Preserve validation, cancellation, draft exit guards and the 50-version Undo bound. Save uses the opened library version and matching readback; conflicts and uncertain writes retain the draft. The workbook-to-Intake bridge binds the exact saved version. Spreadsheet types remain local. Roster-only fields keep original tracker values; workflow-specific transaction semantics belong to execution admission. |

`QueueSurfaceWire.outcome` is an optional `{ label, tone }` value with tone `success`, `warning`, or `neutral`. The backend projects it only for a `done` run with a verified `completion.terminal-result` receipt. The receipt must match the Queue row's run, trace, attempt, workflow, descriptor, and config identities. A declared workflow outcome must match a satisfied, unredacted fact at the declared field path. A missing receipt, unverified result, or absent or unvalidated fact leaves the outcome unset. A mismatched identity or undeclared raw value throws a projection error. Served Queue wiring maps canonical outcomes by run ID to UI2's existing badge. Rows without an outcome keep the lifecycle badge.

## Component intent and wiring acceptance

Each replacement keeps the mounted view model and exact action semantics below. These are required
wiring checks, not declarations that a producer is connected. A missing backend authority must be
resolved at its owning contract before workflow execution.

| Feature intent | Read data and action | Persistence / completion rule | Frontend acceptance evidence |
| --- | --- | --- | --- |
| Choose and follow a workflow | Catalog capability → day/run snapshot → ordered events. Select exact run/attempt; issue only served action descriptors. | Authoritative run identity, status and revision come from the service. Local overlays must settle against the original command; refused/unknown results cannot invent success. | `workflow-catalog.test.ts`, `queue-command-lifecycle.test.ts`, `frontend-fault-pages.test.ts` in `tests/unit/dashboard/`. |
| Start or rerun work | Canonical inputs/options/steps → matching plan → reviewed start command. Rerun retains original lineage while creating a new attempt. | Persist accepted inputs and plan identity under the task contract. Cancellation creates no run; duplicate activation stays locked; uncertain recovery reads the original operation. | `run-start-model.test.ts`, `start-plan-contract.test.ts`, `run-launch-recovery.test.ts`, `workflow-mock-model.test.ts`. |
| Inspect a log or act on a decision | Ordered steps, observations and evidence → Review/Resolve/View failure shortcut. Target the exact decision entry and visibly focus it inside Logs after clearing search. OCR Review opens its existing Records body through the route owner. The decision control is the command. | Preserve exact step/entry/record/run identity and revision. Shortcuts never approve or resolve. Review approval requires explicit consent and matching acknowledgment; uncertain external writes remain Write parked with reconciliation. | `run-header.test.ts`, `log-panel-model.test.ts`, `log-decision.test.ts`, `workflow-mock-model.test.ts`; `frontend-controls.test.ts` and `ocr-card-layout.test.ts` cover visible focus and OCR Review with native Back/Forward. |
| Correct OCR and match a person | Immutable source/page identity + editable extracted fields + included records → approve the reviewed input. Spreadsheet bindings supply canonical fields for matching; unresolved identity needs Person Lookup or operator resolution. | Bind approval to exact source, corrected record set and revision. Multiple/no matches remain explicit; never select a plausible identity silently. Approved inputs are immutable; parent/child joins and independent outcomes remain visible. Match policy belongs to the intake owner. | `workflow-mock-model.test.ts`, `spreadsheet-fields.test.ts`; OCR record/toolbar browser specs. Backend matching is not implemented by these fixtures. |
| Replace extraction or a reading step with manual input | PDF `ocrMode` selects extraction or manual review without disabling delegation. Typed manual reading values belong to a specific workflow/step/field; form-fill/save/submit actions stay included. | Persist the mode, typed values, operator provenance and schema/revision with the accepted plan. Manual OCR starts with blank predefined records; delegated OCR still needs explicit immutable approval, while standalone OCR has no downstream approval and its Records stay editable after completion; persisting those edits needs a revision-bound backend contract. The normal Read document checkbox controls extraction and its included count. Validate identity, required fields, page bindings and downstream data; manually entered assertions never substitute for a submit receipt or permission. Reuse the owning intake/start contracts before admitting served manual capabilities. Existing served Person Lookup/Separations descriptors are unchanged by the preview. | `workflow-manual-input.test.ts`, `workflow-mock-model.test.ts`; `workflow-manual-input.test.ts`, `ocr-launch-plan.test.ts`, `ocr-direct.test.ts`, `ocr-card-layout.test.ts` and `workflow-mocks.test.ts`. Preview field keys and aliases are presentation contracts, not admitted backend DTOs. |
| Import, read and update a roster | Worker import → choose header/columns → optional canonical field bindings → register copy. Workflow readers use field IDs, not display labels or column positions. | Preserve source/header/column provenance, mapping revision and stable row identity. Persist only selected data. Refuse duplicate bindings; show canonical value issues while retaining original library cells. Workflow execution validates rows through canonical coercers and the workflow schema; invalid typed patches refuse atomically. A workflow roster update needs the owning workflow's confirmed outcome and required approval; reconcile unknown outcomes before retry. Durable library storage and workflow write authority remain backend work. | `hr-gpt-polish.test.ts`, `spreadsheet-column-import.test.ts`, `spreadsheet-fields.test.ts`, `spreadsheet-history.test.ts`; `tests/parity/spreadsheet-xlsx-compatibility.test.ts` covers the real worker, mapping, excluded sheet, edit and XLSX export. |
| Confirm a completed action | Guarded local approval, discard/restore, launch/rerun and deletion → existing shared success toast. Refused actions return no success notification; messages contain no entered field values. | Replace local completion with exact matching command acknowledgment/readback. Preserve pending, refused and uncertain arms; an optimistic click cannot certify success. | `workflow-review-actions.test.ts`; `ocr-launch-plan.test.ts` and `ocr-direct.test.ts`. |
| Save a setting | Effective/default/override metadata → typed edit → revision-bound save after typing settles (700 ms ordinary, 1200 ms credentials) or focus leaves the field → matching readback. Moving within a composite field does not flush; invalid drafts keep inline validation. Paths retain their native picker and reviewed location plan. | No Unsaved changes text. Only matching acknowledgment plus readback emits the shared value-free saved toast. Refusal emits a danger toast; conflict or uncertainty emits a warning toast. Retain drafts and exact retry identity; blur never automatically retries a failed attempt. Persisted and active revisions stay distinct; save feedback survives toast expiry. Protected values follow existing backend authority. | `settings-save-feedback.test.ts`, `settings-editor-surface.test.ts`, `settings-protected-surface.test.ts`, `settings-relocation-surface.test.ts`; `tests/parity/settings-save-toasts.test.ts`. |
| Connect ChatGPT | Continue invokes the account port directly; show verified account state and acknowledged sign-out. | OAuth, consent, eligibility and secure token persistence are backend responsibilities. A logged-in identity alone does not establish subscription-based OCR eligibility. Keep expired, unavailable and usage-limit states distinct. | `chatgpt-account.test.ts` and the ChatGPT account browser specs. Check official eligibility before replacing the preview adapter. |
| Manage a worker and keep an idle browser alive | Resource state → add/pause/resume/stop/remove command. A white five-minute ring requests refresh only while idle and every resource is ready. | Refresh the owned physical browser session, not the dashboard page. Backend checks session identity, ownership/generation and busy/replaced refusal. Rearm only after matching acknowledgment; use/unavailability/unmount cancels the timer. No uncertain/refused automatic resubmission. | `session-preview-command-model.served.test.ts`, `session-idle-model.test.ts` and the Sessions parity controls. Pending controls hydrate from native operations after remount; use, another control, replacement, unavailable authority or unmount cancels the ring. Only all exact physical acknowledgments rearm it. |
| Inspect readiness | Served Preflight/storage checks with scope/fingerprint/time → rerun → remedy navigation. | Retain completed geometry during rerun; acknowledge the checked identity/time. A remedy navigates, never repairs merely by rendering. Missing checks remain explicit. | `settings-status-sections.test.ts`, `settings-storage-doctor.test.ts`; Preflight browser spec. |
| Find a run or open a notice | Complete authoritative search / canonical inbox event → validated exact destination. Mark read separately from resolution. | Signed `sc1` pages retain one query, facet set and snapshot through completion. Refused or expired cursors fail visibly. Read/unread/read-all and canonical snooze use the shared command executor and matching readback; uncertainty retains the original attempt without automatic retry. | `search-wiring-adapter.test.ts`, `inbox-wiring-adapter.test.ts`, `notification-navigation.test.ts`, `dashboard-app.notifications.test.ts`; parity retains the existing local fixtures and controls. |
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
| Run detail, source, attempts | `queries/detail-queries.ts` | `run-detail.ts`: `GET /api/v1/runs/:runId`, `/operation-source`, `/attempt-history` |
| Lazy run sections and rerun values | `queries/detail-queries.ts`, `queries/rerun-queries.ts` | `data.ts`, `trust.ts`: `GET /api/v1/runs/:runId/:section`; `data.ts`: `/rerun-values` |
| Verified diagnostic bytes | `queries/detail-queries.ts` | `trust.ts`: `GET /api/v1/diagnostic-bundles/:bundleId`, `/manifest`, `/attachments/:artifactId`; verified artifact URL `/artifacts/v1/:artifactId` |
| ChatGPT account | `queries/chatgpt-account-queries.ts` | `chatgpt-account.ts`: `GET /api/v1/settings/chatgpt-account`, `/sign-in/:attemptId`; `POST /sign-in`, `/sign-in/:attemptId/cancel`, `/sign-out` under the account path |
| Settings | `queries/settings-queries.ts`, `commands/settings-commands.ts` | `settings.ts`: `GET /api/v1/settings/facts`, `/editable`, `/storage-relocation`; `POST /api/v1/settings/path-picker`; commands through `/api/v1/commands` |
| Preflight | `queries/preflight-queries.ts`, `queries/chatgpt-account-queries.ts` | `settings-preflight.ts`: `GET /api/v1/preflight`, `POST /api/v1/preflight/rerun`; explicit diagnostic through the existing `chatgpt-account.ts`: `POST /api/v1/settings/chatgpt-account/test-ocr` |
| Storage doctor | `queries/storage-queries.ts` | `storage.ts`: `GET /api/v1/storage/doctor/latest`, `/api/v1/storage/doctor` |
| Notifications | `queries/notification-queries.ts` | `notifications.ts`: `GET /api/v1/notifications`, `/status`, `/:notificationId/target` |
| Analytics | `queries/activity-queries.ts` | `activity.ts`: `GET /api/v1/reports/activity`, `/api/v1/reports/activity.csv`, `/api/v1/reports/activity/population`, `/api/v1/reports/activity/population/selected`, `/api/v1/reports/activity/population.csv` |
| Explorer | `queries/explorer-queries.ts` | `explorer.ts`: read-only `GET /api/v1/explorer` |
| Intake | `queries/intake-queries.ts` | `intake.ts`: `POST /api/v1/intake/files`, `GET /api/v1/intake/:sessionId` |
| Commands | `commands/shared-commands.ts` | `commands.ts`: `POST /api/v1/commands`, `/api/v1/commands/bulk` |
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

The checklist's acceptance files live under `tests/unit/dashboard/`, `tests/integration/dashboard/`,
and `tests/parity/` by feature. `frontend-fault-pages.test.ts` mounts the app through the typed
client with HTTP fixtures and controlled SSE: delayed bootstrap/snapshot, startup failure, stale
cursor refusal, disconnect with retained rows, and exact-cursor resume. Port replacements exercise
confirmed, refused, failed, and uncertain outcomes through the mounted component. Keep the successful
mock case for behavioral comparison. These checks do not establish live service admission.

Boundary checks in `tests/architecture/dashboard/` cover wire connectivity, browser import closure,
Fast Refresh exports, Settings vocabulary, and the absence of phone capture. Performance fixtures under
`tests/perf/frontend/` prove complete search/copy/selection, interaction, and heap cleanup against
Queue and Logs without HR services. Visual wiring uses the current [parity suite](../../../src/dashboard/PARITY.md)
with mock values and zero diffs. No source schema, assertion, reference, membership, timeout,
or coverage floor changes merely to make wiring pass.

[Dashboard surfaces](dashboard-surfaces.md) describes mounted behavior.
[Data intake and Edit Data](data-intake-and-edit-data.md), [write safety](write-safety.md),
[execution and sessions](execution-and-sessions.md), and [clock, configuration, and secrets](clock-config-secrets.md)
own their backend policies.

## Authenticated local storage upgrade handoff

The existing profile sign-in endpoint reports `PROFILE_UPGRADE_STARTING` through its ordinary refused/code presentation for an authenticated READY native7 profile. It issues no session cookie. The HTTP owner proves both request-body completion and actual response finish/transfer settlement before the whole-app owner fences and drains its own public/selected transport and profile resources. The handoff never closes a listener from inside its still-admitted initiating transfer.

After proved old profile/server/shared-admission closure, the same whole-app owner reacquires exclusive installation custody, once-consumes and revalidates the authenticated identity witness, then invokes the existing backed-up READY upgrade service with a fresh registered claim. Strict readback and exclusive release precede a new shared public shell on the same loopback port. The operator signs in afresh afterward. No second endpoint, UI component, executor, startup migration or server-lock exemption exists.

The long-lived CLI awaits the actual replacement owner's failure/stop lifetime; bootstrap does not release its stale original admission after application ownership has transferred. Ordinary stop fences synchronously and retains its cached outcome. Transfer, closure, exclusive acquisition, revalidation, upgrade or restart failure remains terminal and visible, retaining every owner whose closure is unproved; no automatic retry follows uncertain mutation.

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
render the refusal's catalog sentence; genuine transport failure uses the authority-unavailable text.
Show setup browser may refresh unavailable public authority with the current cookie, then shows only
that same operation and profile. Unknown method outcomes stay unknown while that draft is active.
Show focuses the owned extension tab or recreates that tab once in the same live context. A closed
window is replaced only after the exact context close event, all tracked pages, the observed process,
and startup, tab, portal and pump callbacks prove closure. A lost worker-stop acknowledgment during
window shutdown is superseded only by that complete proof and validated owned-profile deletion;
otherwise its cause and the closure failure remain uncertain and replacement is refused. Show never
starts enrollment or submits SSO. Explicit Open Duo retains the existing once-per-context login path.

Settings Preflight owns the OCR diagnostic presentation and request lifecycle in
`surfaces/settings/preflight/preflight-ocr-model.ts`. The profile-scoped shell composes it with the
existing account port for freshness and plan eligibility and the existing `testChatGptOcr` typed
client method for inference. The endpoint and canonical `ChatGptOcrTestResultSchema` remain under
the account transport; there is no second API or preflight-admission result type. A diagnostic is
never dispatched by readiness reads, reruns or scope refreshes. The shell disposes the diagnostic
before the account owner when the active profile changes or the page closes.
