# Codebase structure

This map names the current source, test, and documentation owners. Relay runs locally for one operator.
[Project vocabulary](terminology.md) describes workflow and dashboard terms.

## Repository folders

| Path | Contents |
| --- | --- |
| `AGENTS.md` | Repository instructions. Nearer instructions own backend, registry, system, and dashboard constraints. |
| `.agents/` | Project agent data: skill entrypoints in `skills/`, with each skill's references in its own `references/`. |
| `config/` | Runtime isolation and test-data configuration. |
| `docs/reference/` | Current contracts and this map. |
| `docs/guides/` | Workflow authoring guide. |
| `docs/guides/windows.md` | Windows launcher steps. |
| `docs/guard-inventory.json` | Guard owners and reasons. |
| `docs/roadmap/roadmap.md` | Roadmap content. |
| `docs/roadmap/index.html` | Generated roadmap site. |
| `fast-duo/` | Dashboard-owned Chromium enrollment and backend-signed workflow login runtimes. |
| `scripts/build/` | Source-tool preparation and independent checks; `generated-outputs.ts` owns merge-train regeneration paths and commands, and `merge-generated-conflicts.ts` resolves generated conflicts in temporary worktrees. |
| `scripts/dev/` | Dashboard launch and secure environment bootstrap. `relay.ts` owns the Windows production launcher and private loopback stop broker; `relay-backend.ts` reports shutdown only after bootstrap releases its lifetime. Root `relay.cmd` selects portable Node. `tests/support/processes/relay-drain-child.ts` supplies the controlled write-drain proof. |
| `scripts/docs/roadmap.ts` | Roadmap parsing and site generation. |
| `scripts/test/` | Shared typed CI selection/proof/timing-history policy (`ci-plan.ts`), duration-balanced CI file selection, shared full-Chromium installation preflight (`chromium-preflight.ts`), direct-execution detection, suite policy, and artifact policy; `pc.ts` owns leased PC execution and receipts, and dependency-free `pc-source.ts` owns filtered Git deltas and source identity. |
| `.github/workflows/ci.yml`, `release.yml`, `ci-checks.yml`, `release-checks.yml` | Disjoint event entries and per-PR supersession; separately admitted portable-only and full-release check pipelines, stable required summaries and timing publication. |
| `scripts/verify/` | Repository privacy and test-target verification. |
| `src/` | Application source. |
| `tests/` | Tests, fixtures, helpers, and process entrypoints. |

`npm run build:observer-policy` prepares the ignored Windows observer policy artifact under
`node_modules/.cache/relay/`; runtime package prehooks and the Vitest/Vite configs call it. [Guards and tests](guards-and-tests.md#contract-fingerprints-and-build-id)
owns the contract fingerprint and build id.
`npm run roadmap` generates the roadmap site; `npm run roadmap:check` checks it.
`npm run web:build` produces the dashboard bundle in `dist/`.
Briefs, receipts, and task evidence live in the main checkout's gitignored `.work/` folder. The [Conventions](../../AGENTS.md#conventions) own worktree naming and lifecycle.

`src/backend/runtime/writes/recovery-activity.ts` owns retained-run recovery read activity, action notes and required captures. `src/models/run/recovery-activity.ts` owns its exact operation identity and task-compatible note path.

`src/backend/systems/ucpath/driver/transaction-findings-operation.ts` owns the shared Smart HR result-list/detail read and its complete-only operational projection. `src/models/ui/ucpath-transaction-findings.ts` owns findings, displayed Requested time and population accounting. The UCPath UI registry keeps candidate findings recipes outside its verified registry until live match counts and visibility are confirmed.

`src/backend/runs/queries/run-detail/ucpath-findings.ts` verifies retained registered-task findings, their held-check acknowledgement and closed recovery activity for a parked termination. `runtime/writes/recovery-activity.ts` runs that read within the existing bounded session/capture owner. `src/models/dashboard/ucpath-findings.ts` owns the wire shape; `src/dashboard/surfaces/run-detail/logs/ucpath-found-model.ts` maps it into the existing table. Pending selector provenance grants no resolution authority.

`src/models/ocr/review-record.ts` owns canonical record fields and operator-added source provenance shared by review revisions, OCR commands and approved members; the leaf schema keeps workbook reference models independent of review graph initialization.

`src/models/run/display-name.ts` owns the browser-safe run display-name schema; command and run records share that leaf.

`src/backend/runs/queries/activity-timing.ts` owns successful-root timing shared by the Analytics summary and population producers. `src/backend/runs/queries/activity-analytics.ts` owns the outcome split, failure-step counts and median duration those producers add to the same report.

`src/backend/runs/queries/storage.ts` owns the composition-scoped verified backup observation and compact bootstrap projection; `src/backend/storage/sqlite/storage-doctor.ts` owns backup verification.

`src/models/dashboard/workbook-library.ts` owns catalogue/version/action wire shapes.
`src/models/dashboard/run-outputs.ts` owns intended workbook and worksheet ZIP output facts shared by retained plans and Confirm.
`src/backend/storage/sqlite/workbook-library-repository.ts` owns catalogue CAS, immutable named snapshots, action receipts and per-workflow last-used source selections alongside editable revisions. `src/models/config/authority.ts` owns the current authority schema and build-envelope version constants; SQLite migrations re-export those bindings.

`src/models/profiles/profile-identity.ts` owns the derived name/initials runtime shape.
`src/backend/storage/configuration/protected-settings-upgrade.ts` owns stopped source authentication and
protected-value retirement; `src/backend/storage/maintenance/protected-settings-upgrade.ts` sequences its
verified backup and canonical replacement before runtime composition.

## Source tree

```text
src/
├── backend/{accounts,app,logs,processing,profiles,runs,runtime,storage,systems,transports}/
├── dashboard/{app,assets,client,ds,kit,lib,public,state,surfaces}/
├── models/{artifacts,config,dashboard,events,failures,fields,intake,notifications,ocr,
│           preflight,processing,profiles,providers,run,runtime,sessions,systems,task,trust,
│           ui,validation,workflow,workflows,write-safety}/
├── rules/{commands,identity,intake,kronos,matching,normalization,notifications,
│          preflight,redaction,runs,separations,sessions,time,validation,workflow,write-safety}/
├── workflow-kit/validation/
├── workflows/{i9-lookup,person-lookup,separations}/
└── cli.ts
```

### Backend

`storage/maintenance/account-deletion.ts` owns captured local-account erasure and startup continuation.
`storage/maintenance/custody-availability.ts` owns the Windows maintenance refusal shared by backup/export, restore, retirement, upgrades, layout migration and ready-account deletion. Normal reads and initial profile cleanup remain outside that contract.
`runtime/browser/duo-platform-authenticator.ts` prepares emulated platform enrollment and login, exporting fresh keys/counters to canonical custody and rehydrating ready keys over private CDP. `runtime/browser/native-browser-focus.ts` activates the exact owned Duo process and captured Relay return target on macOS and Windows.

Paths in this table are relative to `src/backend/`.

| Path | Ownership |
| --- | --- |
| `assistant/` | The tool-calling agent turn (`service.ts`), opaque references and operator-text masking (`references.ts`), tool plugins per domain with the registry and hash-pinned workflow facts (`plugins/`), private profile-token authorization and once-consumable canonical actions. Profile SQLite owns grants, chats and actions, and the conversation history the service accepts, replays and settles. |
| `accounts/` | ChatGPT OAuth, verified account and usage state, and the shared Responses OCR/assistant transport. Account-specific model catalogs and bounded strict namespaced function turns use the same selected-account owner; production functions require their current canonical availability and authorization gates; absent verified model policy refuses inference. Browser-safe account and sign-in lifecycle schemas live in `models/dashboard/chatgpt-account.ts`; HTTP routes own the latest account attempt. |
| `app/` | Bootstrap, configuration, host admission, preflight, rehearsal manifest validation, and application composition. |
| `app/composition/` | Storage, dashboard, and worker dependency assembly. `profile-credential-inventory.ts` composes credential maintenance assessment, including stopped machine-control inventory; `storage/maintenance/profile-inventory.ts` owns canonical copy/resource membership and retained browser-root validation shared with stopped READY-profile upgrade. Its required `ProfileBrowserClosure` port binds browser work to the actual runtime admission or the finite flat-store lease. `storage/maintenance/upgrade.ts` runs profile SQLite upgrade and the separate stopped machine-control upgrade. `storage-compose.ts` coordinates registered READY-person health and backed-up forward migration before dashboard runtime admission; ordinary sign-in remains current-only. `storage/maintenance/existing-data-backup.ts` owns the raw-byte flat native6 archive writer for startup migration and stopped CLI backup; registered-person SQLite backups remain in `upgrade.ts`. `storage/maintenance/existing-data-backup-files.ts` owns strict schema2 flat archive source/receipt membership, private copy and independent verification without opening authority databases. `storage/maintenance/cancel-queued-runs.ts` owns digest-bound offline cancellation of never-claimed flat native6 queues, using the finite `AuthorityDatabase.cancelQueuedRunsNative6` transaction and shared run transition/row-update primitives; `storage/maintenance/process-closure.ts` supplies the current startup and offline process/open-file/cwd absence checks. `storage/admission/bootstrap-admission.ts` runs the verified flat-store start-clean migration before profile composition; `installation.ts` owns its durable deletion intent and empty-registry publication. |
| `app/composition/dashboard/` | `compose.ts` retains the public exports. `runtime-contracts.ts` owns runtime and input contracts. `runtime-startup.ts` owns the public runtime wrapper and reverse startup unwind; `runtime-resources.ts` owns synchronous environment and authority preparation. `worker-process.ts` owns worker launch, control and spawning. `profile-session-routes.ts` owns public profile, session and onboarding routes and application HTTP binding. `shutdown-custody.ts` owns runtime detach, application stop and backup custody classification. `timeline.ts` owns timeline admission and polling. `write-safety.ts` binds write resolution, canonical artifacts, intake parsing and trust readers. `notification-wiring.ts` binds notification publication and route projections. `dashboard-wiring.ts` owns async startup orchestration, service and worker wiring, shell and API assembly, HTTP startup and observer polling. |
| `app/registries/` | Workflow module composition from `src/workflows/registry.ts`, task, step-proof, and test-target registration. `task-registry.ts` composes system, processing, and workflow task stores. |
| `logs/` | Spans, observed data, artifacts, and diagnostics. `debug-events.ts` owns repository-backed debug persistence and redaction. `emergency-faults.ts` constructs boot faults for the native local timeline spool. `duo-diagnostics.ts` writes closed Duo codes and timings under the admitted machine root’s `logs/`, rotating four files of at most 256 KiB each; request and profile identifiers never enter these files. |
| `logs/diagnostics/` | Diagnostic capture and retention. |
| `processing/` | Extraction, normalization, OCR, provider calls, roster processing, and spreadsheets. Task families register beside their implementations. `providers/nominatim-owner.ts` owns the parent serial geocode queue and worker IPC client; `providers/geocode-adapters.ts` owns provider request/response mapping. `ocr/tasks/read-approved-records.ts` exposes that read to workflow graphs. `providers/chatgpt-ocr-adapter.ts` owns the fixed OCR model and scoped page reader shared by the canonical provider adapter and the fixed Settings diagnostic. |
| `profiles/` | Control-authenticated registry, credential inventory and session authority. `profile-session.ts` owns private draft/session publication, `login-change.ts` owns the Relay login change and its interrupted-change restore, `profile-onboarding.ts` owns issued draft attempts and verified method receipts, and `onboarding-duo.ts` defines the provider capability contract. Browser enrollment lives in `runtime/browser/onboarding-duo-provider.ts`. `profile-errors.ts` owns shared profile refusals. Native verifier publication and its cryptography live in `storage/configuration/verifier-store.ts` and `storage/configuration/synthetic-verifier.ts`. Browser-safe schemas live in `models/profiles/`. |
| `runs/lifecycle/startup-crash-recovery.ts` | Startup process-closure receipts, dead-worker run reconciliation and previous-day pristine queue cancellation before work admission. |
| `runs/` | Commands, start plans, lifecycle, recovery, queries, projections, exports, provenance, notifications, settings, explanation, and trust readers. |
| `runs/commands/write-command-target.ts` | Projects opaque write occurrence tokens and resolves them through private intent authority at HTTP ingress. |
| `runs/queries/explorer.ts` and `explorer-review-spec.ts` | Definition-derived Explorer catalog and operator review: run options, scoped session requirements, ordered page/source cards and declared outcomes. |
| `runs/commands/command-refusal.ts` | Shared command rejection construction; runtime recovery imports it directly. |
| `runs/trust/` | Canonical run readers and receipt services. |
| `runs/start/recovery-plan.ts` | Server-derived checkpoint recovery admission and completed-transaction validation. `models/run/recovery-plan.ts` owns its internal plan; ordinary Rerun remains in `rerun.ts` and `rerun-values.ts`. |
| `storage/sqlite/run-continuation.ts` | Owns the shared run-bound checkpoint reader and validates durable continuation issuance and exact retained checkpoints and gates. `run-continuation-delegation.ts` authenticates original child groups for failed-child replacement and terminal evidence reuse. |
| `runtime/` | Browser sessions, checkpoints, execution, gates, policies, preflight, scheduling, settings, workers, and writes. `browser/browser-session-factory.ts` owns authenticated worker session acquisition and reuse. `browser/command-browser.ts` owns profile-scoped manual command acquisition, cancellation and proven native/authentication closure. `browser/native-browser.ts` owns Playwright persistent-context launch, native probing and page/context close proofs; its probe port supplies storage with closure results without raw browser access. `browser/profile-browser-closure.ts` composes that driver with storage registry custody. `browser/onboarding-duo-provider.ts` owns browser enrollment for the profile onboarding contract. `browser/fast-duo-extension.ts` stages their allowlisted extension files. `browser/workflow-duo-provider.ts` brokers public assertions under the current admitted worker or command ceremony scope. |
| `storage/` | Admission, artifacts, configuration, events, maintenance, and SQLite persistence. `artifacts/artifact-sink.ts` owns shared sink contracts and conflicts; `artifact-sink-projector.ts` owns destination locking and atomic head/ack settlement. `named-file-output-sink.ts` publishes retained artifacts to absent named destinations. `app/composition/worker/artifact-output.ts` binds publication to the source run's retained documents or I-9 tracker setting; the retention sink preserves its journal and derives the nine-column I-9 worksheet. `maintenance/browser-root-upgrade.ts` owns the stopped forward conversion to compact registry handles, verified metadata backup, exclusive directory moves and exact journal recovery. `browser-root-contract.ts` owns its strict persisted schemas; `maintenance/profile-custody.ts` owns retained browser membership and resource-closure rules shared by registry and inventory. `browser-roots.ts` owns the bounded external browser-root registry, durable launch/native intents, canonical worker/onboarding/command paths, native acquisition authority, and scoped profile cleanup under actual admission custody. Its probe port has no runtime implementation dependency; callers supply the native driver, and stopped control upgrade forwards that same explicit probe factory.  `maintenance/fixed-layout.ts` owns fixed-root forward journal schemas, exact move-prefix/tree checks, and operation-bound person activation claims. `storage-compose.ts` assembles startup; installation owns directory moves/source fences, and SQLite owns backup-checked configuration publication. `app/config/runtime-isolation.ts` resolves the platform host workspace (`LOCALAPPDATA/Relay` on Windows, the OS home application-data folder on POSIX); assets retain their repository root. `maintenance/flat-start-clean.ts` owns the finite flat credential layout, archive-bound deletion plan and exact replay membership; installation owns journaled effects and empty publication. `file-identity.ts` owns platform-specific exact metadata reads and shared in-memory and JSON file-identity comparisons; credential-safe-file exposes those identity operations with its file API. `private-path.ts` owns shared observed-path privacy policies, private directory/stage creation, file replacement and retained-resource flushes. `windows-private-path.ts` owns the lazy Windows native bridge, SID/DACL rules, exact NTFS identity/reparse validation and checked native resources; both Windows SQLite observers execute a checked CommonJS build of the shared policy. `windows-observer-policy.ts` binds that source build to its canonical inputs and digest; `scripts/build/windows-observer-policy.ts` prepares and checks it. POSIX observers run plain CommonJS with their original local checks. Callers retain path membership, content and operation identity checks. |
| `storage/configuration/` | Settings and canonical private credential persistence. `canonical-credential-store.ts` owns the three encrypted protected-settings, Duo and ChatGPT records, the external key/generation/counter/retirement head, and durable create/erase operations. `credential-store.ts`, `duo-credential-store.ts` and `chatgpt-credential-repository.ts` expose the purpose-specific records; `duo-signing.ts` owns public assertion validation and Node cryptography. `protected-settings-upgrade.ts` owns the stopped protected-document grammar, retirement transform and credential command-identity inspection. `credential-conversion.ts` verifies supported stopped predecessor credentials and their independent credential-free SQLite backup before conversion. `credential-key-custody.ts` owns OS keychain entries and non-secret key metadata. `credential-safe-file.ts` supplies private file reads, exact mutex custody and operation proofs. |
| `storage/events/` | Native timeline writers, readers, and emitters. `local-debug-log.ts` owns the capped local timeline spool, verified import, development stderr mirror and closed profile-selection diagnostics. Recovery-scoped notes bind their exact durable activity and keep original action timestamps. |
| `storage/sqlite/` | Database authority, repositories, migrations, process locks, backup inspection, recovery status, and deletion custody. `artifact-references.ts` owns recursive artifact identity and consumer traversal for deletion and managed inventory. `database-identity.ts` owns the application-ID and immutable installation/person binding digest. `timeline-repository.ts` owns ordered event persistence. `worker-slots.ts` authenticates reservation and retirement lineage for both live custody and isolated maintenance snapshots; `worker-control.ts` owns their authenticated control reads. `readonly-authority-snapshot.ts` owns isolated source snapshots. `authority-database.ts` `configureWritableConnection` owns the writable SQLite connection policy (foreign keys, secure deletion, WAL, full synchronous, busy timeout) that `AuthorityDatabase` and the workbook-library test connections share. `sqlite/evidence-schema-upgrade.ts` validates stopped profile-name-domain evidence and plans frozen-owner certificates; `maintenance/evidence-schema-upgrade.ts` owns its closure, verified backup and replay sequencing. `AuthorityDatabase` publishes and reads the sealed current certificate in the upgrade journal. `models/storage/evidence-schema-admission.ts` owns that value-free certificate and source digest contract. `offline-restore.ts` owns automatic same-person backup selection and interrupted replacement replay. `restore-write-fences.ts` refuses evidence loss; `same-person-restore-candidate.ts` binds immutable identity and runtime roots. `maintenance/automatic-restore-files.ts` binds retained files and exact recovery membership. `maintenance/clean-shutdown-backups.ts` retains three verified shutdown backups without deleting upgrade archives. The pure `storage/source-closure.ts` owns `AuthoritySourceClosureUnprovedError` and private failed-resource retention without authority or resource accessors. |
| `systems/` | Browser-system sessions, drivers, UI registries, and tasks. CRM, I-9, Kuali, New Kronos, OnBase, and UCPath have driver implementations. Old Kronos, ServiceNow, and SharePoint have session declarations and empty task stores with `unwired` drivers. I-9 owns name-based employee search and Section 2 summary reads; its UCOP login uses the shared UCSD SSO and backend Fast Duo path. |
| `systems/browser-shared/` | Shared sign-in, authenticated application, action-note, and semantic UI effect behavior. |
| `systems/kronos-shared/` | Shared timecard models. |
| `systems/ui-task-links.ts` | Explorer task attribution from system registries. |
| `transports/cli/` | CLI dispatch and command handling. |
| `transports/http/` | Dashboard HTTP routes, request schemas, and SSE subscriptions. |
| `workbooks/` | Typed workbook library: one mutable master, ordered durable keyed writes, cell ownership, operation receipts, manual named versions, immutable creation proofs and reference snapshots. `sharepoint-sync.ts` binds manual Sync to a fresh profile/settings/credential command and the authenticated SharePoint download. |
| `systems/sharepoint/driver/interpreter.ts` | Canonical workbook URLs, account authentication and GUID-pinned workbook reads through an owned command browser. The workbook composition injects its bounded browser transport. |
| `systems/browser-shared/command-session.ts` | Command input, browser scope and callback contracts shared by runtime acquisition and workbook composition. The runtime retains native custody and private Duo cleanup handles. |
| `processing/providers/sharepoint-browser-transport.ts` | Serializable same-origin Fetch streaming for SharePoint JSON proofs and workbook bytes, with exact response checks, byte bounds and reader cleanup. |
| `workbooks/workbook-library-error.ts` | Shared workbook failure class, used by library services, stored-data validation and transport adapters. Error codes and display text remain in `models/failures/error-catalog.ts`. |
| `workbooks/workflow-workbook-service.ts` | Creates a table workbook or patches a captured reference through the admitted library provider, composed in `app/composition/worker/run-resources.ts`. Original records and operation receipts supply replay proof. |
| `runs/workbooks.ts` | Authenticates captured workbook references, run-bound patches, native receipt events, Logs row choices and live-revalidated resolution commands. |

### Dashboard and shared packages

| Path | Ownership |
| --- | --- |
| `src/cli.ts` | CLI entrypoint. |
| `src/dashboard/app/` | Renderer composition, navigation, commands, and workflow data-source selection. `navigation/run-navigation.ts` validates exact served day/run destinations for notifications, search and linked Queue chips before opening Logs. |
| `src/dashboard/client/` | Shared backend transport, entered through `index.ts`, `queries.ts` and `commands.ts`, plus subscriptions. |
| `src/dashboard/ds/` and `src/dashboard/kit/` | Design system and specimen preview. `ds/ui.tsx` is the barrel; `primitives/` and `theme/` implement it. `kit.html` is the separate preview entry. |
| `src/dashboard/state/` and `src/dashboard/lib/` | Resource hooks, bootstrap, day and served clock state; framework-free utilities live in `lib/`. `state/queue-wiring-adapter.ts` owns the Queue producer and its typed handlers. `state/activity-wiring-adapter.ts` owns Analytics population projection, snapshot-bound browse/export and exact run-detail admission. `state/spreadsheet-wiring-adapter.ts` owns saved workbook reads, drafts and versioned Save. |
| `src/dashboard/surfaces/` | Feature components, sibling `*-model.ts` view models, styles and mock producers. `surfaces/shared/` holds cross-feature components. Workflow mocks live under `workflows/mocks/`. Run-detail Logs presentation lives under `run-detail/logs/`. Notification producers live in `notifications/notifications-preview-model.ts` and `notification-rail-model.ts`; workspace search projection lives in `shell/search/search-wiring-model.ts`. Intake session resources live in `state/intake-wiring-adapter.ts`; command verification lives in `intake/intake-command-model.ts`. |
| `src/dashboard/assets/` and `src/dashboard/public/` | Bundled assets and static public files. The Logs preview lives under `public/logs-preview/`. |
| `src/models/` | Browser-safe schemas, contracts, and API shapes. System and workflow task contracts live under `systems/` and `workflows/`; canonical fields and the shared spreadsheet field catalog live under `fields/`. `failures/error-origins.ts` owns the closed constructor-bound cause vocabulary and its value-free serializer shared by backend events and browser reports. `failures/error-catalog.ts` owns task-code normalization for durable failures and their served recovery declarations. |
| `src/models/storage/file-identity.ts` | Exact JSON file-identity values shared by credential, installation and logout witnesses: safe numbers or canonical decimal strings. |
| `src/models/people/hire-employee.ts` | Validated hire employee facts shared by Onboarding planning and system write targets. |
| `src/models/ui/ucpath-hire.ts` | Hire targets, complete findings, staged wizard states, permanent keys and independently verified filing proofs. Each hire task contract lives in its canonical `models/systems/ucpath/<task>.ts` file; `hire-contract.ts` shares read/subject metadata. `backend/systems/ucpath/driver/hire-operation.ts` and `hire-ui-registry.ts` own the hire browser family; `rules/ucpath/hire-verdict.ts` refuses incomplete or uncertain discovery. |
| `src/models/ui/i9-creation.ts` | Separate profile and remote-record targets, staged states, permanent keys and saved-effect proofs. `backend/systems/i9/driver/creation-operation.ts` owns their browser operations; the I-9 store binds their prepare, commit, probe and verification tasks. |
| `src/models/dashboard/queue-parent.ts` | Queue visibility classification shared by native summaries, projections and browser consumers. Queue surfaces carry one nullable parent fact; stored run shapes remain scheduling authority. |
| `src/models/dashboard/activity-population.ts` | Canonical Analytics population, selected browse, export and AP1 snapshot schemas. `activity-selection.ts` owns the nested AS1 report selection used by summary and XLSX exports. |
| `src/models/workflows/person-lookup/result.ts` | Person Lookup terminal result schema shared by its definition, retained CRM proof and OCR outcome fold. |
| `src/models/config/` | Settings grammar, isolation shape, and immutable configuration snapshots. `person-preferences.ts` owns the strict person appearance/shell values and neutral defaults; snapshot preference fingerprints are independent of execution config fingerprints. |
| `src/models/workflow/explorer-preview.ts` | Browser-safe read-only Explorer flow parts the timeline renders. |
| `src/models/workflow/review-spec.ts` | Strict step-owned Explorer page, line, field-source and branch-label declarations. `src/models/dashboard/explorer-review-spec.ts` owns their generated wire shape. |
| `src/models/workflow/dry-run.ts` | Browser-safe preview stage accounting, typed sample provenance and reserved sample detection. |
| `src/workflow-kit/fingerprints.ts` | Pure, browser-safe workflow contract and task implementation fingerprints, and `WORKFLOW_KIT_VERSION`. `backend/runtime/build-id.ts` owns the worker-scoped app build id. |
| `src/models/events/` | Timeline, stored confirmed-action, and confirmation-proof schemas. |
| `src/models/trust/` | Failure, diagnostic, receipt, and scenario schemas. |
| `src/rules/identity/logical-item.ts` | Browser-safe logical-item derivation, shared with runtime identity minting through `identifiers.ts`. |
| `src/rules/identity/stable-uuid.ts` | Browser-safe deterministic UUID derivation shared with the runtime `identifiers.ts` entry; native and browser callers use the same digest and UUID bits. |
| `src/rules/runs/run-status.ts` | Shared run status and task/category state derivation for Queue, Logs, Activity and native summary filtering. |
| `src/rules/` | Pure decisions and validation, including identity, clocks, normalization, ledger derivation, redaction, and write safety. |
| `src/workflow-kit/` | Root-level TypeScript modules for task and workflow declaration, flow construction, compilation, sessions, providers, artifacts, and capabilities. |
| `src/workflow-kit/workflow-definition.ts` | `defineWorkflow` and `compileWorkflow`. |
| `src/workflow-kit/validation/` | Workflow roles, source paths, implementation bindings, scenario coverage, and the build manifest. |

### Workflow ownership and imports

`src/models/systems/crm/documents.ts` owns CRM document shapes; the matching `search-document-records.ts`
and `read-idocs.ts` files own their task contracts and Explorer source links.
`src/workflows/crm-doc-download/` owns CRM document batches, retained worksheet row resolution and one ZIP per worksheet.
Its `tasks/read-worksheet-archives.ts` verifies retained PDFs and creates the archive collection;
`steps/package-worksheets/step.ts` binds that task and owns its proof. The workflow publishes
`worksheet-archives.collection` through the existing blocking documents sink. Shared run-bound
reference reads live in `backend/workbooks/` and the `workbooks.library` provider; tasks accept
lookup keys while the native run owner supplies the exact retained library and named version.

`src/workflows/onbase/` registers a child-only per-person Emergency Contact PDF import with source-page and import-document step proofs. Its system store and semantic driver live in `src/backend/systems/onbase/`; `src/backend/storage/sqlite/exclusive-session-leases.ts` owns the durable identity-session lease and its migration. The browser factory holds that lease through proven browser closure; uncertainty and process loss do not expire it.
Its task implementations live in `tasks/read-source-page.ts`, `stage-import.ts`, `match-import.ts`, `upload-import.ts` and `verify-import.ts`, matching each contract's task ID for implementation fingerprints.
The corresponding contract files live under `src/models/systems/onbase/` with those same task names;
`import-document.ts` owns their shared import schemas, policy, examples and saved-document validation.

`src/workflows/person-lookup/` and `src/workflows/separations/` each contain `workflow.ts`,
`task-registry.ts`, `index.ts`, and `tasks/`. The workflow definition is browser-safe. The index declares
registration, importing the definition, backend task store and retained proofs. `src/workflows/registry.ts`
lists every registration by hand; no dashboard entry imports it.
`src/models/ocr/stored-extraction.ts` owns immutable extraction storage envelopes: validated source-bound page readings and explicitly unbound source evidence. The native artifact repository reads exact extraction IDs and retains every deliberate reading version.
`src/models/ocr/review.ts` owns uploaded PDF records, canonical review revisions and selected approval snapshots.
`src/backend/storage/sqlite/ocr-review.ts` owns their native repository and migration.
`src/backend/runs/lifecycle/ocr-checkpoint-publication.ts` admits OCR resource ownership and publishes readings with checkpoints;
`ocr-review-authority.ts` authenticates review journals, snapshots and OCR recovery references.
`src/backend/runs/commands/ocr-source-service.ts` owns uploaded PDF admission, authorized source-page bytes and read-only command settlement.
`src/backend/runs/lifecycle/approved-ocr-records.ts` owns approved snapshot, native member-record and bulk source reads. It authenticates current worker/task custody, operator ancestry and exact native OCR outcomes through the snapshot authority. `src/backend/processing/ocr/review-authority.ts` owns the transport-facing reader port and refusal error; it depends only on model types. Worker composition injects its operations into the thin `ocr-approved-snapshot-adapter.ts` and `ocr-review-adapter.ts` provider codecs. Bulk sources retain original terminal review metadata separately from corrected selected records.
`src/backend/runs/queries/ocr-review.ts` projects the existing review section, served through the existing typed client.
`src/models/workflow/delegated-record.ts` owns stable review-owner/record references and their child histories.
`src/backend/runs/queries/ocr-record-members.ts` binds OCR records to authenticated original delegation scope and projects Queue lines.
`src/dashboard/surfaces/run-detail/review/review.tsx` owns the shared record cards, served OCR review and mock review adapter;
`state/review-wiring-adapter.ts` owns its lazy exact-run reads. Workflow mocks supply their own data and editing rules to the same cards.

The child-only `src/workflows/ocr/` and `src/workflows/ocr-page/` folders use the same layout.
Their indexes generate production child modules and task stores; OCR delegates page readings to
OCR Page and form-specific identity lookups to Person Lookup or I-9 Lookup. Only declared parent edges admit these children;
neither has a public start surface. Their retained proofs live at `ocr/steps/source-pages/step.ts`
and `ocr-page/steps/read-page/step.ts` and enter `STEP_PROOF_MODULES` through their registrations.

`src/workflows/ocr/steps/source-pages/step.ts` also owns the generic approved-record graph builder: one awaited
OCR child, authenticated snapshot retrieval, then ordered member delegation. Target, selection
policy and member mapping belong to each consuming workflow. `src/workflows/emergency-contact/`
uses it for the PDF operation; `src/workflows/emergency-contact-member/` authenticates the approved
OCR record and native child lineage before contact acquisition, then owns one employee's contact
plan and transaction. Both retain step proofs and schema-owned results.
The local `ocr.approved-snapshot` and `ocr.review` capabilities are issued by
`worker/run-resources.ts`; they have no endpoint or configurable provider.

`src/workflows/onboarding/` composes snapshot-bound CRM planning, UCPath identity search, delegated I-9 lookup, complete transaction findings and an operator hire-path gate, protected profile/remote-record creation, hire filing and fresh receipt verification, and run-bound master result cells. Its four retained proofs cover CRM data, UCPath search, I-9 search and the complete write sequence. The dashboard source remains `mock` until an operator dry run and sign-off.
`steps/hire-review/step.ts` owns the reviewed write sequence and its proof recipe. Other step definitions own their typed entries and proofs. `tasks/` contains one implementation per pure workflow task ID; `src/rules/onboarding/` validates the reviewed path and cross-checks receipts before constructing master commands. `roster.ts` binds the captured whole legal and lived name cells and declares the EID and transaction output fields; `roster-name.ts` splits those names against the CRM record. `src/backend/runs/workbooks.ts` owns native row-choice authentication and the shared run-bound patch/ownership/receipt seam. System drivers own the three independently fenced effects and fresh saved-detail reads; UNKNOWN submissions remain parked.

`src/workflows/i9-check/` is child-only: it reads UCPath for one OCR-derived person and returns a retention row. Its three groups have typed tasks and retained proofs under `steps/<key>/step.ts`.
Its pure contracts live in `src/models/workflows/i9-check/read-match-outcome.ts` and
`read-retention-row.ts`; `check.ts` owns their shared identity/retention schemas and policy.
`src/workflows/i9-check-start/` is the public PDF parent, with document review, roster-reference and retention step definitions and proofs. It delegates original PDFs to admitted OCR, authenticates corrected approved selections, retains each source coordinate, and runs the existing person child once per approved EID. It publishes one results workbook and the configured tracker through the shared workbook and xlsx services. Pure batch derivations live in `src/rules/i9-check/batch.ts`; canonical document/person/result shapes live in `src/models/workflows/i9-check/`, and parent task contracts mirror their IDs in `src/models/workflows/i9-check-start/`.
Shared workbook publication and captured-version reads use `src/models/processing/workbooks/{read-result,read-reference}.ts` and the processing workbook store. `src/backend/runs/workbooks.ts` authenticates the run's retained reference before late-discovered keys can be read; callers cannot select another library or version. Captured-reference writes require an explicit planning declaration. Onboarding declares its roster for name binding, row choice and verified result patches through the captured reference. SharePoint imports remain unexposed. The public I-9 parent selects served data. I-9 Lookup is hidden and the person child has no source entry; both remain admitted through declared parent edges. I-9 Check supports a dry run: `save-workbook` declares `stop-before-publish`, so a dry run previews the results workbook without saving it and leaves the tracker untouched.
`src/workflows/i9-lookup/workflow.ts` is child-only; Onboarding declares its parent edge in the registered workflow definition. It uses
the I-9 system store, then retains its typed result through `tasks/read-result.ts` in the workflow
store. Its one `lookup` timeline checkpoint groups both tasks. The registered harness at
`steps/lookup/step.ts` reuses that exact group. Results contain `signerName`, `i9Status`, and record
IDs when a summary was read.
Its `index.ts` declares the store and the retained proof. `src/workflows/registry.ts` lists it in
`CHILD_ONLY_WORKFLOWS`, separately from `PUBLIC_WORKFLOWS`. A caller must
declare its delegation edge to resolve a child.


Person Lookup has four chunk harnesses at `src/workflows/person-lookup/steps/<step>/step.ts`:
`searching`, `cross-verify`, `active-status`, and `crm-dates`.
Separations has five chunk harnesses at `src/workflows/separations/steps/<role>/step.ts`:
`identity-check`, `kronos-timecard`, `kuali-extraction`, `kuali-finalization`, and `ucpath-transaction`.
`src/workflow-kit/validation/source-layout.ts` derives definition and scenario paths from workflow roles.
A derived scenario path does not imply that a scenario file exists.

Renderer code consumes shared models, rules, workflow-kit modules, and browser-safe workflow definitions.
Workflow definitions and step harnesses do not import backend task implementations.
Backend composition loads workflow definitions and task registries. System and processing task registries
sit beside their owning families. Shared packages and renderer code do not load workflow `tasks/`.

## Tests and evidence

The [root codebase instructions](../../AGENTS.md#codebase) own test naming and source mirroring.
The resulting layout is:

```text
tests/
├── architecture/{app,dashboard,logs,models,processing,runs,runtime,storage,support,systems,tooling,workflow-kit}/
├── backend/{app,logs,processing,runs,runtime,storage,systems,transports}/
├── dashboard/{app,client,ds,lib,state,surfaces}/
├── fast-duo/src/
├── {models,rules,scripts,workflow-kit,workflows}/
├── mocks/
├── perf/
├── support/{fixtures,helpers,processes}/
├── types/
├── cli.integration.test.ts
├── vite.dashboard.config.test.ts
└── vitest.config.integration.test.ts
```

`tests/architecture/test-layout.test.ts` checks canonical filenames and mirrors against existing tracked source.
Architecture, mocks, performance, type, and support trees are exempt from source mirroring.
Architecture fixtures and helpers stay beside their owning guard families.
Shared fixtures, fresh-authority builders, and child-process entrypoints live under `tests/support/`.
`tests/support/helpers/dashboard/controls/` owns the UI control preview fixtures, loaded by
fixture name from `tests/mocks/app-entry.tsx`.
- `tests/support/duo-ceremony-setup.ts` registers the shared Duo fixture cleanup for every Vitest project; the fixture owner stays process-safe.
Shared composition setup lives in `tests/support/helpers/backend/{capability-wiring-world,write-recovery-world,dashboard-child-world,worker-loop-world}.ts`
and `tests/support/helpers/dashboard/mounted-rerun-world.ts`; each test owns its allocation, hooks, and cleanup.
`tests/support/compiled-process{,-setup,-loader}.ts` owns test child JavaScript preparation,
launch imports and content-addressed loading; `guards-and-tests.md` owns its cache contract.
`tests/support/helpers/backend/runtime-lifetime.ts` owns temporary kernel listeners for tests;
`tests/support/helpers/backend/public-profile-shell.ts` owns fresh public-profile roots and the canonical signup/Duo request sequence shared by shell and first-run completion proofs.
`tests/backend/runs/lifecycle/run-record-service.write-parking.integration.test.ts` owns write-park journal and event atomicity.

| Behavior | Test owner |
| --- | --- |
| Committed write-recovery refusal | `tests/backend/runtime/writes/write-recovery.committed-refusal.integration.test.ts` |
| Dashboard rerun launch | `tests/dashboard/surfaces/run-start/run-launch.rerun.integration.test.ts` |
| Executor snapshot refusal | `tests/backend/runtime/execution/run-executor.snapshot-refusal.integration.test.ts` |

`tests/support/fixtures/ui/<system>/` contains the 16 sanitized selector manifests for CRM, Kuali,
New Kronos, and UCPath. The semantic registries name these fixtures; architecture tests and the UCPath
registry test read or assert their paths.
`src/backend/systems/ucpath/driver/contact-page.ts` adapts the standalone contact editor to the
shared contact-set interpreter and the single UCPath driver. Pure mapping, complete-set fingerprints,
primary-plan decisions and exact presence rules live in `src/rules/ucpath/emergency-contact.ts`. Candidate recipes live in
`UCPATH_PENDING_CONTACT_RECIPES` outside the verified UI registry; the synthetic contact HTML
fixture proves adapter behavior, not live selector validity. Contact read, prepare and comparison
contracts use their task-ID suffix modules under `src/models/systems/ucpath/`, with shared schemas and idempotency in `contact-contract.ts`; their implementations live under
`src/backend/systems/ucpath/tasks/`, one file per task ID. `contact-verdict.ts` owns the shared protected
probe fold. Preparation can demote one uniquely bound primary and add the declared primary contact.
The production adapter supplies the contact Save port; the shared driver consumes the retained
prepared plan under mutation-capability checks. [Write safety](write-safety.md) describes its Save
and persisted-read path.
`tests/architecture/systems/fixtures/selector-evidence-bindings.json` owns selector-binding inputs.
`tests/architecture/dashboard/fixtures/pending-wire-bindings.json` owns dashboard wire exceptions.

`tests/support/processes/failure-resolution-peer.ts` runs the independent annotation writers;
`tests/support/helpers/failure-resolution/fixtures.ts` owns their launch and closure.

`tests/mocks/` holds `/ui-mock` scenes and the mock dashboard build entry.
`tests/perf/` holds dashboard performance checks. `tests/types/` holds compile-time inputs and their checks.
`tests/scripts/docs/roadmap.test.ts` tests roadmap parsing.
The private `config/test-data.local.json` input is ignored. Runtime state and artifact roots are declared
in `config/runtime-isolation.json`; test fixtures are separate from that operator state.

## Not built yet

- Complete workflow-agnostic dashboard wiring and per-workflow served-data integration follow the approved wiring and workflow briefs.

Person Lookup folds UCPath/CRM identity and employment facts in `rules/matching/person-lookup.ts`.
`rules/matching/ucpath-person.ts` owns shared appointment preference. CRM discovery and exact
selected-record verification live in the CRM driver and their corresponding system tasks.

`storage/admission/admission-identity.ts` owns issued identity membership, validation and the shared profile browser-root refusals; constructor-only registration is enforced by the admission identity guard. `admission/lifetime-lock.ts` owns the dedicated loopback listener, one-shot workspace initialization, issued fixed-layout publication transfer, and IPC handle transfer; controller close waits for each owned child process's actual `close` event. `admission/process-root.ts` owns the fixed process-root maintenance fence, old-build artifact refusal and shared control-path ancestry checks. `runs/lifecycle/startup-crash-recovery.ts` coordinates stopped Logout2 recovery through `RunRecordService`; composition supplies that recovery and the native browser-closure port while SQLite owns the atomic settlement and custody boundary. `admission.ts` keeps `RuntimeAdmission` as the single storage-capability facade. It privately captures registered profile setup/runtime state and issues runtime, settlement and exact-operation stopped-maintenance admissions; ordinary storage and credential effects recheck current access. The [installation and maintenance reference](clock-config-secrets.md#installation-roots-boot-and-maintenance) documents its access and lifetime checks. `installation.ts` publishes registry, pending-operation, and Duo-purpose continuity under its fixed private-file mutation lock, including the stopped machine-control upgrade and post-exit settlement of one already published Duo operation. Its private publication scope supplies validated nonrecovering registry reads inside that same mutation. `configuration/credential-safe-file.ts` supplies exact nonce/inode/bytes file locking for this control and the distinct profile locks in `profiles/registry.ts`. The current registry uses installation ID and revision with logical operation digests. Its existing stopped converter journals registry/control/marker together; general persisted inode/device continuity and recertification are absent, while exact credential, Duo and restore operation proofs remain.

Rehearsal declarations remain in `models/trust/dry-run-scenario.ts`; verification-only evidence
assertions and graph checks live in `tests/support/helpers/dry-run-scenario-fixtures.ts`.
Workflow execution uses the signed-in dashboard Run and its canonical start-plan, command and worker owners.

### Assistant model preference

`src/models/config/assistant-model-preference.ts` owns model slug and preference validation shared by command and assistant schemas. `src/models/dashboard/assistant.ts` owns the profile preference record and served assistant action contract. `src/backend/storage/sqlite/assistant-model-preference.ts` owns its authenticated singleton and command/audit history checks. The existing command kernel and command service own the operator-only asynchronous preparation boundary and compare-and-swap mutation; account/composition preparation is required before that command becomes available.

`src/rules/spreadsheets/workbook-io.ts` owns shared library XLSX/CSV IO, structural admission, retained cell metadata and deterministic intake export through `@shbernal/ts-xlsx`. Its sibling `spreadsheet-inflate-limit.ts` refuses an xlsx whose parts inflate past one shared byte limit, counted while the bytes inflate, before workbook XML is parsed. Its sibling `workbook-size.ts` shares populated-cell and grid limits with saved-workbook validation. Imported formulas or metadata outside the editable model mark the workbook for named master-edit refusal. The dashboard editor owns editing/rendering behavior and consumes this browser-safe boundary.

`transports/http/routes/debug-responses.ts` observes terminal HTTP failure responses through the existing debug writer.

Task contract modules follow each task ID suffix: Emergency Contact uses `models/workflows/emergency-contact/read-result.ts`; its member uses `read-approved-contact.ts` and `read-contact-plan.ts`, with shared plan data in `contact-plan.ts`. OCR snapshot and record tasks use separate `models/processing/ocr/read-approved-snapshot.ts` and `read-approved-record.ts` modules; `approved-snapshot.ts` owns their shared transport protocol. UCPath contact tasks each use their task suffix module, while `models/systems/ucpath/contact-contract.ts` owns shared contact schemas, policy and idempotency.

`src/backend/storage/sqlite/run-settlement-row.ts` owns the physical result settlement columns, retained terminal context and current settlement selection shared by native reads, summaries and search. Results and receipts retain immutable applied-version identities; active runs expose no earlier settlement as their current output.

`src/backend/storage/sqlite/delegation-refresh.ts` owns same-row read-only parent refresh admission, accepted retry cohorts and their native wakeup evidence. The workflow factory also proves aggregate accounting boundaries for parents with writing children and no own effects. `delegation-authority.ts` authenticates envelope-preserving manual Resume, current member accounting and strict unwritten-member Retry. The run service admits descriptor authority and reports synchronous parent version changes through the command audit; dependency reconciliation settles the cohort. The native journal reads Resume separately from continuation issuance. The executor reuses retained upstream evidence and publishes fresh accounting at the current claim generation.

`src/backend/storage/sqlite/delegation-authority.ts` owns current and retained membership selection, revision/reuse custody and scoped authentication proofs. `src/rules/commands/lifecycle-command-id.ts` owns deterministic initial and revised invocation identities shared by factories and native admission.

`app/composition/dashboard/assistant.ts` adapts the dashboard's query owners into the assistant plugin dependencies. `dashboard-wiring.ts` composes them with the selected profile's currentness check. `src/backend/storage/sqlite/assistant-history.ts` owns the conversation and message tables, their migration, acceptance and settlement, decision captions, imports, startup settlement and expiry. `dashboard/surfaces/assistant/assistant-history-model.ts` is the browser's async client and cache of the served history: chat list, drafts, restored transcripts without action or verification authority, and the one-time import of the old tab history.

`src/backend/runs/queries/run-retry.ts` owns read-only Lookup batch-root Retry eligibility. The Queue composition supplies it through the projection authority port. Native commands retain mutation authority.
